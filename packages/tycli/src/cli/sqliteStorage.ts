import { createHash, randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import type { Port } from '@taskyon/common/modules/frpBus'
import {
  createStorageProtocolServer,
  mergeStorageRecord,
  storageQueryMatches,
  type StorageBackendProvider,
  type StorageBlobBackend,
  type StorageBlobMetadata,
  type StorageRecordBackend,
  type TaskyonStorageMessage,
} from '@taskyon/taskyon/api'

const recordRowSchema = z.object({
  id_type: z.enum(['string', 'number']),
  id_text: z.string(),
  data: z.string(),
})
const blobRowSchema = z.object({
  id: z.string(),
  data: z.instanceof(Uint8Array),
  size: z.number(),
  content_type: z.string().nullable(),
  modified_at: z.string(),
  sha256: z.string().nullable(),
})
const writeRowSchema = z.object({
  id: z.string(),
  data: z.instanceof(Uint8Array),
  content_type: z.string().nullable(),
})
const storedRecordSchema = z.object({ data: z.string() })

type RecordRow = z.infer<typeof recordRowSchema>
type BlobRow = z.infer<typeof blobRowSchema>

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

const runAsync = <T>(operation: () => T): Promise<T> => Promise.resolve().then(operation)

const idParts = (id: string | number) => ({ idType: typeof id, idText: String(id) })
const rowId = (row: RecordRow) => (row.id_type === 'number' ? Number(row.id_text) : row.id_text)
const bytes = (value: Uint8Array) => new Uint8Array(value)
const hash = (data: Uint8Array) => `sha256:${createHash('sha256').update(data).digest('hex')}`

const concatenate = (left: Uint8Array, right: Uint8Array, offset = left.byteLength) => {
  const result = new Uint8Array(Math.max(left.byteLength, offset + right.byteLength))
  result.set(left)
  result.set(right, offset)
  return result
}

const metadata = (row: BlobRow): StorageBlobMetadata => ({
  id: row.id,
  size: row.size,
  modifiedAt: row.modified_at,
  ...(row.content_type ? { contentType: row.content_type } : {}),
  ...(row.sha256 ? { sha256: row.sha256 } : {}),
})

export const createSqliteStorageRecordBackend = (
  database: DatabaseSync,
  namespace: string,
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
    get: (id) => runAsync(() => get(id)),
    getMany: (ids) =>
      runAsync(() =>
        ids.flatMap((id) => {
          const data = get(id)
          return data === null ? [] : [{ id, data }]
        }),
      ),
    set: (id, data) => runAsync(() => set(id, data)),
    setMany: (rows) =>
      runAsync(() => transaction(database, () => rows.forEach(({ id, data }) => set(id, data)))),
    upsert: (id, data, strategy) =>
      runAsync(() =>
        transaction(database, () => {
          const next = mergeStorageRecord(get(id), data, strategy)
          set(id, next)
          return next
        }),
      ),
    delete: (id) =>
      runAsync(() => {
        const { idType, idText } = idParts(id)
        database
          .prepare(
            'DELETE FROM taskyon_storage_records WHERE namespace = ? AND id_type = ? AND id_text = ?',
          )
          .run(namespace, idType, idText)
      }),
    list: () =>
      runAsync(() =>
        list().map((row) => ({ id: rowId(row), data: JSON.parse(row.data) as unknown })),
      ),
    listIds: () => runAsync(() => list().map(rowId)),
    find: (query) =>
      runAsync(() =>
        Object.fromEntries(
          list()
            .map((row) => ({ id: rowId(row), data: JSON.parse(row.data) as unknown }))
            .filter(({ data }) => storageQueryMatches(data, query))
            .map(({ id, data }) => [String(id), data]),
        ),
      ),
    clear: () =>
      runAsync(() => {
        database.prepare('DELETE FROM taskyon_storage_records WHERE namespace = ?').run(namespace)
      }),
  }
}

