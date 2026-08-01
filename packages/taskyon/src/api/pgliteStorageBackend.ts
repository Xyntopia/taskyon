import { createSha256Hasher } from '@taskyon/common/modules/canonicalHash'
import type { TyPGDB } from '../utils/pglite.api'
import type {
  StorageBlobBackend,
  StorageBlobMetadata,
  StorageRecordBackend,
} from './storageProtocol'
import { mergeStorageRecord, storageQueryMatches } from './storageRecordOperations'

type RecordRow = { id_type: 'string' | 'number'; id_text: string; data: unknown }
type BlobRow = {
  id: string
  data: Uint8Array<ArrayBuffer>
  size: number
  content_type: string | null
  modified_at: string
  sha256: string | null
}
type WriteRow = { id: string; data: Uint8Array<ArrayBuffer>; content_type: string | null }
type PgLiteTransaction = Parameters<Parameters<TyPGDB['transaction']>[0]>[0]
type Queryable = TyPGDB | PgLiteTransaction

const initialized = new WeakMap<TyPGDB, Promise<void>>()

const initialize = (database: TyPGDB) => {
  const existing = initialized.get(database)
  if (existing) return existing
  const pending = database
    .exec(
      `
    CREATE TABLE IF NOT EXISTS taskyon_storage_records (
      namespace TEXT NOT NULL,
      id_type TEXT NOT NULL,
      id_text TEXT NOT NULL,
      data JSONB NOT NULL,
      PRIMARY KEY (namespace, id_type, id_text)
    );
    CREATE TABLE IF NOT EXISTS taskyon_storage_blobs (
      namespace TEXT NOT NULL,
      id TEXT NOT NULL,
      data BYTEA NOT NULL,
      size BIGINT NOT NULL,
      content_type TEXT,
      modified_at TEXT NOT NULL,
      sha256 TEXT,
      PRIMARY KEY (namespace, id)
    );
    CREATE TABLE IF NOT EXISTS taskyon_storage_blob_writes (
      write_id TEXT PRIMARY KEY,
      namespace TEXT NOT NULL,
      id TEXT NOT NULL,
      data BYTEA NOT NULL,
      content_type TEXT
    );
  `,
    )
    .then(() => undefined)
  initialized.set(database, pending)
  return pending
}

const idParts = (id: string | number) => ({ idType: typeof id, idText: String(id) })
const rowId = ({ id_type, id_text }: RecordRow) =>
  id_type === 'number' ? Number(id_text) : id_text

const toMetadata = (row: BlobRow): StorageBlobMetadata => ({
  id: row.id,
  size: Number(row.size),
  modifiedAt: row.modified_at,
  ...(row.content_type ? { contentType: row.content_type } : {}),
  ...(row.sha256 ? { sha256: row.sha256 } : {}),
})

const sha256 = (data: Uint8Array<ArrayBuffer>) => {
  const hasher = createSha256Hasher()
  hasher.update(data)
  return hasher.digest()
}

const concatenate = (
  left: Uint8Array<ArrayBuffer>,
  right: Uint8Array<ArrayBuffer>,
  offset = left.byteLength,
) => {
  const size = Math.max(left.byteLength, offset + right.byteLength)
  const result = new Uint8Array(size)
  result.set(left)
  result.set(right, offset)
  return result
}

