import {
  decryptData,
  decryptWithSessionKey,
  encryptObject,
  wrapKeyWithPublicKey,
  encryptWithSessionKey,
  generateRandomEncryptionKey,
  sha256UrlSafeHash,
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
    const result = await db.query<Row<T>>(
      `SELECT ${dataColumn} FROM ${tableName}
       WHERE ${idColumn} = $1;`,
      [id],
    )
    return result.rows.length ? result.rows[0]!.data : null
  }

  return {
    set: async (id: string | number, data: T) => {
      await db.query(
        `INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
         VALUES ($1, $2)
         ON CONFLICT (${idColumn}) DO UPDATE SET ${dataColumn} = $2;`,
        [id, JSON.stringify(data)],
      )
    },
    get,
    upsert: async (id, data, strategy = 'replace') => {
      // important: this function usually also requires the "withLocking" wrapper
      // in order to avoid race conditions
      let newData: T
      if (strategy === 'native_shallow' || strategy === 'shallow_merge') {
        await db.query(
          `INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
           VALUES ($1, $2)
           ON CONFLICT (${idColumn})
           DO UPDATE SET ${dataColumn} = jsonb_set(${tableName}."${dataColumn}", '{}', EXCLUDED."${dataColumn}");`,
          [id, JSON.stringify(data)],
        )
        newData = (await get(id)) ?? data
      } else {
        // Fetch and merge in JS only if necessary
        const existingData = strategy === 'replace' ? {} : await get(id)
        newData =
          strategy === 'deepmerge'
            ? deepMerge(existingData, data, 'overwrite')
            : { ...existingData, ...data }

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
      await db.query(`DELETE FROM ${tableName} WHERE ${idColumn} = $1;`, [id])
    },
    list: async (): Promise<Row<T>[]> => {
      const result = await db.sql<Row<T>>`SELECT ${idColumn}, ${dataColumn} FROM ${tableName};`
      return result.rows
    },
    clear: async (): Promise<void> => {
      await db.query(`DELETE FROM ${tableName};`)
    },
  }
}

