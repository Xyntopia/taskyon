import './node-shims'

import { createInterface } from 'node:readline/promises'
import { emitKeypressEvents } from 'node:readline'
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { createDuplexChannel } from '@taskyon/shared/modules/frpBus'
import {
  createTaskNode,
  tyCore,
  type Taskyon,
  type TaskyonMessage,
  type llmSettings,
  type partialTaskDraft,
  type TaskNode,
} from '@taskyon/taskyon'
import { createTool, toolCall } from '@taskyon/taskyon/api'
import { createStandardEntryNodeTool } from '@taskyon/taskyon/tools/entryNode'
import {
  API_KEY_STORE_NAME,
  MAX_MODEL_OPTIONS,
  SLASH_COMMANDS,
  SUPPORTED_PROVIDERS,
  type BashToolArgs,
  type CliApiConfig,
  type LlmModel,
  type SlashParsed,
} from './cli/types'
import {
  initPersistentCryptoSession,
  persistConfigPatch,
  resolveConfigDirectoryPath,
  resolveKeyForProvider,
  resolveProviderSelection,
  setSelectedApi,
} from './cli/config'
import {
  baseApiDefinitions,
  canReachLocalApi,
  createCliLlmSettings,
  DEFAULT_PROMPT_TEMPLATES,
  fetchProviderModels,
  getAllowedTaskyonModels,
  modelOptionsForProvider,
} from './cli/models'
import { renderTaskProgress, renderWorkerProgress, type WorkerEvent } from './cli/taskRenderer'
import { createConversationPersistence } from './cli/conversationPersistence'
const ENTRY_NODE_TOOL_NAME = 'entryNode'
let debugLogsEnabled = process.env.TYCLI_DEBUG === '1'
const EXPLORATION_TOOL_NAME = 'exploration'
const UPDATE_FILES_TOOL_NAME = 'updateFiles'
const FILE_PICKER_MAX_DEPTH = 3
const FILE_PICKER_MAX_ENTRIES = 5000
const FILE_PICKER_MAX_OPTIONS = 30
const FILE_PICKER_EXCLUDED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.yarn',
  '.pnpm-store',
  '.quasar',
  '.direnv',
  '.corepack',
  'target',
])
const fileIndexCache = new Map<string, string[]>()
let fatalErrorHandled = false

function writeLine(text: string) {
  process.stdout.write(`${text}\n`)
}

function writeError(text: string) {
  process.stderr.write(`${text}\n`)
}

const errorTimestamp = () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    '-',
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join('')
}

async function writeFatalErrorLog(error: unknown) {
  const configDir = await resolveConfigDirectoryPath().catch(() => '/tmp/tycli')
  const errorDir = join(configDir, 'errors')
  await mkdir(errorDir, { recursive: true })
  const filePath = join(errorDir, `error_${errorTimestamp()}_${process.pid}.log`)
  const body = [
    `timestamp=${new Date().toISOString()}`,
    `cwd=${process.cwd()}`,
    `pid=${process.pid}`,
    '',
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    '',
  ].join('\n')
  await writeFile(filePath, body, 'utf8')
  return filePath
}

async function reportFatalError(error: unknown) {
  if (fatalErrorHandled) return
  fatalErrorHandled = true
  try {
    const filePath = await writeFatalErrorLog(error)
    writeError(`Fatal error. Details written to ${filePath}`)
  } catch (logError) {
    const fallback = logError instanceof Error ? logError.message : String(logError)
    writeError(`Fatal error. Failed to write error log: ${fallback}`)
    writeError(error instanceof Error ? (error.stack ?? error.message) : String(error))
  }
}

function exitAfterFatalError(code = 1) {
  process.exitCode = code
  setImmediate(() => {
    process.exit(code)
  })
}

function writeDebug(text: string) {
  if (!debugLogsEnabled) return
  process.stderr.write(`[debug] ${text}\n`)
}

process.title = 'tycli'

function maskKey(key: string | undefined): string {
  if (!key) return 'missing'
  if (key.length <= 6) return '******'
  return `***${key.slice(-4)}`
}

type CliStartupMeta = {
  version: string
  commit: string
  buildDate: string
}

async function runGit(args: string[]): Promise<string | null> {
  return await new Promise((resolve) => {
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'ignore'] })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (code !== 0) return resolve(null)
      const out = Buffer.concat(chunks).toString('utf8').trim()
      resolve(out.length > 0 ? out : null)
    })
  })
}

async function loadStartupMeta(): Promise<CliStartupMeta> {
  const envVersion = process.env.TYCLI_VERSION?.trim()
  const envCommit = process.env.TYCLI_COMMIT?.trim()
  const envBuildDate = process.env.TYCLI_BUILD_DATE?.trim()

  let version = envVersion || 'unknown'
  if (!envVersion) {
    try {
      const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8')
      const parsed = JSON.parse(raw) as { version?: string }
      version = parsed.version?.trim() || version
    } catch {
      // Keep fallback value.
    }
  }

  const commit = envCommit || (await runGit(['rev-parse', '--short', 'HEAD'])) || 'unknown'
  const buildDate =
    envBuildDate || (await runGit(['log', '-1', '--format=%cI'])) || new Date().toISOString()

  return { version, commit, buildDate }
}

function parseSlashName(line: string): SlashParsed | null {
  if (!line.startsWith('/')) return null
  const stripped = line.slice(1)
  let nameEnd = stripped.length
  for (let i = 0; i < stripped.length; i += 1) {
    if (/\s/.test(stripped[i] ?? '')) {
      nameEnd = i
      break
    }
  }
  const name = stripped.slice(0, nameEnd).trim()
  if (!name) return null
  const args = stripped.slice(nameEnd).trimStart()
  return { name, args }
}

const cliBashTool = createTool({
  name: 'bash',
  description: 'Run a bash command on the host system and return stdout, stderr, and exit code.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['command'],
    properties: {
      command: {
        type: 'string',
        description: 'The command string to run with bash -lc.',
      },
      cwd: {
        type: 'string',
        description: 'Optional working directory for the command.',
      },
      timeoutMs: {
        type: 'integer',
        description: 'Optional timeout in milliseconds.',
        default: 120000,
      },
    },
  } as const,
})
const ACTIVE_LLM_TOOLS = [cliBashTool.name, EXPLORATION_TOOL_NAME, UPDATE_FILES_TOOL_NAME] as const

