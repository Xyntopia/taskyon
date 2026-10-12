import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import type { Port } from '@taskyon/common/modules/frpBus'
import {
  createStorageProtocolServer,
  createChunkedBlobBackend,
  blobGenerationSchema,
  blobWriteGenerationSchema,
  STORAGE_CHUNK_BYTES,
  type BlobChunkStore,
  type BlobGeneration,
  mergeStorageRecord,
  storageQueryMatches,
  storageValueContentHash,
  type StorageBackendProvider,
  type StorageBlobBackend,
  type StorageRecordBackend,
  type TaskyonStorageMessage,
} from '@taskyon/taskyon/api'

const recordRowSchema = z.object({
  id_type: z.enum(['string', 'number']),
  id_text: z.string(),
  data: z.string(),
})
const storedRecordSchema = z.object({ data: z.string() })

type RecordRow = z.infer<typeof recordRowSchema>

const initialize = (database: DatabaseSync) => {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 10000;
    CREATE TABLE IF NOT EXISTS taskyon_storage_records (
      namespace TEXT NOT NULL, id_type TEXT NOT NULL, id_text TEXT NOT NULL, data TEXT NOT NULL,
      PRIMARY KEY (namespace, id_type, id_text)
    );
    CREATE TABLE IF NOT EXISTS taskyon_storage_blobs (
      namespace TEXT NOT NULL, id TEXT NOT NULL, data BLOB NOT NULL, size INTEGER NOT NULL,
      content_type TEXT, modified_at TEXT NOT NULL, sha256 TEXT,
      PRIMARY KEY (namespace, id)
    );
    CREATE TABLE IF NOT EXISTS taskyon_blob_generations (
      namespace TEXT NOT NULL,id TEXT NOT NULL, value TEXT NOT NULL,PRIMARY KEY(namespace,id)
    );
    CREATE TABLE IF NOT EXISTS taskyon_blob_write_generations (
      namespace TEXT NOT NULL,write_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,write_id)
    );
    CREATE TABLE IF NOT EXISTS taskyon_blob_chunks (
      namespace TEXT NOT NULL,generation TEXT NOT NULL,chunk_index INTEGER NOT NULL,data BLOB NOT NULL,
      PRIMARY KEY(namespace,generation,chunk_index)
    );
    CREATE TABLE IF NOT EXISTS taskyon_storage_blob_writes (
      write_id TEXT PRIMARY KEY, namespace TEXT NOT NULL, id TEXT NOT NULL,
      data BLOB NOT NULL, content_type TEXT
    );
  `)
}

const transaction = <T>(database: DatabaseSync, operation: () => T) => {
  database.exec('BEGIN IMMEDIATE;')
  try {
    const result = operation()
    database.exec('COMMIT;')
    return result
  } catch (error) {
    database.exec('ROLLBACK;')
    throw error
  }
}

const runAsync = async <T>(operation: () => T | Promise<T>): Promise<T> => await operation()

const idParts = (id: string | number) => ({ idType: typeof id, idText: String(id) })
const rowId = (row: RecordRow) => (row.id_type === 'number' ? Number(row.id_text) : row.id_text)
export const createSqliteStorageRecordBackend = (
  database: DatabaseSync,
  namespace: string,
  run: typeof runAsync = runAsync,
): StorageRecordBackend => {
  const read = database.prepare(
    'SELECT data FROM taskyon_storage_records WHERE namespace = ? AND id_type = ? AND id_text = ?',
  )
  const write = database.prepare(`
    INSERT INTO taskyon_storage_records (namespace, id_type, id_text, data) VALUES (?, ?, ?, ?)
    ON CONFLICT (namespace, id_type, id_text) DO UPDATE SET data = excluded.data
  `)
  const get = (id: string | number) => {
    const { idType, idText } = idParts(id)
    const row = storedRecordSchema.optional().parse(read.get(namespace, idType, idText))
    return row ? (JSON.parse(row.data) as unknown) : null
  }
  const list = () =>
    z
      .array(recordRowSchema)
      .parse(
        database
          .prepare('SELECT id_type, id_text, data FROM taskyon_storage_records WHERE namespace = ?')
          .all(namespace),
      )
  const set = (id: string | number, data: unknown) => {
    const { idType, idText } = idParts(id)
    write.run(namespace, idType, idText, JSON.stringify(data))
  }

  return {
    get: (id) => run(() => get(id)),
    getMany: (ids) =>
      run(() =>
        ids.flatMap((id) => {
          const data = get(id)
          return data === null ? [] : [{ id, data }]
        }),
      ),
    set: (id, data) => run(() => set(id, data)),
    setIfUnchanged: (id, expectedStoredContentHash, data) =>
      run(() =>
        transaction(database, () => {
          const current = get(id)
          const currentStoredContentHash =
            current === null ? null : storageValueContentHash(current)
          if (currentStoredContentHash !== expectedStoredContentHash) {
            return { written: false, currentStoredContentHash }
          }
          set(id, data)
          return { written: true, currentStoredContentHash: storageValueContentHash(data) }
        }),
      ),
    setMany: (rows) =>
      run(() => transaction(database, () => rows.forEach(({ id, data }) => set(id, data)))),
    upsert: (id, data, strategy) =>
      run(() =>
        transaction(database, () => {
          const next = mergeStorageRecord(get(id), data, strategy)
          set(id, next)
          return next
        }),
      ),
    delete: (id) =>
      run(() => {
        const { idType, idText } = idParts(id)
        database
          .prepare(
            'DELETE FROM taskyon_storage_records WHERE namespace = ? AND id_type = ? AND id_text = ?',
          )
          .run(namespace, idType, idText)
      }),
    list: () =>
      run(() => list().map((row) => ({ id: rowId(row), data: JSON.parse(row.data) as unknown }))),
    listIds: () => run(() => list().map(rowId)),
    find: (query) =>
      run(() =>
        Object.fromEntries(
          list()
            .map((row) => ({ id: rowId(row), data: JSON.parse(row.data) as unknown }))
            .filter(({ data }) => storageQueryMatches(data, query))
            .map(({ id, data }) => [String(id), data]),
        ),
      ),
    clear: () =>
      run(() => {
        database.prepare('DELETE FROM taskyon_storage_records WHERE namespace = ?').run(namespace)
      }),
  }
}

export const createSqliteStorageBlobBackend = (
  database: DatabaseSync,
  namespace: string,
  serialize: <T>(operation: () => T | Promise<T>) => Promise<T> = runAsync,
): StorageBlobBackend => {
  const json = <T>(schema: z.ZodType<T>, sql: string, ...args: string[]): T | null => {
    const row = storedRecordSchema.optional().parse(database.prepare(sql).get(...args))
    return row ? schema.parse(JSON.parse(row.data)) : null
  }
  const readLegacy = (id: string, offset: number, length: number) =>
    Promise.resolve().then(() => {
      const row = z
        .object({ data: z.instanceof(Uint8Array) })
        .parse(
          database
            .prepare(
              'SELECT substr(data,?,?) AS data FROM taskyon_storage_blobs WHERE namespace=? AND id=?',
            )
            .get(offset + 1, length, namespace, id),
        )
      return new Uint8Array(row.data)
    })
  const store: BlobChunkStore = {
    transaction: (operation) =>
      serialize(async () => {
        database.exec('BEGIN IMMEDIATE')
        try {
          const result = await operation(store)
          database.exec('COMMIT')
          return result
        } catch (error) {
          database.exec('ROLLBACK')
          throw error
        }
      }),
    get: (id) =>
      Promise.resolve().then(() => {
        const current = json(
          blobGenerationSchema,
          'SELECT value AS data FROM taskyon_blob_generations WHERE namespace=? AND id=?',
          namespace,
          id,
        )
        if (current) return current
        const legacy = z
          .object({
            id: z.string(),
            size: z.number(),
            content_type: z.string().nullable(),
            modified_at: z.string(),
            sha256: z.string().nullable(),
          })
          .optional()
          .parse(
            database
              .prepare(
                'SELECT id,size,content_type,modified_at,sha256 FROM taskyon_storage_blobs WHERE namespace=? AND id=?',
              )
              .get(namespace, id),
          )
        return legacy
          ? {
              metadata: {
                id,
                size: legacy.size,
                modifiedAt: legacy.modified_at,
                ...(legacy.content_type ? { contentType: legacy.content_type } : {}),
                ...(legacy.sha256 ? { sha256: legacy.sha256 } : {}),
              },
            }
          : null
      }),
    list: async () => {
      const ids = z
        .array(z.object({ id: z.string() }))
        .parse(
          database
            .prepare(
              'SELECT id FROM taskyon_blob_generations WHERE namespace=? UNION SELECT id FROM taskyon_storage_blobs WHERE namespace=?',
            )
            .all(namespace, namespace),
        )
      const rows = await Promise.all(ids.map((row) => store.get(row.id)))
      return rows.filter((row): row is BlobGeneration => row !== null)
    },
    publish: (id, value) =>
      Promise.resolve().then(() => {
        database
          .prepare(
            'INSERT INTO taskyon_blob_generations(namespace,id,value) VALUES(?,?,?) ON CONFLICT(namespace,id) DO UPDATE SET value=excluded.value',
          )
          .run(namespace, id, JSON.stringify(value))
        database
          .prepare('DELETE FROM taskyon_storage_blobs WHERE namespace=? AND id=?')
          .run(namespace, id)
      }),
    remove: (id) =>
      Promise.resolve().then(() => {
        for (const table of ['taskyon_blob_generations', 'taskyon_storage_blobs'])
          database.prepare(`DELETE FROM ${table} WHERE namespace=? AND id=?`).run(namespace, id)
      }),
    getWrite: async (writeId) => {
      const current = json(
        blobWriteGenerationSchema,
        'SELECT value AS data FROM taskyon_blob_write_generations WHERE namespace=? AND write_id=?',
        namespace,
        writeId,
      )
      if (current) return current
      const row = z
        .object({ id: z.string(), size: z.number(), content_type: z.string().nullable() })
        .optional()
        .parse(
          database
            .prepare(
              'SELECT id,length(data) AS size,content_type FROM taskyon_storage_blob_writes WHERE namespace=? AND write_id=?',
            )
            .get(namespace, writeId),
        )
      if (!row) return null
      const value = {
        id: row.id,
        generation: crypto.randomUUID(),
        size: row.size,
        ...(row.content_type ? { contentType: row.content_type } : {}),
      }
      for (let offset = 0; offset < row.size; offset += STORAGE_CHUNK_BYTES) {
        const chunk = z
          .object({ data: z.instanceof(Uint8Array) })
          .parse(
            database
              .prepare(
                'SELECT substr(data,?,?) AS data FROM taskyon_storage_blob_writes WHERE namespace=? AND write_id=?',
              )
              .get(offset + 1, STORAGE_CHUNK_BYTES, namespace, writeId),
          )
        await store.putChunk(
          value.generation,
          offset / STORAGE_CHUNK_BYTES,
          new Uint8Array(chunk.data),
        )
      }
      await store.putWrite(writeId, value)
      return value
    },
    putWrite: (writeId, value) =>
      Promise.resolve().then(() => {
        database
          .prepare(
            'INSERT INTO taskyon_blob_write_generations(namespace,write_id,value) VALUES(?,?,?) ON CONFLICT(namespace,write_id) DO UPDATE SET value=excluded.value',
          )
          .run(namespace, writeId, JSON.stringify(value))
        database
          .prepare('DELETE FROM taskyon_storage_blob_writes WHERE namespace=? AND write_id=?')
          .run(namespace, writeId)
      }),
    removeWrite: (writeId) =>
      Promise.resolve().then(() => {
        for (const table of ['taskyon_blob_write_generations', 'taskyon_storage_blob_writes'])
          database
            .prepare(`DELETE FROM ${table} WHERE namespace=? AND write_id=?`)
            .run(namespace, writeId)
      }),
    readChunk: (generation, index) =>
      Promise.resolve().then(() => {
        const row = z
          .object({ data: z.instanceof(Uint8Array) })
          .optional()
          .parse(
            database
              .prepare(
                'SELECT data FROM taskyon_blob_chunks WHERE namespace=? AND generation=? AND chunk_index=?',
              )
              .get(namespace, generation, index),
          )
        return row ? new Uint8Array(row.data) : new Uint8Array()
      }),
    putChunk: (generation, index, data) =>
      Promise.resolve().then(() => {
        database
          .prepare(
            'INSERT INTO taskyon_blob_chunks(namespace,generation,chunk_index,data) VALUES(?,?,?,?) ON CONFLICT(namespace,generation,chunk_index) DO UPDATE SET data=excluded.data',
          )
          .run(namespace, generation, index, data)
      }),
    removeGeneration: (generation) =>
      Promise.resolve().then(() => {
        database
          .prepare('DELETE FROM taskyon_blob_chunks WHERE namespace=? AND generation=?')
          .run(namespace, generation)
      }),
    readLegacy,
    clear: () =>
      Promise.resolve().then(() => {
        for (const table of [
          'taskyon_storage_blobs',
          'taskyon_storage_blob_writes',
          'taskyon_blob_generations',
          'taskyon_blob_write_generations',
          'taskyon_blob_chunks',
        ])
          database.prepare(`DELETE FROM ${table} WHERE namespace=?`).run(namespace)
      }),
  }
  return createChunkedBlobBackend(store)
}

export const createCliSqliteStorageProvider = async (
  databasePath: string,
): Promise<{ provider: StorageBackendProvider; close: () => void }> => {
  await mkdir(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  initialize(database)
  let queue = Promise.resolve()
  const serialize = <T>(operation: () => T | Promise<T>) => {
    const result = queue.then(operation, operation)
    queue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
  return {
    provider: {
      records: (namespace) => createSqliteStorageRecordBackend(database, namespace, serialize),
      blobs: (namespace) => createSqliteStorageBlobBackend(database, namespace, serialize),
    },
    close: () => database.close(),
  }
}

export const createCliSqliteStorageService = async (
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  databasePath: string,
) => {
  const { provider, close } = await createCliSqliteStorageProvider(databasePath)
  const stop = createStorageProtocolServer(port, provider, { mode: 'trusted-local' })
  return () => {
    stop()
    close()
  }
}
