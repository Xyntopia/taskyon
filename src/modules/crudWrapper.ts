import type { TyPGDB } from './pglite.api'
import type { LiveCallback } from './useCallBacks'
import { useCallbacks } from './useCallBacks'
import { deepMerge, lockMap } from './utils'

// TODO: add protections against SQL injection...

// Generic CRUD wrapper options
interface CrudOptions {
  tableName: string
  idColumn?: string
  dataColumn?: string
  // Optional SQL to create the table (including any special columns like vector)
  createTableSql?: string
  pgvector?: boolean
}

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

export const withLiveCallbacks = <T>(base: CrudWrapper<T>) => {
  const { trigger, callbackList, createDisposeFunction, add } = useCallbacks<T>()

  return {
    ...base,
    async set(id: string | number, data: T): Promise<void> {
      await base.set(id, data)
      trigger(id, data)
    },

    async upsert(
      id: string | number,
      data: T,
      strategy: 'shallow_merge' | 'replace' | 'deepmerge' | 'native_shallow' = 'replace',
    ): Promise<void> {
      await base.upsert(id, data, strategy)
      trigger(id, data)
    },

    async delete(id: string | number): Promise<void> {
      await base.delete(id)
      // Optionally, you could trigger a deletion event here.
      callbackList.delete(id)
    },

    readLive(id: string | number, callback: LiveCallback<T>): () => void {
      add(id, callback)
      void base.get(id).then((data) => {
        if (data !== null) callback(data)
      })
      return createDisposeFunction(id, callback)
    },
    async clear(): Promise<void> {
      await base.clear()
      callbackList.clear()
    },
  }
}

const withLock =
  (lockItem: ReturnType<typeof lockMap>['lockItem']) =>
  async <T>(func: T, id: string | number) => {
    const unlock = await lockItem(id)
    try {
      return func
    } finally {
      unlock()
    }
  }

export const withLocking = <T>(
  base: CrudWrapper<T>,
  namespace: string = 'task',
): CrudWrapper<T> => {
  const { lockItem, clearLocks } = lockMap(namespace)

  const locking = withLock(lockItem)

  return {
    ...base,
    set: async (...args) => (await locking(base.set, args[0]))(...args),
    delete: async (...args) => (await locking(base.delete, args[0]))(...args),
    get: async (...args) => (await locking(base.get, args[0]))(...args),
    upsert: async (...args) => (await locking(base.upsert, args[0]))(...args),
    clear: async () => Promise.resolve(clearLocks()),
  }
}

export const createCrudWrapper = async <T>(
  db: TyPGDB,
  options: CrudOptions,
): Promise<CrudWrapper<T>> => {
  const {
    tableName,
    idColumn = 'id',
    dataColumn = 'data',
    createTableSql = `CREATE TABLE IF NOT EXISTS ${tableName} (
      ${idColumn} VARCHAR(64) PRIMARY KEY,
      ${dataColumn} JSONB NOT NULL
);`,
    pgvector = false,
  } = options

  // Incorporate the pgvector extension if needed
  if (pgvector) await db.exec('CREATE EXTENSION IF NOT EXISTS vector;')

  // Create table if SQL provided
  if (createTableSql) {
    await db.exec(createTableSql)
  }

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
    /*update: async (id: string | number, data: Partial<T>) => {
      const jsonData = formatValue(JSON.stringify(data))
      triggerLiveCallbacks(id, data)
      await db.exec(`UPDATE ${tableName}
              SET ${dataColumn} = ${jsonData}
              WHERE ${idColumn} = ${formatValue(id)};`)
    },*/
    upsert: async (id, data, strategy = 'replace') => {
      let newData: T
      // we have to lock the item while doing the update to make sure, nothing happens
      // between our "get" and "query" expressions from another thread e.g.
      // adding empty data...
      if (strategy === 'native_shallow') {
        const jsonData = JSON.stringify(data)
        await db.query(
          `INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
             VALUES ($1, $2)
             ON CONFLICT (${idColumn})
             DO UPDATE SET ${dataColumn} = ${dataColumn} || EXCLUDED.${dataColumn};`,
          [id, jsonData],
        )
        // TODO: in the case of a native merge, we can release the trigger asynchronously
        // this might be a little faster than doing the shallow_merge with regard
        // to saving the data in the db.
        newData = (await get(id)) || ({} as T)
      } else if (strategy === 'shallow_merge') {
        // we're doing a js merge here instead of a pure postgresql merge, because
        // this way we can do faster "triggers" of callbacks...
        const oldData = await get(id)
        newData = {
          ...oldData,
          ...data,
        }
      } else if (strategy === 'deepmerge') {
        const oldData = await get(id)
        newData = deepMerge(oldData, data, 'overwrite')
      } else {
        newData = data
      }
      const jsonData = JSON.stringify(newData)
      console.log('upserting', id, jsonData)
      await db.query(
        `INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
          VALUES ($1, $2)
          ON CONFLICT (${idColumn}) DO UPDATE SET ${dataColumn} = $2;`,
        [id, jsonData],
      )
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

export const createMapCrudWrapper = <T>(
  storage: Map<string | number, T>,
): Promise<CrudWrapper<T>> => {
  const get = (id: string | number): Promise<T | null> => {
    return Promise.resolve(storage.has(id) ? storage.get(id)! : null)
  }
  return Promise.resolve({
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
      storage.set(id, data)
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
  })
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
  options: CrudOptions,
  storage: Map<string | number, T>,
): Promise<CrudWrapper<T>> => {
  const dbWrapper = await createCrudWrapper<T>(db, options)
  const mapWrapper = await createMapCrudWrapper<T>(storage)
  const combinedWrapper = createCombinedCrudWrapper<T>([dbWrapper, mapWrapper])
  const liveWrapper = withLiveCallbacks<T>(combinedWrapper)
  const lockedWrapper = withLocking<T>(liveWrapper)

  return lockedWrapper
}
