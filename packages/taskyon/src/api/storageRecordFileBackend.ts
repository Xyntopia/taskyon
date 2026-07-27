import { z } from 'zod'
import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import { deepMerge } from '../utils/objHelpers'
import type { StorageRecordBackend } from './storageProtocol'

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

const storageObjectEntries = (value: unknown): [string, unknown][] | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return Object.entries(value)
}

const storageQueryMatches = (value: unknown, query: unknown): boolean => {
  if (query === undefined) return true
  if (Object.is(value, query)) return true
  if (query === null || value === null) return query === value

  if (Array.isArray(query)) {
    if (!Array.isArray(value)) return false
    return query.every((queryItem) =>
      value.some((valueItem) => storageQueryMatches(valueItem, queryItem)),
    )
  }

  const queryEntries = storageObjectEntries(query)
  if (queryEntries) {
    const valueEntries = storageObjectEntries(value)
    if (!valueEntries) return false
    const valueMap = new Map(valueEntries)
    return queryEntries.every(
      ([key, queryValue]) =>
        valueMap.has(key) && storageQueryMatches(valueMap.get(key), queryValue),
    )
  }

  return value === query
}

const mergeStorageRecord = (
  current: unknown,
  next: unknown,
  strategy: 'shallow_merge' | 'replace' | 'deepmerge' | 'native_shallow' = 'replace',
) => {
  if (strategy === 'replace') return next
  const currentEntries = storageObjectEntries(current)
  const nextEntries = storageObjectEntries(next)
  if (!currentEntries || !nextEntries) return next
  const currentObject = Object.fromEntries(currentEntries)
  const nextObject = Object.fromEntries(nextEntries)
  if (strategy === 'deepmerge') return deepMerge(currentObject, nextObject, 'overwrite')
  return { ...currentObject, ...nextObject }
}

export const storageRecordNamespacePath = (namespace: string) =>
  ['records', ...namespace.split('/').map(encodeURIComponent)].join('/')

const MAX_READABLE_ID_LENGTH = 160

const storageRecordFileName = (id: string | number) => {
  const type = typeof id
  const encodedId = encodeURIComponent(String(id))
  if (encodedId.length <= MAX_READABLE_ID_LENGTH) return `${type}-${encodedId}.json`

  const digest = canonicalHash({ type, value: id }).slice('sha256:'.length)
  return `${type}-sha256-${digest}.json`
}

export const storageRecordFilePath = (namespace: string, id: string | number) =>
  [storageRecordNamespacePath(namespace), storageRecordFileName(id)].join('/')

export const createStorageRecordFileBackend = (
  adapter: StorageRecordFileAdapter,
  namespace: string,
): StorageRecordBackend => {
  const directory = storageRecordNamespacePath(namespace)
  const withLock = <T>(operation: () => Promise<T>) =>
    adapter.withNamespaceLock ? adapter.withNamespaceLock(directory, operation) : operation()

  const readRecord = adapter.read
  const listRecords = async () => {
    const files = await adapter.list(directory)
    const records = await Promise.all(files.map(readRecord))
    return records.filter((record): record is StorageRecordFile => record !== null)
  }

  return {
    get: async (id) => (await readRecord(storageRecordFilePath(namespace, id)))?.data ?? null,
    set: async (id, value) =>
      await withLock(async () => {
        await adapter.write(storageRecordFilePath(namespace, id), { id, data: value })
      }),
    upsert: async (id, value, strategy) =>
      await withLock(async () => {
        const path = storageRecordFilePath(namespace, id)
        const current = await readRecord(path)
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
