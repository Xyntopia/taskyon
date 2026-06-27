import type { RpcMessagePort } from '@taskyon/shared/modules/frpBus'
import { createStreamRpcRequest } from '@taskyon/shared/modules/frpBus'
import type { ReadonlyDeep } from 'type-fest'
import {
  MAX_REMOTE_FUNCTION_TIMEOUT_MS,
  REMOTE_FUNCTION_TIMEOUT_MS,
  RemoteFunctionCall,
  RemoteFunctionCancel,
  RemoteFunctionResponse,
} from '../types/messages'
import { createSubtasksResult, type InternalTool, type toolContext } from '../types/toolApi'
import type { FunctionArguments, FunctionCall } from '../types/tools'
import { executeToolInWorkerSandbox } from '../utils/executeToolInWorkerSandbox'
import { humanizeError, serializeError } from '../utils/error'
import { bigIntToString } from '../utils/objHelpers'

export type ToolRpcCallMessage = RemoteFunctionCall | RemoteFunctionCancel
export type ToolRpcCallerPort = RpcMessagePort<ToolRpcCallMessage>
export type ToolRpcResponderPort = RpcMessagePort<RemoteFunctionResponse>

let remoteFunctionRequestCounter = 0

const createRemoteFunctionRequestId = (name: string) =>
  `${name}-${Date.now()}-${remoteFunctionRequestCounter++}`

const resolveRemoteFunctionTimeoutMs = (args: ReadonlyDeep<FunctionArguments>) => {
  const timeoutMs = args.timeoutMs
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    return REMOTE_FUNCTION_TIMEOUT_MS
  }
  return Math.min(
    Math.max(Math.trunc(timeoutMs), REMOTE_FUNCTION_TIMEOUT_MS),
    MAX_REMOTE_FUNCTION_TIMEOUT_MS,
  )
}

function errorFromRemoteResponse(name: string, requestId: string, error: unknown) {
  return new Error(
    `Remote function ${name} failed for request ${requestId}: ${humanizeError(error)}`,
  )
}

export async function callToolOverRpc(
  func: ReadonlyDeep<FunctionCall>,
  port: ToolRpcCallerPort,
  options?: {
    stopSignal?: AbortSignal
    taskId?: string | undefined
  },
): Promise<unknown> {
  const requestId = createRemoteFunctionRequestId(func.name)
  const timeoutMs = resolveRemoteFunctionTimeoutMs(func.arguments)

  const message = RemoteFunctionCall.parse({
    type: 'functionCall',
    functionName: func.name,
    requestId,
    taskId: options?.taskId,
    arguments: func.arguments,
  })
  return await createStreamRpcRequest<ToolRpcCallMessage, RemoteFunctionResponse, unknown, never>({
    port,
    request: message,
    requestId,
    timeoutMs,
    signal: options?.stopSignal,
    createCancelRequest: (reason) =>
      RemoteFunctionCancel.parse({
        type: 'functionCancel',
        functionName: func.name,
        requestId,
        reason,
      }),
    parseResponse: (value) => {
      const response = RemoteFunctionResponse.safeParse(value)
      if (response.success) return response.data
      return undefined
    },
    isResponseForRequest: (response) => response.requestId === requestId,
    readResponse: (response) => {
      if (response.error !== undefined) {
        return {
          ok: false,
          error: errorFromRemoteResponse(func.name, requestId, response.error),
        }
      }
      return { ok: true, value: response.response }
    },
  })
}

export function registerToolRpcBroker(options: {
  workerPort: ToolRpcResponderPort
  toolPort: ToolRpcCallerPort
  prepareFunctionCall: (
    call: RemoteFunctionCall,
    stopSignal: AbortSignal,
  ) => Promise<FunctionCall> | FunctionCall
}) {
  const pending = new Map<string, AbortController>()

  const respond = (call: RemoteFunctionCall, response: { response?: unknown; error?: unknown }) => {
    options.workerPort.send({
      type: 'functionResponse',
      ...response,
      functionName: call.functionName,
      requestId: call.requestId,
    })
  }

  const unsubscribe = options.workerPort.receive(async (msg) => {
    const cancel = RemoteFunctionCancel.safeParse(msg)
    if (cancel.success) {
      pending.get(cancel.data.requestId)?.abort(cancel.data.reason)
      pending.delete(cancel.data.requestId)
      return
    }

    const call = RemoteFunctionCall.safeParse(msg)
    if (!call.success) return

    const abortController = new AbortController()
    pending.set(call.data.requestId, abortController)

    try {
      const preparedFunc = await options.prepareFunctionCall(call.data, abortController.signal)
      const result = await callToolOverRpc(preparedFunc, options.toolPort, {
        stopSignal: abortController.signal,
        taskId: call.data.taskId,
      })
      respond(call.data, { response: result })
    } catch (error) {
      respond(call.data, { error: serializeError(error) })
    } finally {
      pending.delete(call.data.requestId)
    }
  })

  return {
    stop: (reason?: string) => {
      for (const controller of pending.values()) {
        controller.abort(reason)
      }
      pending.clear()
    },
    destroy: unsubscribe,
  }
}

