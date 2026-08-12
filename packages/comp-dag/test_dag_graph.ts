import { createNode } from './dagCore.ts'
import { buildDagNodeGraphFromOutputNodes } from './dagGraph.ts'

export const testDagGraphUsesImmutableNodeIds = () => {
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
  const graph = buildDagNodeGraphFromOutputNodes({ output })
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
}

testDagGraphUsesImmutableNodeIds.description =
  'Uses immutable content hashes consistently for rendered DAG nodes and edges.'
