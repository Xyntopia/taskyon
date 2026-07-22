import { deleteFile, listFiles, openFile, writeFile } from '@taskyon/comp-dag/opfsStorage'
import type { StorageRecordBackend } from '@taskyon/taskyon/api'

type StoredRecord = { id: string | number; data: unknown }

const namespaceDirectory = (namespace: string) =>
  `taskyon-storage/records/${encodeURIComponent(namespace)}`

const recordName = (id: string | number) => `${typeof id}-${encodeURIComponent(String(id))}.json`

const recordPath = (namespace: string, id: string | number) =>
  `${namespaceDirectory(namespace)}/${recordName(id)}`

const parseStoredRecord = (value: unknown): StoredRecord => {
  if (typeof value !== 'object' || value === null || !('id' in value) || !('data' in value)) {
    throw new Error('Invalid OPFS storage record.')
  }
  if (typeof value.id !== 'string' && typeof value.id !== 'number') {
    throw new Error('Invalid OPFS storage record ID.')
  }
  return { id: value.id, data: value.data }
}

const readRecord = async (namespace: string, id: string | number): Promise<StoredRecord | null> => {
  try {
    return parseStoredRecord(JSON.parse(await (await openFile(recordPath(namespace, id))).text()))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

const listRecords = async (namespace: string): Promise<StoredRecord[]> => {
  let names: string[]
  try {
    names = await listFiles(namespaceDirectory(namespace))
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return []
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
  return await Promise.all(
    names.map(async (name) =>
      parseStoredRecord(
        JSON.parse(await (await openFile(`${namespaceDirectory(namespace)}/${name}`)).text()),
      ),
    ),
  )
}

const writeRecord = async (namespace: string, record: StoredRecord) => {
  const json = JSON.stringify(record)
  await writeFile(
    recordPath(namespace, record.id),
    new File([json], recordName(record.id), { type: 'application/json' }),
  )
}

export const createOpfsRecordStorageBackend = (namespace: string): StorageRecordBackend => ({
  get: async (id) => (await readRecord(namespace, id))?.data ?? null,
  set: async (id, value) => await writeRecord(namespace, { id, data: value }),
  upsert: async (id, value, strategy = 'replace') => {
    const current = (await readRecord(namespace, id))?.data
    const next =
      strategy !== 'replace' &&
      typeof current === 'object' &&
      current !== null &&
      !Array.isArray(current) &&
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
        ? { ...current, ...value }
        : value
    await writeRecord(namespace, { id, data: next })
    return next
  },
  delete: async (id) => await deleteFile(recordPath(namespace, id)),
  list: async () => await listRecords(namespace),
  listIds: async () => (await listRecords(namespace)).map((record) => record.id),
  find: async (query) =>
    Object.fromEntries(
      (await listRecords(namespace))
        .filter((record) => query === undefined || Object.is(record.data, query))
        .map((record) => [String(record.id), record.data]),
    ),
  clear: async () => {
    await Promise.all(
      (await listRecords(namespace)).map((record) => deleteFile(recordPath(namespace, record.id))),
    )
  },
})