async function executeToolDefinition(
  func: ReadonlyDeep<FunctionCall>,
  tool: InternalTool,
  stopSignal: AbortSignal,
  context: toolContext,
): Promise<unknown> {
  if (tool.function) {
    const result = await tool.function(func.arguments, context)
    return bigIntToString(result)
  }

  if (tool.code) {
    try {
      const result = await executeToolInWorkerSandbox(
        tool.code,
        { params: func.arguments, context },
        `${func.name}.js`,
        stopSignal,
      )
      return bigIntToString(result)
    } catch (error) {
      throw new Error(`Error executing worker sandbox code for tool: ${func.name}`, {
        cause: error,
      })
    }
  }

  return undefined
}

export function createExternalToolContext(stopSignal: AbortSignal): toolContext {
  return {
    getExecutionTaskChain: () => {
      throw new Error('getExecutionTaskChain is not implemented for external tool clients yet.')
    },
    createSubtasksResult,
    getSecret: (name) => {
      console.log('external tool get secret name', name)
      return Promise.resolve('N/A')
    },
    setSecret: (name) => {
      console.log('external tool set secret name', name)
      return Promise.resolve()
    },
    stopSignal,
    toolId: 'N/A',
  }
}

export function registerToolRpcExecutor(options: {
  port: ToolRpcResponderPort
  getTool: (name: string) => Promise<InternalTool | undefined> | InternalTool | undefined
  prepareFunctionCall?: (
    call: RemoteFunctionCall,
    tool: InternalTool,
    stopSignal: AbortSignal,
  ) => Promise<FunctionCall> | FunctionCall
  createContext: (
    call: RemoteFunctionCall,
    stopSignal: AbortSignal,
  ) => Promise<toolContext | { context: toolContext; cleanup?: () => void }> | toolContext
}) {
  const pending = new Map<string, AbortController>()

  const respond = (call: RemoteFunctionCall, response: { response?: unknown; error?: unknown }) => {
    options.port.send({
      type: 'functionResponse',
      ...response,
      functionName: call.functionName,
      requestId: call.requestId,
    })
  }

  const unsubscribe = options.port.receive(async (msg) => {
    const cancel = RemoteFunctionCancel.safeParse(msg)
    if (cancel.success) {
      pending.get(cancel.data.requestId)?.abort(cancel.data.reason)
      pending.delete(cancel.data.requestId)
      return
    }

    const call = RemoteFunctionCall.safeParse(msg)
    if (!call.success) return

    const tool = await options.getTool(call.data.functionName)
    if (!tool?.function && !tool?.code) return

    const abortController = new AbortController()
    pending.set(call.data.requestId, abortController)
    let cleanupContext: (() => void) | undefined

    try {
      const preparedFunc = (await options.prepareFunctionCall?.(
        call.data,
        tool,
        abortController.signal,
      )) ?? {
        name: call.data.functionName,
        arguments: call.data.arguments ?? {},
      }
      const contextResult = await options.createContext(call.data, abortController.signal)
      const context = 'context' in contextResult ? contextResult.context : contextResult
      cleanupContext = 'context' in contextResult ? contextResult.cleanup : undefined
      const result = await executeToolDefinition(
        preparedFunc,
        tool,
        abortController.signal,
        context,
      )
      respond(call.data, { response: result })
    } catch (error) {
      respond(call.data, { error: serializeError(error) })
    } finally {
      cleanupContext?.()
      pending.delete(call.data.requestId)
    }
  })

  return {
    stop: (reason?: string) => {
      for (const controller of pending.values()) {
        controller.abort(reason)
      }
      pending.clear()
    },
    destroy: unsubscribe,
  }
}
