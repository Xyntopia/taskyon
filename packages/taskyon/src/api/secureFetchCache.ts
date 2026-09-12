import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import type { SecureFetchCache, SecureFetchCacheEntry } from '@taskyon/secure-tunnel'
import type { TaskyonStorageClient } from './storageProtocol'

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_ENTRY_BYTES = 16 * 1024 * 1024
const namespace = 'secure-fetch-cache/v1'

type StoredEntry = Omit<SecureFetchCacheEntry, 'body'> & {
  bodyBase64: string
  accessedAt: number
}

const encode = (bytes: Uint8Array) => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

const decode = (value: string) =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
const idFor = (url: string) => canonicalHash({ kind: 'taskyon.secure-fetch-cache.v1', url })

const parseStoredEntry = (value: unknown): StoredEntry | null => {
  if (!value || typeof value !== 'object') return null
  const entry = value as Partial<StoredEntry>
  return typeof entry.url === 'string' &&
    typeof entry.bodyBase64 === 'string' &&
    typeof entry.status === 'number' &&
    typeof entry.storedAt === 'number' &&
    typeof entry.expiresAt === 'number' &&
    Array.isArray(entry.headers)
    ? (entry as StoredEntry)
    : null
}

export const createStorageClientSecureFetchCache = (
  storage: TaskyonStorageClient,
  options: { maxBytes?: number; maxEntryBytes?: number } = {},
): SecureFetchCache => {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES
  return {
    get: async (url) => {
      const { value } = await storage.get({ namespace, id: idFor(url) })
      const stored = parseStoredEntry(value)
      if (!stored || stored.url !== url) return null
      await storage.set({ namespace, id: idFor(url), value: { ...stored, accessedAt: Date.now() } })
      const { bodyBase64, accessedAt, ...entry } = stored
      void accessedAt
      const body = decode(bodyBase64)
      return { ...entry, body }
    },
    set: async (entry) => {
      if (entry.body.byteLength > maxEntryBytes) return
      const value: StoredEntry = {
        ...entry,
        bodyBase64: encode(entry.body),
        accessedAt: Date.now(),
      }
      await storage.set({ namespace, id: idFor(entry.url), value })
      const { rows } = await storage.list({ namespace })
      const entries = rows
        .flatMap(({ id, data }) => {
          const parsed = parseStoredEntry(data)
          return parsed ? [{ id, entry: parsed, bytes: parsed.bodyBase64.length }] : []
        })
        .sort((left, right) => left.entry.accessedAt - right.entry.accessedAt)
      let total = entries.reduce((sum, item) => sum + item.bytes, 0)
      for (const item of entries) {
        if (total <= maxBytes) break
        await storage.delete({ namespace, id: item.id })
        total -= item.bytes
      }
    },
    delete: async (url) => await storage.delete({ namespace, id: idFor(url) }),
  }
}
