import type { taskResult } from '../taskyon/tools'
import { craeteToolJsonSchema, createTool, createToolTask, makeTaskResult } from '../taskyon/tools'
import { ToolBase } from '../taskyon/types'
import { createChatCompletionTask } from './chatCompletionTool'
import { type TyTaskManager } from '../taskyon/taskManager'
import { match, P } from 'ts-pattern'
import { safeYamlDump } from '../yamlUtils'

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
          'Here are the currently available tools you can inspect': toolList,
        }
      } else {
        result = {
          'Here are the currently available tools you can inspect': toolList,
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

export const toolCreationWizard = createTool({
  parameters: {
    type: 'object',
    properties: {},
  } as const,
  function: () => {
    // "undefined" is the first step and how we start :)
    console.log('starting function creation wizard')

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
            `You need to retrieve an example of an existing tool in order to help you to create the new tool.
If there are none that are similar just make a guess which tool code might be helpful to you!
From the list of tools you just extracted with the toolSearcher, you have to choose one!
Explain in one sentence, why you are choosing this tool.
`,
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
        createChatCompletionTask({
          prompts: [
            `Now, with the examples given to you, can you create a new tool using the "addNewTool" function?.
Please make sure to give your response in {format} format.

Here is the schema:  {schema}

No comments, no surrounding text.
Just pure {format} which we can parse. make sure that you follow the schema you
were given for this.`,
          ],
          allowedTools: ['addNewTool'],
          goal: 'ChooseTool',
        }),
        {
          role: 'assistant',
          content: {
            type: 'message',
            data: "Nice! It looks like we're done, now please start testing the tool!",
          },
        },
      ],
    ])
  },
  description: 'Wizard for guiding LLMs in creating new tool definitions step-by-step.',
  longDescription: `A multi-step wizard that assists an LLM in creating new tool definitions.
It leverages examples from existing tools—including their source code when available—to
 guide the LLM through generating a new tool. Starting with schema creation and example
 retrieval, the wizard then prompts for a complete YAML-formatted tool definition.
 Use this tool to streamline and standardize the creation of new tools.`,
  name: 'toolCreationWizard',
})

export const createChooseTool = (taskManager: TyTaskManager) =>
  createTool({
    name: 'chooseTool',
    renderOptions: { hideChat: true, hideLlm: false },
    description: 'Chooses and parameterizes a tool for execution based on provided context.',
    longDescription: `This tool first gathers a short list of all available tools (name and description only).
It then selects one or more tools that seem relevant by checking if their names appear in the provided context.
Finally, it creates a chat completion task with the selected tools in the allowed list.`,
    parameters: {
      type: 'null',
    } as const,
    function: async (params, { taskChain }) => {
      console.log('choose tool!')
      // use pattern matching on the last task
      const result = await match(taskChain.at(-2))
        .returnType<taskResult | Promise<taskResult>>()
        .with({ content: { data: P.string } }, async () => {
          console.log('1. Retrieve all tools and create a short list (only name and description).')
          const allTools = await taskManager.updateToolDefinitions(true)
          const toolList = Object.values(allTools).map((t) => ({
            name: t.name,
            description: t.description,
          }))
          const toolNum = 3
          return makeTaskResult([
            [
              createChatCompletionTask({
                prompts: [
                  `
      Here is list of all the tools which are available to you:

      ${safeYamlDump(toolList)}

      Can you please choose ${toolNum} of these which you think might be relevant for this
      task. Only choose one if you think it would help you to solve the task.

      Examples are:
      - something that you can't answer with pure text
      - a math problem
      - something that requires an API call
      - ... and more! make sure to think about it!

      If you are sure that none of the tools are relevant, you can simply respond with "no".
      `,
                ],
                schema: {
                  anyOf: [
                    {
                      type: 'string',
                      description:
                        'If you think that no tool is relevant, simply respond with "no".',
                      enum: ['no'],
                    },
                    {
                      type: 'array',
                      description: 'List of tool names you think might be relevant',
                      items: {
                        type: 'string',
                      },
                    },
                  ],
                },
              }),
              createToolTask({ name: 'chooseTool', arguments: {} }),
            ],
          ])
        })
        .with({ content: { type: 'structured', data: 'no' } }, () => {
          return makeTaskResult([
            [
              createChatCompletionTask({
                goal: 'SimpleCompletion',
              }),
            ],
          ])
        })
        .with(
          { content: { type: 'structured', data: P.array(P.string) } },
          ({ content: { data: toolsChosen } }) => {
            return makeTaskResult([
              [
                createChatCompletionTask({
                  goal: 'ChooseTool',
                  prompts: ['Please use one of the tools you chose earlier'],
                  allowedTools: toolsChosen,
                }),
              ],
            ])
          },
        )
        .otherwise(() => {
          throw new Error(
            'we need a preceding message task in order to proceed with this function!',
          )
        })
      return result
    },
  })
