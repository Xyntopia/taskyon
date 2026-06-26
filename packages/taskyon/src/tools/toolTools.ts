import type { JSONSchema7 } from 'json-schema'
import type { JSONSchema } from 'json-schema-to-ts'
import { type TyTaskManager } from '../core/taskManager'
import { craeteToolJsonSchema } from '../core/tools'
import { createTool, toolCall } from '../types/toolApi'
import { ToolBase } from '../types/tools'
import { createChatCompletionTask } from '../api'

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
    function: async ({ toolName, withCode, analyze }, ctx) => {
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
        return ctx.createSubtasksResult([
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
    function: (toolDef: unknown, ctx) => {
      const toolDefinition = ToolBase.parse(toolDef)
      return ctx.createSubtasksResult([
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
  function: (_args, ctx) => {
    // "undefined" is the first step and how we start :)
    console.log('starting function creation wizard')

    return ctx.createSubtasksResult([
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
        }),
        createChatCompletionTask({
          prompts: [
            `- Use the toolSearcher function again. You are required to use it.
- Use the name you selected for the "toolName" argument in the "toolSearcher" tool`,
          ],
          allowedTools: ['toolSearcher'],
        }),
        createChatCompletionTask({
          prompts: [
            `
You can return different types of tasks by calling createSubtasksResult.
createSubtasksResult accepts a list of task *chains* (an array of arrays of tasks).
• Each individual chain (an inner array) runs its tasks sequentially.
• Multiple chains run in parallel.
If you simply return a result without Taskyon will analyze it and decide what to do next automatically.

Here are the task types you can emit:
- MessageContent, StructuredContent, ToolCallContent, UploadedFilesContent, ToolResultContent, ToolDefinition, ErrorContent, Return

If you want to display the result of a function in a specific way, you can use th following structure:

return ctx.createSubtasksResult([[
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

type McpInputTool = {
  name: string
  description?: string
  inputSchema?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseMcpToolsFromPayload(payload: unknown): McpInputTool[] {
  if (Array.isArray(payload)) {
    return payload.filter(
      (item): item is McpInputTool => isRecord(item) && typeof item.name === 'string',
    )
  }

  if (!isRecord(payload)) return []
  if (Array.isArray(payload.tools)) return parseMcpToolsFromPayload(payload.tools)
  if (isRecord(payload.result) && Array.isArray(payload.result.tools)) {
    return parseMcpToolsFromPayload(payload.result.tools)
  }
  return []
}

function normalizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function toJsonSchema(value: unknown): Readonly<JSONSchema7> {
  if (!isRecord(value)) return { type: 'object', additionalProperties: true }
  return value as JSONSchema7
}

function mapImportedMcpToolToTaskyonTool(input: McpInputTool, sourceName?: string) {
  return ToolBase.parse({
    name: normalizeToolName(input.name),
    description:
      input.description ||
      `Imported MCP tool ${input.name}${sourceName ? ` from ${sourceName}` : ''}`,
    longDescription: sourceName
      ? `Imported from MCP server: ${sourceName}. Original tool name: ${input.name}.`
      : `Imported MCP tool. Original tool name: ${input.name}.`,
    parameters: toJsonSchema(input.inputSchema),
  })
}

async function mcpRpcRequest(url: string, id: number, method: string, params?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    }),
  })

  const body = (await response.json()) as Record<string, unknown>
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(body)}`)
  if (body.error) throw new Error(String(JSON.stringify(body.error)))
  return body
}

export const createMcpToolImporter = (taskManager: TyTaskManager) =>
  createTool({
    name: 'importMcpTools',
    description:
      'Fetch tools from an MCP server and register them as Taskyon tools so they can be used in chat.',
    longDescription: `Use this tool when the user asks to add or install tools from an MCP server.
It calls initialize + tools/list on the provided MCP endpoint, maps MCP tool schemas
to Taskyon tooldefinitions, and stores them in the task tree.`,
    parameters: {
      type: 'object',
      properties: {
        serverUrl: {
          type: 'string',
          description: 'MCP server URL, e.g. https://.../mcp',
        },
        serverName: {
          type: 'string',
          description: 'Optional source label used in imported tool descriptions.',
        },
        toolNames: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional list of tool names to import. If omitted, all tools from the MCP server are imported.',
        },
      },
      required: ['serverUrl'],
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: async ({ serverUrl, serverName, toolNames }, ctx) => {
      await taskManager.updateToolDefinitions()
      await mcpRpcRequest(serverUrl, 1, 'initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'taskyon-tool-importer', version: '0.5.1' },
        capabilities: {},
      })
      await mcpRpcRequest(serverUrl, 2, 'notifications/initialized')
      const toolsResponse = await mcpRpcRequest(serverUrl, 3, 'tools/list')

      const allTools = parseMcpToolsFromPayload(toolsResponse)
      const requestedNames = new Set((toolNames || []).map((n) => n.toLowerCase()))
      const selectedTools =
        requestedNames.size === 0
          ? allTools
          : allTools.filter((tool) => requestedNames.has(tool.name.toLowerCase()))

      const taskyonTools = selectedTools.map((tool) =>
        mapImportedMcpToolToTaskyonTool(tool, serverName || serverUrl),
      )

      return ctx.createSubtasksResult([
        [
          ...taskyonTools.map((toolDefinition) => ({
            role: 'assistant' as const,
            content: { type: 'tooldefinition' as const, data: toolDefinition },
          })),
          {
            role: 'assistant',
            content: {
              type: 'structured',
              data: {
                serverUrl,
                totalToolsOnServer: allTools.length,
                importedToolsCount: taskyonTools.length,
                importedToolNames: taskyonTools.map((t) => t.name),
                requestedToolNames: toolNames || [],
              },
            },
          },
        ],
      ])
    },
  })
