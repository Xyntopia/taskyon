import { createTool } from '@taskyon/taskyon/api'
import type { WorkspaceOperations } from '@taskyon/taskyon/tools/workspaceTools'

type ExplorationContext = Record<string, string>

type ExplorationRequest = {
  action: 'list' | 'search' | 'grep' | 'view'
  query?: string
  path?: string
  limit?: number
  startLine?: number
  endLine?: number
}

type ExplorationArgs = Omit<ExplorationRequest, 'action'> & {
  action: ExplorationRequest['action'] | 'inspect' | 'add' | 'context' | 'clear_context'
  operations?: ExplorationRequest[]
}

const MAX_INSPECT_OPERATIONS = 8
const MAX_READ_CHARS = 200_000
const MAX_INSPECT_READ_CHARS = Math.floor(MAX_READ_CHARS / MAX_INSPECT_OPERATIONS)

const clampLimit = (limit: number | undefined, fallback = 50) =>
  Math.max(1, Math.min(Math.trunc(limit ?? fallback), 500))

const readChunk = async (
  workspace: WorkspaceOperations,
  path: string,
  startLine?: number,
  endLine?: number,
  maxChars = MAX_READ_CHARS,
) => {
  const result = await workspace.read(path)
  const lines = result.content.replace(/\r\n?/g, '\n').split('\n')
  const start = Math.max(1, Math.trunc(startLine ?? 1))
  const end = Math.min(lines.length, Math.max(start, Math.trunc(endLine ?? start + 199)))
  const selected = lines.slice(start - 1, end).join('\n')
  return {
    content: selected.slice(0, maxChars),
    endLine: end,
    lineCount: lines.length,
    path,
    startLine: start,
    truncated: selected.length > MAX_READ_CHARS,
  }
}

const runReadOnlyRequest = async (
  workspace: WorkspaceOperations,
  request: ExplorationRequest,
  maxReadChars = MAX_READ_CHARS,
) => {
  const limit = clampLimit(request.limit)
  if (request.action === 'view') {
    if (!request.path) throw new Error('path is required for view action')
    return await readChunk(
      workspace,
      request.path,
      request.startLine,
      request.endLine,
      maxReadChars,
    )
  }
  if (request.action === 'grep') {
    if (!request.query?.trim()) throw new Error('query is required for grep action')
    const matches = await workspace.grep({
      pattern: request.query,
      ...(request.path ? { path: request.path } : {}),
      limit,
    })
    return { matches, count: matches.length }
  }
  const files = await workspace.find({
    pattern: '**',
    ...(request.path ? { path: request.path } : {}),
    limit: request.action === 'search' ? Math.min(limit * 10, 1_000) : limit,
  })
  const query = request.query?.trim().toLowerCase()
  const filtered = query ? files.filter((file) => file.toLowerCase().includes(query)) : files
  return { files: filtered.slice(0, limit), count: Math.min(filtered.length, limit) }
}

export function formatExplorationContext(contextFiles: ExplorationContext) {
  const keys = Object.keys(contextFiles)
  if (keys.length <= 0) return ''
  const body = keys
    .slice(0, 20)
    .map((filePath) => {
      const content = contextFiles[filePath] ?? ''
      const clipped = content.split('\n').slice(0, 120).join('\n')
      return `### ${filePath}\n\n\`\`\`\n${clipped}\n\`\`\``
    })
    .join('\n\n')
  return `Loaded file context (${keys.length} files):\n\n${body}`
}

export function createExplorationTool(
  contextFiles: ExplorationContext,
  workspace: WorkspaceOperations,
) {
  return createTool({
    name: 'exploration',
    description:
      'Perform bounded workspace discovery, search, focused reads, and explicit context loading.',
    longDescription:
      'Use inspect to group up to eight independent known reads or searches. This tool does not execute shell commands, edit files, or form a nested workflow from intermediate results.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'search', 'grep', 'view', 'inspect', 'add', 'context', 'clear_context'],
        },
        query: { type: 'string' },
        path: { type: 'string' },
        limit: { type: 'integer', default: 50, minimum: 1, maximum: 500 },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_INSPECT_OPERATIONS,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['action'],
            properties: {
              action: { type: 'string', enum: ['list', 'search', 'grep', 'view'] },
              query: { type: 'string' },
              path: { type: 'string' },
              limit: { type: 'integer', minimum: 1, maximum: 500 },
              startLine: { type: 'integer', minimum: 1 },
              endLine: { type: 'integer', minimum: 1 },
            },
          },
        },
      },
    } as const,
    function: async (args: ExplorationArgs) => {
      if (args.action === 'clear_context') {
        Object.keys(contextFiles).forEach((path) => delete contextFiles[path])
        return { cleared: true }
      }
      if (args.action === 'context') {
        const files = Object.keys(contextFiles)
        return {
          files,
          count: files.length,
          chars: files.reduce((total, path) => total + (contextFiles[path]?.length ?? 0), 0),
        }
      }
      if (args.action === 'add') {
        if (!args.path) throw new Error('path is required for add action')
        const chunk = await readChunk(workspace, args.path, args.startLine, args.endLine)
        contextFiles[chunk.path] = chunk.content
        return {
          added: chunk.path,
          chars: chunk.content.length,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
        }
      }
      if (args.action === 'inspect') {
        if (!args.operations?.length) throw new Error('operations are required for inspect action')
        const results = await Promise.all(
          args.operations.slice(0, MAX_INSPECT_OPERATIONS).map(async (request) => ({
            request,
            result: await runReadOnlyRequest(
              workspace,
              { ...request, limit: Math.min(request.limit ?? 50, 50) },
              MAX_INSPECT_READ_CHARS,
            ),
          })),
        )
        return { results, count: results.length }
      }
      return await runReadOnlyRequest(workspace, args as ExplorationRequest)
    },
  })
}
