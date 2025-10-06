import type { JSONSchema7 } from 'json-schema'
import type { JSONSchema } from 'json-schema-to-ts'
import { match, P } from 'ts-pattern'
import { type TyTaskManager } from '../core/taskManager'
import { craeteToolJsonSchema } from '../core/tools'
import type { taskResult } from '../types/toolApi'
import { createTool, makeTaskResult, toolCall } from '../types/toolApi'
import { ToolBase } from '../types/tools'
import { safeYamlDump } from '../utils/yamlUtils'
import { createChatCompletionTask } from './chatCompletionTool'

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
    } as const satisfies JSONSchema7,
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

export const createAddNewToolTool = () => {
  const toolJsonSchema = craeteToolJsonSchema()
  return createTool({
    name: 'addNewTool',
    description: 'Validates and registers a new tool with taskyon.',
    longDescription: `This tool takes a tool definition, validates it and registers it with taskyon.
If you need examples of how to create tools, you can use the toolSearcher to retrieve
existing tool definitions, including their source code when available. Additionally, you can use the toolCreationWizard
to get some more general information how to create tools.`,
    parameters: toolJsonSchema as JSONSchema7 & Record<string, unknown> & Readonly<JSONSchema>,
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
  })
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
        toolCall({
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
            `
You can return different types of tasks by calling makeTaskResult.
makeTaskResult accepts a list of task *chains* (an array of arrays of tasks).
• Each individual chain (an inner array) runs its tasks sequentially.
• Multiple chains run in parallel.
If you simply return a result without makeTaskResult, Taskyon will analyze it and decide what to do next automatically.

Here are the task types you can emit:
- MessageContent, StructuredContent, ToolCallContent, UploadedFilesContent, ToolResultContent, ToolDefinition, ErrorContent, Return

If you want to display the result of a function in a specific way, you can use th following structure:

return makeTaskResult([[
  {
    role: 'assistant',
    content: {
      type: 'message',
      data: <A MARKDOWN STRING PRESENTING THE RESULT (Full HTML is allowed, don't use html fence blocks!)>,
    },
  },
]])

It is important to remove indentation from the HTML code so that markdown doesn't recognize it as a code block.

Now, with the examples given to you, can you create a new tool using the "addNewTool" function?.
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
    renderOptions: { hideChat: true, hideLlm: true },
    description: 'Chooses and parameterizes a tool for execution based on provided context.',
    longDescription: `This tool first gathers a short list of all available tools (name and description only).
It then selects one or more tools that seem relevant by checking if their names appear in the provided context.
Finally, it creates a chat completion task with the selected tools in the allowed list.`,
    parameters: {
      type: 'object',
      properties: {
        useTools: {
          type: 'boolean',
          description:
            'Optional. Set to true if we want to use tools, otherwise we will do a simple chat completion.',
          default: false,
        },
        llmTools: {
          type: 'boolean',
          description: `Optional Parameter. If set to true, we will make use of taskyons
tool Selection capabilities, otherwise we will use an openai compatible tool api`,
          default: true,
        },
        webSearch: {
          type: 'boolean',
          description:
            'Optional Parameter. If set to true taskyon will attempt to use the native web search abilities from various LLM providers.',
        },
      },
    } as const,
    function: async ({ llmTools, webSearch, useTools }, { taskChain }) => {
      const pattern = { ...taskChain.at(-2), webSearch, useTools }
      console.log('choose tool!', pattern)
      // use pattern matching on the last task
      const result = await match(pattern)
        .returnType<taskResult | Promise<taskResult>>()
        // if we only have a simple user message with no tools, alwa
        .with(
          { content: { type: 'message', data: P.string }, webSearch: true, useTools: P.any },
          {
            content: { type: 'message', data: P.string },
            webSearch: P.any,
            useTools: P.not(true),
          },
          ({ webSearch }) => {
            const goal = webSearch ? 'WebSearch' : 'SimpleCompletion'
            console.log('Do a simple direct chatCOmpletion query!', { goal })
            // TODO: in the case useTools are enabled, maybe afterwards add another tool Chooser?
            return makeTaskResult(createChatCompletionTask({ goal }))
          },
        )
        // any other string...
        .with(
          { content: { type: 'message', data: P.string }, webSearch: P.not(true), useTools: true },
          async () => {
            console.log(
              '1. Retrieve all tools and create a short list (only name and description).',
            )
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
                    `Here is list of all the tools which are available to you:

${safeYamlDump(toolList)}

Can you please choose ${toolNum} of these which you think might be relevant for this
task. Only choose one if you think it would help you to solve the task.

Examples are:
- something that you can't answer with pure text
- a math problem
- something that requires an API call
- ... and more! make sure to think about it!

If you are sure that none of the tools are relevant, your choice should be simple string "no".`,
                  ],
                  llmTools,
                  schema: {
                    type: 'object',
                    properties: {
                      reasoning_steps: {
                        type: 'array',
                        items: {
                          type: 'string',
                        },
                        description: 'The reasoning steps leading to the final conclusion.',
                      },
                      choice: {
                        anyOf: [
                          {
                            enum: ['no'],
                            description:
                              'If you are sure no tools are required for an answer, choose "no" as an answer instead of a list!',
                          },
                          {
                            type: 'array',
                            description: 'List of tool names you think might be relevant',
                            items: {
                              type: 'string',
                            },
                            // we are not using this, in order to make our tool more robust...
                            // sometimes, the LLM will select fewer tools than we expect
                            //minItems: toolNum,
                            // TODO: in chatGPT "strict" mode, maxItems will not work...
                            //maxItems: toolNum, // we always leave this here though in order to prevent too many tools being shown in the next step...
                          },
                        ],
                      },
                    },
                    additionalProperties: false,
                    required: ['reasoning_steps', 'choice'],
                  },
                }),
                toolCall({ name: 'chooseTool', arguments: { llmTools } }),
              ],
            ])
          },
        )
        .with(
          {
            content: {
              type: 'structured',
              data: {
                reasoning_steps: P.optional(P._),
                choice: P.union('no', P.array('no')),
              },
            },
            useTools: P.any,
            webSearch: P.any,
          },
          () => {
            console.log('2. No tools required, just return a simple completion task')
            return makeTaskResult([[createChatCompletionTask({ goal: 'SimpleCompletion' })]])
          },
        )
        .with(
          {
            content: {
              type: 'structured',
              data: {
                reasoning_steps: P.optional(P._),
                choice: P.select(P.array(P.string)),
              },
            },
            useTools: P.any,
            webSearch: P.any,
          },
          (choice) => {
            const filteredChoice = choice.filter((tool) => tool !== 'no')
            return makeTaskResult([
              [
                createChatCompletionTask({
                  goal: 'ChooseTool',
                  prompts: ['Please use one of the tools you chose earlier'],
                  allowedTools: filteredChoice,
                  llmTools,
                }),
              ],
            ])
          },
        )
        //.exhaustive()
        .otherwise(() => {
          throw new Error(
            'we need a preceding message task in order to proceed with this function!',
          )
        })

      return result
    },
  })
