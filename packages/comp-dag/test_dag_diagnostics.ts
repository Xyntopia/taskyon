import { createNode } from './dagCore.ts'
import { deriveDagDiagnostics } from './dagDiagnostics.ts'

const schema = { type: 'object', additionalProperties: false } as const

export const testDagDiagnosticsPropagateSourceFailure = () => {
  const source = createNode({
    name: 'DiagnosticSource',
    version: 1,
    effect: 'source',
    outputSchema: schema,
    run: () => ({}),
  })
  const consumer = createNode({
    name: 'DiagnosticConsumer',
    version: 1,
    hiddenInputs: { source },
    outputSchema: schema,
    run: () => ({}),
  })
  const sourceId = source.contentHash ?? source.name
  const result = deriveDagDiagnostics(consumer, [
    {
      atMs: 1,
      level: 'error',
      message: 'DAG node failed',
      data: {
        taskyonDag: {
          nodeId: sourceId,
          nodeName: source.name,
          status: 'failed',
          error: 'missing file',
        },
      },
    },
  ])
  const sourceResult = result.find(({ id }) => id === sourceId)
  const consumerResult = result.find(({ id }) => id === (consumer.contentHash ?? consumer.name))
  if (sourceResult?.status !== 'failed' || consumerResult?.status !== 'blocked') {
    throw new Error('Expected source failure to block its direct downstream consumer.')
  }
  return result
}

testDagDiagnosticsPropagateSourceFailure.description =
  'Projects structured source failures onto affected downstream DAG nodes.'
