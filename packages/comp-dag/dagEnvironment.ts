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

export const dagNodeId = (node: DagNode): string => node.contentHash ?? node.name

export type DagNodeIndexEntry = {
  id: string
  name: string
  label: string
  node: DagNode
}

export type DagNodeIndex = Record<string, DagNodeIndexEntry>

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

export const createDagNodeIndex = (outputNodes: Record<string, DagNode>): DagNodeIndex => {
  const index: DagNodeIndex = {}
  for (const root of Object.values(outputNodes)) {
    for (const node of describeDagEnvironment(root).nodes) {
      const id = dagNodeId(node)
      index[id] ??= {
        id,
        name: node.name,
        label: nodeLabel(node),
        node,
      }
    }
  }
  return index
}