export const createPgLiteStorageRecordBackend = async (
  database: TyPGDB,
  namespace: string,
): Promise<StorageRecordBackend> => {
  await initialize(database)
  const get = async (id: string | number) => {
    const { idType, idText } = idParts(id)
    const result = await database.query<{ data: unknown }>(
      'SELECT data FROM taskyon_storage_records WHERE namespace = $1 AND id_type = $2 AND id_text = $3;',
      [namespace, idType, idText],
    )
    return result.rows[0]?.data ?? null
  }
  const list = async () =>
    (
      await database.query<RecordRow>(
        'SELECT id_type, id_text, data FROM taskyon_storage_records WHERE namespace = $1;',
        [namespace],
      )
    ).rows

  return {
    get,
    getMany: async (ids) => {
      const values = await Promise.all(ids.map(async (id) => ({ id, data: await get(id) })))
      return values.flatMap((row) => (row.data === null ? [] : [row]))
    },
    set: async (id, data) => {
      const { idType, idText } = idParts(id)
      await database.query(
        `INSERT INTO taskyon_storage_records (namespace, id_type, id_text, data)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (namespace, id_type, id_text) DO UPDATE SET data = EXCLUDED.data;`,
        [namespace, idType, idText, data],
      )
    },
    setMany: async (rows) => {
      await database.transaction(async (transaction) => {
        for (const { id, data } of rows) {
          const { idType, idText } = idParts(id)
          await transaction.query(
            `INSERT INTO taskyon_storage_records (namespace, id_type, id_text, data)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (namespace, id_type, id_text) DO UPDATE SET data = EXCLUDED.data;`,
            [namespace, idType, idText, data],
          )
        }
      })
    },
    upsert: async (id, data, strategy) =>
      await database.transaction(async (transaction) => {
        const { idType, idText } = idParts(id)
        const current = await transaction.query<{ data: unknown }>(
          'SELECT data FROM taskyon_storage_records WHERE namespace = $1 AND id_type = $2 AND id_text = $3;',
          [namespace, idType, idText],
        )
        const next = mergeStorageRecord(current.rows[0]?.data, data, strategy)
        await transaction.query(
          `INSERT INTO taskyon_storage_records (namespace, id_type, id_text, data)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (namespace, id_type, id_text) DO UPDATE SET data = EXCLUDED.data;`,
          [namespace, idType, idText, next],
        )
        return next
      }),
    delete: async (id) => {
      const { idType, idText } = idParts(id)
      await database.query(
        'DELETE FROM taskyon_storage_records WHERE namespace = $1 AND id_type = $2 AND id_text = $3;',
        [namespace, idType, idText],
      )
    },
    list: async () => (await list()).map((row) => ({ id: rowId(row), data: row.data })),
    listIds: async () => (await list()).map(rowId),
    find: async (query) =>
      Object.fromEntries(
        (await list())
          .filter(({ data }) => storageQueryMatches(data, query))
          .map((row) => [String(rowId(row)), row.data]),
      ),
    clear: async () => {
      await database.query('DELETE FROM taskyon_storage_records WHERE namespace = $1;', [namespace])
    },
  }
}

