//pglite.api.ts
import { PGlite } from '@electric-sql/pglite'
import { PGliteWorker } from '@electric-sql/pglite/worker'
import type { LiveNamespace } from '@electric-sql/pglite/live'
import { live } from '@electric-sql/pglite/live'
import { vector } from '@electric-sql/pglite/vector'

export type TyPGDB =
  | (PGliteWorker & { live: LiveNamespace } & { name?: string })
  | (PGlite & { live?: LiveNamespace; name?: string })

const pgInstances = new Map<string, TyPGDB>()
const memoryPgInstances = new Map<string, TyPGDB>()
let nodeDataDirResolver: ((name: string) => string) | null = null

const useNodePgLite = () => typeof indexedDB === 'undefined'
const getNodeDataDir = (name: string) =>
  nodeDataDirResolver ? nodeDataDirResolver(name) : 'memory://'

export function configureNodePgLiteDataDir(resolver?: (name: string) => string) {
  nodeDataDirResolver = resolver ?? null
}

export const getDatabase: (name: string) => Promise<TyPGDB> = async (name) => {
  const existingDb = pgInstances.get(name)
  if (existingDb) {
    existingDb.name = name
    return existingDb
  }
  console.log('get database', name)
  const newInstance: TyPGDB = useNodePgLite()
    ? ((await PGlite.create({
        dataDir: getNodeDataDir(name),
        extensions: {
          vector,
        },
      })) as TyPGDB)
    : ((await PGliteWorker.create(
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
      )) as TyPGDB)
  pgInstances.set(name, newInstance)
  newInstance.name = name
  return newInstance
}

export const getInMemoryDatabase = async (name: string): Promise<TyPGDB> => {
  const existingDb = memoryPgInstances.get(name)
  if (existingDb) return existingDb

  const database: TyPGDB = await PGlite.create({
    dataDir: 'memory://',
    extensions: {
      vector,
    },
  })
  database.name = name
  memoryPgInstances.set(name, database)
  return database
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

const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function validateSqlIdentifier(identifier: string) {
  if (!SQL_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`)
  }
  return identifier
}

export async function createVecPgLiteTable(db: TyPGDB, options: PgLiteOptions) {
  if (options.pgvector) {
    options.additionalColumns = options.additionalColumns || []
    const vectorDims = options.vectorDims || 3
    if (!Number.isInteger(vectorDims) || vectorDims < 1) {
      throw new Error(`Invalid vector dimension count: ${vectorDims}`)
    }
    options.additionalColumns.push(`vec vector(${vectorDims})`)
  }

  const {
    tableName,
    idColumn = 'id',
    dataColumn = 'data',
    additionalColumns,
    createTableSql,
    pgvector = false,
  } = options
  validateSqlIdentifier(tableName)
  validateSqlIdentifier(idColumn)
  validateSqlIdentifier(dataColumn)
  const defaultCreateTableSql = `CREATE TABLE IF NOT EXISTS ${tableName} (
      ${idColumn} VARCHAR(64) PRIMARY KEY,
      ${dataColumn} JSONB NOT NULL
      ${additionalColumns ? `, ${additionalColumns.join(', ')}` : ''}
    );`

  // Incorporate the pgvector extension if needed
  if (pgvector) await db.exec('CREATE EXTENSION IF NOT EXISTS vector;')

  await db.exec(createTableSql ?? defaultCreateTableSql)

  return { dataColumn, tableName, idColumn }
}
