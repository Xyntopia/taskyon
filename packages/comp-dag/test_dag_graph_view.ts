import { createNode } from './dagCore.ts'
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
