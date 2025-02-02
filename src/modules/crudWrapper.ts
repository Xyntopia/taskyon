import type { PGliteWorker } from '@electric-sql/pglite/worker'

// Helper functions
const formatValue = (value: string | number): string =>
  typeof value === 'number' ? value.toString() : `'${value.replace(/'/g, "''")}'`

const buildInsertSql = (
  table: string,
  idColumn: string,
  dataColumn: string,
  id: string | number,
  data: unknown,
): string => {
  const formattedId = formatValue(id)
  const jsonData = formatValue(JSON.stringify(data))
  return `INSERT INTO ${table} (${idColumn}, ${dataColumn})
          VALUES (${formattedId}, ${jsonData});`
}

const buildSelectSql = (
  table: string,
  idColumn: string,
  dataColumn: string,
  id: string | number,
): string => {
  return `SELECT ${dataColumn} FROM ${table}
          WHERE ${idColumn} = ${formatValue(id)};`
}

const buildUpdateSql = (
  table: string,
  idColumn: string,
  dataColumn: string,
  id: string | number,
  data: unknown,
): string => {
  // NOTE: this simply replaces the entire JSON. If merging is needed,
  // consider a JSONB merge approach.
  const jsonData = formatValue(JSON.stringify(data))
  return `UPDATE ${table}
          SET ${dataColumn} = ${jsonData}
          WHERE ${idColumn} = ${formatValue(id)};`
}

const buildDeleteSql = (table: string, idColumn: string, id: string | number): string =>
  `DELETE FROM ${table} WHERE ${idColumn} = ${formatValue(id)};`

const buildListSql = (table: string, idColumn: string, dataColumn: string): string =>
  `SELECT ${idColumn}, ${dataColumn} FROM ${table};`

// Generic CRUD wrapper options
interface CrudOptions {
  tableName: string
  idColumn?: string
  dataColumn?: string
  // Optional SQL to create the table (including any special columns like vector)
  createTableSql?: string
}

export const createCrudWrapper = async <T>(db: PGliteWorker, options: CrudOptions) => {
  const { tableName, idColumn = 'id', dataColumn = 'data', createTableSql } = options

  // Incorporate the pgvector extension if needed
  await db.exec('CREATE EXTENSION IF NOT EXISTS vector;')

  // Create table if SQL provided
  if (createTableSql) {
    await db.exec(createTableSql)
  }

  return {
    create: async (id: string | number, data: T) => {
      const sql = buildInsertSql(tableName, idColumn, dataColumn, id, data)
      await db.exec(sql)
    },
    read: async (id: string | number): Promise<T | null> => {
      const sql = buildSelectSql(tableName, idColumn, dataColumn, id)
      const result = await db.query(sql)
      return result.rows.length ? JSON.parse(result.rows[0] as string) : null
    },
    update: async (id: string | number, data: Partial<T>) => {
      const sql = buildUpdateSql(tableName, idColumn, dataColumn, id, data)
      await db.exec(sql)
    },
    delete: async (id: string | number) => {
      const sql = buildDeleteSql(tableName, idColumn, id)
      await db.exec(sql)
    },
    list: async (): Promise<Array<{ id: string | number; data: T }>> => {
      const sql = buildListSql(tableName, idColumn, dataColumn)
      const result = await db.query(sql)
      return result.rows.map((row: unknown) => ({
        id: row[idColumn],
        data: JSON.parse(row[dataColumn]),
      }))
    },
  }
}
