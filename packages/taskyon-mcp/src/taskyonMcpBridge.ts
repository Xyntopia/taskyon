import {
  callTaskyonTool,
  createTaskyonClient,
  type TaskyonToolDefinition,
  type TyClient,
} from '@taskyon/tyclient'
import { createMcpProtocolBridge } from './mcpProtocolBridge'
import type { McpServerInfo, McpTool } from './types'

export type TaskyonMcpBridgeOptions = {
  serverInfo?: McpServerInfo
  protocolVersion?: string
  includeHiddenTools?: boolean
  listToolsTimeoutMs?: number
}

const defaultServerInfo: McpServerInfo = {
  name: 'taskyon',
  version: '0.0.0',
}

function mapToolToMcpTool(tool: TaskyonToolDefinition): McpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }
}

async function listMcpTools(
  client: Pick<TyClient, 'port'>,
  options: Pick<TaskyonMcpBridgeOptions, 'includeHiddenTools' | 'listToolsTimeoutMs'>,
): Promise<McpTool[]> {
  const taskyonClient = createTaskyonClient(client.port)
  const tools = await taskyonClient.tools.list({
    ...(options.includeHiddenTools !== undefined
      ? { includeHidden: options.includeHiddenTools }
      : {}),
    ...(options.listToolsTimeoutMs !== undefined ? { timeoutMs: options.listToolsTimeoutMs } : {}),
  })
  return Object.values(tools).map(mapToolToMcpTool)
}

export function createTaskyonMcpBridge(
  client: Pick<TyClient, 'port'>,
  options: TaskyonMcpBridgeOptions = {},
) {
  const baseDeps = {
    serverInfo: options.serverInfo ?? defaultServerInfo,
    getTools: () => listMcpTools(client, options),
    callTool: (name: string, args: Record<string, unknown>) => callTaskyonTool(client, name, args),
  }
  return createMcpProtocolBridge(
    options.protocolVersion ? { ...baseDeps, protocolVersion: options.protocolVersion } : baseDeps,
  )
}
