import type { TaskNodeMeta, TyTaskStreamData } from './types'
import {
  type partialTaskDraft,
  type TaskNode,
  type llmSettings,
  TaskProcessingError,
  getApiConfigCopy,
} from './types'
import { type TyTaskManager } from './taskManager'
import { handleFunctionExecution, taskResult } from './tools'
import { createAsyncQueue, makeSerializable, sleep } from '../utils'
import { createChatCompletionTask } from '../tools/chatCompletionTool'
import type { CrudWrapper } from '../crudWrapper'
import { createStream } from '../frpBus'

// TODO: how about we put this here into its own tool as well!
//       its totally possible now... Would probably make the code cleaner...
async function safeExecuteTask(
  task: TaskNode,
  taskManager: TyTaskManager,
  stopSignal: AbortSignal,
  allowedTools: string[],
): Promise<unknown> {
  try {
    if (task.content.type === 'functioncall') {
      // calculate function result
      const func = task.content.data
      const tools = await taskManager.updateToolDefinitions(false)
      console.log(`Calling function ${func.name}`)
      if (tools[func.name] && !stopSignal.aborted) {
        // TODO: define a maximum size of the taskChain e.g. last 100 tasks or something like that...
        const taskChain = await taskManager.getTaskChain(task.id)
        const funcR = await handleFunctionExecution(func, tools, stopSignal, {
          taskChain,
          getSecret: async (name) => {
            console.log('get secret name', name)
            await sleep(10000)
            return Promise.resolve('N/A')
          },
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          setSecret: (name, _value) => {
            console.log('set secret name', name)
          },
          stopSignal,
        })

        return funcR
      } else {
        const toolnames = JSON.stringify(allowedTools)
        throw new TaskProcessingError(
          !stopSignal.aborted
            ? `The function '${func.name}' is not available in tools. Please select a valid function from this list: ${toolnames}`
            : 'The function execution was cancelled by taskyon',
        )
      }
    } else {
      throw new TaskProcessingError(
        `Task with id ${task.id} is not a functioncall task, but of type ${task.content.type}. This should not happen!`,
      )
    }
  } catch (error) {
    // Attach the current task context to the error
    if (error instanceof Error) {
      Object.assign(error, { task })
      throw error
    } else {
      const err = new Error(`Non-error thrown, with task context: ${JSON.stringify(task)}`)
      Object.assign(err, { task })
      throw err
    }
  }
}

