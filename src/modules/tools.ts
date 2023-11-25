import { useVectorStore } from 'src/modules/localVectorStore';
import { execute } from './pyodide';
import { seleniumBrowser } from './seleniumTool';
import { dump } from 'js-yaml';
import { bigIntToString } from './chat';
import { TaskResult, ToolFunctionResult, toolCommandChat } from './types';
import { z } from 'zod';

export const vectorStore = useVectorStore();

type toolStateType = 'available' | 'starting' | 'unavailable' | 'error';
type ParamType =
  | string
  | number
  | boolean
  | Record<string, unknown>
  | Array<unknown>
  | null;
export type FunctionArguments = Record<string, ParamType>;

export type FunctionCall = {
  // The name of the function to call.
  name: string;
  arguments: FunctionArguments;
};

// this reflects json schema:  https://json-schema.org/specification-links
interface JSONSchemaForFunctionParameter {
  $schema?: string;
  type: 'object';
  properties: {
    [key: string]: {
      type: string;
      description?: string;
      default?: unknown;
      items?: JSONSchemaForFunctionParameter | JSONSchemaForFunctionParameter[];
    };
  };
  required?: string[];
}

export interface Tool {
  state: () => Promise<toolStateType> | toolStateType;
  // Description of what the function does (optional).
  description: string;
  // The name of the function to be called.
  name: string;
  // The parameters the function accepts (JSON Schema object).
  parameters: JSONSchemaForFunctionParameter;
}

export interface ExtendedTool extends Tool {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function: (...args: any[]) => unknown | Promise<unknown>;
}

export type ToolCollection = {
  [key: string]: ExtendedTool;
};

export const tools: ToolCollection = {};

export async function handleFunctionExecution(
  func: FunctionCall,
  tools: ToolCollection
): Promise<TaskResult> {
  try {
    let funcR: unknown = await tools[func.name].function(func.arguments);
    funcR = bigIntToString(funcR);
    const result: TaskResult = {
      type: 'FunctionResult',
      functionResult: { result: dump(funcR) },
    };
    return result;
  } catch (error) {
    return {
      type: 'FunctionError',
      functionResult: { result: JSON.stringify(error) },
    };
  }
}

tools.seleniumBrowser = seleniumBrowser;

