import type { DagNode, EngineConfig, NodeContext } from '@taskyon/comp-dag'
import type { ClientTool } from '../types/toolApi'
import { JSONSchema7 } from '../utils/jsonSchema'

export type DagNodeToolOptions = {
  description?: string
  engineConfig?: EngineConfig
  createNodeContext?: () => NodeContext
}

const defaultNodeContext = (): NodeContext => ({
  nowUtcMs: Date.now(),
  log: (message, data) => console.log(`[dag-node-tool] ${message}`, data ?? ''),
})

export const createDagNodeTool = <P extends Record<string, unknown>>(
  node: DagNode<P>,
  options: DagNodeToolOptions = {},
): ClientTool => {
  const parameters = JSONSchema7.parse(node.paramsSchema)
  return {
    name: node.name,
    description: options.description ?? node.description ?? node.localName ?? node.name,
    source: {
      kind: 'dag-node' as const,
      nodeName: node.name,
      version: node.version,
      ...(node.contentHash ? { contentHash: node.contentHash } : {}),
    },
    parameters,
    function: async (params) => {
      const result = await node
        .call(params as P)
        .run(options.createNodeContext?.() ?? defaultNodeContext(), options.engineConfig)
      return result.value
    },
  }
}

export const createDagNodeTools = (
  nodes: readonly DagNode<Record<string, unknown>>[],
  options: DagNodeToolOptions = {},
): ClientTool[] => {
  const names = new Set<string>()
  return nodes.map((node) => {
    if (names.has(node.name)) throw new Error(`Duplicate mounted DAG tool name: ${node.name}`)
    names.add(node.name)
    return createDagNodeTool(node, options)
  })
}
