import {
  applyOrganicLayout,
  createOrganicLayoutState,
  moveOrganicNode,
  organicLayoutIterationsPerFrame,
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

export const testOrganicLayoutCoolsWithinInteractiveFrameBudget = () => {
  const nodeCount = 46
  const nodes = Array.from({ length: nodeCount }, (_, index) =>
    createNode(`node-${index}`, (index % 8) * 190, Math.floor(index / 8) * 110),
  )
  const edges: GraphEdge[] = Array.from({ length: nodeCount - 1 }, (_, index) => ({
    id: `edge-${index}`,
    source: `node-${index}`,
    target: `node-${index + 1}`,
  }))
  const state = createOrganicLayoutState(nodes, edges)

  stepOrganicLayout(state, 90)
  let stableFrames = 0
  let renderedFrames = 0
  while (stableFrames < 12 && renderedFrames < 72) {
    const speed = stepOrganicLayout(state, organicLayoutIterationsPerFrame)
    stableFrames = speed < 0.08 ? stableFrames + 1 : 0
    renderedFrames += 1
  }

  assert(
    stableFrames === 12,
    `Expected the 46-node organic layout to settle within 72 frames, received ${renderedFrames}.`,
  )
  return { success: true }
}

export const testOrganicLayoutRestrictsDraggingToActiveNodes = () => {
  const nodes = [
    createNode('dragged', 0, 0),
    createNode('neighbor', 220, 0),
    createNode('inactive', 440, 0),
  ]
  const edges: GraphEdge[] = [
    { id: 'dragged-neighbor', source: 'dragged', target: 'neighbor' },
    { id: 'neighbor-inactive', source: 'neighbor', target: 'inactive' },
  ]
  const state = createOrganicLayoutState(nodes, edges)

  stepOrganicLayout(state, 90)
  applyOrganicLayout(state, nodes)
  const neighborBeforeDrag = { x: nodes[1]!.x, y: nodes[1]!.y }
  const inactiveBeforeDrag = { x: nodes[2]!.x, y: nodes[2]!.y }

  moveOrganicNode(state, 'dragged', { x: 600, y: 300 })
  stepOrganicLayout(state, 30, new Set(['dragged', 'neighbor']))
  applyOrganicLayout(state, nodes, new Set(['dragged', 'neighbor']))

  assert(
    Math.hypot(nodes[1]!.x - neighborBeforeDrag.x, nodes[1]!.y - neighborBeforeDrag.y) > 5,
    'Expected an active neighbor to settle while dragging.',
  )
  assert(
    nodes[2]!.x === inactiveBeforeDrag.x && nodes[2]!.y === inactiveBeforeDrag.y,
    'Expected inactive nodes to remain stationary during local drag settling.',
  )
  return { success: true }
}
