import { PGliteWorker } from '@electric-sql/pglite/worker'
import type { LiveNamespace } from '@electric-sql/pglite/live'
import { live } from '@electric-sql/pglite/live'

export type TyPGDB = PGliteWorker & { live: LiveNamespace }

let pgInstance: TyPGDB | null = null

export const getDatabase: (name: string) => Promise<TyPGDB> = async (name) => {
  if (!pgInstance) {
    console.log('get database', name)
    pgInstance = await PGliteWorker.create(
      new Worker(new URL('./pglite.worker.ts', import.meta.url), {
        type: 'module',
      }),
      {
        //'memory://'  // if we want to use taskyon in memory-only (this might make sense on
        // an ephemeral serve for example!)
        dataDir: `idb://${name}0.1`,
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
  }
  return pgInstance
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