tools.localVectorStoreSearch = {
  state: () => 'available',
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
  state: () => 'available',
  function: async ({ pythonScript }: { pythonScript: string }) => {
    console.log('execute python code...');
    return await execute(pythonScript);
  },
  description: `
  Executes the provided Python code using a Pyodide runtime and returns the result of the last expression evaluated. 
  This tool can be used to run data processing tasks, perform calculations, or interact with Python libraries.
  Common use-cases include executing data transformations, statistical analyses, or machine learning algorithms on uploaded files.
  It's important to structure the Python code such that the desired result
  is the outcome of the last expression in the script. Outcomes should be of the types String, Number, Array, Map, Set.
  Additionally, stdout will be returned as a string.
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
    const stateCode = tool.state.toString();
    return `Tool Name: ${toolName}\nFunction Code:\n${functionCode}\n\nState Code:\n${stateCode}`;
  } else {
    return `Tool ${toolName} not found.`;
  }
}

// Helper function to extract function signature
function getFunctionSignature(func: (...args: unknown[]) => unknown) {
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
    const stateSignature = getFunctionSignature(tool.state);
    const toolExample = {
      ...tool,
      function: functionSignature,
      state: stateSignature,
    };
    return JSON.stringify(toolExample, null, 2); // Pretty print the JSON string
  } else {
    return `Tool ${toolName} not found.`;
  }
}

tools.getToolExample = {
  state: () => 'available',
  function: ({
    toolName,
    viewSource,
  }: {
    toolName: string;
    viewSource: boolean;
  }) => {
    console.log(`Fetching example for tool: ${toolName}`);
    let toolInfo;
    if (viewSource) {
      toolInfo = inspectToolCode(toolName);
    } else {
      toolInfo = extractToolExample(toolName);
    }
    return toolInfo;
  },
  description: `
    Retrieves an example of an existing tool by its name. This tool extracts the tool's description, name, parameters, 
    and function signatures to provide a complete example. Optionally, view the full source code of the tool functions.
    This can be used by an AI to understand and generate tools based on existing examples.
  `,
  name: 'getToolExample',
  parameters: {
    type: 'object',
    properties: {
      toolName: {
        type: 'string',
        description: 'The name of the tool to fetch an example for.',
      },
      viewSource: {
        type: 'boolean',
        description:
          'Whether to view the full source code of the tool functions.',
        default: false,
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

export function getDefaultParametersForTool(toolName: string) {
  const tool = tools[toolName];
  if (!tool) {
    console.log(`Tool ${toolName} not found.`);
    return null;
  }

  const params = tool.parameters;
  if (!params || !params.properties) {
    console.log(`No parameters defined for tool ${toolName}.`);
    return {};
  }

  const defaultParams: Record<string, ParamType> = {};
  Object.keys(params.properties).forEach((key) => {
    const type = params.properties[key].type;
    // Assign a default value based on the parameter's type.
    switch (type) {
      case 'string':
        defaultParams[key] = ''; // Default empty string
        break;
      case 'number':
        defaultParams[key] = 0; // Default number zero
        break;
      case 'boolean':
        defaultParams[key] = false; // Default boolean false
        break;
      case 'object':
        defaultParams[key] = {}; // Default empty object
        break;
      case 'array':
        defaultParams[key] = []; // Default empty array
        break;
      // Add cases for any other types you expect
      default:
        console.log(`No default value for parameter type: ${type}`);
        defaultParams[key] = null;
    }
  });

  return defaultParams;
}

interface WorkerMessage {
  success: boolean;
  result?: any;
  error?: string;
}

// Tool to Execute JavaScript Code
tools.executeJavaScript = {
  state: () => 'available',
  function: async ({ javascriptCode, useWorker = false }) => {
    console.log('Executing JavaScript code...');
    if (useWorker) {
      // Execute using a dynamically created Web Worker
      return executeInDynamicWorker(javascriptCode);
    } else {
      // Execute in the main thread
      try {
        return Promise.resolve(eval(javascriptCode));
      } catch (error) {
        return Promise.reject(error);
      }
    }
  },
  description: `
    Executes the provided JavaScript code, optionally in a dynamically created Web Worker, 
    and returns the result. The user can choose to run the code in a separate thread 
    (Web Worker) or in the main thread. If the javascript code is executed in the main thread, it can
    manipulate the DOM where it is currently running.
    It's important to structure the code such that the desired result is the completion value (outcome)
    of the last expression in the provided script. Keep in mind that results of console.log can not be
    seen by the system.
  `,
  name: 'executeJavaScript',
  parameters: {
    type: 'object',
    properties: {
      javascriptCode: {
        type: 'string',
        description: 'The JavaScript code to be executed.',
      },
      useWorker: {
        type: 'boolean',
        description: 'Whether to execute the code in a Web Worker.',
        default: false,
      },
    },
    required: ['javascriptCode'],
  },
};

// Function to execute JavaScript in a dynamically created Web Worker
function executeInDynamicWorker(javascriptCode: string) {
  return new Promise((resolve, reject) => {
    const workerCode = `
      onmessage = function(e) {
        try {
          const result = eval(e.data);
          postMessage({ success: true, result });
        } catch (error) {
          postMessage({ success: false, error: error.toString() });
        }
      };
    `;

    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    worker.onmessage = function (e: MessageEvent<WorkerMessage>) {
      URL.revokeObjectURL(workerUrl); // Clean up the object URL
      if (e.data.success) {
        resolve(e.data.result);
      } else {
        reject(new Error(e.data.error));
      }
    };

    worker.onerror = function (error) {
      URL.revokeObjectURL(workerUrl); // Clean up the object URL
      reject(new Error(`Worker error: ${error.message}`));
    };

    worker.postMessage(javascriptCode);
  });
}

function convertToToolCommandString(tool: Tool): toolCommandChat | undefined {
  // convert a tool into a schema which is compatible ti toolCommandChat
  const args: z.infer<(typeof toolCommandChat.shape)['args']> = {};

  const requiredProperties = new Set(tool.parameters.required || []);

  // Loop over each property in the tool's parameters
  for (const key in tool.parameters.properties) {
    const param = tool.parameters.properties[key];
    // Check if the key is in the list of required properties
    const isRequired = requiredProperties.has(key);
    // If the property is required, use the key as is, otherwise add a "?" to the key
    const argKey = isRequired ? key : `${key}?`;
    args[argKey] = param.type;
  }

  return { name: tool.name, args };
}

export function summarizeTools(toolIDs: string[]) {
  const toolStr = toolIDs
    .map((t) => {
      const tool = tools[t];
      const toolStr = dump({
        ...convertToToolCommandString(tool),
        description: tool.description,
      });
      return toolStr;
    })
    .join('\n---\n');

  return toolStr;
}
