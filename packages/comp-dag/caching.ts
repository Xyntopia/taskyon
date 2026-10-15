import {
  canonicalHash as hashCanonicalJson,
  type Sha256Hash,
} from '@taskyon/common/modules/canonicalHash'

export type Hash = Sha256Hash

export class MissingDagArtifact extends Error {
  readonly hash: Hash
  constructor(hash: Hash) {
    super(`Artifact not found: ${hash}`)
    this.name = 'MissingDagArtifact'
    this.hash = hash
  }
}

// Storage backend abstraction
export interface DagStorageBackend {
  /** Missing data throws MissingDagArtifact; other failures remain explicit errors. */
  readArtifact<O>(hash: Hash): Promise<O> | O
  writeArtifact(value: unknown): Promise<Hash> | Hash
  getCacheEntry(key: string): Promise<{ artifact: Hash } | null> | { artifact: Hash } | null
  setCacheEntry(key: string, entry: { artifact: Hash }): Promise<void> | void
}

/**
 * Computes a deterministic SHA-256 hash for a JSON-serializable value.
 *
 * @param value the value to hash
 * @returns the SHA-256 hash string
 */
export const canonicalHash = (value: unknown): Hash => hashCanonicalJson(value)

// -----------------------------
// In-memory artifact store & cache catalog (default backend)
// -----------------------------

// artifactHash -> JSON string
const artifactStore = new Map<Hash, string>()

// nodeKey -> artifactHash
const cacheCatalog = new Map<string, { artifact: Hash }>()

// Default in-memory storage backend
const inMemoryBackend: DagStorageBackend = {
  readArtifact<O>(hash: Hash) {
    const json = artifactStore.get(hash)
    if (!json) {
      throw new MissingDagArtifact(hash)
    }
    return JSON.parse(json) as O
  },

  writeArtifact(value: unknown) {
    const json = JSON.stringify(value)
    const hash = canonicalHash(value)
    artifactStore.set(hash, json)
    return hash
  },

  getCacheEntry(key: string) {
    return cacheCatalog.get(key) ?? null
  },

  setCacheEntry(key: string, entry: { artifact: Hash }) {
    cacheCatalog.set(key, entry)
  },
}

/**
 * Returns the shared in-memory DAG storage backend.
 *
 * @returns the default in-memory backend
 */
export function getDefaultInMemoryBackend(): DagStorageBackend {
  return inMemoryBackend
}

/** Missing derived data is rebuildable; corruption and storage failures are not cache misses. */
export const readCachedDagArtifact = async (
  backend: DagStorageBackend,
  hash: Hash,
): Promise<{ value: unknown } | null> => {
  try {
    const value = await backend.readArtifact<unknown>(hash)
    if (canonicalHash(value) !== hash) throw new Error('Cached DAG artifact integrity mismatch.')
    return { value }
  } catch (error) {
    if (error instanceof MissingDagArtifact) return null
    throw error
  }
}
