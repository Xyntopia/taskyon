import { canonicalHash, type Hash } from './caching.ts'

export type SourceUpdatePolicy =
  | { mode: 'none' }
  | { mode: 'manual' }
  | { mode: 'stale'; staleAfterMs: number }
  | { mode: 'always' }

export type SourceLockManifest = {
  schemaVersion: 1
  id: Hash
  nodeHash: Hash
  acquisitionKey: Hash
  paramsHash: Hash
  artifactHash: Hash
  createdAtMs: number
}

export type SourceManifestStorage = {
  get: (namespace: string, id: string) => Promise<unknown>
  set: (namespace: string, id: string, value: unknown) => Promise<void>
}

const hashPattern = /^sha256:[A-Za-z0-9_-]{43}$/

const requireHash = (value: unknown, label: string): Hash => {
  if (typeof value !== 'string' || !hashPattern.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 hash.`)
  }
  return value as Hash
}

const manifestIdentity = (manifest: Omit<SourceLockManifest, 'id'>) => ({
  kind: 'taskyon.sourceLockManifest.v1',
  ...manifest,
})

export const createSourceLockManifest = (
  input: Omit<SourceLockManifest, 'schemaVersion' | 'id'>,
): SourceLockManifest => {
  const manifest = { schemaVersion: 1 as const, ...input }
  return { ...manifest, id: canonicalHash(manifestIdentity(manifest)) }
}

const parseSourceLockManifest = (value: unknown): SourceLockManifest => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Source lock manifest must be an object.')
  }
  const input = value as Partial<SourceLockManifest>
  if (input.schemaVersion !== 1) throw new Error('Unsupported source lock manifest version.')
  const manifest = createSourceLockManifest({
    nodeHash: requireHash(input.nodeHash, 'Source manifest nodeHash'),
    acquisitionKey: requireHash(input.acquisitionKey, 'Source manifest acquisitionKey'),
    paramsHash: requireHash(input.paramsHash, 'Source manifest paramsHash'),
    artifactHash: requireHash(input.artifactHash, 'Source manifest artifactHash'),
    createdAtMs: Number(input.createdAtMs),
  })
  if (!Number.isFinite(manifest.createdAtMs)) throw new Error('Invalid source manifest timestamp.')
  if (requireHash(input.id, 'Source manifest id') !== manifest.id) {
    throw new Error('Source lock manifest id does not match its content.')
  }
  return manifest
}

const readManifestId = (value: unknown, label: string): Hash | null => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || !('manifestId' in value)) {
    throw new Error(`${label} must contain a manifestId.`)
  }
  return requireHash(value.manifestId, `${label} manifestId`)
}

const projectPinKey = (nodeKey: string, acquisitionKey: Hash): Hash =>
  canonicalHash({ kind: 'taskyon.sourceProjectPin.v1', nodeKey, acquisitionKey })

export const createSourceManifestRepository = (
  storage: SourceManifestStorage,
  namespace = 'dag',
) => ({
  getManifest: async (id: Hash) => {
    const value = await storage.get(`${namespace}/source-manifests`, id)
    return value === null || value === undefined ? null : parseSourceLockManifest(value)
  },
  putManifest: async (manifest: SourceLockManifest) => {
    const parsed = parseSourceLockManifest(manifest)
    const key = `${namespace}/source-manifests`
    const existing = await storage.get(key, parsed.id)
    if (existing !== null && existing !== undefined) {
      const stored = parseSourceLockManifest(existing)
      if (stored.id !== parsed.id) throw new Error(`Conflicting source manifest ${parsed.id}.`)
      return
    }
    await storage.set(key, parsed.id, parsed)
  },
  getCurrent: async (acquisitionKey: Hash) =>
    readManifestId(
      await storage.get(`${namespace}/source-current`, acquisitionKey),
      'Source current record',
    ),
  setCurrent: async (acquisitionKey: Hash, manifestId: Hash) => {
    await storage.set(`${namespace}/source-current`, acquisitionKey, { manifestId })
  },
  getProjectPin: async (projectId: string, nodeKey: string, acquisitionKey: Hash) =>
    readManifestId(
      await storage.get(
        `${namespace}/source-project-pins/${projectId}`,
        projectPinKey(nodeKey, acquisitionKey),
      ),
      'Source project pin',
    ),
  setProjectPin: async (
    projectId: string,
    nodeKey: string,
    acquisitionKey: Hash,
    manifestId: Hash,
  ) => {
    await storage.set(
      `${namespace}/source-project-pins/${projectId}`,
      projectPinKey(nodeKey, acquisitionKey),
      { manifestId },
    )
  },
})

export type SourceManifestRepository = ReturnType<typeof createSourceManifestRepository>

export const shouldRefreshSource = (args: {
  policy: SourceUpdatePolicy
  manifest: SourceLockManifest | null
  nowMs: number
  force?: boolean
  refreshedInRun?: boolean
}): boolean => {
  if (!args.manifest || args.force === true) return true
  switch (args.policy.mode) {
    case 'none':
    case 'manual':
      return false
    case 'stale':
      return args.nowMs - args.manifest.createdAtMs >= args.policy.staleAfterMs
    case 'always':
      return args.refreshedInRun !== true
  }
}
