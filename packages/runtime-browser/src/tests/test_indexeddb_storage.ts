import { runStorageBackendContract } from '@taskyon/taskyon/test-support'
import { createIndexedDbBlobBackend, createIndexedDbRecordBackend } from '../indexedDbStorage'
import {
  createOpfsBlobStorageBackend,
  createOpfsStorageBackendResolver,
  requestBrowserStoragePersistence,
} from '../storage'
import { createBrowserStoragePreferenceStore } from '../browserStorageSelection'

export const testIndexedDbImplementsStorageBackendContract = async () => {
  if (typeof indexedDB === 'undefined') {
    return { skipped: true, reason: 'IndexedDB is unavailable outside a browser runtime.' }
  }
  const databaseName = `taskyon-indexeddb-contract-${crypto.randomUUID()}`
  await runStorageBackendContract({
    records: (namespace) => createIndexedDbRecordBackend(namespace, databaseName),
    blobs: (namespace) => createIndexedDbBlobBackend(namespace, databaseName),
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
    persisted: async () => persisted,
    persist: async () => {
      requestCount += 1
      persisted = true
      return true
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
