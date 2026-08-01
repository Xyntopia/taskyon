import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { runStorageBackendContract } from '@taskyon/taskyon/test-support'
import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import { createStorageClient, taskyonStorageProtocol } from '@taskyon/taskyon/api'
import { createCliSqliteStorageProvider } from '../../cli/sqliteStorage'
import { createCliSelectedStorageService } from '../../cli/storageService'

export const testCliSqliteImplementsStorageBackendContract = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tycli-sqlite-contract-'))
  const sqlite = await createCliSqliteStorageProvider(join(directory, 'storage.sqlite'))
  try {
    await runStorageBackendContract(sqlite.provider)
  } finally {
    sqlite.close()
  }
}

testCliSqliteImplementsStorageBackendContract.description =
  'Runs the shared record and blob StorageClient contract against SQLite.'

export const testCliComposesRecordAndBlobBackendsIndependently = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tycli-mixed-storage-'))
  const { x: clientPort, y: servicePort } = createProtocolPort(taskyonStorageProtocol)
  const stop = await createCliSelectedStorageService({
    port: servicePort,
    dataDirectory: directory,
    selection: { records: 'sqlite', blobs: 'files' },
  })
  const storage = createStorageClient(clientPort)
  try {
    await storage.set({ namespace: 'mixed', id: 'record', value: { backend: 'sqlite' } })
    await storage.setBlob({
      namespace: 'mixed',
      id: 'blob',
      data: new TextEncoder().encode('file-backed'),
    })
    const record = await storage.get({ namespace: 'mixed', id: 'record' })
    const blob = await storage.getBlob({ namespace: 'mixed', id: 'blob' })
    if (!record.value || !blob) throw new Error('Mixed storage providers did not roundtrip data.')
  } finally {
    stop()
  }
}

testCliComposesRecordAndBlobBackendsIndependently.description =
  'Uses SQLite records and file blobs through one location-transparent StorageClient.'
