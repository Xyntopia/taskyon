import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import {
  workspaceGlobMatches,
  type WorkspaceMatch,
  type WorkspaceOperations,
} from '@taskyon/taskyon/tools/workspaceTools'

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
const MAX_COMMAND_OUTPUT = 2_000_000
const MAX_FALLBACK_FILES = 5_000

const contentRevision = (content: string) =>
  `sha256:${createHash('sha256').update(content).digest('base64url')}`

const resolveScope = (root: string, path?: string) => {
  const full = resolve(root, path?.trim() || '.')
  const rel = relative(root, full).replace(/\\/g, '/')
  if (rel === '..' || rel.startsWith('../')) throw new Error(`Path escapes workspace: ${path}`)
  return { full, rel }
}

const resolveFile = (root: string, path: string) => {
  const scope = resolveScope(root, path)
  if (!scope.rel) throw new Error('Workspace file path must not be empty.')
  return scope
}

const excludedGlobArgs = () => EXCLUDED_DIRS.flatMap((dir) => ['-g', `!${dir}/**`])

const runCommand = async (command: string, args: string[], cwd: string) =>
  await new Promise<string>((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let outputLimited = false
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > MAX_COMMAND_OUTPUT) {
        outputLimited = true
        child.kill('SIGTERM')
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (outputLimited) resolveResult(stdout.slice(0, MAX_COMMAND_OUTPUT))
      else if (code !== 0 && code !== 1) {
        reject(new Error(stderr.trim() || `${command} exited with code ${String(code)}`))
      } else resolveResult(stdout)
    })
  })

const commandExists = async (name: string) => {
  for (const directory of (process.env.PATH ?? '').split(':').filter(Boolean)) {
    try {
      await access(join(directory, name), fsConstants.X_OK)
      return true
    } catch {
      // Continue searching PATH.
    }
  }
  return false
}

const listFilesFallback = async (root: string, limit: number) => {
  const files: string[] = []
  const walk = async (directory: string) => {
    if (files.length >= limit) return
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (files.length >= limit) return
      if (EXCLUDED_DIRS.includes(entry.name)) continue
      const full = join(directory, entry.name)
      if (entry.isDirectory()) await walk(full)
      else files.push(relative(root, full).replace(/\\/g, '/'))
    }
  }
  await walk(root)
  return files
}

const parseRgMatches = (stdout: string, limit: number): WorkspaceMatch[] => {
  const matches: WorkspaceMatch[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim() || matches.length >= limit) continue
    try {
      const event = JSON.parse(line) as {
        type?: string
        data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } }
      }
      if (event.type !== 'match') continue
      const path = event.data?.path?.text
      const lineNumber = event.data?.line_number
      const text = event.data?.lines?.text
      if (path && typeof lineNumber === 'number' && typeof text === 'string') {
        matches.push({ path, line: lineNumber, text: text.replace(/\n$/, '') })
      }
    } catch {
      // Ignore malformed ripgrep events.
    }
  }
  return matches
}

const addContext = async (root: string, matches: WorkspaceMatch[], context: number) => {
  if (context <= 0) return matches
  const linesByPath = new Map<string, string[]>()
  return await Promise.all(
    matches.map(async (match) => {
      let lines = linesByPath.get(match.path)
      if (!lines) {
        lines = (await readFile(join(root, match.path), 'utf8')).replace(/\r\n?/g, '\n').split('\n')
        linesByPath.set(match.path, lines)
      }
      const index = match.line - 1
      return {
        ...match,
        before: lines.slice(Math.max(0, index - context), index),
        after: lines.slice(index + 1, index + 1 + context),
      }
    }),
  )
}

