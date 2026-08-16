import { createNode, explode } from './dagCore.ts'
import { buildDagGraphView } from './dagGraphView.ts'

export const testDagGraphViewUsesImmutableNodeIds = () => {
  const schema = { type: 'object', additionalProperties: false } as const
  const input = createNode({
    name: 'runtime-input-name',
    localName: 'RuntimeInputName',
    contentHash: 'sha256:input',
    version: 1,
    localParams: schema,
    outputSchema: schema,
    run: () => ({}),
  })
  const output = createNode({
    name: 'runtime-output-name',
    localName: 'RuntimeOutputName',
    contentHash: 'sha256:output',
    version: 1,
    hiddenInputs: { input },
    localParams: schema,
    outputSchema: schema,
    run: () => ({}),
  })
  const graph = buildDagGraphView({ output }, (node) => ({
    definitionOrigin: node === input ? 'stored' : 'hard-coded',
    ...(node === input ? { label: 'Stored input' } : {}),
  }))
  if (!graph.nodes.some(({ id }) => id === 'sha256:input')) {
    throw new Error('Expected graph nodes to use immutable content hashes.')
  }
  if (
    !graph.edges.some(
      ({ source, target }) => source === 'sha256:input' && target === 'sha256:output',
    )
  ) {
    throw new Error('Expected graph edges to use the same immutable node IDs.')
  }
  const inputGraphNode = graph.nodes.find(({ id }) => id === 'sha256:input')
  const outputGraphNode = graph.nodes.find(({ id }) => id === 'sha256:output')
  if (
    inputGraphNode?.data?.definitionOrigin !== 'stored' ||
    inputGraphNode.label !== 'Stored input'
  ) {
    throw new Error('Expected supplied stored-node metadata to reach the rendered graph.')
  }
  if (outputGraphNode?.data?.definitionOrigin !== 'hard-coded') {
    throw new Error('Expected hard-coded origin to reach the rendered graph.')
  }
}

testDagGraphViewUsesImmutableNodeIds.description =
  'Uses immutable IDs and stored versus hard-coded metadata across DAG graph views.'

export const testDagGraphViewUsesStructuralExplodeMetadata = () => {
  const source = createNode({
    name: 'source',
    contentHash: 'sha256:source',
    version: 1,
    localParams: { type: 'object', additionalProperties: false },
    outputSchema: {
      type: 'object',
      properties: { rows: { type: 'array', items: { type: 'number' } } },
      required: ['rows'],
    },
    run: () => ({ rows: [1] }),
  })
  const exploded = explode(source, 'rows', {
    name: 'sha256:exploded',
    contentHash: 'sha256:exploded',
    outputSchema: { type: 'number' },
  })
  const output = createNode({
    name: 'output',
    contentHash: 'sha256:output',
    version: 1,
    exposedInputs: { row: exploded },
    localParams: { type: 'object', additionalProperties: false },
    outputSchema: { type: 'number' },
    run: (_params, use) => use.row(),
  })

  const graph = buildDagGraphView({ output }, () => ({ definitionOrigin: 'stored' }))
  const explodedNode = graph.nodes.find(({ id }) => id === 'sha256:exploded')
  const explodedEdge = graph.edges.find(
    ({ source: edgeSource, target }) =>
      edgeSource === 'sha256:exploded' && target === 'sha256:output',
  )
  if (!explodedNode?.data?.isExploded || explodedNode.type !== 'exploded') {
    throw new Error('Expected structural explode metadata to classify the stored explode node.')
  }
  if (explodedEdge?.type !== 'exposed-exploded-output') {
    throw new Error('Expected the exploded provider edge to retain its graph presentation type.')
  }
}

testDagGraphViewUsesStructuralExplodeMetadata.description =
  'Classifies exploded nodes and edges from canonical structure even when runtime names are hashes.'
