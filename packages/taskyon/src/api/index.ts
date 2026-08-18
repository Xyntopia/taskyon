// TODO: we want to reduce dependencies to this file here!
// TODO: maybe move the "Api" into its own package?
import { createMarkdownTaskChain } from '../core/markdownTaskIO'
import { createToolExecutionClient, type ToolRpcCallerPort } from '../core/toolRpc'
import type { ChatCompletionArgs } from '../tools/chatCompletionTool'
import type { FileAttachment, TaskContentType, TaskNode } from '../types/taskNode'
import { partialTaskDraft } from '../types/taskNode'
import {
  createClientTool,
  createSubtasksResult,
  createTool,
  InternalTool,
  taskResult,
  toolCall,
} from '../types/toolApi'
import { createPortClient, createStream, type Port } from '@taskyon/common/modules/frpBus'
import { createLruCache } from '@taskyon/common/modules/lruCache'
import type { RpcMessagePort } from '@taskyon/common/modules/frpBus'
import {
  taskyonHostProtocol,
  taskyonProtocol,
  taskyonRuntimeProtocol,
  type TaskyonMessageType,
} from './taskyonProtocol'

export { TaskyonMessage, type TaskyonMessageType, type TyP2P } from './taskyonProtocol'
export {
  TaskyonGuiMessage,
  taskyonGuiProtocol,
  type guiMessageTypes,
  type partialTyConfiguration,
} from '../types/guiApiTypes'
export { REMOTE_FUNCTION_TIMEOUT_MS } from './taskyonProtocol'
export { createMarkdownTaskChain } from '../core/markdownTaskIO'
export {
  getToolchainProviderProfiles,
  llmSettings,
  resolveToolchainConfig,
  resolveToolchainProvider,
  updateToolchainConfigValue,
  ToolchainProfiles,
  TyToolchainConfig,
} from '../types/profiles'
export type { ClientTool, ClientToolContext, toolContext } from '../types/toolApi'
export type { FileAttachment, TaskNode } from '../types/taskNode'
export { FunctionArguments } from '../types/tools'
export type { FunctionCall, ToolBase } from '../types/tools'
export { sha256UrlSafeHashFromFile } from '../utils/encoding'
export {
  createDuplexChannel, // utils/frpbus
  createStreamRpcRequest,
  createPortClient,
  createProtocolPort,
  createPortServer,
} from '@taskyon/common/modules/frpBus'
export type {
  PortRpcClientOptions,
  ProtocolServerHandlers,
  ProtocolClientForPort,
  RpcMessagePort,
  RpcResponseResult,
  UnaryPortRpcDefinition,
  ProtocolClient,
  ProtocolMessage,
} from '@taskyon/common/modules/frpBus'