export const createVectorStore = async (db: TyPGDB, name: string) => {
  const { vectorizeText } = useNlpWorker()
  const numDimensions = 384
  const crudTable = await createPgLiteCrudWrapper<string>(db, {
    tableName: name,
    idColumn: 'id',
    dataColumn: 'data',
    additionalColumns: ['label TEXT'],
    pgvector: true,
    vectorDims: numDimensions,
  })

  const modelName = 'xyntopia/all-MiniLM-L6-v2'

  const search = async (searchText: string, k: number, label?: string, allowedIDs?: string[]) => {
    console.log(`Searching for ${searchText}`)
    const searchVector = await vectorizeText(searchText, modelName)
    const formattedVector = `[${searchVector.join(',')}]` // Format the array as a string for pgvector

    let sqlQuery = `
      SELECT
      id,
      label,
      data,
      vec <-> $1 AS distance
      FROM ${name}
    `
    const queryParams: (string | number | string[])[] = [formattedVector, k]

    if (label) {
      sqlQuery += `WHERE label = $3 `
      queryParams.push(label)
    }

    if (allowedIDs && allowedIDs.length > 0) {
      sqlQuery += `${label ? 'AND' : 'WHERE'} id = ANY($${queryParams.length + 1}) `
      queryParams.push(allowedIDs)
    }

    sqlQuery += `ORDER BY distance LIMIT $2;`

    const results = await db.query<Row<string>>(sqlQuery, queryParams)

    return results.rows as unknown as {
      id: string
      label: string
      data: string
      distance: number
    }[]
  }

  const upsert = async (text: string, label?: string, saveText = true) => {
    const vector = await vectorizeText(text, modelName)
    const formattedVector = `[${vector.join(',')}]` // Format the array as a string for pgvector
    const id = await sha256UrlSafeHash(text)
    await db.query(
      `
      INSERT INTO ${name} (id, label, ${saveText ? 'data,' : ''} vec)
      VALUES ($1, $2, ${saveText ? '$3,' : ''} $4)
      ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      ${saveText ? 'data = EXCLUDED.data,' : ''}
      vec = EXCLUDED.vec;
    `,
      saveText ? [id, label, JSON.stringify(text), formattedVector] : [id, label, formattedVector],
    )
  }

  return { ...crudTable, search, upsert }
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

export const withEncryption = (
  base: CrudWrapper<EncryptedDataRow>,
  publicRecoveryKey: () => Promise<CryptoKey>,
  getSessionKey: () => Promise<CryptoKey>,
) => {
  return {
    ...base,
    async set(id: string | number, data: unknown): Promise<void> {
      // Generate a new random tool key for each set operation
      // we need the key to be extractable, so that we can encrypt it !
      const rowKey = await generateRandomEncryptionKey(true)

      // Encrypt the data using the tool key
      const { iv, ciphertext, salt } = await encryptObject(rowKey, data, id)

      // Encrypt the tool key using the recovery public key
      const recoveryEncryptedToolKey = await wrapKeyWithPublicKey(await publicRecoveryKey(), rowKey)

      const sessionKey = await getSessionKey()
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

    async get(id: string | number): Promise<unknown> {
      // Retrieve the encrypted data row
      const encData = await base.get(id)
      if (!encData) return null

      const sessionKey = await getSessionKey()
      // Decrypt the tool key using the symmetric session key
      const rowKey = await decryptWithSessionKey(sessionKey, encData.encryptedToolKey)

      // Decrypt the data using the tool key
      const data = await decryptData(rowKey, encData.iv, encData.ciphertext, encData.salt, id)

      return data
    },
  }
}

export const withSecretStore = (
  base: CrudWrapper<EncryptedDataRow>,
  publicRecoveryKey: () => Promise<CryptoKey>,
) => {
  type NewSecretRequest = {
    type: 'newSecret'
    payload: { id: string | number; secretName: string }
    respond: (response: string) => void
  }

  type SessionKeyRequest = {
    type: 'sessionKey'
    payload: null
    respond: (response: CryptoKey) => void
  }

  type RequestInfo = NewSecretRequest | SessionKeyRequest

  const { stream, emit } = createStream<RequestInfo>()

  async function getSessionKey(): Promise<CryptoKey> {
    return new Promise<CryptoKey>((resolve) => {
      emit({
        type: 'sessionKey',
        payload: null,
        respond: resolve, // now resolve expects a CryptoKey
      })
    })
  }
  const encryptedCrud = withEncryption(base, publicRecoveryKey, getSessionKey)

  async function getNewSecret(id: string | number, secretName: string): Promise<string> {
    return new Promise((resolve) => {
      emit({
        type: 'newSecret',
        payload: { id, secretName },
        respond: resolve, // Pass the resolve function as a callback
      })
    })
  }

  type SecretData = Record<string, string>
  return {
    async setSecret(id: string | number, secretName: string, secretData: string): Promise<void> {
      // Get the existing secrets for the ID
      const existingSecrets: SecretData = ((await encryptedCrud.get(id)) as SecretData) || {}
      // Add or update the secret
      existingSecrets[secretName] = secretData
      // Save the updated secrets
      await encryptedCrud.set(id, existingSecrets)
    },

    async getSecret(id: string | number, secretName: string): Promise<string | null> {
      // Get the existing secrets for the ID
      const existingSecrets = (await encryptedCrud.get(id)) as SecretData
      // Return the specific secret if it exists
      let secret = existingSecrets ? existingSecrets[secretName] || null : null

      if (!secret) {
        secret = await getNewSecret(id, secretName)
        console.log('received new secret:', id, secretName)
        await this.setSecret(id, secretName, secret)
      }
      return secret
    },

    async deleteSecret(id: string | number, secretName: string): Promise<void> {
      // Get the existing secrets for the ID
      const existingSecrets = (await encryptedCrud.get(id)) as SecretData
      if (existingSecrets && secretName in existingSecrets) {
        // Delete the specific secret
        delete existingSecrets[secretName]
        // Save the updated secrets
        await encryptedCrud.set(id, existingSecrets)
      }
    },

    async listSecrets(id: string | number): Promise<Record<string, string>> {
      // Get all secrets for the ID
      return ((await encryptedCrud.get(id)) as SecretData) || {}
    },

    async clear(): Promise<void> {
      await encryptedCrud.clear()
    },

    requestInfos: stream,
  }
}

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
