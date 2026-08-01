import { canonicalHash, type Hash } from './caching.ts'
import {
  createDagEvaluationRecord,
  evaluateDagInvocation,
  defineDagInvocation,
  parseDagEvaluationRecord,
  parseDagInvocation,
} from './dagInvocation.ts'
import { createNode } from './dagCore.ts'
import type { DagStorageBackend } from './caching.ts'
import { createDagObjectRepository } from './dagObjectRepository.ts'
import { projectDagDefinitions } from './dagGitProjection.ts'
import { saveStoredGraphNodeSource } from './dagNodeLoader.ts'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

export const testDagInvocationIdentityExcludesExecutionPolicy = () => {
  const nodeId = canonicalHash('invocation-source')
  const first = defineDagInvocation({
    localName: 'pv_capacity_study',
    nodeId,
    operation: { kind: 'argmax', path: 'annualEnergy' },
    slice: {
      capacity: { range: [100, 500] },
      tilt: { values: [10, 20, 30] },
    },
  })
  const renamed = defineDagInvocation({
    localName: 'renamed_for_display',
    nodeId,
    operation: { kind: 'argmax', path: 'annualEnergy' },
    slice: {
      capacity: { range: [100, 500] },
      tilt: { values: [10, 20, 30] },
    },
  })
  const parsed = parseDagInvocation(first)

  assert(
    first.id === renamed.id,
    'Expected display names not to change semantic invocation identity',
  )
  assert(parsed.id === first.id, 'Expected invocation parsing to verify its content hash')
  return { id: first.id }
}

testDagInvocationIdentityExcludesExecutionPolicy.description =
  'Keeps semantic invocation identity independent from names and execution policy.'

export const testDagEvaluationIdentityIncludesResolvedPolicy = () => {
  const invocationId = canonicalHash('evaluation-invocation')
  const artifactId = canonicalHash('evaluation-result')
  const exact = createDagEvaluationRecord({
    completedAtMs: 20,
    invocationId,
    policy: {
      engine: { id: 'comp-dag', version: 1 },
      mode: 'exact',
      parallelism: 1,
      resolvedStrategies: {
        capacity: { id: 'linear-grid', version: 1 },
      },
    },
    resultArtifactIds: [artifactId],
    startedAtMs: 10,
    status: 'completed',
  })
  const approximate = createDagEvaluationRecord({
    completedAtMs: 20,
    invocationId,
    policy: {
      engine: { id: 'comp-dag', version: 1 },
      mode: 'approximate',
      parallelism: 1,
      resolvedStrategies: {
        capacity: { id: 'adaptive', version: 2 },
      },
    },
    resultArtifactIds: [artifactId],
    startedAtMs: 10,
    status: 'completed',
  })

  assert(
    exact.id !== approximate.id,
    'Expected resolved policy to participate in evaluation identity',
  )
  assert(parseDagEvaluationRecord(exact).id === exact.id, 'Expected evaluation hash verification')
  return { approximate: approximate.id, exact: exact.id }
}

testDagEvaluationIdentityIncludesResolvedPolicy.description =
  'Separates semantic invocation identity from policy-specific evaluation identity.'

export const testDagInvocationEvaluationCachesByResolvedPolicy = async () => {
  const artifacts = new Map<Hash, unknown>()
  const cache = new Map<string, { artifact: Hash }>()
  const storageBackend: DagStorageBackend = {
    readArtifact: <O>(hash: Hash): O => {
      if (!artifacts.has(hash)) throw new Error(`Missing test artifact ${hash}`)
      return artifacts.get(hash) as O
    },
    writeArtifact: (value) => {
      const hash = canonicalHash(value)
      artifacts.set(hash, value)
      return hash
    },
    getCacheEntry: (key) => cache.get(key) ?? null,
    setCacheEntry: (key, entry) => {
      cache.set(key, entry)
    },
  }
  let runs = 0
  const nodeId = canonicalHash('invocation-evaluation-source')
  const source = createNode({
    name: 'invocation_evaluation_source',
    contentHash: nodeId,
    version: 1,
    localParams: {
      additionalProperties: false,
      properties: { x: { type: 'number' } },
      required: ['x'],
      type: 'object',
    },
    outputSchema: {
      additionalProperties: false,
      properties: { score: { type: 'number' } },
      required: ['score'],
      type: 'object',
    },
    run: ({ x }) => {
      runs += 1
      return { score: x * 2 }
    },
  })
  const invocation = defineDagInvocation({
    localName: 'cached_invocation',
    nodeId,
    operation: { kind: 'argmax', path: 'score' },
    slice: { x: { values: [1, 2, 3] } },
  })
  const policy = {
    engine: { id: 'comp-dag', version: 1 },
    mode: 'exact' as const,
    parallelism: 1,
    resolvedStrategies: { x: { id: 'list', version: 1 } },
  }
  const resolveNode = (id: Hash) => (id === source.contentHash ? source : undefined)

  const first = await evaluateDagInvocation({
    engineConfig: { storageBackend },
    invocation,
    policy,
    resolveNode,
  })
  const second = await evaluateDagInvocation({
    engineConfig: { storageBackend },
    invocation,
    policy,
    resolveNode,
  })

  assert(first.cacheHit === false, 'Expected the first invocation evaluation to execute')
  assert(second.cacheHit === true, 'Expected the same invocation and policy to reuse its artifact')
  assert(runs === 3, 'Expected one exact three-row evaluation before invocation-level reuse')
  const artifactId = first.evaluation.resultArtifactIds[0]
  assert(artifactId, 'Expected the evaluation to reference its result artifact')
  return { artifactId, runs }
}