export const createSqliteStorageBlobBackend = (
  database: DatabaseSync,
  namespace: string,
): StorageBlobBackend => {
  const readRow = database.prepare(`
    SELECT id, data, size, content_type, modified_at, sha256
    FROM taskyon_storage_blobs WHERE namespace = ? AND id = ?
  `)
  const getRow = (id: string) => blobRowSchema.optional().parse(readRow.get(namespace, id))
  const put = (id: string, data: Uint8Array, contentType?: string, sha256?: string) => {
    const modifiedAt = new Date().toISOString()
    database
      .prepare(
        `
      INSERT INTO taskyon_storage_blobs
      (namespace, id, data, size, content_type, modified_at, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (namespace, id) DO UPDATE SET data = excluded.data, size = excluded.size,
      content_type = excluded.content_type, modified_at = excluded.modified_at, sha256 = excluded.sha256
    `,
      )
      .run(namespace, id, data, data.byteLength, contentType ?? null, modifiedAt, sha256 ?? null)
    return {
      id,
      size: data.byteLength,
      modifiedAt,
      ...(contentType ? { contentType } : {}),
      ...(sha256 ? { sha256 } : {}),
    }
  }
  const getWrite = (writeId: string) =>
    writeRowSchema
      .optional()
      .parse(
        database
          .prepare(
            'SELECT id, data, content_type FROM taskyon_storage_blob_writes WHERE write_id = ? AND namespace = ?',
          )
          .get(writeId, namespace),
      )

  return {
    get: (id) =>
      runAsync(() => {
        const row = getRow(id)
        return row ? { data: bytes(row.data), metadata: metadata(row) } : null
      }),
    set: (id, data, contentType) => runAsync(() => put(id, data, contentType, hash(data))),
    stat: (id) =>
      runAsync(() => {
        const row = getRow(id)
        return row ? metadata(row) : null
      }),
    list: () =>
      runAsync(() =>
        z
          .array(blobRowSchema)
          .parse(
            database
              .prepare(
                `
        SELECT id, data, size, content_type, modified_at, sha256
        FROM taskyon_storage_blobs WHERE namespace = ?
      `,
              )
              .all(namespace),
          )
          .map(metadata),
      ),
    readRange: (id, offset, length) =>
      runAsync(() => {
        const row = getRow(id)
        if (!row) throw new Error(`Blob not found: ${id}`)
        const data = bytes(row.data).slice(offset, offset + length)
        const nextOffset = offset + data.byteLength
        return { data, nextOffset, eof: nextOffset >= row.size }
      }),
    append: (id, data, expectedSize, contentType) =>
      runAsync(() =>
        transaction(database, () => {
          const row = getRow(id)
          const current = row ? bytes(row.data) : new Uint8Array()
          if (current.byteLength !== expectedSize) {
            throw new Error(
              `Blob append offset mismatch for "${id}": expected ${expectedSize}, found ${current.byteLength}.`,
            )
          }
          return put(id, concatenate(current, data), contentType ?? row?.content_type ?? undefined)
        }),
      ),
    beginWrite: (id, contentType) =>
      runAsync(() => {
        const writeId = randomUUID()
        database
          .prepare(
            `
        INSERT INTO taskyon_storage_blob_writes (write_id, namespace, id, data, content_type)
        VALUES (?, ?, ?, ?, ?)
      `,
          )
          .run(writeId, namespace, id, new Uint8Array(), contentType ?? null)
        return { writeId }
      }),
    writeChunk: (id, writeId, offset, data) =>
      runAsync(() =>
        transaction(database, () => {
          const row = getWrite(writeId)
          if (!row || row.id !== id) throw new Error(`Unknown blob write: ${writeId}`)
          const current = bytes(row.data)
          if (offset > current.byteLength)
            throw new Error(`Blob write offset ${offset} exceeds size ${current.byteLength}.`)
          const next = concatenate(current, data, offset)
          database
            .prepare('UPDATE taskyon_storage_blob_writes SET data = ? WHERE write_id = ?')
            .run(next, writeId)
          return { nextOffset: next.byteLength }
        }),
      ),
    writeStatus: (id, writeId) =>
      runAsync(() => {
        const row = getWrite(writeId)
        if (!row || row.id !== id) throw new Error(`Unknown blob write: ${writeId}`)
        return { size: row.data.byteLength }
      }),
    commitWrite: (id, writeId, expectedSize, expectedSha256) =>
      runAsync(() =>
        transaction(database, () => {
          const row = getWrite(writeId)
          if (!row || row.id !== id) throw new Error(`Unknown blob write: ${writeId}`)
          const data = bytes(row.data)
          if (data.byteLength !== expectedSize) throw new Error(`Blob size mismatch for "${id}".`)
          const sha256 = hash(data)
          if (expectedSha256 && sha256 !== expectedSha256)
            throw new Error(`Blob checksum mismatch for "${id}".`)
          const result = put(id, data, row.content_type ?? undefined, sha256)
          database
            .prepare('DELETE FROM taskyon_storage_blob_writes WHERE write_id = ?')
            .run(writeId)
          return result
        }),
      ),
    abortWrite: (_id, writeId) =>
      runAsync(() => {
        database
          .prepare('DELETE FROM taskyon_storage_blob_writes WHERE write_id = ? AND namespace = ?')
          .run(writeId, namespace)
      }),
    delete: (id) =>
      runAsync(() => {
        database
          .prepare('DELETE FROM taskyon_storage_blobs WHERE namespace = ? AND id = ?')
          .run(namespace, id)
      }),
    clear: () =>
      runAsync(() =>
        transaction(database, () => {
          database.prepare('DELETE FROM taskyon_storage_blobs WHERE namespace = ?').run(namespace)
          database
            .prepare('DELETE FROM taskyon_storage_blob_writes WHERE namespace = ?')
            .run(namespace)
        }),
      ),
  }
}

export const createCliSqliteStorageProvider = async (
  databasePath: string,
): Promise<{ provider: StorageBackendProvider; close: () => void }> => {
  await mkdir(dirname(databasePath), { recursive: true })
  const database = new DatabaseSync(databasePath)
  initialize(database)
  return {
    provider: {
      records: (namespace) => createSqliteStorageRecordBackend(database, namespace),
      blobs: (namespace) => createSqliteStorageBlobBackend(database, namespace),
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
