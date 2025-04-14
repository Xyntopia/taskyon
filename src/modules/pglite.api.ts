import { PGliteWorker } from '@electric-sql/pglite/worker'
import type { LiveNamespace } from '@electric-sql/pglite/live'
import { live } from '@electric-sql/pglite/live'
import { sha256UrlSafeHash } from './crypto_webcrypto'
import { useNlpWorker } from './taskyon/webWorkerApi'

export type TyPGDB = PGliteWorker & { live: LiveNamespace }

let pgInstance: TyPGDB | null = null

export const getDatabase: (name: string) => Promise<TyPGDB> = async (name) => {
  if (!pgInstance) {
    pgInstance = await PGliteWorker.create(
      new Worker(new URL('./pglite.worker.ts', import.meta.url), {
        type: 'module',
      }),
      {
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

const getVectorStoreTable = async (name: string, modelName: string) => {
  const db = await getDatabase('taskyon')
  const { vectorizeText } = useNlpWorker()
  const numDimensions = 384

  const tableInstance = await createVecPgLiteTable(db, {
    tableName: name,
    idColumn: 'id',
    dataColumn: 'data',
    additionalColumns: ['label TEXT'],
    pgvector: true,
    vectorDims: numDimensions,
  })

  console.log('created', tableInstance)

  return { db, vectorizeText, modelName }
}

export const createVectorStore = async () => {
  const modelName = 'xyntopia/all-MiniLM-L6-v2'

  const { db, vectorizeText } = await getVectorStoreTable('vectorStoreTool', modelName)

  const search = async (searchText: string, k: number, label?: string) => {
    console.log(`Searching for ${searchText}`)
    const searchVector = await vectorizeText(searchText, modelName)
    const formattedVector = `[${searchVector.join(',')}]` // Format the array as a string for pgvector
    if (searchVector) {
      const results = await db.query(
        `
      SELECT
      label,
      data,
      vec <-> $1 AS distance
      FROM vectorStoreTool
      WHERE label = $3
      ORDER BY distance
      LIMIT $2;
      `,
        [formattedVector, k, label],
      )
      return results.rows
    }
  }

  const insert = async (saveText: string, label?: string) => {
    const vector = await vectorizeText(saveText, modelName)
    const formattedVector = `[${vector.join(',')}]` // Format the array as a string for pgvector
    const id = await sha256UrlSafeHash(saveText)
    await db.query(
      `
      INSERT INTO vectorStoreTool (id, label, data, vec)
      VALUES ($1, $2, $3, $4);
    `,
      // TODO: can this be made more efficient without converting
      //       the vector to a string?
      [id, label, JSON.stringify(saveText), formattedVector],
    )
  }

  return { search, insert }
}
