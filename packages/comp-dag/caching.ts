// caching.ts

export type Hash = `sha256:${string}`

// Storage backend abstraction
export interface DagStorageBackend {
  readArtifact<O>(hash: Hash): Promise<O> | O
  writeArtifact(value: unknown): Promise<Hash> | Hash
  getCacheEntry(key: string): Promise<{ artifact: Hash } | null> | { artifact: Hash } | null
  setCacheEntry(key: string, entry: { artifact: Hash }): Promise<void> | void
}

// small, deterministic, JSON-based hashing
/**
 * Produces a JSON-stable version of the input by ordering object keys.
 *
 * @param value the value to normalize
 * @returns a value with deterministic key ordering
 */
function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue)
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const out: Record<string, unknown> = {}
    for (const k of keys) {
      out[k] = stableValue(obj[k])
    }
    return out
  }
  return value
}

// TODO: we declare this function async to be able to use real hashes in later stages
// TODO: use hash-wasm xxHash64 + stableStringify for this here
/**
 * Computes a deterministic hash string for the provided value.
 *
 * @param value the value to hash
 * @returns the pseudo SHA-256 hash string
 */
export function canonicalHash(value: unknown): Hash {
  const stable = stableValue(value)
  const json = JSON.stringify(stable)
  // simple non-crypto hash for tests
  let acc = 0
  for (let i = 0; i < json.length; i++) {
    acc = (acc * 31 + json.charCodeAt(i)) >>> 0
  }
  const hex = acc.toString(16).padStart(8, '0')
  return `sha256:${hex.padEnd(64, '0')}`
}

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
