import type { TaskNodeMeta } from './types'
import {
  type partialTaskDraft,
  type TaskNode,
  type llmSettings,
  TaskProcessingError,
  type OnInterruptFunc,
  getApiConfigCopy,
} from './types'
import { type TyTaskManager } from './taskManager'
import { handleFunctionExecution, taskResult } from './tools'
import { type AsyncQueue, makeSerializable } from '../utils'
import { createChatCompletionTask } from '../tools/chatCompletionTool'
import type { CrudWrapper } from '../crudWrapper'

export function useTaskWorkerController() {
  /* This class adds context to task executions during the runtime.
  We don't necessarily need to save this information in the database
  It also gives us the ability to control the task worker process

  - We can interrupt/cancel task processing
  - we can track number of error in a task chain and cancel, if too many errors appear
  - we can track other information
  - we can gracefully exist streamed tasks
  - and more..
  */
  let interrupted = true
  let interruptReason: string | null = null
  let interruptCallbacks: ((reason: string | null) => void)[] = []
  let waiting = false
  let errorCount = 0

  function interrupt(reason: string | null = null): void {
    console.log('interrupting: ', reason)
    interrupted = true
    interruptReason = reason
    interruptCallbacks.forEach((callback) => callback(reason))
  }

  function isWaiting() {
    return waiting
  }

  function setWaiting(value: boolean) {
    console.log('task worker is waiting!')
    waiting = value
  }

  function isInterrupted(): boolean {
    return interrupted
  }

  function getInterruptReason(): string | null {
    return interruptReason
  }

  function reset(full = true): void {
    interrupted = false
    interruptReason = null
    errorCount = 0
    if (full) {
      interruptCallbacks = []
    }
  }

  const onInterrupt: OnInterruptFunc = (callback) => {
    interruptCallbacks.push(callback)
  }

  return {
    interrupt,
    isInterrupted,
    getInterruptReason,
    reset,
    onInterrupt,
    isWaiting,
    setWaiting,
    increaseErrorCount: () => {
      errorCount++
    },
    getErrorCount: () => {
      return errorCount
    },
  }
}
export type TaskWorkerController = ReturnType<typeof useTaskWorkerController>

// TODO: how about we put this here into its own tool as well!
//       its totally possible now... Would probably make the code cleaner...
async function processTask(
  task: TaskNode,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
  allowedTools: string[],
  analyzeModel: string | undefined,
  llmTools: boolean,
): Promise<partialTaskDraft[][]> {
  if (task.content.type === 'functioncall') {
    // calculate function result
    const func = task.content.data
    const tools = await taskManager.updateToolDefinitions(false)
    console.log(`Calling function ${func.name}`)
    if (tools[func.name] && !taskWorkerController.isInterrupted()) {
      const funcR = await handleFunctionExecution(
        func,
        tools,
        taskWorkerController.onInterrupt,
        task,
      )

      // We check the result of the task here to see whether it contains
      // a lists of tasks. If thats the case we return
      // those for continuation, otherwise
      // we create a generic task result.
      if (taskResult.safeParse(funcR).success) {
        console.log('new tasks were created:', funcR)
        // we have to do this funny workaround with typescript because
        // for some reason zod will delete the task content onwards
        // of the second task in a taskchain... after parsing. so we're
        // simply using the original...
        return (funcR as taskResult).taskChainList
      } else {
        // TODO: Not really sure, what to do with the task processor... . It might be
        //       a good idea, to have this as its a tool in its own right.
        //       this way we could develop different kinds of function processors and
        //       probably also simply make the code more consistent...
        if (!analyzeModel)
          throw new TaskProcessingError(
            'We need to select a model in order to analyze the result of our task!!',
          )

        const newTasks: partialTaskDraft[][] = [
          [
            {
              role: 'system',
              content: { type: 'toolresult', data: funcR },
            },
            createChatCompletionTask({
              model: analyzeModel,
              allowedTools,
              goal: 'AnalyzeToolResult',
              llmTools,
            }),
          ],
        ]
        console.log('function returning generic result', funcR)
        return newTasks
      }
    } else {
      const toolnames = JSON.stringify(allowedTools)
      throw new TaskProcessingError(
        !taskWorkerController.isInterrupted()
          ? `The function '${func.name}' is not available in tools. Please select a valid function from this list: ${toolnames}`
          : 'The function execution was cancelled by taskyon',
      )
    }
  } else {
    // We expect all function calls to do three things:
    // - either return a result
    // - return a taskchain where the last task is a functionTask
    // - return a taskchain with the last task a "terminatino" task..
    const newTasks: partialTaskDraft[] = [
      {
        role: 'system',
        content: { type: 'return', data: 'no follow-up tasks found!' },
      },
    ]
    return [newTasks]
  }
}

