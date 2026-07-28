import { spawn } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { createTool } from '@taskyon/taskyon/api'

type ExplorationContext = Record<string, string>

type ExplorationArgs = {
  action: 'list' | 'search' | 'grep' | 'view' | 'add' | 'context' | 'clear_context'
  query?: string
  path?: string
  limit?: number
  startLine?: number
  endLine?: number
}

type CommandResult = {
  code: number | null
  stdout: string
}

type GrepMatch = {
  line: number
  path: string
  text: string
}

const EXCLUDED_DIRS = [
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.yarn',
  '.direnv',
]
const MAX_READ_CHARS = 200_000
const MAX_COMMAND_OUTPUT = 2_000_000

const clampLimit = (limit: number | undefined, fallback = 50) =>
  Math.max(1, Math.min(limit ?? fallback, 500))

const rgGlobArgs = () => EXCLUDED_DIRS.flatMap((dir) => ['-g', `!${dir}/**`])

async function commandExists(name: string) {
  const pathValue = process.env.PATH ?? ''
  for (const dir of pathValue.split(':').filter(Boolean)) {
    try {
      const candidate = join(dir, name)
      await access(candidate, fsConstants.X_OK)
      return true
    } catch {
      // continue
    }
  }
  return false
}

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > MAX_COMMAND_OUTPUT) child.kill('SIGTERM')
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        reject(new Error(stderr.trim() || `${command} exited with code ${String(code)}`))
        return
      }
      resolveResult({ code, stdout })
    })
  })
}

function resolveWorkspacePath(root: string, path: string) {
  const full = resolve(root, path)
  const rel = relative(root, full)
  if (rel.startsWith('..') || rel === '' || dirname(rel).startsWith('..')) {
    throw new Error(`Path escapes workspace: ${path}`)
  }
  return { full, rel: rel.replace(/\\/g, '/') }
}

function resolveWorkspaceScope(root: string, path?: string) {
  const full = resolve(root, path?.trim() || '.')
  const rel = relative(root, full).replace(/\\/g, '/')
  if (rel === '..' || rel.startsWith('../')) throw new Error(`Path escapes workspace: ${path}`)
  return { full, rel }
}

const toWorkspaceRelativePath = (scope: string, path: string) => (scope ? `${scope}/${path}` : path)

async function listFilesRec(root: string, limit: number, query?: string) {
  const out: string[] = []
  const walk = async (dir: string) => {
    if (out.length >= limit) return
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (out.length >= limit) break
      if (EXCLUDED_DIRS.includes(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      const rel = relative(root, full)
      if (!query || rel.toLowerCase().includes(query.toLowerCase())) out.push(rel)
    }
  }
  await walk(root)
  return out
}

async function listWorkspaceFiles(root: string, limit: number, query?: string) {
  const effectiveLimit = clampLimit(limit)
  if (await commandExists('rg')) {
    try {
      const result = await runCommand('rg', ['--files', '--hidden', ...rgGlobArgs()], root)
      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((file) => !query || file.toLowerCase().includes(query.toLowerCase()))
        .slice(0, effectiveLimit)
    } catch {
      // Fall back below when rg exists but is not runnable in this environment.
    }
  }
  return await listFilesRec(root, effectiveLimit, query)
}

function parseRgJsonMatches(stdout: string, limit: number): GrepMatch[] {
  const matches: GrepMatch[] = []
  for (const line of stdout.split('\n')) {
    if (matches.length >= limit || !line.trim()) break
    try {
      const event = JSON.parse(line) as {
        type?: string
        data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } }
      }
      if (event.type !== 'match') continue
      const path = event.data?.path?.text
      const lineNumber = event.data?.line_number
      const text = event.data?.lines?.text
      if (!path || typeof lineNumber !== 'number' || typeof text !== 'string') continue
      matches.push({ path, line: lineNumber, text: text.replace(/\n$/, '') })
    } catch {
      // Ignore malformed rg JSON events.
    }
  }
  return matches
}

async function grepFilesFallback(root: string, query: string, limit: number): Promise<GrepMatch[]> {
  const files = await listFilesRec(root, 5000)
  const lowerQuery = query.toLowerCase()
  const matches: GrepMatch[] = []
  for (const filePath of files) {
    if (matches.length >= limit) break
    try {
      const content = await readFile(join(root, filePath), 'utf8')
      const lines = content.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        if (matches.length >= limit) break
        if (!lines[index]!.toLowerCase().includes(lowerQuery)) continue
        matches.push({ path: filePath, line: index + 1, text: lines[index]! })
      }
    } catch {
      // Skip unreadable or binary files.
    }
  }
  return matches
}

