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
  function: (...args: any[]) => any | Promise<any>;
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

function inspectToolCode(toolName: string) {
  const tool = tools[toolName];
  if (tool) {
    const functionCode = tool.function.toString();
    const statusCode = tool.status.toString();
    return `Tool Name: ${toolName}\nFunction Code:\n${functionCode}\n\nStatus Code:\n${statusCode}`;
  } else {
    return `Tool ${toolName} not found.`;
  }
}

// Helper function to extract function signature
function getFunctionSignature(func: (...args: any[]) => any) {
  const funcString = func.toString();
  const signatureMatch = /(function\s.*?\(.*?\))|((\w+|\((.*?)\))\s*=>)/.exec(
    funcString
  );
  return signatureMatch ? signatureMatch[0] : 'function signature not found';
}

// Function to extract the tool object as an example, including the function signatures
function extractToolExample(toolName: string) {
  const tool = tools[toolName];
  if (tool) {
    const functionSignature = getFunctionSignature(tool.function);
    const statusSignature = getFunctionSignature(tool.status);
    const toolExample = {
      ...tool,
      function: functionSignature,
      status: statusSignature,
    };
    return JSON.stringify(toolExample, null, 2); // Pretty print the JSON string
  } else {
    return `Tool ${toolName} not found.`;
  }
}

// Function to extract tool information including the function and status signatures
function getToolInfo(toolName: string) {
  const tool = tools[toolName];
  if (tool) {
    const functionSignature = getFunctionSignature(tool.function);
    const statusSignature = getFunctionSignature(tool.status);
    const toolInfo = {
      ...tool,
      function: functionSignature,
      status: statusSignature,
    };
    return toolInfo;
  } else {
    return `Tool ${toolName} not found.`;
  }
}

tools.getToolExample = {
  status: () => 'available',
  function: ({ toolName }: { toolName: string }) => {
    console.log(`Fetching example for tool: ${toolName}`);
    const toolInfo = getToolInfo(toolName);
    return toolInfo;
  },
  description: `
    Retrieves an example of an existing tool by its name. This tool extracts the tool's description, name, parameters, 
    and function signatures to provide a complete example. This can be used by an AI to understand and generate tools 
    based on existing examples.
  `,
  name: 'getToolExample',
  parameters: {
    type: 'object',
    properties: {
      toolName: {
        type: 'string',
        description: 'The name of the tool to fetch an example for.',
      },
    },
    required: ['toolName'],
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
