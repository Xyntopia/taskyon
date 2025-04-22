import type { JSONSchema7 } from 'json-schema'
import { createVectorStore } from '../crudWrapper'
import { sha256UrlSafeHash } from '../crypto_webcrypto'
import { getDatabase } from '../pglite.api'
import { createTool } from '../taskyon/tools'

// TODO: make it possible to add "unique" identifiers as labels, so that
//       we can save text which was add from a task and use the task id as the UID
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
  } as const satisfies JSONSchema7,
  function: async ({ searchText, k, saveText, label }) => {
    const { search, upsert } = await createVectorStore(
      await getDatabase('taskyon'),
      'vectorStoreTool',
    )

    if (searchText) {
      return await search(searchText, k, label)
    } else if (saveText) {
      const id = await sha256UrlSafeHash(saveText)
      await upsert(id, saveText, label)
      return { message: 'Data saved successfully' }
    }

    throw new Error('Either searchText or saveText parameter must be provided')
  },
})
