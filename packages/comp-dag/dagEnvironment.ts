import type { DagExposedInputDef, DagNode } from './dagCore.ts'

const isOneOfInput = (
  input: DagExposedInputDef,
): input is Extract<DagExposedInputDef, { kind: 'oneOf' }> =>
  typeof input === 'object' && input !== null && 'kind' in input && input.kind === 'oneOf'

const exposedNodes = (input: DagExposedInputDef): readonly DagNode[] =>
  isOneOfInput(input) ? input.options : [input]

export const dagNodeInputs = (node: DagNode): readonly DagNode[] => [
  ...Object.values(node.hiddenInputs ?? {}),
  ...Object.values(node.exposedInputs ?? {}).flatMap(exposedNodes),
]

const nodeLabel = (node: DagNode) => node.localName ?? node.name

export const describeDagEnvironment = (
  root: DagNode,
): {
  nodes: readonly DagNode[]
  sources: readonly DagNode[]
  potentialLeaves: readonly DagNode[]
  downstreamByNode: ReadonlyMap<DagNode, readonly DagNode[]>
} => {
  const visited = new Set<DagNode>()
  const downstreamByNode = new Map<DagNode, DagNode[]>()
  const visit = (node: DagNode) => {
    if (visited.has(node)) return
    visited.add(node)
    for (const input of dagNodeInputs(node)) {
      const consumers = downstreamByNode.get(input) ?? []
      if (!consumers.includes(node)) downstreamByNode.set(input, [...consumers, node])
      visit(input)
    }
  }
  visit(root)

  const nodes = [...visited].sort((left, right) => nodeLabel(left).localeCompare(nodeLabel(right)))
  return {
    nodes,
    sources: nodes.filter((node) => node.effect === 'source'),
    potentialLeaves: nodes.filter(
      (node) => node.effect === 'pure' && dagNodeInputs(node).length === 0,
    ),
    downstreamByNode,
  }
}
