import { createSha256Hasher } from '@taskyon/common/modules/canonicalHash'
import {
  mergeStorageRecord,
  storageQueryMatches,
  storageValueContentHash,
  type StorageBlobBackend,
  type StorageBlobMetadata,
  type StorageRecordBackend,
} from '@taskyon/taskyon/api'

const DATABASE_VERSION = 1
const RECORDS = 'records'
const BLOBS = 'blobs'
const WRITES = 'blobWrites'
const blobOptions = (contentType?: string): BlobPropertyBag | undefined =>
  contentType ? { type: contentType } : undefined

type RecordRow = { key: string; namespace: string; id: string | number; data: unknown }
type BlobRow = {
  key: string
  namespace: string
  id: string
  data: Blob
  metadata: StorageBlobMetadata
}
type BlobWriteRow = {
  key: string
  namespace: string
  id: string
  writeId: string
  data: Blob
  contentType?: string
}

const requestResult = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'))
  })

const transactionDone = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
  })

export const openTaskyonIndexedDb = (databaseName = 'taskyon-storage') =>
  new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Taskyon IndexedDB storage requires IndexedDB support.'))
      return
    }
    const request = indexedDB.open(databaseName, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(RECORDS)) {
        database.createObjectStore(RECORDS, { keyPath: 'key' })
      }
      if (!database.objectStoreNames.contains(BLOBS)) {
        database.createObjectStore(BLOBS, { keyPath: 'key' })
      }
      if (!database.objectStoreNames.contains(WRITES)) {
        database.createObjectStore(WRITES, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => database.close()
      resolve(database)
    }
    request.onerror = () => reject(request.error ?? new Error('Could not open Taskyon IndexedDB.'))
  })

const logicalKey = (namespace: string, id: string | number) =>
  `${encodeURIComponent(namespace)}\u0000${typeof id}:${String(id)}`
const writeKey = (namespace: string, writeId: string) =>
  `${encodeURIComponent(namespace)}\u0000${writeId}`

const rowsForNamespace = async <T extends { namespace: string }>(
  database: IDBDatabase,
  storeName: string,
  namespace: string,
) => {
  const transaction = database.transaction(storeName, 'readonly')
  const rows = await requestResult(transaction.objectStore(storeName).getAll() as IDBRequest<T[]>)
  await transactionDone(transaction)
  return rows.filter((row) => row.namespace === namespace)
}

const clearNamespace = async (
  database: IDBDatabase,
  storeNames: readonly string[],
  namespace: string,
) => {
  const transaction = database.transaction([...storeNames], 'readwrite')
  await Promise.all(
    storeNames.map(async (storeName) => {
      const store = transaction.objectStore(storeName)
      const rows = await requestResult(
        store.getAll() as IDBRequest<Array<{ key: string; namespace: string }>>,
      )
      await Promise.all(
        rows
          .filter((row) => row.namespace === namespace)
          .map((row) => requestResult(store.delete(row.key))),
      )
    }),
  )
  await transactionDone(transaction)
}

