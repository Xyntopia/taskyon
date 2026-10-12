import { storageRecordFilePath } from '@taskyon/taskyon/api'
import {
  runStorageBackendContract,
  runStorageLegacyBlobContract,
  runStorageStreamingContract,
} from '@taskyon/taskyon/test-support'
import {
  createIndexedDbBlobBackend,
  createIndexedDbRecordBackend,
  openTaskyonIndexedDb,
} from '../indexedDbStorage'
import {
  createOpfsBlobStorageBackend,
  createOpfsStorageRecordFileAdapter,
  createOpfsStorageBackendResolver,
  requestBrowserStoragePersistence,
} from '../storage'
import { createBrowserStoragePreferenceStore } from '../browserStorageSelection'

export const testIndexedDbImplementsStorageBackendContract = async () => {
  if (typeof indexedDB === 'undefined') {
    return { skipped: true, reason: 'IndexedDB is unavailable outside a browser runtime.' }
  }
  await runStorageBackendContract({
    records: (namespace) => createIndexedDbRecordBackend(namespace),
    blobs: (namespace) => createIndexedDbBlobBackend(namespace),
  })
}

testIndexedDbImplementsStorageBackendContract.description =
  'Runs the shared record and blob StorageClient contract against browser IndexedDB.'

export const testOpfsImplementsStorageBackendContract = async () => {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return { skipped: true, reason: 'OPFS is unavailable outside a supporting browser runtime.' }
  }
  const rootDirectory = `taskyon-opfs-contract-${crypto.randomUUID()}`
  await runStorageBackendContract({
    records: createOpfsStorageBackendResolver({ rootDirectory }),
    blobs: (namespace) => createOpfsBlobStorageBackend(namespace, { rootDirectory }),
  })
}

testOpfsImplementsStorageBackendContract.description =
  'Runs the shared record and blob StorageClient contract against browser OPFS.'

export const testOpfsRemovesEmptyRecordFiles = async () => {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return { skipped: true, reason: 'OPFS is unavailable outside a supporting browser runtime.' }
  }

  const rootDirectory = `taskyon-opfs-empty-record-${crypto.randomUUID()}`
  const namespace = 'empty-record-fixture'
  const path = storageRecordFilePath(namespace, 'empty')
  const parts = path.split('/')
  const fileName = parts.at(-1)
  if (!fileName) throw new Error('Expected a hashed OPFS record filename.')
  const root = await navigator.storage.getDirectory()

  try {
    let directory = await root.getDirectoryHandle(rootDirectory, { create: true })
    for (const part of parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(part, { create: true })
    }
    const file = await directory.getFileHandle(fileName, { create: true })
    const writable = await file.createWritable()
    await writable.close()

    const adapter = await createOpfsStorageRecordFileAdapter({ rootDirectory })
    if ((await adapter.read(path)) !== null) {
      throw new Error('An empty OPFS record file must be treated as missing.')
    }
    try {
      await directory.getFileHandle(fileName, { create: false })
      throw new Error('An empty OPFS record file must be removed after it is read.')
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'NotFoundError') throw error
    }
  } finally {
    await root.removeEntry(rootDirectory, { recursive: true })
  }
}

testOpfsRemovesEmptyRecordFiles.description =
  'Treats an interrupted empty OPFS record write as a missing record and cleans it up.'

export const testBrowserStorageRemembersRecordAndBlobSelectionsSeparately = () => {
  const values = new Map<string, string>()
  const preferences = createBrowserStoragePreferenceStore({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  })
  preferences.set('records', 'pglite')
  preferences.set('blobs', 'indexeddb')
  if (preferences.get('records') !== 'pglite' || preferences.get('blobs') !== 'indexeddb') {
    throw new Error('Browser storage selections were not persisted independently.')
  }
  preferences.clear('records')
  if (preferences.get('records') || preferences.get('blobs') !== 'indexeddb') {
    throw new Error('Clearing records must not change the blob backend selection.')
  }
}

testBrowserStorageRemembersRecordAndBlobSelectionsSeparately.description =
  'Persists browser record and blob backend choices independently.'

