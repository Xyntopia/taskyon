import type { Tool } from '../taskyon/tools'

export const localVectorStoreSearch: Tool = {
  function: ({ searchTerm }: { searchTerm: string }) => {
    return searchTerm
    /*const vectorStore = useVectorStore();
      const k = 3;
      console.log(`Searching for ${searchTerm}`);
      const results = await vectorStore.query(searchTerm, k);
      return results;*/
  },
  description: `Performs semantic search in a local vectorized database, ideal 
  for retrieving documents or data segments with high relevance to natural language queries.`,
  name: 'localVectorStoreSearch',
  parameters: {
    type: 'object',
    properties: {
      searchTerm: {
        type: 'string',
        description: 'The search term to use in the vector store search.',
      },
    },
    required: ['searchTerm'],
  },
}
