//pglite.api.ts
import { PGlite } from '@electric-sql/pglite'
import { LeaderChangedError, PGliteWorker } from '@electric-sql/pglite/worker'
import type { LiveNamespace } from '@electric-sql/pglite/live'
import { live } from '@electric-sql/pglite/live'
import { vector } from '@electric-sql/pglite/vector'

export type TyPGDB =
  | (PGliteWorker & { live: LiveNamespace } & { name?: string })
  | (PGlite & { live?: LiveNamespace; name?: string })

const pgInstances = new Map<string, TyPGDB>()
const memoryPgInstances = new Map<string, TyPGDB>()
let nodeDataDirResolver: ((name: string) => string) | null = null
const TASKYON_DATABASE = 'template1'

const useNodePgLite = () => typeof indexedDB === 'undefined'
const getNodeDataDir = (name: string) =>
  nodeDataDirResolver ? nodeDataDirResolver(name) : 'memory://'

export function configureNodePgLiteDataDir(resolver?: (name: string) => string) {
  nodeDataDirResolver = resolver ?? null
}

export async function closeDatabases(): Promise<void> {
  const databases = [...pgInstances.values(), ...memoryPgInstances.values()]
  pgInstances.clear()
  memoryPgInstances.clear()
  await Promise.all(databases.map(async (database) => await database.close()))
}

export async function initializePGliteWorker<T>(
  createAttempt: () => { ready: Promise<T>; cleanup: () => void },
  retryDelaysMs: readonly number[] = [25, 100, 250],
): Promise<T> {
  for (let attemptIndex = 0; ; attemptIndex += 1) {
    const attempt = createAttempt()
    try {
      return await attempt.ready
    } catch (error) {
      attempt.cleanup()
      const retryDelay = retryDelaysMs[attemptIndex]
      if (!(error instanceof LeaderChangedError) || retryDelay === undefined) throw error
      await new Promise<void>((resolve) => setTimeout(resolve, retryDelay))
    }
  }
}

const createBrowserPGlite = async (name: string): Promise<TyPGDB> =>
  await initializePGliteWorker(() => {
    const worker = new Worker(new URL('./pglite.worker.ts', import.meta.url), {
      type: 'module',
    })
    return {
      ready: PGliteWorker.create(worker, {
        dataDir: `idb://${name}314`,
        database: TASKYON_DATABASE,
        extensions: {
          live,
        },
      }),
      cleanup: () => worker.terminate(),
    }
  })

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
        database: TASKYON_DATABASE,
        extensions: {
          vector,
        },
      })) as TyPGDB)
    : await createBrowserPGlite(name)
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

export const createPgLiteDatabase = async (dataDir: string): Promise<TyPGDB> =>
  await PGlite.create({ dataDir })

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
