import {
  applyOrganicLayout,
  createOrganicLayoutState,
  moveOrganicNode,
  releaseOrganicNode,
  stepOrganicLayout,
} from './graph/organicLayout'
import type { GraphEdge, LayoutNode } from './graph/types'

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message)
}

const createNode = (id: string, x = 0, y = 0): LayoutNode => ({
  id,
  x,
  y,
  width: 160,
  height: 80,
  layer: 0,
  order: 0,
})

const centerDistance = (first: LayoutNode, second: LayoutNode): number =>
  Math.hypot(
    first.x + first.width / 2 - (second.x + second.width / 2),
    first.y + first.height / 2 - (second.y + second.height / 2),
  )

export const testOrganicLayoutSeparatesNodesAndRespondsToDragging = () => {
  const nodes = [createNode('source'), createNode('middle'), createNode('result')]
  const edges: GraphEdge[] = [
    { id: 'source-middle', source: 'source', target: 'middle' },
    { id: 'middle-result', source: 'middle', target: 'result' },
  ]
  const state = createOrganicLayoutState(nodes, edges)

  stepOrganicLayout(state, 180)
  applyOrganicLayout(state, nodes)
  assert(
    nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)),
    'Expected finite organic layout coordinates.',
  )
  assert(
    centerDistance(nodes[0]!, nodes[1]!) > 100 && centerDistance(nodes[1]!, nodes[2]!) > 100,
    'Expected the organic layout to separate overlapping connected nodes.',
  )

  const sourceBeforeDrag = { x: nodes[0]!.x, y: nodes[0]!.y }
  moveOrganicNode(state, 'middle', { x: 520, y: 320 })
  stepOrganicLayout(state, 60)
  applyOrganicLayout(state, nodes)
  assert(
    Math.hypot(nodes[0]!.x - sourceBeforeDrag.x, nodes[0]!.y - sourceBeforeDrag.y) > 5,
    'Expected a neighboring node to respond while the dragged node is pinned.',
  )
  releaseOrganicNode(state, 'middle')

  return { success: true }
}
