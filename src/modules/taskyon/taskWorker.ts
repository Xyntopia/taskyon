import type { TaskNodeMeta, TyTaskStreamData } from './types'
import { type partialTaskDraft, type TaskNode, type llmSettings, getApiConfigCopy } from './types'
import { type TyTaskManager } from './taskManager'
import { handleFunctionExecution, taskResult } from './tools'
import { createAsyncQueue, sleep } from '../utils'
import { createChatCompletionTask } from '../tools/chatCompletionTool'
import type { CrudWrapper } from '../crudWrapper'
import { createStream } from '../frpBus'
import { sha256UrlSafeHash } from '../crypto_webcrypto'

// TODO: how about we put this here into its own tool as well!
//       its totally possible now... Would probably make the code cleaner...
async function safeExecuteTask(
  task: TaskNode,
  taskManager: TyTaskManager,
  stopSignal: AbortSignal,
): Promise<unknown> {
  if (task.content.type === 'functioncall') {
    // calculate function result
    const func = task.content.data
    console.log(`Calling function ${func.name}`)
    const { tool, def } = await taskManager.getToolDefinition(func.name)
    if (tool && !stopSignal.aborted) {
      // TODO: define a maximum size of the taskChain e.g. last 100 tasks or something like that...
      const taskChain = await taskManager.getTaskChain(task.id)
      const toolId = def?.id ?? tool.name + (await sha256UrlSafeHash(tool.code))
      const funcR = await handleFunctionExecution(func, tool, stopSignal, {
        taskChain,
        getSecret: async (name) => {
          console.log('get secret name', name)
          const secr = await taskManager.secretStore.getSecret(toolId, name)
          return secr ?? undefined
        },
        setSecret: async (name, value) => {
          console.log('set secret name', name)
          await taskManager.secretStore.setSecret(toolId, name, value)
        },
        stopSignal,
        // if w are dealing with a tool definition use that id. otherwise generate an id on the fly )
        toolId,
      })

      return funcR
    } else {
      throw new Error(
        !stopSignal.aborted
          ? `The function '${func.name}' is not available in tools. Please select a valid toolname. You can use
          the toolSearcher to search for valid names.`
          : 'The function execution was cancelled by taskyon',
      )
    }
  } else {
    throw new Error(
      `Task with id ${task.id} is not a functioncall task, but of type ${task.content.type}. This should not happen!`,
    )
  }
}

