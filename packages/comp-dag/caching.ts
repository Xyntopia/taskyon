import {
  canonicalHash as hashCanonicalJson,
  type Sha256Hash,
} from '@taskyon/common/modules/canonicalHash'

export type Hash = Sha256Hash

// Storage backend abstraction
export interface DagStorageBackend {
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
      throw new Error(`Artifact not found: ${hash}`)
    }
    return JSON.parse(json) as O
  },

  writeArtifact(value: unknown) {
    const json = JSON.stringify(value)
    const hash = canonicalHash(json)
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
