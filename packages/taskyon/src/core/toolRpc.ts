import type { RpcMessagePort } from '@taskyon/common/modules/frpBus'
import { createPortClient, createStreamRpcRequest } from '@taskyon/common/modules/frpBus'
import type { ReadonlyDeep } from 'type-fest'
import {
  MAX_REMOTE_FUNCTION_TIMEOUT_MS,
  REMOTE_FUNCTION_TIMEOUT_MS,
  taskyonProtocol,
} from '../api/taskyonProtocol'
import type { z } from 'zod'
import {
  createSubtasksResult,
  InternalTool as InternalToolSchema,
  type InternalTool,
  type ToolProgress,
  type toolContext,
} from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import type { FunctionArguments, FunctionCall } from '../types/tools'
import { executeToolInWorkerSandbox } from '../utils/executeToolInWorkerSandbox'
import { humanizeError, serializeError } from '../utils/error'
import { bigIntToString } from '../utils/objHelpers'

const remoteFunctionProtocol = taskyonProtocol.streams['tools.execution']

export type ToolRpcFunctionCallMessage = z.infer<typeof remoteFunctionProtocol.functionCall>
export type ToolRpcFunctionCancelMessage = z.infer<typeof remoteFunctionProtocol.functionCancel>
export type ToolRpcFunctionProgressMessage = z.infer<typeof remoteFunctionProtocol.functionProgress>
export type ToolRpcFunctionResponseMessage = z.infer<typeof remoteFunctionProtocol.functionResponse>

export type ToolRpcCallMessage = ToolRpcFunctionCallMessage | ToolRpcFunctionCancelMessage
export type ToolRpcResponderMessage =
  | ToolRpcFunctionProgressMessage
  | ToolRpcFunctionResponseMessage
export type ToolRpcCallerPort = RpcMessagePort<ToolRpcCallMessage>
export type ToolRpcResponderPort = RpcMessagePort<ToolRpcResponderMessage>
export type ToolExecutionCallOptions = {
  signal?: AbortSignal
  stopSignal?: AbortSignal
  taskId?: string | undefined
  requestIdPrefix?: string
  defaultTimeoutMs?: number
  onProgress?: (progress: ToolProgress) => Promise<void> | void
}
export type ToolRpcCreateContext = Parameters<typeof registerToolRpcExecutor>[0]['createContext']
export type ToolRpcFunctionDescriptionMessage = Extract<
  z.infer<(typeof taskyonProtocol.commands)['tools.register']['request']>,
  { type: 'tools.registerRequest' }
>
type ToolRpcRegistrationPort = {
  send: (message: ToolRpcResponderMessage | ToolRpcFunctionDescriptionMessage) => void
  receive: ToolRpcResponderPort['receive'] & {
    wait: (opts: { timeoutMs?: number; signal?: AbortSignal }) => Promise<unknown>
  }
}

let remoteFunctionRequestCounter = 0
const REMOTE_FUNCTION_TIMEOUT_GRACE_MS = 5_000

const createRemoteFunctionRequestId = (name: string) =>
  `${name}-${Date.now()}-${remoteFunctionRequestCounter++}`