export {
  createClientTool,
  createSubtasksResult,
  createTool,
  InternalTool,
  partialTaskDraft,
  taskResult,
  toolCall,
}
export type { Port }
export { taskyonHostProtocol, taskyonProtocol, taskyonRuntimeProtocol }
export { createTaskyonApiDescription, type TaskyonApiDescription } from './taskyonOpenApi'
export {
  createProtocolStorageCrudWrapper,
  createProtocolStorageBlobBackend,
  createStorageClient,
  getLogicalStorageNamespace,
  createStorageProtocolServer,
  createStorageRecordBackend,
  taskyonStorageProtocol,
  type StorageBlobBackend,
  type StorageBlobMetadata,
  type StorageAccessMode,
  type StorageAccessRequest,
  type StorageBackendProvider,
  type StorageClientOptions,
  type StorageDistribution,
  type StorageRecordBackend,
  type StorageRecordCodec,
  type StorageRecordCrud,
  type TaskyonStorageMessage,
  type TaskyonStorageClient,
} from './storageProtocol'
export {
  mergeStorageRecord,
  storageQueryMatches,
  storageValueContentHash,
} from './storageRecordOperations'
export {
  createPgLiteStorageBlobBackend,
  createPgLiteStorageRecordBackend,
} from './pgliteStorageBackend'
export {
  createStorageRecordFileBackend,
  parseStorageRecordFile,
  storageRecordFilePath,
  storageRecordNamespacePath,
  type StorageRecordFileAdapter,
} from './storageRecordFileBackend'
export {
  createLoggingClient,
  createLoggingProtocolServer,
  taskyonLoggingProtocol,
  type TaskyonLogEntry,
  type TaskyonLoggingMessage,
  type TaskyonLogSink,
} from './loggingProtocol'
export {
  createPgLiteSearchIndexBackend,
  createSearchClient,
  createSearchProtocolServer,
  SearchIndexDocument,
  taskyonSearchProtocol,
  type SearchIndexBackend,
  type TaskyonSearchMessage,
} from './searchProtocol'
export {
  callToolOverRpc,
  createToolExecutionClient,
  createExternalToolContext,
  createToolRpcFunctionDescriptionMessage,
  registerToolRpcExecutor,
  registerToolRpcTools,
} from '../core/toolRpc'
export type {
  ToolExecutionCallOptions,
  ToolRpcCallerPort,
  ToolRpcCreateContext,
  ToolRpcFunctionCallMessage,
  ToolRpcFunctionDescriptionMessage,
  ToolRpcFunctionProgressMessage,
  ToolRpcFunctionResponseMessage,
  ToolRpcResponderMessage,
  ToolRpcResponderPort,
} from '../core/toolRpc'

export type ObserveSubTaskStreamDetailedResult =
  | {
      status: 'matched'
      result: TaskNode
      observedTasks: TaskNode[]
      stopTask: TaskNode
    }
  | {
      status: 'timeout'
      result: undefined
      observedTasks: TaskNode[]
      timeoutMs?: number
    }
  | {
      status: 'aborted'
      result: undefined
      observedTasks: TaskNode[]
    }
  | {
      status: 'error'
      result: undefined
      observedTasks: TaskNode[]
      error: Error
      errorTask: TaskNode
    }

export type ProcessTasksDetailedResult = ObserveSubTaskStreamDetailedResult & {
  initialIds: string[]
}

export type ProcessTasksInterruptHook = (
  reason: string,
  result: ObserveSubTaskStreamDetailedResult,
) => void | Promise<void>

export type processTasksOpts = {
  timeoutMs?: number
  signal?: AbortSignal
  display?: 'activeChat' | 'background'
  show?: boolean
  throwOnError?: boolean
  interruptOnSettle?: ProcessTasksInterruptHook
}

type TaskSubStream = (cb: (task: TaskNode) => void) => () => void
type TaskNodeWithParent = TaskNode & { parentID: string }
type SendTasksResult = {
  initialIds: string[]
  subTaskStream: TaskSubStream
}
type SendTasksFunction = (
  taskList: partialTaskDraft[][],
  opts: processTasksOpts,
) => Promise<SendTasksResult>
type RunTasksFunction = (
  taskList: partialTaskDraft[][],
  quitCondition: ((t: TaskNode) => boolean) | TaskContentType | TaskContentType[],
  opts: processTasksOpts,
) => Promise<TaskNode>
type TaskyonClientReadyOptions = {
  readinessTimeoutMs?: number
}
type TaskyonClientOptions = {
  taskCacheSize?: number
  deferUntilReady?: boolean | TaskyonClientReadyOptions
}

const isTaskCreatedMessage = (
  message: unknown,
): message is Extract<TaskyonMessageType, { type: 'taskCreated' }> & { task: TaskNode } => {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'taskCreated' &&
    'task' in message &&
    !!message.task &&
    typeof message.task === 'object' &&
    'id' in message.task &&
    typeof message.task.id === 'string'
  )
}

const isChildTaskCreatedMessage = (
  message: unknown,
): message is Extract<TaskyonMessageType, { type: 'taskCreated' }> & {
  task: TaskNodeWithParent
} =>
  isTaskCreatedMessage(message) &&
  'parentID' in message.task &&
  typeof message.task.parentID === 'string'

