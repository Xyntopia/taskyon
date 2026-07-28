import { createNode } from '@taskyon/comp-dag'
import { createDagNodeTool } from '../tools/dagNodeTools'
import { createExternalToolContext } from '../core/toolRpc'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

export const testDagNodeProjectsToExecutableTaskyonTool = async () => {
  const node = createNode({
    name: 'diagnosticAdder',
    description: 'Adds two diagnostic numbers.',
    version: 1,
    localParams: {
      type: 'object',
      properties: { left: { type: 'number' }, right: { type: 'number' } },
      required: ['left', 'right'],
      additionalProperties: false,
    } as const,
    outputSchema: {
      type: 'object',
      properties: { sum: { type: 'number' } },
      required: ['sum'],
      additionalProperties: false,
    } as const,
    run: ({ left, right }) => ({ sum: left + right }),
  })
  const tool = createDagNodeTool(node)

  assert(tool.name === node.name, 'Expected DAG tool name to come from the node')
  assert(
    tool.description === node.description,
    'Expected DAG tool description to come from the node',
  )
  assert(
    tool.parameters.type === 'object' &&
      tool.parameters.properties?.left !== undefined &&
      tool.parameters.properties.right !== undefined &&
      tool.parameters.required?.includes('left') === true &&
      tool.parameters.required.includes('right'),
    'Expected the projected tool to preserve the node parameter contract',
  )
  assert(tool.source?.kind === 'dag-node', 'Expected the projected tool to identify its DAG origin')

  const result = await tool.function?.(
    { left: 2, right: 3 },
    createExternalToolContext(new AbortController().signal),
  )
  assert(JSON.stringify(result) === JSON.stringify({ sum: 5 }), 'Expected DAG execution result')

  return { tool: tool.name, result }
}

testDagNodeProjectsToExecutableTaskyonTool.description =
  'Projects one DAG node into a schema-preserving Taskyon tool and executes it through the DAG engine.'
