import { useVectorStore, SearchResult } from 'src/modules/localVectorStore';

export const vectorStore = useVectorStore();

export interface Tool {
  // Description of what the function does (optional).
  description: string;
  // The name of the function to be called.
  name: string;
  // The parameters the function accepts (JSON Schema object).
  parameters: Record<string, any>;
}

interface ExtendedTool extends Tool {
  function: (...args: any[]) => Promise<any>;
}

type ToolCollection = {
  [key: string]: ExtendedTool;
};

export const tools: ToolCollection = {};
tools.localVectorStoreSearch = {
  function: async ({ searchTerm }: { searchTerm: string }) => {
    const k = 3;
    console.log(`Searching for ${searchTerm}`);
    const results = await vectorStore.query(searchTerm, k);
    return results;
  },
  description:
    'Performs an ANN search in the local vector database from the chat and retrieves the results.',
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
};
