import { createDagPackageArtifactResolver } from './dagPackageArtifact.ts'
import { parseDagModuleLock } from './dagModule.ts'
import { parseGraphSourceLock } from './designGraphSourceLock.ts'
import {
  resolveAuthoredGraph,
  parseGraphLock,
  validateGraphLock,
  updateAuthoredGraphRecords,
  parseAuthoredGraphDefinition,
  createCachedAuthoredGraphReader,
} from './dagGraphAuthoring.ts'
import {
  compileDesignGraphSourcesWithCache,
  compileDesignGraphSources,
  updateDesignGraphSourceLock,
} from './designGraphSources.ts'
import { exportDesignGraphSources } from './designGraphSourceExport.ts'
import { compileDagNodeRecordGraph } from './dagNodeRecordGraph.ts'

import { canonicalHash, type Hash } from './caching.ts'
import { canonicalJson } from '@taskyon/common/modules/canonicalHash'
import { publishAuthoredGraph, readAuthoredGraph } from './dagGraphAuthoring.ts'
import { createMemoryStore, createMemoryRecords } from './test_design_graph_architecture.ts'
import { httpSourceDeclaration } from './httpSource.ts'
import { createStorageDagBackend } from './storageDagBackend.ts'
import { createSourceManifestRepository, createSourceSnapshot } from './sourceManifest.ts'
import {
  loadDesignRepositorySnapshot,
  loadProjectRepositorySnapshot,
  createDesignRepositoryFileReader,
  loadDesignRepositoryNodeClosure,
} from './designRepositorySnapshot.ts'
import { saveStoredGraphNodeRecord } from './dagNodeLoader.ts'
import {
  projectDesignGraphSnapshot,
  importDesignGraphSnapshot,
  synchronizeDesignGraphRepository,
} from './dagGitProjection.ts'
import { createDesignGraphRepository } from './designGraphRepository.ts'
import {
  createInvocationDefinition,
  createGraphRevision,
  parseDesignGraphRef,
} from './designGraphModel.ts'

import {
  iterateInvocationCandidates,
  createDagInvocationEvaluators,
} from './invocationExecution.ts'

export const testGraphSourceCompilationCacheIsDisposableAndSourceBound = async () => {
  const source = {
    path: 'nodes/value.ts',
    content: `export default { formatVersion: 3, outputSchema: { type: 'number' }, ids: { value: { label: 'Value' } }, run: () => 1 }`,
  }
  const files = await updateDesignGraphSourceLock([source])
  const records = new Map<Hash, unknown>()
  const statuses: string[] = []
  let writes = 0
  const cache = {
    get: (id: Hash) => Promise.resolve(records.get(id)),
    set: (id: Hash, value: unknown) => {
      writes += 1
      records.set(id, value)
      return Promise.resolve()
    },
    onStatus: (status: string) => {
      statuses.push(status)
    },
  }
  const first = await compileDesignGraphSourcesWithCache(files, cache)
  const hit = await compileDesignGraphSourcesWithCache([...files].reverse(), cache)
  if (
    writes !== 1 ||
    statuses.join(',') !== 'miss,hit' ||
    canonicalHash(first) !== canonicalHash(hit)
  )
    throw new Error('Expected persisted compilation reuse independent of source ordering.')
  const key = [...records.keys()][0]!
  records.set(key, { sourceHash: key, contentHash: canonicalHash([]), files: first })
  const repaired = await compileDesignGraphSourcesWithCache(files, cache)
  if (Number(writes) !== 2 || canonicalHash(repaired) !== canonicalHash(first))
    throw new Error('Expected a corrupt checksum to rebuild the disposable cache.')
  records.set(key, { invalid: true })
  await compileDesignGraphSourcesWithCache(files, cache)
  records.clear()
  await compileDesignGraphSourcesWithCache(files, cache)
  if (Number(writes) !== 4) throw new Error('Expected malformed and missing entries to rebuild.')
  const changed = { ...source, content: source.content.replace('() => 1', '() => 2') }
  let rejected = false
  try {
    await compileDesignGraphSourcesWithCache(
      files.map((file) => (file.path === source.path ? changed : file)),
      cache,
    )
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('Stale graph.lock')
  }
  if (!rejected) throw new Error('A cache must not conceal source changes with a stale lock.')
  const next = await compileDesignGraphSourcesWithCache(
    await updateDesignGraphSourceLock([changed]),
    cache,
  )
  if (canonicalHash(next) === canonicalHash(first))
    throw new Error('Expected changed sources and an updated lock to invalidate compilation.')
}
testGraphSourceCompilationCacheIsDisposableAndSourceBound.description =
  'Reuses source-bound compiled bundles across calls; rebuilds corrupt or deleted cache entries and rejects stale locks.'

export const testAuthoredGraphReaderCachesValidatedLockAndRetriesFailures = async () => {
  const { store } = createMemoryStore()
  const files = [
    {
      path: 'nodes/value.ts',
      source: `export default { formatVersion: 3, outputSchema: { type: 'number' }, ids: { value: { label: 'First value' } }, run: () => 1 }`,
    },
  ]
  const first = await publishAuthoredGraph({ store, files, expectedGraphRevisionId: null })
  let reads = 0
  let failNext = true
  const read = createCachedAuthoredGraphReader({
    readText: async (path) => {
      reads += 1
      if (failNext) {
        failNext = false
        throw new Error('Synthetic read failure')
      }
      return await store.readText(path)
    },
  })
  let failed = false
  try {
    await read(first.lock.id)
  } catch {
    failed = true
  }
  if (!failed) throw new Error('Expected the first read to fail.')
  const loaded = await Promise.all([read(first.lock.id), read(first.lock.id)])
  const afterLoad = reads
  await read(first.lock.id)
  if (reads !== afterLoad || afterLoad !== 3 || loaded[0].bindingLabels.value !== 'First value')
    throw new Error('Expected concurrent and repeated reads to reuse one validated lock.')
  const snapshot = await loadDesignRepositorySnapshot({
    readText: (path) => {
      if (path.startsWith('authoring/') || path.startsWith('graph-locks/'))
        throw new Error('Snapshot loading bypassed the validated authoring reader.')
      return store.readText(path)
    },
    loadAuthoredGraph: read,
    checkout: { kind: 'ref', name: 'graph/main' },
  })
  if (snapshot.nodesByHash[first.bindings.value!]!.node.label !== 'First value')
    throw new Error('Expected the snapshot to retain the validated binding label.')
  const next = await publishAuthoredGraph({
    store,
    files: [{ ...files[0]!, source: files[0]!.source.replace('First value', 'Second value') }],
    expectedGraphRevisionId: first.revision.id,
  })
  if ((await read(next.lock.id)).bindingLabels.value !== 'Second value' || reads <= afterLoad)
    throw new Error('Expected a new lock to load and validate the updated graph.')
  if ((await read(first.lock.id)).bindingLabels.value !== 'First value')
    throw new Error('Expected historical lock identity to remain independent of the active graph.')
}
testAuthoredGraphReaderCachesValidatedLockAndRetriesFailures.description =
  'Reuses validated immutable authoring locks across reads, coalesces concurrent reads, and retries failures.'

