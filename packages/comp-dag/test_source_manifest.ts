import {
  createSourceLockManifest,
  createSourceManifestRepository,
  shouldRefreshSource,
  createSourceSnapshot,
  extendSourceSnapshot,
  MissingSourceObservation,
} from './sourceManifest.ts'
import { canonicalHash } from './caching.ts'
import { createNode, type EngineConfig } from './dagCore.ts'
import { createStorageDagBackend } from './storageDagBackend.ts'

const createMemorySourceStorage = () => {
  const values = new Map<string, unknown>()
  return {
    get: (namespace: string, id: string) => Promise.resolve(values.get(`${namespace}/${id}`)),
    set: (namespace: string, id: string, value: unknown) => {
      values.set(`${namespace}/${id}`, value)
      return Promise.resolve()
    },
  }
}

export const testSourceParentCacheRefreshesConsumedObservation = async () => {
  const storage = createMemorySourceStorage()
  let observed = 10
  const source = createNode({
    name: 'SourceParentCacheObservation',
    version: 1,
    effect: 'source',
    outputSchema: { type: 'number' },
    run: () => observed,
  })
  const parent = createNode({
    name: 'SourceParentCacheConsumer',
    version: 1,
    hiddenInputs: { source },
    outputSchema: { type: 'number' },
    run: async (_, use) => (await use.source({})) * 2,
  })
  const config: EngineConfig = {
    execution: { mode: 'local' },
    storageBackend: createStorageDagBackend(storage),
    sourceExecution: {
      repository: createSourceManifestRepository(storage),
      defaultPolicy: { mode: 'always' },
      refreshedAcquisitionKeys: new Set(),
    },
  }
  const ctx = { nowUtcMs: 100, log: () => undefined }
  const first = await parent.call({}).run(ctx, config)
  observed = 20
  config.sourceExecution!.refreshedAcquisitionKeys.clear()
  const second = await parent.call({}).run({ ...ctx, nowUtcMs: 200 }, config)
  if (first.value !== 20 || second.value !== 40) {
    throw new Error('A cached pure parent must not hide a refreshed source observation.')
  }
  return { first: first.value, second: second.value }
}
testSourceParentCacheRefreshesConsumedObservation.description =
  'Validates source observations before reusing pure parent results.'