const isTaskyonReadyMessage = (
  message: unknown,
): message is Extract<TaskyonMessageType, { type: 'taskyonReady' }> => {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'taskyonReady'
  )
}

const appendPendingTask = (
  pendingByParentId: Map<string, TaskNodeWithParent[]>,
  task: TaskNodeWithParent,
) => {
  const pendingTasks = pendingByParentId.get(task.parentID) ?? []
  pendingTasks.push(task)
  pendingByParentId.set(task.parentID, pendingTasks)
}

const createSubTaskStream = <T extends { type: string }>(
  receive: Port<unknown, T | TaskyonMessageType>['receive'],
  initialIds: string[],
): TaskSubStream => {
  const trackedIds = new Set(initialIds)
  const pendingByParentId = new Map<string, TaskNodeWithParent[]>()
  const subTaskBus = createStream<TaskNode>()

  const emitTaskAndFlush = (task: TaskNodeWithParent) => {
    if (trackedIds.has(task.id)) return
    trackedIds.add(task.id)
    subTaskBus.emit(task)
    const pendingChildren = pendingByParentId.get(task.id) ?? []
    pendingByParentId.delete(task.id)
    pendingChildren.forEach(emitTaskAndFlush)
  }

  receive((message) => {
    if (!isChildTaskCreatedMessage(message)) return
    if (trackedIds.has(message.task.parentID)) {
      emitTaskAndFlush(message.task)
      return
    }
    appendPendingTask(pendingByParentId, message.task)
  })

  return subTaskBus.stream
}

export const createChatCompletionTask = (args: ChatCompletionArgs) =>
  toolCall<ChatCompletionArgs>({ name: 'chatCompletion', arguments: args })

const READY_EVENT_GRACE_MS = 250
const READY_PING_ATTEMPT_MS = 250

const uploadFile = async (addFile: (args: { file: File }) => Promise<FileAttachment>, file: File) =>
  await addFile({ file })

const pingUntilReady = async (
  ping: (args: { timeoutMs?: number; signal?: AbortSignal }) => Promise<unknown>,
  deadline: number,
  signal: AbortSignal,
) => {
  let lastError: unknown

  do {
    try {
      await ping({
        timeoutMs: Math.min(READY_PING_ATTEMPT_MS, Math.max(1, deadline - Date.now())),
        signal,
      })
      return
    } catch (error) {
      if (signal.aborted) throw error
      lastError = error
    }
  } while (Date.now() < deadline)

  throw lastError instanceof Error ? lastError : new Error('Taskyon readiness timed out')
}

const waitForTaskyonReady = async <Rx extends { type: string }>(
  tyPort: Port<unknown, Rx>,
  ping: (args: { timeoutMs?: number; signal?: AbortSignal }) => Promise<unknown>,
  opts: { readinessTimeoutMs?: number; signal?: AbortSignal } = {},
) => {
  const timeoutMs = opts.readinessTimeoutMs ?? 5_000
  const deadline = Date.now() + timeoutMs
  const readyEvents = tyPort.receive.narrow(
    (message): message is Extract<Rx, { type: 'taskyonReady' }> => isTaskyonReadyMessage(message),
  )

  try {
    const waitOptions = {
      timeoutMs: Math.min(READY_EVENT_GRACE_MS, timeoutMs),
      ...(opts.signal ? { signal: opts.signal } : {}),
    }
    await readyEvents.wait(waitOptions)
    return
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error
  }

  const remainingMs = Math.max(1, deadline - Date.now())
  const fallbackController = new AbortController()
  const abortFallback = () => fallbackController.abort(opts.signal?.reason)
  opts.signal?.addEventListener('abort', abortFallback, { once: true })
  try {
    await Promise.race([
      readyEvents.wait({ timeoutMs: remainingMs, signal: fallbackController.signal }),
      pingUntilReady(ping, deadline, fallbackController.signal),
    ])
  } finally {
    fallbackController.abort()
    opts.signal?.removeEventListener('abort', abortFallback)
  }
}

