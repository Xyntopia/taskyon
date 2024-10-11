import { useVectorStore } from 'src/modules/localVectorStore';
import { dump } from 'js-yaml';
import { bigIntToString } from '../utils';
import {
  TaskResult,
  TaskyonMessages,
  FunctionArguments,
  RemoteFunctionCall,
  RemoteFunctionResponse,
  FunctionCall,
  ParamType,
  ToolBase,
  TaskProcessingError,
} from './types';
import { z } from 'zod';
import { YamlRepresentation, convertToYamlWComments } from '../zodUtils';
import { executeCodeInIframe } from './iframeWorker';

const arbitraryFunctionSchema = z.custom<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => unknown | Promise<unknown>
>((val) => typeof val === 'function', {
  message:
    'Expected a function that accepts any arguments and returns unknown or Promise<unknown>',
});
export type arbitraryFunction = z.infer<typeof arbitraryFunctionSchema>;

const Tool = ToolBase.extend({
  function: arbitraryFunctionSchema,
});
export type Tool = z.infer<typeof Tool>;

// This function executes code in a different browser context. E.g. executing a
// function in the context of the parent of an iframe!
// TODO: move this into our iframe API?
async function handleRemoteFunction(name: string, args: FunctionArguments) {
  // set up listener to listen for function call result.
  const funcRP: Promise<RemoteFunctionResponse> = new Promise(
    (resolve, reject) => {
      const listener = (event: MessageEvent) => {
        console.log('remoteHandler received message', event);
        // TODO: Add security checks here, e.g., verify event.origin
        if (event.source === window.parent && event.data) {
          const response = TaskyonMessages.safeParse(event.data);
          if (response.success) {
            if (
              response.data.type == 'functionResponse' &&
              response.data.functionName === name
            ) {
              window.removeEventListener('message', listener); // remove listener
              resolve(response.data);
            }
          } else {
            reject(
              new TaskProcessingError(
                'The message had the wrong format for taskyon!',
                { error: response.error },
              ),
            );
          }
        }
      };

      // Set a timeout to reject the promise if no response is received within a certain time frame
      const timeoutSeconds = 10;
      setTimeout(() => {
        reject(
          new TaskProcessingError(
            `Response timeout (${timeoutSeconds}). Waiting for function ${name} more than ${timeoutSeconds}s`,
          ),
        );
        window.removeEventListener('message', listener); // remove listener on timeout
      }, timeoutSeconds * 1000); // 100 seconds timeout for example

      // TODO: make timeout configurable
      window.addEventListener('message', listener);
    },
  );

  // we do this also in order to make sure we have a defined object
  // which we can send through postMessage without any functions etc...
  const message = RemoteFunctionCall.parse({
    type: 'functionCall',
    functionName: name,
    arguments: args,
  });
  console.log('no tool code found, posting a function message to', message);
  // after we've set up the listener, initiate the function call
  window.parent.postMessage(message, '*'); // TODO. Specify the exact origin instead of '*'

  const funcR = await funcRP;
  return funcR.response;
}

function getTool(tools: Record<string, ToolBase | Tool>, name: string) {
  const tool = tools[name];
  if (!tool) {
    throw new TaskProcessingError("Tool doesn't exist", {
      toolName: name,
    });
  }
  return tool;
}

/**
 * Handle function execution for LLMs.
 * All errors of this function result in an error task in the main task worker!
 *
 *
 * @param func
 * @param tools
 * @param taskManager
 * @returns
 */
