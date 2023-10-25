import { useVectorStore } from 'src/modules/localVectorStore';
import { execute } from './pyodide';
import { seleniumBrowser } from './seleniumTool';

export const vectorStore = useVectorStore();

type toolStatusType = 'available' | 'starting' | 'unavailable' | 'error';

export interface Tool {
  status: () => Promise<toolStatusType> | toolStatusType;
  // Description of what the function does (optional).
  description: string;
  // The name of the function to be called.
  name: string;
  // The parameters the function accepts (JSON Schema object).
  parameters: Record<string, unknown>;
}

interface ExtendedTool extends Tool {
  function: (...args: any[]) => Promise<any>;
}

type ToolCollection = {
  [key: string]: ExtendedTool;
};

export const tools: ToolCollection = {};

tools.seleniumBrowser = seleniumBrowser;

tools.localVectorStoreSearch = {
  status: () => 'available',
  function: async ({ searchTerm }: { searchTerm: string }) => {
    const k = 3;
    console.log(`Searching for ${searchTerm}`);
    const results = await vectorStore.query(searchTerm, k);
    return results;
  },
  description: `
    Conducts an Approximate Nearest Neighbors (ANN) search in the local vector database derived from uploaded files. 
    This tool allows for natural language queries to retrieve relevant pieces of files based on semantic similarity. 
    Ideal for finding related documents or data segments amidst a large, vectorized dataset.
  `,
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

tools.executePythonScript = {
  status: () => 'available',
  function: async ({ pythonScript }: { pythonScript: string }) => {
    console.log('execute python code...');
    return await execute(pythonScript);
  },
  description: `
  Executes the provided Python code using a Pyodide runtime and returns the result of the last expression evaluated. 
  This tool can be used to run data processing tasks, perform calculations, or interact with Python libraries.
  Common use-cases include executing data transformations, statistical analyses, or machine learning algorithms on uploaded files.
  It's important to structure the Python code such that the desired result is the outcome of the last expression in the script.
`,
  name: 'executePythonScript',
  parameters: {
    type: 'object',
    properties: {
      pythonScript: {
        type: 'string',
        description: 'The Python code to be executed.',
      },
    },
    required: ['pythonScript'],
  },
};

/*function generateToolSummary() {
  return Object.keys(tools)
    .map((toolName) => {
      const { description } = tools[toolName];
      return `${toolName}: ${description}`;
    })
    .join('\n');
}*/
