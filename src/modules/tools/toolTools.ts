import type { taskResult } from '../taskyon/tools'
import { craeteToolJsonSchema, createTool, createToolTask, makeTaskResult } from '../taskyon/tools'
import { match, P } from 'ts-pattern'
import { TaskProcessingError, ToolBase } from '../taskyon/types'
import { createChatCompletionTask } from './chatCompletionTool'
import { dump } from 'js-yaml'
import { type TyTaskManager } from '../taskyon/taskManager'

export const createToolSearcher = (taskManager: TyTaskManager) =>
  createTool({
    name: 'toolSearcher',
    description: `You can use this tool to do the following:
- Get a list of all tool names.
- Get the definition of a single tool including source code, if available. (not case sensitive)`,
    longDescription: `You can use this tool to do the following:
- Get a list of all tool names.
- Get the definition of a single tool including source code, if available. (not case sensitive)

We can not provide the code from 'internal tools' as the code has been minified with webpack and
is now unreadable.
`,
    parameters: {
      type: 'object',
      properties: {
        toolName: {
          type: 'string',
          default: undefined,
          description: `- If toolname is provided: return complete tool definition for tool with the same name.
- If undefined: return a list of all tools only with descriptions`,
        },
        withCode: {
          type: 'boolean',
          default: false,
          description: `Only show tools where the js code is available.`,
        },
        analyze: {
          type: 'boolean',
          default: false,
          description: `Automatically interpret the result with an AI.`,
        },
      },
      required: [],
    } as const,
    function: async ({ toolName, withCode, analyze }) => {
      const allTools = await taskManager.updateToolDefinitions(true)
      if (withCode) {
        for (const key in allTools) {
          if (!allTools[key]!.code) {
            delete allTools[key]
          }
        }
      }
      const normalizedTools = Object.keys(allTools).reduce(
        (acc, key) => {
          acc[key.toLowerCase()] = allTools[key]!
          return acc
        },
        {} as Record<string, (typeof allTools)[keyof typeof allTools]>,
      )
      console.log('searching for tools: ', toolName)

      const toolList = Object.values(allTools).map((t) => ({
        name: t.name,
        description: t.description,
      }))

      let result: unknown
      if (toolName && normalizedTools[toolName.toLowerCase()]) {
        result = {
          'Here is the requested tool definition': normalizedTools[toolName.toLowerCase()],
        }
      } else if (toolName) {
        result = {
          "This tool doesn't exist": toolName,
          'Here are the available tools to inspect': toolList,
        }
      } else {
        result = {
          'Here are the available tools to inspect': toolList,
        }
      }

      if (analyze) {
        return result
      } else {
        return makeTaskResult([
          [
            {
              role: 'system',
              content: { type: 'toolresult', data: result },
            },
          ],
        ])
      }
    },
  })

export const createAddNewToolTool: () => Promise<ToolBase> = async () => {
  const toolJsonSchema = await craeteToolJsonSchema()
  return {
    name: 'addNewTool',
    description: 'Validates and registers a new tool with taskyon.',
    longDescription:
      'This tool takes a tool definition, validates it and registers it with taskyon.',
    parameters: toolJsonSchema,
    function: (toolDef: unknown) => {
      const toolDefinition = ToolBase.parse(toolDef)
      return makeTaskResult([
        [
          {
            role: 'assistant',
            content: { type: 'tooldefinition', data: toolDefinition },
          },
        ],
      ])
    },
  }
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
        enum: ['start', 'parsing'],
        description: 'Use "start" if we want to create a new tool...',
      },
    },
  } as const,
  // TODO: add an option to search for similar tools first...
  // TODO: use "P" from ts-match to automatically select the correct steps etc...
  function: ({ step }, { taskChain }) =>
    match(step)
      .returnType<taskResult | Promise<taskResult>>()
      // "undefined" is the first step and how we start :)
      .with(P.union(P.nullish, P.string.includes('init'), P.string.includes('start')), async () => {
        console.log('starting function creation wizard')
        console.log('Prompting for tool creation...')

        const toolJsonSchema = await craeteToolJsonSchema()

        return makeTaskResult([
          [
            {
              role: 'assistant',
              content: {
                type: 'message',
                data: 'I am gathering examples from tools with code for the tool requested by the user...',
              },
            },
            createToolTask({
              name: 'toolSearcher',
              arguments: { withCode: true, analyze: false },
            }),
            createChatCompletionTask({
              prompts: [
                `You need to retrieve examples of existing tools in order to help you creating a new tool.
From the list of tools you extracted earlier, which tool is the one closest to what the user would like to have?`,
              ],
              goal: 'SimpleCompletion',
            }),
            createChatCompletionTask({
              prompts: [
                `- Use the toolSearcher function again. You are required to use it.
- Use the name you selected for the "toolName" argument in the "toolSearcher" tool`,
              ],
              allowedTools: ['toolSearcher'],
              goal: 'ChooseTool',
            }),
            {
              role: 'system',
              content: {
                type: 'message',
                data: `The required json schema for creating a tool looks like this:
                ${dump(toolJsonSchema)}`,
              },
            },
            createChatCompletionTask({
              prompts: [
                `Now, with the examples given to you, can you create a new tool?. Please make
    sure to give your response in yaml format. No comments, no surrounding text.
    Just pure yaml which we can parse. make sure that you follow the schema you
    were given for this.`,
              ],
              schema: toolJsonSchema,
            }),
            {
              role: 'function',
              content: {
                type: 'functioncall',
                data: { name: 'toolCreationWizard', arguments: { step: 'parsing' } },
              },
            },
          ],
        ])
      })
      .with('parsing', () => {
        console.log('Parsing the tool creation input...', taskChain.at(-1))

        const lastMessage = taskChain.at(-1)

        const toolDef = ToolBase.parse(lastMessage?.content.data)

        console.log('finished parsing new tool...', toolDef)

        return makeTaskResult([
          [
            {
              role: 'assistant',
              content: { type: 'message', data: 'I created this new tool:' },
            },
            {
              role: 'assistant',
              content: { type: 'tooldefinition', data: toolDef },
            },
          ],
        ])
      })
      .otherwise(() => {
        console.log('no state spcifi')
        throw new TaskProcessingError(
          `The tool doesn't know what to do with this step... available steps are: 'parsing', if you are just starting, don't specify any parameters... `,
        )
      }),
  description: 'Wizard for guiding LLMs in creating new tool definitions step-by-step.',
  longDescription: `A multi-step wizard that assists an LLM in creating new tool definitions.
It leverages examples from existing tools—including their source code when available—to
 guide the LLM through generating a new tool. Starting with schema creation and example
 retrieval, the wizard then prompts for a complete YAML-formatted tool definition.
 Use this tool to streamline and standardize the creation of new tools.`,
  name: 'toolCreationWizard',
})

//export type toolCreationWizardParams = FromSchema<typeof toolCreationWizard.parameters>
