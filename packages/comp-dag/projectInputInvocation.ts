import type { DagNode } from './dagCore.ts'
import { canonicalHash, type Hash } from './caching.ts'
import { createInvocationDefinition } from './designGraphModel.ts'
import { createStorageDagBackend } from './storageDagBackend.ts'
import {
  createSourceManifestRepository,
  createSourceSnapshot,
  type SourceManifestStorage,
} from './sourceManifest.ts'

/** Acquire project inputs once, pin their observations, and verify replay before saving a study. */
export const captureProjectInputInvocation = async (args: {
  root: DagNode
  replayRoot: DagNode
  rootNodeId: Hash
  parameters: Record<string, unknown>
  records: SourceManifestStorage
  projectId: string
}) => {
  const sourceRepository = createSourceManifestRepository(args.records)
  const backend = createStorageDagBackend(args.records)
  const consumed: Record<string, Hash> = {}
  const acquired = await args.root.call(args.parameters).run(
    { nowUtcMs: Date.now(), log: () => undefined },
    {
      execution: { mode: 'local' },
      storageBackend: backend,
      sourceExecution: {
        repository: sourceRepository,
        projectId: args.projectId,
        defaultPolicy: { mode: 'always' },
        refreshedAcquisitionKeys: new Set(),
      },
      onSourceManifest: (key, hash) => {
        consumed[key] = hash
      },
    },
  )
  if (!Object.keys(consumed).length)
    throw new Error('Project input study consumed no source observations.')
  const sourceSnapshot = createSourceSnapshot(consumed)
  await sourceRepository.putSnapshot(sourceSnapshot)
  const invocation = createInvocationDefinition({
    rootNodeId: args.rootNodeId,
    sourceSnapshotId: sourceSnapshot.id,
    variables: Object.fromEntries(
      Object.entries(args.parameters).map(([key, value]) => [
        key,
        { kind: 'constant' as const, value },
      ]),
    ),
    inputs: {},
    objectives: [],
    constraints: [],
    capture: [],
    policy: { accuracy: 'exact' },
    reducerOverrides: {},
  })
  const replay = await args.replayRoot.call(args.parameters).run(
    { nowUtcMs: Date.now(), log: () => undefined },
    {
      execution: { mode: 'local' },
      storageBackend: backend,
      sourceExecution: {
        repository: sourceRepository,
        projectId: args.projectId,
        snapshot: sourceSnapshot,
        defaultPolicy: { mode: 'manual' },
        refreshedAcquisitionKeys: new Set(),
      },
    },
  )
  if (
    replay.artifactHash !== acquired.artifactHash ||
    canonicalHash(replay.value) !== acquired.artifactHash
  )
    throw new Error('Project input replay did not reproduce the original artifact.')
  return {
    invocation,
    sourceSnapshot,
    artifactHash: acquired.artifactHash,
    result: acquired.value,
    offlineReplayVerified: true as const,
  }
}
