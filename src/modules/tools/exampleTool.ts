import { arbitraryFunction, Tool } from '../taskyon/tools';

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
