import type { TyPGDB } from './pglite.api'

// Helper functions
// prevent SQL injection.. (TODO: not sure how well this works)
const formatValue = (value: string | number): string =>
  typeof value === 'number' ? value.toString() : `'${value.replace(/'/g, "''")}'`

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

export const createCrudWrapper = async <T>(db: TyPGDB, options: CrudOptions) => {
  const {
    tableName,
    idColumn = 'id',
    dataColumn = 'data',
    createTableSql = `CREATE TABLE IF NOT EXISTS ${tableName} (
      ${idColumn} CHAR(64) PRIMARY KEY,
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

  return {
    create: async (id: string | number, data: T) => {
      const formattedId = formatValue(id)
      const jsonData = formatValue(JSON.stringify(data))
      await db.exec(`INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
              VALUES (${formattedId}, ${jsonData});`)
    },
    read: async (id: string | number): Promise<T | null> => {
      const result = await db.sql<Row<T>>`SELECT ${dataColumn} FROM ${tableName}
         WHERE ${idColumn} = ${formatValue(id)};`
      return result.rows.length ? result.rows[0]!.data : null
    },
    update: async (id: string | number, data: Partial<T>) => {
      const jsonData = formatValue(JSON.stringify(data))
      await db.exec(`UPDATE ${tableName}
              SET ${dataColumn} = ${jsonData}
              WHERE ${idColumn} = ${formatValue(id)};`)
    },
    upsert: async (id: string | number, data: T) => {
      const formattedId = formatValue(id)
      const jsonData = formatValue(JSON.stringify(data))
      await db.exec(`INSERT INTO ${tableName} (${idColumn}, ${dataColumn})
          VALUES (${formattedId}, ${jsonData})
          ON CONFLICT (${idColumn}) DO UPDATE SET ${dataColumn} = ${jsonData};`)
    },
    delete: async (id: string | number) => {
      await db.exec(`DELETE FROM ${tableName} WHERE ${idColumn} = ${formatValue(id)};`)
    },
    list: async (): Promise<Row<T>[]> => {
      const result = await db.sql<Row<T>>`SELECT ${idColumn}, ${dataColumn} FROM ${tableName};`
      return result.rows
    },
    // Note: onScopeDispose works when called from a Vue component or a proper effect scope.
    readLive: async (id: string | number, callback: (data: Row<T>['data'] | null) => void) => {
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
    },
  }
}

export type CrudWrapper<T> = Awaited<ReturnType<typeof createCrudWrapper<T>>>
