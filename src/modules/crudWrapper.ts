import type { TyPGDB } from './pglite.api'

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

type LiveCallback<T> = (data: T | null) => void

export const createCrudWrapper = async <T>(db: TyPGDB, options: CrudOptions) => {
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

  // Map to hold live callbacks.
  // Using a Map that stores, for each record ID (as a string), a Set of callback functions.
  const liveCallbacks = new Map<string, Set<LiveCallback<T>>>()

  // Helper to trigger callbacks for a given record id.
  const triggerLiveCallbacks = (id: string | number, data: T | null) => {
    const key = id.toString()
    const callbacks = liveCallbacks.get(key)
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(data)
        } catch (error) {
          console.error(`Error in live callback for id ${key}:`, error)
        }
      })
    }
  }

  return {
    create: async (id: string | number, data: T) => {
      triggerLiveCallbacks(id, data)
      await db.query(
        `INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
         VALUES ($1, $2);`,
        [id, JSON.stringify(data)],
      )
    },
    read: async (id: string | number): Promise<T | null> => {
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
      triggerLiveCallbacks(id, data)
      const jsonData = JSON.stringify(data)
      await db.query(
        `INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
          VALUES ($1, $2)
          ON CONFLICT (${idColumn}) DO UPDATE SET ${dataColumn} = $2;`,
        [id, jsonData],
      )
    },
    delete: async (id: string | number) => {
      triggerLiveCallbacks(id, null)
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
      if (!liveCallbacks.has(key)) {
        liveCallbacks.set(key, new Set())
      }
      liveCallbacks.get(key)!.add(callback)

      // Optionally, get the current state and call the callback once.
      /*const currentData = await (async () => {
        const result = await db.sql<Row<T>>`
          SELECT ${dataColumn} FROM ${tableName}
          WHERE ${idColumn} = ${formatValue(id)};`
        return result.rows.length ? result.rows[0]!.data : null
      })()
      callback(currentData)*/

      // Return a dispose() method to remove the callback.
      return () => {
        const callbacks = liveCallbacks.get(key)
        if (callbacks) {
          callbacks.delete(callback)
          if (callbacks.size === 0) {
            liveCallbacks.delete(key)
          }
        }
      }
    },
  }
}

export type CrudWrapper<T> = Awaited<ReturnType<typeof createCrudWrapper<T>>>
