import type { AskCryptoKey, EncryptedDataRow, TaskNode } from '@taskyon/taskyon'
import { decryptDataFile, encryptDataFile } from '@taskyon/taskyon'
import type { PartialDeep } from 'type-fest'
import type { Stream } from './frpBus'
import { createStream, filter, streamProcedureCall } from './frpBus'
import type { PgLiteOptions } from './pglite.api'
import { createVecPgLiteTable, type TyPGDB } from './pglite.api'
import { useNlpWorker } from './taskyon/webWorkerApi'
import { deepMerge } from './utils'

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

/**
 * Enhances a CrudWrapper with live streaming capabilities for CRUD events.
 *
 * This wrapper emits live updates via streams whenever data is set, upserted, or deleted.
 *
 * Streaming data format:
 * - On `set` or `upsert`: emits `{ id, data }` where `data` is the new or updated value.
 * - On `delete`: emits `{ id, data: null }` to indicate removal.
 *
 * @template T - The type of data managed by the CRUD wrapper.
 * @param base - The base CrudWrapper to enhance.
 * @returns The enhanced CrudWrapper with:
 *   - `readLive(id, emitCurrent?)`: Subscribes to live updates for a specific item. Optionally emits the current value immediately.
 *   - `liveStream`: Subscribes to all live CRUD events as `{ id, data }` objects.
 */
