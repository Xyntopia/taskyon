import type { taskResult } from '../taskyon/tools'
import {
  createTool,
  exampleTool,
  makeTaskResult,
  type InternalTool,
  type internalToolFunctionSchema,
} from '../taskyon/tools'
import { match } from 'ts-pattern'
import { TaskProcessingError } from '../taskyon/types'
import { sleep } from '../utils'

// the following tool is "self-referential" and because of this we can not initialize it yet
// we instead write a factory function which creates this tool using a reference to our tools
// variable
// TODO: we need to give crateExampleTool the full list of tools with their *code*
// definitions. Basically it becomes a task-search tool.
// TODO:  this is a problem, if we use webpack/ts. Because we won't be able to get the original
//        source code of our tools. Therefore we need to parse our "actual" tools which we can find
//        in the task databse with *function* label.
export function createToolExampleTool(tools: Record<string, InternalTool>): InternalTool {
  // used to get the code from our tools :)
  function inspectToolCode(toolName: string) {
    const tool = tools[toolName]
    if (tool) {
      const functionCode = tool.function?.toString()
      return `Tool Name: ${toolName}\nFunction Code:\n${functionCode}`
    } else {
      return `Tool ${toolName} not found.`
    }
  }

  // Helper function to extract function signature
  function getFunctionSignature(func: internalToolFunctionSchema | string) {
    const funcString = func.toString()
    const signatureMatch = /(function\s.*?\(.*?\))|((\w+|\((.*?)\))\s*=>)/.exec(funcString)
    return signatureMatch ? signatureMatch[0] : 'function signature not found'
  }

  // Function to extract the tool object as an example, including the function signatures
  function extractToolExample(toolName: string) {
    const tool = tools[toolName]
    if (tool?.function) {
      const functionSignature = getFunctionSignature(tool.function)
      const toolExample = {
        ...tool,
        function: functionSignature,
      }
      return JSON.stringify(toolExample, null, 2) // Pretty print the JSON string
    } else {
      return `Tool ${toolName} not found.`
    }
  }

  const getToolExample: InternalTool = {
    function: ({ toolName, viewSource }: { toolName: string; viewSource: boolean }) => {
      console.log(`Fetching example for tool: ${toolName}`)
      let toolInfo
      if (viewSource) {
        toolInfo = inspectToolCode(toolName)
      } else {
        toolInfo = extractToolExample(toolName)
      }
      return toolInfo
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
          description: 'Whether to view the full source code of the tool functions.',
          default: false,
        },
      },
      required: ['toolName'],
    },
  }

  return getToolExample
}

// TODO: create a "multiStepTool" function which abstracts the steps below
//       - use a list of functions to automatically create the steps and properties
//       - with match & P.select & returning of the correct functions...
export const toolCreationWizard = createTool({
  parameters: {
    type: 'object',
    properties: {
      step: {
        type: 'string',
        enum: ['parsing'],
      },
    },
  } as const,
  // TODO: add an option to search for similar tools first...
  // TODO: use "P" from ts-match to automatically select the correct steps etc...
  function: ({ step }, { taskChain }) =>
    match(step)
      .returnType<taskResult | Promise<taskResult>>()
      // "undefined" is the first step and how we start :)
      .with(undefined, () => {
        console.log('starting function creation wizard')
        console.log('Prompting for tool creation...')
        return makeTaskResult([
          [
            {
              role: 'system',
              content: { type: 'message', data: 'successfully started tool creation!' },
            },
            {
              role: 'system',
              content: {
                type: 'functioncall',
                data: { name: 'toolCreationWizard', arguments: { step: 'parsing' } },
              },
            },
          ],
        ])
      })
      .with('parsing', async () => {
        console.log('Parsing the tool creation input...', taskChain.at(-1))
        await sleep(5000)
        console.log('finished parsing...')
        return makeTaskResult([
          [
            {
              role: 'assistant',
              content: { type: 'message', data: 'Here is an example tool:' },
            },
            {
              role: 'assistant',
              content: { type: 'tooldefinition', data: exampleTool },
            },
          ],
        ])
      })
      .otherwise(() => {
        console.log('no state spcifi')
        throw new TaskProcessingError(
          "toolCreationWizard doesn't know what to do with this step...",
        )
      }),
  description:
    "Creates a few curated tasks which help an LLM to program new tools! It doesn't need any parameters to start",
  name: 'toolCreationWizard',
})

//export type toolCreationWizardParams = FromSchema<typeof toolCreationWizard.parameters>
