import {
  decryptData,
  decryptWithSessionKey,
  encryptObject,
  wrapKeyWithPublicKey,
  encryptWithSessionKey,
  generateRandomEncryptionKey,
} from './crypto_webcrypto'
import type { Stream } from './frpBus'
import { createStream, filter } from './frpBus'
import type { PgLiteOptions } from './pglite.api'
import { createVecPgLiteTable, type TyPGDB } from './pglite.api'
import { useNlpWorker } from './taskyon/webWorkerApi'
import { deepMerge, lockMap } from './utils'

type Row<T> = {
  [key: string]: unknown
  id: string | number
  data: T
}

export interface CrudWrapper<T> {
  set: (id: string | number, data: T) => Promise<void>
  get: (id: string | number) => Promise<T | null>
  // TODO: the "upsert" strategy is potentially problematic, because
  //       it leads to inconsistent results across different storages.
  //       so it would probably be a good idea to only use this in the "combined"
  //       storage
  upsert: (
    id: string | number,
    data: T,
    strategy?: 'shallow_merge' | 'replace' | 'deepmerge' | 'native_shallow',
  ) => Promise<T>
  delete: (id: string | number) => Promise<void>
  list: () => Promise<Row<T>[]>
  listAll?: () => Promise<Row<T>[]>
  clear: () => Promise<void>
}

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
                observer({ id, data: current })
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
    async clear() {
      await base.clear()
      // Optionally, you could notify subscribers here if desired.
    },
    liveStream,
  }
}

const withLock =
  (lockItem: ReturnType<typeof lockMap>['lockItem']) =>
  async <T extends (...args: Parameters<T>) => ReturnType<T>>(
    func: T,
    id: string | number,
    args: Parameters<T>,
  ) => {
    const unlock = await lockItem(id)
    let result: ReturnType<T> | undefined
    try {
      result = func(...args)
    } finally {
      unlock()
    }
    return result
  }

export const withLocking = <T, U>(base: CrudWrapper<U> & T, namespace: string = 'task') => {
  const { lockItem, clearLocks } = lockMap(namespace)

  const locking = withLock(lockItem)

  return {
    ...base,
    set: async (...args: Parameters<CrudWrapper<U>['set']>) =>
      await locking(base.set, args[0], args),
    delete: async (...args: Parameters<CrudWrapper<U>['delete']>) =>
      await locking(base.delete, args[0], args),
    get: async (...args: Parameters<CrudWrapper<U>['get']>) =>
      await locking(base.get, args[0], args),
    upsert: async (...args: Parameters<CrudWrapper<U>['upsert']>) =>
      await locking(base.upsert, args[0], args),
    clear: async () => {
      await base.clear()
      clearLocks()
    },
  }
}

export const createPgLiteCrudWrapper = async <T>(
  db: TyPGDB,
  options: PgLiteOptions,
): Promise<CrudWrapper<T>> => {
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
    list: async (): Promise<Row<T>[]> => {
      await db.waitReady
      const result = await db.sql<Row<T>>`SELECT ${idColumn}, ${dataColumn} FROM ${tableName};`
      return result.rows
    },
    clear: async (): Promise<void> => {
      await db.waitReady
      await db.query(`DELETE FROM ${tableName};`)
    },
  }
}

