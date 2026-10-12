import { createSha256Hasher } from '@taskyon/common/modules/canonicalHash'
import type { TyPGDB } from '../utils/pglite.api'
import type {
  StorageBlobBackend,
  StorageBlobMetadata,
  StorageRecordBackend,
} from './storageProtocol'
import {
  mergeStorageRecord,
  storageQueryMatches,
  storageValueContentHash,
} from './storageRecordOperations'

type RecordRow = { id_type: 'string' | 'number'; id_text: string; data: unknown }
type BlobRow = {
  id: string
  object_oid: number | null
  size: number
  content_type: string | null
  modified_at: string
  sha256: string | null
}
type WriteRow = { id: string; object_oid: number | null; size: number; content_type: string | null }
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
    ALTER TABLE taskyon_storage_blobs ADD COLUMN IF NOT EXISTS object_oid OID;
    ALTER TABLE taskyon_storage_blobs ALTER COLUMN data DROP NOT NULL;
    ALTER TABLE taskyon_storage_blob_writes ADD COLUMN IF NOT EXISTS object_oid OID;
    ALTER TABLE taskyon_storage_blob_writes ADD COLUMN IF NOT EXISTS size BIGINT;
    ALTER TABLE taskyon_storage_blob_writes ALTER COLUMN data DROP NOT NULL;
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
    setIfUnchanged: async (id, expectedStoredContentHash, data) => {
      const { idType, idText } = idParts(id)
      if (expectedStoredContentHash === null) {
        const result = await database.query<{ data: unknown }>(
          `INSERT INTO taskyon_storage_records (namespace, id_type, id_text, data)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (namespace, id_type, id_text) DO NOTHING
             RETURNING data;`,
          [namespace, idType, idText, data],
        )
        if (result.rows.length > 0) {
          return { written: true, currentStoredContentHash: storageValueContentHash(data) }
        }
        const current = await get(id)
        return {
          written: false,
          currentStoredContentHash: current === null ? null : storageValueContentHash(current),
        }
      }
      return await database.transaction(async (transaction) => {
        const currentResult = await transaction.query<{ data: unknown }>(
          `SELECT data FROM taskyon_storage_records
           WHERE namespace = $1 AND id_type = $2 AND id_text = $3
           FOR UPDATE;`,
          [namespace, idType, idText],
        )
        const current = currentResult.rows[0]?.data ?? null
        const currentStoredContentHash = current === null ? null : storageValueContentHash(current)
        if (currentStoredContentHash !== expectedStoredContentHash) {
          return { written: false, currentStoredContentHash }
        }
        await transaction.query(
          `UPDATE taskyon_storage_records SET data = $4
           WHERE namespace = $1 AND id_type = $2 AND id_text = $3;`,
          [namespace, idType, idText, data],
        )
        return { written: true, currentStoredContentHash: storageValueContentHash(data) }
      })
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
  const getRow = async (id: string, db: Queryable = database) =>
    (
      await db.query<BlobRow>(
        `SELECT id, object_oid, size, content_type, modified_at, sha256
       FROM taskyon_storage_blobs WHERE namespace=$1 AND id=$2`,
        [namespace, id],
      )
    ).rows[0]
  const unlink = async (db: Queryable, oid: number | null | undefined) => {
    if (oid) await db.query('SELECT lo_unlink($1::oid)', [oid])
  }
  const allocate = async (db: Queryable) =>
    (await db.query<{ oid: number }>('SELECT lo_create(0) AS oid')).rows[0]!.oid
  const read = async (db: Queryable, oid: number, offset: number, length: number) =>
    (
      await db.query<{ data: Uint8Array<ArrayBuffer> }>(
        'SELECT lo_get($1::oid,$2::bigint,$3::integer) AS data',
        [oid, offset, length],
      )
    ).rows[0]!.data
  const digest = async (db: Queryable, oid: number, size: number) => {
    const hasher = createSha256Hasher()
    for (let offset = 0; offset < size; offset += 1024 * 1024)
      hasher.update(await read(db, oid, offset, Math.min(1024 * 1024, size - offset)))
    return hasher.digest()
  }
  const publish = async (
    db: Queryable,
    id: string,
    oid: number,
    size: number,
    contentType?: string,
    hash?: string,
  ) => {
    const previous = await getRow(id, db)
    const modifiedAt = new Date().toISOString()
    await db.query(
      `INSERT INTO taskyon_storage_blobs
       (namespace,id,data,object_oid,size,content_type,modified_at,sha256)
       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7)
       ON CONFLICT(namespace,id) DO UPDATE SET data=NULL,object_oid=EXCLUDED.object_oid,
       size=EXCLUDED.size,content_type=EXCLUDED.content_type,
       modified_at=EXCLUDED.modified_at,sha256=EXCLUDED.sha256`,
      [namespace, id, oid, size, contentType ?? null, modifiedAt, hash ?? null],
    )
    if (previous?.object_oid !== oid) await unlink(db, previous?.object_oid)
    return {
      id,
      size,
      modifiedAt,
      ...(contentType ? { contentType } : {}),
      ...(hash ? { sha256: hash } : {}),
    }
  }
  const getWrite = async (db: Queryable, id: string, writeId: string) => {
    const row = (
      await db.query<WriteRow>(
        `SELECT id,object_oid,COALESCE(size,octet_length(data)) AS size,content_type
       FROM taskyon_storage_blob_writes WHERE namespace=$1 AND write_id=$2 AND id=$3`,
        [namespace, writeId, id],
      )
    ).rows[0]
    if (!row) throw new Error(`Unknown blob write: ${writeId}`)
    return row
  }
  const migrateWrite = async (db: Queryable, id: string, writeId: string) => {
    await getWrite(db, id, writeId)
    return (
      await db.query<WriteRow>(
        `UPDATE taskyon_storage_blob_writes SET
       object_oid=COALESCE(object_oid,lo_from_bytea(0,data)),
       size=COALESCE(size,octet_length(data)),data=NULL
       WHERE namespace=$1 AND write_id=$2 AND id=$3
       RETURNING id,object_oid,size,content_type`,
        [namespace, writeId, id],
      )
    ).rows[0]!
  }
  return {
    get: async (id) => {
      const row = await getRow(id)
      if (!row) return null
      const result = await database.query<{ data: Uint8Array<ArrayBuffer> }>(
        `SELECT CASE WHEN object_oid IS NULL THEN data ELSE lo_get(object_oid) END AS data
         FROM taskyon_storage_blobs WHERE namespace=$1 AND id=$2`,
        [namespace, id],
      )
      return { data: result.rows[0]!.data, metadata: toMetadata(row) }
    },
    set: async (id, data, contentType) =>
      database.transaction(async (db) => {
        const oid = await allocate(db)
        for (let offset = 0; offset < data.length; offset += 1024 * 1024)
          await db.query('SELECT lo_put($1::oid,$2::bigint,$3::bytea)', [
            oid,
            offset,
            data.subarray(offset, offset + 1024 * 1024),
          ])
        return publish(db, id, oid, data.length, contentType, sha256(data))
      }),
    stat: async (id) => {
      const row = await getRow(id)
      return row ? toMetadata(row) : null
    },
    list: async () =>
      (
        await database.query<BlobRow>(
          `SELECT id,object_oid,size,content_type,modified_at,sha256
       FROM taskyon_storage_blobs WHERE namespace=$1`,
          [namespace],
        )
      ).rows.map(toMetadata),
    readRange: async (id, offset, length) =>
      database.transaction(async (db) => {
        const row = await getRow(id, db)
        if (!row) throw new Error(`Blob not found: ${id}`)
        const data = row.object_oid
          ? await read(db, row.object_oid, offset, length)
          : (
              await db.query<{ data: Uint8Array<ArrayBuffer> }>(
                'SELECT substring(data FROM $3::integer + 1 FOR $4::integer) AS data FROM taskyon_storage_blobs WHERE namespace=$1 AND id=$2',
                [namespace, id, offset, length],
              )
            ).rows[0]!.data
        return {
          data,
          nextOffset: offset + data.length,
          eof: offset + data.length >= Number(row.size),
        }
      }),
    append: async (id, data, expectedSize, contentType) =>
      database.transaction(async (db) => {
        const row = await getRow(id, db)
        const size = Number(row?.size ?? 0)
        if (size !== expectedSize) throw new Error(`Blob append offset mismatch for "${id}".`)
        const oid =
          row?.object_oid ??
          (row
            ? (
                await db.query<{ oid: number }>(
                  'SELECT lo_from_bytea(0,data) AS oid FROM taskyon_storage_blobs WHERE namespace=$1 AND id=$2',
                  [namespace, id],
                )
              ).rows[0]!.oid
            : await allocate(db))
        await db.query('SELECT lo_put($1::oid,$2::bigint,$3::bytea)', [oid, size, data])
        return publish(
          db,
          id,
          oid,
          size + data.length,
          contentType ?? row?.content_type ?? undefined,
        )
      }),
    beginWrite: async (id, contentType) =>
      database.transaction(async (db) => {
        const writeId = crypto.randomUUID()
        const oid = await allocate(db)
        await db.query(
          `INSERT INTO taskyon_storage_blob_writes
        (write_id,namespace,id,object_oid,size,content_type) VALUES ($1,$2,$3,$4,0,$5)`,
          [writeId, namespace, id, oid, contentType ?? null],
        )
        return { writeId }
      }),
    writeChunk: async (id, writeId, offset, data) =>
      database.transaction(async (db) => {
        const row = await migrateWrite(db, id, writeId)
        const size = Number(row.size)
        if (offset > size) throw new Error(`Blob write offset ${offset} exceeds size ${size}.`)
        await db.query('SELECT lo_put($1::oid,$2::bigint,$3::bytea)', [
          row.object_oid,
          offset,
          data,
        ])
        const nextOffset = Math.max(size, offset + data.length)
        await db.query('UPDATE taskyon_storage_blob_writes SET size=$1 WHERE write_id=$2', [
          nextOffset,
          writeId,
        ])
        return { nextOffset }
      }),
    writeStatus: async (id, writeId) => ({
      size: Number((await getWrite(database, id, writeId)).size),
    }),
    commitWrite: async (id, writeId, expectedSize, expectedSha256, targetId) =>
      database.transaction(async (db) => {
        const row = await migrateWrite(db, id, writeId)
        const size = Number(row.size)
        if (size !== expectedSize) throw new Error(`Blob size mismatch for "${id}".`)
        if (!row.object_oid) throw new Error('Blob write has no large object')
        const hash = await digest(db, row.object_oid, size)
        if (expectedSha256 && hash !== expectedSha256)
          throw new Error(`Blob checksum mismatch for "${id}".`)
        const metadata = await publish(
          db,
          targetId ?? id,
          row.object_oid,
          size,
          row.content_type ?? undefined,
          hash,
        )
        await db.query(
          'DELETE FROM taskyon_storage_blob_writes WHERE write_id=$1 AND namespace=$2',
          [writeId, namespace],
        )
        return metadata
      }),
    abortWrite: async (id, writeId) =>
      database.transaction(async (db) => {
        const rows = await db.query<{ object_oid: number | null }>(
          'DELETE FROM taskyon_storage_blob_writes WHERE namespace=$1 AND id=$2 AND write_id=$3 RETURNING object_oid',
          [namespace, id, writeId],
        )
        for (const row of rows.rows) await unlink(db, row.object_oid)
      }),
    delete: async (id) =>
      database.transaction(async (db) => {
        const rows = await db.query<{ object_oid: number | null }>(
          'DELETE FROM taskyon_storage_blobs WHERE namespace=$1 AND id=$2 RETURNING object_oid',
          [namespace, id],
        )
        for (const row of rows.rows) await unlink(db, row.object_oid)
      }),
    clear: async () =>
      database.transaction(async (db) => {
        for (const table of ['taskyon_storage_blobs', 'taskyon_storage_blob_writes']) {
          const rows = await db.query<{ object_oid: number | null }>(
            `DELETE FROM ${table} WHERE namespace=$1 RETURNING object_oid`,
            [namespace],
          )
          for (const row of rows.rows) await unlink(db, row.object_oid)
        }
      }),
  }
}
