import { join } from 'node:path'
import { createProtocolPort, type Port } from '@taskyon/common/modules/frpBus'
import {
  createPgLiteDatabase,
  createPgLiteStorageBlobBackend,
  createPgLiteStorageRecordBackend,
} from '@taskyon/taskyon'
import {
  createStorageClient,
  createStorageProtocolServer,
  taskyonStorageProtocol,
  type StorageBackendProvider,
  type TaskyonStorageMessage,
} from '@taskyon/taskyon/api'
import { createCliConfigStore, type CliConfigStore } from './config.ts'
import { createCliFileBlobStorageBackend, createCliFileStorageBackend } from './fileStorage.ts'
import type { CliStoragePaths } from './storagePaths.ts'
import type { StoredConfig } from './types.ts'

export type CliStorageBackendKind = 'files' | 'sqlite' | 'pglite'

export const resolveCliStorageSelection = (stored: StoredConfig) => ({
  records: stored.storage?.records ?? 'files',
  blobs: stored.storage?.blobs ?? 'files',
})

export const persistCliStorageSelection = async (
  configStore: CliConfigStore,
  selection: {
    records: CliStorageBackendKind
    blobs: CliStorageBackendKind
  },
) => await configStore.persistConfigPatch({ storage: selection })

export const createCliSelectedStorageService = async (options: {
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>
  dataDirectory: string
  selection: { records: CliStorageBackendKind; blobs: CliStorageBackendKind }
}) => {
  const fileRoot = join(options.dataDirectory, 'storage')
  const needsSqlite = options.selection.records === 'sqlite' || options.selection.blobs === 'sqlite'
  const needsPgLite = options.selection.records === 'pglite' || options.selection.blobs === 'pglite'
  const sqlite = needsSqlite
    ? await (
        await import('./sqliteStorage.ts')
      ).createCliSqliteStorageProvider(join(options.dataDirectory, 'storage.sqlite'))
    : undefined
  const pglite = needsPgLite
    ? await createPgLiteDatabase(join(options.dataDirectory, 'storage-pglite'))
    : undefined

  const records = (namespace: string) => {
    switch (options.selection.records) {
      case 'files':
        return createCliFileStorageBackend(fileRoot, namespace)
      case 'sqlite':
        return sqlite!.provider.records!(namespace)
      case 'pglite':
        return createPgLiteStorageRecordBackend(pglite!, namespace)
    }
  }
  const blobs = (namespace: string) => {
    switch (options.selection.blobs) {
      case 'files':
        return createCliFileBlobStorageBackend(fileRoot, namespace)
      case 'sqlite':
        return sqlite!.provider.blobs!(namespace)
      case 'pglite':
        return createPgLiteStorageBlobBackend(pglite!, namespace)
    }
  }
  const selectedProvider: StorageBackendProvider = { records, blobs }
  const stop = createStorageProtocolServer(options.port, selectedProvider, {
    mode: 'trusted-local',
  })
  return () => {
    stop()
    sqlite?.close()
    void pglite?.close()
  }
}

export const openCliStorageClient = async (options: {
  paths: CliStoragePaths
  namespacePrefix: string
}) => {
  const stored = await createCliConfigStore(options.paths).loadStoredConfig()
  const { x: clientPort, y: servicePort } = createProtocolPort(taskyonStorageProtocol)
  const close = await createCliSelectedStorageService({
    port: servicePort,
    dataDirectory: options.paths.dataDir,
    selection: resolveCliStorageSelection(stored),
  })
  return {
    storageClient: createStorageClient(clientPort, {
      namespacePrefix: options.namespacePrefix,
      distribution: 'local-only',
    }),
    close,
  }
}