function buildCliEnvironmentContext(
  toolResultSection = '(none)',
  explorationContext = 'Loaded file context: (none)',
) {
  const now = new Date()
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const shell = process.env.SHELL ?? process.env.ComSpec ?? 'unknown'
  return [
    'You are the Taskyon CLI assistant.',
    'This is a terminal-focused environment. Be concise, actionable, and explicit.',
    '',
    '## Runtime Context',
    `Timestamp (ISO): ${now.toISOString()}`,
    `Local Time: ${now.toString()}`,
    `Timezone: ${timezone}`,
    `Platform: ${process.platform}`,
    `Arch: ${process.arch}`,
    `Node: ${process.version}`,
    `Current Working Directory: ${process.cwd()}`,
    `Shell: ${shell}`,
    `LLM-callable tools: ${ACTIVE_LLM_TOOLS.join(', ')}`,
    '',
    '## Recent Tool Result',
    toolResultSection,
    '',
    '## Project Context',
    explorationContext,
    '',
    '## Tool Usage Rules',
    '1. Prefer answering directly when no tool action is needed.',
    '2. For repository exploration, use the exploration tool first: list/search for files, grep for text, view for focused file chunks, add/context for persistent file context.',
    '3. Use bash only when command execution is required beyond file discovery, text search, or file viewing.',
    '4. Keep destructive or risky shell commands clearly justified and minimal.',
  ].join('\n')
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost)
    }
  }
  return dp[m]![n]!
}