export const createIndexedDbRecordBackend = async (
  namespace: string,
  databaseName?: string,
): Promise<StorageRecordBackend> => {
  const database = await openTaskyonIndexedDb(databaseName)
  const key = (id: string | number) => logicalKey(namespace, id)
  const getRow = async (id: string | number) => {
    const transaction = database.transaction(RECORDS, 'readonly')
    const row = await requestResult(
      transaction.objectStore(RECORDS).get(key(id)) as IDBRequest<RecordRow | undefined>,
    )
    await transactionDone(transaction)
    return row
  }
  const listRows = () => rowsForNamespace<RecordRow>(database, RECORDS, namespace)

  return {
    get: async (id) => (await getRow(id))?.data ?? null,
    getMany: async (ids) => {
      const values = await Promise.all(ids.map(getRow))
      return values.flatMap((row) => (row ? [{ id: row.id, data: row.data }] : []))
    },
    set: async (id, data) => {
      const transaction = database.transaction(RECORDS, 'readwrite')
      await requestResult(
        transaction.objectStore(RECORDS).put({ key: key(id), namespace, id, data }),
      )
      await transactionDone(transaction)
    },
    setIfUnchanged: async (id, expectedStoredContentHash, data) => {
      const transaction = database.transaction(RECORDS, 'readwrite')
      const store = transaction.objectStore(RECORDS)
      const row = await requestResult(store.get(key(id)) as IDBRequest<RecordRow | undefined>)
      const current = row?.data ?? null
      const currentStoredContentHash = current === null ? null : storageValueContentHash(current)
      if (currentStoredContentHash !== expectedStoredContentHash) {
        await transactionDone(transaction)
        return { written: false, currentStoredContentHash }
      }
      await requestResult(store.put({ key: key(id), namespace, id, data }))
      await transactionDone(transaction)
      return { written: true, currentStoredContentHash: storageValueContentHash(data) }
    },
    setMany: async (rows) => {
      const transaction = database.transaction(RECORDS, 'readwrite')
      const store = transaction.objectStore(RECORDS)
      await Promise.all(
        rows.map(({ id, data }) => requestResult(store.put({ key: key(id), namespace, id, data }))),
      )
      await transactionDone(transaction)
    },
    upsert: async (id, data, strategy) => {
      const transaction = database.transaction(RECORDS, 'readwrite')
      const store = transaction.objectStore(RECORDS)
      const current = await requestResult(store.get(key(id)) as IDBRequest<RecordRow | undefined>)
      const next = mergeStorageRecord(current?.data, data, strategy)
      await requestResult(store.put({ key: key(id), namespace, id, data: next }))
      await transactionDone(transaction)
      return next
    },
    delete: async (id) => {
      const transaction = database.transaction(RECORDS, 'readwrite')
      await requestResult(transaction.objectStore(RECORDS).delete(key(id)))
      await transactionDone(transaction)
    },
    list: async () => (await listRows()).map(({ id, data }) => ({ id, data })),
    listIds: async () => (await listRows()).map(({ id }) => id),
    find: async (query) =>
      Object.fromEntries(
        (await listRows())
          .filter(({ data }) => storageQueryMatches(data, query))
          .map(({ id, data }) => [String(id), data]),
      ),
    clear: async () => await clearNamespace(database, [RECORDS], namespace),
  }
}