export async function runTaskWorker(
  processTasksQueue: AsyncQueue<string>,
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
) {
  console.log('entering task worker loop...')

  while (true) {
    console.log('waiting for next task!')
    let task: TaskNode | undefined = undefined
    try {
      if (taskWorkerController.isInterrupted()) {
        // in case of errors, especially if its an interrupt event we simply want to cancel everything :P
        // empty our task queue :)
        console.log('clear out task queue due to interruption')
        processTasksQueue.clear()
      }

      if (processTasksQueue.count() === 0) {
        taskWorkerController.setWaiting(true)
      }
      const taskId = await processTasksQueue.pop()
      taskWorkerController.setWaiting(false)
      if (taskWorkerController.isInterrupted()) {
        // don't process tasks anymore..  all we can do now is to wait until the user manually presses the
        // "reset" button ;)
        continue
      }

      // make sure we know from outside that the worker is active...
      console.log('processing task:', taskId)
      task = await taskManager.getTask(taskId)
      if (task && !taskWorkerController.isInterrupted()) {
        if (!llmSettings.selectedApi) throw new TaskProcessingError('No AI API selected!!')
        const api = getApiConfigCopy(llmSettings, llmSettings.selectedApi)
        const newTasks = await processTask(
          task,
          taskManager,
          taskWorkerController,
          llmSettings.allowedTools || [],
          api?.selectedModel,
          llmSettings.enableOpenAiTools,
        )

        // we make sure to identify all parent tasks from this batch, because
        // we oly want to execute the leaf tasks..
        // we can do this, because all of these tasks are newly created. this means, we don't have any
        const addTasks = (finishedTask: TaskNode) => async (taskChain: partialTaskDraft[]) => {
          const immediateExecute = taskWorkerController.isInterrupted() ? false : true
          const lastTaskId = await taskManager.addTaskChain(taskChain, finishedTask.id)
          // TODO:  this needs an overhaul..  we want to save tasks only once
          //        and have them immutable...
          //        we are doing this by leaving out task results and save the result directly as the content
          //        of a new task and not i the task itself...
          if (lastTaskId) {
            const lastTask = await taskManager.getTask(lastTaskId)
            // make sure we stop execution of the task chain if we have a termination task
            if (immediateExecute && lastTask && lastTask.content.type !== 'return') {
              // TODO: we need processTasksQueue as an argument here (not implicitly adding it to this function...)
              processTasksQueue.push(lastTaskId)
            } else {
              //save task if we don't execute it, because it is already finished :)
              console.log(`task chain finished at id ${lastTaskId}!`)
            }
          }

          // TODO: add last task to GUI by checking if our current selected task now has this child...
          // TODO: and move this somewhere else!  this function should not be in here...
          //       we could have this check by getting the callback function for new tasks in tystate...
          llmSettings.selectedTaskId = lastTaskId
        }
        const taskAdder = addTasks(task)
        void newTasks.map(taskAdder)
      }
    } catch (error) {
      console.error('Could not complete task iteration:', error)
      taskWorkerController.increaseErrorCount()
      if (taskWorkerController.getErrorCount() >= llmSettings.maxAutonomousTasks) {
        // TODO: somehow put this into an error tasknode...
        // TODO: also add any taskWorkerController interrupt in an error tasknode..
        taskWorkerController.interrupt(
          `Too many errors occured, interrupting execution after ${taskWorkerController.getErrorCount()} errors!`,
        )
      }

      if (!llmSettings.selectedApi) throw new TaskProcessingError('No AI API selected!!')
      const api = getApiConfigCopy(llmSettings, llmSettings.selectedApi)
      if (!api?.selectedModel)
        throw new TaskProcessingError('No Model selected for Error analysis!!')
      const errorTaskChain = createErrorTaskChain(
        error,
        task,
        api?.selectedModel,
        llmSettings.enableOpenAiTools,
        llmSettings.allowedTools || [],
        taskManager.debugDb,
      )
      const errorTaskId = await taskManager.addTaskChain(errorTaskChain, task?.id)

      // interrupt execution if interrupted flag is shown!
      // this makes sure that results are still saved, even if we stop any
      // further execution

      if (!taskWorkerController.isInterrupted() && errorTaskId) {
        // we need processTasksQueue as an argument here!!!
        processTasksQueue.push(errorTaskId)
      }
      llmSettings.selectedTaskId = errorTaskId

      // TODO: run this taskWorker in a separate worker js/browser thread!
      // TODO: clean up task, create a new task with the error and  & decide if we want to try this task again!

      // if we realize that a cancellation event was sent, empty the queue and set all tasks to "Cancelled"
      /*if (!processTasksQueue.count()) {
        cancelAllTasks = false;
        cancelCurrenTask = false;
      } else if (cancelAllTasks) {
        void taskManager.updateTask(
          {
            id: taskId,
            state: 'Cancelled',
          },
          true
        );
        continue;
      }*/
    }
  }
}

// TODO: move all the "debugging" stuff away nd make use of the debugging DB that we're getting ;)
function createErrorTaskChain(
  error: unknown,
  task: TaskNode | undefined,
  analyzeErrorModel: string,
  llmTools: boolean,
  allowedTools: string[],
  debugDb: CrudWrapper<TaskNodeMeta>,
) {
  const errorTask: partialTaskDraft = {
    role: 'system',
    content: {
      type: 'error',
      data: `An error occured:\n\n\`\`\`\n${JSON.stringify(error)}\n\`\`\``,
    },
  }
  const debugInfo = {
    error,
  }

  if (error instanceof TaskProcessingError) {
    errorTask.content = {
      //message: `An error occured: ${error.message}:\n\n${dump(error.details, { skipInvalid: true })}`,
      type: 'error',
      data: `An error occured:\n\n\`\`\`\n${error.message}${error.details ? ':\n\n' + JSON.stringify(makeSerializable(error.details, 7)) : ''}\n\`\`\``,
    }
    if (task) {
      debugInfo.error = {
        message: error.message,
        name: error.name,
        details: error.details,
        location: 'task processing',
      }
    }
  } else if (error instanceof Error) {
    errorTask.content = {
      type: 'error',
      data: `An error occured:\n\n\`\`\`\n${error.message}\n\n${JSON.stringify(error)}\n\`\`\``,
    }
    if (task) {
      debugInfo.error = {
        message: error.message,
        stack: error.stack,
        cause: error.cause,
      }
    }
  }

  if (task?.id) void debugDb.upsert(task?.id, debugInfo, 'shallow_merge')

  return [
    errorTask,
    createChatCompletionTask({
      model: analyzeErrorModel,
      goal: 'AnalyzeError',
      llmTools,
      allowedTools,
    }),
  ]
}