export const createPgLiteStorageBlobBackend = async (
  database: TyPGDB,
  namespace: string,
): Promise<StorageBlobBackend> => {
  await initialize(database)
  const getRow = async (id: string, queryable: Queryable = database) =>
    (
      await queryable.query<BlobRow>(
        `SELECT id, data, size, content_type, modified_at, sha256
       FROM taskyon_storage_blobs WHERE namespace = $1 AND id = $2;`,
        [namespace, id],
      )
    ).rows[0]
  const put = async (
    id: string,
    data: Uint8Array<ArrayBuffer>,
    contentType?: string,
    hash?: string,
    queryable: Queryable = database,
  ) => {
    const modifiedAt = new Date().toISOString()
    await queryable.query(
      `INSERT INTO taskyon_storage_blobs
       (namespace, id, data, size, content_type, modified_at, sha256)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (namespace, id) DO UPDATE SET
       data = EXCLUDED.data, size = EXCLUDED.size, content_type = EXCLUDED.content_type,
       modified_at = EXCLUDED.modified_at, sha256 = EXCLUDED.sha256;`,
      [namespace, id, data, data.byteLength, contentType ?? null, modifiedAt, hash ?? null],
    )
    return {
      id,
      size: data.byteLength,
      modifiedAt,
      ...(contentType ? { contentType } : {}),
      ...(hash ? { sha256: hash } : {}),
    }
  }
  const getWrite = async (writeId: string, queryable: Queryable = database) =>
    (
      await queryable.query<WriteRow>(
        'SELECT id, data, content_type FROM taskyon_storage_blob_writes WHERE write_id = $1 AND namespace = $2;',
        [writeId, namespace],
      )
    ).rows[0]

  return {
    get: async (id) => {
      const row = await getRow(id)
      return row ? { data: row.data, metadata: toMetadata(row) } : null
    },
    set: async (id, data, contentType) => await put(id, data, contentType, sha256(data)),
    stat: async (id) => {
      const row = await getRow(id)
      return row ? toMetadata(row) : null
    },
    list: async () =>
      (
        await database.query<BlobRow>(
          `SELECT id, data, size, content_type, modified_at, sha256
         FROM taskyon_storage_blobs WHERE namespace = $1;`,
          [namespace],
        )
      ).rows.map(toMetadata),
    readRange: async (id, offset, length) => {
      const row = await getRow(id)
      if (!row) throw new Error(`Blob not found: ${id}`)
      const data = row.data.slice(offset, offset + length)
      const nextOffset = offset + data.byteLength
      return { data, nextOffset, eof: nextOffset >= Number(row.size) }
    },
    append: async (id, data, expectedSize, contentType) =>
      await database.transaction(async (transaction) => {
        const row = await getRow(id, transaction)
        const current = row?.data ?? new Uint8Array()
        if (current.byteLength !== expectedSize) {
          throw new Error(
            `Blob append offset mismatch for "${id}": expected ${expectedSize}, found ${current.byteLength}.`,
          )
        }
        return await put(
          id,
          concatenate(current, data),
          contentType ?? row?.content_type ?? undefined,
          undefined,
          transaction,
        )
      }),
    beginWrite: async (id, contentType) => {
      const writeId = crypto.randomUUID()
      await database.query(
        `INSERT INTO taskyon_storage_blob_writes (write_id, namespace, id, data, content_type)
         VALUES ($1, $2, $3, $4, $5);`,
        [writeId, namespace, id, new Uint8Array(), contentType ?? null],
      )
      return { writeId }
    },
    writeChunk: async (id, writeId, offset, data) =>
      await database.transaction(async (transaction) => {
        const row = await getWrite(writeId, transaction)
        if (!row || row.id !== id) throw new Error(`Unknown blob write: ${writeId}`)
        if (offset > row.data.byteLength)
          throw new Error(`Blob write offset ${offset} exceeds size ${row.data.byteLength}.`)
        const next = concatenate(row.data, data, offset)
        await transaction.query(
          'UPDATE taskyon_storage_blob_writes SET data = $1 WHERE write_id = $2;',
          [next, writeId],
        )
        return { nextOffset: next.byteLength }
      }),
    writeStatus: async (id, writeId) => {
      const row = await getWrite(writeId)
      if (!row || row.id !== id) throw new Error(`Unknown blob write: ${writeId}`)
      return { size: row.data.byteLength }
    },
    commitWrite: async (id, writeId, expectedSize, expectedSha256) =>
      await database.transaction(async (transaction) => {
        const row = await getWrite(writeId, transaction)
        if (!row || row.id !== id) throw new Error(`Unknown blob write: ${writeId}`)
        if (row.data.byteLength !== expectedSize) throw new Error(`Blob size mismatch for "${id}".`)
        const hash = sha256(row.data)
        if (expectedSha256 && hash !== expectedSha256)
          throw new Error(`Blob checksum mismatch for "${id}".`)
        const metadata = await put(id, row.data, row.content_type ?? undefined, hash, transaction)
        await transaction.query('DELETE FROM taskyon_storage_blob_writes WHERE write_id = $1;', [
          writeId,
        ])
        return metadata
      }),
    abortWrite: async (_id, writeId) => {
      await database.query(
        'DELETE FROM taskyon_storage_blob_writes WHERE write_id = $1 AND namespace = $2;',
        [writeId, namespace],
      )
    },
    delete: async (id) => {
      await database.query('DELETE FROM taskyon_storage_blobs WHERE namespace = $1 AND id = $2;', [
        namespace,
        id,
      ])
    },
    clear: async () => {
      await database.transaction(async (transaction) => {
        await transaction.query('DELETE FROM taskyon_storage_blobs WHERE namespace = $1;', [
          namespace,
        ])
        await transaction.query('DELETE FROM taskyon_storage_blob_writes WHERE namespace = $1;', [
          namespace,
        ])
      })
    },
  }
}
