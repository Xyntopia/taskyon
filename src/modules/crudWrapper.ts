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
  ) => Promise<void>
  delete: (id: string | number) => Promise<void>
  list: () => Promise<Row<T>[]>
  listAll?: () => Promise<Row<T>[]>
  clear: () => Promise<void>
}

export const withLiveStreams = <T>(
  base: CrudWrapper<T>,
): CrudWrapper<T> & {
  readLive: (id: string | number) => Stream<{ id: string | number; data: T | null }>
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
      await base.upsert(id, data, strategy)
      emit({ id, data })
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
                console.log('emitting current', current)
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
         VALUES ($1, $2);`,
        [id, JSON.stringify(data)],
      )
    },
    get,
    upsert: async (id, data, strategy = 'replace') => {
      // important: this function usually also requires the "withLocking" wrapper
      // in order to avoid race conditions
      if (strategy === 'native_shallow' || strategy === 'shallow_merge') {
        await db.query(
          `INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
           VALUES ($1, $2)
           ON CONFLICT (${idColumn})
           DO UPDATE SET ${dataColumn} = jsonb_set(${tableName}."${dataColumn}", '{}', EXCLUDED."${dataColumn}");`,
          [id, JSON.stringify(data)],
        )
      } else {
        // Fetch and merge in JS only if necessary
        const existingData = strategy === 'replace' ? {} : await get(id)
        const newData =
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
    upsert: async (id: string | number, data: T): Promise<void> => {
      // because we are doing an "Object.assign" we can
      // preserve reactivity if the storage is reactive :)
      const oldData = await get(id)
      if (oldData) {
        Object.assign(oldData, deepMerge(oldData, data))
        storage.set(id, oldData)
      } else {
        storage.set(id, data)
      }
      return Promise.resolve()
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

  async upsert(
    id: string | number,
    data: T,
    strategy?: 'shallow_merge' | 'replace' | 'deepmerge' | 'native_shallow',
  ): Promise<void> {
    await Promise.all(wrappers.map((w) => w.upsert(id, data, strategy)))
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const mapWrapper = createMapCrudWrapper<T>(storage)
  const combinedWrapper = createCombinedCrudWrapper([dbWrapper])
  const liveWrapper = withLiveStreams<T>(combinedWrapper)
  const lockedWrapper = withLocking(liveWrapper)

  return lockedWrapper
}

export type EnhancedCrudWrapper<T> = Awaited<ReturnType<typeof createEnhancedCrudWrapper<T>>>
