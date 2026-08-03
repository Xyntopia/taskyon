import {
  createSourceLockManifest,
  createSourceManifestRepository,
  shouldRefreshSource,
} from './sourceManifest.ts'
import { canonicalHash } from './caching.ts'
import { createNode, type EngineConfig } from './dagCore.ts'

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
