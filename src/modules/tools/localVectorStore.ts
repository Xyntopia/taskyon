import { createTool } from '../taskyon/tools'
import { createVecPgLiteTable, getDatabase } from '../pglite.api'
import { useNlpWorker } from '../taskyon/webWorkerApi'
import { sha256UrlSafeHash } from '../crypto_webcrypto'

// TODO: make it possible to add "unique" identifiers as labels, so that
//       we can save text which was add from a task and use the task id as the UID

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

const createVectorStore = async () => {
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
    return { message: 'Data saved successfully' }
  }

  return { search, insert }
}

export const localVectorStore = createTool({
  name: 'localVectorStore',
  description: `This tool can store Information and perform semantic search in a vector database, ideal
  for retrieving documents or data segments with high relevance to natural language queries. You can use labels to
  make sure that the search is only performed in a specific segment of the database.`,
  parameters: {
    type: 'object',
    properties: {
      searchText: {
        type: 'string',
        description: 'The search term to use in the vector store search.',
      },
      k: {
        type: 'number',
        description: 'The number of nearest neighbors to retrieve in the search.',
        default: 5,
      },
      label: {
        type: 'string',
        description: 'The label for the string to be saved.',
      },
      saveText: {
        type: 'string',
        description: 'The string to be saved in the vector database.',
      },
    },
    oneOf: [{ required: ['search'] }, { required: ['save'] }],
  } as const,
  function: async ({ searchText, k, saveText, label }) => {
    const { search, insert } = await createVectorStore()

    if (searchText) {
      return await search(searchText, k, label)
    } else if (saveText) {
      return await insert(saveText, label)
    }

    throw new Error('Either searchText or saveText parameter must be provided')
  },
})