export const withLiveStreams = <T>(
  base: CrudWrapper<T>,
): CrudWrapper<T> & {
  readLive: (id: string | number) => Stream<{ id: string | number; data: T | null }>
  liveStream: Stream<{ id: string | number; data: T | null }>
} => {
  // Create a stream of events with a payload: { id, data }
  const { stream: liveStream, emit } = createStream<{ id: string | number; data: T | null }>()

  return {
    ...base,
    async set(id, data) {
      await base.set(id, data)
      emit({ id, data })
    },
    async upsert(id, data, strategy = 'replace') {
      const updatedData = await base.upsert(id, data, strategy)
      emit({ id, data: updatedData })
      return updatedData
    },
    async delete(id) {
      await base.delete(id)
      // Optionally, you might emit a deletion event if needed.
      emit({ id, data: null })
    },
    async clear() {
      await base.clear()
      // Optionally, you could notify subscribers here if desired.
    },
    readLive: (id: string | number, emitCurrent: boolean = true) => {
      const liveForId = filter(liveStream, (event) => event.id === id)
      if (emitCurrent) {
        return {
          subscribe(observer) {
            // Immediately subscribe to the live stream
            const unsubLive = liveForId.subscribe(observer)
            let cancelled = false
            // Asynchronously fetch the current value and emit when ready
            void base.get(id).then((current) => {
              if (!cancelled) {
                //console.log('emitting current', current)
                void observer({ id, data: current })
              }
            })
            return () => {
              cancelled = true
              unsubLive()
            }
          },
        }
      }
      return liveForId
    },
    liveStream,
  }
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
  additionalColumns?: string[],
) => {
  const { vectorizeText } = useNlpWorker()
  const numDimensions = 384
  const maxStrLength = 10000 // only vectorize approx. the first page.
  const dataColumn = 'data'
  const idColumn = 'id'
  const crudTable = await createPgLiteCrudWrapper<T>(db, {
    tableName: name,
    idColumn,
    dataColumn,
    additionalColumns: additionalColumns ?? [],
    pgvector: true,
    vectorDims: numDimensions,
  })

  const modelName = 'xyntopia/all-MiniLM-L6-v2'

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
    filters?: PartialDeep<TaskNode>,
  ) => {
    console.log(`Searching for ${searchText.slice(0, maxStrLength)}`)
    const searchVector = await vectorizeText(searchText.slice(0, maxStrLength), modelName)
    const formattedVector = `[${searchVector.join(',')}]` // Format the array as a string for pgvector
    let sql = `
      SELECT
      id,
      vec <-> $1 AS distance
      FROM ${name}
    `
    const params: (string | number | string[])[] = [formattedVector, k]
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

    sql += `ORDER BY distance LIMIT $2;`

    const results = await db.query<Row<string>>(sql, params)

    return results.rows as unknown as {
      id: string
      distance: number
    }[]
  }

  const upsert = async (id: string, text: string, saveData?: unknown) => {
    const vector = await vectorizeText(text.slice(0, maxStrLength), modelName)
    const formattedVector = `[${vector.join(',')}]` // Format the array as a string for pgvector
    await db.query(
      `
      INSERT INTO ${name} (id, data, vec)
      VALUES ($1, $2, $3)
      ON CONFLICT (id) DO UPDATE SET
      ${saveData ? 'data = EXCLUDED.data,' : ''}
      vec = EXCLUDED.vec;
    `,
      [id, saveData || '', formattedVector],
    )
  }

  const count = async (): Promise<number> => {
    const result = await db.query<{ count: number }>(`SELECT COUNT(*) AS count FROM ${name};`)
    return result.rows[0]!.count
  }

  // we are overwriting the crudTables upsert operation hre...
  return {
    ...crudTable,
    search,
    upsert,
    count,
    ...createFind<T>(db, dataColumn, idColumn, name),
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

export const createCombinedCrudWrapper = <T>(wrappers: CrudWrapper<T>[]): CrudWrapper<T> => ({
  async set(id: string | number, data: T): Promise<void> {
    await Promise.all(wrappers.map((w) => w.set(id, data)))
  },

  async get(id: string | number): Promise<T | null> {
    for (let i = 0; i < wrappers.length; i++) {
      const data = await wrappers[i]!.get(id)
      if (data !== null) {
        // If the first wrapper doesn't have the data, update it with the found data
        if (i > 0) {
          await wrappers[0]!.set(id, data)
        }
        return data
      }
    }
    return null
  },

  async upsert(id, data, strategy) {
    // we are using the first wrapper to upsert the data
    // and then we are updating the other wrappers with the new data
    // this is important, because otherwise we could end up with inconsistent data
    const updatedData = await wrappers[0]!.upsert(id, data, strategy)
    await Promise.all(wrappers.slice(1).map((w) => w.set(id, updatedData)))
    return updatedData
  },

  async delete(id: string | number): Promise<void> {
    await Promise.all(wrappers.map((w) => w.delete(id)))
  },

  async list(): Promise<Row<T>[]> {
    // Get list from the first wrapper only
    for (const wrapper of wrappers) {
      const list = await wrapper.list()
      if (list.length > 0) return list
    }

    return []
  },
  async listAll(): Promise<Row<T>[]> {
    const allItems = await Promise.all(wrappers.map((w) => w.list()))
    const uniqueItems = new Map<string | number, Row<T>>()

    allItems.flat().forEach((item) => {
      uniqueItems.set(item.id, item)
    })

    return Array.from(uniqueItems.values())
  },
  listIds: async (): Promise<(string | number)[]> => {
    const allIdArrays = await Promise.all(wrappers.map((w) => w.listIds()))
    const idSet = new Set<string | number>()
    allIdArrays.flat().forEach((id) => idSet.add(id))
    return Array.from(idSet)
  },
  async clear(): Promise<void> {
    await Promise.all(wrappers.map((w) => w.clear()))
  },
})

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
  publicRecoveryKey: AskCryptoKey,
  getSessionKey?: AskCryptoKey,
) {
  return {
    ...base,
    async set(id: string | number, data: unknown, askSession?: AskCryptoKey): Promise<void> {
      if (!askSession && !getSessionKey) {
        throw new Error('No session key provider (askSession or getSessionKey) was provided.')
      }

      const encData = await encryptDataFile(
        // we need to make this more efficient!   JSON.stringify is not always the best option...
        new TextEncoder().encode(JSON.stringify(data)),
        id, // we need the id in order to derive the key
        publicRecoveryKey,
        askSession ?? getSessionKey!, // we can do this, because we chec this earlier...
      )
      // Store the encrypted data row
      await base.set(id, encData)
    },

    async get(id: string | number, askSession?: AskCryptoKey): Promise<unknown> {
      // Retrieve the encrypted data row
      const encData = await base.get(id)
      if (!encData) return null

      if (!askSession && !getSessionKey) {
        throw new Error('No session key provider (askSession or getSessionKey) was provided.')
      }

      const data = await decryptDataFile(encData, id, askSession ?? getSessionKey!)

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
  publicRecoveryKey: () => Promise<CryptoKey> | CryptoKey,
  askTimeoutMs = 100000,
) => {
  const { emitFunc: getSessionKey, stream: askSessionKeyStream } = streamProcedureCall<
    [],
    CryptoKey
  >(askTimeoutMs)
  const { emitFunc: getNewKey, stream: askNewKeyStream } = streamProcedureCall<
    [{ id: string | number; secretName: string; message?: string | undefined }],
    string
  >(askTimeoutMs)

  const encryptedCrud = withEncryption(base, publicRecoveryKey, getSessionKey)
  type SecretData = Record<string, string>
  return {
    /**
     * Stores or updates a secret for a given ID and secret name.
     */
    async setSecret(id: string | number, secretName: string, secretData: string): Promise<void> {
      // Get the existing secrets for the ID
      const existingSecrets: SecretData =
        ((await encryptedCrud.get(id, getSessionKey)) as SecretData) || {}
      // Add or update the secret
      existingSecrets[secretName] = secretData
      // Save the updated secretss
      await encryptedCrud.set(id, existingSecrets, getSessionKey)
    },

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
      const existingSecrets = (await encryptedCrud.get(id, getSessionKey)) as SecretData
      // Return the specific secret if it exists
      let secret = existingSecrets ? existingSecrets[secretName] || null : null

      if (!secret && askNew) {
        const message = typeof askNew === 'string' ? askNew : undefined
        secret = await getNewKey({ id, secretName, message })
        console.log('received new secret:', id, secretName)
        if (saveNew) await this.setSecret(id, secretName, secret)
      }
      return secret
    },

    /**
     * Deletes a secret by ID and secret name.
     */
    async deleteSecret(id: string | number, secretName: string): Promise<void> {
      // Get the existing secrets for the ID
      const existingSecrets = (await encryptedCrud.get(id, getSessionKey)) as SecretData
      if (existingSecrets && secretName in existingSecrets) {
        // Delete the specific secret
        delete existingSecrets[secretName]
        // Save the updated secrets
        await encryptedCrud.set(id, existingSecrets, getSessionKey)
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
      return ((await encryptedCrud.get(id, getSessionKey)) as SecretData) || {}
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

    onSessionKey: (...args: Parameters<typeof askSessionKeyStream.subscribe>) =>
      askSessionKeyStream.subscribe(...args),
    onNewSecret: (...args: Parameters<typeof askNewKeyStream.subscribe>) =>
      askNewKeyStream.subscribe(...args),
  }
}

export type SecretStore = ReturnType<typeof withSecretStore>