const resolveRemoteFunctionTimeoutMs = (
  args: ReadonlyDeep<FunctionArguments>,
  defaultTimeoutMs = REMOTE_FUNCTION_TIMEOUT_MS,
) => {
  const timeoutMs = args.timeoutMs
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs)) {
    return defaultTimeoutMs
  }
  return Math.min(
    Math.max(Math.trunc(timeoutMs) + REMOTE_FUNCTION_TIMEOUT_GRACE_MS, REMOTE_FUNCTION_TIMEOUT_MS),
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
  options?: ToolExecutionCallOptions,
): Promise<unknown> {
  const requestId = createRemoteFunctionRequestId(options?.requestIdPrefix ?? func.name)
  const timeoutMs = resolveRemoteFunctionTimeoutMs(func.arguments, options?.defaultTimeoutMs)

  const message = remoteFunctionProtocol.functionCall.parse({
    type: 'functionCall',
    functionName: func.name,
    requestId,
    taskId: options?.taskId,
    arguments: func.arguments,
  })
  return await createStreamRpcRequest<
    ToolRpcCallMessage,
    ToolRpcFunctionResponseMessage,
    unknown,
    never,
    unknown
  >({
    port,
    request: message,
    requestId,
    timeoutMs,
    signal: options?.signal ?? options?.stopSignal,
    createCancelRequest: (reason) =>
      remoteFunctionProtocol.functionCancel.parse({
        type: 'functionCancel',
        functionName: func.name,
        requestId,
        reason,
      }),
    parseResponse: (value) => {
      const progress = remoteFunctionProtocol.functionProgress.safeParse(value)
      if (progress.success && progress.data.requestId === requestId) {
        void options?.onProgress?.(progress.data.progress)
        return undefined
      }
      const response = remoteFunctionProtocol.functionResponse.safeParse(value)
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

export const createToolExecutionClient = (port: ToolRpcCallerPort) => ({
  callTool: async (
    name: string,
    args: ReadonlyDeep<FunctionArguments>,
    options?: ToolExecutionCallOptions,
  ) =>
    await callToolOverRpc(
      {
        name,
        arguments: args,
      },
      port,
      options,
    ),
})

export function registerToolRpcBroker(options: {
  defaultTimeoutMs?: number
  workerPort: ToolRpcResponderPort
  toolPort: ToolRpcCallerPort
  prepareFunctionCall: (
    call: ToolRpcFunctionCallMessage,
    stopSignal: AbortSignal,
  ) => Promise<FunctionCall> | FunctionCall
}) {
  const pending = new Map<string, AbortController>()

  const respond = (
    call: ToolRpcFunctionCallMessage,
    response: { response?: unknown; error?: unknown },
  ) => {
    options.workerPort.send({
      type: 'functionResponse',
      ...response,
      functionName: call.functionName,
      requestId: call.requestId,
    })
  }

  const unsubscribe = options.workerPort.receive(async (msg) => {
    const cancel = remoteFunctionProtocol.functionCancel.safeParse(msg)
    if (cancel.success) {
      pending.get(cancel.data.requestId)?.abort(cancel.data.reason)
      pending.delete(cancel.data.requestId)
      return
    }

    const call = remoteFunctionProtocol.functionCall.safeParse(msg)
    if (!call.success) return

    const abortController = new AbortController()
    pending.set(call.data.requestId, abortController)

    try {
      const preparedFunc = await options.prepareFunctionCall(call.data, abortController.signal)
      const result = await callToolOverRpc(preparedFunc, options.toolPort, {
        ...(options.defaultTimeoutMs === undefined
          ? {}
          : { defaultTimeoutMs: options.defaultTimeoutMs }),
        stopSignal: abortController.signal,
        taskId: call.data.taskId,
        onProgress: (progress) => {
          options.workerPort.send({
            type: 'functionProgress',
            functionName: call.data.functionName,
            requestId: call.data.requestId,
            taskId: call.data.taskId,
            progress,
          })
        },
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

export function createExternalToolContext(
  stopSignal: AbortSignal,
  options?: {
    getExecutionTaskChain?: () => Promise<TaskNode[]>
  },
): toolContext {
  const unavailableSecretAccess = () => {
    throw new Error('Secret access is not implemented for external tool clients yet.')
  }

  return {
    getExecutionTaskChain: () => {
      if (!options?.getExecutionTaskChain) {
        throw new Error('getExecutionTaskChain is not available for this external tool client.')
      }
      return options.getExecutionTaskChain()
    },
    createSubtasksResult,
    getSecret: unavailableSecretAccess,
    setSecret: unavailableSecretAccess,
    stopSignal,
    toolId: 'N/A',
  }
}

export const createToolRpcFunctionDescriptionMessage = (
  tool: InternalTool,
): ToolRpcFunctionDescriptionMessage => ({
  type: 'tools.registerRequest',
  requestId: `tools.register-${tool.name}-${Date.now()}`,
  name: tool.name,
  description: tool.description,
  ...(tool.longDescription ? { longDescription: tool.longDescription } : {}),
  ...(tool.renderOptions ? { renderOptions: tool.renderOptions } : {}),
  parameters: tool.parameters,
  ...(tool.code ? { code: tool.code } : {}),
})

const parseExternalRpcTool = (tool: unknown): InternalTool => {
  const parsed = InternalToolSchema.parse(tool)
  if (!parsed.function && !parsed.code) {
    throw new Error(`Remote tool "${parsed.name}" must define either function or code.`)
  }
  if (parsed.function && parsed.code) {
    throw new Error(
      `Remote tool "${parsed.name}" must not define both function and code. Use code for Taskyon-core sandbox execution or function for client-side execution.`,
    )
  }
  return parsed
}

export async function registerToolRpcTools(options: {
  port: ToolRpcRegistrationPort
  tools: unknown[]
  timeoutMs?: number
  createContext?: ToolRpcCreateContext
}) {
  const tools = options.tools.map(parseExternalRpcTool)
  const timeoutMs = options.timeoutMs ?? REMOTE_FUNCTION_TIMEOUT_MS
  const taskyonApi = createPortClient(options.port, taskyonProtocol)
  await Promise.all(
    tools.map(async (tool) => {
      await taskyonApi.tools.register({ ...tool, timeoutMs })
    }),
  )
  const toolMap = new Map(tools.filter((tool) => tool.function).map((tool) => [tool.name, tool]))
  return registerToolRpcExecutor({
    port: options.port,
    getTool: (name) => toolMap.get(name),
    createContext:
      options.createContext ?? ((_call, stopSignal) => createExternalToolContext(stopSignal)),
  })
}

export function registerToolRpcExecutor(options: {
  port: ToolRpcResponderPort
  getTool: (name: string) => Promise<InternalTool | undefined> | InternalTool | undefined
  prepareFunctionCall?: (
    call: ToolRpcFunctionCallMessage,
    tool: InternalTool,
    stopSignal: AbortSignal,
  ) => Promise<FunctionCall> | FunctionCall
  createContext: (
    call: ToolRpcFunctionCallMessage,
    stopSignal: AbortSignal,
  ) => Promise<toolContext | { context: toolContext; cleanup?: () => void }> | toolContext
}) {
  const pending = new Map<string, AbortController>()

  const respond = (
    call: ToolRpcFunctionCallMessage,
    response: { response?: unknown; error?: unknown },
  ) => {
    options.port.send({
      type: 'functionResponse',
      ...response,
      functionName: call.functionName,
      requestId: call.requestId,
    })
  }

  const unsubscribe = options.port.receive(async (msg) => {
    const cancel = remoteFunctionProtocol.functionCancel.safeParse(msg)
    if (cancel.success) {
      pending.get(cancel.data.requestId)?.abort(cancel.data.reason)
      pending.delete(cancel.data.requestId)
      return
    }

    const call = remoteFunctionProtocol.functionCall.safeParse(msg)
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
      const baseContext = 'context' in contextResult ? contextResult.context : contextResult
      const context: toolContext = {
        ...baseContext,
        reportProgress: (progress) => {
          options.port.send(
            remoteFunctionProtocol.functionProgress.parse({
              type: 'functionProgress',
              functionName: call.data.functionName,
              requestId: call.data.requestId,
              taskId: call.data.taskId,
              progress,
            }),
          )
          return Promise.resolve()
        },
      }
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
