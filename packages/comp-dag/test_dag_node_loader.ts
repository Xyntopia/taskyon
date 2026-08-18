import { SELF_HASH_PLACEHOLDER, hashFilePart } from './dagNodeIdentity.ts'
import {
  hashStoredGraphNodeSource,
  normalizeStoredGraphNodeSource,
  saveStoredGraphNodeRecord,
  saveStoredGraphNodeSource,
} from './dagNodeLoader.ts'
import {
  createCachedDagRunCodeCompiler,
  compileDesignRepositoryNodes,
  loadDesignRepositorySnapshot,
} from './designRepositorySnapshot.ts'
import { createGraphRevision } from './designGraphModel.ts'
import { createDagModuleArtifact, createDagModuleLock } from './dagModule.ts'
import { compileLockedDagNodeRunCode } from './dagModuleCompiler.ts'
import { executeDagNodeRun } from './dagNodeRecordCompiler.ts'
import { defineDagNodeRecord } from './dagNodeRecord.ts'
import { compileDagNodeRecordGraph } from './dagNodeRecordGraph.ts'

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
  outputSchema: { description: 'Produces a stable value for stored-node tests.' },
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

export const testStoredDagNodeKeepsNodeOwnedHelpers = async () => {
  const source = `const calculate = (value: number) => value * 2

export default ${nodeBody.replace(
    'run: () => ({ value: 1 })',
    'run: ({ params }) => ({ value: calculate(Number(params.value)) })',
  )}`
  const saved = await saveStoredGraphNodeSource(source)
  assert(saved.node.preambleSource?.includes('const calculate'), 'Expected the helper in the node')
  assert(
    saved.file.source.includes('const calculate'),
    'Expected saved source to retain the helper',
  )
}

testStoredDagNodeKeepsNodeOwnedHelpers.description =
  'Keeps first-party helper logic inside the immutable stored node source.'

export const testStoredDagNodeChecksEffectsInsideOwnedHelpers = async () => {
  let caught: unknown
  try {
    await saveStoredGraphNodeSource(`const download = () => fetch('https://example.com')

export default ${nodeBody.replace('run: () => ({ value: 1 })', 'run: () => download()')}`)
  } catch (error) {
    caught = error
  }
  assert(
    caught instanceof Error && caught.message.includes('ambient fetch'),
    'Expected helper effects to require a source node declaration',
  )
}

testStoredDagNodeChecksEffectsInsideOwnedHelpers.description =
  'Validates effects in node-owned helper declarations as part of the node source.'

export const testDagModuleLockUsesExactReferrerMappings = () => {
  const moduleId = 'sha256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' as const
  const lock = createDagModuleLock({
    imports: {
      $node: {
        zod: { kind: 'package', name: 'zod' },
        './module.ts': { kind: 'module', id: moduleId },
      },
      [moduleId]: { './helper.js': { kind: 'module', id: moduleId } },
    },
    packages: {
      zod: { range: '^4.0.0' },
    },
  })
  assert(
    lock.imports.$node?.zod?.kind === 'package',
    'Expected the package import to remain distinct from stored modules',
  )
  assert(
    lock.imports.$node?.['./module.ts']?.kind === 'module',
    'Expected the stored module import to resolve exactly',
  )
  assert(lock.id.startsWith('sha256:'), 'Expected a content-addressed module lock')
}

testDagModuleLockUsesExactReferrerMappings.description =
  'Separates package requirements from content-addressed stored module imports.'

