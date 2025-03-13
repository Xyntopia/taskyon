import { decryptObject, deriveKey, encryptObject } from './crypto'
import { randomBytes } from '@noble/ciphers/webcrypto'
import type { Stream } from './frpBus'
import { createStream, filter } from './frpBus'
import type { PgLiteOptions } from './pglite.api'
import { createVecPgLiteTable, type TyPGDB } from './pglite.api'
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

// TODO: protect the masterPW better, by somehow not saving it in memory???
//       maybe we can use a masterPW hash or somthing like that? or something with a salt?
//       I dont know what strategies are out there that we could employ...
export const withEncryption = <T>(
  base: CrudWrapper<{ iv: string; ciphertext: string; salt: string; data: T }>,
  deriveKey: (masterPassword: string, salt: string, id: string) => Uint8Array,
  encryptObject: (obj: unknown, key: Uint8Array) => { iv: string; ciphertext: string },
  decryptObject: (
    { iv, ciphertext }: { iv: string; ciphertext: string },
    key: Uint8Array,
  ) => unknown,
  masterPassword: string,
) => {
  return {
    async set(id: string | number, data: T): Promise<void> {
      const salt = randomBytes(16).toString() // Generate a unique salt
      const key = deriveKey(masterPassword, salt, id.toString())
      const encrypted = encryptObject(data, key)
      await base.set(id, { ...encrypted, salt, data })
    },

    async get(id: string | number): Promise<T | null> {
      const encryptedData = await base.get(id)
      if (!encryptedData) return null
      const { salt } = encryptedData
      const key = deriveKey(masterPassword, salt, id.toString())
      return decryptObject(encryptedData, key) as T
    },

    async delete(id: string | number): Promise<void> {
      await base.delete(id)
    },

    async list(): Promise<Row<T>[]> {
      const encryptedRows = await base.list()
      return Promise.all(
        encryptedRows.map((row) => {
          const { salt } = row.data
          const key = deriveKey(masterPassword, salt, row.id.toString())
          const data = decryptObject(row.data, key) as T
          return { id: row.id, data }
        }),
      )
    },

    async clear(): Promise<void> {
      await base.clear()
    },
  }
}

export const withSecretStore = <T>(
  base: CrudWrapper<{ iv: string; ciphertext: string; salt: string; data: Record<string, T> }>,
  masterPassword: string,
) => {
  const encryptedCrud = withEncryption<Record<string, T>>(
    base,
    deriveKey,
    encryptObject,
    decryptObject,
    masterPassword,
  )

  return {
    async setSecret(id: string | number, secretName: string, secretData: T): Promise<void> {
      // Get the existing secrets for the ID
      const existingSecrets = (await encryptedCrud.get(id)) || {}
      // Add or update the secret
      existingSecrets[secretName] = secretData
      // Save the updated secrets
      await encryptedCrud.set(id, existingSecrets)
    },

    async getSecret(id: string | number, secretName: string): Promise<T | null> {
      // Get the existing secrets for the ID
      const existingSecrets = await encryptedCrud.get(id)
      // Return the specific secret if it exists
      return existingSecrets ? existingSecrets[secretName] || null : null
    },

    async deleteSecret(id: string | number, secretName: string): Promise<void> {
      // Get the existing secrets for the ID
      const existingSecrets = await encryptedCrud.get(id)
      if (existingSecrets && secretName in existingSecrets) {
        // Delete the specific secret
        delete existingSecrets[secretName]
        // Save the updated secrets
        await encryptedCrud.set(id, existingSecrets)
      }
    },

    async listSecrets(id: string | number): Promise<Record<string, T>> {
      // Get all secrets for the ID
      return (await encryptedCrud.get(id)) || {}
    },

    async clear(): Promise<void> {
      await encryptedCrud.clear()
    },
  }
}
