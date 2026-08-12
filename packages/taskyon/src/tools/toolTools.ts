import type { JSONSchema7 } from 'json-schema'
import type { JSONSchema } from 'json-schema-to-ts'
import type { ToolManager } from '../core/toolManager'
import { craeteToolJsonSchema } from '../core/tools'
import { createTool, toolCall } from '../types/toolApi'
import { ToolBase } from '../types/tools'
import type { TaskNode } from '../types/taskNode'
import { createChatCompletionTask } from '../api'

const INTERNAL_AGENT_TOOL_NAMES = new Set([
  'chatCompletion',
  'chatCompletionRetryDelay',
  'entryNode',
  'taskyonFlow',
])

export type AgentToolCatalogEntry = {
  name: string
  description: string
  kind: 'tool' | 'dag-node'
}

export const resolveAgentToolCatalog = (
  tools: Readonly<Record<string, ToolBase>>,
  unavailableToolNames: ReadonlySet<string> = new Set(),
): AgentToolCatalogEntry[] =>
  Object.values(tools)
    .filter(
      (tool) => !INTERNAL_AGENT_TOOL_NAMES.has(tool.name) && !unavailableToolNames.has(tool.name),
    )
    .map(({ name, description, source }) => ({
      name,
      description,
      kind: source?.kind ?? 'tool',
    }))

export const resolveInitialAgentToolCatalog = (
  tools: Readonly<Record<string, ToolBase>>,
  taskChain: readonly TaskNode[],
  unavailableToolNames: ReadonlySet<string> = new Set(),
  allowedToolNames: readonly string[] = [],
  recentDagLimit = 5,
): AgentToolCatalogEntry[] => {
  const catalog = resolveAgentToolCatalog(tools, unavailableToolNames)
  const byName = new Map(catalog.map((tool) => [tool.name, tool]))
  const ordinary = catalog.filter((tool) => tool.kind === 'tool')
  const recentDag: AgentToolCatalogEntry[] = []
  const seen = new Set<string>()

  for (const name of allowedToolNames) {
    const tool = byName.get(name)
    if (!tool || tool.kind !== 'dag-node' || seen.has(name)) continue
    seen.add(name)
    recentDag.push(tool)
  }

  for (const task of [...taskChain].reverse()) {
    if (recentDag.length >= recentDagLimit || task.content.type !== 'functioncall') continue
    const name = task.content.data.name
    const tool = byName.get(name)
    if (!tool || tool.kind !== 'dag-node' || seen.has(name)) continue
    seen.add(name)
    recentDag.push(tool)
  }

  return [...ordinary, ...recentDag]
}

const searchCatalogEntries = (
  catalog: readonly AgentToolCatalogEntry[],
  query: string,
  limit: number,
): AgentToolCatalogEntry[] => {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return catalog.slice(0, limit)

  return catalog
    .map((tool) => {
      const name = tool.name.toLowerCase()
      const haystack = `${name} ${tool.description.toLowerCase()}`
      const matches = terms.filter((term) => haystack.includes(term)).length
      const score = matches * 10 + (terms.some((term) => name.includes(term)) ? 5 : 0)
      return { tool, score }
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name),
    )
    .slice(0, Math.max(1, limit))
    .map(({ tool }) => tool)
}

export const searchAgentToolCatalog = (
  tools: Readonly<Record<string, ToolBase>>,
  query: string,
  limit = 10,
  unavailableToolNames: ReadonlySet<string> = new Set(),
): AgentToolCatalogEntry[] =>
  searchCatalogEntries(resolveAgentToolCatalog(tools, unavailableToolNames), query, limit)