// TODO: option to create indices on specific data properties to speed up filtering...
export const createVectorStore = async (db: TyPGDB, name: string, additionalColumns?: string[]) => {
  const { vectorizeText } = useNlpWorker()
  const numDimensions = 384
  const maxStrLength = 10000 // only vectorize approx. the first page.
  const crudTable = await createPgLiteCrudWrapper<string>(db, {
    tableName: name,
    idColumn: 'id',
    dataColumn: 'data',
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
    filters?: Record<string, unknown>,
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
  return { ...crudTable, search, upsert, count }
}

export const createMapCrudWrapper = <T>(storage: Map<string | number, T>): CrudWrapper<T> => {
  const get = (id: string | number): Promise<T | null> => {
    return Promise.resolve(storage.has(id) ? storage.get(id)! : null)
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
    list: (): Promise<Row<T>[]> => {
      const rows: Row<T>[] = []
      storage.forEach((value, key) => {
        rows.push({ id: key, data: value })
      })
      return Promise.resolve(rows)
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
  async clear(): Promise<void> {
    await Promise.all(wrappers.map((w) => w.clear()))
  },
})

// Define a type for the encrypted data structure
export type EncryptedDataRow = {
  iv: string
  ciphertext: string
  salt: string
  encryptedToolKey: string
  recoveryEncryptedToolKey: string
}

type AskSession = () => Promise<CryptoKey>
type AskNewSecret = (id: string | number, name: string) => Promise<string>

type EncryptedCrudWrapper<GetSK extends boolean> = Omit<
  CrudWrapper<EncryptedDataRow>,
  'set' | 'get'
> & {
  set: GetSK extends true
    ? (id: string | number, data: unknown, askSession?: AskSession) => Promise<void>
    : (id: string | number, data: unknown, askSession: AskSession) => Promise<void>
  get: GetSK extends true
    ? (id: string | number, askSession?: AskSession) => Promise<unknown>
    : (id: string | number, askSession: AskSession) => Promise<unknown>
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
  publicRecoveryKey: () => Promise<CryptoKey>,
): EncryptedCrudWrapper<false>

// —————— Overload #2: with getSessionKey ⇒ askSession **optional** ——————
export function withEncryption(
  base: CrudWrapper<EncryptedDataRow>,
  publicRecoveryKey: () => Promise<CryptoKey>,
  getSessionKey: () => Promise<CryptoKey>,
): EncryptedCrudWrapper<true>

export function withEncryption(
  base: CrudWrapper<EncryptedDataRow>,
  publicRecoveryKey: () => Promise<CryptoKey>,
  getSessionKey?: () => Promise<CryptoKey>,
) {
  return {
    ...base,
    async set(id: string | number, data: unknown, askSession?: AskSession): Promise<void> {
      // Generate a new random tool key for each set operation
      // we need the key to be extractable, so that we can encrypt it !
      const rowKey = await generateRandomEncryptionKey(true)

      // Encrypt the data using the tool key
      const { iv, ciphertext, salt } = await encryptObject(rowKey, data, id)

      // Encrypt the tool key using the recovery public key
      const recoveryEncryptedToolKey = await wrapKeyWithPublicKey(await publicRecoveryKey(), rowKey)

      if (!askSession && !getSessionKey) {
        throw new Error('No session key provider (askSession or getSessionKey) was provided.')
      }
      const sessionKey = await (askSession ?? getSessionKey!)()
      // Encrypt the tool key using the symmetric session key
      const encryptedToolKey = await encryptWithSessionKey(sessionKey, rowKey)

      // Create the encrypted data row
      const encData: EncryptedDataRow = {
        iv,
        ciphertext,
        salt,
        encryptedToolKey,
        recoveryEncryptedToolKey,
      }

      // Store the encrypted data row
      await base.set(id, encData)
    },

    async get(id: string | number, askSession?: AskSession): Promise<unknown> {
      // Retrieve the encrypted data row
      const encData = await base.get(id)
      if (!encData) return null

      if (!askSession && !getSessionKey) {
        throw new Error('No session key provider (askSession or getSessionKey) was provided.')
      }
      const sessionKey = await (askSession ?? getSessionKey!)()
      // Decrypt the tool key using the symmetric session key
      const rowKey = await decryptWithSessionKey(sessionKey, encData.encryptedToolKey)

      // Decrypt the data using the tool key
      const data = await decryptData(rowKey, encData.iv, encData.ciphertext, encData.salt, id)

      return data
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
  publicRecoveryKey?: () => Promise<CryptoKey>,
  options?: { encryption?: boolean },
) => {
  // Decide whether to use encryption or not
  const useEncryption = options?.encryption !== false

  const effectivePublicRecoveryKey =
    publicRecoveryKey ??
    (async () => {
      // Generate a temporary RSA key pair for fallback
      const keyPair = await window.crypto.subtle.generateKey(
        {
          name: 'RSA-OAEP',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt'],
      )
      return keyPair.publicKey
    })
  // Provide a default session key if encryption is enabled and none is supplied
  const defaultSessionKey = async () => {
    // AES-GCM 256-bit key, extractable for demo purposes
    return window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
      'encrypt',
      'decrypt',
    ])
  }

  const encryptedCrud = useEncryption
    ? withEncryption(base, effectivePublicRecoveryKey, defaultSessionKey)
    : withEncryption(base, effectivePublicRecoveryKey)

  type SecretData = Record<string, string>
  return {
    /**
     * Stores or updates a secret for a given ID and secret name.
     */
    async setSecret(
      id: string | number,
      secretName: string,
      secretData: string,
      askSession: AskSession,
    ): Promise<void> {
      // Get the existing secrets for the ID
      const existingSecrets: SecretData =
        ((await encryptedCrud.get(id, askSession)) as SecretData) || {}
      // Add or update the secret
      existingSecrets[secretName] = secretData
      // Save the updated secrets
      await encryptedCrud.set(id, existingSecrets, askSession)
    },

    /**
     * Retrieves a secret by ID and secret name. If not found, requests a new secret.
     */
    async getSecret(
      id: string | number,
      secretName: string,
      askSession: AskSession,
      askNew?: AskNewSecret,
    ): Promise<string | null> {
      // Get the existing secrets for the ID
      const existingSecrets = (await encryptedCrud.get(id, askSession)) as SecretData
      // Return the specific secret if it exists
      let secret = existingSecrets ? existingSecrets[secretName] || null : null

      if (!secret && askNew) {
        secret = await askNew(id, secretName)
        console.log('received new secret:', id, secretName)
        await this.setSecret(id, secretName, secret, askSession)
      }
      return secret
    },

    /**
     * Deletes a secret by ID and secret name.
     */
    async deleteSecret(
      id: string | number,
      secretName: string,
      askSession: AskSession,
    ): Promise<void> {
      // Get the existing secrets for the ID
      const existingSecrets = (await encryptedCrud.get(id, askSession)) as SecretData
      if (existingSecrets && secretName in existingSecrets) {
        // Delete the specific secret
        delete existingSecrets[secretName]
        // Save the updated secrets
        await encryptedCrud.set(id, existingSecrets, askSession)
      }
    },

    /**
     * Lists all secrets for a given ID.
     */
    async listSecrets(
      id: string | number,
      askSession: AskSession,
    ): Promise<Record<string, string>> {
      // Get all secrets for the ID
      return ((await encryptedCrud.get(id, askSession)) as SecretData) || {}
    },

    /**
     * Clears all stored secrets.
     */
    async clear(): Promise<void> {
      await encryptedCrud.clear()
    },
  }
}

export type SecretStore = ReturnType<typeof withSecretStore>

export const createEnhancedCrudWrapper = async <T>(
  db: TyPGDB,
  options: PgLiteOptions,
  storage: Map<string | number, T>,
) => {
  const dbWrapper = await createPgLiteCrudWrapper<T>(db, options)
  const mapWrapper = createMapCrudWrapper<T>(storage)
  // we are using mapWrapper first, because it is the fastest
  const combinedWrapper = createCombinedCrudWrapper([mapWrapper, dbWrapper])
  const liveWrapper = withLiveStreams<T>(combinedWrapper)
  const lockedWrapper = withLocking(liveWrapper)

  return lockedWrapper
}

export type EnhancedCrudWrapper<T> = Awaited<ReturnType<typeof createEnhancedCrudWrapper<T>>>
