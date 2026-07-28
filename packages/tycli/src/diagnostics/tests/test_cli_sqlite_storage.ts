import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { runStorageBackendContract } from '@taskyon/taskyon/test-support'
import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import { createStorageClient, taskyonStorageProtocol } from '@taskyon/taskyon/api'
import { createCliFileBlobStorageBackend, createCliFileStorageBackend } from '../../cli/fileStorage'
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

export const testCliScopesSelectedStorageForHost = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tycli-scoped-storage-'))
  const storageRoot = join(directory, 'storage')
  const { x: clientPort, y: servicePort } = createProtocolPort(taskyonStorageProtocol)
  const stop = await createCliSelectedStorageService({
    port: servicePort,
    dataDirectory: directory,
    namespacePrefix: 'joulios',
    selection: { records: 'files', blobs: 'files' },
  })
  const storage = createStorageClient(clientPort)

  try {
    await storage.set({ namespace: 'tasks', id: 'record', value: { host: 'joulios' } })
    await storage.setBlob({
      namespace: 'artifacts',
      id: 'result.json',
      data: new TextEncoder().encode('{}'),
    })

    const scopedRecord = await createCliFileStorageBackend(storageRoot, 'joulios/tasks').get(
      'record',
    )
    const unscopedRecord = await createCliFileStorageBackend(storageRoot, 'tasks').get('record')
    const scopedBlob = await createCliFileBlobStorageBackend(storageRoot, 'joulios/artifacts').get(
      'result.json',
    )
    const unscopedBlob = await createCliFileBlobStorageBackend(storageRoot, 'artifacts').get(
      'result.json',
    )

    if (!scopedRecord || unscopedRecord || !scopedBlob || unscopedBlob) {
      throw new Error('Expected all host storage under the configured namespace prefix.')
    }
  } finally {
    stop()
  }
}

testCliScopesSelectedStorageForHost.description =
  'Scopes every selected record and blob backend beneath the host namespace.'
