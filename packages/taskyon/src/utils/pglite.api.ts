//pglite.api.ts
import { PGliteWorker } from '@electric-sql/pglite/worker'
import type { LiveNamespace } from '@electric-sql/pglite/live'
import { live } from '@electric-sql/pglite/live'

export type TyPGDB = PGliteWorker & { live: LiveNamespace } & { name?: string }

const pgInstances = new Map<string, TyPGDB>()

export const getDatabase: (name: string) => Promise<TyPGDB> = async (name) => {
  const existingDb = pgInstances.get(name)
  if (existingDb) {
    existingDb.name = name
    return existingDb
  }
  console.log('get database', name)
  const newInstance: TyPGDB = await PGliteWorker.create(
    new Worker(new URL('./pglite.worker.ts', import.meta.url), {
      type: 'module',
    }),
    {
      //'memory://'  // if we want to use taskyon in memory-only (this might make sense on
      // an ephemeral serve for example!)
      // TODO: currently, we need to make sure, that we manually change the pglite version
      // number and use it as the string for the database...
      // it would be good to automatically adapt the name based on the version...
      dataDir: `idb://${name}314`,
      meta: {
        // additional metadata passed to `init`
      },
      // we can do this here instead of inside the worker, because it only uses the PGlite plugin interface
      // https://pglite.dev/docs/multi-tab-worker#extension-support
      extensions: {
        live,
      },
    },
  )
  pgInstances.set(name, newInstance)
  newInstance.name = name
  return newInstance
}

export interface PgLiteOptions {
  tableName: string
  idColumn?: string
  dataColumn?: string
  additionalColumns?: string[]
  // Optional SQL to create the table (including any special columns like vector)
  createTableSql?: string
  pgvector?: boolean
  vectorDims?: number
}

export async function createVecPgLiteTable(db: TyPGDB, options: PgLiteOptions) {
  if (options.pgvector) {
    options.additionalColumns = options.additionalColumns || []
    const vectorDims = options.vectorDims || 3
    options.additionalColumns.push(`vec vector(${vectorDims})`)
  }

  const {
    tableName,
    idColumn = 'id',
    dataColumn = 'data',
    additionalColumns,
    createTableSql = `CREATE TABLE IF NOT EXISTS ${tableName} (
      ${idColumn} VARCHAR(64) PRIMARY KEY,
      ${dataColumn} JSONB NOT NULL
      ${additionalColumns ? `, ${additionalColumns.join(', ')}` : ''}
    );`,
    pgvector = false,
  } = options

  // Incorporate the pgvector extension if needed
  if (pgvector) await db.exec('CREATE EXTENSION IF NOT EXISTS vector;')

  // Create table if SQL provided
  if (createTableSql) {
    await db.exec(createTableSql)
  }

  return { dataColumn, tableName, idColumn }
} // TODO: add protections against SQL injection...
