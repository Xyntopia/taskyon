import type { JSONSchema7 } from 'json-schema'
import type { JSONSchema } from 'json-schema-to-ts'
import type { ToolManager } from '../core/toolManager'
import { craeteToolJsonSchema } from '../core/tools'
import { createTool } from '../types/toolApi'
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
    description:
      'Search the available tool catalog, list tool names, or retrieve one complete tool definition.',
    longDescription: `Catalog searches return concise metadata, including projected DAG-node tools. Exact-name lookup returns the stored definition and source code when code is available; trusted internal implementations may not expose useful source. Results normally re-enter the conversation for interpretation, while authoring workflows can request a raw handoff.`,
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
          description:
            'Case-insensitive exact tool name whose complete definition should be returned. Omit to search or list concise catalog entries.',
          examples: ['webResearchPlanner'],
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
    description:
      'Validate and register a complete Taskyon tool definition already present in context; use toolCreationWizard when authoring or examples are still needed.',
    longDescription: `Registration validates the complete definition, stores an immutable revision, and updates the active name binding. Existing active names are protected from accidental replacement and require explicit approval. This tool does not author, research, or test the definition it receives.`,
    parameters: (() => {
      const schema = craeteToolJsonSchema()
      return {
        ...schema,
        properties: {
          ...schema.properties,
          approveReplacement: {
            type: 'boolean',
            description:
              'Explicitly approve replacing an existing active tool with the same name. Use only when intentionally repairing or updating that exact tool.',
          },
        },
      }
    })() as JSONSchema7 & Record<string, unknown> & Readonly<JSONSchema>,
    function: async (toolDef: unknown) => {
      const { approveReplacement, ...manifest } = toolDef as {
        approveReplacement?: boolean
      } & Record<string, unknown>
      const toolDefinition = ToolBase.parse(manifest)
      return await toolManager.installTool(
        toolDefinition,
        approveReplacement === undefined ? {} : { approveReplacement },
      )
    },
  })

const findInheritedChatCompletionTrace = (taskChain: readonly TaskNode[]) =>
  [...taskChain].reverse().flatMap((task) => {
    if (task.content.type !== 'functioncall') return []
    const trace = task.content.data.arguments.trace
    if (!trace || typeof trace !== 'object' || Array.isArray(trace)) return []
    const candidate = trace as { enabled?: unknown; label?: unknown }
    if (candidate.enabled !== true) return []
    return [
      {
        enabled: true as const,
        ...(typeof candidate.label === 'string' ? { label: candidate.label } : {}),
      },
    ]
  })[0]

const findInheritedSystemPrompts = (taskChain: readonly TaskNode[]) =>
  taskChain.reduce<string[] | undefined>((fullest, task) => {
    if (task.content.type !== 'functioncall') return fullest
    const prompts = task.content.data.arguments.prependSystemPrompts
    if (!Array.isArray(prompts) || !prompts.every((prompt) => typeof prompt === 'string')) {
      return fullest
    }
    const promptLength = prompts.reduce((total, prompt) => total + prompt.length, 0)
    const fullestLength = fullest?.reduce((total, prompt) => total + prompt.length, 0) ?? -1
    return promptLength > fullestLength ? prompts : fullest
  }, undefined)

