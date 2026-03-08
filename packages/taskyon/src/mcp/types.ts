export type JsonRpcId = string | number | null

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: unknown
}

export type JsonRpcSuccess = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result: unknown
}

export type JsonRpcErrorObject = {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcFailure = {
  jsonrpc: '2.0'
  id: JsonRpcId
  error: JsonRpcErrorObject
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure

export type McpServerInfo = {
  name: string
  version: string
}

export type McpTool = {
  name: string
  description: string
  inputSchema: unknown
}

export type McpInitializeResult = {
  protocolVersion: string
  capabilities: {
    tools: {
      listChanged: boolean
    }
  }
  serverInfo: McpServerInfo
}

export type McpToolsListResult = {
  tools: McpTool[]
}

export type McpTextContent = {
  type: 'text'
  text: string
}

export type McpToolsCallResult = {
  content: McpTextContent[]
  structuredContent?: unknown
  isError?: boolean
}