export const createToolSearcher = (
  toolManager: ToolManager,
  resolveToolCatalog: (
    tools: Readonly<Record<string, ToolBase>>,
  ) => AgentToolCatalogEntry[] = resolveAgentToolCatalog,
) =>
  createTool({
    name: 'toolSearcher',
    description: `You can use this tool to do the following:
- Search tool names and concise descriptions.
- Get a list of all tool names.
- Get the definition of a single tool including source code, if available. (not case sensitive)`,
    longDescription: `You can use this tool to do the following:
- Search tool names and concise descriptions, including projected DAG nodes.
- Get a list of all tool names.
- Get the definition of a single tool including source code, if available. (not case sensitive)

We can not provide the code from 'internal tools' as the code has been minified with webpack and
is now unreadable.
`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search tool names and concise descriptions across the available catalog.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 10,
          description: 'Maximum number of concise search matches to return.',
        },
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
          default: true,
          description: `Continue through the entry node so the result is interpreted and surfaced as a final answer. Set false only when the raw tool-result task is the intended terminal output.`,
        },
      },
      required: [],
    } as const satisfies JSONSchema7,
    function: async ({ query, limit, toolName, withCode, analyze }, ctx) => {
      const allTools = await toolManager.listToolDefinitions(true)
      const searchableTools = withCode
        ? Object.fromEntries(Object.entries(allTools).filter(([, tool]) => !!tool.code))
        : allTools
      const normalizedTools = Object.keys(searchableTools).reduce(
        (acc, key) => {
          acc[key.toLowerCase()] = searchableTools[key]!
          return acc
        },
        {} as Record<string, (typeof searchableTools)[keyof typeof searchableTools]>,
      )
      console.log('searching for tools: ', toolName)

      const toolList = resolveToolCatalog(searchableTools)

      let result: unknown
      if (toolName && normalizedTools[toolName.toLowerCase()]) {
        result = {
          'Here is the requested tool definition': normalizedTools[toolName.toLowerCase()],
        }
      } else if (query) {
        result = {
          'Here are the matching tools': searchCatalogEntries(toolList, query, limit ?? 10),
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

export const createAddNewTool = (toolManager: ToolManager) =>
  createTool({
    name: 'addNewTool',
    description: 'Validates and registers a new tool with taskyon.',
    longDescription: `This tool takes a tool definition, validates it and registers it with taskyon.
If you need examples of how to create tools, you can use the toolSearcher to retrieve
existing tool definitions, including their source code when available. Additionally, you can use the toolCreationWizard
to get some more general information how to create tools.`,
    parameters: craeteToolJsonSchema() as JSONSchema7 &
      Record<string, unknown> &
      Readonly<JSONSchema>,
    function: async (toolDef: unknown) => {
      const toolDefinition = ToolBase.parse(toolDef)
      return await toolManager.installTool(toolDefinition)
    },
  })

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
          appendSystemPrompts: [
            `You need to retrieve an example of an existing tool in order to help you to create the new tool.
If there are none that are similar just make a guess which tool code might be helpful to you!
From the list of tools you just extracted with the toolSearcher, you have to choose one!
Explain in one sentence, why you are choosing this tool.
`,
          ],
        }),
        createChatCompletionTask({
          appendSystemPrompts: [
            `- Use the toolSearcher function again. You are required to use it.
- Use the name you selected for the "toolName" argument in the "toolSearcher" tool`,
          ],
          allowedTools: ['toolSearcher'],
        }),
        createChatCompletionTask({
          appendSystemPrompts: [
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

async function mcpRpcRequest(
  fetcher: typeof fetch,
  url: string,
  id: number,
  method: string,
  params?: unknown,
) {
  const response = await fetcher(url, {
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

export const createMcpToolImporter = (toolManager: ToolManager) =>
  createTool({
    name: 'importMcpTools',
    description:
      'Fetch tools from an MCP server and register them as Taskyon tools so they can be used in chat.',
    longDescription: `Use this tool when the user asks to add or install tools from an MCP server.
It calls initialize + tools/list on the provided MCP endpoint, maps MCP tool schemas
to Taskyon tool definitions, and installs immutable revisions in the tool registry.`,
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
      if (!ctx.fetch) throw new Error('MCP import requires the mediated fetch capability.')
      await mcpRpcRequest(ctx.fetch, serverUrl, 1, 'initialize', {
        protocolVersion: '2024-11-05',
        clientInfo: { name: 'taskyon-tool-importer', version: '0.5.1' },
        capabilities: {},
      })
      await mcpRpcRequest(ctx.fetch, serverUrl, 2, 'notifications/initialized')
      const toolsResponse = await mcpRpcRequest(ctx.fetch, serverUrl, 3, 'tools/list')

      const allTools = parseMcpToolsFromPayload(toolsResponse)
      const requestedNames = new Set((toolNames || []).map((n) => n.toLowerCase()))
      const selectedTools =
        requestedNames.size === 0
          ? allTools
          : allTools.filter((tool) => requestedNames.has(tool.name.toLowerCase()))

      const taskyonTools = selectedTools.map((tool) =>
        mapImportedMcpToolToTaskyonTool(tool, serverName || serverUrl),
      )

      const installedTools = await Promise.all(
        taskyonTools.map((tool) => toolManager.installTool(tool)),
      )
      return {
        serverUrl,
        totalToolsOnServer: allTools.length,
        importedToolsCount: installedTools.length,
        importedTools: installedTools,
        requestedToolNames: toolNames || [],
      }
    },
  })