const createAbortError = () => {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

const waitForReadyOrAbort = async (pendingReady: Promise<void>, signal?: AbortSignal) => {
  if (!signal) {
    await pendingReady
    return
  }

  if (signal.aborted) throw createAbortError()

  await new Promise<void>((resolve, reject) => {
    const abort = () => reject(createAbortError())
    signal.addEventListener('abort', abort, { once: true })
    pendingReady.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

const createReadinessGate = <Rx extends { type: string }>(
  tyPort: Port<unknown, Rx>,
  ping: (args: { timeoutMs?: number; signal?: AbortSignal }) => Promise<unknown>,
  options: boolean | TaskyonClientReadyOptions | undefined,
) => {
  const deferUntilReady = options !== false
  const readyOptions = typeof options === 'object' ? options : {}
  let ready = false
  let pendingReady: Promise<void> | undefined

  tyPort.receive((message) => {
    if (isTaskyonReadyMessage(message)) ready = true
  })

  const waitUntilReady = async (
    opts: TaskyonClientReadyOptions & { signal?: AbortSignal } = {},
  ) => {
    if (ready) return
    await waitForTaskyonReady(tyPort, ping, opts)
    ready = true
  }

  const waitBeforeCommand = async (signal?: AbortSignal) => {
    if (!deferUntilReady || ready) return
    pendingReady ??= waitUntilReady(readyOptions).catch((error: unknown) => {
      pendingReady = undefined
      throw error
    })

    await waitForReadyOrAbort(pendingReady, signal)
  }

  return {
    waitUntilReady,
    waitBeforeCommand,
  }
}

/**
 * Creates a typed Taskyon client over an existing protocol and tool-RPC port.
 *
 * The client exposes nested protocol services plus task execution, file upload, readiness, and
 * direct tool-call helpers.
 */
export const createTaskyonClient = <Tx extends { type: string }, Rx extends { type: string }>(
  tyPort: Port<Tx, Rx> & RpcMessagePort<TaskyonMessageType, Rx> & ToolRpcCallerPort,
  options: TaskyonClientOptions = {},
) => {
  const rawProtocolClient = createPortClient(tyPort, taskyonProtocol)
  const readinessGate = createReadinessGate(
    tyPort,
    rawProtocolClient.peer.ping,
    options.deferUntilReady,
  )
  const protocolClient = createPortClient(tyPort, taskyonProtocol, {
    beforeRequest: ({ args }) => readinessGate.waitBeforeCommand(args.signal),
    skipBeforeRequestFor: ['peer.ping'],
  })
  const toolExecutionClient = createToolExecutionClient(tyPort)
  const send: SendTasksFunction = async (taskList, opts) => {
    const tasks = taskList.flat()
    const show = opts.show ?? opts.display !== 'background'

    const created = await protocolClient.task.createChain({
      tasks,
      execute: true,
      show,
    })

    const initialIds = created.ids
    const subTaskStream = createSubTaskStream(tyPort.receive, initialIds)

    return { initialIds, subTaskStream }
  }
  const taskCache =
    options.taskCacheSize && options.taskCacheSize > 0
      ? createLruCache<string, TaskNode>(options.taskCacheSize)
      : undefined

  if (taskCache) {
    tyPort.receive((msg) => {
      if (isTaskCreatedMessage(msg)) taskCache.set(msg.task.id, msg.task)
    })
  }
  const taskClient = {
    ...protocolClient.task,
    onCreated: (handler: (task: TaskNode) => void) =>
      tyPort.receive((message) => {
        if (isTaskCreatedMessage(message)) handler(message.task)
      }),
    get: async (args: Parameters<typeof protocolClient.task.get>[0]) => {
      const cachedTask = taskCache?.get(args.id)
      if (cachedTask) return cachedTask
      const task = await protocolClient.task.get(args)
      if (task) taskCache?.set(task.id, task)
      return task
    },
  }

  return {
    ...protocolClient,
    task: taskClient,
    waitUntilReady: (opts?: { readinessTimeoutMs?: number; signal?: AbortSignal }) =>
      readinessGate.waitUntilReady(opts),
    runTasks: createRunTasks(send),
    sendFiles: async (files: File[]) =>
      await Promise.all(files.map((file) => uploadFile(protocolClient.files.add, file))),
    callTool: async (
      name: Parameters<typeof toolExecutionClient.callTool>[0],
      args: Parameters<typeof toolExecutionClient.callTool>[1],
      callOptions?: Parameters<typeof toolExecutionClient.callTool>[2],
    ) => {
      await readinessGate.waitBeforeCommand(callOptions?.signal)
      return await toolExecutionClient.callTool(name, args, callOptions)
    },
  }
}

export type TaskyonClient = ReturnType<typeof createTaskyonClient>

/**
 * Parses Taskyon Markdown, stores the resulting chain, and returns its leaf task ID.
 */
export const createTaskChainFromMarkdown = async (
  client: Pick<TaskyonClient, 'task'>,
  markdown?: string,
  options: { execute?: boolean; show?: boolean } = {},
) => {
  const tasks = await createMarkdownTaskChain(markdown)
  const leafId = tasks.at(-1)?.id
  if (!leafId) return undefined
  const created = await client.task.createChain({
    tasks,
    execute: options.execute ?? false,
    show: options.show ?? true,
  })
  return created.ids.at(-1) ?? leafId
}

const createRunTasksSender = <T extends { type: string }>(
  tyPort: Port<T | TaskyonMessageType>,
): SendTasksFunction => {
  const protocolClient = createPortClient(tyPort, taskyonProtocol)
  return async (taskList, opts) => {
    const tasks = taskList.flat()
    const show = opts.show ?? opts.display !== 'background'

    const created = await protocolClient.task.createChain({
      tasks,
      execute: true,
      show,
    })

    const initialIds = created.ids
    const subTaskStream = createSubTaskStream(tyPort.receive, initialIds)

    return { initialIds, subTaskStream }
  }
}

export const observeSubTaskStreamDetailed = async (
  subTaskStream: TaskSubStream,
  quitCondition: ((t: TaskNode) => boolean) | TaskContentType | TaskContentType[],
  opts: processTasksOpts,
): Promise<ObserveSubTaskStreamDetailedResult> => {
  const expectsError =
    quitCondition === 'error' || (Array.isArray(quitCondition) && quitCondition.includes('error'))
  const throwOnError = opts.throwOnError !== false && !expectsError
  const matchesQuitCondition =
    typeof quitCondition === 'string'
      ? (task: TaskNode) => task.content.type === quitCondition
      : typeof quitCondition === 'object' && Array.isArray(quitCondition)
        ? (task: TaskNode) => quitCondition.includes(task.content.type)
        : quitCondition

  const observedTasks: TaskNode[] = []
  const withObservedTasks = (error: Error) => {
    return new Error(error.message, {
      cause: {
        originalCause: error.cause,
        observedTasks,
      },
    })
  }

  return await new Promise<ObserveSubTaskStreamDetailedResult>((resolve) => {
    if (opts.signal?.aborted) {
      resolve({
        status: 'aborted',
        result: undefined,
        observedTasks,
      })
      return
    }

    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const cleanup = (unsub: () => void, onAbort: () => void) => {
      unsub()
      clearTimeout(timeout)
      opts.signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      if (settled) return
      settled = true
      cleanup(unsub, onAbort)
      resolve({
        status: 'aborted',
        result: undefined,
        observedTasks,
      })
    }

    const unsub = subTaskStream((task) => {
      if (settled) return
      observedTasks.push(task)

      if (throwOnError && task.content.type === 'error') {
        settled = true
        cleanup(unsub, onAbort)
        resolve({
          status: 'error',
          result: undefined,
          observedTasks,
          error: withObservedTasks(
            new Error(`Task processing failed on task ${task.id}`, { cause: task.content.data }),
          ),
          errorTask: task,
        })
        return
      }

      if (matchesQuitCondition(task)) {
        settled = true
        cleanup(unsub, onAbort)
        resolve({
          status: 'matched',
          result: task,
          observedTasks,
          stopTask: task,
        })
      }
    })

    if (opts.timeoutMs) {
      timeout = setTimeout(() => {
        if (settled) return
        settled = true
        cleanup(unsub, onAbort)
        resolve(
          opts.timeoutMs === undefined
            ? {
                status: 'timeout',
                result: undefined,
                observedTasks,
              }
            : {
                status: 'timeout',
                result: undefined,
                observedTasks,
                timeoutMs: opts.timeoutMs,
              },
        )
      }, opts.timeoutMs)
    }

    opts.signal?.addEventListener('abort', onAbort)
  })
}

const createInterruptReason = (result: ObserveSubTaskStreamDetailedResult) => {
  if (result.status === 'matched') {
    return `runTasks settled after matching ${result.result.content.type} task ${result.result.id}`
  }
  if (result.status === 'error') {
    return `runTasks settled after error task ${result.errorTask.id}`
  }
  if (result.status === 'timeout') {
    return `runTasks timed out after ${result.timeoutMs ?? 0}ms`
  }
  return 'runTasks aborted'
}

export const observeSubTaskStream = async (
  subTaskStream: TaskSubStream,
  quitCondition: ((t: TaskNode) => boolean) | TaskContentType | TaskContentType[],
  opts: processTasksOpts,
) => {
  const result = await observeSubTaskStreamDetailed(subTaskStream, quitCondition, opts)
  if (result.status === 'matched') {
    return { result: result.result, observedTasks: result.observedTasks }
  }

  if (result.status === 'error') {
    throw result.error
  }

  const error =
    result.status === 'aborted'
      ? new Error('Aborted')
      : new Error(`Timeout after ${result.timeoutMs ?? 0}ms`)

  if (result.status === 'aborted') {
    error.name = 'AbortError'
  }

  throw new Error(error.message, {
    cause: {
      status: result.status,
      observedTasks: result.observedTasks,
    },
  })
}

// we make the opts mandatory on purpose so that people think about
// some sort of quit condition.
/**
 * Creates a task runner that reports matched, timeout, aborted, and error settlement states.
 */
export const processTasksDetailed = <T extends { type: string }>(
  tyPort: Port<T | TaskyonMessageType>,
) => {
  const send = createRunTasksSender(tyPort)
  return async (
    taskList: partialTaskDraft[][],
    quitCondition: ((t: TaskNode) => boolean) | TaskContentType | TaskContentType[],
    opts: processTasksOpts,
  ) => {
    const { subTaskStream, initialIds } = await send(taskList, opts)
    const result = await observeSubTaskStreamDetailed(subTaskStream, quitCondition, opts)
    if (opts.interruptOnSettle) {
      await opts.interruptOnSettle(createInterruptReason(result), result)
    }
    return { ...result, initialIds }
  }
}

const createRunTasks = (send: SendTasksFunction): RunTasksFunction => {
  return async (
    taskList: partialTaskDraft[][],
    quitCondition: ((t: TaskNode) => boolean) | TaskContentType | TaskContentType[],
    opts: processTasksOpts,
  ) => {
    const { subTaskStream } = await send(taskList, opts)
    const result = await observeSubTaskStreamDetailed(subTaskStream, quitCondition, opts)
    if (opts.interruptOnSettle) {
      await opts.interruptOnSettle(createInterruptReason(result), result)
    }
    if (result.status === 'matched') {
      return result.result
    }
    if (result.status === 'error') {
      throw result.error
    }
    if (result.status === 'aborted') {
      const error = new Error('Aborted')
      error.name = 'AbortError'
      throw error
    }
    throw new Error(`Timeout after ${result.timeoutMs ?? 0}ms`)
  }
}

/**
 * Creates a task runner that returns the matching task and throws for all non-matching settlements.
 */
export const runTasks = <T extends { type: string }>(tyPort: Port<T | TaskyonMessageType>) =>
  createRunTasks(createRunTasksSender(tyPort))
