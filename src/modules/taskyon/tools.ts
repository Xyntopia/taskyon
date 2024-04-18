import { useVectorStore } from 'src/modules/localVectorStore';
import type { PythonScriptResult } from './pyodide';
import { dump } from 'js-yaml';
import { bigIntToString } from './chat';
import { asyncRunPython } from 'src/modules/taskyon/webWorkerApi';
import {
  TaskResult,
  convertToYamlWComments,
  YamlRepresentation,
} from './types';
import { z } from 'zod';
import { toolStateType, FunctionCall, ParamType } from './types';

export const vectorStore = useVectorStore();

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

const JSONSchemaForFunctionParameter: z.ZodType<JSONSchemaForFunctionParameter> =
  z.object({
    $schema: z.string().optional(),
    type: z.literal('object'),
    properties: z.record(
      z.object({
        type: z.string(),
        description: z.string().optional(),
        default: z.unknown().optional(),
        items: z
          .lazy(() =>
            z.union([
              JSONSchemaForFunctionParameter,
              z.array(JSONSchemaForFunctionParameter),
            ])
          )
          .optional(),
      })
    ),
    required: z.array(z.string()).optional(),
  });

const ToolDescription = z.object({
  state: z.union([
    z.function().returns(z.promise(toolStateType)),
    z.function().returns(toolStateType),
    toolStateType,
  ]),
  description: z.string(),
  longDescription: z.string().optional(),
  name: z.string(),
  parameters: JSONSchemaForFunctionParameter,
});
export type ToolDescription = z.infer<typeof ToolDescription>;

const arbitraryFunctionSchema = z.custom<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]) => unknown | Promise<unknown>
>((val) => typeof val === 'function', {
  message:
    'Expected a function that accepts any arguments and returns unknown or Promise<unknown>',
});
export type arbitraryFunction = z.infer<typeof arbitraryFunctionSchema>;

const Tool = ToolDescription.extend({
  function: arbitraryFunctionSchema,
});
const ToolCode = ToolDescription.extend({
  Code: z.string(), // this type is used in order to dynamically store tools
});
export type Tool = z.infer<typeof Tool>;
export type ToolCode = z.infer<typeof ToolCode>;

// ToolCollection schema and type
const ToolCollection = z.record(Tool);
export type ToolCollection = z.infer<typeof ToolCollection>;

export async function handleFunctionExecution(
  func: FunctionCall,
  tools: ToolCollection
): Promise<TaskResult> {
  try {
    let funcR: unknown = await tools[func.name].function(func.arguments);
    funcR = bigIntToString(funcR);
    const result: TaskResult = {
      type: 'ToolResult',
      toolResult: { result: dump(funcR) },
    };
    return result;
  } catch (error) {
    return {
      type: 'ToolError',
      toolResult: { error: JSON.stringify(error) },
    };
  }
}

export const localVectorStoreSearch: Tool = {
  state: () => 'available',
  function: async ({ searchTerm }: { searchTerm: string }) => {
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

export const executePythonScript: Tool = {
  state: () => 'available',
  function: async ({
    pythonScript,
  }: {
    pythonScript: string;
  }): Promise<PythonScriptResult> => {
    console.log('execute python code...');
    return await asyncRunPython(pythonScript);
  },
  description: `Executes Python scripts for data processing, calculations, or library interactions, 
ideal for data analysis, machine learning tasks, or custom algorithm execution.
It's important to structure the Python code such that the desired result
is the outcome of the last expression in the script. Outcomes should be of the types String, Number, Array, Map, Set.`,
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

// the following tool is "self-referential" and because of this we can not initialize it yet
// we instead write a factory function which creates this tool using a reference to our tools
// variable
export function createToolExampleTool(tools: ToolCollection): Tool {
  // used to get the code from our tools :)
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
  function getFunctionSignature(func: arbitraryFunction | string) {
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

  const getToolExample: Tool = {
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

export function getDefaultParametersForTool(tool: Tool) {
  const params = tool.parameters;
  if (!params || !params.properties) {
    console.log(`No parameters defined for tool ${tool.name}.`);
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

export interface WorkerMessage {
  success: boolean;
  result?: unknown;
  error?: string;
}

function convertToToolCommandString(tool: ToolDescription): string {
  // convert a tool into a schema which is compatible ti toolCommandChat
  const args: YamlRepresentation = {};

  const requiredProperties = new Set(tool.parameters.required || []);

  // Loop over each property in the tool's parameters
  for (const key in tool.parameters.properties) {
    const param = tool.parameters.properties[key];
    // Check if the key is in the list of required properties
    const isRequired = requiredProperties.has(key);
    // If the property is required, use the key as is, otherwise add a "?" to the key
    if (param.description) {
      const descriptionKey = `# ${key} description`;
      args[descriptionKey] = param.description.replace(/\n/g, ' ');
    }
    const argKey = isRequired ? key : `${key}?`;
    args[argKey] = param.type;
  }

  const objrepr: YamlRepresentation = {
    '# description': tool.description.replace(/\n/g, ' '),
    name: tool.name,
    args,
  };
  const yamlSchema = convertToYamlWComments(dump(objrepr));
  return yamlSchema;
}

export function summarizeTools(toolIDs: string[], tools: ToolCollection) {
  const toolStr = toolIDs
    .map((t) => {
      const tool = tools[t];
      const toolStr = convertToToolCommandString(tool);
      return toolStr;
    })
    .join('\n---\n');

  return toolStr;
}