export const testGraphAuthoringSourceBundleGeneratesStorageAtBoot = async () => {
  const sources = [
    {
      path: 'nodes/count.ts',
      content: `import { answer } from './answer.ts'; export default { formatVersion: 3, moduleImports: 'count', outputSchema: { type: 'number', description: 'A synthetic calculation.' }, ids: { count: { label: 'Synthetic count', inputs: {} } }, run: () => answer() }`,
    },
    { path: 'modules/answer.ts', content: 'export const answer = () => 7\n' },
    {
      path: 'imports/count.json',
      content: JSON.stringify({
        imports: { $node: { './answer.ts': { module: 'modules/answer.ts' } } },
      }),
    },
    { path: 'assets/example-report.md', content: '# Synthetic authored report\n' },
    {
      path: 'projects/example.json',
      content: JSON.stringify({
        displayName: 'Synthetic project',
        refs: ['example', 'templates/example'],
        templates: { report: 'assets/example-report.md' },
        invocations: {
          main: {
            root: 'count',
            configuration: {
              variables: {},
              inputs: {},
              objectives: [],
              constraints: [],
              capture: [],
              policy: { accuracy: 'exact' },
              reducerOverrides: {},
            },
          },
        },
        extensions: {
          view: {
            namespace: 'synthetic.view',
            value: {
              study: 'invocation:main',
              title: 'An authored choice',
              template: 'template:report',
            },
            dependencies: { invocations: { report: 'template:report' } },
          },
        },
      }),
    },
  ]
  const lockedSources = await updateDesignGraphSourceLock(sources)
  const first = await compileDesignGraphSources(lockedSources)
  const second = await compileDesignGraphSources([...lockedSources].reverse())
  if (canonicalHash(first) !== canonicalHash(second))
    throw new Error('Boot compilation must be deterministic and independent of directory order.')
  if (
    sources.some(({ path }) => path.includes('sha256_')) ||
    !first.some(({ path }) => path.startsWith('graph-locks/'))
  )
    throw new Error('Authored inputs and generated storage objects must be separate.')
  const memory = createMemoryStore()
  const records = createMemoryRecords()
  await importDesignGraphSnapshot({
    store: memory.store,
    sourceRecords: records,
    files: lockedSources,
  })
  const snapshot = await loadDesignRepositorySnapshot({
    readText: memory.store.readText,
    checkout: { kind: 'ref', name: 'graph/main' },
  })
  const rootHash = snapshot.revision.nodes.count!
  if (!snapshot.nodesByHash[rootHash])
    throw new Error('First boot must create the executable graph.')
  if (snapshot.nodesByHash[rootHash].node.label !== 'Synthetic count')
    throw new Error('Graph snapshots must recover labels from authored bindings.')
  const projectSnapshot = await loadProjectRepositorySnapshot({
    readText: memory.store.readText,
    checkout: { kind: 'ref', name: 'projects/example' },
  })
  if (projectSnapshot.nodesByHash[rootHash]?.node.localName !== 'count')
    throw new Error(
      'Project roots must recover readable binding names without changing node identity.',
    )
  if (projectSnapshot.nodesByHash[rootHash]?.node.label !== 'Synthetic count')
    throw new Error('Project snapshots must recover authored labels without lock metadata.')
  const portable = await projectDesignGraphSnapshot({
    store: memory.store,
    sourceRecords: records,
    selector: { kind: 'project', projectRef: 'projects/example' },
  })
  const exported = await exportDesignGraphSources(portable)
  if (
    exported.some(
      ({ path }) =>
        (path !== 'graph.lock.json' &&
          !['nodes', 'modules', 'imports', 'projects', 'assets'].includes(path.split('/')[0]!)) ||
        path.includes('sha256_'),
    )
  )
    throw new Error('Source export must not contain generated object paths.')
  const rebuilt = await compileDesignGraphSources(exported)
  const extension = rebuilt.find(({ path }) => path.startsWith('extensions/'))
  if (
    !extension?.content.includes('An authored choice') ||
    !exported.some(({ content }) => content === '# Synthetic authored report\n')
  )
    throw new Error('Project choices and report text must survive the source round trip.')
}
const scalar = (id: string, value: number) => ({
  path: `nodes/${id}.ts`,
  source: `export default {
    formatVersion: 3, version: 1,
    localParamsSchema: { type: 'object', properties: {}, additionalProperties: false },
    outputSchema: { type: 'number' },
    ids: { ${id}: { inputs: {} } },
    run: async () => ${value},
  }`,
})

const consumer = {
  path: 'nodes/double.ts',
  source: `export default {
    formatVersion: 3, version: 1,
    localParamsSchema: { type: 'object', properties: {}, additionalProperties: false },
    inputsSchema: { value: { type: 'number' } }, outputSchema: { type: 'number' },
    ids: {
      doubledA: { inputs: { value: { source: 'a' } } },
      doubledB: { inputs: { value: { source: 'b' } } },
      doubledAgain: { inputs: { value: { source: 'a' } } },
    },
    run: async ({ use }) => (await use.value({})) * 2,
  }`,
}

const explodedConsumerFiles = () => [
  {
    path: 'nodes/values.ts',
    source: `export default { formatVersion: 3,
      outputSchema: { type: 'object', properties: { items: { type: 'array', items: { type: 'number' } } } },
      ids: { values: { label: 'Candidate values', inputs: {} } },
      run: () => ({ items: [2, 3] }) }`,
  },
  {
    ...consumer,
    source: consumer.source
      .replaceAll("source: 'a'", "source: 'values', explode: 'items'")
      .replaceAll("source: 'b'", "source: 'values', explode: 'items'"),
  },
]

