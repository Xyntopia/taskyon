import type { ToolBase } from '../types/tools'
import { createMcpBridge } from './bridge'
import type { McpServerInfo, McpTool } from './types'

export type TaskyonMcpBridgeDeps = {
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
  listTaskyonTools: TaskyonMcpBridgeDeps['listTaskyonTools'],
): Promise<McpTool[]> {
  const tools = await listTaskyonTools()
  return Object.values(tools).map(mapToolToMcpTool)
}

export function createTaskyonMcpBridge(deps: TaskyonMcpBridgeDeps) {
  const baseDeps = {
    serverInfo: deps.serverInfo ?? defaultServerInfo,
    listTools: () => listMcpTools(deps.listTaskyonTools),
    callTool: deps.callTaskyonTool,
  }
  return createMcpBridge(
    deps.protocolVersion ? { ...baseDeps, protocolVersion: deps.protocolVersion } : baseDeps,
  )
}
