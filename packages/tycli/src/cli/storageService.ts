import { join } from 'node:path'
import type { Port } from '@taskyon/common/modules/frpBus'
import {
  createPgLiteDatabase,
  createPgLiteStorageBlobBackend,
  createPgLiteStorageRecordBackend,
} from '@taskyon/taskyon'
import {
  createStorageProtocolServer,
  type StorageBackendProvider,
  type TaskyonStorageMessage,
} from '@taskyon/taskyon/api'
import type { StoredConfig } from './types'
import { persistConfigPatch } from './config'
import { createCliFileBlobStorageBackend, createCliFileStorageBackend } from './fileStorage'
import { createCliSqliteStorageProvider } from './sqliteStorage'

export type CliStorageBackendKind = 'files' | 'sqlite' | 'pglite'

export const resolveCliStorageSelection = (stored: StoredConfig) => ({
  records: stored.storage?.records ?? 'files',
  blobs: stored.storage?.blobs ?? 'files',
})

export const persistCliStorageSelection = async (selection: {
  records: CliStorageBackendKind
  blobs: CliStorageBackendKind
}) => await persistConfigPatch({ storage: selection })

export const createCliSelectedStorageService = async (options: {
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>
  dataDirectory: string
  selection: { records: CliStorageBackendKind; blobs: CliStorageBackendKind }
}) => {
  const fileRoot = join(options.dataDirectory, 'storage')
  const needsSqlite = options.selection.records === 'sqlite' || options.selection.blobs === 'sqlite'
  const needsPgLite = options.selection.records === 'pglite' || options.selection.blobs === 'pglite'
  const sqlite = needsSqlite
    ? await createCliSqliteStorageProvider(join(options.dataDirectory, 'storage.sqlite'))
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
  const provider: StorageBackendProvider = { records, blobs }
  const stop = createStorageProtocolServer(options.port, provider, { mode: 'trusted-local' })
  return () => {
    stop()
    sqlite?.close()
    void pglite?.close()
  }
}
