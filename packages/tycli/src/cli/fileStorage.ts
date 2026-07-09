import { constants } from 'node:fs'
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { Port } from '@taskyon/common/modules/frpBus'
import {
  createStorageProtocolServer,
  type StorageRecordBackend,
  type TaskyonStorageMessage,
} from '../../../taskyon/src/api/storageProtocol'
import { deepMerge } from '../../../taskyon/src/utils/objHelpers'

const storageIdSchema = z.union([z.string(), z.number()])
const storageRecordFileSchema = z.object({
  id: storageIdSchema,
  data: z.unknown(),
})

type StorageRecordFile = z.output<typeof storageRecordFileSchema>

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isAlreadyExistsError = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST'

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

const namespacePath = (storageRoot: string, namespace: string) =>
  join(storageRoot, 'records', ...namespace.split('/').map(encodeURIComponent))

const recordPath = (storageRoot: string, namespace: string, id: string | number) =>
  join(namespacePath(storageRoot, namespace), `${typeof id}-${encodeURIComponent(String(id))}.json`)

const withDirectoryLock = async <T>(lockDir: string, operation: () => Promise<T>): Promise<T> => {
  const startedAt = Date.now()
  await mkdir(dirname(lockDir), { recursive: true })
  while (true) {
    try {
      await mkdir(lockDir, { recursive: false })
      break
    } catch (error) {
      if (!isAlreadyExistsError(error) || Date.now() - startedAt > 10_000) throw error
      await sleep(25)
    }
  }

  try {
    return await operation()
  } finally {
    await rm(lockDir, { recursive: true, force: true })
  }
}

const readRecordFile = async (filePath: string): Promise<StorageRecordFile | null> => {
  try {
    const raw = await readFile(filePath, 'utf8')
    return storageRecordFileSchema.parse(JSON.parse(raw))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

const writeRecordFile = async (filePath: string, record: StorageRecordFile) => {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

const listRecordFiles = async (dir: string): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => join(dir, entry.name))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
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

export const createCliFileStorageBackend = (
  storageRoot: string,
  namespace: string,
): StorageRecordBackend => {
  const dir = namespacePath(storageRoot, namespace)
  const namespaceLock = `${dir}.lock`

  const listRecords = async () => {
    const files = await listRecordFiles(dir)
    const records = await Promise.all(files.map(readRecordFile))
    return records.filter((record): record is StorageRecordFile => record !== null)
  }

  return {
    get: async (id) => (await readRecordFile(recordPath(storageRoot, namespace, id)))?.data ?? null,
    set: async (id, value) =>
      await withDirectoryLock(namespaceLock, async () => {
        await writeRecordFile(recordPath(storageRoot, namespace, id), { id, data: value })
      }),
    upsert: async (id, value, strategy) =>
      await withDirectoryLock(namespaceLock, async () => {
        const filePath = recordPath(storageRoot, namespace, id)
        const current = await readRecordFile(filePath)
        const next = mergeStorageRecord(current?.data, value, strategy)
        await writeRecordFile(filePath, { id, data: next })
        return next
      }),
    delete: async (id) =>
      await withDirectoryLock(namespaceLock, async () => {
        await rm(recordPath(storageRoot, namespace, id), { force: true })
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
      await withDirectoryLock(namespaceLock, async () => {
        await rm(dir, { recursive: true, force: true })
        await mkdir(dir, { recursive: true })
      }),
  }
}

export const createCliFileStorageService = (
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  storageRoot: string,
) =>
  createStorageProtocolServer(port, async (namespace) => {
    await mkdir(storageRoot, { recursive: true })
    await access(storageRoot, constants.W_OK)
    return createCliFileStorageBackend(storageRoot, namespace)
  })
