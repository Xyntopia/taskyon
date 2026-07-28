import type { TaskNode, partialTaskDraft } from '../types/taskNode'
import { taskResult, type ToolProgress } from '../types/toolApi'
import { createAsyncQueue, sleep } from '../utils/asyncUtils'
import { humanizeError, serializeError } from '../utils/error'
import type { Port, RpcMessagePort } from '@taskyon/common/modules/frpBus'
import { createDuplexChannel, createStream } from '@taskyon/common/modules/frpBus'
import { serializeForJson } from '../utils/objHelpers'
import { type TyTaskManager } from './taskManager'
import { MAX_REMOTE_FUNCTION_TIMEOUT_MS } from '../api/taskyonProtocol'
import type { ToolRpcCallMessage, ToolRpcResponderMessage } from './toolRpc'
import { createToolExecutionClient } from './toolRpc'
import { createLruCache } from '@taskyon/common/modules/lruCache'
import {
  countAutonomousErrorAttempt,
  createAutonomousErrorSignature,
  detectRepeatedToolCall,
  MAX_AUTONOMOUS_RECOVERY_ATTEMPTS_PER_SIGNATURE,
} from './taskWorkerErrors'

export interface TyTaskStreamData {
  info?: string
  task?: TaskNode | null | undefined
  taskId?: string | null | undefined
  toolName?: string
  progress?: ToolProgress
  stage:
    | 'in loop' // task is put it the loop in order to check if it has subtasks
    | 'processing' // means, the task enters the loop of processing
    | 'processed' // task processing returned, but child task chains may still be running
    | 'finished' // task processing returned and all child task chains are finished
    | 'error'
    | 'waiting'
    | 'subtasks'
    | 'all processed'
    | 'aborted'
    | 'queued'
    | 'tool progress'
}

type FunctionRpcWorkerPort = RpcMessagePort<ToolRpcCallMessage>
export type TaskWorkerToolRpcPort = Port<ToolRpcResponderMessage, ToolRpcCallMessage>
type ToolExecutionClient = ReturnType<typeof createToolExecutionClient>
const FINISHED_TASK_CACHE_SIZE = 50_000

function createFinishedTaskCache(maxSize: number) {
  const cache = createLruCache<string, true>(maxSize)
  return {
    has: (taskId: string) => cache.has(taskId),
    markFinished: (taskId: string) => cache.set(taskId, true),
  }
}

async function safeExecuteTask(
  task: TaskNode,
  toolExecutionClient: ToolExecutionClient,
  stopSignal: AbortSignal,
  streamEmit: (value: TyTaskStreamData) => void,
): Promise<unknown> {
  if (task.content.type === 'functioncall') {
    // calculate function result
    const func = task.content.data
    return await toolExecutionClient.callTool(func.name, func.arguments, {
      taskId: task.id,
      signal: stopSignal,
      requestIdPrefix: `${func.name}-${task.id}`,
      defaultTimeoutMs: MAX_REMOTE_FUNCTION_TIMEOUT_MS,
      onProgress: (progress) =>
        streamEmit({
          stage: 'tool progress',
          taskId: task.id,
          toolName: func.name,
          info: progress.message,
          progress,
        }),
    })
  } else {
    throw new Error(
      `Task with id ${task.id} is not a functioncall task, but of type ${task.content.type}. This should not happen!`,
    )
  }
}