export async function handleFunctionExecution(
  func: FunctionCall,
  tools: Record<string, ToolBase | Tool>,
): Promise<TaskResult> {
  let funcR: unknown;
  const tool = getTool(tools, func.name);
  if ('function' in tool && tool.function) {
    console.log('using tool!', tool);
    funcR = await tool.function(func.arguments);
    funcR = bigIntToString(funcR);
    return {
      toolResult: { result: dump(funcR) },
    };
  } else if (tool.code) {
    console.log('compile & execute function code in iframe', tool);
    try {
      // Execute code in iframe with parameters (func.arguments)
      funcR = await executeCodeInIframe(tool.code, func.arguments);
      funcR = bigIntToString(funcR); // Optionally convert bigInt
      return {
        toolResult: { result: dump(funcR) },
      };
    } catch (error) {
      throw new TaskProcessingError(
        `Error executing iframe code for tool: ${func.name}. Error: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  } else {
    // we do the zod object parsing/validation here, because we might have a proxy object from upstream
    // and want to make sure its serializable for a postMessage function.
    const funcR = await handleRemoteFunction(func.name, func.arguments);
    return {
      toolResult: { result: dump(funcR) },
    };
  }
}

/*export const taskyonConfiguration: Tool = {

}*/

export const localVectorStoreSearch: Tool = {
  function: async ({ searchTerm }: { searchTerm: string }) => {
    const vectorStore = useVectorStore();
    const k = 3;
    console.log(`Searching for ${searchTerm}`);
    const results = await vectorStore.query(searchTerm, k);
    return results;
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
};

// the following tool is "self-referential" and because of this we can not initialize it yet
// we instead write a factory function which creates this tool using a reference to our tools
// variable
// TODO: we need to give crateExampleTool the full list of tools with their *code*
// definitions. Basically it becomes a task-search tool.
// TODO:  this is a problem, if we use webpack/ts. Because we won't be able to get the original
//        source code of our tools. Therefore we need to parse our "actual" tools which we can find
//        in the task databse with *function* label.
export function createToolExampleTool(tools: Record<string, Tool>): Tool {
  // used to get the code from our tools :)
  function inspectToolCode(toolName: string) {
    const tool = tools[toolName];
    if (tool) {
      const functionCode = tool.function.toString();
      return `Tool Name: ${toolName}\nFunction Code:\n${functionCode}`;
    } else {
      return `Tool ${toolName} not found.`;
    }
  }

  // Helper function to extract function signature
  function getFunctionSignature(func: arbitraryFunction | string) {
    const funcString = func.toString();
    const signatureMatch = /(function\s.*?\(.*?\))|((\w+|\((.*?)\))\s*=>)/.exec(
      funcString,
    );
    return signatureMatch ? signatureMatch[0] : 'function signature not found';
  }

  // Function to extract the tool object as an example, including the function signatures
  function extractToolExample(toolName: string) {
    const tool = tools[toolName];
    if (tool) {
      const functionSignature = getFunctionSignature(tool.function);
      const toolExample = {
        ...tool,
        function: functionSignature,
      };
      return JSON.stringify(toolExample, null, 2); // Pretty print the JSON string
    } else {
      return `Tool ${toolName} not found.`;
    }
  }

  const getToolExample: Tool = {
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
    description: `Retrieves detailed examples and source code of existing tools, assisting in 
understanding tool functionalities and aiding in tool development or adaptation.`,
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

  return getToolExample;
}

/*function generateToolSummary() {
  return Object.keys(tools)
    .map((toolName) => {
      const { description } = tools[toolName];
      return `${toolName}: ${description}`;
    })
    .join('\n');
}*/

export function getDefaultParametersForTool(tool: Tool | ToolBase) {
  const params = tool.parameters;
  if (!params || !params.properties) {
    console.log(`No parameters defined for tool ${tool.name}.`);
    return {};
  }

  const defaultParams: Record<string, ParamType> = {};
  Object.keys(params.properties).forEach((key) => {
    const type = params.properties[key]?.type;
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

export interface WorkerMessage {
  success: boolean;
  result?: unknown;
  error?: string;
}

function convertToToolCommandString(tool: ToolBase): string {
  // convert a tool into a schema which is compatible with toolCommandChat
  const args: YamlRepresentation = {};

  const requiredProperties = new Set(tool.parameters.required || []);

  // Loop over each property in the tool's parameters
  Object.entries(tool.parameters.properties).forEach(([key, param]) => {
    // Check if the key is in the list of required properties
    // const isRequired = requiredProperties.has(key);
    // If the property is required, use the key as is, otherwise add a "?" to the key
    if (param.description) {
      const descriptionKey = `# ${key} description`;
      args[descriptionKey] = param.description.replace(/\n/g, ' ');
    }

    const argKey = key;
    args[argKey] = param.type;
  });

  const argStrRaw = dump({
    'FUNCTION ARGUMENTS': args,
  });
  const argStr = convertToYamlWComments(argStrRaw);
  const cmdString = `NAME: ${tool.name}:
DESCRIPTION: ${tool.description.replace(/\n/g, ' ')}
${argStr}
REQUIRED: ${[...requiredProperties].join(', ')}`;
  return cmdString;
}

export function summarizeTools(
  toolIDs: string[],
  tools: Record<string, ToolBase>,
) {
  const toolStr = toolIDs
    .map((t) => {
      const tool = getTool(tools, t);
      const toolStr = convertToToolCommandString(tool);
      return toolStr;
    })
    .join('\n---\n');

  return `-----\n${toolStr}\n-----`;
}