export const testGraphAuthoringCompactLocksPinEveryNode = async () => {
  const files = explodedConsumerFiles()
  const resolved = await resolveAuthoredGraph(files)
  const lock = parseGraphLock(resolved.lock)
  if (
    lock.schemaVersion !== 3 ||
    ['applications', 'definitions', 'sourceHashes', 'nodeHashes'].some((key) => key in lock)
  )
    throw new Error('Compact locks must use version 3 without copied or duplicated records.')
  if (canonicalJson(lock.bindings) !== canonicalJson(resolved.bindings))
    throw new Error('Bindings must pin readable IDs directly to recursive node hashes.')
  const closure = [...new Set([...Object.values(lock.bindings), ...lock.unboundNodes])].sort()
  if (canonicalJson(closure) !== canonicalJson(Object.keys(resolved.resolvedNodes).sort()))
    throw new Error('Named bindings plus unbound nodes must cover every resolved computation.')
  if (lock.unboundNodes.length !== 1 || new Set(Object.values(lock.bindings)).size !== 2)
    throw new Error('Equivalent aliases must share nodes while the inline explode stays pinned.')
  const serialized = canonicalJson(lock)
  if (
    ['outputSchema', 'inputsSchema', 'localParamsSchema', 'Candidate values'].some((key) =>
      serialized.includes(key),
    )
  )
    throw new Error('A lock must not copy schemas or presentation labels from its nodes.')
  const { id, ...content } = lock
  const incomplete = { ...content, unboundNodes: [] }
  const incompleteLock = {
    ...incomplete,
    id: canonicalHash({ kind: 'taskyon.graphLock.v3', ...incomplete }),
  }
  if (incompleteLock.id === id) throw new Error('Removing a node pin must change lock identity.')
  let rejected = false
  try {
    await validateGraphLock(files, incompleteLock)
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('Even a self-consistent lock must pin the full resolved closure.')
}
testGraphAuthoringCompactLocksPinEveryNode.description =
  'Compact locks pin every recursive computation through named bindings and unbound node hashes without copying node records.'

export const testGraphAuthoringLabelsDoNotInvalidateComputations = async () => {
  const files = explodedConsumerFiles()
  const original = await resolveAuthoredGraph(files)
  const relabeled = await resolveAuthoredGraph(
    files.map((file) => ({
      ...file,
      source: file.source.replace('Candidate values', 'Renamed values'),
    })),
  )
  if (
    original.bindingLabels.values !== 'Candidate values' ||
    relabeled.bindingLabels.values !== 'Renamed values'
  )
    throw new Error('Resolved labels must come from the current authored bindings.')
  if (
    canonicalJson(relabeled.bindings) !== canonicalJson(original.bindings) ||
    relabeled.lock.id === original.lock.id
  )
    throw new Error('Label edits must change source pins without invalidating computations.')
}
testGraphAuthoringLabelsDoNotInvalidateComputations.description =
  'Authored label edits update source pins and display metadata without changing recursive computation identities.'

export const testGraphAuthoringRejectsOldLockFormats = async () => {
  const files = explodedConsumerFiles()
  const { lock } = await resolveAuthoredGraph(files)
  const lockedSources = await updateDesignGraphSourceLock(
    files.map(({ path, source }) => ({ path, content: source })),
  )
  const sourceLock = parseGraphSourceLock(
    JSON.parse(lockedSources.find(({ path }) => path === 'graph.lock.json')!.content),
  )
  if (sourceLock.schemaVersion !== 3 || sourceLock.graph.id !== lock.id)
    throw new Error('Source locks must embed the same version-3 graph lock.')
  for (const parseOld of [
    () => parseGraphLock({ ...lock, schemaVersion: 2 }),
    () => parseGraphLock({ ...lock, schemaVersion: 1 }),
    () => parseGraphSourceLock({ ...sourceLock, schemaVersion: 2 }),
    () => parseGraphSourceLock({ ...sourceLock, schemaVersion: 1 }),
  ]) {
    let oldRejected = false
    try {
      parseOld()
    } catch (error) {
      oldRejected = error instanceof Error && error.message.includes('Unsupported')
    }
    if (!oldRejected) throw new Error('Old lock formats must fail explicitly without migration.')
  }
}
testGraphAuthoringRejectsOldLockFormats.description =
  'Graph and source lock readers require version 3 and reject old formats without migration.'

export const testGraphAuthoringReusesDefinitionsAndRecursiveIdentities = async () => {
  const files = [scalar('a', 2), scalar('b', 3), consumer]
  const first = await resolveAuthoredGraph(files)
  const second = await resolveAuthoredGraph([scalar('a', 4), ...files.slice(1)])
  if (first.bindings.doubledA !== first.bindings.doubledAgain)
    throw new Error('Equivalent applications must share their computation identity.')
  if (first.bindings.doubledA === first.bindings.doubledB)
    throw new Error('Different upstream computations must produce different applications.')
  if (first.bindings.doubledA === second.bindings.doubledA)
    throw new Error('Upstream edits must recursively invalidate consumers.')
  if (first.bindings.doubledB !== second.bindings.doubledB)
    throw new Error('An unrelated branch must retain its identity.')
  const graph = compileDagNodeRecordGraph({ graph: first.resolvedNodes })
  const result = await graph[first.bindings.doubledB!]!.call({}).run(undefined, {
    execution: { mode: 'local' },
  })
  if (result.value !== 6) throw new Error('Resolved applications must execute through the DAG.')
}
testGraphAuthoringReusesDefinitionsAndRecursiveIdentities.description =
  'Reusable graph authoring shares definitions and recursively hashes exact input connections.'

export const testGraphAuthoringEditorRetainsSharedDefinitionsAndEquivalentBindings = async () => {
  const files = [scalar('a', 2), scalar('b', 3), consumer]
  const before = await resolveAuthoredGraph(files)
  const records = ['a', 'b', 'doubledA', 'doubledB'].map((name) => ({
    ...before.resolvedNodes[before.bindings[name]!]!,
    localName: name,
    label: name,
    ...(name === 'doubledA'
      ? { runSource: 'async ({ use }) => (await use.value({})) * 3', version: 2 }
      : {}),
  }))
  const authored = await updateAuthoredGraphRecords(files, records)
  const after = await resolveAuthoredGraph(authored)
  if (authored.length !== 3 || !after.bindings.doubledAgain)
    throw new Error(
      'Editor saves must preserve shared source files and equivalent binding aliases.',
    )
  const graph = compileDagNodeRecordGraph({ graph: after.resolvedNodes })
  const result = await graph[after.bindings.doubledB!]!.call({}).run(undefined, {
    execution: { mode: 'local' },
  })
  if (result.value !== 9)
    throw new Error('A shared implementation edit must apply to every binding.')
}
testGraphAuthoringEditorRetainsSharedDefinitionsAndEquivalentBindings.description =
  'Record-based editor saves retain definition sharing, equivalent aliases, and shared implementation edits.'

export const testGraphAuthoringLocksAreDeterministicAndVerified = async () => {
  const files = [scalar('a', 2), scalar('b', 3), consumer]
  const first = await resolveAuthoredGraph(files)
  const reordered = await resolveAuthoredGraph([...files].reverse())
  if (first.lock.id !== reordered.lock.id) throw new Error('File order must not change the lock.')
  await validateGraphLock(files, structuredClone(first.lock))
  let rejected = false
  try {
    await validateGraphLock(files, { ...first.lock, id: canonicalHash('tampered') })
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('Tampered locks must be rejected.')
  rejected = false
  try {
    await validateGraphLock([scalar('a', 5), ...files.slice(1)], first.lock)
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('An edited definition must not silently use its old lock.')
}
testGraphAuthoringLocksAreDeterministicAndVerified.description =
  'Reusable graph locks are deterministic and reject tampering and stale authored definitions.'

export const testGraphAuthoringCanonicalReaderRejectsTamperedApplications = async () => {
  const resolved = await resolveAuthoredGraph([scalar('a', 2)])
  const saved = await saveStoredGraphNodeRecord(resolved.resolvedNodes[resolved.bindings.a!]!, {
    directory: 'nodes',
  })
  const tampered = saved.file.source.replace('=> 2', '=> 99')
  if (tampered === saved.file.source)
    throw new Error('The tampering fixture must change the executable source.')
  const reader = createDesignRepositoryFileReader([{ path: saved.file.path, content: tampered }])
  let rejected = false
  try {
    await loadDesignRepositoryNodeClosure({ readText: reader.readText, rootNodeId: saved.hash })
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('does not match normalized hash')
    if (!rejected) throw error
  }
  if (!rejected)
    throw new Error('Canonical path lookup must still validate application bytes before execution.')
}
testGraphAuthoringCanonicalReaderRejectsTamperedApplications.description =
  'Fast canonical path lookup retains strict application content-hash validation at closure loading.'

export const testGraphAuthoringChoosesProvidersExplicitly = async () => {
  const selected = {
    ...consumer,
    source: consumer.source.replace(
      /ids: \{[\s\S]*?\n {4}\},/,
      `ids: { selected: { inputs: { value: {
        sources: { first: 'a', second: 'b' },
        choose: { parameter: 'provider', default: 'first' },
      } } } },`,
    ),
  }
  const resolved = await resolveAuthoredGraph([scalar('a', 2), scalar('b', 7), selected])
  const graph = compileDagNodeRecordGraph({ graph: resolved.resolvedNodes })
  const root = graph[resolved.bindings.selected!]!
  const result = await root.call({ value: { provider: 'second' } }).run(undefined, {
    execution: { mode: 'local' },
  })
  if (result.value !== 14) throw new Error('Same-schema providers must be selected by name.')
}
testGraphAuthoringChoosesProvidersExplicitly.description =
  'Reusable graph choose expressions expose a named provider parameter instead of schema guessing.'

export const testGraphAuthoringSelectorPlansChosenExplodedDomain = async () => {
  const list = {
    path: 'nodes/list.ts',
    source: `export default {
    formatVersion: 3, outputSchema: { type: 'object', properties: { items: { type: 'array', items: { type: 'number' } } }, required: ['items'] },
    ids: { values: { inputs: {} } }, run: async () => ({ items: [2, 5, 9] }),
  }`,
  }
  const expanded = {
    path: 'nodes/expanded.ts',
    source: `export default {
    formatVersion: 3, definition: 'taskyon:explode',
    ids: {
      candidates: { inputs: { source: { source: 'values' } }, settings: { path: 'items' } },
      secondCandidates: { inputs: { source: { source: 'otherValues' } }, settings: { path: 'items' } },
    },
  }`,
  }
  const selected = {
    path: 'nodes/selected.ts',
    source: `export default {
    formatVersion: 3, outputSchema: { type: 'number' },
    ids: { selected: { inputs: { value: { sources: { candidates: 'candidates', second: 'secondCandidates' }, choose: { parameter: 'provider', default: 'candidates' } } } } },
    run: async ({ use }) => await use.value({}),
  }`,
  }
  const otherList = {
    path: 'nodes/otherList.ts',
    source: list.source.replace('values: {', 'otherValues: {').replace('[2, 5, 9]', '[11]'),
  }
  const resolved = await resolveAuthoredGraph([list, otherList, expanded, selected])
  const graph = compileDagNodeRecordGraph({ graph: resolved.resolvedNodes })
  const root = graph[resolved.bindings.selected!]!
  const study = await root
    .call({ value: { provider: 'candidates' } })
    .study({ mode: 'explore' }, undefined, { execution: { mode: 'local' } })
  if (study.rows.join() !== '2,5,9')
    throw new Error(
      'Selector planning must address the selected provider itemIndex, not the selector itself.',
    )
  let rejected = false
  try {
    await root.call({ value: { provider: 'candidates' } }).study(
      {
        variables: { 'value.provider': { kind: 'list', values: ['candidates', 'second'] } },
      },
      undefined,
      { execution: { mode: 'local' } },
    )
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('invocation variables')
  }
  if (!rejected)
    throw new Error('Direct study sweeps must not reuse another provider candidate domain.')
  const invocation = createInvocationDefinition({
    rootNodeId: resolved.bindings.selected!,
    variables: { 'value.provider': { kind: 'list', values: ['candidates', 'second'] } },
    inputs: { value: { strategy: { id: 'sequential' } } },
    objectives: [],
    constraints: [],
    capture: [],
    policy: { accuracy: 'exact' },
    reducerOverrides: {},
  })
  const evaluator = createDagInvocationEvaluators({
    root,
    invocation,
    engineConfig: { execution: { mode: 'local' } },
  })
  const outputs: unknown[] = []
  for (const params of iterateInvocationCandidates(invocation))
    await evaluator.evaluateRows!({
      rootNodeId: invocation.rootNodeId,
      params,
      onRow: (row) => {
        outputs.push(row.outputs)
        return Promise.resolve()
      },
    })
  if (outputs.join() !== '2,5,9,11')
    throw new Error(
      'Invocation provider sweeps must resolve each differently sized candidate domain.',
    )
  const combined = {
    path: 'nodes/combined.ts',
    source: list.source
      .replace(
        'values: { inputs: {} }',
        "combined: { inputs: { list: { sources: { first: 'values', second: 'otherValues' }, choose: { parameter: 'provider', default: 'first' } } } }",
      )
      .replace('async () => ({ items: [2, 5, 9] })', 'async ({ use }) => await use.list({})'),
  }
  const afterCombined = {
    ...selected,
    source: selected.source.replace(
      "{ sources: { candidates: 'candidates', second: 'secondCandidates' }, choose: { parameter: 'provider', default: 'candidates' } }",
      "{ source: 'combined', explode: 'items' }",
    ),
  }
  const combinedGraph = await resolveAuthoredGraph([list, otherList, combined, afterCombined])
  const combinedRoot = compileDagNodeRecordGraph({ graph: combinedGraph.resolvedNodes })[
    combinedGraph.bindings.selected!
  ]!
  rejected = false
  try {
    await combinedRoot
      .call({ value: { list: { provider: 'first' } } })
      .study(
        { variables: { 'value.list.provider': { kind: 'list', values: ['first', 'second'] } } },
        undefined,
        { execution: { mode: 'local' } },
      )
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('invocation variables')
  }
  if (!rejected)
    throw new Error('A direct study sweep must not silently freeze a selector upstream of explode.')
}
testGraphAuthoringSelectorPlansChosenExplodedDomain.description =
  'A parameterized selector uses the shared exploded-domain planner and addresses the selected provider parameters.'

export const testGraphAuthoringRejectsUnavailableBuiltinSemantics = async () => {
  const resolved = await resolveAuthoredGraph([
    {
      path: 'nodes/list.ts',
      source: `export default { formatVersion: 3, outputSchema: { type: 'object', properties: { values: { type: 'array', items: { type: 'number' } } } }, ids: { list: { inputs: {} } }, run: async () => ({ values: [2] }) }`,
    },
    {
      path: 'nodes/root.ts',
      source: `export default { formatVersion: 3, outputSchema: { type: 'number' }, ids: { root: { inputs: { value: { source: 'list', explode: 'values' } } } }, run: async ({ use }) => await use.value({}) }`,
    },
  ])
  const structural = Object.values(resolved.resolvedNodes).find((node) => node.structure)
  if (!structural) throw new Error('Expected a resolved builtin application.')
  let rejected = false
  try {
    compileDagNodeRecordGraph({
      graph: {
        ...resolved.resolvedNodes,
        [structural.id]: {
          ...structural,
          definitionHash: canonicalHash('future builtin semantics'),
        },
      },
    })
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('matching runtime version')
  }
  if (!rejected)
    throw new Error('A different builtin implementation must never execute under an old hash.')
}
testGraphAuthoringRejectsUnavailableBuiltinSemantics.description =
  'The compiler rejects structural implementation hashes that its runtime cannot reproduce.'

export const testGraphAuthoringRejectsInvalidBindings = async () => {
  let redundantBuiltinRejected = false
  try {
    await parseAuthoredGraphDefinition({
      path: 'nodes/expanded.ts',
      source: `export default { formatVersion: 3, definition: 'taskyon:explode', outputSchema: {}, ids: { expanded: { inputs: { source: { source: 'values' } }, settings: { path: 'items' } } } }`,
    })
  } catch {
    redundantBuiltinRejected = true
  }
  if (!redundantBuiltinRejected)
    throw new Error('Builtins must derive contracts rather than accept redundant declarations.')
  const malformed = [
    [scalar('a', 2), scalar('a', 3)],
    [consumer],
    [
      scalar('a', 2),
      scalar('b', 3),
      {
        ...consumer,
        source: consumer.source.replace(
          "inputsSchema: { value: { type: 'number' } }",
          "inputsSchema: { value: { type: 'string' } }",
        ),
      },
    ],
    [
      scalar('a', 2),
      { ...consumer, source: consumer.source.replace("source: 'b'", "source: 'doubledB'") },
    ],
    [
      scalar('a', 2),
      {
        ...consumer,
        source: consumer.source.replace("source: 'a'", "source: 'a', explode: 'items'"),
      },
    ],
  ]
  for (const files of malformed) {
    let rejected = false
    try {
      await resolveAuthoredGraph(files)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Invalid or cyclic binding declarations must be rejected.')
  }
}
testGraphAuthoringRejectsInvalidBindings.description =
  'Reusable graph authoring rejects duplicate IDs, missing dependencies, cycles, and invalid expansion.'

export const testGraphAuthoringPersistsAndReopensWithoutAgent = async () => {
  const { store } = createMemoryStore()
  const saved = await publishAuthoredGraph({
    store,
    files: [scalar('a', 2), scalar('b', 3), consumer],
    expectedGraphRevisionId: null,
  })
  const snapshot = await loadDesignRepositorySnapshot({
    readText: store.readText,
    checkout: { kind: 'ref', name: 'graph/main' },
  })
  const { files: restored } = await readAuthoredGraph(store, saved.lock.id)
  if (restored.length !== 3 || snapshot.revision.id !== saved.revision.id)
    throw new Error('Authoring and applications must survive reload.')
  const unchanged = await publishAuthoredGraph({
    store,
    files: restored,
    expectedGraphRevisionId: saved.revision.id,
  })
  if (unchanged.revision.id !== saved.revision.id)
    throw new Error(
      'An unchanged graph must not create a new revision when only project input data is acquired.',
    )
  let rejected = false
  try {
    await publishAuthoredGraph({ store, files: restored, expectedGraphRevisionId: null })
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('Stale graph edits must not replace the current revision.')
}
testGraphAuthoringPersistsAndReopensWithoutAgent.description =
  'Reusable graph declarations and locks reopen through the canonical repository without an agent.'

export const testGraphAuthoringAdvancesImportedRefWithoutSerializationConflict = async () => {
  const { store } = createMemoryStore()
  const saved = await publishAuthoredGraph({
    store,
    files: [scalar('a', 2)],
    expectedGraphRevisionId: null,
  })
  await store.writeText(
    'refs/graph/main.json',
    `${canonicalJson({ schemaVersion: 2, revisionId: saved.revision.id }, 2)}\n`,
  )
  const next = await publishAuthoredGraph({
    store,
    files: [scalar('a', 3)],
    expectedGraphRevisionId: saved.revision.id,
  })
  const ref = await createDesignGraphRepository(store).getGraphRef('graph/main')
  if (ref?.revisionId !== next.revision.id)
    throw new Error('Ref updates must compare the actual stored bytes and expected revision.')
}
testGraphAuthoringAdvancesImportedRefWithoutSerializationConflict.description =
  'Imported graph refs advance atomically regardless of their JSON whitespace or key order.'

export const testGraphAuthoringGitRoundTripPreservesDefinitionBindings = async () => {
  const original = createMemoryStore()
  const saved = await publishAuthoredGraph({
    store: original.store,
    files: [scalar('a', 2), scalar('b', 3), consumer],
    expectedGraphRevisionId: null,
  })
  const files = await projectDesignGraphSnapshot({
    store: original.store,
    selector: { kind: 'global' },
  })
  if (!files.some((file) => file.path === 'graph.lock.json'))
    throw new Error('Git projection must expose the generated lock.')
  const restored = createMemoryStore()
  await importDesignGraphSnapshot({ store: restored.store, files })
  const snapshot = await loadDesignRepositorySnapshot({
    readText: restored.store.readText,
    checkout: { kind: 'ref', name: 'graph/main' },
  })
  if (snapshot.revision.id !== saved.revision.id)
    throw new Error('Git projection must preserve the canonical graph.')
  const reexported = await projectDesignGraphSnapshot({
    store: restored.store,
    selector: { kind: 'global' },
  })
  if (canonicalHash(files) !== canonicalHash(reexported))
    throw new Error('Git projection must round trip deterministically.')
}
testGraphAuthoringGitRoundTripPreservesDefinitionBindings.description =
  'Reusable graph Git exports retain authored definitions, binding sets, locks, and exact execution identities.'

export const testGraphAuthoringImportRejectsRevisionLockMismatchBeforeMutation = async () => {
  const original = createMemoryStore()
  const saved = await publishAuthoredGraph({
    store: original.store,
    files: [scalar('a', 2)],
    expectedGraphRevisionId: null,
  })
  const files = await projectDesignGraphSnapshot({
    store: original.store,
    selector: { kind: 'global' },
  })
  const mismatched = createGraphRevision({
    parents: [],
    nodes: { renamed: saved.bindings.a! },
    authoringLockId: saved.lock.id,
  })
  const destination = createMemoryStore()
  let rejected = false
  try {
    await importDesignGraphSnapshot({
      store: destination.store,
      files: [
        ...files.filter((file) => file.path !== 'refs/graph/main.json'),
        {
          path: `graph-revisions/${mismatched.id.replace(':', '_')}.json`,
          content: canonicalJson(mismatched, 2),
        },
        {
          path: 'refs/graph/main.json',
          content: canonicalJson({ schemaVersion: 2, revisionId: mismatched.id }, 2),
        },
      ],
    })
  } catch (error) {
    rejected = error instanceof Error && error.message.includes('does not match its authoring lock')
  }
  if (!rejected || destination.values.size !== 0)
    throw new Error(
      'A valid revision hash cannot authorize inconsistent authored bindings or mutate the repository.',
    )
}
testGraphAuthoringImportRejectsRevisionLockMismatchBeforeMutation.description =
  'Imports reject a validly hashed revision whose bindings disagree with its authoring lock before writing objects or refs.'

export const testGraphAuthoringCustomHttpSourceReplaysWithoutNetwork = async () => {
  const convert = {
    path: 'nodes/decode.ts',
    source: `export default {
      formatVersion: 3, effect: 'pure',
      localParamsSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      outputSchema: { type: 'number' },
      ids: { decoded: { inputs: { raw: { source: 'httpFetch' } } } },
      run: async ({ params, use }) => {
        const response = await use.raw({ url: params.url })
        const text = decodeURIComponent(response.bodyBytes.map((byte) => '%' + byte.toString(16).padStart(2, '0')).join(''))
        return JSON.parse(text).value * 2
      },
    }`,
  }
  const resolved = await resolveAuthoredGraph([
    { path: 'nodes/http.ts', source: httpSourceDeclaration },
    convert,
  ])
  let requests = 0
  const graph = compileDagNodeRecordGraph({
    graph: resolved.resolvedNodes,
    authorizeFetch: () => Promise.resolve(true),
    fetch: () => {
      requests += 1
      return Promise.resolve(
        new Response('{"value":9}', { headers: { 'content-type': 'application/json' } }),
      )
    },
  })
  const records = createMemoryRecords()
  const repository = createSourceManifestRepository(records)
  const manifests: Record<string, ReturnType<typeof canonicalHash>> = {}
  const root = graph[resolved.bindings.decoded!]!
  const options = {
    execution: { mode: 'local' as const },
    storageBackend: createStorageDagBackend(records),
    sourceExecution: {
      repository,
      defaultPolicy: { mode: 'always' as const },
      refreshedAcquisitionKeys: new Set<Hash>(),
    },
    onSourceManifest: (key: string, hash: ReturnType<typeof canonicalHash>) => {
      manifests[key] = hash
    },
  }
  const result = await root.call({ url: 'https://example.invalid/data' }).run(undefined, options)
  if (result.value !== 18 || requests !== 1)
    throw new Error('Custom source and deterministic converter must execute.')
  const snapshot = createSourceSnapshot(manifests)
  const offline = compileDagNodeRecordGraph({
    graph: resolved.resolvedNodes,
    fetch: () => Promise.reject(new Error('Network must remain unused.')),
  })
  const replay = await offline[resolved.bindings.decoded!]!.call({
    url: 'https://example.invalid/data',
  }).run(undefined, { ...options, sourceExecution: { ...options.sourceExecution, snapshot } })
  if (replay.artifactHash !== result.artifactHash)
    throw new Error('Offline source replay must reproduce the artifact.')
}
testGraphAuthoringCustomHttpSourceReplaysWithoutNetwork.description =
  'Reusable graph custom HTTP sources use mediated fetch, deterministic conversion, and pinned offline replay.'

export const testGraphAuthoringChoiceDoesNotAcquireInactiveSource = async () => {
  const good = scalar('good', 4)
  good.source = good.source
    .replace('version: 1,', "version: 1, effect: 'source',")
    .replace(
      'run: async () => 4',
      "run: async ({ services }) => (await services.fetch('https://example.invalid/good')).status",
    )
  const bad = scalar('bad', 7)
  bad.source = bad.source
    .replace('version: 1,', "version: 1, effect: 'source',")
    .replace(
      'run: async () => 7',
      "run: async () => { throw new Error('Inactive source was evaluated') }",
    )
  const select = {
    ...consumer,
    source: consumer.source.replace(
      /ids: \{[\s\S]*?\n {4}\},/,
      `ids: { selected: { inputs: { value: { sources: { good: 'good', bad: 'bad' }, choose: { parameter: 'provider', default: 'good' } } } } },`,
    ),
  }
  const resolved = await resolveAuthoredGraph([good, bad, select])
  let requests = 0
  const graph = compileDagNodeRecordGraph({
    graph: resolved.resolvedNodes,
    authorizeFetch: () => Promise.resolve(true),
    fetch: () => {
      requests += 1
      return Promise.resolve(new Response('ok'))
    },
  })
  const result = await graph[resolved.bindings.selected!]!.call({
    value: { provider: 'good' },
  }).run(undefined, { execution: { mode: 'local' } })
  if (requests !== 1 || result.value !== 400)
    throw new Error('Only the demanded provider may acquire data.')
}
testGraphAuthoringChoiceDoesNotAcquireInactiveSource.description =
  'Reusable graph selectors keep inactive external sources unevaluated across the sandbox boundary.'

export const testGraphAuthoringCanonicalKeysAreLocaleIndependent = () => {
  if (canonicalJson({ a: 1, B: 2 }) !== '{"B":2,"a":1}')
    throw new Error('Canonical keys must use deterministic lexical ordering.')
  if (canonicalHash({ B: 2, a: 1 }) !== canonicalHash({ a: 1, B: 2 }))
    throw new Error('Dictionary insertion order must not change identities.')
}
testGraphAuthoringCanonicalKeysAreLocaleIndependent.description =
  'Reusable graph and artifact identities use lexical key order independent of runtime locale.'

export const testGraphAuthoringCommittedSourceLockPinsImports = async () => {
  const files = [
    {
      path: 'nodes/a.ts',
      content: `import { value } from './value.ts'; export default { formatVersion: 3, moduleImports: 'helpers', outputSchema: { type: 'number' }, ids: { a: { inputs: {} } }, run: () => value }`,
    },
    { path: 'modules/value.ts', content: 'export const value = 1' },
    {
      path: 'imports/helpers.json',
      content: JSON.stringify({
        imports: { $node: { './value.ts': { module: 'modules/value.ts' } } },
      }),
    },
  ]
  let missingRejected = false
  try {
    await compileDesignGraphSources(files)
  } catch {
    missingRejected = true
  }
  if (!missingRejected) throw new Error('Boot must reject missing source locks.')
  const locked = await updateDesignGraphSourceLock(files)
  const original = await compileDesignGraphSources(locked)
  let tamperedRejected = false
  try {
    await compileDesignGraphSources(
      locked.map((file) =>
        file.path === 'graph.lock.json'
          ? { ...file, content: file.content.replace('taskyon.graph-source-lock', 'invalid-lock') }
          : file,
      ),
    )
  } catch {
    tamperedRejected = true
  }
  if (!tamperedRejected) throw new Error('Boot must reject a tampered source lock.')
  const changed = locked.map((file) =>
    file.path === 'modules/value.ts' ? { ...file, content: 'export const value = 2' } : file,
  )
  let staleRejected = false
  try {
    await compileDesignGraphSources(changed)
  } catch {
    staleRejected = true
  }
  if (!staleRejected) throw new Error('Boot must reject a stale helper lock.')
  const updated = await compileDesignGraphSources(await updateDesignGraphSourceLock(changed))
  const first = original.find((file) => file.path === 'refs/graph/main.json')!
  const second = updated.find((file) => file.path === 'refs/graph/main.json')!
  if (first.content === second.content)
    throw new Error('A helper edit must change recursive graph identity.')
  if (
    canonicalHash(locked) !==
    canonicalHash(await updateDesignGraphSourceLock([...locked].reverse()))
  )
    throw new Error('Lock updates must be deterministic.')
}
testGraphAuthoringCommittedSourceLockPinsImports.description =
  'Committed graph source locks reject missing and stale imports and regenerate deterministically.'

export const testGraphAuthoringGitSourcesPreservePinsWithoutDataOrHistory = async () => {
  const missingSnapshot = canonicalHash('synthetic-not-yet-local-snapshot')
  const sources = await updateDesignGraphSourceLock([
    { path: 'nodes/value.ts', content: scalar('value', 3).source },
    {
      path: 'projects/example.json',
      content: JSON.stringify({
        displayName: 'Pinned example',
        refs: ['example'],
        invocations: {
          main: {
            root: 'value',
            configuration: {
              sourceSnapshotId: missingSnapshot,
              variables: {},
              inputs: {},
              objectives: [],
              constraints: [],
              capture: [],
              policy: { accuracy: 'exact' },
              reducerOverrides: {},
            },
          },
        },
      }),
    },
  ])
  const memory = createMemoryStore()
  await importDesignGraphSnapshot({ store: memory.store, files: sources })
  const exported = await projectDesignGraphSnapshot({
    store: memory.store,
    selector: { kind: 'project', projectRef: 'projects/example' },
    format: 'sources',
  })
  if (
    exported.some(
      (file) =>
        file.path !== 'graph.lock.json' &&
        !/^(nodes|modules|imports|projects|assets)\//.test(file.path),
    )
  )
    throw new Error('Ordinary Git exports must contain only sources and the lock.')
  if (
    !exported.some(
      (file) => file.path.startsWith('projects/') && file.content.includes(missingSnapshot),
    )
  )
    throw new Error('Git exports must preserve snapshot references without copying captured data.')
  const imported = createMemoryStore()
  await importDesignGraphSnapshot({ store: imported.store, files: exported })
  const project = await loadProjectRepositorySnapshot({
    readText: imported.store.readText,
    checkout: { kind: 'ref', name: 'projects/example' },
  })
  const invocation = Object.values(project.invocations)[0]!
  const graph = compileDagNodeRecordGraph({
    graph: Object.fromEntries(
      Object.entries(project.nodesByHash).map(([hash, saved]) => [hash, saved.node]),
    ),
    fetch: () => Promise.reject(new Error('Pinned evaluation must not fetch.')),
  })
  let unavailable = false
  try {
    await createDagInvocationEvaluators({
      root: graph[invocation.rootNodeId]!,
      invocation,
      engineConfig: {
        execution: { mode: 'local' },
        sourceExecution: {
          repository: createSourceManifestRepository(createMemoryRecords()),
          defaultPolicy: { mode: 'manual' },
          refreshedAcquisitionKeys: new Set(),
        },
      },
    }).evaluate({ rootNodeId: invocation.rootNodeId, params: {} })
  } catch (error) {
    unavailable = error instanceof Error && error.message.includes('snapshot is unavailable')
  }
  if (!unavailable) throw new Error('A Git-only import must diagnose unavailable pinned inputs.')
  const previous = await imported.store.readText('refs/projects/example.json')
  const expectedRefs = Object.fromEntries(
    [...imported.values].filter(([path]) => path.startsWith('refs/')),
  )
  const changed = exported.map((file) =>
    file.path.startsWith('projects/')
      ? { ...file, content: file.content.replace('Pinned example', 'Edited example') }
      : file,
  )
  await importDesignGraphSnapshot({ store: imported.store, files: changed, expectedRefs })
  const repository = createDesignGraphRepository(imported.store)
  const ref = (await repository.getProjectRef('projects/example'))!
  const revision = await repository.getProjectRevision(ref.revisionId)
  if (revision.parents[0] !== parseDesignGraphRef(JSON.parse(previous)).revisionId)
    throw new Error('Git source imports must preserve application revision ancestry.')
  let outgoing = exported
  await synchronizeDesignGraphRepository({
    store: imported.store,
    selector: { kind: 'project', projectRef: 'projects/example' },
    branch: 'main',
    commit: {
      message: 'Synthetic transport fixture',
      author: { name: 'Synthetic Reviewer', email: 'reviewer@example.invalid' },
    },
    synchronizer: {
      writeProjection: (files) => {
        outgoing = [...files]
        return Promise.resolve()
      },
      commit: () => Promise.resolve('synthetic-local-commit'),
      synchronize: () => Promise.resolve({ status: 'pulled', oid: 'synthetic-remote-commit' }),
      readProjection: () =>
        Promise.resolve(
          outgoing.map((file) =>
            file.path.startsWith('projects/')
              ? { ...file, content: file.content.replace('Edited example', 'Pulled example') }
              : file,
          ),
        ),
    },
  })
  const pulled = await repository.getProjectRevision(
    (await repository.getProjectRef('projects/example'))!.revisionId,
  )
  if (pulled.parents[0] !== revision.id || pulled.displayName !== 'Pulled example')
    throw new Error(
      'Git synchronization must conditionally import sources and preserve local revision ancestry.',
    )
}
testGraphAuthoringGitSourcesPreservePinsWithoutDataOrHistory.description =
  'Git source exports omit history and observations, preserve pins, report unavailable inputs and parent subsequent application saves.'

export const testGraphAuthoringExactPackagePinsChangeRecursiveIdentity = async () => {
  const source = {
    path: 'nodes/parse.ts',
    content: `import { z } from 'zod'; export default {formatVersion: 3, moduleImports: 'zod', outputSchema: {type: 'number'}, ids: {parse: {inputs: {}}}, run: () => z.number().parse(1)}`,
  }
  const files = [
    source,
    {
      path: 'imports/zod.json',
      content: JSON.stringify({
        imports: { $node: { zod: { package: 'zod' } } },
        packages: { zod: { range: '^4.0.0' } },
      }),
    },
    {
      path: consumer.path,
      content: consumer.source
        .replaceAll("source: 'a'", "source: 'parse'")
        .replaceAll("source: 'b'", "source: 'parse'"),
    },
  ]
  const first = await updateDesignGraphSourceLock(files, {
    zod: { version: '4.0.5', integrity: canonicalHash('synthetic-package-a'), path: '' },
  })
  const second = await updateDesignGraphSourceLock(files, {
    zod: { version: '4.1.0', integrity: canonicalHash('synthetic-package-b'), path: '' },
  })
  const integrityOnly = await updateDesignGraphSourceLock(files, {
    zod: {
      version: '4.0.5',
      integrity: canonicalHash('synthetic-package-changed-bytes'),
      path: '',
    },
  })
  if (canonicalHash(first) === canonicalHash(integrityOnly))
    throw new Error(
      'Changed package bytes must change exact lock identity even at the same version.',
    )
  const firstSourceLock = parseGraphSourceLock(
    JSON.parse(first.find((file) => file.path === 'graph.lock.json')!.content),
  )
  const changedSourceLock = parseGraphSourceLock(
    JSON.parse(integrityOnly.find((file) => file.path === 'graph.lock.json')!.content),
  )
  if (firstSourceLock.graph.bindings.parse! === changedSourceLock.graph.bindings.parse!)
    throw new Error('Same-version changed package integrity must change importing node identity.')
  const a = await compileDesignGraphSources(first)
  const b = await compileDesignGraphSources(second)
  const moduleLock = parseDagModuleLock(
    JSON.parse(a.find((file) => file.path.startsWith('module-locks/'))!.content),
  )
  const resolver = createDagPackageArtifactResolver({
    manifest: () =>
      Promise.resolve({
        schemaVersion: 1,
        packages: {
          zod: { version: '4.1.0', integrity: canonicalHash('synthetic-package-b'), path: '' },
        },
      }),
    loadSource: () => Promise.reject(new Error('Package lookup must not download.')),
  })
  let mismatchRejected = false
  try {
    await resolver.resolve(moduleLock.packages)
  } catch {
    mismatchRejected = true
  }
  if (!mismatchRejected)
    throw new Error('Runtime must reject a different exact package within a compatible range.')
  const rootA = a.find((file) => file.path === 'refs/graph/main.json')!
  const rootB = b.find((file) => file.path === 'refs/graph/main.json')!
  if (rootA.content === rootB.content)
    throw new Error(
      'Exact package updates must change the graph identity even within the same range.',
    )
  const lockA = parseGraphLock(
    JSON.parse(a.find((file) => file.path.startsWith('graph-locks/'))!.content),
  )
  const lockB = parseGraphLock(
    JSON.parse(b.find((file) => file.path.startsWith('graph-locks/'))!.content),
  )
  if (lockA.bindings.doubledA === lockB.bindings.doubledA)
    throw new Error('Exact package updates must propagate downstream.')
}
testGraphAuthoringExactPackagePinsChangeRecursiveIdentity.description =
  'Exact runtime package versions and integrity participate in recursive node identity.'

export const testGraphContractErrorsExplainBothSchemas = async () => {
  const files = [
    {
      path: 'nodes/source-contract.ts',
      source: `export default {
      formatVersion: 3, localParamsSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'], additionalProperties: false },
      ids: { sourceContract: { inputs: {} } }, run: async () => ({ body: '{"value":1}' }),
    }`,
    },
    {
      path: 'nodes/consumer-contract.ts',
      source: `export default {
      formatVersion: 3, localParamsSchema: { type: 'object', properties: {} },
      inputsSchema: { data: { type: 'object' } }, outputSchema: { type: 'number' },
      ids: { consumerContract: { inputs: { data: { source: 'sourceContract' } } } },
      run: async ({ use }) => JSON.parse((await use.data({})).body).value,
    }`,
    },
  ]
  let message = ''
  try {
    await resolveAuthoredGraph(files)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  if (
    !message.includes('consumerContract.data') ||
    !message.includes('Expected input schema:') ||
    !message.includes('Producer output schema:') ||
    !message.includes('"body"') ||
    !message.includes('inspectGraph')
  )
    throw new Error(
      'Contract rejection must identify the binding, show expected and producer schemas, and explain how to inspect or adapt them.',
    )
}
testGraphContractErrorsExplainBothSchemas.description =
  'Keeps incompatible graph bindings rejected while giving an agent bounded expected/actual schema evidence and an inspection path.'
