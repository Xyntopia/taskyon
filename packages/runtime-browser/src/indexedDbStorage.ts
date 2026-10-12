import {
  createChunkedBlobBackend,
  STORAGE_CHUNK_BYTES,
  type BlobChunkStore,
  mergeStorageRecord,
  storageQueryMatches,
  storageValueContentHash,
  type StorageBlobBackend,
  type StorageBlobMetadata,
  type StorageRecordBackend,
} from '@taskyon/taskyon/api'

const DATABASE_VERSION = 2
const RECORDS = 'records'
const BLOBS = 'blobs'
const WRITES = 'blobWrites'
const CHUNKS = 'blobChunks'
type RecordRow = { key: string; namespace: string; id: string | number; data: unknown }
type BlobRow = {
  key: string
  namespace: string
  id: string
  data?: Blob
  metadata: StorageBlobMetadata
  generation?: string
}
type BlobWriteRow = {
  key: string
  namespace: string
  id: string
  writeId: string
  data?: Blob
  generation?: string
  size?: number
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
      if (!database.objectStoreNames.contains(CHUNKS))
        database.createObjectStore(CHUNKS, { keyPath: 'key' })
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

export const createIndexedDbBlobBackend = async (
  namespace: string,
  databaseName?: string,
): Promise<StorageBlobBackend> => {
  const database = await openTaskyonIndexedDb(databaseName)
  const prefix = `${encodeURIComponent(namespace)}\u0000`
  const range = IDBKeyRange.bound(prefix, prefix + '\uffff')
  const createStore = (
    transaction?: IDBTransaction,
    submit?: <T>(operation: () => IDBRequest<T>) => Promise<T>,
  ): BlobChunkStore => {
    const execute = <T>(operation: () => IDBRequest<T>): Promise<T> => {
      if (!submit) throw new Error('Blob operation requires an active transaction')
      return submit(operation)
    }
    const objectStore = (name: string) => {
      if (!transaction) throw new Error('Blob operation requires a transaction')
      return transaction.objectStore(name)
    }
    const read = <T>(name: string, key: string) =>
      execute(() => objectStore(name).get(key) as IDBRequest<T | undefined>)
    const store: BlobChunkStore = {
      transaction: async (operation) => {
        const tx = database.transaction([BLOBS, WRITES, CHUNKS], 'readwrite')
        const completed = transactionDone(tx)
        // Legacy Blob.slice().arrayBuffer() is asynchronous outside IndexedDB. Keep the
        // transaction alive until migration and publication complete, without loading it all.
        let active = true
        const jobs: (() => void)[] = []
        const submit = <T>(operation: () => IDBRequest<T>) =>
          new Promise<T>((resolve, reject) => {
            jobs.push(() => {
              try {
                void requestResult(operation()).then(resolve, reject)
              } catch (error) {
                reject(error instanceof Error ? error : new Error(String(error)))
              }
            })
          })
        const keepAlive = () => {
          if (!active) return
          const request = tx.objectStore(WRITES).get(prefix)
          request.onsuccess = () => {
            for (const job of jobs.splice(0)) job()
            keepAlive()
          }
        }
        keepAlive()
        try {
          const result = await Promise.race([
            operation(createStore(tx, submit)),
            completed.then(() => {
              throw new Error('Blob transaction completed before its operation')
            }),
          ])
          active = false
          await completed
          return result
        } catch (error) {
          active = false
          try {
            tx.abort()
          } catch {
            /* It may already have aborted. */
          }
          await completed.catch(() => undefined)
          throw error
        }
      },
      get: async (id) => {
        const row = await read<BlobRow>(BLOBS, logicalKey(namespace, id))
        return row
          ? { metadata: row.metadata, ...(row.generation ? { generation: row.generation } : {}) }
          : null
      },
      list: async () =>
        (await execute(() => objectStore(BLOBS).getAll(range) as IDBRequest<BlobRow[]>)).map(
          (row) => ({
            metadata: row.metadata,
            ...(row.generation ? { generation: row.generation } : {}),
          }),
        ),
      publish: async (id, value) => {
        await execute(() =>
          objectStore(BLOBS).put({ key: logicalKey(namespace, id), namespace, id, ...value }),
        )
      },
      remove: async (id) => {
        await execute(() => objectStore(BLOBS).delete(logicalKey(namespace, id)))
      },
      getWrite: async (writeId) => {
        const row = await read<BlobWriteRow>(WRITES, writeKey(namespace, writeId))
        if (!row) return null
        if (row.generation && row.size !== undefined)
          return {
            id: row.id,
            generation: row.generation,
            size: row.size,
            ...(row.contentType ? { contentType: row.contentType } : {}),
          }
        if (!row.data) throw new Error('Legacy blob write has no data')
        const value = {
          id: row.id,
          generation: crypto.randomUUID(),
          size: row.data.size,
          ...(row.contentType ? { contentType: row.contentType } : {}),
        }
        for (let offset = 0; offset < row.data.size; offset += STORAGE_CHUNK_BYTES)
          await store.putChunk(
            value.generation,
            offset / STORAGE_CHUNK_BYTES,
            new Uint8Array(
              await row.data.slice(offset, offset + STORAGE_CHUNK_BYTES).arrayBuffer(),
            ),
          )
        await store.putWrite(writeId, value)
        return value
      },
      putWrite: async (writeId, value) => {
        await execute(() =>
          objectStore(WRITES).put({
            key: writeKey(namespace, writeId),
            namespace,
            writeId,
            ...value,
          }),
        )
      },
      removeWrite: async (writeId) => {
        await execute(() => objectStore(WRITES).delete(writeKey(namespace, writeId)))
      },
      readChunk: async (generation, index) =>
        (
          await read<{ data: Uint8Array<ArrayBuffer> }>(
            CHUNKS,
            `${prefix}${generation}\u0000${index}`,
          )
        )?.data ?? new Uint8Array(),
      putChunk: async (generation, index, data) => {
        await execute(() =>
          objectStore(CHUNKS).put({ key: `${prefix}${generation}\u0000${index}`, namespace, data }),
        )
      },
      removeGeneration: async (generation) => {
        const start = `${prefix}${generation}\u0000`
        const keys = await execute(() =>
          objectStore(CHUNKS).getAllKeys(IDBKeyRange.bound(start, start + '\uffff')),
        )
        for (const key of keys) await execute(() => objectStore(CHUNKS).delete(key))
      },
      readLegacy: async (id, offset, length) => {
        const row = await read<BlobRow>(BLOBS, logicalKey(namespace, id))
        if (!row?.data) throw new Error('Legacy blob not found')
        return new Uint8Array(await row.data.slice(offset, offset + length).arrayBuffer())
      },
      clear: async () => {
        for (const name of [BLOBS, WRITES, CHUNKS]) {
          const keys = await execute(() => objectStore(name).getAllKeys(range))
          for (const key of keys) await execute(() => objectStore(name).delete(key))
        }
      },
    }
    return store
  }
  return createChunkedBlobBackend(createStore())
}