testDagInvocationEvaluationCachesByResolvedPolicy.description =
  'Executes exact node hashes and caches invocation results by resolved policy.'

export const testDagObjectRepositorySharesInvocationsAcrossFriendlyRefs = async () => {
  const rows = new Map<string, Map<string, unknown>>()
  const writes = new Map<string, number>()
  const storage = {
    get: async ({ namespace, id }: { namespace: string; id: string }) => ({
      value: rows.get(namespace)?.get(id) ?? null,
    }),
    set: async ({ namespace, id, value }: { namespace: string; id: string; value: unknown }) => {
      const namespaceRows = rows.get(namespace) ?? new Map<string, unknown>()
      namespaceRows.set(id, value)
      rows.set(namespace, namespaceRows)
      writes.set(`${namespace}/${id}`, (writes.get(`${namespace}/${id}`) ?? 0) + 1)
    },
    list: async ({ namespace }: { namespace: string }) => ({
      rows: [...(rows.get(namespace)?.entries() ?? [])].map(([id, data]) => ({ id, data })),
    }),
  }
  const repository = createDagObjectRepository(storage)
  const invocation = defineDagInvocation({
    localName: 'shared_study',
    nodeId: canonicalHash('shared-node'),
    operation: { kind: 'collect' },
    slice: { x: { values: [1, 2] } },
  })

  await repository.putInvocation(invocation)
  await repository.putInvocation(invocation)
  await repository.advanceRef({ name: 'projects/alpha', target: { invocationId: invocation.id } })
  await repository.advanceRef({ name: 'projects/beta', target: { invocationId: invocation.id } })
  const refs = await repository.listRefs()

  assert(
    writes.get(`dag/objects/invocations/${invocation.id}`) === 1,
    'Expected repeated immutable writes to reuse one global invocation object',
  )
  assert(Object.keys(refs).length === 2, 'Expected both friendly refs to share the invocation')
  return refs
}

testDagObjectRepositorySharesInvocationsAcrossFriendlyRefs.description =
  'Stores immutable graph objects globally while projects use independent friendly refs.'

export const testDagGitProjectionExportsDefinitionsWithoutResults = async () => {
  const saved = await saveStoredGraphNodeSource(
    `export default {
      formatVersion: 2,
      id: '__TASKYON_SELF_HASH__',
      localName: 'projection_source',
      label: 'Projection source',
      version: 1,
      localParamsSchema: {},
      outputSchema: {},
      run: () => ({ ok: true }),
    }`,
  )
  const invocation = defineDagInvocation({
    localName: 'projection_study',
    nodeId: saved.node.id,
    operation: { kind: 'collect' },
    slice: { sample: { values: [1, 2] } },
  })
  const files = projectDagDefinitions({
    invocations: [invocation],
    nodes: [saved],
    refs: { main: { invocationId: invocation.id } },
  })
  const paths = files.map((file) => file.path)

  assert(
    paths.some((path) => path.startsWith('nodes/projection_source.')),
    'Expected node source',
  )
  assert(
    paths.some((path) => path.startsWith('invocations/projection_study.')),
    'Expected invocation JSON',
  )
  assert(paths.includes('refs/main.json'), 'Expected a friendly ref')
  assert(
    paths.every((path) => !path.includes('result')),
    'Expected results to remain unprojected',
  )
  assert(
    files.every((file, index) => index === 0 || files[index - 1]!.path < file.path),
    'Expected deterministic path ordering',
  )
  return paths
}

testDagGitProjectionExportsDefinitionsWithoutResults.description =
  'Projects immutable nodes, invocations, and refs into deterministic Git files.'