function parseResultForTaskChains(funcR: unknown) {
  if (taskResult.safeParse(funcR).success) {
    // we have to do this funny workaround with typescript because
    // for some reason zod will delete the task content onwards
    // of the second task in a taskchain... after parsing. so we're
    // simply using the original...
    const newTasks = (funcR as taskResult).taskChainList
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

  // TODO: speed up isTaskFinished by tracking unfinished child-chain counts per parent.
  //       The worker now propagates semantic "finished" events upward for scheduling,
  //       but completion checks still recompute child leaves through the task manager.

  // TODO: this positive-only cache assumes new child chains are not added after a task
  //       was marked finished. P2P/editable task-tree workflows may need invalidation
  //       or task-version-aware completion caching.
  const isFinishedCache = createFinishedTaskCache(FINISHED_TASK_CACHE_SIZE)

  async function isTaskFinishedCached(taskId: string): Promise<boolean> {
    if (isFinishedCache.has(taskId)) {
      return true
    } else {
      const isFinished = await isTaskFinished(taskId)
      if (isFinished) {
        isFinishedCache.markFinished(taskId)
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

      // now iteratively check again starting from each leaf task, if they're finished...
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

  // this function recursively checks if a task is finished
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
    setTaskFinished: (id: string) => {
      isFinishedCache.markFinished(id)
    },
  }
}

function workerLoggingHelper(streamEmit: (value: TyTaskStreamData) => void) {
  let tasksInProgress = new Set<string>()
  const taskisInLoop = (taskId: string) => {
    tasksInProgress.add(taskId)
    streamEmit({ stage: 'in loop', taskId, info: tasksInProgress.size.toString() })
  }
  const taskOutOfLoop = (taskId: string, toolName?: string) => {
    tasksInProgress.delete(taskId)
    streamEmit({
      stage: 'processed',
      taskId,
      info: `${toolName ? toolName + ', ' : ''}queue: ${tasksInProgress.size.toString()}`,
    })
  }
  return {
    taskisInLoop,
    taskOutOfLoop,
    getTasksInProgress: () => tasksInProgress.size,
    clearTasksInProgress: () => {
      tasksInProgress = new Set<string>()
    },
  }
}

const isUnrecoverableAutonomousError = (error: unknown) => {
  const signature = createAutonomousErrorSignature(error)
  if (signature.length === 0) return false

  return [
    'define an api key',
    'missing api key',
    'no api key',
    'api key is required',
    'unauthorized',
    'forbidden',
    'authentication failed',
    'invalid api key',
    'autonomous tool-call loop detected',
  ].some((pattern) => signature.includes(pattern))
}

const countEquivalentAutonomousErrors = (taskChain: TaskNode[], signature: string) => {
  if (signature.length === 0) return 0
  return taskChain.filter((task) => {
    if (task.content.type !== 'error') return false
    return createAutonomousErrorSignature(task.content.data) === signature
  }).length
}

type AutonomousErrorHandlingDecision =
  | {
      mode: 'stop'
      reason: string
      summary: string
    }
  | {
      mode: 'retry'
    }

const resolveAutonomousErrorHandlingDecision = (
  task: TaskNode,
  taskChain: TaskNode[],
  error: unknown,
  runAttemptCount: number,
): AutonomousErrorHandlingDecision => {
  const signature = createAutonomousErrorSignature(error)
  const equivalentErrors = countEquivalentAutonomousErrors(taskChain, signature)
  const toolName =
    task.content.type === 'functioncall' ? task.content.data.name : `t/${task.content.type}`

  if (isUnrecoverableAutonomousError(error)) {
    return {
      mode: 'stop',
      reason: `Stopping autonomous recovery after unrecoverable ${toolName} error`,
      summary: `Unrecoverable ${toolName} error prevented autonomous retry`,
    }
  }

  if (
    equivalentErrors + 1 >= MAX_AUTONOMOUS_RECOVERY_ATTEMPTS_PER_SIGNATURE ||
    runAttemptCount >= MAX_AUTONOMOUS_RECOVERY_ATTEMPTS_PER_SIGNATURE
  ) {
    return {
      mode: 'stop',
      reason: `Stopping autonomous recovery after ${MAX_AUTONOMOUS_RECOVERY_ATTEMPTS_PER_SIGNATURE} equivalent ${toolName} errors`,
      summary: `Repeated equivalent ${toolName} errors tripped the autonomous circuit breaker`,
    }
  }

  return { mode: 'retry' }
}

function createHandleError(
  taskManager: TyTaskManager,
  currentTaskCtrl: AbortController,
  queueTask: (id: string) => void,
) {
  const autonomousErrorAttemptsBySignature = new Map<string, number>()

  return async (error: unknown, task: TaskNode, errorhandlerTask: partialTaskDraft) => {
    const debugInfo = createDebugInfoFromError(error)
    void taskManager.metaUpsert(task.id, debugInfo, 'shallow_merge')
    const taskChain = await taskManager.getTaskChain(task.id)
    const runAttemptCount = countAutonomousErrorAttempt(
      autonomousErrorAttemptsBySignature,
      task,
      error,
    )
    const errorHandlingDecision = resolveAutonomousErrorHandlingDecision(
      task,
      taskChain,
      error,
      runAttemptCount,
    )

    // we are adding the error task chain as a subtaskchain with the parentID of this
    // particular task.
    const errorTaskId = (
      await taskManager.addTaskChain(
        errorHandlingDecision.mode === 'retry'
          ? [
              {
                role: 'system',
                content: {
                  type: 'error',
                  data: serializeForJson(error),
                },
              },
              errorhandlerTask,
            ]
          : [
              {
                role: 'system',
                content: {
                  type: 'error',
                  data: serializeForJson(error),
                },
              },
            ],
        undefined,
        task.id,
      )
    ).at(-1)?.id // get lasttask id so that we can query it for execution!

    // interrupt execution if interrupted flag is shown!
    // this makes sure that results are still saved, even if we stop any
    // further execution
    if (!currentTaskCtrl.signal.aborted && errorTaskId) {
      void taskManager.metaUpsert(
        errorTaskId,
        {
          error: debugInfo.error,
          summary:
            errorHandlingDecision.mode === 'retry'
              ? `Error originated in task ${task.id}`
              : errorHandlingDecision.summary,
        },
        'shallow_merge',
      )
      if (errorHandlingDecision.mode === 'retry') {
        // we need processTasksQueue as an argument here!!!
        queueTask(errorTaskId)
      } else {
        console.warn(errorHandlingDecision.reason, {
          taskId: task.id,
          errorTaskId,
        })
      }
    }
  }
}

const createTaskProcessor = (
  taskManager: TyTaskManager,
  streamEmit: (value: TyTaskStreamData) => void,
  queueTask: (id: string) => void,
  currentTaskCtrl: AbortController,
  taskisInLoop: (taskId: string) => void,
  taskOutOfLoop: (taskId: string, toolName?: string) => void,
  toolExecutionClient: ToolExecutionClient,
  repeatedCallDetectionIgnoredToolNames: ReadonlySet<string>,
  markTaskFinished: (taskId: string) => void,
) => {
  // this is uses to track how long a list of tasks has been processing
  const handleError = createHandleError(taskManager, currentTaskCtrl, queueTask)

  return async (
    taskId: string,
    defaultTask: partialTaskDraft,
    errorHandlerTask: partialTaskDraft,
  ) => {
    const task = await taskManager.getTask(taskId)
    if (task && !currentTaskCtrl.signal.aborted) {
      // make sure we know from outside that the worker is active...
      taskisInLoop(taskId)

      // we don't need to process tasks which aren't a function...
      // we also don't need tasksInProgress to push them back in the queue...
      // we also don't need to add the task as the "last" task in the GUI
      // because they will automatically be called as soon as the
      if (task.content.type !== 'functioncall') {
        taskOutOfLoop(task.id, 't/' + task.content.type)
        return // early return, because this task is not a functioncall task
      }

      // signal to the outside world that we are processing a task
      // this signals to the GUI that this task is actively being processes.
      // this is for example important to signal which stream should be displayed and
      // which task to choose as the "leaf" of a chain.
      streamEmit({ stage: 'processing', task })

      let newTasks: TaskNode[][] = []
      try {
        const executionTaskChain = await taskManager.getTaskChain(task.id, 1e9, {
          method: 'lineage',
          includeSubtaskResults: 'none',
        })
        const repeatedCall = detectRepeatedToolCall(
          executionTaskChain,
          repeatedCallDetectionIgnoredToolNames,
        )
        if (repeatedCall) {
          throw new Error(
            `Autonomous tool-call loop detected: ${repeatedCall.toolName} was requested ${repeatedCall.count} consecutive times with identical arguments.`,
          )
        }

        // TODO: define a maximum size of the taskChain e.g. last 100 tasks or something like that...
        const funcR = await safeExecuteTask(
          task,
          toolExecutionClient,
          currentTaskCtrl.signal,
          streamEmit,
        )

        // We check the result of the task here to see whether it contains
        // a lists of tasks. If thats the case we return
        // those for continuation, otherwise
        // we create a generic task result.
        // TODO: maybe remove "defaultTask" from here and put it into our entrynode in some sort of way?
        const partialTasks = parseResultForTaskChains(funcR) ?? [
          [
            {
              role: 'system',
              content: { type: 'toolresult', data: funcR },
            },
            defaultTask,
          ],
        ]

        // we can immediately persist all of our tasks here to the taskManager, as
        // they're immutable and won't change anymore..
        newTasks = await Promise.all(
          partialTasks.map((taskChain) => taskManager.addTaskChain(taskChain, undefined, task.id)),
        )
        // If this tool emitted error tasks, copy error debug metadata from the source task
        // so error nodes can be inspected directly in the debug panel.
        const createdErrorTasks = newTasks
          .flat()
          .filter((createdTask) => createdTask.content.type === 'error')
        if (createdErrorTasks.length > 0) {
          void (async () => {
            let sourceErrorMeta: unknown
            for (let i = 0; i < 5; i += 1) {
              const sourceMeta = await taskManager.getMeta(task.id)
              if (sourceMeta?.error !== undefined) {
                sourceErrorMeta = sourceMeta.error
                break
              }
              await sleep(50)
            }

            await Promise.all(
              createdErrorTasks.map(async (errorTask) => {
                const fallbackDebug =
                  sourceErrorMeta !== undefined
                    ? sourceErrorMeta
                    : {
                        humanized: humanizeError(errorTask.content.data),
                        serialized: serializeForJson(errorTask.content.data),
                      }
                return taskManager.metaUpsert(
                  errorTask.id,
                  {
                    error: fallbackDebug,
                    summary: `Error originated in task ${task.id}`,
                  },
                  'shallow_merge',
                )
              }),
            )
          })()
        }

        newTasks.flat().forEach((createdTask) => queueTask(createdTask.id))
        if (newTasks.every((taskChain) => taskChain.length === 0)) {
          markTaskFinished(task.id)
        }
      } catch (error) {
        if (currentTaskCtrl.signal.aborted) {
          streamEmit({
            stage: 'aborted',
            task,
            taskId: task.id,
            info: currentTaskCtrl.signal.reason,
          })
          taskOutOfLoop(task.id, task.content.data.name)
          return task
        }
        streamEmit({ stage: 'error', taskId: task.id, info: humanizeError(error) })
        console.error('Error processing task:', error, task)
        await handleError(error, task, errorHandlerTask)
        // TODO: run this taskWorker in a separate worker js/browser thread!
      }
      taskOutOfLoop(task.id, task.content.data.name)
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
  taskManager: TyTaskManager,
  rpcPort: FunctionRpcWorkerPort,
  maxConcurrency: number,
  repeatedCallDetectionIgnoredToolNames: ReadonlySet<string>,
) => {
  const currentTaskCtrl: AbortController = new AbortController()
  const toolExecutionClient = createToolExecutionClient(rpcPort)

  const readyQueue = createAsyncQueue<string>()
  const pendingByPrior = new Map<string, Set<string>>()
  const activeTaskIds = new Set<string>()
  const routingTasks = new Set<Promise<void>>()
  const reconciliationTasks = new Set<Promise<void>>()
  const taskTracker = createTaskTracker(taskManager)
  let routingTaskCount = 0
  let didEmitAllProcessed = false

  const normalizedMaxConcurrency = Math.max(1, Math.floor(maxConcurrency))
  const hasPendingWork = () =>
    readyQueue.count() > 0 ||
    pendingByPrior.size > 0 ||
    routingTaskCount > 0 ||
    activeTaskIds.size > 0

  const emitAllProcessedIfIdle = () => {
    if (hasPendingWork()) {
      didEmitAllProcessed = false
      return
    }
    if (didEmitAllProcessed) return
    didEmitAllProcessed = true
    streamEmit({ stage: 'all processed' })
  }

  const enqueueReadyTask = (id: string) => {
    if (currentTaskCtrl.signal.aborted) return
    streamEmit({ stage: 'queued', taskId: id })
    readyQueue.push(id)
  }

  const waitForPriorTask = (task: TaskNode) => {
    const priorID = task.priorID
    if (!priorID) return
    const waitingTasks = pendingByPrior.get(priorID) ?? new Set<string>()
    waitingTasks.add(task.id)
    pendingByPrior.set(priorID, waitingTasks)
    streamEmit({ stage: 'waiting', taskId: task.id, info: `prior: ${priorID}` })
  }

  const queueTask = (id: string) => {
    if (currentTaskCtrl.signal.aborted) return

    didEmitAllProcessed = false
    routingTaskCount += 1
    const routingTask = (async () => {
      let wasRouted = false
      try {
        const task = await taskManager.getTask(id)
        if (!task || currentTaskCtrl.signal.aborted) return
        if (task.priorID && !(await taskTracker.isTaskFinished(task.priorID))) {
          waitForPriorTask(task)
        } else {
          enqueueReadyTask(task.id)
        }
        wasRouted = true
      } catch (error) {
        streamEmit({ stage: 'error', taskId: id, info: humanizeError(error) })
      } finally {
        routingTaskCount -= 1
        if (!wasRouted) emitAllProcessedIfIdle()
      }
    })()
    routingTasks.add(routingTask)
    void routingTask.then(
      () => routingTasks.delete(routingTask),
      () => routingTasks.delete(routingTask),
    )
  }
  const { taskisInLoop, taskOutOfLoop, getTasksInProgress, clearTasksInProgress } =
    workerLoggingHelper(streamEmit)

  const asyncProcessTask = createTaskProcessor(
    taskManager,
    streamEmit,
    queueTask,
    currentTaskCtrl,
    taskisInLoop,
    taskOutOfLoop,
    toolExecutionClient,
    repeatedCallDetectionIgnoredToolNames,
    taskTracker.setTaskFinished,
  )

  const releaseTasksWaitingFor = (taskId: string) => {
    const waitingTasks = pendingByPrior.get(taskId)
    if (!waitingTasks) return

    pendingByPrior.delete(taskId)
    waitingTasks.forEach((waitingTaskId) => {
      enqueueReadyTask(waitingTaskId)
    })
  }

  const markFinishedAndRelease = async (taskId: string) => {
    const visited = new Set<string>()
    let currentTaskId: string | undefined = taskId

    while (currentTaskId && !visited.has(currentTaskId)) {
      visited.add(currentTaskId)
      if (!(await taskTracker.isTaskFinished(currentTaskId))) return

      taskTracker.setTaskFinished(currentTaskId)
      streamEmit({ stage: 'finished', taskId: currentTaskId })
      releaseTasksWaitingFor(currentTaskId)

      const currentTask = await taskManager.getTask(currentTaskId)
      currentTaskId = currentTask?.parentID
    }
  }

  const reconcilePendingTasks = async () => {
    const pendingPriorIds = Array.from(pendingByPrior.keys())
    await Promise.all(
      pendingPriorIds.map(async (priorID) => {
        if (await taskTracker.isTaskFinished(priorID)) {
          taskTracker.setTaskFinished(priorID)
          streamEmit({ stage: 'finished', taskId: priorID })
          releaseTasksWaitingFor(priorID)
        }
      }),
    )
  }

  const runWorkerLoop = async (defaultTask: partialTaskDraft, errorTask: partialTaskDraft) => {
    while (!currentTaskCtrl.signal.aborted) {
      let taskId: string
      try {
        taskId = await readyQueue.pop(currentTaskCtrl.signal)
      } catch {
        break
      }

      activeTaskIds.add(taskId)
      try {
        await asyncProcessTask(taskId, defaultTask, errorTask)
        await markFinishedAndRelease(taskId)
      } finally {
        activeTaskIds.delete(taskId)
        emitAllProcessedIfIdle()
      }
    }
  }

  const run = async (defaultTask: partialTaskDraft, errorTask: partialTaskDraft) => {
    const reconciliationInterval = setInterval(() => {
      if (getTasksInProgress() <= 0 && readyQueue.count() === 0 && pendingByPrior.size > 0) {
        streamEmit({ stage: 'waiting' })
      }
      const reconciliationTask = reconcilePendingTasks().finally(() => emitAllProcessedIfIdle())
      reconciliationTasks.add(reconciliationTask)
      void reconciliationTask.then(
        () => reconciliationTasks.delete(reconciliationTask),
        () => reconciliationTasks.delete(reconciliationTask),
      )
    }, 1000)

    try {
      await Promise.all(
        Array.from({ length: normalizedMaxConcurrency }, () =>
          runWorkerLoop(defaultTask, errorTask),
        ),
      )
    } finally {
      clearInterval(reconciliationInterval)
    }
    await Promise.allSettled([...routingTasks, ...reconciliationTasks])
    readyQueue.clear()
    pendingByPrior.clear()
    activeTaskIds.clear()
    routingTaskCount = 0
    clearTasksInProgress()
    streamEmit({ stage: 'all processed' })
  }

  return {
    run,
    queueTask,
    currentTaskCtrl,
  }
}

function createDebugInfoFromError(error: unknown) {
  const humanized = humanizeError(error)
  const serialized = serializeError(error)

  return {
    error: {
      humanized,
      serialized,
      ...(error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
            cause: serializeError(error.cause),
          }
        : {}),
    },
  }
}

export function runTaskWorker(
  taskManager: TyTaskManager,
  defaultTask: partialTaskDraft,
  errorTask: partialTaskDraft,
  maxConcurrency = 4,
  repeatedCallDetectionIgnoredToolNames: ReadonlySet<string> = new Set([
    'chatCompletion',
    'entryNode',
  ]),
) {
  // create all variables that we want to access from outside
  const taskProcessingStream = createStream<TyTaskStreamData>()
  const { x: workerRpcPort, y: toolRpcPort } = createDuplexChannel<
    ToolRpcCallMessage,
    ToolRpcResponderMessage
  >()
  let currentTaskCtrl: AbortController | undefined = new AbortController()
  let queueTask: ((id: string) => void) | undefined = undefined
  const activeRuns = new Set<Promise<void>>()

  const cancelCurrentRun = (message: string) => {
    currentTaskCtrl?.abort(message)
    // in case of any errors, especially if its an interrupt event we simply want to cancel everything :P
    // empty our task queue :)
    // TODO:  not sure, if we need this here, because we are already giving the "currentTaskCtrl" a reason
    // which gets streamed at a later stage...
    taskProcessingStream.emit({ stage: 'aborted', info: message })
  }

  // we have put all our dependencies in restartable workers.
  // If the current run is cancelled, the worker starts a new run when another task is queued.
  // as soon as a new task was added....
  const externalQueueTask = (id: string) => {
    if (currentTaskCtrl?.signal.aborted || !queueTask) {
      const {
        run,
        queueTask: newQueueTask,
        currentTaskCtrl: newTaskCtrl,
      } = setupRun(
        taskProcessingStream.emit,
        taskManager,
        workerRpcPort,
        maxConcurrency,
        repeatedCallDetectionIgnoredToolNames,
      )
      currentTaskCtrl = newTaskCtrl
      queueTask = newQueueTask

      const workerRun = run(defaultTask, errorTask)
      activeRuns.add(workerRun)
      void workerRun.then(
        () => activeRuns.delete(workerRun),
        (error) => {
          activeRuns.delete(workerRun)
          taskProcessingStream.emit({ stage: 'error', info: humanizeError(error) })
        },
      )
    }
    queueTask(id)
  }
  return {
    workerStream: taskProcessingStream.stream,
    toolRpcPort,
    cancelCurrentRun,
    workerSettled: async () => {
      await Promise.allSettled(activeRuns)
    },
    queueTask: externalQueueTask,
  }
}
