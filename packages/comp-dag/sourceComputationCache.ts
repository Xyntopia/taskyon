import { canonicalHash, type DagStorageBackend, type Hash } from './caching.ts'
import { createSourceSnapshot, parseSourceSnapshot, type SourceSnapshot } from './sourceManifest.ts'

// The existing cache remains computation -> result. This rebuildable candidate index locates
// consumed-source sets without using the whole invocation snapshot as computation identity.
const candidateKey = (base: Hash) => canonicalHash({ kind: 'taskyon.sourceCandidates.v1', base })
const computationKey = (base: Hash, sources: SourceSnapshot) =>
  canonicalHash({ kind: 'taskyon.sourceComputation.v1', base, sources: sources.id })

const readCandidates = async (backend: DagStorageBackend, base: Hash) => {
  const entry = await backend.getCacheEntry(candidateKey(base))
  if (!entry) return []
  const value = await backend.readArtifact<unknown>(entry.artifact)
  if (!Array.isArray(value)) throw new Error('Invalid source computation candidate index.')
  return value.map(parseSourceSnapshot)
}

export const readSourceComputation = async (
  backend: DagStorageBackend,
  base: Hash,
  snapshot: SourceSnapshot,
) => {
  for (const sources of await readCandidates(backend, base)) {
    if (
      !Object.entries(sources.manifests).every(
        ([key, id]) => snapshot.manifests[key as Hash] === id,
      )
    )
      continue
    const entry = await backend.getCacheEntry(computationKey(base, sources))
    if (entry) return { ...entry, sources }
  }
  return null
}

export const writeSourceComputation = async (
  backend: DagStorageBackend,
  base: Hash,
  manifests: Record<Hash, Hash>,
  artifact: Hash,
) => {
  const sources = createSourceSnapshot(manifests)
  const key = computationKey(base, sources)
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
