import { canonicalHash, type DagStorageBackend, type Hash } from './caching'

export type DagStorageRecords = {
  get: (namespace: string, id: string) => Promise<unknown>
  set: (namespace: string, id: string, value: unknown) => Promise<void>
}

const parseArtifactHash = (value: unknown): Hash => {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error('Invalid DAG artifact hash in storage cache entry.')
  }
  return value as Hash
}

const parseCacheEntry = (value: unknown): { artifact: Hash } | null => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || !('artifact' in value)) {
    throw new Error('Invalid DAG cache entry in storage records.')
  }
  return { artifact: parseArtifactHash(value.artifact) }
}

export const createStorageDagBackend = (
  storage: DagStorageRecords,
  namespace = 'dag',
): DagStorageBackend => ({
  async readArtifact<O>(hash: Hash): Promise<O> {
    const value = await storage.get(`${namespace}/artifacts`, hash)
    if (value === null || value === undefined) throw new Error(`Artifact not found: ${hash}`)
    return value as O
  },
  async writeArtifact(value: unknown): Promise<Hash> {
    const hash = canonicalHash(JSON.stringify(value))
    await storage.set(`${namespace}/artifacts`, hash, value)
    return hash
  },
  async getCacheEntry(key: string) {
    return parseCacheEntry(await storage.get(`${namespace}/cache`, key))
  },
  async setCacheEntry(key: string, entry: { artifact: Hash }) {
    await storage.set(`${namespace}/cache`, key, entry)
  },
})