export const createNodeWorkspaceOperations = (
  root = process.cwd(),
  options: { onDidWrite?: (path: string) => void } = {},
): WorkspaceOperations => {
  const workspaceRoot = resolve(root)
  const realWorkspaceRoot = realpath(workspaceRoot)
  const mutationChains = new Map<string, Promise<void>>()
  const rgAvailable = commandExists('rg')
  const runMutation = async <T>(path: string, operation: () => Promise<T>) => {
    const previous = mutationChains.get(path) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolveRelease) => (release = resolveRelease))
    const chain = previous.then(() => current)
    mutationChains.set(path, chain)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (mutationChains.get(path) === chain) mutationChains.delete(path)
    }
  }
  const assertRealPathInsideWorkspace = async (fullPath: string, allowMissing = false) => {
    const realRoot = await realWorkspaceRoot
    let existingPath = fullPath
    if (allowMissing) {
      for (;;) {
        try {
          await access(existingPath)
          break
        } catch {
          const parent = dirname(existingPath)
          if (parent === existingPath) throw new Error(`Path escapes workspace: ${fullPath}`)
          existingPath = parent
        }
      }
    }
    const resolvedTarget = await realpath(existingPath)
    const rel = relative(realRoot, resolvedTarget)
    if (rel === '..' || rel.startsWith('../'))
      throw new Error(`Path escapes workspace: ${fullPath}`)
  }
  const listFiles = async (scope: { full: string; rel: string }, limit: number) => {
    if (await rgAvailable) {
      const stdout = await runCommand(
        'rg',
        ['--files', '--hidden', ...excludedGlobArgs()],
        scope.full,
      )
      return stdout
        .split('\n')
        .filter(Boolean)
        .slice(0, limit)
        .map((path) => (scope.rel ? `${scope.rel}/${path}` : path))
    }
    return (await listFilesFallback(scope.full, limit)).map((path) =>
      scope.rel ? `${scope.rel}/${path}` : path,
    )
  }

  return {
    read: async (path) => {
      const file = resolveFile(workspaceRoot, path)
      await assertRealPathInsideWorkspace(file.full)
      const content = await readFile(file.full, 'utf8')
      return { content, revision: contentRevision(content) }
    },
    write: async ({ path, content, expectedRevision }) => {
      const file = resolveFile(workspaceRoot, path)
      return await runMutation(file.rel, async () => {
        await assertRealPathInsideWorkspace(file.full, true)
        if (expectedRevision !== undefined) {
          const currentRevision = await readFile(file.full, 'utf8').then(
            contentRevision,
            (error: unknown) => {
              if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
              throw error
            },
          )
          if (currentRevision !== expectedRevision) {
            throw new Error(`Workspace file changed while editing: ${file.rel}`)
          }
        }
        await mkdir(dirname(file.full), { recursive: true })
        await writeFile(file.full, content, 'utf8')
        options.onDidWrite?.(file.rel)
        return { revision: contentRevision(content) }
      })
    },
    list: async ({ path, limit }) => {
      const scope = resolveScope(workspaceRoot, path)
      await assertRealPathInsideWorkspace(scope.full)
      const scopeStat = await stat(scope.full)
      if (!scopeStat.isDirectory()) throw new Error(`Workspace path is not a directory: ${path}`)
      const entries = await readdir(scope.full, { withFileTypes: true })
      return entries.slice(0, limit).map((entry) => ({
        path: scope.rel ? `${scope.rel}/${entry.name}` : entry.name,
        type: entry.isDirectory() ? ('directory' as const) : ('file' as const),
      }))
    },
    find: async ({ pattern, path, limit }) => {
      const scope = resolveScope(workspaceRoot, path)
      await assertRealPathInsideWorkspace(scope.full)
      const scopeStat = await stat(scope.full)
      if (scopeStat.isFile()) {
        return workspaceGlobMatches(pattern, basename(scope.rel)) ||
          workspaceGlobMatches(pattern, scope.rel)
          ? [scope.rel]
          : []
      }
      return (await listFiles(scope, Math.min(limit * 10, MAX_FALLBACK_FILES)))
        .filter((file) => {
          const relativePath = scope.rel ? file.slice(scope.rel.length + 1) : file
          return workspaceGlobMatches(pattern, relativePath) || workspaceGlobMatches(pattern, file)
        })
        .slice(0, limit)
    },
    grep: async ({ pattern, path, glob, literal, context = 0, limit }) => {
      const scope = resolveScope(workspaceRoot, path)
      await assertRealPathInsideWorkspace(scope.full)
      if (await rgAvailable) {
        const scopeStat = await stat(scope.full)
        const args = ['--json', '--hidden', '--line-number', ...excludedGlobArgs()]
        if (literal) args.push('--fixed-strings')
        if (glob) args.push('--glob', glob)
        args.push(pattern)
        if (scopeStat.isFile()) args.push(basename(scope.full))
        const stdout = await runCommand(
          'rg',
          args,
          scopeStat.isFile() ? dirname(scope.full) : scope.full,
        )
        const prefixed = parseRgMatches(stdout, limit).map((match) => ({
          ...match,
          path: scopeStat.isFile()
            ? scope.rel
            : scope.rel
              ? `${scope.rel}/${match.path}`
              : match.path,
        }))
        return await addContext(workspaceRoot, prefixed, context)
      }
      const scopeStat = await stat(scope.full)
      const files = scopeStat.isFile() ? [scope.rel] : await listFiles(scope, MAX_FALLBACK_FILES)
      const expression = new RegExp(
        literal ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern,
      )
      const matches: WorkspaceMatch[] = []
      for (const file of files) {
        if (matches.length >= limit) break
        if (
          glob &&
          !workspaceGlobMatches(glob, file) &&
          !workspaceGlobMatches(glob, basename(file))
        )
          continue
        try {
          const lines = (await readFile(join(workspaceRoot, file), 'utf8'))
            .replace(/\r\n?/g, '\n')
            .split('\n')
          for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
            expression.lastIndex = 0
            if (!expression.test(lines[index] ?? '')) continue
            matches.push({ path: file, line: index + 1, text: lines[index] ?? '' })
          }
        } catch {
          // Skip unreadable or binary files in the fallback path.
        }
      }
      return await addContext(workspaceRoot, matches, context)
    },
  }
}
