import {
  filterVisibleGraph,
  findUndirectedGraphNeighborhood,
  findUpstreamGraphSelection,
  graphViewLayoutOptions,
} from './graph/graphView'
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

export const testGraphViewFindsCompleteUpstreamSelection = () => {
  const graph: GraphData = {
    nodes: [
      { id: 'source-a' },
      { id: 'source-b' },
      { id: 'middle' },
      { id: 'selected' },
      { id: 'downstream' },
      { id: 'unrelated' },
    ],
    edges: [
      { id: 'a-middle', source: 'source-a', target: 'middle' },
      { id: 'b-middle', source: 'source-b', target: 'middle' },
      { id: 'middle-selected', source: 'middle', target: 'selected' },
      { id: 'selected-downstream', source: 'selected', target: 'downstream' },
      { id: 'cycle', source: 'middle', target: 'source-a' },
    ],
  }

  const selection = findUpstreamGraphSelection(graph, 'selected')

  assert(
    [...selection.nodeIds].sort().join(',') === 'middle,selected,source-a,source-b',
    'Expected the selected node and its complete transitive upstream closure.',
  )
  assert(
    [...selection.edgeIds].sort().join(',') === 'a-middle,b-middle,cycle,middle-selected',
    'Expected only edges in the selected upstream subgraph.',
  )
  return { success: true }
}

export const testGraphViewFindsBoundedUndirectedNeighborhood = () => {
  const graph: GraphData = {
    nodes: [
      { id: 'upstream-two' },
      { id: 'upstream-one' },
      { id: 'selected' },
      { id: 'downstream-one' },
      { id: 'downstream-two' },
      { id: 'outside' },
    ],
    edges: [
      { id: 'upstream-two-one', source: 'upstream-two', target: 'upstream-one' },
      { id: 'upstream-one-selected', source: 'upstream-one', target: 'selected' },
      { id: 'selected-downstream-one', source: 'selected', target: 'downstream-one' },
      { id: 'downstream-one-two', source: 'downstream-one', target: 'downstream-two' },
      { id: 'outside-upstream-two', source: 'outside', target: 'upstream-two' },
    ],
  }

  const nodeIds = findUndirectedGraphNeighborhood(graph, 'selected', 2)

  assert(
    [...nodeIds].sort().join(',') ===
      'downstream-one,downstream-two,selected,upstream-one,upstream-two',
    'Expected a two-hop neighborhood in both graph directions without more distant nodes.',
  )
  return { success: true }
}
