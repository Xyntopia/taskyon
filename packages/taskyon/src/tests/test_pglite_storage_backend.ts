import { createPgLiteDatabase } from '../utils/pglite.api'
import {
  createPgLiteStorageBlobBackend,
  createPgLiteStorageRecordBackend,
} from '../api/pgliteStorageBackend'
import { runStorageBackendContract } from '../testSupport/storageBackendContract'

export const testPgLiteImplementsStorageBackendContract = async () => {
  const database = await createPgLiteDatabase('memory://')
  try {
    await runStorageBackendContract({
      records: (namespace) => createPgLiteStorageRecordBackend(database, namespace),
      blobs: (namespace) => createPgLiteStorageBlobBackend(database, namespace),
    })
  } finally {
    await database.close()
  }
}

testPgLiteImplementsStorageBackendContract.description =
  'Runs the shared record and blob StorageClient contract against PGlite.'
