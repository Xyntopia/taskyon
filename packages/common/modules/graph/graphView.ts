import type { GraphData, LayoutOptions, ViewportState } from './types'

export type GraphViewLayout = 'flow' | 'vertical' | 'organic'

export type GraphPresentationState = {
  layout: GraphViewLayout
  panZoomEnabled: boolean
  nodeDragEnabled: boolean
  viewport?: ViewportState
}

export const graphViewLayoutOptions = (layout: GraphViewLayout): LayoutOptions => {
  switch (layout) {
    case 'flow':
      return { layoutMode: 'hierarchical', direction: 'LR' }
    case 'vertical':
      return { layoutMode: 'hierarchical', direction: 'TB' }
    case 'organic':
      return { layoutMode: 'organic' }
  }
}

export const filterVisibleGraph = <N, E>(
  graph: GraphData<N, E>,
  visibleNodeIds: ReadonlySet<string>,
): GraphData<N, E> => ({
  nodes: graph.nodes.filter(({ id }) => visibleNodeIds.has(id)),
  edges: graph.edges.filter(
    ({ source, target }) => visibleNodeIds.has(source) && visibleNodeIds.has(target),
  ),
})

export const findUndirectedGraphNeighborhood = <N, E>(
  graph: GraphData<N, E>,
  rootNodeId: string,
  maxHops: number,
): ReadonlySet<string> => {
  if (!graph.nodes.some(({ id }) => id === rootNodeId)) return new Set()

  const adjacentNodeIds = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    const sourceNeighbors = adjacentNodeIds.get(edge.source) ?? new Set<string>()
    sourceNeighbors.add(edge.target)
    adjacentNodeIds.set(edge.source, sourceNeighbors)

    const targetNeighbors = adjacentNodeIds.get(edge.target) ?? new Set<string>()
    targetNeighbors.add(edge.source)
    adjacentNodeIds.set(edge.target, targetNeighbors)
  }

  const nodeIds = new Set([rootNodeId])
  let frontier = [rootNodeId]
  for (let hop = 0; hop < Math.max(0, Math.floor(maxHops)); hop += 1) {
    const nextFrontier: string[] = []
    for (const nodeId of frontier) {
      for (const adjacentNodeId of adjacentNodeIds.get(nodeId) ?? []) {
        if (nodeIds.has(adjacentNodeId)) continue
        nodeIds.add(adjacentNodeId)
        nextFrontier.push(adjacentNodeId)
      }
    }
    if (nextFrontier.length === 0) break
    frontier = nextFrontier
  }

  return nodeIds
}

export const findUpstreamGraphSelection = <N, E>(
  graph: GraphData<N, E>,
  selectedNodeId: string,
): { nodeIds: ReadonlySet<string>; edgeIds: ReadonlySet<string> } => {
  if (!graph.nodes.some(({ id }) => id === selectedNodeId)) {
    return { nodeIds: new Set(), edgeIds: new Set() }
  }

  const incomingEdges = new Map<string, typeof graph.edges>()
  for (const edge of graph.edges) {
    incomingEdges.set(edge.target, [...(incomingEdges.get(edge.target) ?? []), edge])
  }

  const nodeIds = new Set([selectedNodeId])
  const edgeIds = new Set<string>()
  const pendingNodeIds = [selectedNodeId]
  while (pendingNodeIds.length > 0) {
    const target = pendingNodeIds.pop()!
    for (const edge of incomingEdges.get(target) ?? []) {
      edgeIds.add(edge.id)
      if (nodeIds.has(edge.source)) continue
      nodeIds.add(edge.source)
      pendingNodeIds.push(edge.source)
    }
  }

  return { nodeIds, edgeIds }
}