async function grepWorkspace(root: string, query: string, limit: number): Promise<GrepMatch[]> {
  const effectiveLimit = clampLimit(limit)
  if (!query.trim()) throw new Error('query is required for grep action')
  if (await commandExists('rg')) {
    try {
      const result = await runCommand(
        'rg',
        ['--json', '--hidden', '--line-number', ...rgGlobArgs(), query],
        root,
      )
      return parseRgJsonMatches(result.stdout, effectiveLimit)
    } catch {
      // Fall back below when rg exists but is not runnable in this environment.
    }
  }
  return await grepFilesFallback(root, query, effectiveLimit)
}

async function grepFile(path: string, query: string, limit: number): Promise<GrepMatch[]> {
  const effectiveLimit = clampLimit(limit)
  if (!query.trim()) throw new Error('query is required for grep action')
  if (await commandExists('rg')) {
    try {
      const result = await runCommand(
        'rg',
        ['--json', '--line-number', query, basename(path)],
        dirname(path),
      )
      return parseRgJsonMatches(result.stdout, effectiveLimit)
    } catch {
      // Fall back below when rg exists but is not runnable in this environment.
    }
  }

  const content = await readFile(path, 'utf8')
  const lowerQuery = query.toLowerCase()
  return content
    .split('\n')
    .flatMap((text, index) =>
      text.toLowerCase().includes(lowerQuery)
        ? [{ path: basename(path), line: index + 1, text }]
        : [],
    )
    .slice(0, effectiveLimit)
}

async function readFileChunk(root: string, path: string, startLine?: number, endLine?: number) {
  const { full, rel } = resolveWorkspacePath(root, path)
  const content = await readFile(full, 'utf8')
  const lines = content.split('\n')
  const start = Math.max(1, startLine ?? 1)
  const end = Math.min(lines.length, Math.max(start, endLine ?? start + 199))
  const selected = lines.slice(start - 1, end).join('\n')
  return {
    content: selected.slice(0, MAX_READ_CHARS),
    endLine: end,
    lineCount: lines.length,
    path: rel,
    startLine: start,
    truncated: selected.length > MAX_READ_CHARS,
  }
}

export function formatExplorationContext(contextFiles: ExplorationContext) {
  const keys = Object.keys(contextFiles)
  if (keys.length <= 0) return 'Loaded file context: (none)'
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

export function createExplorationTool(contextFiles: ExplorationContext) {
  return createTool({
    name: 'exploration',
    description:
      'Codex-style workspace exploration. Use list/search for file discovery, grep for text search, view for focused file chunks, and add/context to manage loaded file context.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'search', 'grep', 'view', 'add', 'context', 'clear_context'],
        },
        query: { type: 'string' },
        path: { type: 'string' },
        limit: { type: 'integer', default: 50 },
        startLine: { type: 'integer' },
        endLine: { type: 'integer' },
      },
    } as const,
    function: async ({ action, query, path, limit = 50, startLine, endLine }: ExplorationArgs) => {
      const cwd = process.cwd()
      if (action === 'clear_context') {
        Object.keys(contextFiles).forEach((k) => delete contextFiles[k])
        return { cleared: true }
      }
      if (action === 'context') {
        const files = Object.keys(contextFiles)
        return {
          files,
          count: files.length,
          chars: files.reduce((n, f) => n + (contextFiles[f]?.length ?? 0), 0),
        }
      }
      if (action === 'view') {
        if (!path) throw new Error('path is required for view action')
        return await readFileChunk(cwd, path, startLine, endLine)
      }
      if (action === 'add') {
        if (!path) throw new Error('path is required for add action')
        const chunk = await readFileChunk(cwd, path, startLine, endLine)
        contextFiles[chunk.path] = chunk.content
        return {
          added: chunk.path,
          chars: chunk.content.length,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
        }
      }
      if (action === 'grep') {
        const scope = resolveWorkspaceScope(cwd, path)
        const scopeStat = await stat(scope.full)
        if (scopeStat.isFile()) {
          const matches = (await grepFile(scope.full, query ?? '', limit)).map((match) => ({
            ...match,
            path: scope.rel,
          }))
          return { matches, count: matches.length }
        }
        if (!scopeStat.isDirectory()) {
          throw new Error(`grep path is not a file or directory: ${path ?? '.'}`)
        }
        const matches = (await grepWorkspace(scope.full, query ?? '', limit)).map((match) => ({
          ...match,
          path: toWorkspaceRelativePath(scope.rel, match.path),
        }))
        return { matches, count: matches.length }
      }
      const scope = resolveWorkspaceScope(cwd, path)
      const files = (
        await listWorkspaceFiles(scope.full, limit, action === 'search' ? query : undefined)
      ).map((file) => toWorkspaceRelativePath(scope.rel, file))
      return { files, count: files.length }
    },
  })
}
