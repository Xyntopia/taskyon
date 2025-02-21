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

// an "unfinished" task is one that
function createTaskTracker(tm: TyTaskManager) {
  // our numberOfUnfinishedTasksMap holds a number of unfinished Tasks
  // every time a taskchain finished, we decrement the number of unfinished tasks
  // and if it reaches 0, we can continue with the next task
  // TODO: use this to speed up finished task checking
  //        we'll wait if this is even needed, thats why it isn't finished and commented
  //        out for now...
  //        our iterative approach might be sufficient already
  // const numberOfUnfinishedSubTaskChainsMap = createLruCache<string, number>(10000)
  //     - has on-going subtasks, which means,
  /*async function calculateUnfinishedTaskNum(taskManager: TyTaskManager, task: TaskNode) {
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
  }*/

  // TODO: speed up this function by tracking the unfinished subtasks...
  //       every time a subtask finished, we should activly decrease the number of of unfinished
  //       subtasks that its parent has.
  //       so basically, whenever some subtask chain finishes, it should propagate this information
  //       to its parent task somehow..

  // TODO: make this an "LRU" cache or something like that...
  const isFinishedCache = new Set<string>()

  async function isTaskFinishedCached(taskId: string): Promise<boolean> {
    if (isFinishedCache.has(taskId)) {
      return true
    } else {
      const isFinished = await isTaskFinished(taskId)
      if (isFinished) {
        isFinishedCache.add(taskId)
      }
      return isFinished
    }
  }

  async function areAllSubtasksFinished(taskId: string) {
    const childrenIDs = await tm.searchAllDirectChildren(taskId)
    const numberOfSubTaskChains = childrenIDs.size
    if (numberOfSubTaskChains > 0) {
      // now we need to get each leaf task..."
      // this way we can check for completion from the "back" of each
      // subtask chain which avoids having to check every single
      // function task & its children in a subchain
      const leafTasks = (
        await Promise.all(
          Array.from(childrenIDs, async (id) => await tm.findOneSiblingLeafTask(id)),
        )
      ).flat()

      // now iterativly check again starting from each leaf task, if they're finished...
      const leafTasksFinished = await Promise.all(
        leafTasks.map((id) =>
          isTaskFinishedCached(id).then((finished) => {
            if (!finished) {
              // we are using a "reject" here to break out of the promise chain
              // this way we can produce an early exit...
              return Promise.reject(new Error('Not finished'))
            }
            return true
          }),
        ),
      )
        .then(() => true)
        .catch(() => false)
      return leafTasksFinished
    } else {
      return false // if there are no subtasks, we know that this task is not finished
    }
  }

  // this function recursivly checks if a task is finished
  async function isTaskFinished(taskId: string): Promise<boolean> {
    const task = await tm.getTask(taskId)
    if (!task) throw new TaskProcessingError('Task not found!')
    if (task.content.type === 'functioncall') {
      return await areAllSubtasksFinished(task.id)
    } else {
      // we know there are no children tasks here, so we need to check prior tasks...
      if (task.priorID) {
        return isTaskFinishedCached(task.priorID)
      } else {
        return true
      }
    }
  }

  // TODO: add caching where whenever we have determined before that a task was finished
  //       its indicated in this list...  we should use a "Set" for this...

  return {
    isTaskFinished: isTaskFinishedCached,
    setTaskFinished: (id: string) => isFinishedCache.add(id),
  }
}

export async function runTaskWorker(
  processTasksQueue: AsyncQueue<string>,
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
  taskWorkerController: TaskWorkerController,
) {
  console.log('entering task worker loop...')

  const { isTaskFinished, setTaskFinished } = createTaskTracker(taskManager)

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
        // check if the previous task was finished. only of all prior tasks are finished
        // we can continue processing this task...
        if (task.priorID && !(await isTaskFinished(task.priorID))) {
          // we need to wait until all subtasks from its previous tasks are finished before
          // continuing with this task so we simply push this task back onto the stack
          processTasksQueue.push(task.id)
          // if this is the only task in the queue, we need to wait a little bit in order
          // to not overwhelm the browser (This will likely never be the case, but just in case)
          if (processTasksQueue.count() === 1) await sleep(500)
          // we know that our prior task is finished, so we can continue with this task
          continue
        }

        // we don't need to process tasks which aren't a function...
        // we also don't need to push them back in the queue...
        // we also don't need to add the task as the "last" task in the GUI
        // because they will automatically be called as soon as the
        if (task.content.type !== 'functioncall') {
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

        // check if there are any 'functioncall' tasks in the new tasks.
        // if so, we need to add them to the queue, otherwise we can simply cancel here and
        // continue with the next task. And we can also push this task as the

        const addTaskChain = (finishedTask: TaskNode) => async (taskChain: partialTaskDraft[]) => {
          // we can already persist all of our tasks here to the taskManager, as
          // they're immutable.
          const taskList = await taskManager.addTaskChain(
            taskChain,
            undefined, // the first task should not have a priorID, but all of them should have a parentID
            finishedTask.parentID,
          )
          // TODO: we need processTasksQueue as an argument here (not implicitly adding it to this function...) for better FP style
          // we are adding only function tasks to the chain and if we find out the one of the chains doesn't contain

          // set finishedTask as completed
          //  - if all subtaskChains don't contain any functioncall task
          const functionTasks = taskList.filter((t) => t.content.type === 'functioncall')
          const lastTask = taskList.at(-1)

          if (lastTask && functionTasks.length === 0) {
            // we can set the leaf of this chain as finished
            setTaskFinished(lastTask.id)
          }

          // we only need to add function tasks to the queue
          functionTasks.forEach((t) => {
            processTasksQueue.push(t.id)
          })

          // TODO: add last task to GUI by checking if our current selected task now has this child...
          // TODO: and move this somewhere else!  this function should not be in here...
          //       we could have this check by getting the callback function for new tasks in tystate...
          llmSettings.selectedTaskId = lastTask?.id

          return functionTasks.length
        }
        const taskChainAdder = addTaskChain(task)
        const chainHasFinishedStatus = await Promise.all(newTasks.map(taskChainAdder))
        // if all subtasks in this chain are finished, we can set this task as finished
        // TODO: we can potentially track the number of subtasks that are left here...
        if (chainHasFinishedStatus.every((status) => status === 0)) {
          setTaskFinished(task.id)
        }
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
      const errorTaskId = (await taskManager.addTaskChain(errorTaskChain, task?.id)).at(-1)?.id

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
