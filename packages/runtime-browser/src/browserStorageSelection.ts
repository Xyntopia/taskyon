import { getDatabase } from '@taskyon/taskyon'
import {
  createPgLiteStorageBlobBackend,
  createPgLiteStorageRecordBackend,
  type StorageBackendProvider,
} from '@taskyon/taskyon/api'
import { createIndexedDbBlobBackend, createIndexedDbRecordBackend } from './indexedDbStorage'
import {
  createOpfsBlobStorageBackend,
  createOpfsStorageBackendResolver,
  type OpfsStorageOptions,
} from './storage'

export type BrowserStorageBackendKind = 'opfs' | 'indexeddb' | 'pglite'
export type BrowserStorageCapability = 'records' | 'blobs'
export type BrowserStoragePreferenceStore = {
  get: (capability: BrowserStorageCapability) => BrowserStorageBackendKind | undefined
  set: (capability: BrowserStorageCapability, backend: BrowserStorageBackendKind) => void
  clear: (capability: BrowserStorageCapability) => void
}

const preferenceKey = (capability: BrowserStorageCapability) =>
  `taskyon.storage.backend.${capability}`

export const createBrowserStoragePreferenceStore = (
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage,
): BrowserStoragePreferenceStore => ({
  get: (capability) => {
    const value = storage.getItem(preferenceKey(capability))
    return value === 'opfs' || value === 'indexeddb' || value === 'pglite' ? value : undefined
  },
  set: (capability, backend) => storage.setItem(preferenceKey(capability), backend),
  clear: (capability) => storage.removeItem(preferenceKey(capability)),
})

const createProvider = (
  backend: BrowserStorageBackendKind,
  options: { databaseName: string; opfs?: OpfsStorageOptions },
): StorageBackendProvider => {
  switch (backend) {
    case 'opfs':
      return {
        records: createOpfsStorageBackendResolver(options.opfs),
        blobs: (namespace) => createOpfsBlobStorageBackend(namespace, options.opfs),
      }
    case 'indexeddb':
      return {
        records: (namespace) => createIndexedDbRecordBackend(namespace, options.databaseName),
        blobs: (namespace) => createIndexedDbBlobBackend(namespace, options.databaseName),
      }
    case 'pglite': {
      const database = getDatabase(`${options.databaseName}-pglite`)
      return {
        records: async (namespace) =>
          await createPgLiteStorageRecordBackend(await database, namespace),
        blobs: async (namespace) => await createPgLiteStorageBlobBackend(await database, namespace),
      }
    }
  }
}

const probe = async (provider: StorageBackendProvider, capability: BrowserStorageCapability) => {
  const namespace = 'taskyon-storage-probe'
  if (capability === 'records') {
    if (!provider.records) throw new Error('Record capability is unavailable.')
    await (await provider.records(namespace)).listIds()
    return
  }
  if (!provider.blobs) throw new Error('Blob capability is unavailable.')
  await (await provider.blobs(namespace)).list()
}

const selectCapability = async (
  capability: BrowserStorageCapability,
  preferences: BrowserStoragePreferenceStore,
  candidates: readonly BrowserStorageBackendKind[],
  options: { databaseName: string; opfs?: OpfsStorageOptions },
) => {
  const remembered = preferences.get(capability)
  if (remembered) {
    const provider = createProvider(remembered, options)
    try {
      await probe(provider, capability)
      return { backend: remembered, provider }
    } catch (error) {
      throw new Error(
        `Remembered ${capability} backend "${remembered}" is unavailable. Change or clear the storage preference explicitly.`,
        { cause: error },
      )
    }
  }

  const failures: string[] = []
  for (const candidate of candidates) {
    const provider = createProvider(candidate, options)
    try {
      await probe(provider, capability)
      preferences.set(capability, candidate)
      return { backend: candidate, provider }
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new Error(`No browser ${capability} backend is available. ${failures.join('; ')}`)
}

export const selectBrowserStorageProvider = async (options?: {
  databaseName?: string
  records?: readonly BrowserStorageBackendKind[]
  blobs?: readonly BrowserStorageBackendKind[]
  preferences?: BrowserStoragePreferenceStore
  opfs?: OpfsStorageOptions
}) => {
  const databaseName = options?.databaseName ?? 'taskyon-storage'
  const preferences = options?.preferences ?? createBrowserStoragePreferenceStore()
  const selectionOptions = { databaseName, ...(options?.opfs ? { opfs: options.opfs } : {}) }
  const [records, blobs] = await Promise.all([
    selectCapability(
      'records',
      preferences,
      options?.records ?? ['opfs', 'indexeddb'],
      selectionOptions,
    ),
    selectCapability(
      'blobs',
      preferences,
      options?.blobs ?? ['opfs', 'indexeddb'],
      selectionOptions,
    ),
  ])
  return {
    provider: {
      records: records.provider.records!,
      blobs: blobs.provider.blobs!,
    } satisfies StorageBackendProvider,
    selection: { records: records.backend, blobs: blobs.backend },
  }
}
