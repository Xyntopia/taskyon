import { createTool, type InternalTool } from '../types/toolApi'

export type WorkspaceReadResult = {
  content: string
  revision: string | null
}

export type WorkspaceEntry = {
  path: string
  type: 'file' | 'directory'
}

export type WorkspaceMatch = {
  path: string
  line: number
  text: string
  before?: string[]
  after?: string[]
}

export type WorkspaceOperations = {
  read: (path: string) => Promise<WorkspaceReadResult>
  write: (args: {
    path: string
    content: string
    expectedRevision?: string | null
  }) => Promise<{ revision: string | null }>
  grep: (args: {
    pattern: string
    path?: string
    glob?: string
    literal?: boolean
    context?: number
    limit: number
  }) => Promise<WorkspaceMatch[]>
  find: (args: { pattern: string; path?: string; limit: number }) => Promise<string[]>
  list: (args: { path?: string; limit: number }) => Promise<WorkspaceEntry[]>
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const workspaceGlobMatches = (pattern: string, path: string) => {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '*' && pattern[index + 1] === '*' && pattern[index + 2] === '/') {
      source += '(?:.*/)?'
      index += 2
    } else if (char === '*' && pattern[index + 1] === '*') {
      source += '.*'
      index += 1
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += escapeRegex(char ?? '')
  }
  return new RegExp(`^${source}$`).test(path)
}

type Edit = { oldText: string; newText: string }

const MAX_READ_LINES = 2_000
const MAX_RESULTS = 1_000

const clamp = (value: number | undefined, fallback: number, maximum: number) =>
  Math.max(1, Math.min(Math.trunc(value ?? fallback), maximum))

const normalizeLineEndings = (value: string) => value.replace(/\r\n?/g, '\n')

const splitBom = (value: string) =>
  value.charCodeAt(0) === 0xfeff
    ? { bom: '\ufeff', content: value.slice(1) }
    : { bom: '', content: value }

const restoreLineEndings = (value: string, original: string) =>
  original.includes('\r\n') ? value.replace(/\n/g, '\r\n') : value

const summarizeMismatchContext = (content: string, search: string) => {
  const anchor = normalizeLineEndings(search)
    .split('\n')
    .find((line) => line.trim().length > 0)
    ?.trim()
  if (!anchor) return undefined
  const lines = normalizeLineEndings(content).split('\n')
  const lineIndex = lines.findIndex((line) => {
    const trimmed = line.trim()
    return line.includes(anchor) || (trimmed.length > 0 && anchor.includes(trimmed))
  })
  if (lineIndex < 0) return undefined
  const start = Math.max(0, lineIndex - 3)
  const end = Math.min(lines.length, lineIndex + 5)
  return `Current file context at lines ${start + 1}-${end}:\n${lines.slice(start, end).join('\n')}`
}

const findExactMatches = (content: string, search: string) => {
  const matches: Array<{ start: number; end: number }> = []
  let offset = 0
  while (offset <= content.length) {
    const start = content.indexOf(search, offset)
    if (start < 0) break
    matches.push({ start, end: start + search.length })
    offset = start + 1
  }
  return matches
}

const applyEdits = (rawContent: string, edits: readonly Edit[], path: string) => {
  const { bom, content: withoutBom } = splitBom(rawContent)
  const content = normalizeLineEndings(withoutBom)
  const located = edits.map((edit, index) => {
    if (!edit.oldText.length) throw new Error(`Edit ${index + 1} for "${path}" has empty oldText.`)
    const search = normalizeLineEndings(edit.oldText)
    const matches = findExactMatches(content, search)
    if (matches.length !== 1) {
      const reason =
        matches.length === 0 ? 'could not be located' : `matched ${matches.length} regions`
      const context = summarizeMismatchContext(content, search)
      throw new Error(
        `Edit ${index + 1} for "${path}" ${reason}. oldText must match exactly once in the current file.${context ? `\n${context}` : ''}`,
      )
    }
    return { ...matches[0]!, replacement: normalizeLineEndings(edit.newText), index }
  })
  const sorted = [...located].sort((left, right) => left.start - right.start)
  sorted.slice(1).forEach((current, index) => {
    const previous = sorted[index]!
    if (current.start < previous.end) {
      throw new Error(`Edits ${previous.index + 1} and ${current.index + 1} for "${path}" overlap.`)
    }
  })
  let next = content
  for (const edit of [...located].sort((left, right) => right.start - left.start)) {
    next = `${next.slice(0, edit.start)}${edit.replacement}${next.slice(edit.end)}`
  }
  return `${bom}${restoreLineEndings(next, withoutBom)}`
}

