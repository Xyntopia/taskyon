import type { GraphData, GraphEdge, GraphNode } from './types'

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

export const toArray = <T>(value: Iterable<T> | T[]): T[] => Array.from(value)

export const byId = <T extends { id: string }>(items: T[]): Map<string, T> =>
  new Map(items.map((item) => [item.id, item]))

export const normalizeGraph = <N = unknown, E = unknown>(
  graph: GraphData<N, E>,
): GraphData<N, E> => {
  const nodesById = new Map<string, GraphNode<N>>()
  for (const node of graph.nodes) nodesById.set(node.id, node)

  const edges: GraphEdge<E>[] = []
  const seenEdgeIds = new Set<string>()
  for (const edge of graph.edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue
    const id = edge.id || `${edge.source}->${edge.target}`
    if (seenEdgeIds.has(id)) continue
    seenEdgeIds.add(id)
    edges.push({ ...edge, id })
  }

  return {
    nodes: toArray(nodesById.values()),
    edges,
  }
}

export const computeInDegree = (
  nodes: GraphNode[],
  edges: Array<Pick<GraphEdge, 'source' | 'target'>>,
): Map<string, number> => {
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]))
  for (const edge of edges) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1)
  return indegree
}

export const adjacencyFromEdges = (
  edges: Array<Pick<GraphEdge, 'source' | 'target'>>,
): Map<string, string[]> => {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    const list = adjacency.get(edge.source) ?? []
    list.push(edge.target)
    adjacency.set(edge.source, list)
  }
  return adjacency
}
