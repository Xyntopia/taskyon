import { SELF_HASH_PLACEHOLDER, hashFilePart } from './dagNodeIdentity.ts'
import {
  hashStoredGraphNodeSource,
  normalizeStoredGraphNodeSource,
  saveStoredGraphNodeRecord,
  saveStoredGraphNodeSource,
} from './dagNodeLoader.ts'
import { loadDesignRepositorySnapshot } from './designRepositorySnapshot.ts'
import { createGraphRevision } from './designGraphModel.ts'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const nodeBody = `{
  formatVersion: 2,
  id: '${SELF_HASH_PLACEHOLDER}',
  localName: 'standalone_node',
  label: 'Standalone Node',
  version: 1,
  localParamsSchema: {},
  outputSchema: {},
  inputs: {},
  run: () => ({ value: 1 }),
}`

export const testStoredDagNodeNormalizationRejectsImportsAndTypeWrappers = async () => {
  const importedSource = `import type { StoredDagNodeDefinition } from '@taskyon/comp-dag/dagNodeLoader'

export default ${nodeBody} satisfies StoredDagNodeDefinition
`
  const standaloneSource = `export default ${nodeBody}\n`
  let rejected = false
  try {
    await normalizeStoredGraphNodeSource(importedSource)
  } catch {
    rejected = true
  }
  assert(rejected, 'Expected stored-node source with imports and type wrappers to be rejected')
  const standalone = await normalizeStoredGraphNodeSource(standaloneSource)
  return { hash: await hashStoredGraphNodeSource(standalone.source), source: standalone.source }
}

testStoredDagNodeNormalizationRejectsImportsAndTypeWrappers.description =
  'Requires stored design-graph nodes to use one standalone source format.'

export const testStoredDagNodeNormalizationAcceptsNegativeSchemaNumbers = async () => {
  const normalized = await normalizeStoredGraphNodeSource(
    `export default ${nodeBody.replace('localParamsSchema: {}', 'localParamsSchema: { properties: { longitude: { default: -118.24 } } }')}\n`,
  )
  const schema = normalized.node.localParamsSchema
  assert(
    typeof schema === 'object' && schema.properties?.longitude !== undefined,
    'Expected negative schema defaults to survive stored-node normalization',
  )
}

testStoredDagNodeNormalizationAcceptsNegativeSchemaNumbers.description =
  'Normalizes negative numeric literals in stored-node schemas.'

export const testStoredDagNodeSaveStabilizesFormattedRunSource = async () => {
  const source = `export default ${nodeBody.replace(
    'run: () => ({ value: 1 })',
    'run: async function run(ctx) { const value = Number(ctx.params.value ?? 1); return { value } }',
  )}\n`
  const saved = await saveStoredGraphNodeSource(source)
  const rehashed = await hashStoredGraphNodeSource(saved.file.source)
  assert(saved.hash === rehashed, 'Expected formatted stored-node source to retain its saved hash')
}

testStoredDagNodeSaveStabilizesFormattedRunSource.description =
  'Keeps complex formatted run source stable when saving a stored node.'

export const testStoredDagNodeRecordCanBeProjectedToTypescript = async () => {
  const normalized = await normalizeStoredGraphNodeSource(`export default ${nodeBody}\n`)
  const saved = await saveStoredGraphNodeRecord({
    ...normalized.node,
    id: await hashStoredGraphNodeSource(normalized.source),
  })
  assert(saved.file.source.startsWith('export default {'), 'Expected standalone TypeScript source')
  assert(
    saved.file.path === `${saved.hash.replace(':', '_')}.ts`,
    'Expected the stored filename to be addressable from its hash alone',
  )
}

testStoredDagNodeRecordCanBeProjectedToTypescript.description =
  'Projects an in-memory DAG node record into canonical hash-addressed TypeScript.'

export const testDesignRepositoryLoadsSavedNodeByHashPath = async () => {
  const saved = await saveStoredGraphNodeSource(`export default ${nodeBody}\n`, {
    directory: 'nodes',
  })
  const revision = createGraphRevision({
    parents: [],
    nodes: { main: saved.hash },
  })
  const files = new Map([
    [saved.file.path, saved.file.source],
    [`graph-revisions/${hashFilePart(revision.id)}.json`, JSON.stringify(revision)],
    ['refs/graph/main.json', JSON.stringify({ schemaVersion: 2, revisionId: revision.id })],
  ])
  const snapshot = await loadDesignRepositorySnapshot({
    readText: (path) => {
      const content = files.get(path)
      if (content === undefined) throw new Error(`Missing test repository file ${path}`)
      return Promise.resolve(content)
    },
    checkout: { kind: 'ref', name: 'graph/main' },
  })

  assert(snapshot.nodesByHash[saved.hash], 'Expected the revision root to load by hash-only path')
}

testDesignRepositoryLoadsSavedNodeByHashPath.description =
  'Loads a saved graph node through the same hash-only path used by design revisions.'

export const testStoredDagNodeNormalizationRunsWithoutBrowserProcess = async () => {
  if (typeof window === 'undefined') {
    return {
      skipped: true,
      reason: 'The missing process global is a browser runtime boundary.',
    }
  }

  const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process')
  const removed = Reflect.deleteProperty(globalThis, 'process')
  assert(
    removed || processDescriptor === undefined,
    'Expected the browser process shim to be removable',
  )

  try {
    const normalized = await normalizeStoredGraphNodeSource(`export default ${nodeBody}\n`)
    assert(
      normalized.source.startsWith('export default {'),
      'Expected stored-node normalization to work without a browser process global',
    )
    return { source: normalized.source }
  } finally {
    if (processDescriptor) Object.defineProperty(globalThis, 'process', processDescriptor)
  }
}

testStoredDagNodeNormalizationRunsWithoutBrowserProcess.description =
  'Normalizes a stored design-graph node when the browser has no Node process global.'
