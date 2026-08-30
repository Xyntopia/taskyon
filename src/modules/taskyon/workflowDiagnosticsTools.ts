import type { ToolBase } from '@taskyon/taskyon'

export const installPortableDiagnosticsTools = async (
  listTools: () => Promise<Record<string, ToolBase>>,
  installTool: (tool: ToolBase) => Promise<unknown>,
) => {
  const definitions = await listTools()
  await Promise.all(
    Object.values(definitions)
      .filter((tool) => typeof tool.code === 'string')
      .map(async (tool) => await installTool(tool)),
  )
}