function parseResultForTaskChains(
  funcR: unknown,
  analyzeModel: string | undefined,
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
      throw new Error('We need to select a model in order to analyze the result of our task!!')

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
    if (!task) throw new Error('Task not found!')
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

function workerLoggingHelper(streamEmit: (value: TyTaskStreamData) => void) {
  let tasksInProgress = new Set<string>()
  const taskisInLoop = (taskId: string) => {
    tasksInProgress.add(taskId)
    streamEmit({ stage: 'in loop', taskId, info: tasksInProgress.size.toString() })
  }
  const allTasksFinished = () => {
    // this means that all tasks are finished and we can emit a final message
    tasksInProgress = new Set<string>()
    streamEmit({ stage: 'all finished' })
  }
  const taskOutOfLoop = (taskId: string) => {
    tasksInProgress.delete(taskId)
    streamEmit({
      stage: 'processed',
      taskId,
      info: `Tasks in queue: ${tasksInProgress.size.toString()}`,
    })
    if (tasksInProgress.size === 0) allTasksFinished()
  }
  return {
    allTasksFinished,
    taskisInLoop,
    taskOutOfLoop,
    getTasksInProgress: () => tasksInProgress.size,
  }
}

function createHandleError(
  stopAllTasks: (message: string) => void,
  taskManager: TyTaskManager,
  currentTaskCtrl: AbortController,
  queueTask: (id: string) => void,
) {
  console.log('create error handler function...')
  let errorCount = 0

  return async (
    error: unknown,
    task: TaskNode,
    selectedModel: string | undefined,
    maxAutonomousTasks: number,
    enableOpenAiTools: boolean,
  ) => {
    errorCount += 1
    if (errorCount >= maxAutonomousTasks) {
      // TODO: somehow put this into an error tasknode...
      // TODO: also add any taskWorkerController interrupt in an error tasknode..
      stopAllTasks(`Too many errors occured, interrupting execution after ${errorCount} errors!`)
    }

    const errorTaskChain = createErrorTaskChain(
      error,
      task,
      selectedModel,
      enableOpenAiTools,
      taskManager.debugDb,
    )

    // we are adding the error task chain as a subtaskchain with the parentID of this
    // particular task.
    const errorTaskId = (await taskManager.addTaskChain(errorTaskChain, undefined, task.id)).at(
      -1,
    )?.id

    // interrupt execution if interrupted flag is shown!
    // this makes sure that results are still saved, even if we stop any
    // further execution
    if (!currentTaskCtrl.signal.aborted && errorTaskId) {
      // we need processTasksQueue as an argument here!!!
      queueTask(errorTaskId)
    }
  }
}

const createTaskProcessor = (
  taskManager: TyTaskManager,
  streamEmit: (value: TyTaskStreamData) => void,
  queueTask: (id: string) => void,
  currentTaskCtrl: AbortController,
  taskisInLoop: (taskId: string) => void,
  taskOutOfLoop: (taskId: string) => void,
  stopAllTasks: (message: string) => void,
) => {
  // this is uses to track how long a list of tasks has been processing
  const handleError = createHandleError(stopAllTasks, taskManager, currentTaskCtrl, queueTask)
  const { isTaskFinished, setTaskFinished } = createTaskTracker(taskManager)

  return async (taskId: string, llmSettings: llmSettings) => {
    const task = await taskManager.getTask(taskId)
    if (task && !currentTaskCtrl.signal.aborted) {
      // make sure we know from outside that the worker is active...
      taskisInLoop(taskId)

      // check if the previous task was finished. only of all prior tasks are finished
      // we can continue processing this task...
      if (task.priorID && !(await isTaskFinished(task.priorID))) {
        streamEmit({ stage: 'subtasks', task, taskId: task.id })
        // we need to wait until all subtasks from its previous tasks are finished before
        // continuing with this task so we simply push this task back onto the stack
        console.log('sleep-waiting for task to finish', task.id)
        await sleep(500)
        queueTask(task.id)
        // we don't add an "out-of-loop" here, because we are still processing this task
        return // early return, because this task is not ready yet
      }

      // we don't need to process tasks which aren't a function...
      // we also don'tasksInProgresst need to push them back in the queue...
      // we also don't need to add the task as the "last" task in the GUI
      // because they will automatically be called as soon as the
      if (task.content.type !== 'functioncall') {
        taskOutOfLoop(task.id)
        return // early return, because this task is not a functioncall task
      }

      // signal to the outside world that we are processing a task
      // this signals to the GUI that this task is activly being processes.
      // this is for example important to signal which stream should be displayed and
      // which task to choose as the "leaf" of a chain.
      streamEmit({ stage: 'processing', task })

      // TODO: try to get rid of all the llmSettings functionality here..   this should only be relevant for chatCompletion which
      //       is now a tool! :)
      if (!llmSettings.selectedApi) throw new Error('No AI API selected!!')
      const selectedModel = getApiConfigCopy(llmSettings, llmSettings.selectedApi)?.selectedModel
      let newTasks: TaskNode[][] = []
      try {
        const funcR = await safeExecuteTask(task, taskManager, currentTaskCtrl.signal)

        // We check the result of the task here to see whether it contains
        // a lists of tasks. If thats the case we return
        // those for continuation, otherwise
        // we create a generic task result.
        const partialTasks = parseResultForTaskChains(
          funcR,
          selectedModel,
          llmSettings.enableOpenAiTools,
        )

        // we can immediatly persist all of our tasks here to the taskManager, as
        // they're immutable and won't change anymore..
        newTasks = await Promise.all(
          partialTasks.map((taskChain) => taskManager.addTaskChain(taskChain, undefined, task.id)),
        )

        // if all subtasks in this chain are finished (means
        // there are no functions tasks in it), we can set this task as finished
        const chainHasFunctionTasks = newTasks.map((taskList: TaskNode[]) => {
          // set finishedTask as completed
          //  - if all subtaskChains don't contain any functioncall task
          const hasFunctionTasks = taskList.some((t) => t.content.type === 'functioncall')
          const lastTask = taskList.at(-1)

          if (lastTask && !hasFunctionTasks) {
            // we can set the leaf of this chain as finished
            // if it doesn't contain any functioncall tasks
            // this is not strictly necessary, but it helps to speed up
            // the search for unfinished tasks
            setTaskFinished(lastTask.id)
          }

          // queue all tasks...  our taskWorker will automatically
          // sort out all non-function tasks
          taskList.forEach((t) => {
            queueTask(t.id)
          })

          return hasFunctionTasks
        })
        // if no function tasks are int eh result, we can set this task as finished as well..
        if (chainHasFunctionTasks.every((status) => status === false)) {
          setTaskFinished(task.id)
        }
      } catch (error) {
        streamEmit({ stage: 'error', taskId: task.id, info: formatReadableError(error) })
        await handleError(
          error,
          task,
          selectedModel,
          llmSettings.maxAutonomousTasks,
          llmSettings.enableOpenAiTools,
        )
        // TODO: run this taskWorker in a separate worker js/browser thread!
      }
      taskOutOfLoop(task.id)
      if (currentTaskCtrl.signal.aborted) {
        // if the task was aborted, we want to make sure, that we can see the leaf task.
        // usually, this would automatically happen in the taskWorker loop, because
        // all tasks are queued. But here, this won't work.
        // TODO: should we also add function tasks here? or only non-function tasks?
        streamEmit({
          stage: 'aborted',
          task: newTasks.at(-1)?.at(-1),
          info: currentTaskCtrl.signal.reason,
        })
      }
    }
    return task
  }
}

const setupRun = (
  streamEmit: (value: TyTaskStreamData) => void,
  stopAllTasks: (message: string) => void,
  llmSettings: llmSettings,
  taskManager: TyTaskManager,
) => {
  console.log('setting up task worker run...')
  const currentTaskCtrl: AbortController = new AbortController()

  const processTasksQueue = createAsyncQueue<string>()
  const queueTask = (id: string) => {
    if (!currentTaskCtrl.signal.aborted) {
      streamEmit({ stage: 'queued', taskId: id })
      processTasksQueue.push(id)
    }
  }
  const { allTasksFinished, taskisInLoop, taskOutOfLoop, getTasksInProgress } =
    workerLoggingHelper(streamEmit)

  const asyncProcessTask = createTaskProcessor(
    taskManager,
    streamEmit,
    queueTask,
    currentTaskCtrl,
    taskisInLoop,
    taskOutOfLoop,
    stopAllTasks,
  )

  const run = async () => {
    console.log('starting task worker run...')
    while (!currentTaskCtrl.signal.aborted) {
      if (getTasksInProgress() <= 0) {
        streamEmit({ stage: 'waiting' })
      }
      let taskId: string
      try {
        taskId = await processTasksQueue.pop(currentTaskCtrl.signal)
      } catch {
        streamEmit({ stage: 'aborted' })
        break
      }
      void asyncProcessTask(taskId, llmSettings)
    }
    processTasksQueue.clear()
    allTasksFinished()
    streamEmit({ stage: 'all finished' })
  }

  return {
    run,
    queueTask,
    currentTaskCtrl,
  }
}

export function runTaskWorker(llmSettings: llmSettings, taskManager: TyTaskManager) {
  console.log('starting task worker listener...')

  // create all variables that we want to access from outside
  const taskProcessingStream = createStream<TyTaskStreamData>()
  let currentTaskCtrl: AbortController | undefined = new AbortController()
  let queueTask: ((id: string) => void) | undefined = undefined

  const stopAllTasks = (message: string) => {
    console.log('→ taskworker stop requested', message)
    currentTaskCtrl?.abort(message)
    // in case of any errors, especially if its an interrupt event we simply want to cancel everything :P
    // empty our task queue :)
    // TODO:  not sure, if we need this here, becaise we are already giving the "currentTaskCtrl" a rason
    // which gets streamed at a later stage...
    taskProcessingStream.emit({ stage: 'aborted', info: message })
  }

  // we have put all our dependencies in re-startable workers.
  // if anyone calls the "workerStop" the function wil simply re-start the worker
  // as soon as a new task was added....
  const externalQueueTask = (id: string) => {
    if (currentTaskCtrl?.signal.aborted || !queueTask) {
      const {
        run,
        queueTask: newQueueTask,
        currentTaskCtrl: newTaskCtrl,
      } = setupRun(taskProcessingStream.emit, stopAllTasks, llmSettings, taskManager)
      currentTaskCtrl = newTaskCtrl
      queueTask = newQueueTask
      console.log('restarting task worker run...')

      void run()
    }
    queueTask(id)
  }
  return {
    workerStream: taskProcessingStream.stream,
    workerStop: stopAllTasks,
    queueTask: externalQueueTask,
  }
}

function formatReadableError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)

  let current: unknown = err
  while (current instanceof Error && current.cause) {
    current = current.cause
  }
  return current instanceof Error ? current.message : String(current)
}

function createErrorTaskChain(
  error: unknown,
  task: TaskNode | null,
  analyzeErrorModel: string | undefined,
  llmTools: boolean,
  debugDb: CrudWrapper<TaskNodeMeta>,
) {
  const humanMsg = formatReadableError(error)

  const errorTask: partialTaskDraft = {
    role: 'system',
    content: {
      type: 'error',
      data: humanMsg,
    },
  }

  const debugInfo = { error }

  if (error instanceof Error && task) {
    // preserve full debug info
    debugInfo.error = {
      message: error.message,
      stack: error.stack,
      cause: error.cause,
    }
  }

  if (task?.id) {
    void debugDb.upsert(task.id, debugInfo, 'shallow_merge')
  }

  return [
    errorTask,
    ...(analyzeErrorModel
      ? [
          createChatCompletionTask({
            model: analyzeErrorModel,
            goal: 'AnalyzeError',
            llmTools,
          }),
        ]
      : []),
  ]
}
