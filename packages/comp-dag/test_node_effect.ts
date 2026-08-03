import { compileDagNodeRecord } from './dagNodeRecordCompiler.ts'
import { defineDagNodeRecord } from './dagNodeRecord.ts'

export const testDagNodeEffectDefaultsToPureAndAffectsIdentity = async () => {
  const base = {
    formatVersion: 2 as const,
    localName: 'weather',
    label: 'Weather',
    version: 1,
    localParamsSchema: { type: 'object', additionalProperties: false } as const,
    outputSchema: { type: 'number' } as const,
    runSource: 'return 1',
  }
  const pure = await defineDagNodeRecord(base)
  const source = await defineDagNodeRecord({ ...base, effect: 'source' })
  const compiledPure = compileDagNodeRecord({ record: pure, nodeById: {} })
  const compiledSource = compileDagNodeRecord({ record: source, nodeById: {} })

  if (pure.id === source.id) throw new Error('Expected source effect to change node identity.')
  if (compiledPure.effect !== 'pure') throw new Error('Expected omitted effect to default to pure.')
  if (compiledSource.effect !== 'source') throw new Error('Expected source effect to be preserved.')
  return { pureId: pure.id, sourceId: source.id }
}

testDagNodeEffectDefaultsToPureAndAffectsIdentity.description =
  'Defaults DAG nodes to pure while preserving source effect in immutable identity.'
