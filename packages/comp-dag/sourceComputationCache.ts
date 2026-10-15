import {
  readCachedDagArtifact,
  canonicalHash,
  type DagStorageBackend,
  type Hash,
} from './caching.ts'
import {
  createSourceSnapshot,
  parseSourceSnapshot,
  type SourceSnapshot,
  type SourceManifestRepository,
} from './sourceManifest.ts'

// The existing cache remains computation -> result. This rebuildable candidate index locates
// consumed-source sets without using the whole invocation snapshot as computation identity.
const candidateKey = (base: Hash) => canonicalHash({ kind: 'taskyon.sourceCandidates.v2', base })
const computationKey = async (
  base: Hash,
  sources: SourceSnapshot,
  repository: SourceManifestRepository,
) => {
  const content = await Promise.all(
    Object.entries(sources.manifests).map(async ([key, id]) => {
      const manifest = await repository.getManifest(id)
      if (!manifest || manifest.id !== id || manifest.acquisitionKey !== key)
        throw new Error('Computation source manifest is missing or incompatible.')
      return [key, manifest.artifactHash]
    }),
  )
  return canonicalHash({
    kind: 'taskyon.sourceComputation.v2',
    base,
    content: Object.fromEntries(content),
  })
}

const readCandidates = async (backend: DagStorageBackend, base: Hash) => {
  const entry = await backend.getCacheEntry(candidateKey(base))
  if (!entry) return []
  const cached = await readCachedDagArtifact(backend, entry.artifact)
  if (!cached) return []
  const value = cached.value
  if (!Array.isArray(value)) throw new Error('Invalid source computation candidate index.')
  return value.map(parseSourceSnapshot)
}

export const readSourceComputation = async (
  backend: DagStorageBackend,
  base: Hash,
  snapshot: SourceSnapshot,
  repository: SourceManifestRepository,
) => {
  for (const sources of await readCandidates(backend, base)) {
    const keys = Object.keys(sources.manifests) as Hash[]
    if (!keys.every((key) => snapshot.manifests[key])) continue
    const selected = createSourceSnapshot(
      Object.fromEntries(keys.map((key) => [key, snapshot.manifests[key]!])),
    )
    const entry = await backend.getCacheEntry(await computationKey(base, selected, repository))
    const cached = entry ? await readCachedDagArtifact(backend, entry.artifact) : null
    if (cached && entry) return { ...entry, sources: selected, value: cached.value }
  }
  return null
}

export const writeSourceComputation = async (
  backend: DagStorageBackend,
  base: Hash,
  manifests: Record<Hash, Hash>,
  artifact: Hash,
  repository: SourceManifestRepository,
) => {
  const sources = createSourceSnapshot(manifests)
  const key = await computationKey(base, sources, repository)
  const previous = await backend.getCacheEntry(key)
  if (previous && previous.artifact !== artifact) {
    throw new Error('Deterministic computation produced conflicting output artifacts.')
  }
  await backend.setCacheEntry(key, { artifact })
  const candidates = await readCandidates(backend, base)
  if (candidates.some((candidate) => candidate.id === sources.id)) return
  const index = await backend.writeArtifact([...candidates, sources])
  await backend.setCacheEntry(candidateKey(base), { artifact: index })
}
