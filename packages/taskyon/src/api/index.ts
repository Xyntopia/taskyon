// TODO: we want to reduce dependencies to this file here!
// TODO: maybe move the "Api" into its own package?
import { forgeTaskChain } from '../core/createTasks'
import { createToolExecutionClient, type ToolRpcCallerPort } from '../core/toolRpc'
import type { chatCompletionParams } from '../tools/chatCompletionTool'
import type { TaskyonMessage as TaskyonMessageType } from '../types/apiTypes'
import type { TaskContentType, TaskNode } from '../types/taskNode'
import { partialTaskDraft } from '../types/taskNode'
import { createClientTool, createSubtasksResult, createTool, toolCall } from '../types/toolApi'
import { sha256UrlSafeHashFromFile } from '../utils/encoding'
import { createPortClient, createStream, type Port } from '@taskyon/shared/modules/frpBus'
import { createLruCache } from '@taskyon/shared/modules/lruCache'
import type {
  ProtocolClientForPort,
  ProtocolMessage,
  RpcMessagePort,
  UnaryPortRpcDefinition,
} from '@taskyon/shared/modules/frpBus'
import { taskyonProtocol } from './taskyonProtocol'
import type { z } from 'zod'

export { BaseMessage, TaskyonMessage, TyP2P } from '../types/apiTypes'
export {
  TaskyonGuiMessage,
  taskyonGuiProtocol,
  type guiMessageTypes,
  type partialTyConfiguration,
} from '../types/guiApiTypes'
export { REMOTE_FUNCTION_TIMEOUT_MS } from './taskyonProtocol'
export { llmSettings, TyToolchainConfig } from '../types/profiles'
export type { ClientTool, ClientToolContext, toolContext } from '../types/toolApi'
export { FunctionArguments } from '../types/tools'
export type { FunctionCall, ToolBase } from '../types/tools'
export { sha256UrlSafeHashFromFile } from '../utils/encoding'
export {
  createDuplexChannel, // utils/frpbus
  createStreamRpcRequest,
  createPortClient,
  createProtocolPort,
  createPortServer,
  MessageChannelBridge,
} from '@taskyon/shared/modules/frpBus'
export type {
  PortRpcClientOptions,
  ProtocolServerHandlers,
  ProtocolClientForPort,
  RpcMessagePort,
  RpcResponseResult,
  UnaryPortRpcDefinition,
  ProtocolClient,
  ProtocolMessage,
} from '@taskyon/shared/modules/frpBus'

export { createClientTool, createSubtasksResult, createTool, partialTaskDraft, toolCall }
export type { Port }
export { taskyonProtocol }
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
  ToolRpcFunctionResponseMessage,
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
type TaskyonClientOptions = {
  taskCacheSize?: number
}

const isTaskCreatedMessage = (
  message: unknown,
): message is Extract<TaskyonMessageType, { type: 'taskCreated' }> & {
  task: TaskNodeWithParent
} => {
  return (
    typeof message === 'object' &&
    message !== null &&
    'type' in message &&
    message.type === 'taskCreated' &&
    'task' in message &&
    !!message.task &&
    typeof message.task === 'object' &&
    'id' in message.task &&
    'parentID' in message.task &&
    typeof message.task.id === 'string' &&
    typeof message.task.parentID === 'string'
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
    if (!isTaskCreatedMessage(message)) return
    if (trackedIds.has(message.task.parentID)) {
      emitTaskAndFlush(message.task)
      return
    }
    appendPendingTask(pendingByParentId, message.task)
  })

  return subTaskBus.stream
}

export const createChatCompletionTask = (args: chatCompletionParams) =>
  toolCall<chatCompletionParams>({ name: 'chatCompletion', arguments: args })

type TaskyonProtocol = typeof taskyonProtocol
type TaskyonCommandName = keyof TaskyonProtocol['commands']

type TaskyonCommandParts<TName extends TaskyonCommandName> =
  TaskyonProtocol['commands'][TName] extends UnaryPortRpcDefinition<
    infer TRequest,
    infer TResponse,
    infer TArgs,
    infer TResult,
    infer TRequestSchema,
    infer TResponseSchema
  >
    ? {
        request: TRequest
        response: TResponse
        args: TArgs
        result: TResult
        requestSchema: TRequestSchema
        responseSchema: TResponseSchema
      }
    : never