export const toolCreationWizard = createTool({
  parameters: {
    type: 'object',
    properties: {},
  } as const,
  function: async (_args, ctx) => {
    // "undefined" is the first step and how we start :)
    console.log('starting function creation wizard')
    const taskChain = await ctx.getExecutionTaskChain()
    const trace = findInheritedChatCompletionTrace(taskChain)
    const prependSystemPrompts = findInheritedSystemPrompts(taskChain)

    return ctx.createSubtasksResult([
      [
        {
          role: 'assistant',
          content: {
            type: 'message',
            data: 'I am gathering examples from tools with code for the tool requested by the user...',
          },
        },
        createChatCompletionTask({
          ...(trace ? { trace } : {}),
          ...(prependSystemPrompts ? { prependSystemPrompts } : {}),
          appendSystemPrompts: [
            `Inspect a small set of relevant existing Taskyon tools before authoring the requested tool.
Call toolSearcher with a concise semantic query derived from the current objective, limit 5,
withCode true, and analyze false. Do not request the full tool catalog.`,
          ],
          allowedTools: ['toolSearcher'],
        }),
        createChatCompletionTask({
          ...(trace ? { trace } : {}),
          ...(prependSystemPrompts ? { prependSystemPrompts } : {}),
          appendSystemPrompts: [
            `- Choose one or two relevant code-bearing examples from the preceding matches.
- Call toolSearcher for each chosen exact "toolName"; two independent calls may run in parallel.
- Set "withCode" to true and "analyze" to false so the wizard continues directly
  from the retrieved examples without starting a separate implementation branch.`,
          ],
          allowedTools: ['toolSearcher'],
        }),
        createChatCompletionTask({
          ...(trace ? { trace } : {}),
          ...(prependSystemPrompts ? { prependSystemPrompts } : {}),
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
The installed tool code runs in Taskyon's worker sandbox. It may use standard JavaScript,
fetch, URL, URLSearchParams, TextEncoder, and TextDecoder. It must not use browser-only globals
such as document, window, DOMParser, navigator, localStorage, or sessionStorage. Keep data
normalization algorithmic and dependency-free. When the tool uses fetch, await the response and
return a fully serializable value. Treat external response shapes and server-side filtering as
untrusted: validate the documented live shape, normalize fields explicitly, and enforce the
constraints promised by the generated tool's own schema. Keep failures descriptive enough for a
later workflow step to repair and re-register the same tool.
Please make sure to give your response in {format} format.

Here is the schema:  {schema}

No comments, no surrounding text.
Just pure {format} which we can parse. make sure that you follow the schema you
were given for this.`,
          ],
          allowedTools: ['addNewTool'],
        }),
        createChatCompletionTask({
          ...(trace ? { trace } : {}),
          ...(prependSystemPrompts ? { prependSystemPrompts } : {}),
          appendSystemPrompts: [
            `The preceding addNewTool call installed the tool. Inspect the current objective.
If it requests a project-local export, usage report, or verification instructions, use
updateFiles now to persist those exact artifacts. Export the installed Taskyon definition and
registration metadata from the preceding calls rather than substituting a separate script.
The export must be reinstallable: include the complete addNewTool definition exactly as
registered (name, description, longDescription, parameters, code, and any other definition
fields), plus publisherId and revision. A metadata summary without parameters and code is not
an export. When a verification command is requested, make it validate or exercise the exported
definition or installed tool rather than merely print its name.
Use project-relative filePath values and omit artifactRoot, especially when writing top-level
README, export, or usage-report files.
If no project-local artifacts were requested, answer concisely without calling a tool.`,
          ],
          allowedTools: ['updateFiles'],
        }),
        {
          role: 'assistant',
          content: {
            type: 'message',
            data: 'The Taskyon tool is registered and its requested project artifacts are handled.',
          },
        },
      ],
    ])
  },
  description:
    'Author and install a reusable Taskyon tool by inspecting relevant coded examples, generating a typed definition, and registering it with addNewTool.',
  longDescription: `Use this when the objective requires a real reusable Taskyon capability and no complete definition is ready to register. The visible workflow searches for relevant code-bearing examples, retrieves a small selected set, authors and registers the definition, then writes any explicitly requested project artifacts. A workspace script or module is not a registered Taskyon tool.`,
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
    longDescription: `The importer performs the MCP initialize and tools/list handshake through Taskyon's mediated network capability, maps each selected MCP schema into a Taskyon definition, and installs immutable local registry revisions. Imported calls still depend on the external MCP service boundary.`,
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
