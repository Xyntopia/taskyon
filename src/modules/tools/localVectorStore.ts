import type { Tool } from '../taskyon/tools'
import { getDatabase } from '../pglite.api'

export const localVectorStore: Tool = {
  function: async ({ searchTerm }: { searchTerm: string }) => {
    return searchTerm
    /*const vectorStore = useVectorStore();
      const k = 3;
      console.log(`Searching for ${searchTerm}`);
      const results = await vectorStore.query(searchTerm, k);
      return results;*/
  },
  description: `Performs semantic search in a local vector database, ideal
  for retrieving documents or data segments with high relevance to natural language queries.`,
  name: 'localVectorStoreSearch',
  parameters: {
    type: 'object',
    properties: {
      searchTerm: {
        type: 'string',
        description: 'The search term to use in the vector store search.',
      },
      saveString: {
        type: 'string',
        description: 'Save a string in the vector database',
      },
    },
    required: ['searchTerm'],
  },
}
