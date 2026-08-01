import { runStorageBackendContract } from '@taskyon/taskyon/test-support'
import { createIndexedDbBlobBackend, createIndexedDbRecordBackend } from '../indexedDbStorage'
import { createOpfsBlobStorageBackend, createOpfsStorageBackendResolver } from '../storage'
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
