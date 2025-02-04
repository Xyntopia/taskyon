import type { TyPGDB } from './pglite.api'
import type { LiveCallback } from './useCallBacks'
import { useLiveCallBacks, addCallback } from './useCallBacks'

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
  set(id: string | number, data: T): Promise<void>
  get(id: string | number): Promise<T | null>
  upsert(id: string | number, data: T): Promise<void>
  delete(id: string | number): Promise<void>
  list(): Promise<Row<T>[]>
  readLive(id: string | number, callback: LiveCallback<T>): () => void
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

  const { trigger, callbackList, createDisposeFunction, add: addCallback } = useLiveCallBacks<T>()

  return {
    set: async (id: string | number, data: T) => {
      trigger(id, data)
      await db.query(
        `INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
         VALUES ($1, $2);`,
        [id, JSON.stringify(data)],
      )
    },
    get: async (id: string | number): Promise<T | null> => {
      const result = await db.query<Row<T>>(
        `SELECT ${dataColumn} FROM ${tableName}
         WHERE ${idColumn} = $1;`,
        [id],
      )
      return result.rows.length ? result.rows[0]!.data : null
    },
    /*update: async (id: string | number, data: Partial<T>) => {
      const jsonData = formatValue(JSON.stringify(data))
      triggerLiveCallbacks(id, data)
      await db.exec(`UPDATE ${tableName}
              SET ${dataColumn} = ${jsonData}
              WHERE ${idColumn} = ${formatValue(id)};`)
    },*/
    upsert: async (id: string | number, data: T) => {
      trigger(id, data)
      const jsonData = JSON.stringify(data)
      await db.query(
        `INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
          VALUES ($1, $2)
          ON CONFLICT (${idColumn}) DO UPDATE SET ${dataColumn} = $2;`,
        [id, jsonData],
      )
    },
    delete: async (id: string | number) => {
      trigger(id, null)
      callbackList.delete(id)
      await db.query(`DELETE FROM ${tableName} WHERE ${idColumn} = $1;`, [id])
    },
    list: async (): Promise<Row<T>[]> => {
      const result = await db.sql<Row<T>>`SELECT ${idColumn}, ${dataColumn} FROM ${tableName};`
      return result.rows
    },
    /*readLive: async (id: string | number, callback: (data: Row<T>['data'] | null) => void) => {
      const query = `SELECT ${dataColumn} FROM ${tableName} WHERE ${idColumn} = ${formatValue(id)};`
      const live = await db.live.query<Row<T>>({
        query,
        callback: (res) => {
          console.log('meta update received:', id)
          const data = res.rows.length ? res.rows[0]!.data : null
          callback(data)
        },
      })
      return live
    },*/
    /**
     * Register a live callback for a given record id.
     * The callback will be triggered on any create/update/upsert/delete for that id.
     * The returned object includes a `dispose` method to unregister the callback.
     */
    readLive: (id: string | number, callback: LiveCallback<T>) => {
      const key = id.toString()

      addCallback(key, callback)
      // Optionally, get the current state and call the callback once.
      /*const currentData = await (async () => {
        const result = await db.sql<Row<T>>`
          SELECT ${dataColumn} FROM ${tableName}
          WHERE ${idColumn} = ${formatValue(id)};`
        return result.rows.length ? result.rows[0]!.data : null
      })()
      callback(currentData)*/

      // Return a dispose() method to remove the callback.
      return createDisposeFunction(key, callback)
    },
  }
}

export const createMapCrudWrapper = <T>(
  storage: Map<string | number, T>,
): Promise<CrudWrapper<T>> => {
  const { trigger, callbackList, createDisposeFunction, add: addCallback } = useLiveCallBacks<T>()

  return Promise.resolve({
    set: (id: string | number, data: T): Promise<void> => {
      trigger(id, data)
      storage.set(id, data)
      return Promise.resolve()
    },
    get: (id: string | number): Promise<T | null> => {
      return Promise.resolve(storage.has(id) ? storage.get(id)! : null)
    },
    upsert: (id: string | number, data: T): Promise<void> => {
      trigger(id, data)
      storage.set(id, data)
      return Promise.resolve()
    },
    delete: (id: string | number): Promise<void> => {
      trigger(id, null)
      callbackList.delete(id)
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
    readLive: (id: string | number, callback: LiveCallback<T>): (() => void) => {
      addCallback(id, callback)
      return createDisposeFunction(id, callback)
    },
  })
}
