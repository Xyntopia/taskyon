import './node-shims'

import { createInterface } from 'node:readline/promises'
import { emitKeypressEvents } from 'node:readline'
import { spawn } from 'node:child_process'
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import process from 'node:process'
import { inspect } from 'node:util'
import { createDuplexChannel, createUnavailableIframeMux } from '../../shared/modules/frpBus'
import { createTaskNode } from '../../taskyon/src/core/createTasks'
import { tyCore } from '../../taskyon/src/core/init'
import { createExternalToolContext, registerToolRpcExecutor } from '../../taskyon/src/core/toolRpc'
import type { Taskyon } from '../../taskyon/src/core/init'
import { createStandardEntryNodeTool } from '../../taskyon/src/tools/entryNode'
import type { TaskyonMessage } from '../../taskyon/src/types/apiTypes'
import type { llmSettings } from '../../taskyon/src/types/profiles'
import type { partialTaskDraft, TaskNode } from '../../taskyon/src/types/taskNode'
import { createTool, toolCall, type ClientTool } from '../../taskyon/src/types/toolApi'
import {
  getProviderOauthConfig,
  getProviderOauthCredentialsSecretName,
} from '../../taskyon/src/utils/providerAuth'
import {
  initPersistentCryptoSession,
  loadStoredConfig,
  persistProviderModel,
  persistConfigPatch,
  resolveKeyForProvider,
  resolveProviderSelection,
  resolveStoredModel,
  resolveConfigDirectoryPath,
} from './cli/config'
import { createConversationPersistence } from './cli/conversationPersistence'
import { createCliFooter } from './cli/ui'
import {
  applyCodexAccountHeader,
  canReachLocalApi,
  codexModelOptions,
  createCliLlmSettings,
  fetchProviderModels,
  getAllowedTaskyonModels,
  normalizeStoredModelForProvider,
  modelOptionsForProvider,
} from './cli/models'
import { hasInterruptibleWorkerActivity } from './cli/interruptState'
import { syncProviderRuntimeConfig } from './cli/runtime'
import { renderTaskProgress, renderWorkerProgress, type WorkerEvent } from './cli/taskRenderer'
import {
  API_KEY_STORE_NAME,
  type CliApiConfig,
  type LlmModel,
  MAX_MODEL_OPTIONS,
  SLASH_COMMANDS,
  SUPPORTED_PROVIDERS,
  type TycliSessionRecord,
} from './cli/types'
import { formatExplorationContext, createExplorationTool } from './tools/explorationTool'
import { updateFilesTool } from './tools/patchTool'
import { downloadFileTool } from './tools/downloadFileTool'

type BashToolArgs = {
  command?: string
  cwd?: string
  timeoutMs?: number
}

type SlashParsed = {
  name: string
  args: string
}

const DEFAULT_PROMPT_TEMPLATES = {
  basePrompt:
    'You are a helpful assistant called Taskyon. Return concise and correct Markdown answers.',
  instruction:
    'Complete the task accurately. If structured output is requested, follow the required format exactly.',
  toolResult: 'Evaluate the following tool result and respond in {format}:\\n\\n{message}',
  task: 'Complete this task:\\n\\n{message}',
  evaluate: 'Evaluate this message and respond in {format}:\\n\\n{message}',
  schemaReminder:
    'Output must strictly match {format} and this schema:\\n\\n{schema}\\n\\nDo not add extra text.',
  tools: 'Available tools:\\n\\n${tools}',
}
const ENTRY_NODE_TOOL_NAME = 'entryNode'
let debugLogsEnabled = process.env.TYCLI_DEBUG === '1'
const EXPLORATION_TOOL_NAME = 'exploration'
const UPDATE_FILES_TOOL_NAME = 'updateFiles'
const DOWNLOAD_FILE_TOOL_NAME = 'downloadFile'
const FILE_PICKER_MAX_DEPTH = 3
const FILE_PICKER_MAX_ENTRIES = 5000
const FILE_PICKER_MAX_OPTIONS = 30
const CLI_INPUT_HISTORY_LIMIT = 500
const CLI_SESSION_HISTORY_LIMIT = 20
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
const RUNTIME_LOG_MAX_BYTES = 100 * 1024 * 1024

function adoptInvocationWorkingDirectory() {
  const cwd =
    process.env.TYCLI_CWD?.trim() || process.env.PROJECT_CWD?.trim() || process.env.INIT_CWD?.trim()
  if (!cwd || cwd === process.cwd()) return
  process.chdir(cwd)
}

type RuntimeLog = {
  filePath: string
  append: (source: string, text: string) => void
  flush: () => Promise<void>
}

type PromptPrefixStatus = {
  activeTasks: number
  model: string
  provider: string
  taskState: 'idle' | 'processing' | 'finished'
}

type SessionLocationInfo = {
  conversationPath: string
  logPath?: string
}

let runtimeLog: RuntimeLog | undefined

function formatPromptTaskState(status: PromptPrefixStatus): string {
  if (status.activeTasks <= 0) return status.taskState
  return `${status.taskState}:${status.activeTasks}`
}

function formatPromptPrefixLine(status: PromptPrefixStatus): string {
  return `[${status.provider} | ${status.model} | ${formatPromptTaskState(status)}]`
}

function writeLine(text: string) {
  runtimeLog?.append('stdout', `${text}\n`)
  process.stdout.write(`${text}\n`)
}

function writeError(text: string) {
  runtimeLog?.append('stderr', `${text}\n`)
  process.stderr.write(`${text}\n`)
}

function writeNotice(kind: 'info' | 'success' | 'warn' | 'error', text: string) {
  runtimeLog?.append(kind === 'error' ? 'stderr' : 'stdout', `${text}\n`)
  const prefix = kind === 'error' ? 'error: ' : kind === 'warn' ? 'warning: ' : ''
  const stream = kind === 'error' ? process.stderr : process.stdout
  stream.write(`${prefix}${text}\n`)
}

function writeStartupNote(title: string, lines: string[]) {
  runtimeLog?.append('stdout', `${title}\n${lines.join('\n')}\n`)
  process.stdout.write(`${title}\n${lines.join('\n')}\n`)
}

const writeNote = writeStartupNote

function formatSessionLocationLines(info: SessionLocationInfo): string[] {
  return [
    `Conversation storage: ${info.conversationPath}`,
    `tycli log: ${info.logPath ?? 'unavailable'}`,
  ]
}

function writeSessionLocations(title: string, info: SessionLocationInfo) {
  writeNote(title, formatSessionLocationLines(info))
}

function writeIntro(title: string) {
  runtimeLog?.append('stdout', `${title}\n`)
  process.stdout.write(`${title}\n`)
}

function writeOutro(message: string) {
  runtimeLog?.append('stdout', `${message}\n`)
  process.stdout.write(`${message}\n`)
}

function restoreTerminalInput() {
  const stdin = process.stdin
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return
  try {
    stdin.setRawMode(false)
  } catch {
    // Terminal cleanup is best-effort during fatal or interrupted shutdown paths.
  }
}

