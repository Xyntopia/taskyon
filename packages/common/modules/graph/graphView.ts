import type { GraphData, LayoutOptions } from './types'

export type GraphViewLayout = 'flow' | 'vertical' | 'organic'

export type GraphPresentationState = {
  layout: GraphViewLayout
  panZoomEnabled: boolean
  nodeDragEnabled: boolean
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