type TaskyonCommandRequest<TName extends TaskyonCommandName> = TaskyonCommandParts<TName>['request']

type TaskyonCommandResponse<TName extends TaskyonCommandName> =
  TaskyonCommandParts<TName>['response']

type TaskyonProtocolMessage = ProtocolMessage<TaskyonProtocol>
type TaskCreatedMessage = z.output<TaskyonProtocol['streams']['taskUpdates']['taskCreated']>
type SendTasksTx = TaskyonCommandRequest<'createTaskChain'>
type SendTasksRx = TaskyonCommandResponse<'createTaskChain'> | TaskCreatedMessage
type TaskyonClientPort<
  Tx extends { type: string },
  Rx extends { type: string },
> = TaskyonProtocolMessage extends Tx
  ? TaskyonProtocolMessage extends Rx
    ? Port<Tx, Rx> & RpcMessagePort<TaskyonProtocolMessage, Rx> & ToolRpcCallerPort
    : never
  : never
type CreateTaskChain = ProtocolClientForPort<
  TaskyonProtocol,
  TaskyonProtocolMessage,
  TaskyonProtocolMessage
>['createTaskChain']
type AddFile = ProtocolClientForPort<
  TaskyonProtocol,
  TaskyonProtocolMessage,
  TaskyonProtocolMessage
>['addFile']

const createSendTasks = <Rx extends { type: string }>(
  tyPort: Port<unknown, Rx>,
  createTaskChain: CreateTaskChain,
): SendTasksFunction => {
  return async (taskList, opts) => {
    const tasks = await forgeTaskChain(taskList)

    await createTaskChain({
      tasks: tasks,
      execute: true,
      show: opts.show ?? true, // we want to show this task in our GUI as a succesful test
    })

    const initialIds = tasks.map((t) => t.id)
    const subTaskStream = createSubTaskStream(tyPort.receive, initialIds)

    return { initialIds, subTaskStream }
  }
}

const uploadFile = async (addFile: AddFile, file: File) => {
  const id = await sha256UrlSafeHashFromFile(file)
  await addFile({
    id,
    name: file.name,
    mime: file.type,
    size: file.size,
    file,
  })
  return id
}

export const createTaskyonClient = <Tx extends { type: string }, Rx extends { type: string }>(
  tyPort: TaskyonClientPort<Tx, Rx>,
  options: TaskyonClientOptions = {},
) => {
  const protocolClient = createPortClient(tyPort, taskyonProtocol)
  const toolExecutionClient = createToolExecutionClient(tyPort)
  const send = createSendTasks(tyPort, protocolClient.createTaskChain)
  const taskCache =
    options.taskCacheSize && options.taskCacheSize > 0
      ? createLruCache<string, TaskNode>(options.taskCacheSize)
      : undefined

  if (taskCache) {
    tyPort.receive((msg) => {
      if (isTaskCreatedMessage(msg)) taskCache.set(msg.task.id, msg.task)
    })
  }

  return {
    ...protocolClient,
    getTask: async (taskId: string) => {
      const cachedTask = taskCache?.get(taskId)
      if (cachedTask) return cachedTask
      const task = await protocolClient.getTask({ id: taskId })
      if (task) taskCache?.set(task.id, task)
      return task
    },
    runTasks: createRunTasks(send),
    sendFile: (file: File) => uploadFile(protocolClient.addFile, file),
    callTool: toolExecutionClient.callTool,
  }
}

export type TaskyonClient = ReturnType<typeof createTaskyonClient>

const createRunTasksSender = <Tx extends { type: string }, Rx extends { type: string }>(
  tyPort: Port<Tx | SendTasksTx, Rx | SendTasksRx>,
) =>
  createSendTasks(
    tyPort,
    createPortClient<SendTasksTx, Rx | SendTasksRx, TaskyonProtocol>(tyPort, taskyonProtocol)
      .createTaskChain,
  )

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

export const runTasks = <T extends { type: string }>(tyPort: Port<T | TaskyonMessageType>) =>
  createRunTasks(createRunTasksSender(tyPort))
