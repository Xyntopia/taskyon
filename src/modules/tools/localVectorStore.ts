import { createTool } from '../taskyon/tools'
import { createVecPgLiteTable, getDatabase } from '../pglite.api'
import { useNlpWorker } from '../taskyon/webWorkerApi'

// TODO: make it possible to add "unique" identifiers as labels, so that
//       we can save text which was add from a task and use the task id as the UID

const getVectorStoreTable = (async () => {
  const db = await getDatabase('taskyon')
  const { vectorizeText } = useNlpWorker()
  const numDimensions = 384
  const modelName = 'xyntopia/all-MiniLM-L6-v2'

  const tableInstance = await createVecPgLiteTable(db, {
    tableName: 'vectorStoreTool',
    idColumn: 'id',
    dataColumn: 'data',
    additionalColumns: ['label TEXT'],
    pgvector: true,
    vectorDims: numDimensions,
  })

  console.log('created', tableInstance)

  return () => ({ db, vectorizeText, modelName })
})()

export const localVectorStore = createTool({
  description: `This tool can store Information and perform semantic search in a vector database, ideal
  for retrieving documents or data segments with high relevance to natural language queries.`,
  name: 'localVectorStoreSearch',
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
    const { db, vectorizeText } = (await getVectorStoreTable)()
    const modelName = 'xyntopia/all-MiniLM-L6-v2'

    if (searchText) {
      console.log(`Searching for ${searchText}`)
      const searchVector = await vectorizeText(searchText, modelName)
      if (searchVector) {
        const results = await db.query(
          `
        SELECT
        data,
        label,
        data <-> $1 AS distance
        FROM vectorStoreTool
        WHERE label = $3
        ORDER BY distance
        LIMIT $2;
        `,
          [searchVector, k, label],
        )
        return results
      }
    }

    if (saveText) {
      const vector = await vectorizeText(saveText, modelName)
      await db.query(
        `
        INSERT INTO vectorStoreTool (label, data)
        VALUES ($1, $2);
      `,
        [label, vector],
      )
      return { message: 'Data saved successfully' }
    }

    throw new Error('Either searchTerm or save parameter must be provided')
  },
})