function parseResultForTaskChains(
  funcR: unknown,
  analyzeModel: string | undefined,
  allowedTools: string[],
  llmTools: boolean,
): partialTaskDraft[][] {
  if (taskResult.safeParse(funcR).success) {
    console.log('new tasks were created:', funcR)
    // we have to do this funny workaround with typescript because
    // for some reason zod will delete the task content onwards
    // of the second task in a taskchain... after parsing. so we're
    // simply using the original...
    const newTasks = (funcR as taskResult).taskChainList
    return newTasks
  } else {
    // TODO: Not really sure, what to do with the task processor... . It might be
    //       a good idea, to have this as its a tool in its own right.
    //       this way we could develop different kinds of function processors and
    //       probably also simply make the code more consistent...
    if (!analyzeModel)
      throw new TaskProcessingError(
        'We need to select a model in order to analyze the result of our task!!',
      )

    // TODO: maybe move this into chatCompletion?
    //       I am not sure, if that makes sense, because we don't know yet what kind of result a tool produces...
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
        await Promise.all(Array.from(childrenIDs, async (id) => await tm.findSiblingLeafTasks(id)))
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
      if (task.content.type === 'return') {
        // return type tasks are by definition always finished...
        return true
      } else if (task.priorID) {
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

// check if there are any 'functioncall' tasks in the new tasks.
// if so, we need to add them to the queue, otherwise we can simply cancel here and
// continue with the next task. And we can also push this task as the
const createAddTaskChain =
  (
    taskManager: TyTaskManager,
    queueTask: (id: string) => void,
    emitWorkerMessage: (value: TyTaskStreamData) => void,
    setTaskFinished: (id: string) => Set<string>,
  ) =>
  (finishedTask: TaskNode) =>
  async (taskChain: partialTaskDraft[]) => {
    // we can already persist all of our tasks here to the taskManager, as
    // they're immutable.
    const taskList = await taskManager.addTaskChain(
      taskChain,
      undefined, // the first task should not have a priorID, but all of them should have a parentID
      finishedTask.id,
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
      emitWorkerMessage({ stage: 'processed', task: lastTask })
    }

    // we only need to add function tasks to the queue
    functionTasks.forEach((t) => {
      queueTask(t.id)
    })

    return functionTasks.length
  }

function workerLoggingHelper(streamEmit: (value: TyTaskStreamData) => void) {
  let tasksInProgress = 0
  const taskIsProcessing = (taskId: string) => {
    tasksInProgress += 1
    console.log('entering task loop:', taskId)
  }
  const allTasksFinished = () => {
    // this means that all tasks are finished and we can emit a final message
    tasksInProgress = 0
    console.log('all tasks finished!')
    streamEmit({ stage: 'all finished' })
  }
  const taskFinishedProcessing = (taskId: string) => {
    tasksInProgress -= 1
    console.log('finished task loop:', taskId)
    if (tasksInProgress <= 0) allTasksFinished()
  }
  return {
    allTasksFinished,
    taskIsProcessing,
    taskFinishedProcessing,
    getTasksInProgress: () => tasksInProgress,
  }
}

function createHandleError(
  stop: (message: string) => void,
  taskManager: TyTaskManager,
  streamEmit: (value: TyTaskStreamData) => void,
  currentTaskCtrl: AbortController,
  queueTask: (id: string) => void,
) {
  let errorCount = 0
  errorCount += 1

  return async (
    error: unknown,
    task: TaskNode,
    selectedModel: string | undefined,
    llmSettings: {
      maxAutonomousTasks: number
      enableOpenAiTools: boolean
      allowedTools?: string[]
    },
  ) => {
    if (errorCount >= llmSettings.maxAutonomousTasks) {
      // TODO: somehow put this into an error tasknode...
      // TODO: also add any taskWorkerController interrupt in an error tasknode..
      stop(`Too many errors occured, interrupting execution after ${errorCount} errors!`)
    }

    const errorTaskChain = createErrorTaskChain(
      error,
      task,
      selectedModel,
      llmSettings.enableOpenAiTools,
      llmSettings.allowedTools || [],
      taskManager.debugDb,
    )

    // we are adding the error task chain as a subtaskchain with the parentID of this
    // particular task.
    const errorTaskId = (await taskManager.addTaskChain(errorTaskChain, undefined, task.id)).at(
      -1,
    )?.id
    streamEmit({ stage: 'error', taskId: errorTaskId })

    // interrupt execution if interrupted flag is shown!
    // this makes sure that results are still saved, even if we stop any
    // further execution
    if (!currentTaskCtrl.signal.aborted && errorTaskId) {
      // we need processTasksQueue as an argument here!!!
      queueTask(errorTaskId)
    }
  }
}

export function runTaskWorker(llmSettings: llmSettings, taskManager: TyTaskManager) {
  console.log('starting task worker listener...')

  const setupRun = (
    streamEmit: (value: TyTaskStreamData) => void,
    stop: (message: string) => void,
  ) => {
    console.log('setting up task worker run...')
    const { isTaskFinished, setTaskFinished } = createTaskTracker(taskManager)

    const currentTaskCtrl: AbortController = new AbortController()

    const processTasksQueue = createAsyncQueue<string>()
    const queueTask = (id: string) => {
      if (!currentTaskCtrl.signal.aborted) {
        taskProcessingStream.emit({ stage: 'queued', taskId: id })
        processTasksQueue.push(id)
      }
    }
    const { allTasksFinished, taskIsProcessing, taskFinishedProcessing, getTasksInProgress } =
      workerLoggingHelper(streamEmit)

    const addTaskChain = createAddTaskChain(taskManager, queueTask, streamEmit, setTaskFinished)

    // this is uses to track how long a list of tasks has been processing
    let taskFinishedWaitingCount = 0

    const handleError = createHandleError(stop, taskManager, streamEmit, currentTaskCtrl, queueTask)

    const run = async () => {
      console.log('starting task worker run...')
      while (!currentTaskCtrl.signal.aborted) {
        let task: TaskNode | null = null
        if (getTasksInProgress() <= 0) {
          streamEmit({ stage: 'waiting' })
        }
        const taskId = await processTasksQueue.pop(currentTaskCtrl.signal)
        // make sure we know from outside that the worker is active...
        taskIsProcessing(taskId)
        // signal to the outside world that we are processing a task
        streamEmit({ stage: 'processing', task })
        task = await taskManager.getTask(taskId)
        if (task && !currentTaskCtrl.signal.aborted) {
          // check if the previous task was finished. only of all prior tasks are finished
          // we can continue processing this task...
          if (task.priorID && !(await isTaskFinished(task.priorID))) {
            streamEmit({ stage: 'subtasks', task, taskId: task.id })
            // we need to wait until all subtasks from its previous tasks are finished before
            // continuing with this task so we simply push this task back onto the stack
            queueTask(task.id)
            // if this is the only task in the queue, we need to wait a little bit in order
            // to not overwhelm the browser (This will likely never be the case, but just in case)
            if (taskFinishedWaitingCount >= 5 || processTasksQueue.count() <= 1) {
              console.log('sleep-waiting for task to finish')
              await sleep(500)
              taskFinishedWaitingCount = 0
            } else {
              taskFinishedWaitingCount += 1
            }
            continue
          }

          // we don't need to process tasks which aren't a function...
          // we also don'tasksInProgresst need to push them back in the queue...
          // we also don't need to add the task as the "last" task in the GUI
          // because they will automatically be called as soon as the
          if (task.content.type !== 'functioncall') {
            continue
          }

          // TODO: try to get rid of all the llmSettings functionality here..   this should only be relevant for chatCompletion which
          //       is now a tool! :)
          if (!llmSettings.selectedApi) throw new TaskProcessingError('No AI API selected!!')
          const selectedModel = getApiConfigCopy(
            llmSettings,
            llmSettings.selectedApi,
          )?.selectedModel
          try {
            const funcR = await safeExecuteTask(
              task,
              taskManager,
              currentTaskCtrl.signal,
              // TODO: replace "allowedTools" with "available Tools" in processTask...
              llmSettings.allowedTools || [],
            )

            // We check the result of the task here to see whether it contains
            // a lists of tasks. If thats the case we return
            // those for continuation, otherwise
            // we create a generic task result.
            const newTasks = parseResultForTaskChains(
              funcR,
              selectedModel,
              llmSettings.allowedTools || [],
              llmSettings.enableOpenAiTools,
            )

            streamEmit({ stage: 'processed', task })

            const taskChainAdder = addTaskChain(task)
            const chainHasFinishedStatus = await Promise.all(newTasks.map(taskChainAdder))
            // if all subtasks in this chain are finished, we can set this task as finished
            // TODO: we can potentially track the number of subtasks that are left here...
            if (chainHasFinishedStatus.every((status) => status === 0)) {
              setTaskFinished(task.id)
            }
          } catch (error) {
            void handleError(error, task, selectedModel, {
              maxAutonomousTasks: llmSettings.maxAutonomousTasks,
              enableOpenAiTools: llmSettings.enableOpenAiTools,
              allowedTools: llmSettings.allowedTools || [],
            })

            // TODO: run this taskWorker in a separate worker js/browser thread!
          } finally {
            console.log('finished processing task...')
          }
          taskFinishedProcessing(task.id)
          console.log('entering next loop...')
        }
      }
      allTasksFinished()
    }

    return {
      run,
      queueTask,
      currentTaskCtrl,
    }
  }

  // create all variables that we want to access from outside
  const taskProcessingStream = createStream<TyTaskStreamData>()
  let currentTaskCtrl: AbortController | undefined = new AbortController()
  let queueTask: ((id: string) => void) | undefined = undefined

  const stop = (message: string) => {
    console.log('→ taskworker stop requested', message)
    currentTaskCtrl?.abort(message)
    // in case of any errors, especially if its an interrupt event we simply want to cancel everything :P
    // empty our task queue :)
    taskProcessingStream.emit({ stage: 'aborted' })
  }

  const externalQueueTask = (id: string) => {
    if (currentTaskCtrl?.signal.aborted || !queueTask) {
      const {
        run,
        queueTask: newQueueTask,
        currentTaskCtrl: newTaskCtrl,
      } = setupRun(taskProcessingStream.emit, stop)
      currentTaskCtrl = newTaskCtrl
      queueTask = newQueueTask
      console.log('restarting task worker run...')

      void run()
    }
    queueTask(id)
  }
  return {
    workerStream: taskProcessingStream.stream,
    workerStop: stop,
    queueTask: externalQueueTask,
  }
}

// TODO: move all the "debugging" stuff away nd make use of the debugging DB that we're getting ;)
function createErrorTaskChain(
  error: unknown,
  task: TaskNode | null,
  analyzeErrorModel: string | undefined,
  llmTools: boolean,
  allowedTools: string[],
  debugDb: CrudWrapper<TaskNodeMeta>,
) {
  if (!analyzeErrorModel) throw new TaskProcessingError('No Model selected for Error analysis!!')

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
