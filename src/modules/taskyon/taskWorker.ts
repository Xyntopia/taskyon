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
import { type AsyncQueue, createLruCache, makeSerializable, sleep } from '../utils'
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
      // TODO: define a maximum size of the taskChain e.g. last 100 tasks or something like that...
      const taskChain = await taskManager.getTaskChain(task.id, true)
      const funcR = await handleFunctionExecution(func, tools, taskWorkerController.onInterrupt, {
        taskChain,
      })

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

        // TODO: move this into chatCompletion as a subtask chain
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
    // - return a taskchain with the last task a "termination" task..
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

  // our numberOfUnfinishedTasksMap holds a number of unfinished Tasks
  // every time a taskchain finished, we decrement the number of unfinished tasks
  // and if it reaches 0, we can continue with the next task
  const numberOfUnfinishedSubTaskChainsMap = createLruCache<string, number>(10000)

  while (true) {
    console.log('waiting for next task!')
    let task: TaskNode | null = null
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
        // check if we already track the state of our previous task in the map
        if (task.priorID && !numberOfUnfinishedSubTaskChainsMap.has(task.priorID)) {
          const numberOfUnfinishedSubTaskChains = await calculateUnfinishedTaskNum(
            taskManager,
            task,
          )
          numberOfUnfinishedSubTaskChainsMap.set(task.priorID, numberOfUnfinishedSubTaskChains)
        }
        // TODO: Rules of computing tasks
        // - if we have a functionTask, we know that we need to get at least one subtask
        // otherwise we dont have to process a task anymore...
        // - only process task if we know for sure, that *all* prior tasks have finished
        //   - if prior is a functionTask, its sufficient, to check numberOfUnfinishedSubTaskChainsMap,
        //     because we know that this task will create at least one subtask
        //   - if prior is any other task type, we can't say, because they have and will never been processed ^^.
        //     So we simply need to push the current task back on the stack and wait. because non-function tasks
        //     are only finished, if their own prior task is finished. So they will be removed from the stack
        //     once they are finished. So we could check if the prior task is in the stack maybe?
        //   - or we make sure, that non-function task simply never appear in the stack?
        //   - alternativly we could go back to the next previous function task and check if it has finished
        //   - we need to make sure, that return tasks are not added unless all tasks in a subtaskchain
        //     are finished...
        //   - So I guess one way to check if tasks are finished is to check if all function tasks
        //     in a chain are finished...
        //   - how do we check this? We need to see if there are return tasks everywhere
        //     this means, return tasks should *only* here in the taskWorker? and from nowhere else?
        //     how can we enforce that?
        //   - every task chain is finished, if it ends with a non-function task...

        // check if previous task is still unfinished and cancel processing in this case...
        if (task.priorID && numberOfUnfinishedSubTaskChainsMap.get(task.priorID) !== 0) {
          // we need to wait until all subtasks from its previous tasks are finished before
          // continuing with this task so we simply push this task back onto the stack
          processTasksQueue.push(task.id)
          // if this is the only task in the queue, we need to wait a little bit in order
          // to not overwhelm the browser (This will likely never be the case, but just in case)
          if (processTasksQueue.count() === 1) await sleep(500)
          continue
        }
        // we want to signal to our cache that this task is now finished and we can continue with its siblings.
        // this works, because our tasks are immutable so once this is set, it will never change..
        if (task.content.type === 'return') {
          if (task.parentID) {
            // we only need to monitor subtask Chains if we have a parentID
            const unfinishedTasks = numberOfUnfinishedSubTaskChainsMap.get(task.parentID) ?? 1
            numberOfUnfinishedSubTaskChainsMap.set(task.parentID, unfinishedTasks - 1)
          }
          continue
        }

        // TODO: try to get rid of all the llmSettings functionality here..   this should only be relevant for chatCompletion which
        //       is now a tool! :)
        if (!llmSettings.selectedApi) throw new TaskProcessingError('No AI API selected!!')
        const api = getApiConfigCopy(llmSettings, llmSettings.selectedApi)
        const newTasks: partialTaskDraft[][] = await processTask(
          task,
          taskManager,
          taskWorkerController,
          // TODO: replace "allowedTools" with "available Tools" in processTask...
          llmSettings.allowedTools || [],
          api?.selectedModel,
          llmSettings.enableOpenAiTools,
        )

        const addTasks = (finishedTask: TaskNode) => async (taskChain: partialTaskDraft[]) => {
          // we can already persist all of our tasks here to the taskManager, as
          // they're immutable.
          const taskIdList = await taskManager.addTaskChain(
            taskChain,
            undefined, // the first task should not have a priorID, but all of them should have a parentID
            finishedTask.parentID,
          )
          // TODO: we need processTasksQueue as an argument here (not implicitly adding it to this function...) for better FP style
          // we are adding all tasks from the chain here, because some tasks
          // might need to create subtasks before we continue with the next task
          taskIdList.forEach((tid) => {
            processTasksQueue.push(tid)
          })

          // TODO: add last task to GUI by checking if our current selected task now has this child...
          // TODO: and move this somewhere else!  this function should not be in here...
          //       we could have this check by getting the callback function for new tasks in tystate...
          llmSettings.selectedTaskId = taskIdList.at(-1)
        }
        const taskAdder = addTasks(task)
        void newTasks.map(taskAdder)
        // add number of unfinished tasks to our map so that we can track
        numberOfUnfinishedSubTaskChainsMap.set(task.id, newTasks.length)
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
      const errorTaskId = (await taskManager.addTaskChain(errorTaskChain, task?.id)).at(-1)

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

// an "unfinished" task is one that
//     - has on-going subtasks, which means,
async function calculateUnfinishedTaskNum(taskManager: TyTaskManager, task: TaskNode) {
  const childrenIDs = await taskManager.searchAllDirectChildren(task.id)
  const numberOfSubTaskChains = childrenIDs.size

  if (numberOfSubTaskChains > 0) {
    // now we need to check for the number of tasks with "return" type
    const childTasks = await taskManager.searchTasks({
      selector: {
        parentID: task.priorID,
      },
    })

    const numberOfFinishedSubTaskChains = childTasks.filter(
      (t) => t.content.type === 'return',
    ).length
    return numberOfSubTaskChains - numberOfFinishedSubTaskChains
  } else {
    return 0
  }
}

// TODO: move all the "debugging" stuff away nd make use of the debugging DB that we're getting ;)
function createErrorTaskChain(
  error: unknown,
  task: TaskNode | null,
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
