import { canonicalHash } from './caching.ts'
import {
  mergeDagNodeRecordDefaults,
  planDagNodeRecordDeletion,
  replaceDagNodeRecordInputHashes,
} from './dagNodeRecordGraph.ts'
import { defineDagNodeRecord } from './dagNodeRecord.ts'

const schema = { type: 'object', additionalProperties: false } as const

export const testDagNodeRecordGraphRewritesDownstreamInputHashes = () => {
  const oldId = canonicalHash('old input')
  const newId = canonicalHash('new input')
  const definition = {
    formatVersion: 2 as const,
    id: canonicalHash('consumer'),
    localName: 'Consumer',
    label: 'Consumer',
    version: 3,
    localParamsSchema: schema,
    outputSchema: schema,
    inputs: { source: { nodeId: oldId, role: 'internal' as const } },
    runSource: 'async ({ use }) => await use.source({})',
  }
  const rewritten = replaceDagNodeRecordInputHashes(definition, new Map([[oldId, newId]]))
  const source = rewritten?.inputs?.source
  if (!source || 'kind' in source || source.nodeId !== newId) {
    throw new Error('Expected the downstream input to reference the replacement node hash.')
  }
  if (definition.inputs.source.nodeId !== oldId || definition.version !== 3) {
    throw new Error('Expected immutable rewriting to preserve the prior record and its version.')
  }
}

testDagNodeRecordGraphRewritesDownstreamInputHashes.description =
  'Rewrites stored DAG input hashes without mutating prior records.'

export const testDagNodeRecordGraphDefaultMergePreservesCustomNodes = async () => {
  const oldDefault = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'DefaultSource',
    label: 'Default source',
    version: 1,
    localParamsSchema: schema,
    outputSchema: schema,
    runSource: '() => ({ version: 1 })',
  })
  const newDefault = await defineDagNodeRecord({
    ...oldDefault,
    version: 2,
    runSource: '() => ({ version: 2 })',
  })
  const customConsumer = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'CustomConsumer',
    label: 'Custom consumer',
    version: 1,
    localParamsSchema: schema,
    outputSchema: schema,
    inputs: { source: { nodeId: oldDefault.id, role: 'internal' } },
    runSource: 'async ({ use }) => await use.source({})',
  })

  const merged = await mergeDagNodeRecordDefaults({
    local: [oldDefault, customConsumer],
    defaults: [newDefault],
  })
  const byName = Object.fromEntries(merged.definitions.map((node) => [node.localName, node]))
  const sourceRef = byName.CustomConsumer?.inputs?.source
  if (byName.DefaultSource?.id !== newDefault.id) {
    throw new Error('Expected the refreshed default definition to replace its prior revision.')
  }
  if (!sourceRef || 'kind' in sourceRef || sourceRef.nodeId !== newDefault.id) {
    throw new Error('Expected custom downstream inputs to follow the refreshed default hash.')
  }
  if (merged.updatedDefaultCount !== 1 || merged.preservedCustomCount !== 1) {
    throw new Error('Expected default and custom merge counts to remain explicit.')
  }
}

testDagNodeRecordGraphDefaultMergePreservesCustomNodes.description =
  'Refreshes stored defaults while preserving custom nodes and immutable dependencies.'

export const testDagNodeRecordGraphDeletionProtectsRemainingDependents = async () => {
  const source = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'Source',
    label: 'Source',
    version: 1,
    localParamsSchema: schema,
    outputSchema: schema,
    runSource: '() => ({ value: 1 })',
  })
  const consumer = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'Consumer',
    label: 'Consumer',
    version: 1,
    localParamsSchema: schema,
    outputSchema: schema,
    inputs: { source: { nodeId: source.id, role: 'internal' } },
    runSource: 'async ({ use }) => await use.source({})',
  })
  const blocked = planDagNodeRecordDeletion([source, consumer], new Set([source.id]))
  if (blocked.blockers.map(({ localName }) => localName).join() !== 'Consumer') {
    throw new Error('Expected deletion to report every remaining downstream dependent.')
  }
  const batch = planDagNodeRecordDeletion([source, consumer], new Set([source.id, consumer.id]))
  if (batch.blockers.length > 0 || batch.remaining.length > 0) {
    throw new Error('Expected an upstream/downstream batch deletion to remain valid.')
  }
}

testDagNodeRecordGraphDeletionProtectsRemainingDependents.description =
  'Prevents stored DAG deletion from leaving dangling immutable references.'
