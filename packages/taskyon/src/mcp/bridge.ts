import { humanizeError } from '../utils/error'
import type {
  JsonRpcErrorObject,
  JsonRpcFailure,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccess,
  McpInitializeResult,
  McpServerInfo,
  McpTool,
  McpToolsCallResult,
  McpToolsListResult,
} from './types'

export type McpBridgeDependencies = {
  serverInfo: McpServerInfo
  listTools: () => Promise<McpTool[]>
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  protocolVersion?: string
}

type McpMethodHandler = (
  req: JsonRpcRequest,
  deps: McpBridgeDependencies,
) => Promise<unknown>

const JSON_RPC_VERSION = '2.0' as const
const DEFAULT_PROTOCOL_VERSION = '2024-11-05'

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602
const INTERNAL_ERROR = -32603

class JsonRpcMethodError extends Error {
  readonly rpc: JsonRpcErrorObject

  constructor(rpc: JsonRpcErrorObject) {
    super(rpc.message)
    this.name = 'JsonRpcMethodError'
    this.rpc = rpc
  }
}

function normalizeError(error: unknown, fallback: string): JsonRpcErrorObject {
  const message = humanizeError(error) || fallback
  return {
    code: INTERNAL_ERROR,
    message,
    data: { raw: error },
  }
}

function toSuccess(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: JSON_RPC_VERSION, id, result }
}

function toFailure(id: JsonRpcId, error: JsonRpcErrorObject): JsonRpcFailure {
  return { jsonrpc: JSON_RPC_VERSION, id, error }
}

function isJsonRpcVersionValid(req: Partial<JsonRpcRequest>): req is JsonRpcRequest {
  return req.jsonrpc === JSON_RPC_VERSION && typeof req.method === 'string'
}

function extractNamedArgs(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JsonRpcMethodError({
      code: INVALID_PARAMS,
      message: 'Expected params.arguments to be an object',
    })
  }
  return value as Record<string, unknown>
}

function toMcpText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return '[Unserializable value]'
  }
}

function mapToolCallResult(result: unknown): McpToolsCallResult {
  const text = toMcpText(result)
  if (typeof result === 'string') {
    return { content: [{ type: 'text', text }] }
  }
  return {
    content: [{ type: 'text', text }],
    structuredContent: result,
  }
}

function initializeResult(deps: McpBridgeDependencies): McpInitializeResult {
  return {
    protocolVersion: deps.protocolVersion ?? DEFAULT_PROTOCOL_VERSION,
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
    serverInfo: deps.serverInfo,
  }
}

const methodHandlers: Record<string, McpMethodHandler> = {
  initialize: (_req, deps) => Promise.resolve(initializeResult(deps)),
  'notifications/initialized': () => Promise.resolve(null),
  'tools/list': async (_req, deps): Promise<McpToolsListResult> => {
    const tools = await deps.listTools()
    return { tools }
  },
  'tools/call': async (req, deps): Promise<McpToolsCallResult> => {
    const params = req.params as
      | {
          name?: unknown
          arguments?: unknown
        }
      | undefined
    if (!params || typeof params.name !== 'string') {
      throw new JsonRpcMethodError({
        code: INVALID_PARAMS,
        message: 'tools/call requires params.name as a string',
      })
    }
    const args = extractNamedArgs(params.arguments)
    const result = await deps.callTool(params.name, args)
    return mapToolCallResult(result)
  },
}

async function runMethod(req: JsonRpcRequest, deps: McpBridgeDependencies): Promise<unknown> {
  const handler = methodHandlers[req.method]
  if (!handler) {
    throw new JsonRpcMethodError({
      code: METHOD_NOT_FOUND,
      message: `Method not found: ${req.method}`,
    })
  }
  return await handler(req, deps)
}

function normalizeRpcError(error: unknown): JsonRpcErrorObject {
  if (error instanceof JsonRpcMethodError) {
    return error.rpc
  }
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const known = error as JsonRpcErrorObject
    return {
      code: known.code,
      message: known.message,
      ...(known.data !== undefined ? { data: known.data } : {}),
    }
  }
  return normalizeError(error, 'Internal error')
}

function validateRequest(raw: unknown): JsonRpcRequest {
  if (!raw || typeof raw !== 'object') {
    throw new JsonRpcMethodError({
      code: PARSE_ERROR,
      message: 'Invalid JSON-RPC payload',
    })
  }
  const req = raw as Partial<JsonRpcRequest>
  if (!isJsonRpcVersionValid(req)) {
    throw new JsonRpcMethodError({
      code: INVALID_REQUEST,
      message: 'Invalid JSON-RPC request',
    })
  }
  return req
}

function shouldRespond(req: JsonRpcRequest): req is JsonRpcRequest & { id: JsonRpcId } {
  return 'id' in req
}

export function createMcpBridge(deps: McpBridgeDependencies) {
  async function handleRequest(raw: unknown): Promise<JsonRpcResponse | null> {
    let req: JsonRpcRequest
    try {
      req = validateRequest(raw)
    } catch (error) {
      return toFailure(null, normalizeRpcError(error))
    }

    try {
      const result = await runMethod(req, deps)
      if (!shouldRespond(req)) return null
      return toSuccess(req.id ?? null, result)
    } catch (error) {
      if (!shouldRespond(req)) return null
      return toFailure(req.id ?? null, normalizeRpcError(error))
    }
  }

  return {
    handleRequest,
  }
}