const hashBlob = async (blob: Blob) => {
  const hasher = createSha256Hasher()
  const reader = blob.stream().getReader()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return hasher.digest()
      hasher.update(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
}

export const createIndexedDbBlobBackend = async (
  namespace: string,
  databaseName?: string,
): Promise<StorageBlobBackend> => {
  const database = await openTaskyonIndexedDb(databaseName)
  const key = (id: string) => logicalKey(namespace, id)
  const getRow = async (id: string) => {
    const transaction = database.transaction(BLOBS, 'readonly')
    const row = await requestResult(
      transaction.objectStore(BLOBS).get(key(id)) as IDBRequest<BlobRow | undefined>,
    )
    await transactionDone(transaction)
    return row
  }
  const putBlob = async (id: string, data: Blob, contentType?: string, sha256?: string) => {
    const metadata: StorageBlobMetadata = {
      id,
      size: data.size,
      modifiedAt: new Date().toISOString(),
      ...(contentType ? { contentType } : {}),
      ...(sha256 ? { sha256 } : {}),
    }
    const transaction = database.transaction(BLOBS, 'readwrite')
    await requestResult(
      transaction.objectStore(BLOBS).put({ key: key(id), namespace, id, data, metadata }),
    )
    await transactionDone(transaction)
    return metadata
  }

  return {
    get: async (id) => {
      const row = await getRow(id)
      return row
        ? { data: new Uint8Array(await row.data.arrayBuffer()), metadata: row.metadata }
        : null
    },
    set: async (id, data, contentType) => {
      const blob = new Blob([data], blobOptions(contentType))
      return await putBlob(id, blob, contentType, await hashBlob(blob))
    },
    stat: async (id) => (await getRow(id))?.metadata ?? null,
    list: async () =>
      (await rowsForNamespace<BlobRow>(database, BLOBS, namespace)).map(({ metadata }) => metadata),
    readRange: async (id, offset, length) => {
      const row = await getRow(id)
      if (!row) throw new Error(`Blob not found: ${id}`)
      const data = new Uint8Array(await row.data.slice(offset, offset + length).arrayBuffer())
      const nextOffset = offset + data.byteLength
      return { data, nextOffset, eof: nextOffset >= row.data.size }
    },
    append: async (id, data, expectedSize, contentType) => {
      const row = await getRow(id)
      const current = row?.data ?? new Blob()
      if (current.size !== expectedSize) {
        throw new Error(
          `Blob append offset mismatch for "${id}": expected ${expectedSize}, found ${current.size}.`,
        )
      }
      return await putBlob(
        id,
        new Blob([current, data], blobOptions(contentType ?? row?.metadata.contentType)),
        contentType ?? row?.metadata.contentType,
      )
    },
    beginWrite: async (id, contentType) => {
      const writeId = crypto.randomUUID()
      const transaction = database.transaction(WRITES, 'readwrite')
      await requestResult(
        transaction.objectStore(WRITES).put({
          key: writeKey(namespace, writeId),
          namespace,
          id,
          writeId,
          data: new Blob(),
          ...(contentType ? { contentType } : {}),
        }),
      )
      await transactionDone(transaction)
      return { writeId }
    },
    writeChunk: async (id, writeId, offset, data) => {
      const transaction = database.transaction(WRITES, 'readwrite')
      const store = transaction.objectStore(WRITES)
      const row = await requestResult(
        store.get(writeKey(namespace, writeId)) as IDBRequest<BlobWriteRow | undefined>,
      )
      if (!row || row.id !== id) throw new Error(`Unknown blob write: ${writeId}`)
      if (offset > row.data.size)
        throw new Error(`Blob write offset ${offset} exceeds size ${row.data.size}.`)
      const next = new Blob([
        row.data.slice(0, offset),
        data,
        row.data.slice(offset + data.byteLength),
      ])
      await requestResult(store.put({ ...row, data: next }))
      await transactionDone(transaction)
      return { nextOffset: Math.max(row.data.size, offset + data.byteLength) }
    },
    writeStatus: async (id, writeId) => {
      const transaction = database.transaction(WRITES, 'readonly')
      const row = await requestResult(
        transaction.objectStore(WRITES).get(writeKey(namespace, writeId)) as IDBRequest<
          BlobWriteRow | undefined
        >,
      )
      await transactionDone(transaction)
      if (!row || row.id !== id) throw new Error(`Unknown blob write: ${writeId}`)
      return { size: row.data.size }
    },
    commitWrite: async (id, writeId, expectedSize, expectedSha256, targetId) => {
      const transaction = database.transaction(WRITES, 'readonly')
      const row = await requestResult(
        transaction.objectStore(WRITES).get(writeKey(namespace, writeId)) as IDBRequest<
          BlobWriteRow | undefined
        >,
      )
      await transactionDone(transaction)
      if (!row || row.id !== id) throw new Error(`Unknown blob write: ${writeId}`)
      if (row.data.size !== expectedSize) throw new Error(`Blob size mismatch for "${id}".`)
      const sha256 = await hashBlob(row.data)
      if (expectedSha256 && sha256 !== expectedSha256)
        throw new Error(`Blob checksum mismatch for "${id}".`)
      const metadata = await putBlob(targetId ?? id, row.data, row.contentType, sha256)
      const cleanup = database.transaction(WRITES, 'readwrite')
      await requestResult(cleanup.objectStore(WRITES).delete(writeKey(namespace, writeId)))
      await transactionDone(cleanup)
      return metadata
    },
    abortWrite: async (_id, writeId) => {
      const transaction = database.transaction(WRITES, 'readwrite')
      await requestResult(transaction.objectStore(WRITES).delete(writeKey(namespace, writeId)))
      await transactionDone(transaction)
    },
    delete: async (id) => {
      const transaction = database.transaction(BLOBS, 'readwrite')
      await requestResult(transaction.objectStore(BLOBS).delete(key(id)))
      await transactionDone(transaction)
    },
    clear: async () => await clearNamespace(database, [BLOBS, WRITES], namespace),
  }
}