function suspendProcess() {
  restoreTerminalInput()
  process.kill(process.pid, 'SIGTSTP')
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

const formatRuntimeConsoleArgs = (args: readonly unknown[]) =>
  args
    .map((arg) =>
      typeof arg === 'string'
        ? arg
        : inspect(arg, {
            depth: 6,
            maxArrayLength: 50,
            maxStringLength: 10_000,
            breakLength: 120,
          }),
    )
    .join(' ')

async function createRuntimeLog(): Promise<RuntimeLog> {
  const logDir = process.env.TYCLI_LOG_DIR?.trim() || join('/tmp', 'tycli')
  await mkdir(logDir, { recursive: true })
  const filePath = join(logDir, `tycli_${errorTimestamp()}_${process.pid}.log`)
  const initialText = [
    `timestamp=${new Date().toISOString()}`,
    `cwd=${process.cwd()}`,
    `pid=${process.pid}`,
    `maxBytes=${RUNTIME_LOG_MAX_BYTES}`,
    '',
  ].join('\n')
  await writeFile(filePath, initialText, 'utf8')

  let bytesWritten = Buffer.byteLength(initialText)
  let queue = Promise.resolve()

  const appendBounded = async (source: string, text: string) => {
    const timestamp = new Date().toISOString()
    const body = `[${timestamp}] [${source}] ${text}`
    let chunk = Buffer.from(body, 'utf8')
    if (chunk.byteLength >= RUNTIME_LOG_MAX_BYTES) {
      chunk = chunk.subarray(chunk.byteLength - RUNTIME_LOG_MAX_BYTES + 1024)
    }
    if (bytesWritten + chunk.byteLength > RUNTIME_LOG_MAX_BYTES) {
      const marker = Buffer.from(
        [
          `timestamp=${new Date().toISOString()}`,
          `cwd=${process.cwd()}`,
          `pid=${process.pid}`,
          `maxBytes=${RUNTIME_LOG_MAX_BYTES}`,
          'previous log content truncated because the session exceeded the log size cap',
          '',
        ].join('\n'),
        'utf8',
      )
      await writeFile(filePath, marker)
      bytesWritten = marker.byteLength
    }
    await appendFile(filePath, chunk)
    bytesWritten += chunk.byteLength
  }

  return {
    filePath,
    append: (source, text) => {
      queue = queue
        .then(() => appendBounded(source, text))
        .catch(() => {
          // Runtime logging must never crash the CLI.
        })
    },
    flush: async () => {
      await queue
    },
  }
}

function installRuntimeConsoleLogging(log: RuntimeLog) {
  const original = {
    debug: console.debug,
    error: console.error,
    info: console.info,
    log: console.log,
    warn: console.warn,
  }
  console.debug = (...args: unknown[]) => {
    log.append('console.debug', `${formatRuntimeConsoleArgs(args)}\n`)
    original.debug(...args)
  }
  console.error = (...args: unknown[]) => {
    log.append('console.error', `${formatRuntimeConsoleArgs(args)}\n`)
    original.error(...args)
  }
  console.info = (...args: unknown[]) => {
    log.append('console.info', `${formatRuntimeConsoleArgs(args)}\n`)
    original.info(...args)
  }
  console.log = (...args: unknown[]) => {
    log.append('console.log', `${formatRuntimeConsoleArgs(args)}\n`)
    original.log(...args)
  }
  console.warn = (...args: unknown[]) => {
    log.append('console.warn', `${formatRuntimeConsoleArgs(args)}\n`)
    original.warn(...args)
  }
  return () => {
    console.debug = original.debug
    console.error = original.error
    console.info = original.info
    console.log = original.log
    console.warn = original.warn
  }
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
    restoreTerminalInput()
    writeError(`Fatal error. Details written to ${filePath}`)
  } catch (logError) {
    const fallback = logError instanceof Error ? logError.message : String(logError)
    restoreTerminalInput()
    writeError(`Fatal error. Failed to write error log: ${fallback}`)
    writeError(error instanceof Error ? (error.stack ?? error.message) : String(error))
  }
  await runtimeLog?.flush().catch(() => {})
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

type ReadlineWithMutableHistory = ReturnType<typeof createInterface> & {
  history?: string[]
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

const cliBashTool: ClientTool = createTool({
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
  function: (args) => executeBashCommand(args),
})
const ACTIVE_LLM_TOOLS = [
  cliBashTool.name,
  EXPLORATION_TOOL_NAME,
  UPDATE_FILES_TOOL_NAME,
  DOWNLOAD_FILE_TOOL_NAME,
] as const

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

function isTaskCreatedMessage(
  msg: TaskyonMessage,
): msg is { type: 'taskCreated'; task: TaskNode; parentID?: string } {
  const candidate = msg as { type?: unknown; task?: unknown }
  return candidate.type === 'taskCreated' && !!candidate.task
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
  signal?: AbortSignal,
) {
  const subTasks = new Set<string>(initialIds)
  const quitTypes = Array.isArray(quitCondition) ? quitCondition : [quitCondition]
  return await new Promise<TaskNode>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Task wait aborted', 'AbortError'))
      return
    }
    const timeout = setTimeout(() => {
      cleanup()
      reject(new Error(`Timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timeout)
      unsubscribe()
      signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      cleanup()
      reject(new DOMException('Task wait aborted', 'AbortError'))
    }

    const unsubscribe = port.receive((msg) => {
      if (!isTaskCreatedMessage(msg)) return
      if (!msg.task.parentID || !subTasks.has(msg.task.parentID)) return
      subTasks.add(msg.task.id)
      if (!quitTypes.includes(msg.task.content.type)) return
      cleanup()
      resolve(msg.task)
    })
    signal?.addEventListener('abort', onAbort, { once: true })
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

async function selectFromListRaw(
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

  emitKeypressEvents(stdin)
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
      restoreTerminalInput()
    }
    const finish = (value: number | null) => {
      cleanup()
      resolve(value)
    }
    const cancelWithNotice = (source: 'Ctrl-C' | 'Ctrl-D') => {
      finish(null)
      writeLine(`${source} received.`)
      writeLine('Menu cancelled.')
    }
    const onSigint = () => cancelWithNotice('Ctrl-C')
    const onSigterm = () => finish(null)
    const onKeypress = (str: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') return cancelWithNotice('Ctrl-C')
      if (key.ctrl && key.name === 'd') return cancelWithNotice('Ctrl-D')
      if (key.ctrl && key.name === 'z') {
        cleanup()
        suspendProcess()
        resolve(null)
        return
      }
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
  const initialQuery = config?.initialQuery ?? ''
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

  return selectFromListRaw(title, options, config)
}

async function selectSlashCommand(
  rl: ReturnType<typeof createInterface>,
  initialQuery: string = '',
) {
  const options = SLASH_COMMANDS.map((name: string) => `/${name}`)
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
  rl: ReturnType<typeof createInterface>,
  options: { label: string; value: string }[],
): Promise<string | null> {
  if (options.length <= 0) return null
  const selected = await selectFromList(
    rl,
    'Select model',
    options.map((option) => option.value),
    {
      filterable: true,
      maxVisible: MAX_MODEL_OPTIONS,
    },
  )
  return selected === null ? null : (options[selected]?.value ?? null)
}

async function setSelectedApi(ty: Taskyon, llmState: llmSettings, nextApi: string) {
  await persistConfigPatch({ selectedApi: nextApi })
  const stored = await loadStoredConfig()
  const configuredModel = normalizeStoredModelForProvider(
    nextApi,
    resolveStoredModel(stored, nextApi),
  )
  const currentApi = llmState.llmApis[nextApi]
  if (currentApi) {
    llmState.llmApis[nextApi] = {
      ...currentApi,
      ...(configuredModel ? { selectedModel: configuredModel } : {}),
      ...(!configuredModel && currentApi.selectedModel ? { selectedModel: undefined } : {}),
    }
  }
  await syncProviderRuntimeConfig(ty, llmState, nextApi)
  const key =
    (await ty.getSecret(API_KEY_STORE_NAME, nextApi, false, false)) ??
    resolveKeyForProvider(nextApi)
  await ty.updateChatCompletionApiKey(nextApi, key ?? undefined)
}

async function loginProvider(
  ty: Taskyon,
  llmState: llmSettings,
  selectedApi: string,
  forceLogin: boolean,
) {
  const api = llmState.llmApis[selectedApi]
  if (!api) throw new Error(`Unknown provider: ${selectedApi}`)
  if (!getProviderOauthConfig(api)) {
    throw new Error(`Provider '${selectedApi}' does not define OAuth settings.`)
  }

  const { loginWithProviderOauthCli } = await import('./oauthLogin')
  const { accessToken, accountId } = await loginWithProviderOauthCli({
    providerName: selectedApi,
    api,
    taskyon: ty,
    forceReauth: forceLogin,
  })
  await ty.setSecret(API_KEY_STORE_NAME, selectedApi, accessToken)
  await ty.updateChatCompletionApiKey(selectedApi, accessToken)
  if (selectedApi === 'chatgpt-codex') applyCodexAccountHeader(llmState, accountId)
}

async function hasStoredOauthLogin(ty: Taskyon, providerId: string): Promise<boolean> {
  const oauthSecretName = getProviderOauthCredentialsSecretName(providerId)
  const cachedOauth = await ty.getSecret('taskyon-cli:oauth', oauthSecretName, false, false)
  return Boolean(cachedOauth?.trim())
}

async function getProviderStatusTags(
  ty: Taskyon,
  llmState: llmSettings,
  providerId: string,
): Promise<string[]> {
  const api = llmState.llmApis[providerId]
  const configuredSecret = await ty.getSecret(API_KEY_STORE_NAME, providerId, false, false)
  const envKey = resolveKeyForProvider(providerId)
  const oauthEnabled = api ? !!getProviderOauthConfig(api) : false
  const oauthLoggedIn = oauthEnabled ? await hasStoredOauthLogin(ty, providerId) : false

  return [
    llmState.selectedApi === providerId ? 'selected' : '',
    configuredSecret ? 'saved-key' : '',
    !configuredSecret && envKey ? 'env-key' : '',
    oauthEnabled ? 'oauth' : '',
    oauthLoggedIn ? 'logged-in' : '',
  ].filter(Boolean)
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
      writeLine('\nPrompt interrupted.')
      return null
    }
    throw error
  }
}

async function askTextInput(
  rl: ReturnType<typeof createInterface>,
  message: string,
  options?: { initialValue?: string; secret?: boolean },
): Promise<string | null> {
  const initial = options?.initialValue ? ` (${options.initialValue})` : ''
  const answer = await askQuestion(rl, `${message}${initial}: `)
  if (answer === null) return null
  if (!answer.trim() && options?.initialValue) return options.initialValue
  return answer
}

async function askConfirmation(
  rl: ReturnType<typeof createInterface>,
  message: string,
  initialValue = false,
): Promise<boolean | null> {
  const suffix = initialValue ? '(Y/n)' : '(y/N)'
  const answerRaw = await askQuestion(rl, `${message} ${suffix}: `)
  if (answerRaw === null) return null
  const answer = answerRaw.trim().toLowerCase()
  if (!answer) return initialValue
  return answer === 'y' || answer === 'yes'
}

function getCurrentInputText(rl: ReturnType<typeof createInterface>): string {
  return rl.line.trim()
}

function isRecordableInputHistoryValue(value: string) {
  const trimmed = value.trim()
  return !['', 'exit', 'quit', '/exit', '/quit'].includes(trimmed)
}

function normalizeInputHistory(values: readonly string[] | undefined): string[] {
  const history: string[] = []
  for (const value of values ?? []) {
    const trimmed = value.trim()
    if (!isRecordableInputHistoryValue(trimmed)) continue
    if (history[history.length - 1] === trimmed) continue
    history.push(trimmed)
    if (history.length >= CLI_INPUT_HISTORY_LIMIT) break
  }
  return history
}

function getReadlineHistory(rl: ReturnType<typeof createInterface>): string[] | undefined {
  return (rl as ReadlineWithMutableHistory).history
}

function recordReadlineHistory(rl: ReturnType<typeof createInterface>, input: string) {
  const value = input.trim()
  if (!isRecordableInputHistoryValue(value)) return
  const history = getReadlineHistory(rl)
  if (!history) return
  if (history[0] === value) return
  history.unshift(value)
  const normalized = normalizeInputHistory(history)
  history.splice(0, history.length, ...normalized)
  rl.emit('history', history)
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

function normalizeSessionRecords(
  sessions: readonly TycliSessionRecord[] | undefined,
): TycliSessionRecord[] {
  const normalized: TycliSessionRecord[] = []
  for (const session of sessions ?? []) {
    if (!isNonEmptyString(session.conversationPath) || !isNonEmptyString(session.logPath)) continue
    if (normalized.some((existing) => existing.conversationPath === session.conversationPath)) {
      continue
    }
    normalized.push({
      conversationPath: session.conversationPath,
      logPath: session.logPath,
      startedAt: session.startedAt || new Date(0).toISOString(),
      ...(session.endedAt ? { endedAt: session.endedAt } : {}),
    })
    if (normalized.length >= CLI_SESSION_HISTORY_LIMIT) break
  }
  return normalized
}

const findSessionForConversation = (
  sessions: readonly TycliSessionRecord[],
  conversationPath: string,
) => sessions.find((session) => session.conversationPath === conversationPath)

async function listConversationFiles(configDir: string): Promise<string[]> {
  const conversationDir = join(configDir, 'conversations')
  try {
    const names = await readdir(conversationDir)
    const files = await Promise.all(
      names
        .filter((name) => name.endsWith('.md'))
        .map(async (name) => {
          const filePath = join(conversationDir, name)
          const fileStat = await stat(filePath)
          return { filePath, mtimeMs: fileStat.mtimeMs }
        }),
    )
    return files.sort((a, b) => b.mtimeMs - a.mtimeMs).map((file) => file.filePath)
  } catch {
    return []
  }
}

async function promptForMainInput(
  rl: ReturnType<typeof createInterface>,
  promptText: string,
  onSlashRequested: () => Promise<string | null>,
  onFileRequested: () => Promise<string | null>,
  onCtrlDRequested?: () => void,
): Promise<string | null> {
  const stdin = process.stdin
  if (!stdin.isTTY) return askQuestion(rl, promptText)
  if (process.env.TYCLI_HOTKEY_MENUS === '0') return askQuestion(rl, promptText)

  emitKeypressEvents(stdin, rl)
  rl.setPrompt(promptText)
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
    const onKeypress = (str: string, key: { ctrl?: boolean; name?: string; sequence?: string }) => {
      if (key.ctrl && key.name === 'd') {
        onCtrlDRequested?.()
        finish(null)
        return
      }
      if (key.ctrl && key.name === 'z') {
        stdin.off('keypress', onKeypress)
        rl.off('line', onLine)
        rl.off('close', onClose)
        restoreTerminalInput()
        suspendProcess()
        settled = true
        resolve('')
        return
      }
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
    const providerOptions = [
      ...providers.map((provider) => `${provider} (${maskKey(all[provider])})`),
      'back',
    ]
    const providerChoice = await selectFromList(rl, 'Keys', providerOptions)
    if (providerChoice === null || providerChoice === providers.length) return

    const provider = providers[providerChoice]!
    const action = await selectFromList(rl, `\n/${provider}`, ['set key', 'remove key', 'back'])
    if (action === null || action === 2) continue

    if (action === 0) {
      const keyInput = await askTextInput(rl, `Enter key for ${provider}`, { secret: true })
      if (keyInput === null) return
      const key = keyInput.trim()
      if (!key) {
        writeNotice('error', 'Key cannot be empty.')
        continue
      }
      await ty.setSecret(API_KEY_STORE_NAME, provider, key)
      await ty.updateChatCompletionApiKey(provider, key)
      llmState.selectedApi = provider
      await setSelectedApi(ty, llmState, provider)
      writeNotice('success', `Saved key for ${provider}.`)
      writeNotice('info', `Selected provider: ${provider}`)
    }

    if (action === 1) {
      await ty.deleteSecret(API_KEY_STORE_NAME, provider)
      await ty.updateChatCompletionApiKey(provider, undefined)
      writeNotice('success', `Removed key for ${provider}.`)
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
  writeNote('Current Model', [
    `Provider: ${selectedApi}`,
    `Model: ${apis[selectedApi]?.selectedModel ?? apis[selectedApi]?.defaultModel ?? 'unknown'}`,
  ])
  const action = await selectFromList(rl, '\nModel menu', [
    'select model for current provider',
    'set model id manually',
    'back',
  ])
  if (action === null || action === 2) return

  if (action === 0) {
    const selectedApi = String(llmState.selectedApi ?? 'local')
    const api = llmState.llmApis[selectedApi]
    if (!api) {
      writeError(`No API definition for '${selectedApi}'.`)
      return
    }
    if (selectedApi === 'chatgpt-codex') {
      const options = codexModelOptions()
      rl.pause()
      let model: string | null = null
      try {
        model = await selectModelInteractive(rl, options)
      } finally {
        rl.resume()
      }
      if (!model) {
        writeNotice('warn', 'Model selection cancelled.')
        return
      }
      llmState.llmApis[selectedApi] = { ...api, selectedModel: model }
      await persistProviderModel(selectedApi, model)
      writeNotice('success', `Selected model for ${selectedApi}: ${model}`)
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
      writeNotice('info', `Fetching model list for ${selectedApi}...`)
      if (selectedApi === 'taskyon') {
        writeNotice(
          'info',
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
    const onlyVision = (await askConfirmation(rl, 'Only vision models?', false)) === true
    const options = modelOptionsForProvider(selectedApi, modelMap, allowedModels, onlyVision)
    if (options.length <= 0) {
      writeError('No models available after filtering.')
      return
    }

    rl.pause()
    let model: string | null = null
    try {
      model = await selectModelInteractive(rl, options)
    } finally {
      rl.resume()
    }
    if (!model) {
      writeNotice('warn', 'Model selection cancelled.')
      return
    }
    const currentApi = apis[selectedApi]
    if (!currentApi) throw new Error(`Provider config missing: ${selectedApi}`)
    apis[selectedApi] = { ...currentApi, selectedModel: model }
    await persistProviderModel(selectedApi, model)
    writeNotice('success', `Selected model for ${selectedApi}: ${model}`)
    return
  }

  if (action === 1) {
    const modelInput = await askTextInput(rl, 'Enter model id')
    if (modelInput === null) return
    const model = modelInput.trim()
    if (!model) {
      writeNotice('error', 'Model id cannot be empty.')
      return
    }
    const currentApi = apis[selectedApi]
    if (!currentApi) throw new Error(`Provider config missing: ${selectedApi}`)
    apis[selectedApi] = { ...currentApi, selectedModel: model }
    await persistProviderModel(selectedApi, model)
    writeNotice('success', `Selected model for ${selectedApi}: ${model}`)
  }
}

async function handleProviderCommand(
  rl: ReturnType<typeof createInterface>,
  ty: Taskyon,
  llmState: llmSettings,
) {
  const providerIds = [...SUPPORTED_PROVIDERS].filter((providerId) => llmState.llmApis[providerId])
  if (providerIds.length === 0) {
    writeError('No configured providers are available in llm settings.')
    return
  }
  const providerOptions = await Promise.all(
    providerIds.map(async (providerId) => {
      const status = await getProviderStatusTags(ty, llmState, providerId)
      return `${providerId}${status.length > 0 ? ` [${status.join(', ')}]` : ''}`
    }),
  )

  const idx = await selectFromList(rl, '\nSelect provider', providerOptions)
  if (idx === null) return
  const nextApi = providerIds[idx]
  if (!nextApi) return

  const api = llmState.llmApis[nextApi]
  if (!api) {
    writeError(`No API definition for '${nextApi}'.`)
    return
  }

  const configuredKey =
    (await ty.getSecret(API_KEY_STORE_NAME, nextApi, false, false)) ??
    resolveKeyForProvider(nextApi)
  const hasOauth = !!getProviderOauthConfig(api)
  const actionOptions = [
    llmState.selectedApi === nextApi ? 'use provider (already selected)' : 'use provider',
    ...(hasOauth ? [configuredKey ? 're-login with OAuth' : 'login with OAuth'] : []),
    'back',
  ]
  const action = await selectFromList(rl, `\nProvider: ${nextApi}`, actionOptions)
  if (action === null) return
  if (action === 0) {
    llmState.selectedApi = nextApi
    await setSelectedApi(ty, llmState, nextApi)
    writeNotice('success', `Selected provider: ${nextApi}`)
    return
  }
  if (hasOauth && action === 1) {
    try {
      await loginProvider(ty, llmState, nextApi, configuredKey != null)
      writeNotice('success', `OAuth login complete for provider '${nextApi}'.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeNotice('error', `OAuth login failed for provider '${nextApi}': ${message}`)
    }
  }
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
    writeNotice('success', 'Debug logs: ON')
    return
  }
  if (arg === 'off') {
    debugLogsEnabled = false
    writeNotice('success', 'Debug logs: OFF')
    return
  }
  const options = ['toggle', 'on', 'off', 'back']
  const choice = await selectFromList(rl, '\nDebug logging', options)
  if (choice === null || choice === 3) return
  if (choice === 0) debugLogsEnabled = !debugLogsEnabled
  if (choice === 1) debugLogsEnabled = true
  if (choice === 2) debugLogsEnabled = false
  writeNotice('success', `Debug logs: ${debugLogsEnabled ? 'ON' : 'OFF'}`)
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
    writeNotice('success', `Role/type tags: ${uiSettings.showRoleTag ? 'ON' : 'OFF'}`)
    return
  }
  uiSettings.showFullFunctionResults = !uiSettings.showFullFunctionResults
  writeNotice(
    'success',
    `Full function results (session): ${uiSettings.showFullFunctionResults ? 'ON' : 'OFF'}`,
  )
}

async function resolveConversationToResume(
  rl: ReturnType<typeof createInterface>,
  configDir: string,
  arg: string,
) {
  const explicitPath = arg.trim()
  if (explicitPath) return resolve(explicitPath)

  const files = await listConversationFiles(configDir)
  if (files.length <= 0) {
    writeLine('No saved conversations found.')
    return null
  }
  const options = files.slice(0, CLI_SESSION_HISTORY_LIMIT)
  const selected = await selectFromList(rl, '\nSaved conversations', options)
  if (selected === null) return null
  return options[selected] ?? null
}

async function handleResumeCommand(args: {
  rl: ReturnType<typeof createInterface>
  ty: Taskyon
  configDir: string
  currentConversationPath: string
  currentLogPath: string | undefined
  sessions: readonly TycliSessionRecord[]
  commandArgs: string
}) {
  const conversationPath = await resolveConversationToResume(
    args.rl,
    args.configDir,
    args.commandArgs,
  )
  if (!conversationPath) return undefined
  const markdown = await readFile(conversationPath, 'utf8')
  const leafId = await args.ty.addMdTaskChain(markdown)
  const sourceSession = findSessionForConversation(args.sessions, conversationPath)

  writeNote('Conversation Resumed', [
    `Resumed conversation: ${conversationPath}`,
    `Loaded conversation log: ${sourceSession?.logPath ?? 'unknown'}`,
    `Current conversation storage: ${args.currentConversationPath}`,
    `Current tycli log: ${args.currentLogPath ?? 'unavailable'}`,
  ])
  return leafId
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
    `Unknown command '/${parsed.name}'. Supported: /keys, /provider, /model, /tools, /debug, /settings, /resume, /exit, /quit`,
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
  adoptInvocationWorkingDirectory()

  let restoreConsoleLogging: (() => void) | undefined
  const sessionStartedAt = new Date()
  try {
    runtimeLog = await createRuntimeLog()
    restoreConsoleLogging = installRuntimeConsoleLogging(runtimeLog)
  } catch (error) {
    writeError(`Runtime log unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  const startupMeta = await loadStartupMeta()
  const { cryptoSession, stored } = await initPersistentCryptoSession()
  const configDir = await resolveConfigDirectoryPath()
  const previousSessions = normalizeSessionRecords(stored.sessions)
  const previousSession = previousSessions[0]
  const pgliteNodeDir = join(configDir, 'pglite')
  await mkdir(pgliteNodeDir, { recursive: true })
  const selectedApi = resolveProviderSelection(stored)

  if (!SUPPORTED_PROVIDERS.includes(selectedApi as (typeof SUPPORTED_PROVIDERS)[number])) {
    throw new Error(
      `Unsupported provider '${selectedApi}'. Choose one of: ${SUPPORTED_PROVIDERS.join(', ')}`,
    )
  }

  const model =
    process.env.TASKYON_MODEL ??
    normalizeStoredModelForProvider(selectedApi, resolveStoredModel(stored, selectedApi))
  const providerKey = resolveKeyForProvider(selectedApi)
  const config = {
    selectedApi,
    ...(model ? { model } : {}),
    ...(providerKey ? { key: providerKey } : {}),
  } as CliApiConfig
  const explorationContextFiles: Record<string, string> = {}
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
            !['chatCompletion', 'entryNode', 'opfsStorage', 'taskyonFlow'].includes(tool.name),
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
        providerToolCalling: true,
        use_baseprompt: true,
        use_multimodal: true,
        max_error_retries: 3,
        prompt_templates: DEFAULT_PROMPT_TEMPLATES,
      },
    }),
    [cliEntryNodeTool, explorationTool, updateFilesTool, downloadFileTool] as unknown as [],
    cryptoSession,
    {
      createIframeMultiPlexer: () =>
        createUnavailableIframeMux('Iframe message bridging is not available in tycli.'),
      indexTaskVectors: false,
      nodePgLiteDataDir: pgliteNodeDir,
    },
  )
  taskyonRef.current = taskyon
  await syncProviderRuntimeConfig(taskyon, llmState, selectedApi)
  const conversationPersistence = await createConversationPersistence({
    taskyon,
    configDir,
    startedAt: sessionStartedAt,
  })
  const currentSession: TycliSessionRecord = {
    conversationPath: conversationPersistence.filePath,
    logPath: runtimeLog?.filePath ?? 'unavailable',
    startedAt: sessionStartedAt.toISOString(),
  }
  const currentSessionLocations = (): SessionLocationInfo => ({
    conversationPath: conversationPersistence.filePath,
    ...(runtimeLog?.filePath ? { logPath: runtimeLog.filePath } : {}),
  })
  await persistConfigPatch({
    sessions: normalizeSessionRecords([currentSession, ...previousSessions]),
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

  const cliToolRpcExecutor = registerToolRpcExecutor({
    port: clientPort,
    getTool: (name) => (name === cliBashTool.name ? cliBashTool : undefined),
    createContext: (_call, stopSignal) => createExternalToolContext(stopSignal),
  })

  clientPort.send({ type: 'functionDescription', ...cliBashTool } as unknown as TaskyonMessage)

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    history: normalizeInputHistory(stored.inputHistory),
    historySize: 500,
    removeHistoryDuplicates: false,
  })
  rl.on('history', (history) => {
    const normalized = normalizeInputHistory(history)
    history.splice(0, history.length, ...normalized)
    persistConfigPatch({ inputHistory: normalized }).catch((error: unknown) => {
      writeDebug(
        `Failed to persist input history: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  })
  let currentLeafId: string | undefined
  let latestPersistLeafId: string | undefined
  let persistQueue = Promise.resolve()
  let waitingForTask = false
  let interruptedCurrentTask = false
  let interruptNoticePrinted = false
  let requestQuitOnNextPrompt = false
  let eofRequested = false
  let inMenuInteraction = false
  let shuttingDown = false
  let stopMainLoop = false
  let requestedExitCode = 0
  let shutdownForceTimer: ReturnType<typeof setTimeout> | null = null
  let workerCleanupNoticeTimer: ReturnType<typeof setTimeout> | null = null
  let taskInterruptKeysCleanup: (() => void) | undefined
  let activeTaskWaitController: AbortController | undefined
  let thinkingLines: string[] = []
  let thinkingText = ''
  let thinkingPanelHeight = 0
  let thinkingRenderTimer: ReturnType<typeof setTimeout> | null = null
  let renderedThinkingPanelText = ''
  const activeWorkerTasks = new Set<string>()
  const suppressedTaskIds = new Set<string>()
  let hasWorkerProcessing = false
  let taskProcessingStatus: 'idle' | 'processing' | 'finished' = 'idle'
  const taskFeed: TaskNode[] = []
  const taskSnapshotById = new Map<string, string>()
  const footer = await createCliFooter()

  const queueConversationPersist = (leafId: string | undefined = currentLeafId) => {
    if (!leafId) return
    latestPersistLeafId = leafId
    persistQueue = persistQueue
      .then(async () => {
        const leafToPersist = latestPersistLeafId
        if (!leafToPersist) return
        await conversationPersistence.persist(leafToPersist)
      })
      .catch((error: unknown) => {
        writeDebug(
          `Failed to persist conversation: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  }

  const flushConversationPersist = async () => {
    queueConversationPersist(currentLeafId)
    await persistQueue
  }

  const currentProviderModel = () => {
    const provider = String(llmState.selectedApi ?? 'local')
    const api = (
      llmState.llmApis as Record<string, { selectedModel?: string; defaultModel?: string }>
    )[provider]
    return {
      provider,
      model: api?.selectedModel ?? api?.defaultModel ?? 'unknown',
    }
  }

  const activeTaskCount = () =>
    activeWorkerTasks.size > 0 ? activeWorkerTasks.size : hasWorkerProcessing ? 1 : 0

  const hasActiveWorkerTask = () =>
    hasInterruptibleWorkerActivity({
      waitingForTask,
      activeWorkerTaskCount: activeWorkerTasks.size,
      hasWorkerProcessing,
    })

  const updateFooter = () => {
    const providerModel = currentProviderModel()
    footer.setStatus({
      provider: providerModel.provider,
      model: providerModel.model,
      taskState: taskProcessingStatus,
      activeTasks: activeTaskCount(),
      ...(runtimeLog?.filePath ? { logPath: runtimeLog.filePath } : {}),
      conversationPath: conversationPersistence.filePath,
    })
  }

  const writePromptPrefix = () => {
    const providerModel = currentProviderModel()
    writeLine(
      formatPromptPrefixLine({
        provider: providerModel.provider,
        model: providerModel.model,
        taskState: taskProcessingStatus,
        activeTasks: activeTaskCount(),
      }),
    )
  }

  const clearThinkingRenderTimer = () => {
    if (thinkingRenderTimer === null) return
    clearTimeout(thinkingRenderTimer)
    thinkingRenderTimer = null
  }

  const eraseThinkingPanel = () => {
    if (thinkingPanelHeight <= 0) return
    for (let i = 0; i < thinkingPanelHeight; i += 1) {
      process.stdout.write('\x1b[1A\x1b[2K')
    }
    thinkingPanelHeight = 0
  }

  const clearThinkingPanel = () => {
    clearThinkingRenderTimer()
    eraseThinkingPanel()
    renderedThinkingPanelText = ''
  }

  const mainPrompt = () =>
    process.stdout.isTTY &&
    (process.env.TYCLI_TERMINAL_UI ?? '').trim().toLowerCase() === 'terminal-kit'
      ? '\x1b[36m>\x1b[0m '
      : '> '

  const restorePromptIfIdle = () => {
    if (waitingForTask || inMenuInteraction || requestQuitOnNextPrompt || shuttingDown) return
    if (!process.stdin.isTTY || process.env.TYCLI_HOTKEY_MENUS === '0') return
    if (isReadlineClosed(rl)) return
    updateFooter()
    footer.beforePrompt()
  }

  const resetThinking = () => {
    clearThinkingPanel()
    thinkingLines = []
    thinkingText = ''
    activeWorkerTasks.clear()
    hasWorkerProcessing = false
  }

  const suppressInterruptedWorkerTasks = () => {
    for (const taskId of activeWorkerTasks) {
      suppressedTaskIds.add(taskId)
    }
  }

  const isSuppressedTask = (task: TaskNode) => {
    if (suppressedTaskIds.has(task.id)) return true
    if (task.parentID && suppressedTaskIds.has(task.parentID)) {
      suppressedTaskIds.add(task.id)
      return true
    }
    if (task.priorID && suppressedTaskIds.has(task.priorID)) {
      suppressedTaskIds.add(task.id)
      return true
    }
    return false
  }

  const isSuppressedWorkerEvent = (event: WorkerEvent) => {
    const taskId = event.task?.id ?? event.taskId ?? null
    if (taskId === null) return false
    if (suppressedTaskIds.has(taskId)) return true
    return false
  }

  const wrapThinkingText = (text: string, maxWidth = 88) => {
    const paragraphs = text
      .replace(/\r\n?/g, '\n')
      .trim()
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0)
    const lines: string[] = []

    for (const paragraph of paragraphs) {
      let current = ''
      for (const word of paragraph.split(' ')) {
        if (!word) continue
        const next = current ? `${current} ${word}` : word
        if (next.length <= maxWidth) {
          current = next
          continue
        }
        if (current) lines.push(current)
        current = word
      }
      if (current) lines.push(current)
    }

    return lines
  }

  const renderThinkingPanel = () => {
    if (!waitingForTask) return
    const recent = thinkingLines.slice(-5)
    const panel = recent.length > 0 ? ['[thinking]', ...recent.map((line) => `  ${line}`)] : []
    const panelText = panel.join('\n')
    if (panelText === renderedThinkingPanelText) return

    clearThinkingRenderTimer()
    eraseThinkingPanel()
    if (panel.length <= 0) {
      renderedThinkingPanelText = ''
      return
    }

    process.stdout.write(`${panel.join('\n')}\n`)
    thinkingPanelHeight = panel.length
    renderedThinkingPanelText = panelText
  }

  const scheduleThinkingRender = () => {
    if (!waitingForTask) return
    if (thinkingPanelHeight <= 0 && renderedThinkingPanelText.length === 0) {
      renderThinkingPanel()
      return
    }
    if (thinkingRenderTimer !== null) return
    thinkingRenderTimer = setTimeout(() => {
      thinkingRenderTimer = null
      renderThinkingPanel()
    }, 300)
    thinkingRenderTimer.unref()
  }

  const clearWorkerCleanupNoticeTimer = () => {
    if (workerCleanupNoticeTimer === null) return
    clearTimeout(workerCleanupNoticeTimer)
    workerCleanupNoticeTimer = null
  }

  const scheduleWorkerCleanupNotice = () => {
    clearWorkerCleanupNoticeTimer()
    workerCleanupNoticeTimer = setTimeout(() => {
      writeLine('Worker cleanup still pending...')
      writeSessionLocations('Session Locations', currentSessionLocations())
    }, 1500)
    workerCleanupNoticeTimer.unref()
  }

  const noteInterruptPhase = (message: string) => {
    writeLine(message)
  }

  const writeTaskInterruptedNotice = () => {
    if (interruptNoticePrinted) return
    interruptNoticePrinted = true
    writeLine('Task interrupted.')
    writeSessionLocations('Session Locations', currentSessionLocations())
  }

  const trackWorkerProgress = (event: WorkerEvent) => {
    const taskId = event.task?.id ?? event.taskId ?? null
    const stage = event.stage ?? ''
    if (stage === 'queued' || stage === 'processing') {
      if (taskId) activeWorkerTasks.add(taskId)
      if (stage === 'processing') hasWorkerProcessing = true
    }
    if (stage === 'processing' || stage === 'in loop' || stage === 'subtasks') {
      taskProcessingStatus = 'processing'
    }
    if (stage === 'all finished') {
      activeWorkerTasks.clear()
      hasWorkerProcessing = false
      taskProcessingStatus = 'finished'
      clearWorkerCleanupNoticeTimer()
    }
    if (stage === 'processed' || stage === 'aborted' || stage === 'error') {
      if (taskId) activeWorkerTasks.delete(taskId)
      if (stage !== 'processed') hasWorkerProcessing = false
      if (activeWorkerTasks.size === 0 && stage === 'processed') hasWorkerProcessing = false
      if (activeWorkerTasks.size === 0 && !hasWorkerProcessing) taskProcessingStatus = 'finished'
      if (stage !== 'processed') clearWorkerCleanupNoticeTimer()
    }
    updateFooter()
  }

  const appendThinkingText = (delta: string) => {
    if (!delta) return
    thinkingText = `${thinkingText}${delta}`.slice(-2000)
    const next = wrapThinkingText(thinkingText)
    if (next.length <= 0) return
    thinkingLines = next.slice(-5)
    scheduleThinkingRender()
  }

  const requestImmediateShutdown = (reason: string, exitCode = 0) => {
    if (shuttingDown) return
    shuttingDown = true
    stopMainLoop = true
    requestedExitCode = exitCode
    interruptedCurrentTask = true
    requestQuitOnNextPrompt = false
    clearThinkingPanel()
    footer.restore()
    writeSessionLocations('Session Locations', currentSessionLocations())
    restoreTerminalInput()
    try {
      taskyon.workerStop(reason)
    } catch {
      // best effort
    }
    if (shutdownForceTimer === null) {
      shutdownForceTimer = setTimeout(() => {
        process.exit(exitCode === 0 ? 1 : exitCode)
      }, 2000)
    }
    if (!isReadlineClosed(rl)) rl.close()
  }

  const interruptCurrentTask = (source: 'Ctrl-C' | 'Ctrl-D') => {
    interruptedCurrentTask = true
    noteInterruptPhase(`${source} received.`)
    noteInterruptPhase('Stopping current worker task...')
    suppressInterruptedWorkerTasks()
    try {
      taskyon.workerStop(`Interrupted by ${source}`)
      noteInterruptPhase('Worker stop requested. Waiting for task cleanup...')
    } catch (error) {
      writeError(
        `Worker stop request failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    activeTaskWaitController?.abort(`${source} received`)
    queueConversationPersist(currentLeafId)
    scheduleWorkerCleanupNotice()
    resetThinking()
    updateFooter()
    writeTaskInterruptedNotice()
  }

  const onSigint = () => {
    if (shuttingDown) {
      noteInterruptPhase('Ctrl-C received during shutdown.')
      writeSessionLocations('Session Locations', currentSessionLocations())
      if (shutdownForceTimer !== null) {
        writeLine('\nForce exiting...')
        process.exit(requestedExitCode === 0 ? 1 : requestedExitCode)
      }
      return
    }
    if (hasActiveWorkerTask()) {
      interruptCurrentTask('Ctrl-C')
      return
    }
    noteInterruptPhase('Ctrl-C received.')
    if (requestQuitOnNextPrompt) {
      requestQuitOnNextPrompt = false
      writeLine('Quit cancelled.')
      return
    }
    const line = getCurrentInputText(rl)
    if (line.length > 0 || inMenuInteraction) {
      restoreTerminalInput()
      writeLine('Input cancelled.')
      return
    }
    requestQuitOnNextPrompt = true
    writeLine('\nQuit tycli? (y/N)')
    writeSessionLocations('Session Locations', currentSessionLocations())
  }
  const onCtrld = () => {
    if (shuttingDown) {
      noteInterruptPhase('Ctrl-D received during shutdown.')
      writeSessionLocations('Session Locations', currentSessionLocations())
      return
    }
    if (hasActiveWorkerTask()) {
      interruptCurrentTask('Ctrl-D')
      return
    }
    eofRequested = true
    noteInterruptPhase('Ctrl-D received.')
  }
  const startTaskInterruptKeys = () => {
    const stdin = process.stdin
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return undefined
    emitKeypressEvents(stdin, rl)
    let cleanedUp = false
    const onKeypress = (_str: string, key: { ctrl?: boolean; name?: string }) => {
      if (key.ctrl && key.name === 'c') {
        onSigint()
        return
      }
      if (key.ctrl && key.name === 'd') {
        onCtrld()
      }
    }
    try {
      stdin.setRawMode(true)
      stdin.resume()
      stdin.on('keypress', onKeypress)
    } catch {
      return undefined
    }
    return () => {
      if (cleanedUp) return
      cleanedUp = true
      stdin.off('keypress', onKeypress)
      restoreTerminalInput()
      rl.resume()
    }
  }
  const onSigterm = () => requestImmediateShutdown('Received SIGTERM', 143)
  const onSighup = () => requestImmediateShutdown('Received SIGHUP', 129)
  const onSigcont = () => {
    updateFooter()
    restorePromptIfIdle()
  }
  const onResize = () => updateFooter()
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  process.on('SIGHUP', onSighup)
  process.on('SIGCONT', onSigcont)
  process.stdout.on('resize', onResize)
  const unsubscribeThinkingStream = taskyon.chatCompletionStream(
    ({ chunk }: { chunk: unknown }) => {
      if (!waitingForTask) return
      appendThinkingText(normalizeThinkingChunk(chunk))
    },
  )
  const unsubscribeTaskProgress = clientPort.receive((msg: TaskyonMessage) => {
    if (!isTaskCreatedMessage(msg)) return
    const task = msg.task
    const suppressed = isSuppressedTask(task)
    const snapshot = JSON.stringify(task.content)
    const prev = taskSnapshotById.get(task.id)
    if (prev === snapshot) return
    taskSnapshotById.set(task.id, snapshot)
    const existingIdx = taskFeed.findIndex((t) => t.id === task.id)
    if (existingIdx >= 0) taskFeed[existingIdx] = task
    else taskFeed.push(task)
    currentLeafId = task.id
    queueConversationPersist(task.id)
    if (suppressed) return
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
    const taskId = workerEvent.task?.id ?? workerEvent.taskId ?? null
    const suppressed = isSuppressedWorkerEvent(workerEvent)
    if (taskId) {
      currentLeafId = taskId
      queueConversationPersist(taskId)
    }
    trackWorkerProgress(workerEvent)
    if (suppressed) return
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

  writeIntro(`tycli ${startupMeta.version}`)
  writeStartupNote(
    'Session',
    [
      `Build: ${startupMeta.commit}, ${startupMeta.buildDate}`,
      runtimeLog ? `tycli log: ${runtimeLog.filePath} (max 100 MB)` : null,
      `Conversation storage: ${conversationPersistence.filePath}`,
    ].filter(isNonEmptyString),
  )
  if (previousSession) {
    writeStartupNote('Previous Session', [
      `Previous conversation: ${previousSession.conversationPath}`,
      `Previous tycli log: ${previousSession.logPath}`,
    ])
  }
  const activeApi = (
    llmState.llmApis as Record<string, { selectedModel?: string; defaultModel?: string }>
  )[String(llmState.selectedApi ?? 'local')]
  writeNotice(
    'info',
    `tycli ready. provider=${String(llmState.selectedApi ?? 'local')} model=${activeApi?.selectedModel ?? activeApi?.defaultModel ?? 'unknown'}`,
  )
  writeNotice(
    'info',
    'Slash commands: /keys, /provider, /model, /tools, /debug, /settings, /resume, /exit, /quit',
  )
  if (debugLogsEnabled) writeNotice('warn', 'Debug logs enabled (TYCLI_DEBUG=1).')
  updateFooter()

  try {
    while (true) {
      if (stopMainLoop) break
      let input = ''
      inMenuInteraction = false
      if (requestQuitOnNextPrompt) {
        updateFooter()
        footer.beforePrompt()
        writePromptPrefix()
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
      updateFooter()
      footer.beforePrompt()
      writePromptPrefix()
      const inputRaw = await promptForMainInput(
        rl,
        mainPrompt(),
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
        onCtrld,
      )
      if (inputRaw === null) {
        if (eofRequested || isReadlineClosed(rl)) {
          if (!eofRequested) noteInterruptPhase('Ctrl-D/EOF received.')
          eofRequested = false
          requestImmediateShutdown('EOF/Readline closed', 0)
          break
        }
        continue
      }
      input = inputRaw.trim()
      if (!input) continue
      recordReadlineHistory(rl, input)
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
        if (parsed.name === 'resume') {
          inMenuInteraction = true
          try {
            const resumedLeafId = await handleResumeCommand({
              rl,
              ty: taskyon,
              configDir,
              currentConversationPath: conversationPersistence.filePath,
              currentLogPath: runtimeLog?.filePath,
              sessions: normalizeSessionRecords((await loadStoredConfig()).sessions),
              commandArgs: parsed.args,
            })
            if (resumedLeafId) {
              currentLeafId = resumedLeafId
              await flushConversationPersist()
            }
          } catch (error) {
            writeError(error instanceof Error ? error.message : String(error))
          } finally {
            inMenuInteraction = false
          }
          continue
        }
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
      queueConversationPersist(currentLeafId)

      clientPort.send({ type: 'tasks', tasks: taskChain, execute: true, show: true })
      writeDebug(`queued task chain: ${taskChain.map((task) => task.id).join(', ')}`)
      try {
        waitingForTask = true
        interruptedCurrentTask = false
        interruptNoticePrinted = false
        resetThinking()
        taskProcessingStatus = 'processing'
        hasWorkerProcessing = true
        updateFooter()
        renderThinkingPanel()
        taskInterruptKeysCleanup = startTaskInterruptKeys()
        activeTaskWaitController = new AbortController()
        const result = await waitForTaskResult(
          clientPort,
          taskChain.map((task) => task.id),
          ['message', 'error', 'return'],
          10 * 60 * 1000,
          activeTaskWaitController.signal,
        )
        waitingForTask = false
        activeTaskWaitController = undefined
        taskInterruptKeysCleanup?.()
        taskInterruptKeysCleanup = undefined
        clearWorkerCleanupNoticeTimer()
        clearThinkingPanel()
        if (interruptedCurrentTask) {
          await flushConversationPersist()
          writeTaskInterruptedNotice()
          restorePromptIfIdle()
          continue
        }
        currentLeafId = result.id
        await flushConversationPersist()
        writeDebug(`received result task: ${result.id} (${result.content.type})`)
        restorePromptIfIdle()
      } catch (error) {
        waitingForTask = false
        activeTaskWaitController = undefined
        taskInterruptKeysCleanup?.()
        taskInterruptKeysCleanup = undefined
        clearWorkerCleanupNoticeTimer()
        clearThinkingPanel()
        if (interruptedCurrentTask) {
          await flushConversationPersist()
          writeTaskInterruptedNotice()
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
    process.off('SIGCONT', onSigcont)
    process.stdout.off('resize', onResize)
    footer.restore()
    restoreTerminalInput()
    unsubscribeThinkingStream()
    unsubscribeTaskProgress()
    unsubscribeWorkerProgress()
    if (!isReadlineClosed(rl)) rl.close()
    cliToolRpcExecutor.destroy()
    unsubscribeBridgeToTaskyon()
    unsubscribeTaskyonToBridge()
    activeTaskWaitController = undefined
    taskInterruptKeysCleanup?.()
    taskInterruptKeysCleanup = undefined
    clearWorkerCleanupNoticeTimer()
    await flushConversationPersist().catch(() => {})
    taskyon.workerStop('tycli exit')
    writeOutro(`Conversation saved: ${conversationPersistence.filePath}`)
    writeOutro(`tycli log: ${runtimeLog?.filePath ?? 'unavailable'}`)
    await persistConfigPatch({
      sessions: normalizeSessionRecords([
        { ...currentSession, endedAt: new Date().toISOString() },
        ...normalizeSessionRecords((await loadStoredConfig()).sessions).filter(
          (session) => session.conversationPath !== currentSession.conversationPath,
        ),
      ]),
    }).catch(() => {})
    restoreConsoleLogging?.()
    await runtimeLog?.flush().catch(() => {})
    if (shutdownForceTimer !== null) {
      clearTimeout(shutdownForceTimer)
      shutdownForceTimer = null
    }
    process.exitCode = requestedExitCode
    process.exit(requestedExitCode)
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
