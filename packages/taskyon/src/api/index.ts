// TODO: we want to reduce dependencies to this file here!
// TODO: maybe move the "Api" into its own package?
import { forgeTaskChain } from '../core/createTasks'
import type { chatCompletionParams } from '../tools/chatCompletionTool'
import type { TaskyonMessage as TaskyonMessageType } from '../types/apiTypes'
import type { TaskContentType, TaskNode } from '../types/taskNode'
import { partialTaskDraft } from '../types/taskNode'
import { createClientTool, createSubtasksResult, createTool, toolCall } from '../types/toolApi'
import { createStream, type Port } from '@taskyon/shared/modules/frpBus'
import { taskyonProtocol } from './taskyonProtocol'

export { BaseMessage, sendFile, TaskyonMessage, TyP2P } from '../types/apiTypes'
export {
  TaskyonGuiMessage,
  type guiMessageTypes,
  type partialTyConfiguration,
} from '../types/guiApiTypes'
export { REMOTE_FUNCTION_TIMEOUT_MS } from '../types/messages'
export { llmSettings, TyToolchainConfig } from '../types/profiles'
export type { ClientTool, ClientToolContext, toolContext } from '../types/toolApi'
export { FunctionArguments } from '../types/tools'
export type { FunctionCall, ToolBase } from '../types/tools'
export {
  createDuplexChannel, // utils/frpbus
  createStreamRpcRequest,
  createPortRpcClient,
  registerPortRpcHandler,
  createPortApi, // utis/frpbus
  MessageChannelBridge,
} from '@taskyon/shared/modules/frpBus'
export type {
  PortRpcClientOptions,
  RpcMessagePort,
  RpcResponseResult,
  UnaryPortRpcDefinition,
} from '@taskyon/shared/modules/frpBus'

export { createClientTool, createSubtasksResult, createTool, partialTaskDraft, toolCall }
export type { Port }
export { taskyonProtocol }
export {
  callToolOverRpc,
  createExternalToolContext,
  createToolRpcFunctionDescriptionMessage,
  registerToolRpcExecutor,
  registerToolRpcTools,
} from '../core/toolRpc'
export type {
  ToolRpcCreateContext,
  ToolRpcCallerPort,
  ToolRpcFunctionDescriptionMessage,
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

const isTaskCreatedMessage = (
  message: { type: string } | TaskyonMessageType,
): message is Extract<TaskyonMessageType, { type: 'taskCreated' }> & {
  task: TaskNodeWithParent
} => {
  return (
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
  receive: Port<T | TaskyonMessageType>['receive'],
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

const currentOrigin = () =>
  typeof globalThis.location?.origin === 'string' ? globalThis.location.origin : 'taskyon-node'

export const createChatCompletionTask = (args: chatCompletionParams) =>
  toolCall<chatCompletionParams>({ name: 'chatCompletion', arguments: args })

export const sendTasks =
  <T extends { type: string }>(tyPort: Port<T | TaskyonMessageType>) =>
  async (taskList: partialTaskDraft[][], opts: processTasksOpts) => {
    const tasks = await forgeTaskChain(taskList)

    tyPort.send({
      type: 'tasks',
      tasks: tasks,
      execute: true,
      show: opts.show ?? true, // we want to show this task in our GUI as a succesful test
      origin: currentOrigin(),
    })

    const initialIds = tasks.map((t) => t.id)
    const subTaskStream = createSubTaskStream(tyPort.receive, initialIds)

    return { initialIds, subTaskStream }
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
    return `processTasks settled after matching ${result.result.content.type} task ${result.result.id}`
  }
  if (result.status === 'error') {
    return `processTasks settled after error task ${result.errorTask.id}`
  }
  if (result.status === 'timeout') {
    return `processTasks timed out after ${result.timeoutMs ?? 0}ms`
  }
  return 'processTasks aborted'
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
  const send = sendTasks<T>(tyPort)
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

export const processTasks = <T extends { type: string }>(tyPort: Port<T | TaskyonMessageType>) => {
  const processDetailed = processTasksDetailed(tyPort)
  return async (
    taskList: partialTaskDraft[][],
    quitCondition: ((t: TaskNode) => boolean) | TaskContentType | TaskContentType[],
    opts: processTasksOpts,
  ) => {
    const result = await processDetailed(taskList, quitCondition, opts)
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