export const testSourceSnapshotPreservesCompatibleRows = async () => {
  const storage = createMemorySourceStorage()
  const repository = createSourceManifestRepository(storage)
  const backend = createStorageDagBackend(storage)
  let observations = 0
  let calculations = 0
  const source = createNode({
    name: 'SnapshotDynamicSource',
    version: 1,
    effect: 'source',
    outputSchema: { type: 'number' },
    run: () => {
      observations += 1
      return 5
    },
  })
  const root = createNode({
    name: 'SnapshotDynamicConsumer',
    version: 1,
    hiddenInputs: { source },
    localParams: {
      type: 'object',
      properties: { demand: { type: 'boolean' } },
      required: ['demand'],
    },
    outputSchema: { type: 'number' },
    run: async (params, use) => {
      calculations += 1
      return params.demand ? await use.source({}) : 3
    },
  })
  const ctx = { nowUtcMs: 100, log: () => undefined }
  const config: EngineConfig = {
    storageBackend: backend,
    execution: { mode: 'local' },
    sourceExecution: {
      repository,
      defaultPolicy: { mode: 'manual' },
      refreshedAcquisitionKeys: new Set(),
      snapshot: createSourceSnapshot({}),
    },
  }
  const initial = await root.call({ demand: false }).run(ctx, config)
  let missing: MissingSourceObservation | undefined
  try {
    await root.call({ demand: true }).run(ctx, config)
  } catch (error) {
    if (!(error instanceof MissingSourceObservation)) throw error
    missing = error
  }
  if (!missing || observations !== 0)
    throw new Error('Unpinned observation must suspend before acquisition.')
  const artifactHash = await backend.writeArtifact(5)
  const manifest = createSourceLockManifest({
    nodeHash: missing.nodeHash,
    acquisitionKey: missing.acquisitionKey,
    paramsHash: canonicalHash(missing.params),
    artifactHash,
    createdAtMs: 100,
  })
  await repository.putManifest(manifest)
  const snapshot = extendSourceSnapshot(config.sourceExecution!.snapshot!, manifest)
  await repository.putSnapshot(snapshot)
  config.sourceExecution!.snapshot = (await repository.getSnapshot(snapshot.id))!
  const beforeReuse = calculations
  const reused = await root.call({ demand: false }).run(ctx, config)
  if (calculations !== beforeReuse || reused.artifactHash !== initial.artifactHash) {
    throw new Error('An added, unconsumed source must preserve the earlier row cache.')
  }
  const resolved = await root.call({ demand: true }).run(ctx, config)
  const beforeCached = calculations
  await root.call({ demand: true }).run(ctx, config)
  if (calculations !== beforeCached || resolved.value !== 5 || observations !== 0) {
    throw new Error('Pinned source replay and cached parent must not observe live state.')
  }
  const updated = createSourceLockManifest({
    ...manifest,
    artifactHash: await backend.writeArtifact(9),
    createdAtMs: 200,
  })
  await repository.putManifest(updated)
  config.sourceExecution!.snapshot = createSourceSnapshot({ [updated.acquisitionKey]: updated.id })
  const changed = await root.call({ demand: true }).run(ctx, config)
  if (changed.value !== 9) throw new Error('Changed consumed manifest must invalidate its parent.')
  const beforeReturn = calculations
  config.sourceExecution!.snapshot = snapshot
  await repository.setCurrent(manifest.acquisitionKey, updated.id)
  const restored = await root.call({ demand: true }).run(ctx, config)
  if (restored.value !== 5 || calculations !== beforeReturn) {
    throw new Error(
      'Returning to an older pinned source must reuse its earlier computation variant.',
    )
  }
  const consumer = createNode({
    name: 'SnapshotTransitiveConsumer',
    version: 1,
    hiddenInputs: { root },
    outputSchema: { type: 'number' },
    run: async (_, use) => (await use.root({ demand: true })) * 2,
  })
  const transitive = await consumer.call({}).run(ctx, config)
  config.sourceExecution!.snapshot = createSourceSnapshot({ [updated.acquisitionKey]: updated.id })
  const transitiveChanged = await consumer.call({}).run(ctx, config)
  if (transitive.value !== 10 || transitiveChanged.value !== 18) {
    throw new Error(
      'A cached child must propagate consumed sources into the parent cache identity.',
    )
  }
  let replaced = false
  try {
    extendSourceSnapshot(snapshot, updated)
  } catch {
    replaced = true
  }
  if (!replaced)
    throw new Error('Add-only extension must reject replacement of an existing source.')
  return { observations, calculations, changed: changed.value }
}
testSourceSnapshotPreservesCompatibleRows.description =
  'Reuses compatible rows across source snapshot extensions and invalidates changed dependencies.'

export const testSourceSnapshotCacheIncludesInheritedParameters = async () => {
  const storage = createMemorySourceStorage()
  let calculations = 0
  const input = createNode({
    name: 'SnapshotBoundInput',
    version: 1,
    localParams: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] },
    outputSchema: { type: 'number' },
    run: (params) => params.value,
  })
  const root = createNode({
    name: 'SnapshotBoundConsumer',
    version: 1,
    hiddenInputs: { input },
    outputSchema: { type: 'number' },
    run: async (_, use) => {
      calculations += 1
      return await use.input({})
    },
  })
  const config: EngineConfig = {
    execution: { mode: 'local' },
    storageBackend: createStorageDagBackend(storage),
    sourceExecution: {
      repository: createSourceManifestRepository(storage),
      snapshot: createSourceSnapshot({}),
      defaultPolicy: { mode: 'manual' },
      refreshedAcquisitionKeys: new Set(),
    },
  }
  const ctx = { nowUtcMs: 100, log: () => undefined }
  const first = await root
    .call({})
    .run(ctx, { ...config, parameterBindings: { [input.name]: { value: 2 } } })
  const second = await root
    .call({})
    .run(ctx, { ...config, parameterBindings: { [input.name]: { value: 7 } } })
  const repeated = await root.call({}).run(ctx, {
    ...config,
    parameterBindings: {
      [input.name]: { value: 2 },
      UnrelatedSyntheticNode: { value: 100 },
    },
  })
  if (first.value !== 2 || second.value !== 7 || repeated.value !== 2 || calculations !== 2) {
    throw new Error(
      'Cache identity must include relevant inherited parameters, but not unrelated bindings.',
    )
  }
  return { calculations }
}
testSourceSnapshotCacheIncludesInheritedParameters.description =
  'Separates inherited computational inputs while reusing results across unrelated bindings.'

