// dagOpfsBackend.ts
// OPFS-based storage backend for DAG artifacts and cache.

import { canonicalHash, type DagStorageBackend, type Hash } from './caching'
import { openFile, writeFile } from './opfsStorage'

type CacheIndex = Record<string, { artifact: Hash }>

/**
 * Reads a JSON file from OPFS, returning null when missing or unreadable.
 *
 * @param path the OPFS path to read
 * @returns the parsed JSON data or null
 */
async function readJsonFileOrNull<T>(path: string): Promise<T | null> {
  try {
    const file = await openFile(path)
    const text = await file.text()
    return JSON.parse(text) as T
  } catch {
    // File may not exist yet, or other I/O error — treat as "no data"
    return null
  }
}

/**
 * Writes JSON data to OPFS at the given path.
 *
 * @param path the OPFS path to write
 * @param data the JSON-serializable data to persist
 * @returns a promise that resolves when the write completes
 */
async function writeJsonFile(path: string, data: unknown): Promise<void> {
  const json = JSON.stringify(data)
  const fileName = path.split('/').pop() ?? 'data.json'
  const file = new File([json], fileName, { type: 'application/json' })
  await writeFile(path, file)
}

/**
 * Creates an OPFS-backed DAG storage backend with the given prefix.
 *
 * @param prefix the directory prefix for artifacts and cache
 * @returns the OPFS-backed storage backend
 */
export function createOpfsDagBackend(prefix = 'dag'): DagStorageBackend {
  const artifactsDir = `${prefix}/artifacts`
  const cacheIndexPath = `${prefix}/cache/index.json`

  return {
    async readArtifact<O>(hash: Hash): Promise<O> {
      const file = await openFile(`${artifactsDir}/${hash}.json`)
      const text = await file.text()
      return JSON.parse(text) as O
    },

    async writeArtifact(value: unknown): Promise<Hash> {
      const json = JSON.stringify(value)
      const hash = await canonicalHash(json)
      const file = new File([json], `${hash}.json`, { type: 'application/json' })
      await writeFile(`${artifactsDir}/${hash}.json`, file)
      return hash
    },

    async getCacheEntry(key: string): Promise<{ artifact: Hash } | null> {
      const index = (await readJsonFileOrNull<CacheIndex>(cacheIndexPath)) ?? {}
      return index[key] ?? null
    },

    async setCacheEntry(key: string, entry: { artifact: Hash }): Promise<void> {
      const index = (await readJsonFileOrNull<CacheIndex>(cacheIndexPath)) ?? {}
      index[key] = entry
      await writeJsonFile(cacheIndexPath, index)
    },
  }
}
