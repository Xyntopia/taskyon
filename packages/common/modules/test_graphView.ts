import { filterVisibleGraph, graphViewLayoutOptions } from './graph/graphView'
import type { GraphData } from './graph/types'

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message)
}

export const testGraphViewFiltersHiddenNodesAndEdges = () => {
  const graph: GraphData = {
    nodes: [{ id: 'source' }, { id: 'middle' }, { id: 'result' }],
    edges: [
      { id: 'source-middle', source: 'source', target: 'middle' },
      { id: 'middle-result', source: 'middle', target: 'result' },
    ],
  }

  const visible = filterVisibleGraph(graph, new Set(['source', 'result']))

  assert(
    visible.nodes.map(({ id }) => id).join(',') === 'source,result',
    'Expected only selected visible nodes.',
  )
  assert(visible.edges.length === 0, 'Expected edges touching a hidden node to be removed.')
  return { success: true }
}

export const testGraphViewLayoutsMapToRendererOptions = () => {
  const flow = graphViewLayoutOptions('flow')
  const vertical = graphViewLayoutOptions('vertical')
  const organic = graphViewLayoutOptions('organic')

  assert(
    flow.layoutMode === 'hierarchical' && flow.direction === 'LR',
    'Expected flow layout to render left to right.',
  )
  assert(
    vertical.layoutMode === 'hierarchical' && vertical.direction === 'TB',
    'Expected vertical layout to render top to bottom.',
  )
  assert(organic.layoutMode === 'organic', 'Expected organic layout to use the force renderer.')
  return { success: true }
}