function fuzzyFilterOptions<T>(
  query: string,
  options: T[],
  getValue: (option: T) => string,
  maxResults: number = MAX_MODEL_OPTIONS,
): T[] {
  const keyword = query.toLowerCase().trim()
  if (!keyword) return options.slice(0, maxResults)
  const threshold = 0.7 * 1.1
  const maxLen = (x: string, y: string) => (x.length > y.length ? x.length : y.length)
  return options
    .map((option) => {
      const optionValue = getValue(option).toLowerCase()
      const distance = levenshteinDistance(keyword, optionValue)
      const matches = maxLen(keyword, optionValue) - distance
      const score =
        matches / keyword.length +
        ((0.1 * keyword.length) / optionValue.length) * (matches / optionValue.length)
      return { ...option, score }
    })
    .filter((option) => option.score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((option) => option as T)
}

function fuzzyFilterModelOptions(
  query: string,
  options: { label: string; value: string }[],
): { label: string; value: string }[] {
  return fuzzyFilterOptions(query, options, (option) => option.value, MAX_MODEL_OPTIONS)
}

function isTaskCreatedMessage(
  msg: TaskyonMessage,
): msg is { type: 'taskCreated'; task: TaskNode; parentID?: string } {
  const candidate = msg as { type?: unknown; task?: unknown }
  return candidate.type === 'taskCreated' && !!candidate.task
}

function isRemoteFunctionCall(msg: TaskyonMessage): msg is TaskyonMessage & {
  type: 'functionCall'
  functionName: string
  requestId: string
  arguments?: Record<string, unknown>
} {
  const candidate = msg as { type?: unknown; functionName?: unknown; requestId?: unknown }
  return (
    candidate.type === 'functionCall' &&
    typeof candidate.functionName === 'string' &&
    typeof candidate.requestId === 'string'
  )
}

async function createPreparedTaskChain(
  tasks: partialTaskDraft[],
  priorID?: string,
): Promise<TaskNode[]> {
  const prepared: TaskNode[] = []
  let currentPriorId = priorID
  for (const task of tasks) {
    const nextTask = await createTaskNode(
      currentPriorId ? { ...task, priorID: currentPriorId } : task,
      { createMeta: 'missing' },
    )
    prepared.push(nextTask)
    currentPriorId = nextTask.id
  }
  return prepared
}

async function waitForTaskResult(
  port: ReturnType<typeof createDuplexChannel<TaskyonMessage, TaskyonMessage>>['x'],
  initialIds: string[],
  quitCondition: string | string[],
  timeoutMs: number,
) {
  const subTasks = new Set<string>(initialIds)
  const quitTypes = Array.isArray(quitCondition) ? quitCondition : [quitCondition]
  return await new Promise<TaskNode>((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe()
      reject(new Error(`Timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    const unsubscribe = port.receive((msg) => {
      if (!isTaskCreatedMessage(msg)) return
      if (!msg.task.parentID || !subTasks.has(msg.task.parentID)) return
      subTasks.add(msg.task.id)
      if (!quitTypes.includes(msg.task.content.type)) return
      clearTimeout(timeout)
      unsubscribe()
      resolve(msg.task)
    })
  })
}

async function executeBashCommand({ command, cwd, timeoutMs = 120000 }: BashToolArgs) {
  if (!command || !command.trim()) throw new Error('bash tool requires a non-empty command')

  const shellCandidates = Array.from(
    new Set([process.env.SHELL, 'bash', 'sh'].filter((value): value is string => !!value)),
  )

  const runWithShell = async (shell: string) =>
    await new Promise<{
      command: string
      cwd: string
      exitCode: number | null
      ok: boolean
      signal: NodeJS.Signals | null
      stderr: string
      stdout: string
    }>((resolve, reject) => {
      const child = spawn(shell, ['-lc', command], {
        cwd: cwd ?? process.cwd(),
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let settled = false

      const finish = (
        result:
          | {
              type: 'resolve'
              value: {
                command: string
                cwd: string
                exitCode: number | null
                ok: boolean
                signal: NodeJS.Signals | null
                stderr: string
                stdout: string
              }
            }
          | { type: 'reject'; error: Error },
      ) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (result.type === 'resolve') resolve(result.value)
        else reject(result.error)
      }

      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 1000).unref()
        finish({ type: 'reject', error: new Error(`bash command timed out after ${timeoutMs}ms`) })
      }, timeoutMs)

      child.stdout.on('data', (chunk: Buffer | string) => {
        stdout += chunk.toString()
      })

      child.stderr.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString()
      })

      child.on('error', (error) => finish({ type: 'reject', error }))

      child.on('close', (exitCode, signal) => {
        finish({
          type: 'resolve',
          value: {
            command,
            cwd: cwd ?? process.cwd(),
            exitCode,
            signal,
            stdout,
            stderr,
            ok: exitCode === 0,
          },
        })
      })
    })

  let lastError: Error | null = null
  for (const shell of shellCandidates) {
    try {
      writeDebug(`bash tool trying shell: ${shell}`)
      return await runWithShell(shell)
    } catch (error) {
      const asError = error instanceof Error ? error : new Error(String(error))
      lastError = asError
      if (!asError.message.includes('ENOENT')) throw asError
      writeDebug(`shell not found: ${shell}`)
    }
  }

  throw lastError ?? new Error('No usable shell found for bash tool execution')
}

function normalizeThinkingChunk(chunk: unknown): string {
  const c = chunk as Record<string, unknown>
  const type = typeof c['type'] === 'string' ? c['type'] : ''
  if (type.includes('reasoning')) {
    if (typeof c['textDelta'] === 'string') return c['textDelta']
    if (typeof c['text'] === 'string') return c['text']
  }
  if (typeof c['reasoning'] === 'string') return c['reasoning']
  if (Array.isArray(c['reasoning'])) {
    return c['reasoning']
      .map((item) => (typeof item === 'string' ? item : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

async function selectFromList(
  rl: ReturnType<typeof createInterface>,
  title: string,
  options: string[],
  config?: {
    filterable?: boolean
    initialQuery?: string
    maxVisible?: number
    optionsForQuery?: (query: string) => string[]
  },
) {
  const filterable = config?.filterable ?? false
  const initialQuery = config?.initialQuery ?? ''
  const maxVisible = config?.maxVisible
  const optionsForQuery = config?.optionsForQuery
  const stdin = process.stdin
  const stdout = process.stdout
  const optionsFor = (query: string) => optionsForQuery?.(query) ?? options
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
    const currentOptions = optionsFor(initialQuery)
    writeLine(title)
    currentOptions.forEach((option, idx) => writeLine(`${idx + 1}. ${option}`))
    const answerRaw = await askQuestion(rl, 'Select: ')
    if (answerRaw === null) return null
    const answer = answerRaw.trim()
    const num = Number(answer)
    if (!Number.isInteger(num) || num < 1 || num > currentOptions.length) return null
    return num - 1
  }

  emitKeypressEvents(stdin)
  const prevRaw = stdin.isRaw ?? false
  stdin.setRawMode(true)
  stdin.resume()

  let selectedIdx = 0
  let query = initialQuery
  let cleanedUp = false
  let renderedLines = 0
  const width = Math.max(20, (stdout.columns ?? 80) - 1)
  const fitLine = (line: string) =>
    line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line

  const clear = () => {
    for (let i = 0; i < renderedLines; i += 1) stdout.write('\x1b[1A\x1b[2K')
    renderedLines = 0
  }

  const indexedOptions = (query: string) =>
    optionsFor(query).map((label, index) => ({ label, index }))
  const filteredOptions = () => {
    const indexed = indexedOptions(query)
    if (!filterable) return indexed
    const list = fuzzyFilterOptions(query, indexed, (option) => option.label, indexed.length)
    const result = list.length > 0 ? list : indexed
    return maxVisible ? result.slice(0, maxVisible) : result
  }

  const render = () => {
    clear()
    const list = filteredOptions()
    if (selectedIdx >= list.length) selectedIdx = Math.max(0, list.length - 1)
    const rows = list.map((option, idx) => `${idx === selectedIdx ? '>' : ' '} ${option.label}`)
    const help = filterable
      ? 'Use ↑/↓, type to filter, Enter (Esc/Ctrl+C to cancel)'
      : 'Use ↑/↓ and Enter (Esc/Ctrl+C to cancel)'
    const queryLine = filterable ? `filter: ${query}` : null
    const lines = [title, help, queryLine, ...rows]
      .filter(Boolean)
      .map((line) => fitLine(String(line)))
    stdout.write(`${lines.join('\n')}\n`)
    renderedLines = lines.length
  }

  render()
  const result = await new Promise<number | null>((resolve) => {
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      stdin.off('keypress', onKeypress)
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
      clear()
      stdin.setRawMode(prevRaw)
    }
    const finish = (value: number | null) => {
      cleanup()
      resolve(value)
    }
    const onSigint = () => finish(null)
    const onSigterm = () => finish(null)
    const onKeypress = (str: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') return finish(null)
      if (key.name === 'escape') return finish(null)
      if (key.name === 'return' || key.name === 'enter') {
        const list = filteredOptions()
        return finish(list[selectedIdx]?.index ?? null)
      }
      if (key.name === 'up') {
        selectedIdx = Math.max(0, selectedIdx - 1)
        render()
        return
      }
      if (key.name === 'down') {
        selectedIdx = Math.min(filteredOptions().length - 1, selectedIdx + 1)
        render()
        return
      }
      const num = Number(str)
      if (Number.isInteger(num) && num >= 1 && num <= options.length) {
        selectedIdx = num - 1
        render()
        return
      }
      if (!filterable) return
      if (key.name === 'backspace') {
        query = query.slice(0, -1)
        selectedIdx = 0
        render()
        return
      }
      if (str && !key.ctrl && str >= ' ' && str !== '\x7f') {
        query += str
        selectedIdx = 0
        render()
      }
    }
    stdin.on('keypress', onKeypress)
    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)
  })

  return result
}

async function selectSlashCommand(
  rl: ReturnType<typeof createInterface>,
  initialQuery: string = '',
) {
  const options = SLASH_COMMANDS.map((name) => `/${name}`)
  const idx = await selectFromList(rl, '\nSlash commands', options, {
    filterable: true,
    initialQuery,
  })
  if (idx === null) return null
  return options[idx] ?? null
}

function normalizeFilePickerQuery(input: string): string {
  return input.trim().replace(/^@+/, '')
}

function parseFilePickerQuery(input: string): { baseRel: string; nameQuery: string } {
  const q = normalizeFilePickerQuery(input)
  const slashIdx = q.lastIndexOf('/')
  if (slashIdx < 0) return { baseRel: '', nameQuery: q }
  const baseRel = q.slice(0, slashIdx).replace(/^\/+|\/+$/g, '')
  const nameQuery = q.slice(slashIdx + 1)
  return { baseRel, nameQuery }
}

async function indexFilesFromBase(baseRel: string): Promise<string[]> {
  const cached = fileIndexCache.get(baseRel)
  if (cached) return cached
  const cwd = process.cwd()
  const baseAbs = resolve(cwd, baseRel || '.')
  const files: string[] = []

  const walk = async (absDir: string, depth: number): Promise<void> => {
    if (files.length >= FILE_PICKER_MAX_ENTRIES) return
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= FILE_PICKER_MAX_ENTRIES) break
      const full = join(absDir, entry.name)
      if (entry.isDirectory()) {
        if (FILE_PICKER_EXCLUDED_DIRS.has(entry.name)) continue
        if (depth >= FILE_PICKER_MAX_DEPTH) continue
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const rel = relative(cwd, full).replace(/\\/g, '/')
      files.push(rel)
    }
  }

  await walk(baseAbs, 0)
  fileIndexCache.set(baseRel, files)
  return files
}

async function fileExistsInWorkspace(path: string): Promise<boolean> {
  try {
    const full = resolve(process.cwd(), path)
    const info = await stat(full)
    return info.isFile()
  } catch {
    return false
  }
}

async function selectFileReference(rl: ReturnType<typeof createInterface>, initialQuery = '') {
  const { baseRel, nameQuery } = parseFilePickerQuery(initialQuery)
  const currentOptions = (await indexFilesFromBase(baseRel)).slice(0, FILE_PICKER_MAX_ENTRIES)
  const idx = await selectFromList(rl, '\nFiles (@)', currentOptions, {
    filterable: true,
    initialQuery: nameQuery,
    maxVisible: FILE_PICKER_MAX_OPTIONS,
  })
  if (idx === null) return null
  return currentOptions[idx] ?? null
}

async function selectModelInteractive(
  options: { label: string; value: string }[],
): Promise<string | null> {
  if (options.length <= 0) return null
  const stdin = process.stdin
  const stdout = process.stdout
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function')
    return options[0]?.value ?? null

  emitKeypressEvents(stdin)
  const prevRaw = stdin.isRaw ?? false
  stdin.setRawMode(true)
  stdin.resume()

  let query = ''
  let selectedIdx = 0
  let cleanedUp = false
  const panelLines = 2 + MAX_MODEL_OPTIONS
  const width = Math.max(20, (stdout.columns ?? 80) - 1)
  const fitLine = (line: string) =>
    line.length > width ? `${line.slice(0, Math.max(0, width - 1))}…` : line

  const clear = () => {
    for (let i = 0; i < panelLines; i += 1) stdout.write('\x1b[1A\x1b[2K')
  }

  const filtered = () => {
    const list = fuzzyFilterModelOptions(query, options)
    return (list.length > 0 ? list : options.slice(0, MAX_MODEL_OPTIONS)).slice(
      0,
      MAX_MODEL_OPTIONS,
    )
  }

  const render = () => {
    clear()
    const list = filtered()
    if (selectedIdx >= list.length) selectedIdx = Math.max(0, list.length - 1)
    const rows = Array.from({ length: MAX_MODEL_OPTIONS }, (_, idx) => {
      const m = list[idx]
      if (!m) return '  '
      return `${idx === selectedIdx ? '>' : ' '} ${m.value}`
    })
    const lines = ['Model filter: type, ↑/↓, Enter, Esc/Ctrl+C', `query: ${query}`, ...rows].map(
      fitLine,
    )
    stdout.write(`${lines.join('\n')}\n`)
  }

  render()
  const result = await new Promise<string | null>((resolve) => {
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      stdin.off('keypress', onKeypress)
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
      clear()
      stdin.setRawMode(prevRaw)
    }
    const finish = (value: string | null) => {
      cleanup()
      resolve(value)
    }
    const onSigint = () => finish(null)
    const onSigterm = () => finish(null)
    const onKeypress = (str: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') return finish(null)
      if (key.name === 'escape') return finish(null)
      if (key.name === 'return' || key.name === 'enter') {
        const list = filtered()
        return finish(list[selectedIdx]?.value ?? null)
      }
      if (key.name === 'backspace') {
        query = query.slice(0, -1)
        selectedIdx = 0
        render()
        return
      }
      if (key.name === 'up') {
        selectedIdx = Math.max(0, selectedIdx - 1)
        render()
        return
      }
      if (key.name === 'down') {
        selectedIdx = Math.min(filtered().length - 1, selectedIdx + 1)
        render()
        return
      }
      if (str && !key.ctrl && str >= ' ' && str !== '\x7f') {
        query += str
        selectedIdx = 0
        render()
      }
    }
    stdin.on('keypress', onKeypress)
    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)
  })

  return result
}

function isInterruptError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message.includes('ERR_USE_AFTER_CLOSE'))
  )
}

function isReadlineClosed(rl: ReturnType<typeof createInterface>): boolean {
  return (rl as { closed?: boolean }).closed === true
}

async function askQuestion(
  rl: ReturnType<typeof createInterface>,
  prompt: string,
): Promise<string | null> {
  if (isReadlineClosed(rl)) return null
  try {
    return await rl.question(prompt)
  } catch (error) {
    if (isInterruptError(error)) {
      writeLine('\nInterrupted.')
      return null
    }
    throw error
  }
}

function getCurrentInputText(rl: ReturnType<typeof createInterface>): string {
  return ((rl as unknown as { line?: string }).line ?? '').trim()
}

async function promptForMainInput(
  rl: ReturnType<typeof createInterface>,
  onSlashRequested: () => Promise<string | null>,
  onFileRequested: () => Promise<string | null>,
): Promise<string | null> {
  const stdin = process.stdin
  if (!stdin.isTTY) return askQuestion(rl, '\n> ')
  if (process.env.TYCLI_HOTKEY_MENUS === '0') return askQuestion(rl, '\n> ')

  emitKeypressEvents(stdin, rl)
  rl.setPrompt('\n> ')
  rl.prompt()

  return await new Promise<string | null>((resolve) => {
    let settled = false
    let menuOpen = false

    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      stdin.off('keypress', onKeypress)
      rl.off('line', onLine)
      rl.off('close', onClose)
      resolve(value)
    }

    const onLine = (line: string) => {
      if (menuOpen) return
      finish(line)
    }
    const onClose = () => finish(null)
    const onKeypress = (str: string, key: { ctrl?: boolean; sequence?: string }) => {
      if (key.ctrl) return
      const typedSlash = str === '/' || key.sequence === '/'
      const typedAt = str === '@' || key.sequence === '@'
      if (!typedSlash && !typedAt) return
      const current = getCurrentInputText(rl)
      const triggerChar = typedSlash ? '/' : '@'
      if (current.length > 1) return
      if (current.length === 1 && current !== triggerChar) return
      ;(async () => {
        menuOpen = true
        rl.write('', { ctrl: true, name: 'u' })
        const selected = typedSlash ? await onSlashRequested() : await onFileRequested()
        menuOpen = false
        finish(selected ?? '')
      })().catch(() => {
        menuOpen = false
        finish('')
      })
    }

    stdin.on('keypress', onKeypress)
    rl.on('line', onLine)
    rl.on('close', onClose)
  })
}

async function handleKeysCommand(
  rl: ReturnType<typeof createInterface>,
  ty: Taskyon,
  llmState: llmSettings,
) {
  const providers = [...SUPPORTED_PROVIDERS]
  while (true) {
    const all = await ty.listSecrets(API_KEY_STORE_NAME)
    writeLine('\nKey menu:')
    providers.forEach((provider, idx) => {
      writeLine(`${idx + 1}. ${provider} (${maskKey(all[provider])})`)
    })
    writeLine(`${providers.length + 1}. back`)

    const choiceInput = await askQuestion(rl, 'Choose provider: ')
    if (choiceInput === null) return
    const choiceRaw = choiceInput.trim()
    const choice = Number(choiceRaw)
    if (!Number.isInteger(choice) || choice < 1 || choice > providers.length + 1) {
      writeError('Invalid selection.')
      continue
    }
    if (choice === providers.length + 1) return

    const provider = providers[choice - 1]!
    const action = await selectFromList(rl, `\n/${provider}`, ['set key', 'remove key', 'back'])
    if (action === null || action === 2) continue

    if (action === 0) {
      const keyInput = await askQuestion(rl, `Enter key for ${provider}: `)
      if (keyInput === null) return
      const key = keyInput.trim()
      if (!key) {
        writeError('Key cannot be empty.')
        continue
      }
      await ty.setSecret(API_KEY_STORE_NAME, provider, key)
      await ty.updateChatCompletionApiKey(provider, key)
      llmState.selectedApi = provider
      await setSelectedApi(ty, provider)
      writeLine(`Saved key for ${provider}.`)
      writeLine(`Selected provider: ${provider}`)
    }

    if (action === 1) {
      await ty.deleteSecret(API_KEY_STORE_NAME, provider)
      await ty.updateChatCompletionApiKey(provider, undefined)
      writeLine(`Removed key for ${provider}.`)
    }
  }
}

async function handleModelCommand(
  rl: ReturnType<typeof createInterface>,
  ty: Taskyon,
  llmState: llmSettings,
) {
  const apis = llmState.llmApis
  const selectedApi = String(llmState.selectedApi ?? 'local')
  writeLine(`Current provider: ${selectedApi}`)
  writeLine(
    `Current model: ${apis[selectedApi]?.selectedModel ?? apis[selectedApi]?.defaultModel ?? 'unknown'}`,
  )
  const action = await selectFromList(rl, '\nModel menu', [
    'select model from provider list',
    'set model id manually',
    'back',
  ])
  if (action === null || action === 2) return

  if (action === 0) {
    const api = apis[selectedApi]
    if (!api) {
      writeError(`No API definition for '${selectedApi}'.`)
      return
    }
    const key =
      (await ty.getSecret(API_KEY_STORE_NAME, selectedApi, false, false)) ??
      resolveKeyForProvider(selectedApi)
    if (!key) {
      writeError(`No key configured for '${selectedApi}'. Run /keys first.`)
      return
    }

    let modelMap: Record<string, LlmModel>
    try {
      writeLine(`Fetching model list for ${selectedApi}...`)
      if (selectedApi === 'taskyon') {
        writeLine(
          'Hint: You can inspect Taskyon model availability and details at https://taskyon.space/pricing',
        )
      }
      modelMap = await fetchProviderModels(selectedApi, api, key)
    } catch (error) {
      writeError(error instanceof Error ? error.message : String(error))
      return
    }

    const allowedModels =
      selectedApi === 'taskyon'
        ? getAllowedTaskyonModels(
            (await ty.getSecret(API_KEY_STORE_NAME, 'taskyon', false, false)) ?? key,
          )
        : undefined
    const useVisionOnly = ((await askQuestion(rl, 'Only vision models? (y/N): ')) ?? '')
      .trim()
      .toLowerCase()
    const onlyVision = useVisionOnly === 'y' || useVisionOnly === 'yes'
    const options = modelOptionsForProvider(selectedApi, modelMap, allowedModels, onlyVision)
    if (options.length <= 0) {
      writeError('No models available after filtering.')
      return
    }

    rl.pause()
    let model: string | null = null
    try {
      model = await selectModelInteractive(options)
    } finally {
      rl.resume()
    }
    if (!model) {
      writeLine('Model selection cancelled.')
      return
    }
    const currentApi = apis[selectedApi]
    if (!currentApi) throw new Error(`Provider config missing: ${selectedApi}`)
    apis[selectedApi] = { ...currentApi, selectedModel: model }
    await persistConfigPatch({ taskyonModel: model })
    writeLine(`Selected model for ${selectedApi}: ${model}`)
    return
  }

  if (action === 1) {
    const modelInput = await askQuestion(rl, 'Enter model id: ')
    if (modelInput === null) return
    const model = modelInput.trim()
    if (!model) {
      writeError('Model id cannot be empty.')
      return
    }
    const currentApi = apis[selectedApi]
    if (!currentApi) throw new Error(`Provider config missing: ${selectedApi}`)
    apis[selectedApi] = { ...currentApi, selectedModel: model }
    await persistConfigPatch({ taskyonModel: model })
    writeLine(`Selected model for ${selectedApi}: ${model}`)
  }
}

async function handleProviderCommand(
  rl: ReturnType<typeof createInterface>,
  ty: Taskyon,
  llmState: llmSettings,
) {
  const idx = await selectFromList(rl, '\nSelect provider', [...SUPPORTED_PROVIDERS])
  if (idx === null) return
  const nextApi = String(SUPPORTED_PROVIDERS[idx]!)
  llmState.selectedApi = nextApi
  await setSelectedApi(ty, nextApi)
  writeLine(`Selected provider: ${nextApi}`)
}

async function handleToolsCommand(ty: Taskyon, target?: Record<string, { hideChat?: boolean }>) {
  const all = await ty.updateToolDefinitions(true)
  if (target) {
    for (const key of Object.keys(target)) delete target[key]
    for (const [name, def] of Object.entries(
      all as Record<string, { renderOptions?: { hideChat?: boolean } }>,
    )) {
      target[name] = { hideChat: Boolean(def.renderOptions?.hideChat) }
    }
  }
  const allToolNames = Object.keys(all).sort()
  writeLine('\nActive tool definitions:')
  allToolNames.forEach((toolName, idx) => {
    const kind = ACTIVE_LLM_TOOLS.includes(toolName)
      ? 'llm-allowed'
      : toolName === ENTRY_NODE_TOOL_NAME
        ? 'entry-node'
        : 'internal'
    writeLine(`${idx + 1}. ${toolName} (${kind})`)
  })
}

async function refreshToolRenderOptions(
  ty: Taskyon,
  target: Record<string, { hideChat?: boolean }>,
) {
  const all = await ty.updateToolDefinitions(true)
  for (const key of Object.keys(target)) delete target[key]
  for (const [name, def] of Object.entries(
    all as Record<string, { renderOptions?: { hideChat?: boolean } }>,
  )) {
    target[name] = { hideChat: Boolean(def.renderOptions?.hideChat) }
  }
}

async function handleDebugCommand(rl: ReturnType<typeof createInterface>, parsedArgs: string) {
  const arg = parsedArgs.trim().toLowerCase()
  if (arg === 'on') {
    debugLogsEnabled = true
    writeLine('Debug logs: ON')
    return
  }
  if (arg === 'off') {
    debugLogsEnabled = false
    writeLine('Debug logs: OFF')
    return
  }
  const options = ['toggle', 'on', 'off', 'back']
  const choice = await selectFromList(rl, '\nDebug logging', options)
  if (choice === null || choice === 3) return
  if (choice === 0) debugLogsEnabled = !debugLogsEnabled
  if (choice === 1) debugLogsEnabled = true
  if (choice === 2) debugLogsEnabled = false
  writeLine(`Debug logs: ${debugLogsEnabled ? 'ON' : 'OFF'}`)
}

async function handleSettingsCommand(
  rl: ReturnType<typeof createInterface>,
  uiSettings: { showRoleTag: boolean; showFullFunctionResults: boolean },
) {
  const choice = await selectFromList(rl, '\nSettings', [
    `toggle role/type tags ([user|message]): ${uiSettings.showRoleTag ? 'ON' : 'OFF'}`,
    `toggle full function results (session): ${uiSettings.showFullFunctionResults ? 'ON' : 'OFF'}`,
    'back',
  ])
  if (choice === null || choice === 2) return
  if (choice === 0) {
    uiSettings.showRoleTag = !uiSettings.showRoleTag
    await persistConfigPatch({
      cliUi: {
        showRoleTag: uiSettings.showRoleTag,
      },
    })
    writeLine(`Role/type tags: ${uiSettings.showRoleTag ? 'ON' : 'OFF'}`)
    return
  }
  uiSettings.showFullFunctionResults = !uiSettings.showFullFunctionResults
  writeLine(`Full function results (session): ${uiSettings.showFullFunctionResults ? 'ON' : 'OFF'}`)
}

async function handleSlashCommand(
  parsed: SlashParsed,
  rl: ReturnType<typeof createInterface>,
  ty: Taskyon,
  llmState: llmSettings,
  uiSettings: { showRoleTag: boolean; showFullFunctionResults: boolean },
  toolRenderOptions: Record<string, { hideChat?: boolean }>,
): Promise<boolean> {
  if (parsed.name === 'keys') {
    await handleKeysCommand(rl, ty, llmState)
    return true
  }

  if (parsed.name === 'model') {
    await handleModelCommand(rl, ty, llmState)
    return true
  }

  if (parsed.name === 'provider') {
    await handleProviderCommand(rl, ty, llmState)
    return true
  }

  if (parsed.name === 'tools') {
    await handleToolsCommand(ty, toolRenderOptions)
    return true
  }

  if (parsed.name === 'debug') {
    await handleDebugCommand(rl, parsed.args)
    return true
  }

  if (parsed.name === 'settings') {
    await handleSettingsCommand(rl, uiSettings)
    return true
  }

  if (parsed.name === 'exit' || parsed.name === 'quit') {
    return false
  }

  writeError(
    `Unknown command '/${parsed.name}'. Supported: /keys, /provider, /model, /tools, /debug, /settings, /exit, /quit`,
  )
  return true
}

async function loadProjectInstructions(cwd: string): Promise<string> {
  const parts: string[] = []
  let current = resolve(cwd)
  for (;;) {
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      const filePath = join(current, name)
      try {
        const content = await readFile(filePath, 'utf8')
        if (content.trim()) {
          parts.push(`# ${relative(cwd, filePath) || name}\n\n${content.trim()}`)
        }
      } catch {
        // File doesn't exist or is unreadable — skip.
      }
    }
    const parentDir = resolve(current, '..')
    if (parentDir === current) break
    current = parentDir
  }
  if (parts.length <= 0) return ''
  return `## Project Instructions\n\nThe following project instructions were loaded from files found in the workspace:\n\n${parts.reverse().join('\n\n')}`
}

async function main() {
  const startupMeta = await loadStartupMeta()
  const { cryptoSession, stored } = await initPersistentCryptoSession()
  const configDir = await resolveConfigDirectoryPath()
  const pgliteNodeDir = join(configDir, 'pglite')
  await mkdir(pgliteNodeDir, { recursive: true })
  const selectedApi = resolveProviderSelection(stored)

  if (!baseApiDefinitions[selectedApi]) {
    throw new Error(
      `Unsupported provider '${selectedApi}'. Choose one of: ${SUPPORTED_PROVIDERS.join(', ')}`,
    )
  }

  const model = process.env.TASKYON_MODEL ?? stored.taskyonModel
  const providerKey = resolveKeyForProvider(selectedApi)
  const config = {
    selectedApi,
    ...(model ? { model } : {}),
    ...(providerKey ? { key: providerKey } : {}),
  } as CliApiConfig
  const explorationContextFiles: Record<string, string> = {}
  const { formatExplorationContext, createExplorationTool } =
    await import('./tools/explorationTool')
  const { updateFilesTool } = await import('./tools/patchTool')
  const explorationTool = createExplorationTool(explorationContextFiles)

  let llmState = createCliLlmSettings(config)
  const uiSettings = {
    showRoleTag: stored.cliUi?.showRoleTag ?? true,
    showFullFunctionResults: false,
  }
  const toolRenderOptions: Record<string, { hideChat?: boolean }> = {}
  const projectInstructions = await loadProjectInstructions(process.cwd())
  const taskyonRef: { current?: Taskyon } = {}
  const cliEntryNodeTool = createStandardEntryNodeTool({
    name: ENTRY_NODE_TOOL_NAME,
    renderOptions: { hideLlm: true, hideChat: true },
    defaultAllowedTools: [...ACTIVE_LLM_TOOLS],
    toolChooser: { enabled: true, useTools: true },
    getToolCatalog: async () => {
      const ty = taskyonRef.current
      if (!ty) return []
      const allTools = await ty.updateToolDefinitions(true)
      return Object.values(allTools)
        .filter(
          (tool: { name: string; description: string }) =>
            !['chatCompletion', 'entryNode', 'taskyonFlow'].includes(tool.name),
        )
        .map((tool: { name: string; description: string }) => ({
          name: tool.name,
          description: tool.description,
        }))
    },
    extraContext: ({ toolResultSection }: { toolResultSection?: string }) =>
      [
        projectInstructions,
        buildCliEnvironmentContext(
          toolResultSection || '(none)',
          formatExplorationContext(explorationContextFiles),
        ),
      ]
        .filter(Boolean)
        .join('\n\n'),
  })
  const cliEntryTask = toolCall({
    name: ENTRY_NODE_TOOL_NAME,
    arguments: {},
  })
  llmState = {
    ...llmState,
    entryFunction: ENTRY_NODE_TOOL_NAME,
  }
  const taskyon = await tyCore(
    () => llmState,
    () => cliEntryTask,
    () => ({
      entryNode: {
        llmTools: true,
        use_baseprompt: true,
        use_multimodal: true,
        max_error_retries: 3,
        prompt_templates: DEFAULT_PROMPT_TEMPLATES,
      },
      chatCompletion: {
        llmTools: true,
      },
    }),
    [cliEntryNodeTool, explorationTool, updateFilesTool] as unknown as [],
    cryptoSession,
    {
      nodePgLiteDataDir: pgliteNodeDir,
    },
  )
  taskyonRef.current = taskyon
  const conversationPersistence = await createConversationPersistence({
    taskyon,
    configDir,
  })
  await refreshToolRenderOptions(taskyon, toolRenderOptions)

  const persistedKey = await taskyon.getSecret(API_KEY_STORE_NAME, selectedApi, false, false)
  const bootstrapKey = persistedKey ?? config.key
  if (bootstrapKey) {
    await taskyon.setSecret(API_KEY_STORE_NAME, selectedApi, bootstrapKey)
    await taskyon.updateChatCompletionApiKey(selectedApi, bootstrapKey)
  }

  if (llmState.selectedApi === 'local') {
    const localApi = llmState.llmApis.local
    if (!localApi) throw new Error("Local provider config 'llmApis.local' is missing")
    const isReachable = await canReachLocalApi(localApi.baseURL)
    if (!isReachable) {
      const taskyonKey = await taskyon.getSecret(API_KEY_STORE_NAME, 'taskyon', false, false)
      if (taskyonKey) {
        llmState.selectedApi = 'taskyon'
        await persistConfigPatch({ selectedApi: 'taskyon' })
        await taskyon.updateChatCompletionApiKey('taskyon', taskyonKey)
        writeLine(
          "Local LLM at http://localhost:8080 is unreachable. Switched provider to 'taskyon'.",
        )
      } else {
        writeLine(
          'Warning: local provider selected but http://localhost:8080 is unreachable. Configure a provider via /keys and switch with /provider.',
        )
      }
    }
  }

  const { x: clientPort, y: bridgePort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()
  const unsubscribeBridgeToTaskyon = bridgePort.receive((msg) => taskyon.port.send(msg))
  const unsubscribeTaskyonToBridge = taskyon.port.receive((msg) => bridgePort.send(msg))

  const unsubscribeFunctionCalls = clientPort.receive(async (msg: TaskyonMessage) => {
    if (!isRemoteFunctionCall(msg) || msg.functionName !== cliBashTool.name) return
    try {
      const response = await executeBashCommand((msg.arguments ?? {}) as BashToolArgs)
      clientPort.send({
        type: 'functionResponse',
        functionName: msg.functionName,
        requestId: msg.requestId,
        response,
      })
    } catch (error) {
      clientPort.send({
        type: 'functionResponse',
        functionName: msg.functionName,
        requestId: msg.requestId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  clientPort.send({ type: 'functionDescription', ...cliBashTool } as unknown as TaskyonMessage)

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    historySize: 500,
    removeHistoryDuplicates: false,
  })
  let currentLeafId: string | undefined
  let waitingForTask = false
  let interruptedCurrentTask = false
  let requestQuitOnNextPrompt = false
  let inMenuInteraction = false
  let shuttingDown = false
  let stopMainLoop = false
  let requestedExitCode = 0
  let shutdownForceTimer: ReturnType<typeof setTimeout> | null = null
  let lastSigintAt = 0
  let thinkingLines: string[] = []
  let thinkingPanelHeight = 0
  const activeWorkerTasks = new Set<string>()
  let hasWorkerProcessing = false
  const taskFeed: TaskNode[] = []
  const taskSnapshotById = new Map<string, string>()

  const clearThinkingPanel = () => {
    if (thinkingPanelHeight <= 0) return
    for (let i = 0; i < thinkingPanelHeight; i += 1) {
      process.stdout.write('\x1b[1A\x1b[2K')
    }
    thinkingPanelHeight = 0
  }

  const clearLastPromptLine = () => {
    if (!process.stdout.isTTY) return
    process.stdout.write('\x1b[1A\x1b[2K')
  }

  const restorePromptIfIdle = () => {
    if (waitingForTask || inMenuInteraction || requestQuitOnNextPrompt || shuttingDown) return
    if (!process.stdin.isTTY || process.env.TYCLI_HOTKEY_MENUS === '0') return
    if (isReadlineClosed(rl)) return
    rl.setPrompt('\n> ')
    rl.prompt()
  }

  const resetThinking = () => {
    clearThinkingPanel()
    thinkingLines = []
    activeWorkerTasks.clear()
    hasWorkerProcessing = false
  }

  const renderThinkingPanel = () => {
    if (!waitingForTask) return
    const recent = thinkingLines.slice(-5)
    clearThinkingPanel()
    const processingLabel =
      activeWorkerTasks.size > 0 || hasWorkerProcessing ? 'processing tasks...' : ''
    if (recent.length <= 0 && !processingLabel) return
    const panel = recent.length > 0 ? ['[thinking]', ...recent.map((line) => `  ${line}`)] : []
    if (processingLabel) panel.push(`[status] ${processingLabel}`)
    process.stdout.write(`${panel.join('\n')}\n`)
    thinkingPanelHeight = panel.length
  }

  const trackWorkerProgress = (event: WorkerEvent) => {
    const taskId = event.task?.id ?? event.taskId ?? null
    const stage = event.stage ?? ''
    if (stage === 'queued' || stage === 'processing') {
      if (taskId) activeWorkerTasks.add(taskId)
      if (stage === 'processing') hasWorkerProcessing = true
    }
    if (stage === 'processed' || stage === 'aborted' || stage === 'error') {
      if (taskId) activeWorkerTasks.delete(taskId)
      if (stage !== 'processed') hasWorkerProcessing = false
      if (activeWorkerTasks.size === 0 && stage === 'processed') hasWorkerProcessing = false
    }
  }

  const appendThinkingText = (delta: string) => {
    if (!delta) return
    const next = delta
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (next.length <= 0) return
    thinkingLines = [...thinkingLines, ...next].slice(-5)
    renderThinkingPanel()
  }

  const requestImmediateShutdown = (reason: string, exitCode = 0) => {
    if (shuttingDown) return
    shuttingDown = true
    stopMainLoop = true
    requestedExitCode = exitCode
    interruptedCurrentTask = true
    requestQuitOnNextPrompt = false
    clearThinkingPanel()
    try {
      taskyon.workerStop(reason)
    } catch {
      // best effort
    }
    if (shutdownForceTimer === null) {
      shutdownForceTimer = setTimeout(() => {
        process.exit(exitCode === 0 ? 1 : exitCode)
      }, 2000)
      shutdownForceTimer.unref()
    }
    if (!isReadlineClosed(rl)) rl.close()
  }

  const onSigint = () => {
    if (shuttingDown) return
    const now = Date.now()
    if (now - lastSigintAt <= 1500) {
      writeLine('\nForce exiting...')
      requestImmediateShutdown('Forced by double Ctrl+C', 130)
      return
    }
    lastSigintAt = now
    if (waitingForTask) {
      interruptedCurrentTask = true
      writeLine('\nInterrupting current task...')
      taskyon.workerStop('Interrupted by Ctrl+C')
      resetThinking()
      return
    }
    const line = getCurrentInputText(rl)
    if (line.length > 0 || inMenuInteraction) {
      writeLine('')
      return
    }
    requestQuitOnNextPrompt = true
    writeLine('\nQuit tycli? (y/N)')
  }
  const onSigterm = () => requestImmediateShutdown('Received SIGTERM', 143)
  const onSighup = () => requestImmediateShutdown('Received SIGHUP', 129)
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  process.on('SIGHUP', onSighup)
  const unsubscribeThinkingStream = taskyon.chatCompletionStream(
    ({ chunk }: { chunk: unknown }) => {
      if (!waitingForTask) return
      appendThinkingText(normalizeThinkingChunk(chunk))
    },
  )
  const unsubscribeTaskProgress = clientPort.receive((msg: TaskyonMessage) => {
    if (!isTaskCreatedMessage(msg)) return
    const task = msg.task
    const snapshot = JSON.stringify(task.content)
    const prev = taskSnapshotById.get(task.id)
    if (prev === snapshot) return
    taskSnapshotById.set(task.id, snapshot)
    const existingIdx = taskFeed.findIndex((t) => t.id === task.id)
    if (existingIdx >= 0) taskFeed[existingIdx] = task
    else taskFeed.push(task)
    renderTaskProgress(
      {
        debugEnabled: () => debugLogsEnabled,
        showRoleTag: () => uiSettings.showRoleTag,
        showFullFunctionResults: () => uiSettings.showFullFunctionResults,
        isFunctionHiddenInChat: (name: string) => Boolean(toolRenderOptions[name]?.hideChat),
        clearThinkingPanel,
        renderThinkingPanel,
        writeLine,
      },
      task,
      Boolean(prev),
    )
    restorePromptIfIdle()
  })
  const unsubscribeWorkerProgress = taskyon.workerStream((event: unknown) => {
    const workerEvent = event as WorkerEvent
    trackWorkerProgress(workerEvent)
    renderWorkerProgress(
      {
        debugEnabled: () => debugLogsEnabled,
        showRoleTag: () => uiSettings.showRoleTag,
        showFullFunctionResults: () => uiSettings.showFullFunctionResults,
        isFunctionHiddenInChat: () => false,
        clearThinkingPanel,
        renderThinkingPanel,
        writeLine,
      },
      workerEvent,
    )
    renderThinkingPanel()
    restorePromptIfIdle()
  })

  writeLine(
    `tycli ready. provider=${String(llmState.selectedApi ?? 'local')} model=${(llmState.llmApis as Record<string, { selectedModel?: string }>)[String(llmState.selectedApi ?? 'local')]?.selectedModel ?? baseApiDefinitions[String(llmState.selectedApi ?? 'local')]?.defaultModel}`,
  )
  writeLine(
    `tycli version=${startupMeta.version} commit=${startupMeta.commit} buildDate=${startupMeta.buildDate}`,
  )
  writeLine('Commands: /keys, /provider, /model, /tools, /debug, /settings, /exit, /quit, @<file>')
  if (debugLogsEnabled) writeLine('Debug logs enabled (TYCLI_DEBUG=1).')

  try {
    while (true) {
      if (stopMainLoop) break
      let input = ''
      inMenuInteraction = false
      if (requestQuitOnNextPrompt) {
        const answerRaw = await askQuestion(rl, '> ')
        requestQuitOnNextPrompt = false
        if (answerRaw === null) {
          if (shuttingDown || isReadlineClosed(rl)) break
          continue
        }
        const answer = answerRaw.trim().toLowerCase()
        if (answer === 'y' || answer === 'yes') {
          requestImmediateShutdown('User requested exit', 0)
          break
        }
        continue
      }
      const inputRaw = await promptForMainInput(
        rl,
        async () => {
          inMenuInteraction = true
          const selected = await selectSlashCommand(rl, '')
          inMenuInteraction = false
          return selected
        },
        async () => {
          inMenuInteraction = true
          const selected = await selectFileReference(rl, '')
          inMenuInteraction = false
          return selected ? `@${selected}` : null
        },
      )
      if (inputRaw === null) {
        if (isReadlineClosed(rl)) {
          requestImmediateShutdown('EOF/Readline closed', 0)
          break
        }
        continue
      }
      input = inputRaw.trim()
      if (!input) continue
      const isChatMessage = !input.startsWith('/') && !input.startsWith('@')
      if (isChatMessage) clearLastPromptLine()
      if (input.startsWith('@')) {
        const rawQuery = input.slice(1).trim()
        const selectedPath =
          rawQuery.length > 0 && (await fileExistsInWorkspace(rawQuery))
            ? rawQuery
            : await selectFileReference(rl, rawQuery)
        if (!selectedPath) continue
        try {
          const content = await readFile(join(process.cwd(), selectedPath), 'utf8')
          explorationContextFiles[selectedPath] = content
          writeLine(`Added file context: ${selectedPath} (${content.length} chars)`)
        } catch (error) {
          writeError(
            `Failed to load file '${selectedPath}': ${error instanceof Error ? error.message : String(error)}`,
          )
        }
        continue
      }
      if (input.startsWith('/')) {
        const parsedDirect = parseSlashName(input)
        const knownDirect =
          parsedDirect !== null &&
          SLASH_COMMANDS.includes(parsedDirect.name as (typeof SLASH_COMMANDS)[number])
        if (input === '/' || !knownDirect) {
          const initialQuery = input.slice(1).trim()
          inMenuInteraction = true
          const selected = await selectSlashCommand(rl, initialQuery)
          inMenuInteraction = false
          if (!selected) continue
          input = selected
        }
      }

      const parsed = parseSlashName(input)
      if (parsed) {
        inMenuInteraction = true
        const keepRunning = await handleSlashCommand(
          parsed,
          rl,
          taskyon,
          llmState,
          uiSettings,
          toolRenderOptions,
        )
        inMenuInteraction = false
        if (!keepRunning) {
          requestImmediateShutdown('Slash command exit', 0)
          break
        }
        continue
      }

      const currentProvider = String(llmState.selectedApi ?? 'local')
      if (!(await taskyon.getSecret(API_KEY_STORE_NAME, currentProvider, false, false))) {
        writeError(`No key configured for '${currentProvider}'. Run /keys first.`)
        continue
      }

      const taskChain = await createPreparedTaskChain(
        [
          {
            role: 'user',
            content: {
              type: 'message',
              data: input,
            },
          },
          toolCall({
            name: ENTRY_NODE_TOOL_NAME,
            arguments: {},
          }),
        ],
        currentLeafId,
      )
      currentLeafId = taskChain[taskChain.length - 1]?.id ?? currentLeafId

      clientPort.send({ type: 'tasks', tasks: taskChain, execute: true, show: true })
      writeDebug(`queued task chain: ${taskChain.map((task) => task.id).join(', ')}`)
      try {
        waitingForTask = true
        interruptedCurrentTask = false
        resetThinking()
        const result = await waitForTaskResult(
          clientPort,
          taskChain.map((task) => task.id),
          ['message', 'error', 'return'],
          10 * 60 * 1000,
        )
        waitingForTask = false
        clearThinkingPanel()
        if (interruptedCurrentTask) {
          writeLine('Task interrupted.')
          restorePromptIfIdle()
          continue
        }
        currentLeafId = result.id
        await conversationPersistence.persist(currentLeafId)
        writeDebug(`received result task: ${result.id} (${result.content.type})`)
        restorePromptIfIdle()
      } catch (error) {
        waitingForTask = false
        clearThinkingPanel()
        if (interruptedCurrentTask) {
          writeLine('Task interrupted.')
          restorePromptIfIdle()
          continue
        }
        writeError(error instanceof Error ? error.message : String(error))
        restorePromptIfIdle()
      }
    }
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGTERM', onSigterm)
    process.off('SIGHUP', onSighup)
    unsubscribeThinkingStream()
    unsubscribeTaskProgress()
    unsubscribeWorkerProgress()
    if (!isReadlineClosed(rl)) rl.close()
    unsubscribeFunctionCalls()
    unsubscribeBridgeToTaskyon()
    unsubscribeTaskyonToBridge()
    await conversationPersistence.persist(currentLeafId).catch(() => {})
    taskyon.workerStop('tycli exit')
    writeLine(`Conversation saved: ${conversationPersistence.filePath}`)
    if (shutdownForceTimer !== null) {
      clearTimeout(shutdownForceTimer)
      shutdownForceTimer = null
    }
    process.exitCode = requestedExitCode
  }
}

process.on('uncaughtException', (error) => {
  void reportFatalError(error).finally(() => {
    exitAfterFatalError(1)
  })
})

process.on('unhandledRejection', (reason) => {
  void reportFatalError(reason).finally(() => {
    exitAfterFatalError(1)
  })
})

void main().catch((error) => {
  void reportFatalError(error).finally(() => {
    process.exitCode = 1
  })
})
