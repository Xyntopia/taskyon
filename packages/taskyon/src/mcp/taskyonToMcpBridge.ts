import type { ToolBase } from '../types/tools'
import { createMcpProtocolBridge } from './mcpProtocolBridge'
import type { McpServerInfo, McpTool } from './types'

export type TaskyonToMcpBridgeDeps = {
  listTaskyonTools: () => Promise<Record<string, ToolBase>>
  callTaskyonTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
  serverInfo?: McpServerInfo
  protocolVersion?: string
}

const defaultServerInfo: McpServerInfo = {
  name: 'taskyon',
  version: '0.0.0',
}

function mapToolToMcpTool(tool: ToolBase): McpTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }
}

async function listMcpTools(
  listTaskyonTools: TaskyonToMcpBridgeDeps['listTaskyonTools'],
): Promise<McpTool[]> {
  const tools = await listTaskyonTools()
  return Object.values(tools).map(mapToolToMcpTool)
}

export function createTaskyonToMcpBridge(deps: TaskyonToMcpBridgeDeps) {
  const baseDeps = {
    serverInfo: deps.serverInfo ?? defaultServerInfo,
    listTools: () => listMcpTools(deps.listTaskyonTools),
    callTool: deps.callTaskyonTool,
  }
  return createMcpProtocolBridge(
    deps.protocolVersion ? { ...baseDeps, protocolVersion: deps.protocolVersion } : baseDeps,
  )
}