export const testLockedDagModulesCompileWithoutAmbientPackageResolution = async () => {
  const helper = createDagModuleArtifact({
    mediaType: 'text/typescript',
    source: `export const double = (value: number) => value * 2`,
  })
  const lock = createDagModuleLock({
    imports: { $node: { './helper.ts': { kind: 'module', id: helper.id } } },
  })
  const runCode = await compileLockedDagNodeRunCode({
    nodeId: 'sha256:CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
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

export const testLockedDagModulesCompileWithBrowserProcessShim = async () => {
  if (typeof window === 'undefined') {
    return {
      skipped: true,
      reason: 'The partial process shim is a browser runtime boundary.',
    }
  }

  const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process')
  Object.defineProperty(globalThis, 'process', {
    configurable: true,
    value: { env: {} },
  })

  try {
    const helper = createDagModuleArtifact({
      mediaType: 'text/typescript',
      source: `import type { Feature } from 'geojson'
export const featureId = (feature: Feature) => String(feature.id)`,
    })
    const lock = createDagModuleLock({
      imports: { $node: { './helper.ts': { kind: 'module', id: helper.id } } },
    })
    const runCode = await compileLockedDagNodeRunCode({
      nodeId: 'sha256:DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD',
      importsSource: `import { featureId } from './helper.ts'`,
      runSource: `({ params }) => featureId(params.feature)`,
      lock,
      modules: { [helper.id]: helper },
    })
    const value = await executeDagNodeRun({
      id: 'browser-process-shim-test',
      runCode,
      run: undefined,
      params: { feature: { id: 'parcel-1', type: 'Feature', properties: {}, geometry: null } },
      use: {},
    })
    assert(value === 'parcel-1', 'Expected type-only imports to require no browser resolution')
  } finally {
    if (processDescriptor) Object.defineProperty(globalThis, 'process', processDescriptor)
    else Reflect.deleteProperty(globalThis, 'process')
  }
}

testLockedDagModulesCompileWithBrowserProcessShim.description =
  'Compiles type-only locked imports with the partial process shim provided by browser hosts.'

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

export const testDagNodeRecordGraphCompilesStoredClosureInDependencyOrder = async () => {
  const upstream = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'upstream',
    label: 'Upstream',
    version: 1,
    localParamsSchema: {},
    outputSchema: { type: 'number' },
    runSource: '() => 2',
    run: () => 2,
  })
  const downstream = await defineDagNodeRecord({
    formatVersion: 2,
    localName: 'downstream',
    label: 'Downstream',
    version: 1,
    localParamsSchema: {},
    outputSchema: { type: 'number' },
    inputs: { value: { nodeId: upstream.id, role: 'internal' } },
    runSource: '({ use }) => Number(use.value) * 3',
    run: ({ use }) => Number(use.value) * 3,
  })
  const compiledNames: string[] = []
  const compiled = compileDagNodeRecordGraph({
    graph: { [downstream.id]: downstream, [upstream.id]: upstream },
    onProgress: ({ record, completed, total }) => {
      compiledNames.push(`${record.localName}:${completed}/${total}`)
    },
  })
  assert(
    compiledNames.join(',') === 'upstream:1/2,downstream:2/2',
    `Expected deterministic dependency order, received ${compiledNames.join(',')}`,
  )
  assert(compiled[upstream.id] && compiled[downstream.id], 'Expected the complete stored graph')
}

testDagNodeRecordGraphCompilesStoredClosureInDependencyOrder.description =
  'Compiles stored graph revisions deterministically and reports each compiler phase.'

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
  const compiled = compileDagNodeRecordGraph({
    graph: { [saved.node.id]: saved.node },
    rootHash: saved.node.id,
  })[saved.node.id]
  assert(
    compiled?.description === 'Produces a stable value for stored-node tests.',
    'Expected the compiled node to expose its output schema description',
  )
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

export const testDesignRepositoryCompilesImportedNodesOnlyOnDemand = async () => {
  const module = createDagModuleArtifact({
    mediaType: 'text/typescript',
    source: 'export const double = (value: number) => value * 2',
  })
  const lock = createDagModuleLock({
    imports: { $node: { './double': { kind: 'module', id: module.id } } },
  })
  const saved = await saveStoredGraphNodeRecord(
    await defineDagNodeRecord({
      formatVersion: 2,
      localName: 'lazy_compilation',
      label: 'Lazy compilation',
      version: 1,
      importsSource: "import { double } from './double'",
      moduleLockId: lock.id,
      runSource: '({ params }) => double(Number(params.value))',
      localParamsSchema: {},
      outputSchema: {},
    }),
  )
  const revision = createGraphRevision({ parents: [], nodes: { main: saved.hash } })
  const files = new Map([
    [`nodes/${saved.file.path}`, saved.file.source],
    [`modules/${hashFilePart(module.id)}.json`, JSON.stringify(module)],
    [`module-locks/${hashFilePart(lock.id)}.json`, JSON.stringify(lock)],
    [`graph-revisions/${hashFilePart(revision.id)}.json`, JSON.stringify(revision)],
    ['refs/graph/main.json', JSON.stringify({ schemaVersion: 2, revisionId: revision.id })],
  ])
  const snapshot = await loadDesignRepositorySnapshot({
    readText: async (path) => {
      const content = files.get(path)
      if (content === undefined) throw new Error(`Missing test repository file ${path}`)
      return content
    },
    checkout: { kind: 'ref', name: 'graph/main' },
  })
  assert(
    snapshot.nodesByHash[saved.hash]?.node.runCode === undefined,
    'Repository loading must not compile imported node code.',
  )
  let compilationCount = 0
  const compiled = await compileDesignRepositoryNodes(snapshot, {
    get: () => Promise.resolve(null),
    compile: (input) => {
      compilationCount += 1
      const code = '({ params }) => Number(params.value) * 2'
      return Promise.resolve({
        schemaVersion: 1,
        cacheId: 'direct-test',
        compilerAbi: 'test-compiler-v1',
        nodeId: input.nodeId,
        ...(input.lock ? { moduleLockId: input.lock.id } : {}),
        sourceBytes: 1,
        outputBytes: code.length,
        packages: [],
        code,
      })
    },
  })
  assert(compilationCount === 1, 'Expected the imported node to compile exactly once on demand.')
  assert(
    compiled[saved.hash]?.node.runCode === '({ params }) => Number(params.value) * 2',
    'Expected explicit compilation to attach deterministic run code.',
  )
  const cache = new Map<string, unknown>()
  const cachedCompiler = createCachedDagRunCodeCompiler(
    {
      get: async (id) => cache.get(id) ?? null,
      set: async (id, value) => {
        cache.set(id, value)
      },
    },
    {
      compilerAbi: 'test-compiler-v1',
      resolvePackages: () => Promise.resolve([]),
      compile: (input) => {
        compilationCount += 1
        const code = '({ params }) => Number(params.value) * 3'
        return Promise.resolve({
          schemaVersion: 1,
          compilerAbi: 'test-compiler-v1',
          nodeId: input.nodeId,
          ...(input.lock ? { moduleLockId: input.lock.id } : {}),
          sourceBytes: 1,
          outputBytes: code.length,
          packages: [],
          code,
        })
      },
    },
  )
  const compilerInput = {
    nodeId: saved.hash,
    importsSource: saved.node.importsSource!,
    runSource: saved.node.runSource,
    lock,
    modules: { [module.id]: module },
  }
  const [firstCached, concurrentCached] = await Promise.all([
    cachedCompiler.compile(compilerInput),
    cachedCompiler.compile(compilerInput),
  ])
  const persistedCached = await createCachedDagRunCodeCompiler(
    {
      get: async (id) => cache.get(id) ?? null,
      set: async (id, value) => {
        cache.set(id, value)
      },
    },
    {
      compilerAbi: 'test-compiler-v1',
      resolvePackages: () => Promise.resolve([]),
      compile: () => {
        throw new Error('The persisted compiler cache should have been reused.')
      },
    },
  ).compile(compilerInput)
  const observedCompilationCount = Number(compilationCount)
  assert(
    observedCompilationCount === 2 &&
      firstCached.code === concurrentCached.code &&
      concurrentCached.code === persistedCached.code,
    'Expected concurrent and persisted compiler cache hits to reuse one compilation.',
  )
}

testDesignRepositoryCompilesImportedNodesOnlyOnDemand.description =
  'Keeps repository reads lightweight and compiles imported stored-node code only on demand.'

export const testCompilerCacheIncludesExactPackageProvider = async () => {
  const cache = new Map<string, unknown>()
  let version = '4.0.5'
  let compilationCount = 0
  const compiler = createCachedDagRunCodeCompiler(
    {
      get: async (id) => cache.get(id) ?? null,
      set: async (id, value) => {
        cache.set(id, value)
      },
    },
    {
      compilerAbi: 'package-cache-test-v1',
      resolvePackages: () =>
        Promise.resolve([{ name: 'zod', version, integrity: `sha256:${version}` }]),
      compile: (input, packages) => {
        compilationCount += 1
        const code = `() => ${JSON.stringify(packages[0]?.version)}`
        return Promise.resolve({
          schemaVersion: 1,
          compilerAbi: 'package-cache-test-v1',
          nodeId: input.nodeId,
          sourceBytes: input.runSource.length,
          outputBytes: code.length,
          packages,
          code,
        })
      },
    },
  )
  const input = {
    nodeId: 'sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' as const,
    runSource: '() => 1',
    modules: {},
  }
  const first = await compiler.compile(input)
  version = '4.1.0'
  const second = await compiler.compile(input)
  assert(compilationCount === 2, 'Expected the provider change to invalidate the artifact cache')
  assert(first.cacheId !== second.cacheId, 'Expected exact providers in compiled artifact identity')
}

testCompilerCacheIncludesExactPackageProvider.description =
  'Keys compiled artifacts by exact resolved package version and integrity.'

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
