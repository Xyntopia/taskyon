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

export const testPgLiteStreamsLargeObjectsAndRetainsLegacyBlobs = async () => {
  const database = await createPgLiteDatabase('memory://')
  const namespace = 'synthetic-lo-contract'
  try {
    const backend = await createPgLiteStorageBlobBackend(database, namespace)
    await database.query(
      `INSERT INTO taskyon_storage_blobs
      (namespace,id,data,size,modified_at) VALUES ($1,'legacy',$2,3,'synthetic')`,
      [namespace, new Uint8Array([1, 2, 3])],
    )
    const legacy = await backend.readRange('legacy', 1, 2)
    if (legacy.data.join(',') !== '2,3') throw new Error('Legacy range read changed')
    await backend.append('legacy', new Uint8Array([4]), 3)
    const { writeId } = await backend.beginWrite('large')
    for (let i = 0; i < 17; i++)
      await backend.writeChunk('large', writeId, i * 1024 * 1024, new Uint8Array(1024 * 1024))
    await backend.writeChunk('large', writeId, 1024 * 1024 - 1, new Uint8Array([7, 8]))
    await backend.commitWrite('large', writeId, 17 * 1024 * 1024)
    const crossing = await backend.readRange('large', 1024 * 1024 - 1, 2)
    if (crossing.data.join(',') !== '7,8') throw new Error('Offset write failed')
    const rows = await database.query<{ data: Uint8Array | null; object_oid: number }>(
      'SELECT data,object_oid FROM taskyon_storage_blobs WHERE namespace=$1',
      [namespace],
    )
    if (rows.rows.some((row) => row.data !== null || !row.object_oid))
      throw new Error('Blob backend still stores growing BYTEA values')
    const oids = rows.rows.map((row) => row.object_oid)
    await backend.clear()
    const remaining = await database.query<{ oid: number }>(
      'SELECT oid FROM pg_largeobject_metadata WHERE oid = ANY($1::oid[])',
      [oids],
    )
    if (remaining.rows.length) throw new Error('Deleted blobs leaked large objects')
  } finally {
    await database.close()
  }
}
