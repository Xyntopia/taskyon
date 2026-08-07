import type { PartialDeep } from 'type-fest'
import { KeyedMutex } from './asyncUtils'
import type { AskCryptoKey } from './crypto'
import type { EncryptedDataRow } from './encrypt'
import { decryptDataFile, encryptDataFile } from './encrypt'
import type { Stream } from '@taskyon/common/modules/frpBus'
import { createStream, streamProcedureCall } from '@taskyon/common/modules/frpBus'
import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import { deepMerge } from './objHelpers'
import type { PgLiteOptions } from './pglite.api'
import { createVecPgLiteTable, type TyPGDB } from './pglite.api'
import { useNlpWorker } from './webWorkerApi'
import {
  rankSearchDocuments,
  searchIndexSignature,
  type SearchVectorizerPreset,
} from './searchEngine'
import { DEFAULT_STATIC_EMBEDDING_MODEL } from './staticEmbedding'

type Row<T> = {
  [key: string]: unknown
  id: string | number
  data: T
}

export interface CrudWrapper<T> {
  set: (id: string | number, data: T) => Promise<void>
  get: (id: string | number) => Promise<T | null>
  delete: (id: string | number) => Promise<void>
  listIds: () => Promise<(string | number)[]>
  list: () => Promise<Row<T>[]>
  listAll: () => Promise<Row<T>[]>
  clear: () => Promise<void>
  // TODO: the "upsert" strategy is potentially problematic, because
  //       it leads to inconsistent results across different storages.
  //       so it would probably be a good idea to only use this in the "combined"
  //       storage
  upsert: (
    id: string | number,
    data: T,
    strategy?: 'shallow_merge' | 'replace' | 'deepmerge' | 'native_shallow',
  ) => Promise<T>
}

export type StreamData<T> = { id: string | number; data: T | null }
type LiveCrudWrapper<T> = CrudWrapper<T> & {
  readLive: (id: string | number) => Stream<StreamData<T>>
  liveStream: Stream<StreamData<T>>
}

export type ImmutableOf<T, C extends CrudWrapper<T>> = Omit<C, 'set' | 'upsert'> & {
  add(data: T): Promise<number | string>
  // hard-ban these at the type level if someone widens:
  set?: never
  upsert?: never
}

export function withImmutable<T, B extends CrudWrapper<T>>(
  base: B,
  opts: {
    hash: (data: T) => Promise<string> | string
    onDuplicate?: 'ignore' | 'error'
  },
): ImmutableOf<T, B> {
  const hash = opts.hash
  const onDuplicate = opts?.onDuplicate ?? 'ignore'

  const insertIfAbsent = async (id: string | number, data: T) => {
    const existing = await base.get(id)
    if (existing !== null) {
      if (onDuplicate === 'ignore') return
      throw new Error('Duplicate (immutable) id')
    }
    await base.set(id, data)
  }

  // sortout set & upsert
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { set, upsert, ...passthrough } = base

  const out = {
    ...passthrough,
    async add(data: T): Promise<string | number> {
      const id = await hash(data)
      await insertIfAbsent(id, data)
      return id
    },
    // passthroughs (read / housekeeping only)
    get: base.get,
    delete: base.delete, // keep if you want physical deletes; otherwise drop or tombstone upstream
    list: base.list,
    listIds: base.listIds,
    clear: base.clear,
  } as ImmutableOf<T, B>

  if (base.listAll) {
    // TS is fine with assigning an optional key here
    out.listAll = base.listAll
  }

  return out
}

export function withKeyLockings<T, B>(
  base: B & CrudWrapper<T>,
  opts?: { lockGets?: boolean; blockDuringClear?: boolean },
): B & CrudWrapper<T> {
  const mutex = new KeyedMutex()
  let clearBarrier: Promise<void> | null = null
  let resolveBarrier: (() => void) | null = null

  const waitBarrier = async () => {
    if (!opts?.blockDuringClear) return
    const b = clearBarrier
    if (b) await b
  }

  const lock = async <R>(id: string | number, fn: () => Promise<R>) => {
    await waitBarrier()
    return mutex.runExclusive(id, fn)
  }

  const out: CrudWrapper<T> = {
    ...base,
    set: (id, data) => lock(id, () => base.set(id, data)),
    upsert: (id, data, strategy) => lock(id, () => base.upsert(id, data, strategy)),
    delete: (id) => lock(id, () => base.delete(id)),
    get: (id) =>
      opts?.lockGets ? lock(id, () => base.get(id)) : waitBarrier().then(() => base.get(id)),
    clear: async () => {
      if (!opts?.blockDuringClear) return base.clear()
      if (!clearBarrier) {
        clearBarrier = new Promise<void>((res) => (resolveBarrier = res))
      }
      try {
        await base.clear()
      } finally {
        resolveBarrier?.()
        resolveBarrier = null
        clearBarrier = null
      }
    },
  }

  return out as B & CrudWrapper<T>
}