export const testSourceManifestRepositorySharesArtifactsAndPinsProjects = async () => {
  const rows = new Map<string, unknown>()
  const repository = createSourceManifestRepository({
    get: (namespace, id) => Promise.resolve(rows.get(`${namespace}/${id}`) ?? null),
    set: (namespace, id, value) => {
      rows.set(`${namespace}/${id}`, value)
      return Promise.resolve()
    },
  })
  const acquisitionKey = canonicalHash({ node: 'weather', lat: 1, lon: 2 })
  const manifest = createSourceLockManifest({
    nodeHash: canonicalHash('weather-node'),
    acquisitionKey,
    paramsHash: canonicalHash({ lat: 1, lon: 2 }),
    artifactHash: canonicalHash({ temperature: 20 }),
    createdAtMs: 100,
  })

  await repository.putManifest(manifest)
  await repository.setCurrent(acquisitionKey, manifest.id)
  await repository.setProjectPin('project-a', 'weather', acquisitionKey, manifest.id)
  await repository.setProjectPin('project-b', 'weather', acquisitionKey, manifest.id)

  if ((await repository.getManifest(manifest.id))?.artifactHash !== manifest.artifactHash) {
    throw new Error('Expected immutable source manifest to round-trip.')
  }
  if ((await repository.getCurrent(acquisitionKey)) !== manifest.id) {
    throw new Error('Expected acquisition identity to resolve its current manifest.')
  }
  if ((await repository.getProjectPin('project-a', 'weather', acquisitionKey)) !== manifest.id) {
    throw new Error('Expected project A to pin the shared manifest.')
  }
  if ((await repository.getProjectPin('project-b', 'weather', acquisitionKey)) !== manifest.id) {
    throw new Error('Expected project B to pin the shared manifest.')
  }

  return { manifestId: manifest.id, artifactHash: manifest.artifactHash }
}

export const testSourceUpdatePoliciesAreExplicit = () => {
  const manifest = createSourceLockManifest({
    nodeHash: canonicalHash('source'),
    acquisitionKey: canonicalHash('request'),
    paramsHash: canonicalHash('params'),
    artifactHash: canonicalHash('artifact'),
    createdAtMs: 1_000,
  })
  if (shouldRefreshSource({ policy: { mode: 'manual' }, manifest, nowMs: 2_000 })) {
    throw new Error('Manual policy must reuse an existing manifest.')
  }
  if (
    !shouldRefreshSource({
      policy: { mode: 'stale', staleAfterMs: 500 },
      manifest,
      nowMs: 2_000,
    })
  ) {
    throw new Error('Stale policy must refresh an expired manifest.')
  }
  if (shouldRefreshSource({ policy: { mode: 'none' }, manifest, nowMs: 2_000 })) {
    throw new Error('No-update policy must reuse an existing manifest.')
  }
  if (!shouldRefreshSource({ policy: { mode: 'always' }, manifest, nowMs: 2_000 })) {
    throw new Error('Always policy must refresh once per top-level run.')
  }
  if (!shouldRefreshSource({ policy: { mode: 'none' }, manifest: null, nowMs: 2_000 })) {
    throw new Error('Every policy must acquire when no manifest exists.')
  }
  return { success: true }
}

testSourceManifestRepositorySharesArtifactsAndPinsProjects.description =
  'Stores immutable global source manifests while projects pin shared acquisition results.'
testSourceUpdatePoliciesAreExplicit.description =
  'Resolves none, manual, stale, always, and first-acquisition source update behavior.'

export const testSourceExecutionCreatesAndReusesManifest = async () => {
  const rows = new Map<string, unknown>()
  const repository = createSourceManifestRepository({
    get: (namespace, id) => Promise.resolve(rows.get(`${namespace}/${id}`) ?? null),
    set: (namespace, id, value) => {
      rows.set(`${namespace}/${id}`, value)
      return Promise.resolve()
    },
  })
  let executions = 0
  const node = createNode({
    name: 'ManifestExecutionSource',
    version: 1,
    effect: 'source',
    outputSchema: {
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
    },
    run: () => ({ count: (executions += 1) }),
  })
  const engineConfig: EngineConfig = {
    sourceExecution: {
      repository,
      projectId: 'project-a',
      defaultPolicy: { mode: 'manual' },
      refreshedAcquisitionKeys: new Set(),
    },
  }
  const ctx = { nowUtcMs: 100, log: () => undefined }
  const first = await node.call({}).run(ctx, engineConfig)
  const second = await node.call({}).run(ctx, engineConfig)
  if (executions !== 1 || first.artifactHash !== second.artifactHash) {
    throw new Error('Expected a manual source policy to reuse the recorded source manifest.')
  }
  return { executions, artifactHash: first.artifactHash }
}

testSourceExecutionCreatesAndReusesManifest.description =
  'Records successful source artifacts and reuses the project-pinned manifest on later calls.'