export const createStandardWorkspaceTools = (operations: WorkspaceOperations): InternalTool[] => [
  createTool({
    name: 'read',
    description: 'Read a workspace text file with an optional bounded line range.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string' },
        offset: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: MAX_READ_LINES },
      },
    } as const,
    function: async ({
      path,
      offset,
      limit,
    }: {
      path: string
      offset?: number
      limit?: number
    }) => {
      const result = await operations.read(path)
      const lines = normalizeLineEndings(result.content).split('\n')
      const start = Math.min(lines.length, Math.max(1, Math.trunc(offset ?? 1)))
      const count = clamp(limit, 200, MAX_READ_LINES)
      const selected = lines.slice(start - 1, start - 1 + count)
      return {
        path,
        content: selected.join('\n'),
        startLine: start,
        endLine: start + selected.length - 1,
        lineCount: lines.length,
        truncated: start - 1 + selected.length < lines.length,
        revision: result.revision,
      }
    },
  }),
  createTool({
    name: 'write',
    description: 'Create or replace one workspace text file.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'content'],
      properties: { path: { type: 'string' }, content: { type: 'string' } },
    } as const,
    function: async ({ path, content }: { path: string; content: string }) => ({
      path,
      ...(await operations.write({ path, content })),
      chars: content.length,
    }),
  }),
  createTool({
    name: 'edit',
    description:
      'Edit one workspace text file with exact, unique, non-overlapping replacements matched against the original file.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'edits'],
      properties: {
        path: { type: 'string' },
        edits: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['oldText', 'newText'],
            properties: { oldText: { type: 'string' }, newText: { type: 'string' } },
          },
        },
      },
    } as const,
    function: async ({ path, edits }: { path: string; edits: Edit[] }) => {
      const current = await operations.read(path)
      const content = applyEdits(current.content, edits, path)
      if (content === current.content) {
        return { path, changed: false, replacements: edits.length, revision: current.revision }
      }
      const written = await operations.write({
        path,
        content,
        expectedRevision: current.revision,
      })
      return { path, changed: true, replacements: edits.length, revision: written.revision }
    },
  }),
  createTool({
    name: 'grep',
    description: 'Search workspace text files for a regex or literal pattern.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['pattern'],
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        glob: { type: 'string' },
        literal: { type: 'boolean', default: false },
        context: { type: 'integer', minimum: 0, maximum: 20, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: MAX_RESULTS, default: 100 },
      },
    } as const,
    function: async (args: {
      pattern: string
      path?: string
      glob?: string
      literal?: boolean
      context?: number
      limit?: number
    }) => {
      const matches = await operations.grep({
        ...args,
        context: Math.max(0, Math.min(Math.trunc(args.context ?? 0), 20)),
        limit: clamp(args.limit, 100, MAX_RESULTS),
      })
      return { matches, count: matches.length }
    },
  }),
  createTool({
    name: 'find',
    description: 'Find workspace files with a glob pattern using *, **, and ? wildcards.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['pattern'],
      properties: {
        pattern: { type: 'string' },
        path: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_RESULTS, default: 500 },
      },
    } as const,
    function: async ({
      pattern,
      path,
      limit,
    }: {
      pattern: string
      path?: string
      limit?: number
    }) => {
      const files = await operations.find({
        pattern,
        ...(path ? { path } : {}),
        limit: clamp(limit, 500, MAX_RESULTS),
      })
      return { files, count: files.length }
    },
  }),
  createTool({
    name: 'ls',
    description: 'List entries in one workspace directory.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_RESULTS, default: 500 },
      },
    } as const,
    function: async ({ path, limit }: { path?: string; limit?: number }) => {
      const entries = await operations.list({
        ...(path ? { path } : {}),
        limit: clamp(limit, 500, MAX_RESULTS),
      })
      return { entries, count: entries.length }
    },
  }),
]
