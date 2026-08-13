import { SELF_HASH_PLACEHOLDER, hashFilePart } from './dagNodeIdentity.ts'
import {
  hashStoredGraphNodeSource,
  normalizeStoredGraphNodeSource,
  saveStoredGraphNodeRecord,
  saveStoredGraphNodeSource,
} from './dagNodeLoader.ts'
import { loadDesignRepositorySnapshot } from './designRepositorySnapshot.ts'
import { createGraphRevision } from './designGraphModel.ts'
import { createDagModuleArtifact, createDagModuleLock } from './dagModule.ts'
import { compileLockedDagNodeRunCode } from './dagModuleCompiler.ts'
import { executeDagNodeRun } from './dagNodeRecordCompiler.ts'

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

export const testStoredDagNodeNormalizationAcceptsLockedImports = async () => {
  const importedSource = `import { z } from 'zod'

export default ${nodeBody
    .replace(
      'inputs: {},',
      "inputs: {},\n  moduleLockId: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',",
    )
    .replace('run: () => ({ value: 1 })', 'run: () => ({ value: z.number().parse(1) })')}
`
  const normalized = await normalizeStoredGraphNodeSource(importedSource)
  assert(
    normalized.node.importSpecifiers?.[0] === 'zod',
    'Expected the static import to be recorded',
  )
  return { hash: await hashStoredGraphNodeSource(normalized.source), source: normalized.source }
}

testStoredDagNodeNormalizationAcceptsLockedImports.description =
  'Accepts explicit imports while keeping their immutable module lock in node identity.'

export const testDagModuleLockUsesExactReferrerMappings = () => {
  const moduleId = 'sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' as const
  const lock = createDagModuleLock({
    imports: {
      $node: { zod: moduleId },
      [moduleId]: { './helper.js': moduleId },
    },
    packages: {
      zod: { version: '4.0.5', integrity: 'sha512-test', moduleId },
    },
  })
  assert(lock.imports.$node?.zod === moduleId, 'Expected the node import to resolve exactly')
  assert(lock.id.startsWith('sha256:'), 'Expected a content-addressed module lock')
}

testDagModuleLockUsesExactReferrerMappings.description =
  'Locks imports by referrer and specifier without a node_modules installation.'

export const testLockedDagModulesCompileWithoutAmbientPackageResolution = async () => {
  const helper = createDagModuleArtifact({
    mediaType: 'text/typescript',
    source: `export const double = (value: number) => value * 2`,
  })
  const lock = createDagModuleLock({ imports: { $node: { './helper.ts': helper.id } } })
  const runCode = await compileLockedDagNodeRunCode({
    importsSource: `import { double } from './helper.ts'`,
    runSource: `({ params }) => double(Number(params.value))`,
    lock,
    modules: { [helper.id]: helper },
  })
  const value = await executeDagNodeRun({
    id: 'locked-module-test',
    runCode,
    run: undefined,
    params: { value: 4 },
    use: {},
  })
  assert(value === 8, 'Expected the locked helper module to execute')
}

testLockedDagModulesCompileWithoutAmbientPackageResolution.description =
  'Compiles a locked module closure without ambient package resolution.'

export const testStoredDagNodeReceivesFetchAsASeparateService = async () => {
  const value = await executeDagNodeRun({
    id: 'stored-fetch-service-test',
    runCode: `async ({ services }) => await (await services.fetch('https://example.test/value')).text()`,
    run: undefined,
    params: {},
    use: {},
    fetch: () => Promise.resolve(new Response('service-result')),
  })
  assert(
    value === 'service-result',
    `Expected stored code to use the injected fetch service, received ${String(value)}`,
  )
}

testStoredDagNodeReceivesFetchAsASeparateService.description =
  'Keeps network access separate from use, which remains reserved for DAG dependencies.'

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
  assert(saved.file.source.includes('export default {'), 'Expected standalone TypeScript source')
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