type JsonFindOptions<T> = {
  allowedIDs?: (string | number)[]
  limit?: number
  offset?: number
  // order by table id or by a top-level key in data
  orderBy?: { kind: 'id' } | { kind: 'dataKey'; key: keyof T & string }
  orderDir?: 'asc' | 'desc'
}

const createFind = <T>(db: TyPGDB, dataColumn: string, idColumn: string, tableName: string) => {
  const find = async (
    where?: PartialDeep<T>,
    opts: JsonFindOptions<T> = {},
  ): Promise<Record<string, T>> => {
    await db.waitReady
    const params: unknown[] = []
    const clauses: string[] = []

    // JSONB subset containment: matches when all keys/values in `where` are present in data
    if (where && Object.keys(where).length) {
      params.push(JSON.stringify(where))
      clauses.push(`${dataColumn} @> $${params.length}`)
    }

    if (opts.allowedIDs?.length) {
      params.push(opts.allowedIDs)
      clauses.push(`${idColumn} = ANY($${params.length})`)
    }

    let sql = `SELECT ${idColumn}, ${dataColumn} FROM ${tableName}`
    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`

    // ordering
    if (opts.orderBy) {
      if (opts.orderBy.kind === 'id') {
        sql += ` ORDER BY ${idColumn} ${opts.orderDir ?? 'asc'}`
      } else {
        // order by top-level JSON key as text for deterministic ordering
        params.push(opts.orderBy.key)
        sql += ` ORDER BY (${dataColumn} ->> $${params.length}) ${opts.orderDir ?? 'asc'}`
      }
    }

    if (opts.limit != null) {
      params.push(opts.limit)
      sql += ` LIMIT $${params.length}`
    }
    if (opts.offset != null) {
      params.push(opts.offset)
      sql += ` OFFSET $${params.length}`
    }

    console.log('search find:', sql, params)
    const res = await db.query<Row<T>>(sql + ';', params)
    return res.rows.reduce<Record<string, T>>((p, c) => {
      p[c.id] = c.data
      return p
    }, {})
  }

  const findOne = async (where: PartialDeep<T>): Promise<T | null> => {
    const rows = await find(where, { limit: 1 })
    return Object.values(rows)[0] ?? null
  }

  return {
    find,
    findOne,
  }
}

export const createPgLiteCrudWrapper = async <T>(
  db: TyPGDB,
  options: PgLiteOptions,
): Promise<
  CrudWrapper<T> & {
    batchInsert: (
      items: {
        id: string | number
        data: T
      }[],
      mode?: 'overwrite' | 'skip',
    ) => Promise<void>
    find: (where: PartialDeep<T>, opts?: JsonFindOptions<T>) => Promise<Record<string, T>>
    findOne: (where: PartialDeep<T>) => Promise<T | null>
    callDb: <RT>(
      caller: (db: TyPGDB, idColumn: string, dataColumn: string, tableName: string) => RT,
    ) => Promise<RT>
  }
> => {
  const { dataColumn, tableName, idColumn } = await createVecPgLiteTable(db, options)

  const get = async (id: string | number): Promise<T | null> => {
    await db.waitReady
    const result = await db.query<Row<T>>(
      `SELECT ${dataColumn} FROM ${tableName}
       WHERE ${idColumn} = $1;`,
      [id],
    )
    return result.rows.length ? result.rows[0]!.data : null
  }

  const list = async (): Promise<Row<T>[]> => {
    await db.waitReady
    const result = await db.query<Row<T>>(`SELECT ${idColumn}, ${dataColumn} FROM ${tableName};`)
    return result.rows
  }

  return {
    set: async (id: string | number, data: T) => {
      await db.waitReady
      await db.query(
        `INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
         VALUES ($1, $2)
         ON CONFLICT (${idColumn}) DO UPDATE SET ${dataColumn} = $2;`,
        [id, data],
      )
    },
    get,
    upsert: async (id, data, strategy = 'replace') => {
      // important: this function usually also requires the "withLocking" wrapper
      // in order to avoid race conditions
      let newData: T
      if (strategy === 'native_shallow' || strategy === 'shallow_merge') {
        await db.waitReady
        await db.query(
          `INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
           VALUES ($1, $2)
           ON CONFLICT (${idColumn})
           DO UPDATE SET ${dataColumn} = jsonb_set(${tableName}."${dataColumn}", '{}', EXCLUDED."${dataColumn}");`,
          [id, data],
        )
        newData = (await get(id)) ?? data
      } else {
        // Fetch and merge in JS only if necessary
        const existingData = strategy === 'replace' ? {} : await get(id)
        newData =
          strategy === 'deepmerge'
            ? deepMerge(existingData, data, 'overwrite')
            : { ...existingData, ...data }
        await db.waitReady
        await db.query(
          `INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
           VALUES ($1, $2)
           ON CONFLICT (${idColumn}) DO UPDATE SET ${dataColumn} = $2;`,
          [id, JSON.stringify(newData)],
        )
      }
      return newData
    },
    delete: async (id: string | number) => {
      await db.waitReady
      await db.query(`DELETE FROM ${tableName} WHERE ${idColumn} = $1;`, [id])
    },
    list,
    listAll: list,
    listIds: async (): Promise<(string | number)[]> => {
      await db.waitReady
      const result = await db.query<{ id: string | number }>(
        `SELECT ${idColumn} AS id FROM ${tableName};`,
      )
      return result.rows.map((row) => row.id)
    },
    clear: async (): Promise<void> => {
      await db.waitReady
      await db.query(`DELETE FROM ${tableName};`)
    },
    batchInsert: async (
      items: { id: string | number; data: T }[],
      mode: 'overwrite' | 'skip' = 'overwrite',
    ): Promise<void> => {
      if (!items.length) return
      await db.waitReady

      const payload = JSON.stringify(items)
      const conflict =
        mode === 'skip' ? 'DO NOTHING' : `DO UPDATE SET ${dataColumn} = EXCLUDED.${dataColumn}`

      const sql = `
        WITH src AS (
          SELECT * FROM jsonb_to_recordset($1::jsonb)
            AS t(id ${tableName}.${idColumn}%TYPE, ${dataColumn} jsonb)
        )
        INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
        SELECT id, ${dataColumn} FROM src
        ON CONFLICT (${idColumn}) ${conflict};
      `
      await db.query(sql, [payload])
    },
    callDb: async <RT>(
      caller: (db: TyPGDB, idColumn: string, dataColumn: string, tableName: string) => RT,
    ) => {
      return await caller(db, idColumn, dataColumn, tableName)
    },
    ...createFind<T>(db, dataColumn, idColumn, tableName),
  }
}

// TODO: option to create indices on specific data properties to speed up filtering...
export const createVectorStore = async <T>(
  db: TyPGDB,
  name: string,
  additionalColumnsOrOptions?:
    | string[]
    | {
        additionalColumns?: string[]
        vectorizer?: SearchVectorizerPreset
        modelName?: string
        dimensions?: number
      },
) => {
  const options = Array.isArray(additionalColumnsOrOptions)
    ? { additionalColumns: additionalColumnsOrOptions }
    : (additionalColumnsOrOptions ?? {})
  const vectorizer = options.vectorizer ?? 'static-multilingual'
  const numDimensions = options.dimensions ?? (vectorizer === 'static-multilingual' ? 256 : 384)
  const maxStrLength = 10000 // only vectorize approx. the first page.
  const dataColumn = 'data'
  const idColumn = 'id'
  const modelName =
    options.modelName ??
    (vectorizer === 'static-multilingual'
      ? DEFAULT_STATIC_EMBEDDING_MODEL
      : 'xyntopia/all-MiniLM-L6-v2')
  const signature = searchIndexSignature({
    vectorizer,
    model: modelName,
    dimensions: numDimensions,
  })
  const tableName = `${name}_${canonicalHash(signature).slice('sha256:'.length, 12)}`
  const crudTable = await createPgLiteCrudWrapper<T>(db, {
    tableName,
    idColumn,
    dataColumn,
    additionalColumns: [...(options.additionalColumns ?? []), 'search_text TEXT'],
    pgvector: true,
    vectorDims: numDimensions,
  })

  let semanticFailure: Error | undefined
  let semanticFailureReported = false

  const vectorize = async (text: string) => {
    if (semanticFailure) throw semanticFailure
    const worker = useNlpWorker()
    try {
      if (vectorizer === 'transformer-minilm') return await worker.vectorizeText(text, modelName)
      const embedding = worker.vectorizeStaticText(text, modelName)
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          embedding,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Static embedding model load timed out after 8 seconds.')),
              8_000,
            )
          }),
        ])
      } finally {
        if (timeout) clearTimeout(timeout)
      }
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new Error('Semantic vectorization failed.', { cause: error })
      semanticFailure = failure
      throw failure
    }
  }

  const reportSemanticFailure = (message: string, error: unknown) => {
    if (semanticFailureReported) return
    semanticFailureReported = true
    console.warn(message, error)
  }

  /**
   * Searches the vector store for entries most similar to the given search text.
   *
   * Performs a vector similarity search using the provided search text, returning the top-k closest matches.
   * Optionally filters results by label, allowed IDs, and additional JSONB filters.
   *
   * @param searchText - The text to search for; will be vectorized and compared to stored vectors.
   * @param k - The maximum number of results to return.
   * @param label - (Optional) If provided, restricts results to entries with this label.
   * @param allowedIDs - (Optional) If provided, restricts results to entries whose IDs are in this list.
   * @param filters - (Optional) Additional JSONB key-value filters to apply to the data column.
   * @returns A promise resolving to an array of matching entries, each containing `id`, `label`, `data`, and `distance` (similarity score).
   *
   *
   *  TODO: we can possibly speed up this function by adding a GIN index:
   *       CREATE INDEX idx_${name}_data_gin ON ${name} USING gin (data)
   */
  const search = async (
    searchText: string,
    k: number,
    allowedIDs?: string[],
    filters?: PartialDeep<T>,
  ) => {
    let queryVector: number[] | undefined
    try {
      queryVector = await vectorize(searchText.slice(0, maxStrLength))
    } catch (error) {
      reportSemanticFailure('Semantic search unavailable; using lexical search.', error)
    }
    let sql = `SELECT id, data, search_text, vec::text AS vector FROM ${tableName}`
    const params: (string | number | string[])[] = []
    const whereClauses: string[] = []

    if (allowedIDs && allowedIDs.length > 0) {
      whereClauses.push(`id = ANY($${params.length + 1})`)
      params.push(allowedIDs)
    }

    // Single JSONB containment filter
    if (filters && Object.keys(filters).length) {
      whereClauses.push(`data @> $${params.length + 1}`)
      params.push(JSON.stringify(filters))
    }

    // Combine WHERE clauses
    if (whereClauses.length) {
      sql += `WHERE ${whereClauses.join(' AND ')}\n`
    }

    const results = await db.query<{
      id: string
      data: T
      search_text: string | null
      vector: string | null
    }>(`${sql};`, params)
    const parseVector = (value: string | null) =>
      value ? value.slice(1, -1).split(',').map(Number) : undefined
    return rankSearchDocuments({
      query: searchText,
      ...(queryVector ? { queryVector } : {}),
      documents: results.rows.map((row) => {
        const vector = parseVector(row.vector)
        return {
          id: row.id,
          text: row.search_text ?? JSON.stringify(row.data),
          ...(vector ? { vector } : {}),
        }
      }),
      limit: k,
    }).map(({ id, score }) => ({ id, distance: score > 0 ? 1 / score - 0.01 : 1_000_000 }))
  }

  const upsertVector = async (
    id: string,
    text: string,
    vector: readonly number[],
    saveData?: unknown,
  ) => {
    if (vector.length !== numDimensions) {
      throw new Error(`Expected ${numDimensions} vector dimensions, received ${vector.length}.`)
    }
    const formattedVector = `[${vector.join(',')}]`
    await db.query(
      `
      INSERT INTO ${tableName} (id, data, vec, search_text)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id) DO UPDATE SET
      data = EXCLUDED.data,
      vec = EXCLUDED.vec,
      search_text = EXCLUDED.search_text;
    `,
      [id, saveData ?? '', formattedVector, text.slice(0, maxStrLength)],
    )
  }

  const upsert = async (id: string, text: string, saveData?: unknown) => {
    let vector: number[]
    try {
      vector = await vectorize(text.slice(0, maxStrLength))
    } catch (error) {
      reportSemanticFailure('Vectorization failed; storing lexical-only search records.', error)
      vector = Array.from({ length: numDimensions }, () => 0)
    }
    await upsertVector(id, text, vector, saveData)
  }

  const upsertManyDocuments = async (
    documents: readonly {
      id: string
      text: string
      vector?: readonly number[]
      data?: unknown
    }[],
  ) => {
    if (documents.length === 0) return
    const rows = []
    for (const document of documents) {
      let vector = document.vector
      if (!vector) {
        try {
          vector = await vectorize(document.text.slice(0, maxStrLength))
        } catch (error) {
          reportSemanticFailure('Vectorization failed; storing lexical-only search records.', error)
          vector = Array.from({ length: numDimensions }, () => 0)
        }
      }
      if (vector.length !== numDimensions) {
        throw new Error(`Expected ${numDimensions} vector dimensions, received ${vector.length}.`)
      }
      rows.push({
        id: document.id,
        data: document.data ?? '',
        search_text: document.text.slice(0, maxStrLength),
        vector: `[${vector.join(',')}]`,
      })
    }
    await db.query(
      `WITH src AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb)
          AS t(id VARCHAR(64), data JSONB, search_text TEXT, vector TEXT)
      )
      INSERT INTO ${tableName} (id, data, search_text, vec)
      SELECT id, data, search_text, vector::vector FROM src
      ON CONFLICT (id) DO UPDATE SET
        data = EXCLUDED.data,
        search_text = EXCLUDED.search_text,
        vec = EXCLUDED.vec;`,
      [JSON.stringify(rows)],
    )
  }

  const listSearchDocuments = async () => {
    const result = await db.query<{
      id: string
      data: T
      search_text: string | null
      vector: string | null
    }>(`SELECT id, data, search_text, vec::text AS vector FROM ${tableName};`)
    const parseVector = (value: string | null) =>
      value ? value.slice(1, -1).split(',').map(Number) : undefined
    return result.rows.map((row) => ({
      id: row.id,
      data: row.data,
      text: row.search_text ?? JSON.stringify(row.data),
      vector: parseVector(row.vector),
    }))
  }

  const count = async (): Promise<number> => {
    const result = await db.query<{ count: number }>(`SELECT COUNT(*) AS count FROM ${tableName};`)
    return result.rows[0]!.count
  }

  // we are overwriting the crudTables upsert operation hre...
  return {
    ...crudTable,
    search,
    upsert,
    upsertVector,
    upsertManyDocuments,
    listSearchDocuments,
    count,
    ...createFind<T>(db, dataColumn, idColumn, tableName),
  }
}

export const createMapCrudWrapper = <T>(storage: Map<string | number, T>): CrudWrapper<T> => {
  const get = (id: string | number): Promise<T | null> => {
    return Promise.resolve(storage.has(id) ? storage.get(id)! : null)
  }
  const list = (): Promise<Row<T>[]> => {
    const rows: Row<T>[] = []
    storage.forEach((value, key) => {
      rows.push({ id: key, data: value })
    })
    return Promise.resolve(rows)
  }
  return {
    get,
    set: (id: string | number, data: T): Promise<void> => {
      storage.set(id, data)
      return Promise.resolve()
    },
    upsert: async (id, data, strategy = 'replace') => {
      const oldData = await get(id)
      let newData: T

      if (oldData) {
        if (strategy === 'shallow_merge' || strategy === 'native_shallow') {
          newData = { ...oldData, ...data }
        } else if (strategy === 'deepmerge') {
          newData = deepMerge(oldData, data, 'overwrite')
        } else {
          newData = data
        }
        storage.set(id, newData)
      } else {
        newData = data
        storage.set(id, newData)
      }

      return newData
    },
    delete: (id: string | number): Promise<void> => {
      storage.delete(id)
      return Promise.resolve()
    },
    list,
    listAll: list,
    listIds: (): Promise<(string | number)[]> => {
      return Promise.resolve(Array.from(storage.keys()))
    },
    clear: (): Promise<void> => {
      storage.clear()
      return Promise.resolve()
    },
  }
}

/**
 * Uses the first wrapper as the live working set and the remaining wrappers as replicas.
 * Explicit mutations emit after the first wrapper changes; fallback reads hydrate it silently.
 */
export const createCombinedCrudWrapper = <T>(wrappers: CrudWrapper<T>[]): LiveCrudWrapper<T> => {
  const primary = wrappers[0]!
  const replicas = wrappers.slice(1)
  const { stream: liveStream, emit } = createStream<StreamData<T>>()

  const restorePrimary = async (id: string | number, previous: T | null) => {
    if (previous === null) await primary.delete(id)
    else await primary.set(id, previous)
    emit({ id, data: previous })
  }

  const persistOrRestore = async (
    id: string | number,
    previous: T | null,
    persist: () => Promise<unknown>,
  ) => {
    try {
      await persist()
    } catch (error) {
      await restorePrimary(id, previous)
      throw error
    }
  }

  const combined: CrudWrapper<T> = {
    async set(id, data) {
      const previous = await primary.get(id)
      await primary.set(id, data)
      emit({ id, data })
      await persistOrRestore(id, previous, () => Promise.all(replicas.map((w) => w.set(id, data))))
    },
    async get(id) {
      for (const [index, wrapper] of wrappers.entries()) {
        const data = await wrapper.get(id)
        if (data === null) continue
        if (index > 0) await primary.set(id, data)
        return data
      }
      return null
    },
    async upsert(id, data, strategy) {
      const previous = await primary.get(id)
      const updatedData = await primary.upsert(id, data, strategy)
      emit({ id, data: updatedData })
      await persistOrRestore(id, previous, () =>
        Promise.all(replicas.map((w) => w.set(id, updatedData))),
      )
      return updatedData
    },
    async delete(id) {
      const previous = await primary.get(id)
      await primary.delete(id)
      emit({ id, data: null })
      await persistOrRestore(id, previous, () => Promise.all(replicas.map((w) => w.delete(id))))
    },
    async list() {
      for (const wrapper of wrappers) {
        const list = await wrapper.list()
        if (list.length > 0) return list
      }
      return []
    },
    async listAll() {
      const allItems = await Promise.all(wrappers.map((w) => w.list()))
      const uniqueItems = new Map<string | number, Row<T>>()
      for (const item of allItems.flat()) uniqueItems.set(item.id, item)
      return Array.from(uniqueItems.values())
    },
    async listIds() {
      const allIdArrays = await Promise.all(wrappers.map((w) => w.listIds()))
      return Array.from(new Set(allIdArrays.flat()))
    },
    async clear() {
      await Promise.all(wrappers.map((w) => w.clear()))
    },
  }

  return {
    ...combined,
    readLive: (id) => liveStream.filter((event) => event.id === id),
    liveStream,
  }
}

/**
 * Wraps a CRUD interface to transparently encrypt and decrypt data rows.
 *
 * @param {CrudWrapper<EncryptedDataRow>} base - The base CRUD interface for storing encrypted rows.
 * @param {() => Promise<CryptoKey>} publicRecoveryKey - Async function returning the public key for recovery encryption.
 * @param {() => Promise<CryptoKey>} getSessionKey - Async function returning the session key for symmetric encryption.
 * @returns {CrudWrapper<unknown>} A CRUD interface that encrypts on set and decrypts on get.
 */
// TODO: also encrypt the ids!!
// —————— Overload #1: no getSessionKey ⇒ askSession **required** ——————

export function withEncryption(
  base: CrudWrapper<EncryptedDataRow>,
  getSessionKey: AskCryptoKey,
  publicRecoveryKey?: AskCryptoKey,
) {
  return {
    ...base,
    async set(id: string | number, data: unknown): Promise<void> {
      const encData = await encryptDataFile(
        // we need to make this more efficient!   JSON.stringify is not always the best option...
        new TextEncoder().encode(JSON.stringify(data)),
        id, // we need the id in order to derive the key
        publicRecoveryKey,
        getSessionKey, // we can do this, because we chec this earlier...
      )
      // Store the encrypted data row
      await base.set(id, encData)
    },

    async get(id: string | number): Promise<unknown> {
      // Retrieve the encrypted data row
      const encData = await base.get(id)
      if (!encData) return null

      const data = await decryptDataFile(encData, id, getSessionKey)

      const result = JSON.parse(new TextDecoder().decode(data))

      return result
    },
  }
}

/**
 * Wraps a CRUD interface to provide secret storage, with optional encryption.
 *
 * @param {CrudWrapper<EncryptedDataRow | Record<string, string>>} base - The base CRUD interface.
 * @param {() => Promise<CryptoKey>} publicRecoveryKey - Async function returning the public key for recovery encryption.
 * @param {Object} [options] - Optional settings.
 * @param {boolean} [options.encryption=true] - Whether to enable encryption for stored secrets.
 * @returns {Object} An interface for managing secrets (set, get, delete, list, clear), and a stream for requests.
 */
export const withSecretStore = (
  base: CrudWrapper<EncryptedDataRow>,
  publicRecoveryKey: (() => Promise<CryptoKey> | CryptoKey) | undefined,
  askSessionKey: AskCryptoKey,
  askTimeoutMs = 100000,
) => {
  const { emitFunc: getNewKey, stream: askNewKeyStream } = streamProcedureCall<
    [{ id: string | number; secretName: string; message?: string | undefined }],
    string
  >(askTimeoutMs)

  const encryptedCrud = withEncryption(base, askSessionKey, publicRecoveryKey)
  type SecretData = Record<string, string>
  const readSecretData = async (id: string | number): Promise<SecretData> => {
    try {
      return ((await encryptedCrud.get(id)) as SecretData) || {}
    } catch (error) {
      console.warn('failed to decrypt secret row; treating it as empty', {
        id,
        error: error instanceof Error ? error.message : String(error),
      })
      return {}
    }
  }

  /**
   * Stores or updates a secret for a given ID and secret name.
   */
  const setSecret = async (
    id: string | number,
    secretName: string,
    secretData: string,
  ): Promise<void> => {
    console.log('set new secret:', id, secretName)
    // Get the existing secrets for the ID
    const existingSecrets = await readSecretData(id)
    // Add or update the secret
    existingSecrets[secretName] = secretData
    // Save the updated secrets
    await encryptedCrud.set(id, existingSecrets)
  }

  return {
    setSecret,

    /**
     * Retrieves a secret by ID and secret name. If not found, requests a new secret.
     */
    async getSecret(
      id: string | number,
      secretName: string,
      // if we want to send a message along with asking for a new password, use a string!
      askNew: boolean | string,
      saveNew = true,
      // TODO: if we would like to ask for a new secret no matter what...
      // forceNew: boolean,
    ): Promise<string | null> {
      // Get the existing secrets for the ID
      const existingSecrets = await readSecretData(id)
      // Return the specific secret if it exists
      let secret = existingSecrets ? existingSecrets[secretName] || null : null

      if (!secret && askNew) {
        const message = typeof askNew === 'string' ? askNew : undefined
        secret = await getNewKey({ id, secretName, message })
        console.log('received new secret:', id, secretName)
        if (saveNew) await setSecret(id, secretName, secret)
      }
      return secret
    },

    /**
     * Deletes a secret by ID and secret name.
     */
    async deleteSecret(id: string | number, secretName: string): Promise<void> {
      // Get the existing secrets for the ID
      const existingSecrets = await readSecretData(id)
      if (secretName in existingSecrets) {
        // Delete the specific secret
        delete existingSecrets[secretName]
        // Save the updated secrets
        await encryptedCrud.set(id, existingSecrets)
        if (Object.keys(existingSecrets).length == 0) {
          await encryptedCrud.delete(id)
        }
      }
    },

    // delete all secrets with id
    async deleteAllFromId(id: string) {
      await encryptedCrud.delete(id)
    },

    /**
     * Lists all secrets for a given ID.
     */
    async listSecrets(id: string | number): Promise<Record<string, string>> {
      // Get all secrets for the ID
      return await readSecretData(id)
    },

    listSecretIds: async (): Promise<(string | number)[]> => {
      return base.listIds()
    },

    /**
     * Clears all stored secrets.
     */
    async clear(): Promise<void> {
      await encryptedCrud.clear()
    },

    onAskNewSecret: (...args: Parameters<typeof askNewKeyStream>) => askNewKeyStream(...args),
  }
}

export type SecretStore = ReturnType<typeof withSecretStore>