export const testBrowserStorageRequestsPersistentStorage = async () => {
  let persisted = false
  let requestCount = 0
  const storageManager = {
    persisted: () => Promise.resolve(persisted),
    persist: () => {
      requestCount += 1
      persisted = true
      return Promise.resolve(true)
    },
  }

  if (!(await requestBrowserStoragePersistence(storageManager))) {
    throw new Error('Expected the browser storage persistence request to be granted.')
  }
  if (requestCount !== 1) {
    throw new Error(`Expected one persistence request, received ${requestCount}.`)
  }
  if (!(await requestBrowserStoragePersistence(storageManager))) {
    throw new Error('Expected already-persistent browser storage to remain persistent.')
  }
  if (requestCount !== 1) {
    throw new Error('Already-persistent browser storage must not request permission again.')
  }
}

testBrowserStorageRequestsPersistentStorage.description =
  'Requests browser persistent storage once and reuses an existing persistence grant.'

export const testIndexedDbStreamsLargeObjects = async () => {
  if (typeof indexedDB === 'undefined') return { skipped: true, reason: 'IndexedDB unavailable' }
  await runStorageStreamingContract({
    records: (namespace) => createIndexedDbRecordBackend(namespace),
    blobs: (namespace) => createIndexedDbBlobBackend(namespace),
  })
}

export const testOpfsStreamsLargeObjects = async () => {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory)
    return { skipped: true, reason: 'OPFS unavailable' }
  const rootDirectory = `taskyon-streaming-${crypto.randomUUID()}`
  try {
    await runStorageStreamingContract({
      records: createOpfsStorageBackendResolver({ rootDirectory }),
      blobs: (namespace) => createOpfsBlobStorageBackend(namespace, { rootDirectory }),
    })
  } finally {
    await (await navigator.storage.getDirectory()).removeEntry(rootDirectory, { recursive: true })
  }
}

export const testIndexedDbRetainsLegacyBlobData = async () => {
  if (typeof indexedDB === 'undefined') return { skipped: true, reason: 'IndexedDB unavailable' }
  const databaseName = `taskyon-legacy-synthetic-${crypto.randomUUID()}`
  const database = await openTaskyonIndexedDb(databaseName)
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(['blobs', 'blobWrites'], 'readwrite')
      tx.objectStore('blobs').put({
        key: 'synthetic\u0000string:legacy',
        namespace: 'synthetic',
        id: 'legacy',
        data: new Blob([new Uint8Array([1, 2, 3])]),
        metadata: { id: 'legacy', size: 3, modifiedAt: 'synthetic' },
      })
      tx.objectStore('blobWrites').put({
        key: 'synthetic\u0000legacy-write',
        namespace: 'synthetic',
        id: 'staged',
        writeId: 'legacy-write',
        data: new Blob([new Uint8Array([1, 2])]),
      })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('Synthetic fixture transaction failed'))
    })
    const backend = await createIndexedDbBlobBackend('synthetic', databaseName)
    await runStorageLegacyBlobContract(backend)
    await backend.writeChunk('staged', 'legacy-write', 1, new Uint8Array([7]))
    await backend.commitWrite('staged', 'legacy-write', 2)
    if ((await backend.get('staged'))?.data.join(',') !== '1,7')
      throw new Error('Legacy staged IndexedDB migration failed')
  } finally {
    database.close()
    indexedDB.deleteDatabase(databaseName)
  }
}

export const testOpfsRetainsLegacyBlobData = async () => {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory)
    return { skipped: true, reason: 'OPFS unavailable' }
  const rootDirectory = `taskyon-legacy-synthetic-${crypto.randomUUID()}`
  const root = await navigator.storage.getDirectory()
  try {
    const dir = await (
      await (
        await root.getDirectoryHandle(rootDirectory, { create: true })
      ).getDirectoryHandle('blobs', { create: true })
    ).getDirectoryHandle('synthetic', { create: true })
    const writable = await (await dir.getFileHandle('legacy', { create: true })).createWritable()
    await writable.write(new Uint8Array([1, 2, 3]))
    await writable.close()
    await runStorageLegacyBlobContract(
      await createOpfsBlobStorageBackend('synthetic', { rootDirectory }),
    )
  } finally {
    await root.removeEntry(rootDirectory, { recursive: true })
  }
}
