import { z } from 'zod'
import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import type { StorageRecordBackend } from './storageProtocol'
import {
  mergeStorageRecord,
  storageQueryMatches,
  storageValueContentHash,
} from './storageRecordOperations'

const storageIdSchema = z.union([z.string(), z.number()])
const storageRecordFileSchema = z.object({
  id: storageIdSchema,
  data: z.unknown(),
})

type StorageRecordFile = z.output<typeof storageRecordFileSchema>

export type StorageRecordFileAdapter = {
  read: (path: string) => Promise<StorageRecordFile | null>
  write: (path: string, value: StorageRecordFile) => Promise<void>
  remove: (path: string) => Promise<void>
  list: (directory: string) => Promise<string[]>
  clearDirectory: (directory: string) => Promise<void>
  withNamespaceLock?: <T>(namespaceDirectory: string, operation: () => Promise<T>) => Promise<T>
}

export const parseStorageRecordFile = (value: unknown): StorageRecordFile =>
  storageRecordFileSchema.parse(value)

const MAX_PATH_COMPONENT_LENGTH = 255

const boundedPathComponent = (value: string) => {
  const encoded = encodeURIComponent(value)
  return encoded.length <= MAX_PATH_COMPONENT_LENGTH
    ? encoded
    : `sha256_${canonicalHash(value).slice('sha256:'.length)}`
}

export const storageRecordNamespacePath = (namespace: string) =>
  ['records', ...namespace.split('/').map(boundedPathComponent)].join('/')

export const storageRecordFilePath = (namespace: string, id: string | number) => {
  const hash = canonicalHash({ type: typeof id, value: id }).slice('sha256:'.length)
  return [storageRecordNamespacePath(namespace), hash.slice(0, 2), hash.slice(2)].join('/')
}

export const createStorageRecordFileBackend = (
  adapter: StorageRecordFileAdapter,
  namespace: string,
): StorageRecordBackend => {
  const directory = storageRecordNamespacePath(namespace)
  const withLock = <T>(operation: () => Promise<T>) =>
    adapter.withNamespaceLock ? adapter.withNamespaceLock(directory, operation) : operation()

  const readRecordFile = adapter.read
  const readRecord = async (id: string | number) => {
    const record = await readRecordFile(storageRecordFilePath(namespace, id))
    if (record && !Object.is(record.id, id)) {
      throw new Error(`Storage record id mismatch for namespace "${namespace}".`)
    }
    return record
  }
  const listRecords = async () => {
    const files = await adapter.list(directory)
    const records = await Promise.all(files.map(readRecordFile))
    return records.filter((record): record is StorageRecordFile => record !== null)
  }

  return {
    get: async (id) => (await readRecord(id))?.data ?? null,
    getMany: async (ids) => {
      const records = await Promise.all(ids.map(readRecord))
      return records
        .filter((record): record is StorageRecordFile => record !== null)
        .map((record) => ({ id: record.id, data: record.data }))
    },
    set: async (id, value) =>
      await withLock(async () => {
        await adapter.write(storageRecordFilePath(namespace, id), { id, data: value })
      }),
    setIfUnchanged: async (id, expectedStoredContentHash, value) =>
      await withLock(async () => {
        const current = (await readRecord(id))?.data ?? null
        const currentStoredContentHash = current === null ? null : storageValueContentHash(current)
        if (currentStoredContentHash !== expectedStoredContentHash) {
          return { written: false, currentStoredContentHash }
        }
        await adapter.write(storageRecordFilePath(namespace, id), { id, data: value })
        return { written: true, currentStoredContentHash: storageValueContentHash(value) }
      }),
    setMany: async (rows) =>
      await withLock(async () => {
        await Promise.all(
          rows.map(async ({ id, data }) =>
            adapter.write(storageRecordFilePath(namespace, id), { id, data }),
          ),
        )
      }),
    upsert: async (id, value, strategy) =>
      await withLock(async () => {
        const path = storageRecordFilePath(namespace, id)
        const current = await readRecord(id)
        const next = mergeStorageRecord(current?.data, value, strategy)
        await adapter.write(path, { id, data: next })
        return next
      }),
    delete: async (id) =>
      await withLock(async () => {
        await adapter.remove(storageRecordFilePath(namespace, id))
      }),
    list: async () => (await listRecords()).map((record) => ({ id: record.id, data: record.data })),
    listIds: async () => (await listRecords()).map((record) => record.id),
    find: async (query) =>
      Object.fromEntries(
        (await listRecords())
          .filter((record) => storageQueryMatches(record.data, query))
          .map((record) => [String(record.id), record.data]),
      ),
    clear: async () =>
      await withLock(async () => {
        await adapter.clearDirectory(directory)
      }),
  }
}
