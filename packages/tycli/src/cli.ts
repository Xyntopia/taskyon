import './node-shims'

import { createInterface } from 'node:readline/promises'
import { emitKeypressEvents } from 'node:readline'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspect } from 'node:util'
import type { createDuplexChannel } from '@taskyon/common/modules/frpBus'
import { createUnavailableIframeMux } from '@taskyon/common/modules/frpBusWeb'
import { serializeObject } from '@taskyon/common/modules/serializeObject'
import { taskyonDocumentationManifest } from '@taskyon/taskyon/documentationManifest'
import {
  connectTaskManagerStorageFromProtocol,
  createArtifactStore,
  configureStaticEmbeddingAssetReader,
  createClientTool,
  createExternalToolContext,
  findContinuationLeafTaskIds,
  firstWordsTaskName,
  processMarkdown,
  textRankTaskName,
  createTaskNode,
  createStandardEntryNodeTool,
  getTaskQueueLabel,
  getProviderOauthConfig,
  getProviderOauthCredentialsSecretName,
  registerToolRpcTools,
  selectChildTaskChains,
  selectTaskQueueBranches,
  toolCall,
  tyCore,
  type ClientTool,
  type InternalTool,
  type partialTaskDraft,
  TaskNode,
  type Taskyon,
  type TaskyonMessage,
  type TyTaskStreamData,
} from '@taskyon/taskyon'
import {
  CLARIFICATION_TOOL_NAME,
  CLARIFICATION_RESULT_INSTRUCTION,
  ClarificationRequest,
  clarificationToolDescription,
  clarificationToolLongDescription,
  clarificationToolParameters,
  type ClarificationResult,
} from '@taskyon/taskyon/tools/clarificationTool'
import {
  createSearchClient,
  createSearchProtocolServer,
  createLoggingClient,
  createLoggingProtocolServer,
  createProtocolPort,
  createProtocolStorageBlobBackend,
  createStorageClient,
  createTaskChainFromMarkdown,
  createTaskyonClient,
  taskyonProtocol,
  taskyonStorageProtocol,
  taskyonSearchProtocol,
  taskyonLoggingProtocol,
  createPgLiteSearchIndexBackend,
} from '@taskyon/taskyon/api'
import { getInMemoryDatabase } from '@taskyon/taskyon/db'
import {
  createDefaultTaskyonToolSetup,
  resolveAgentToolCatalog,
  resolveInitialAgentToolCatalog,
  searchAgentToolCatalog,
} from '@taskyon/taskyon/tools'
import { setChatCompletionTraceWriter } from '@taskyon/taskyon/tools/chatCompletionTrace'
import { createNodeResourceFilesLoader } from '@taskyon/taskyon/tools/nodeTaskyonDocumentationProvider'
import {
  createDocumentationIndexClientTool,
  createProtocolDocumentationBaseStore,
} from '@taskyon/taskyon/tools/documentationProviderTool'
import { taskyonDocumentationTool } from '@taskyon/taskyon/tools/documentationTool'
import { mapSearchTool } from '@taskyon/ui/gis/mapSearchTool'
import { overpassMapTool } from '@taskyon/ui/gis/overpassMapTool'
import { InternalTool as InternalToolSchema } from '../../taskyon/src/types/toolApi'
import {
  flushConfigWrites,
  initPersistentCryptoSession,
  loadStoredConfig,
  persistProviderModel,
  persistConfigPatch,
  resolveKeyForProvider,
  resolveProviderSelection,
  resolveStoredModel,
  resolveConfigDirectoryPath,
  resolveDataDirectoryPath,
  createCliSecretStore,
} from './cli/config'
import {
  createConversationPersistence,
  createConversationPersistQueue,
  TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE,
} from './cli/conversationPersistence'
import { createCliSelectedStorageService, resolveCliStorageSelection } from './cli/storageService'
import { createStaticEmbeddingAssetReader } from './cli/staticEmbeddingCache'
import { loadTaskSearchSidecars, saveTaskSearchSidecars } from './cli/searchIndexPersistence'
import { createCliFooter } from './cli/ui'
import {
  applyCodexAccountHeader,
  canReachLocalApi,
  createCliLlmState,
  fetchProviderModels,
  getAllowedTaskyonModels,
  getProviderSettings,
  getSelectedProviderSettings,
  getSelectedToolchainConfig,
  modelOptionsForProvider,
  setProviderModel,
  setSelectedProvider,
  type CliLlmState,
} from './cli/models'
import { hasInterruptibleWorkerActivity } from './cli/interruptState'
import { applyCliRuntimeConfig, syncProviderRuntimeConfig } from './cli/runtime'
import { runBashCommand } from './cli/bash'
import {
  countDelegatedSubtaskToolCalls,
  renderHtmlPreviewText,
  renderTaskProgress,
  renderWorkerProgress,
  resolveWorkerStatusText,
  type WorkerEvent,
} from './cli/taskRenderer'
import {
  API_KEY_STORE_NAME,
  type CliApiConfig,
  type LlmModel,
  MAX_MODEL_OPTIONS,
  SLASH_COMMANDS,
  SUPPORTED_PROVIDERS,
  type TycliSessionRecord,
} from './cli/types'
import { createExplorationTool } from './tools/explorationTool'
import { updateFilesTool } from './tools/patchTool'
import { downloadFileTool } from './tools/downloadFileTool'
import { githubIssuesTool } from './tools/githubIssuesTool'
import { gitlabTool } from './tools/gitlabTool'
import { dagGraphProjectTool } from './tools/dagGraphProjectTool'

type BashToolArgs = {
  command?: string
  cwd?: string
  timeoutMs?: number
}

type SlashParsed = {
  name: string
  args: string
}

type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject
type JsonObject = { [key: string]: JsonValue | undefined }

type TaskyonClientInvoker = ReturnType<typeof createTaskyonClient>

type TaskyonClientCommandRuntime = {
  client: TaskyonClientInvoker
  taskPort?: Parameters<typeof waitForTaskResult>[0]
}

type ParsedClientInvocation =
  | {
      kind: 'listTools'
      includeHidden: boolean
    }
  | {
      kind: 'callTool'
      toolName: string
      arguments: JsonObject
    }
  | {
      kind: 'method'
      methodName: string
      arguments: unknown
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
let clearTransientStatusLine: (() => void) | undefined
let activeCliMenuDepth = 0

function absolutizeRelativeExecArgvImports(cwd: string) {
  process.execArgv = process.execArgv.flatMap((arg, index, args) => {
    if (arg === '--import') {
      const specifier = args[index + 1]
      if (!specifier || specifier.startsWith('-')) return [arg]
      return [arg, absolutizeImportSpecifier(cwd, specifier)]
    }
    if (index > 0 && args[index - 1] === '--import') return []
    const importPrefix = '--import='
    if (arg.startsWith(importPrefix)) {
      return [`${importPrefix}${absolutizeImportSpecifier(cwd, arg.slice(importPrefix.length))}`]
    }
    return [arg]
  })
}

const splitNodeOptions = (value: string) => value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? []

const unquoteNodeOption = (value: string) => {
  if (value.length < 2) return value
  const first = value[0]
  const last = value[value.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1)
  }
  return value
}

function absolutizeRelativeNodeOptionsImports(cwd: string) {
  const nodeOptions = process.env.NODE_OPTIONS
  if (!nodeOptions) return
  const tokens = splitNodeOptions(nodeOptions)
  const next: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = unquoteNodeOption(tokens[index] ?? '')
    if (token === '--import') {
      const specifier = tokens[index + 1]
      if (!specifier || unquoteNodeOption(specifier).startsWith('-')) {
        next.push(token)
        continue
      }
      next.push(token, absolutizeImportSpecifier(cwd, unquoteNodeOption(specifier)))
      index += 1
      continue
    }
    const importPrefix = '--import='
    if (token.startsWith(importPrefix)) {
      next.push(
        `${importPrefix}${absolutizeImportSpecifier(cwd, token.slice(importPrefix.length))}`,
      )
      continue
    }
    next.push(tokens[index] ?? '')
  }
  process.env.NODE_OPTIONS = next.join(' ')
}

function absolutizeImportSpecifier(cwd: string, specifier: string) {
  if (!specifier.startsWith('.')) return specifier
  return pathToFileURL(resolve(cwd, specifier)).href
}

function adoptInvocationWorkingDirectory() {
  const originalCwd = process.cwd()
  process.env.TYCLI_EXEC_ARGV_CWD = originalCwd
  absolutizeRelativeExecArgvImports(originalCwd)
  absolutizeRelativeNodeOptionsImports(originalCwd)
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

const CHAT_COMPLETION_TRACE_DIR_ENV = 'TYCLI_CHAT_COMPLETION_TRACE_DIR'
const CHAT_COMPLETION_TRACE_LABEL_ENV = 'TYCLI_CHAT_COMPLETION_TRACE_LABEL'

const sanitizeTraceFilePart = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'trace'

const createJsonReplacer = () => {
  const seen = new WeakSet<object>()
  return (_key: string, value: unknown) => {
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
    if (typeof value === 'bigint') return value.toString()
    if (value && typeof value === 'object') {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  }
}

const stringifyTraceJson = (value: unknown) => JSON.stringify(value, createJsonReplacer(), 2)

function createCliChatCompletionTraceWriter(traceDir: string) {
  let sequence = 0
  const fileNameFor = (sequenceId: number, record: { taskId: string; label?: string }) => {
    const parts = [
      String(sequenceId).padStart(4, '0'),
      ...(record.label ? [sanitizeTraceFilePart(record.label)] : []),
      sanitizeTraceFilePart(record.taskId),
      'record',
    ]
    return `${parts.join('_')}.json`
  }

  return {
    write: async (record: { taskId: string; label?: string; providerRequest: unknown }) => {
      await mkdir(traceDir, { recursive: true })
      const sequenceId = ++sequence
      await writeFile(
        join(traceDir, fileNameFor(sequenceId, record)),
        stringifyTraceJson({
          sequence: sequenceId,
          taskId: record.taskId,
          ...(record.label ? { label: record.label } : {}),
          providerRequest: record.providerRequest,
        }),
        'utf8',
      )
    },
  }
}

const resolveCliChatCompletionTrace = () => {
  const traceDir = process.env[CHAT_COMPLETION_TRACE_DIR_ENV]?.trim()
  if (!traceDir) return undefined
  return {
    dir: traceDir,
    label: process.env[CHAT_COMPLETION_TRACE_LABEL_ENV]?.trim() || undefined,
  }
}

function formatPromptTaskState(status: PromptPrefixStatus): string {
  if (status.activeTasks <= 0) return status.taskState
  return `${status.taskState}:${status.activeTasks}`
}

function formatPromptPrefixLine(status: PromptPrefixStatus): string {
  return `[${status.provider} | ${status.model} | ${formatPromptTaskState(status)}]`
}

function writeLine(text: string) {
  clearTransientStatusLine?.()
  runtimeLog?.append('stdout', `${text}\n`)
  process.stdout.write(`${text}\n`)
}

function writeError(text: string) {
  clearTransientStatusLine?.()
  runtimeLog?.append('stderr', `${text}\n`)
  process.stderr.write(`${text}\n`)
}

function writeNotice(kind: 'info' | 'success' | 'warn' | 'error', text: string) {
  clearTransientStatusLine?.()
  runtimeLog?.append(kind === 'error' ? 'stderr' : 'stdout', `${text}\n`)
  const prefix = kind === 'error' ? 'error: ' : kind === 'warn' ? 'warning: ' : ''
  const stream = kind === 'error' ? process.stderr : process.stdout
  stream.write(`${prefix}${text}\n`)
}

function writeStartupNote(title: string, lines: string[]) {
  clearTransientStatusLine?.()
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
  clearTransientStatusLine?.()
  runtimeLog?.append('stdout', `${title}\n`)
  process.stdout.write(`${title}\n`)
}

function writeOutro(message: string) {
  clearTransientStatusLine?.()
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

function routeRuntimeLogThroughProtocol(
  directLog: RuntimeLog,
  client: ReturnType<typeof createLoggingClient>,
  streamId: string,
): RuntimeLog {
  let queue = Promise.resolve()
  return {
    filePath: directLog.filePath,
    append: (source, text) => {
      queue = queue
        .then(async () => {
          await client.write({
            timestamp: new Date().toISOString(),
            level: source.includes('error') || source === 'stderr' ? 'error' : 'info',
            source,
            message: text,
            streamId,
          })
        })
        .catch(() => {
          // Runtime logging must never crash the CLI.
        })
    },
    flush: async () => {
      await queue
      await client.flush({})
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

async function withCliMenuInteraction<T>(run: () => Promise<T>): Promise<T> {
  activeCliMenuDepth += 1
  clearTransientStatusLine?.()
  try {
    return await run()
  } finally {
    activeCliMenuDepth = Math.max(0, activeCliMenuDepth - 1)
  }
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

type ReadlineWithMutableInput = ReturnType<typeof createInterface> & {
  cursor: number
  line: string
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

function splitFirstToken(input: string): { token: string; rest: string } {
  const trimmed = input.trim()
  if (!trimmed) return { token: '', rest: '' }
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed)
  return {
    token: match?.[1] ?? '',
    rest: match?.[2]?.trimStart() ?? '',
  }
}

function parseJsonArgument(raw: string, fallback: JsonValue): JsonValue {
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  try {
    return JSON.parse(trimmed) as JsonValue
  } catch (error) {
    throw new Error(
      `Expected JSON arguments, got: ${trimmed}\n${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function assertJsonObject(value: unknown, label: string): JsonObject {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject
  }
  throw new Error(`${label} must be a JSON object.`)
}

function normalizeClientMethodName(name: string): string {
  const normalized = name.trim()
  if (normalized === 'list-tools') return 'listTools'
  if (normalized === 'call-tool') return 'callTool'
  return normalized
}

function parseTaskyonClientInvocation(raw: string): ParsedClientInvocation {
  const { token: rawMethodName, rest } = splitFirstToken(raw)
  const methodName = normalizeClientMethodName(rawMethodName)
  if (!methodName) {
    throw new Error(
      'Usage: client list-tools | client call-tool <toolName> [jsonArgs] | client <methodName> [jsonArgs]',
    )
  }

  if (methodName === 'listTools') {
    const args = assertJsonObject(parseJsonArgument(rest, {}), 'listTools arguments')
    return {
      kind: 'listTools',
      includeHidden: typeof args.includeHidden === 'boolean' ? args.includeHidden : true,
    }
  }

  if (methodName === 'callTool') {
    if (rest.trimStart().startsWith('{')) {
      const args = assertJsonObject(parseJsonArgument(rest, {}), 'callTool arguments')
      const name = args.name
      if (typeof name !== 'string' || !name.trim()) {
        throw new Error(
          'Usage: client call-tool <toolName> [jsonArgs] or client callTool {"name":"toolName","arguments":{...}}',
        )
      }
      return {
        kind: 'callTool',
        toolName: name,
        arguments: assertJsonObject(args.arguments ?? {}, 'callTool.arguments'),
      }
    }

    const { token: toolName, rest: toolArgsRaw } = splitFirstToken(rest)
    if (!toolName) {
      throw new Error(
        'Usage: client call-tool <toolName> [jsonArgs] or client callTool {"name":"toolName","arguments":{...}}',
      )
    }

    return {
      kind: 'callTool',
      toolName,
      arguments: assertJsonObject(parseJsonArgument(toolArgsRaw, {}), 'tool arguments'),
    }
  }

  return {
    kind: 'method',
    methodName,
    arguments: parseJsonArgument(rest, {}),
  }
}

function parseTaskyonClientCliArgs(argv: string[]): string | null {
  const [command, ...rest] = argv
  if (command !== 'client' && command !== 'taskyon-client') return null
  return rest.join(' ')
}

function formatJsonResult(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function formatClientCommandResult(value: unknown): string {
  if (typeof value !== 'string') return formatJsonResult(value)

  return renderHtmlPreviewText(
    {
      id: `client-command-result:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`,
      role: 'assistant',
    },
    value,
  )
}

const taskCreatedAt = (task: TaskNode) => task.created_at ?? 0

const isMapToolName = (toolName: string) =>
  toolName === mapSearchTool.name || toolName === overpassMapTool.name

const isHtmlMessageTask = (task: TaskNode) =>
  task.content.type === 'message' &&
  typeof task.content.data === 'string' &&
  task.content.data.includes('<')

type CompactTaskTreeNode = {
  id: string
  role: TaskNode['role']
  type: TaskNode['content']['type']
  tool?: string
  branches?: CompactTaskTreeNode[][]
}

type CompactTaskTree = {
  branch: CompactTaskTreeNode[]
}

function compactTaskNode(
  task: TaskNode,
  taskById: ReadonlyMap<string, TaskNode>,
  visited: ReadonlySet<string>,
): CompactTaskTreeNode {
  const tool = task.content.type === 'functioncall' ? task.content.data.name : undefined
  const nextVisited = new Set([...visited, task.id])
  const branches = findDirectChildren(task.id, taskById)
    .map((child) => buildCompactSiblingChain(child, taskById, nextVisited))
    .filter((branch) => branch.length > 0)

  return {
    id: task.id.slice(0, 12),
    role: task.role,
    type: task.content.type,
    ...(tool ? { tool } : {}),
    ...(branches.length > 0 ? { branches } : {}),
  }
}

function findDirectChildren(taskId: string, taskById: ReadonlyMap<string, TaskNode>) {
  return [...taskById.values()]
    .filter((task) => task.parentID === taskId && !task.priorID)
    .sort((a, b) => taskCreatedAt(a) - taskCreatedAt(b))
}

function findNextSibling(taskId: string, taskById: ReadonlyMap<string, TaskNode>) {
  return [...taskById.values()]
    .filter((task) => task.priorID === taskId)
    .sort((a, b) => taskCreatedAt(b) - taskCreatedAt(a))[0]
}

function findRootTask(task: TaskNode, taskById: ReadonlyMap<string, TaskNode>) {
  let current = task
  const visited = new Set<string>()

  while (!visited.has(current.id)) {
    visited.add(current.id)
    const previousId = current.priorID ?? current.parentID
    const previous = previousId ? taskById.get(previousId) : undefined
    if (!previous) return current
    current = previous
  }

  return current
}

function buildCompactSiblingChain(
  firstTask: TaskNode,
  taskById: ReadonlyMap<string, TaskNode>,
  visited: ReadonlySet<string> = new Set(),
) {
  const branch: CompactTaskTreeNode[] = []
  let current: TaskNode | undefined = firstTask
  const branchVisited = new Set(visited)

  while (current && !branchVisited.has(current.id)) {
    branch.push(compactTaskNode(current, taskById, branchVisited))
    branchVisited.add(current.id)
    current = findNextSibling(current.id, taskById)
  }

  return branch
}

function buildCompactTaskTree(tasks: readonly TaskNode[], leafId: string): CompactTaskTree {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const leafTask = taskById.get(leafId)
  if (!leafTask) throw new Error(`No task '${leafId}' found in the active CLI task feed.`)
  const rootTask = findRootTask(leafTask, taskById)
  return { branch: buildCompactSiblingChain(rootTask, taskById) }
}

async function backfillLinkedTasks(client: TaskyonClientInvoker, leafId: string) {
  const taskById = new Map<string, TaskNode>()
  const pending = [leafId]
  const visited = new Set<string>()

  while (pending.length > 0) {
    const taskId = pending.pop()
    if (!taskId || visited.has(taskId)) continue
    visited.add(taskId)

    const task = await client.task.get({ id: taskId })
    if (!task) continue
    taskById.set(task.id, task)
    if (task.parentID && !taskById.has(task.parentID)) pending.push(task.parentID)
    if (task.priorID && !taskById.has(task.priorID)) pending.push(task.priorID)
  }

  return [...taskById.values()]
}

function buildTaskTreeYaml(tasks: readonly TaskNode[], leafId: string) {
  const tree = buildCompactTaskTree(tasks, leafId)
  return serializeObject(tree, {
    format: 'yaml',
    maxDepth: 1e9,
    maxArrayLength: 1e9,
    maxObjectKeys: 1e9,
    maxStringLength: 1e9,
    includeTruncationMeta: false,
  })
}

function createCliTaskyonClient(port: unknown): TaskyonClientInvoker {
  return createTaskyonClient(port as Parameters<typeof createTaskyonClient>[0], {
    taskCacheSize: 0,
  })
}

async function invokeTaskyonToolTask(
  runtime: TaskyonClientCommandRuntime,
  invocation: { toolName: string; arguments: JsonObject },
): Promise<unknown> {
  if (!runtime.taskPort) {
    return await runtime.client.callTool(invocation.toolName, invocation.arguments)
  }

  const toolDefinitions = await runtime.client.tools.list({ includeHidden: true })
  const isDagNode = toolDefinitions[invocation.toolName]?.source?.kind === 'dag-node'
  const returnsRawToolResult =
    isDagNode || (invocation.toolName === 'toolSearcher' && invocation.arguments.analyze === false)

  const taskChain = await createPreparedTaskChain([
    toolCall({
      name: invocation.toolName,
      arguments: invocation.arguments,
    }),
  ])
  await runtime.client.task.createChain({
    tasks: taskChain,
    execute: true,
    show: true,
  })
  const result = await waitForTaskResult(
    runtime.taskPort,
    taskChain.map((task) => task.id),
    returnsRawToolResult ? ['toolresult', 'return', 'error'] : ['message', 'return', 'error'],
    10 * 60 * 1000,
    undefined,
    undefined,
    undefined,
    isMapToolName(invocation.toolName)
      ? (task) => task.content.type !== 'message' || isHtmlMessageTask(task)
      : undefined,
  )
  if (result.content.type === 'error') {
    throw new Error(`Tool '${invocation.toolName}' failed.`, { cause: result.content.data })
  }
  return result.content.data
}

async function invokeTaskyonClient(
  runtime: TaskyonClientCommandRuntime,
  raw: string,
): Promise<unknown> {
  const invocation = parseTaskyonClientInvocation(raw)
  if (invocation.kind === 'listTools') {
    return await runtime.client.tools.list({ includeHidden: invocation.includeHidden })
  }
  if (invocation.kind === 'callTool') {
    return await invokeTaskyonToolTask(runtime, invocation)
  }

  const method = (runtime.client as unknown as Record<string, unknown>)[invocation.methodName]
  if (typeof method !== 'function') {
    throw new Error(`Unknown taskyonClient method '${invocation.methodName}'.`)
  }
  return await method.call(runtime.client, invocation.arguments)
}

const cliBashTool: ClientTool = createClientTool({
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
  function: async ({ command, cwd, timeoutMs = 120000 }: BashToolArgs, ctx) => {
    if (!command || !command.trim()) throw new Error('bash tool requires a non-empty command')
    return await runBashCommand(
      { command, cwd: cwd ?? process.cwd(), timeoutMs },
      {
        stopSignal: ctx.stopSignal,
        reportProgress: ctx.reportProgress ?? (() => Promise.resolve()),
      },
    )
  },
})

async function askClarificationQuestionInCli(
  rl: ReturnType<typeof createInterface>,
  question: ClarificationRequest['questions'][number],
) {
  const options = [
    ...question.options.map((option) =>
      option.description ? `${option.label} - ${option.description}` : option.label,
    ),
    'Custom answer',
  ]
  writeLine(`\n${question.question}`)
  options.forEach((option, index) => {
    writeLine(`${index + 1}. ${option}`)
  })
  const answerRaw = await askQuestion(rl, 'Select: ')
  if (answerRaw === null) return null
  const selected = Number(answerRaw.trim()) - 1
  if (!Number.isInteger(selected) || selected < 0 || selected >= options.length) {
    return answerRaw.trim() || null
  }
  const customIndex = options.length - 1
  if (selected === customIndex) {
    const custom = await askTextInput(rl, 'Custom answer')
    return custom?.trim() || null
  }
  return question.options[selected]?.label ?? null
}

function createCliClarificationTool(
  getReadline: () => ReturnType<typeof createInterface> | undefined,
): ClientTool {
  return createClientTool({
    name: CLARIFICATION_TOOL_NAME,
    description: clarificationToolDescription,
    longDescription: clarificationToolLongDescription,
    parameters: clarificationToolParameters,
    renderOptions: { hideChat: false, hideLlm: false },
    async function(rawArgs) {
      return await withCliMenuInteraction(async () => {
        const rl = getReadline()
        if (!rl) {
          throw new Error(
            'Clarification questions are only available in interactive tycli sessions.',
          )
        }
        const args = ClarificationRequest.parse(rawArgs)
        if (args.intro?.trim()) writeLine(args.intro.trim())
        const answers: ClarificationResult['answers'] = []

        for (const question of args.questions) {
          const answer = await askClarificationQuestionInCli(rl, question)
          if (answer === null) {
            return {
              cancelled: true,
              answers,
            }
          }
          answers.push({
            id: question.id,
            question: question.question,
            answer,
          })
        }

        return {
          ...(args.intro ? { intro: args.intro } : {}),
          instruction: CLARIFICATION_RESULT_INSTRUCTION,
          answers,
        }
      })
    },
  })
}
const CLI_UNAVAILABLE_TOOL_NAMES = new Set([
  'animatedClock',
  'getGitlabInfo',
  'issueListGenerator',
  'location',
  'newWindowOpener',
  'notification',
  'opfsStorage',
  'proceduralTreeGenerator',
  'tauriHttpWebReader',
  'waitForPostMessage',
  'wfcGenerator',
  'windowManager',
])

const INTERACTIVE_PROMPT_TOOL_NAMES = new Set<string>([CLARIFICATION_TOOL_NAME])

function buildCliStableContext(projectInstructions: string) {
  const shell = process.env.SHELL ?? process.env.ComSpec ?? 'unknown'
  return [
    projectInstructions,
    [
      'You are the Taskyon CLI assistant.',
      'This is a terminal-focused environment. Be concise, actionable, and explicit.',
      '',
      '## Stable Runtime Context',
      `Current Working Directory: ${process.cwd()}`,
      `Shell: ${shell}`,
      'Use dagGraphProject for reproducible design and optimization workflows: create TypeScript DAG nodes, patch roots, run studies over variants, and report the best root/hash-backed result.',
      '',
      '## Stable Tool Usage Rules',
      '1. Prefer answering directly when no tool action is needed.',
      '2. For repository exploration, use the exploration tool first: list/search for files, grep for text, view for focused file chunks, add/context for persistent file context.',
      '3. Use bash only when command execution is required beyond file discovery, text search, or file viewing.',
      '4. Keep destructive or risky shell commands clearly justified and minimal.',
      '5. After a tool result, continue the task: call one next tool when more work is needed, otherwise answer concisely.',
      "6. If verification fails because a local dependency command is missing, inspect the project's package metadata and try the normal install/setup command once before treating it as blocked.",
      '7. For project tasks that create, change, or document a runnable result, leave a project-local README or documentation note with one simple command a human can run from the project root to verify the result.',
      '8. Match verification scope to the change: for documentation-only or task-discovery changes, prefer the smallest command that validates the documented workflow over a full dependency-installing test suite.',
      '9. In Ruby/Rake projects, when `ruby -S rake` is available, use it for focused task-discovery verification before trying `bundle exec` or dependency setup.',
      '10. After editing source files, inspect the resulting diff for accidental formatting noise; when the project exposes a focused formatter or tidy command, run it before final verification.',
    ].join('\n'),
  ]
    .filter(Boolean)
    .join('\n\n')
}

function buildCliVolatileContext(now = new Date()) {
  const localTime = now.toString()
  return `Runtime reference only: now_utc=${now.toISOString()} local_time=${localTime}`
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
  msg: unknown,
): msg is { type: 'taskCreated'; task: TaskNode; parentID?: string } {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    'task' in msg &&
    msg.type === 'taskCreated' &&
    typeof msg.task === 'object' &&
    msg.task !== null
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
  signal?: AbortSignal,
  fallbackCondition?: (task: TaskNode) => boolean,
  isFallbackReady?: () => boolean,
  acceptTask?: (task: TaskNode) => boolean,
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
    let fallbackTask: TaskNode | undefined
    const fallbackInterval =
      fallbackCondition && isFallbackReady
        ? setInterval(() => {
            if (!fallbackTask || !isFallbackReady()) return
            cleanup()
            resolve(fallbackTask)
          }, 50)
        : undefined

    const cleanup = () => {
      clearTimeout(timeout)
      if (fallbackInterval) clearInterval(fallbackInterval)
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
      if (acceptTask && !acceptTask(msg.task)) return
      if (fallbackCondition?.(msg.task)) {
        fallbackTask = msg.task
        if (isFallbackReady?.()) {
          cleanup()
          resolve(msg.task)
        }
        return
      }
      cleanup()
      resolve(msg.task)
    })
    signal?.addEventListener('abort', onAbort, { once: true })
  })
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
    onToggle?: () => void
    toggleHelp?: () => string
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
    const toggleHelp = config?.toggleHelp?.()
    const queryLine = filterable ? `filter: ${query}` : null
    const lines = [title, [help, toggleHelp].filter(Boolean).join(' · '), queryLine, ...rows]
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
      if (key.name === 'tab' && config?.onToggle) {
        config.onToggle()
        render()
        return
      }
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
    onToggle?: () => void
    toggleHelp?: () => string
  },
) {
  return await withCliMenuInteraction(async () => {
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
  })
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

async function setSelectedApi(ty: Taskyon, llmState: CliLlmState, nextApi: string) {
  await persistConfigPatch({ selectedApi: nextApi })
  const stored = await loadStoredConfig()
  const configuredModel = resolveStoredModel(stored, nextApi)
  setSelectedProvider(llmState, nextApi)
  if (configuredModel) setProviderModel(llmState, nextApi, configuredModel)
  await syncProviderRuntimeConfig(ty, llmState, nextApi)
  const key =
    (await ty.getSecret(API_KEY_STORE_NAME, nextApi, false, false)) ??
    resolveKeyForProvider(nextApi)
  await ty.updateChatCompletionApiKey(nextApi, key ?? undefined)
}

async function loginProvider(
  ty: Taskyon,
  llmState: CliLlmState,
  selectedApi: string,
  forceLogin: boolean,
) {
  const api = getProviderSettings(llmState, selectedApi)
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
  await applyCliRuntimeConfig(ty, llmState)
}

async function hasStoredOauthLogin(ty: Taskyon, providerId: string): Promise<boolean> {
  const oauthSecretName = getProviderOauthCredentialsSecretName(providerId)
  const cachedOauth = await ty.getSecret('taskyon-cli:oauth', oauthSecretName, false, false)
  return Boolean(cachedOauth?.trim())
}

async function getProviderStatusTags(
  ty: Taskyon,
  llmState: CliLlmState,
  providerId: string,
): Promise<string[]> {
  const api = getProviderSettings(llmState, providerId)
  const configuredSecret = await ty.getSecret(API_KEY_STORE_NAME, providerId, false, false)
  const envKey = resolveKeyForProvider(providerId)
  const oauthEnabled = api ? !!getProviderOauthConfig(api) : false
  const oauthLoggedIn = oauthEnabled ? await hasStoredOauthLogin(ty, providerId) : false

  return [
    llmState.selectedToolchainProfile === providerId ? 'selected' : '',
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
  options?: { signal?: AbortSignal; interruptNotice?: boolean; onSigint?: () => void },
): Promise<string | null> {
  if (isReadlineClosed(rl)) return null
  const onReadlineSigint = () => options?.onSigint?.()
  if (options?.onSigint) rl.on('SIGINT', onReadlineSigint)
  try {
    if (options?.signal) return await rl.question(prompt, { signal: options.signal })
    return await rl.question(prompt)
  } catch (error) {
    if (isInterruptError(error)) {
      if (options?.interruptNotice !== false) writeLine('\nPrompt interrupted.')
      return null
    }
    throw error
  } finally {
    if (options?.onSigint) rl.off('SIGINT', onReadlineSigint)
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

function insertPromptNewline(rl: ReturnType<typeof createInterface>) {
  const input = rl as ReadlineWithMutableInput
  input.line = `${input.line.slice(0, input.cursor)}\n${input.line.slice(input.cursor)}`
  input.cursor += 1
  rl.prompt(true)
}

const isShiftEnterSequence = (sequence: string | undefined) =>
  sequence === '\x1bOM' || sequence === '\x1b[13;2u' || sequence === '\x1b[13;2~'

const ENABLE_BRACKETED_PASTE = '\x1b[?2004h'
const DISABLE_BRACKETED_PASTE = '\x1b[?2004l'

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
  onCtrlCRequested?: () => void,
  onCtrlDRequested?: () => void,
  onReady?: () => void,
): Promise<string | null> {
  const stdin = process.stdin
  if (!stdin.isTTY) {
    const answer = askQuestion(rl, promptText)
    onReady?.()
    return await answer
  }
  const hotkeyMenusEnabled = process.env.TYCLI_HOTKEY_MENUS !== '0'

  process.stdout.write(ENABLE_BRACKETED_PASTE)
  emitKeypressEvents(stdin, rl)

  return await new Promise<string | null>((resolve) => {
    let settled = false
    let menuOpen = false
    let activePaste:
      | {
          initialLine: string
          initialCursor: number
          text: string
          history: string[] | undefined
        }
      | undefined

    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      stdin.off('keypress', onKeypress)
      rl.off('line', onLine)
      rl.off('close', onClose)
      process.stdout.write(DISABLE_BRACKETED_PASTE)
      restoreTerminalInput()
      resolve(value)
    }

    const onLine = (line: string) => {
      if (menuOpen || activePaste) return
      finish(line)
    }
    const onClose = () => finish(null)
    const onKeypress = (
      str: string | undefined,
      key: { ctrl?: boolean; name?: string; sequence?: string },
    ) => {
      if (key.name === 'paste-start') {
        const input = rl as ReadlineWithMutableInput
        const history = getReadlineHistory(rl)
        activePaste = {
          initialLine: input.line,
          initialCursor: input.cursor,
          text: '',
          history: history ? [...history] : undefined,
        }
        return
      }
      if (activePaste) {
        if (key.name === 'paste-end') {
          const input = rl as ReadlineWithMutableInput
          const pastedText = activePaste.text.replace(/\r\n?/g, '\n')
          input.line = `${activePaste.initialLine.slice(0, activePaste.initialCursor)}${pastedText}${activePaste.initialLine.slice(activePaste.initialCursor)}`
          input.cursor = activePaste.initialCursor + pastedText.length
          const history = getReadlineHistory(rl)
          if (history && activePaste.history) {
            history.splice(0, history.length, ...activePaste.history)
            rl.emit('history', history)
          }
          activePaste = undefined
        } else if (str) {
          activePaste.text += str
        }
        return
      }
      if (key.ctrl && key.name === 'c') {
        onCtrlCRequested?.()
        finish(null)
        return
      }
      if (key.ctrl && key.name === 'd') {
        onCtrlDRequested?.()
        finish(null)
        return
      }
      if (key.ctrl && key.name === 'z') {
        stdin.off('keypress', onKeypress)
        rl.off('line', onLine)
        rl.off('close', onClose)
        process.stdout.write(DISABLE_BRACKETED_PASTE)
        restoreTerminalInput()
        suspendProcess()
        settled = true
        resolve('')
        return
      }
      if (key.ctrl) return
      if (isShiftEnterSequence(key.sequence)) {
        insertPromptNewline(rl)
        return
      }
      const typedSlash = hotkeyMenusEnabled && (str === '/' || key.sequence === '/')
      const typedAt = hotkeyMenusEnabled && (str === '@' || key.sequence === '@')
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
    rl.setPrompt(promptText)
    rl.prompt()
    try {
      stdin.setRawMode(true)
      stdin.resume()
    } catch {
      // Readline still works without raw mode, but hotkeys and history may be terminal-dependent.
    }
    onReady?.()
  })
}

async function handleKeysCommand(
  rl: ReturnType<typeof createInterface>,
  ty: Taskyon,
  llmState: CliLlmState,
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
  llmState: CliLlmState,
) {
  const selectedApi = llmState.selectedToolchainProfile
  const selectedSettings = getSelectedProviderSettings(llmState)
  writeNote('Current Model', [`Provider: ${selectedApi}`, `Model: ${selectedSettings.model}`])
  const action = await selectFromList(rl, '\nModel menu', [
    'select model for current provider',
    'set model id manually',
    'back',
  ])
  if (action === null || action === 2) return

  if (action === 0) {
    const selectedApi = llmState.selectedToolchainProfile
    const api = getProviderSettings(llmState, selectedApi)
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
      writeNotice('info', `Fetching model list for ${selectedApi}...`)
      if (selectedApi === 'taskyon') {
        writeNotice(
          'info',
          'Hint: You can inspect Taskyon model availability and details at https://taskyon.space/pricing',
        )
      }
      modelMap = await fetchProviderModels(selectedApi, api, key, { forceRefresh: true })
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
    setProviderModel(llmState, selectedApi, model)
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
    setProviderModel(llmState, selectedApi, model)
    await persistProviderModel(selectedApi, model)
    writeNotice('success', `Selected model for ${selectedApi}: ${model}`)
  }
}

async function handleProviderCommand(
  rl: ReturnType<typeof createInterface>,
  ty: Taskyon,
  llmState: CliLlmState,
) {
  const providerIds = [...SUPPORTED_PROVIDERS].filter((providerId) =>
    getProviderSettings(llmState, providerId),
  )
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

  const api = getProviderSettings(llmState, nextApi)
  if (!api) {
    writeError(`No API definition for '${nextApi}'.`)
    return
  }

  const configuredKey =
    (await ty.getSecret(API_KEY_STORE_NAME, nextApi, false, false)) ??
    resolveKeyForProvider(nextApi)
  const hasOauth = !!getProviderOauthConfig(api)
  const actionOptions = [
    llmState.selectedToolchainProfile === nextApi
      ? 'use provider (already selected)'
      : 'use provider',
    ...(hasOauth ? [configuredKey ? 're-login with OAuth' : 'login with OAuth'] : []),
    'back',
  ]
  const action = await selectFromList(rl, `\nProvider: ${nextApi}`, actionOptions)
  if (action === null) return
  if (action === 0) {
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
  const all = await createCliTaskyonClient(ty.port).tools.list({ includeHidden: true })
  const agentToolNames = new Set(
    resolveAgentToolCatalog(all, CLI_UNAVAILABLE_TOOL_NAMES).map((tool) => tool.name),
  )
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
    const kind = agentToolNames.has(toolName)
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
  const all = await createCliTaskyonClient(ty.port).tools.list({ includeHidden: true })
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
  uiSettings: {
    showRoleTag: boolean
    showFullFunctionResults: boolean
    searchOpenMode: 'conversation' | 'lineage'
    vectorizer: 'static-multilingual' | 'transformer-minilm'
  },
) {
  const choice = await selectFromList(rl, '\nSettings', [
    `toggle role/type tags ([user|message]): ${uiSettings.showRoleTag ? 'ON' : 'OFF'}`,
    `toggle full function results (session): ${uiSettings.showFullFunctionResults ? 'ON' : 'OFF'}`,
    `task search vectorizer: ${uiSettings.vectorizer}`,
    'back',
  ])
  if (choice === null || choice === 3) return
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
  if (choice === 2) {
    uiSettings.vectorizer =
      uiSettings.vectorizer === 'static-multilingual' ? 'transformer-minilm' : 'static-multilingual'
    await persistConfigPatch({
      cliUi: {
        showRoleTag: uiSettings.showRoleTag,
        searchOpenMode: uiSettings.searchOpenMode,
        vectorizer: uiSettings.vectorizer,
      },
    })
    writeNotice('success', `Task search vectorizer: ${uiSettings.vectorizer}`)
    return
  }
  uiSettings.showFullFunctionResults = !uiSettings.showFullFunctionResults
  writeNotice(
    'success',
    `Full function results (session): ${uiSettings.showFullFunctionResults ? 'ON' : 'OFF'}`,
  )
}

const taskSearchText = (task: TaskNode) =>
  task.content.type === 'message' && typeof task.content.data === 'string'
    ? task.content.data
    : JSON.stringify(task.content.data)

async function handleSearchCommand(args: {
  rl: ReturnType<typeof createInterface>
  storageClient: ReturnType<typeof createStorageClient>
  taskStorageNamespace: string
  query: string
  searchClient: ReturnType<typeof createSearchClient>
  searchIndex: string
  searchDataDirectory: string
  searchState: { loadedVectorizer?: 'static-multilingual' | 'transformer-minilm'; ids: Set<string> }
  uiSettings: {
    showRoleTag: boolean
    showFullFunctionResults: boolean
    searchOpenMode: 'conversation' | 'lineage'
    vectorizer: 'static-multilingual' | 'transformer-minilm'
  }
}) {
  const query = args.query.trim()
  if (!query) {
    writeLine('Usage: /search <words>')
    return undefined
  }
  writeLine(`Searching tasks for: ${query}`)
  await args.searchClient.configure({
    index: args.searchIndex,
    vectorizer: args.uiSettings.vectorizer,
  })
  const vectorizerDirectory = join(args.searchDataDirectory, args.uiSettings.vectorizer)
  if (args.searchState.loadedVectorizer !== args.uiSettings.vectorizer) {
    args.searchState.ids.clear()
    const persisted = await loadTaskSearchSidecars(vectorizerDirectory)
    await args.searchClient.upsertMany({ index: args.searchIndex, documents: persisted })
    persisted.forEach(({ id }) => args.searchState.ids.add(id))
    args.searchState.loadedVectorizer = args.uiSettings.vectorizer
  }
  const { ids } = await args.storageClient.listIds({ namespace: args.taskStorageNamespace })
  writeDebug(`task search discovered ${ids.length} task ids`)
  const { rows } = await args.storageClient.getMany({
    namespace: args.taskStorageNamespace,
    ids,
  })
  writeDebug(`task search loaded ${rows.length} task records`)
  const tasks = rows.map(({ data }) => TaskNode.parse(data))
  const missingDocuments = tasks
    .filter((task) => !args.searchState.ids.has(task.id))
    .map((task) => {
      const text = taskSearchText(task)
      return {
        id: task.id,
        text,
        createdAt: new Date(task.created_at ?? 0).toISOString(),
        metadata: {
          type: task.content.type,
          role: task.role,
          textLength: text.length,
          hasCode: /```|\b(function|class|const|def)\b/.test(text),
        },
      }
    })
  if (missingDocuments.length > 0) {
    writeLine(`Updating task search index: ${missingDocuments.length} new tasks`)
    await args.searchClient.upsertMany({
      index: args.searchIndex,
      documents: missingDocuments,
    })
    missingDocuments.forEach(({ id }) => args.searchState.ids.add(id))
    const { documents } = await args.searchClient.snapshot({ index: args.searchIndex })
    await saveTaskSearchSidecars(vectorizerDirectory, documents)
  }
  const { results } = await args.searchClient.query({
    index: args.searchIndex,
    text: query,
    limit: 20,
  })
  if (results.length === 0) {
    writeLine('No matching tasks found.')
    return undefined
  }
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const labels = results.map((result) => {
    const task = taskById.get(result.id)
    const snippet = task ? taskSearchText(task).replace(/\s+/g, ' ').slice(0, 90) : result.id
    return `${result.score.toFixed(3)} · ${task?.content.type ?? 'task'} · ${snippet}`
  })
  const selected = await selectFromList(args.rl, '\nTask search results', labels, {
    onToggle: () => {
      args.uiSettings.searchOpenMode =
        args.uiSettings.searchOpenMode === 'conversation' ? 'lineage' : 'conversation'
    },
    toggleHelp: () => `Tab: open ${args.uiSettings.searchOpenMode}`,
  })
  await persistConfigPatch({
    cliUi: {
      showRoleTag: args.uiSettings.showRoleTag,
      searchOpenMode: args.uiSettings.searchOpenMode,
      vectorizer: args.uiSettings.vectorizer,
    },
  })
  if (selected === null) return undefined
  const taskId = results[selected]?.id
  if (!taskId) return undefined
  if (args.uiSettings.searchOpenMode === 'lineage') return taskId

  const continuationIdsByPriorId = new Map<string, Set<string>>()
  for (const task of tasks) {
    if (!task.priorID) continue
    const ids = continuationIdsByPriorId.get(task.priorID) ?? new Set<string>()
    ids.add(task.id)
    continuationIdsByPriorId.set(task.priorID, ids)
  }
  const leafIds = await findContinuationLeafTaskIds(
    taskId,
    (id) => Promise.resolve(taskById.get(id) ?? null),
    (id) => Promise.resolve(continuationIdsByPriorId.get(id) ?? new Set()),
  )
  return leafIds[0] ?? taskId
}

async function handleClientCommand(runtime: TaskyonClientCommandRuntime, parsedArgs: string) {
  const result = await invokeTaskyonClient(runtime, parsedArgs)
  writeLine(formatClientCommandResult(result))
}

async function handleTreeCommand(args: {
  client: TaskyonClientInvoker
  leafId: string | undefined
  commandArgs: string
}) {
  if (!args.leafId) {
    writeLine('No active task tree yet.')
    return
  }

  const tasks = await backfillLinkedTasks(args.client, args.leafId)
  const yaml = buildTaskTreeYaml(tasks, args.leafId)
  const outputPath = args.commandArgs.trim() || 'taskyon-task-tree.yml'

  const resolvedPath = resolve(outputPath)
  await mkdir(dirname(resolvedPath), { recursive: true })
  await writeFile(resolvedPath, yaml)
  writeNotice('success', `Task tree written: ${resolvedPath}`)
}

async function resolveConversationToResume(
  rl: ReturnType<typeof createInterface>,
  configDir: string,
  arg: string,
  storageClient: ReturnType<typeof createStorageClient>,
) {
  const explicitPath = arg.trim()
  if (explicitPath) {
    const resolvedPath = resolve(explicitPath)
    try {
      await stat(resolvedPath)
      return { kind: 'markdown' as const, path: resolvedPath }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    const transcript = await storageClient.getBlob({
      namespace: TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE,
      id: explicitPath,
    })
    if (transcript) return { kind: 'blob' as const, id: explicitPath, transcript }
    return { kind: 'markdown' as const, path: resolvedPath }
  }

  const transcripts = (
    await storageClient.listBlobs({ namespace: TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE })
  ).blobs.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
  if (transcripts.length > 0) {
    const options = transcripts.slice(0, CLI_SESSION_HISTORY_LIMIT)
    const loaded = await Promise.all(
      options.map(async (metadata) => {
        const transcript = await storageClient.getBlob({
          namespace: TYCLI_CONVERSATION_TRANSCRIPT_NAMESPACE,
          id: metadata.id,
        })
        const markdown = transcript ? new TextDecoder().decode(transcript.data) : ''
        const firstMessage = processMarkdown(markdown).find(
          (task) => task.role === 'user' && task.content.type === 'message',
        )
        const sourceText =
          firstMessage?.content.type === 'message' ? firstMessage.content.data : markdown
        const title =
          textRankTaskName(sourceText, { maxWords: 5, maxChars: 72 }) ??
          firstWordsTaskName(sourceText, { maxWords: 7, maxChars: 72 }) ??
          'Saved conversation'
        return { metadata, transcript, title }
      }),
    )
    const labels = loaded.map(
      ({ metadata, title }) => `${new Date(metadata.modifiedAt).toLocaleString()} — ${title}`,
    )
    const selected = await selectFromList(rl, '\nSaved conversations', labels)
    if (selected === null) return null
    const selectedTranscript = loaded[selected]
    return selectedTranscript?.transcript
      ? {
          kind: 'blob' as const,
          id: selectedTranscript.metadata.id,
          transcript: selectedTranscript.transcript,
        }
      : null
  }

  const files = await listConversationFiles(configDir)
  if (files.length <= 0) {
    writeLine('No saved conversations found.')
    return null
  }
  const options = files.slice(0, CLI_SESSION_HISTORY_LIMIT)
  const labels = await Promise.all(
    options.map(async (path) => {
      const fileStat = await stat(path)
      const markdown = await readFile(path, 'utf8')
      const title = firstWordsTaskName(markdown, { maxWords: 7, maxChars: 72 }) ?? 'Legacy chat'
      return `${new Date(fileStat.mtimeMs).toLocaleString()} — ${title}`
    }),
  )
  const selected = await selectFromList(rl, '\nSaved conversations', labels)
  if (selected === null) return null
  const path = options[selected]
  return path ? { kind: 'markdown' as const, path } : null
}

async function handleResumeCommand(args: {
  rl: ReturnType<typeof createInterface>
  ty: Taskyon
  configDir: string
  currentConversationPath: string
  currentLogPath: string | undefined
  sessions: readonly TycliSessionRecord[]
  storageClient: ReturnType<typeof createStorageClient>
  commandArgs: string
}) {
  const source = await resolveConversationToResume(
    args.rl,
    args.configDir,
    args.commandArgs,
    args.storageClient,
  )
  if (!source) return undefined
  const markdown =
    source.kind === 'blob'
      ? new TextDecoder().decode(source.transcript.data)
      : await readFile(source.path, 'utf8')
  const leafId = await createTaskChainFromMarkdown(createCliTaskyonClient(args.ty.port), markdown)
  const sourceSession =
    source.kind === 'markdown' ? findSessionForConversation(args.sessions, source.path) : undefined

  writeNote('Conversation Resumed', [
    source.kind === 'blob'
      ? `Imported conversation from ${new Date(source.transcript.metadata.modifiedAt).toLocaleString()}.`
      : `Imported legacy conversation from ${new Date(sourceSession?.startedAt ?? 0).toLocaleString()}.`,
  ])
  return leafId
}

async function handleSlashCommand(
  parsed: SlashParsed,
  rl: ReturnType<typeof createInterface>,
  ty: Taskyon,
  taskyonClient: TaskyonClientInvoker,
  taskPort: Parameters<typeof waitForTaskResult>[0],
  llmState: CliLlmState,
  uiSettings: {
    showRoleTag: boolean
    showFullFunctionResults: boolean
    searchOpenMode: 'conversation' | 'lineage'
    vectorizer: 'static-multilingual' | 'transformer-minilm'
  },
  toolRenderOptions: Record<string, { hideChat?: boolean }>,
  currentLeafId: string | undefined,
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

  if (parsed.name === 'client') {
    await handleClientCommand({ client: taskyonClient, taskPort }, parsed.args)
    return true
  }

  if (parsed.name === 'tree') {
    await handleTreeCommand({
      client: taskyonClient,
      leafId: currentLeafId,
      commandArgs: parsed.args,
    })
    return true
  }

  if (parsed.name === 'exit' || parsed.name === 'quit') {
    return false
  }

  writeError(
    `Unknown command '/${parsed.name}'. Supported: /keys, /provider, /model, /tools, /debug, /settings, /client, /resume, /search, /tree, /exit, /quit`,
  )
  return true
}

async function loadProjectInstructions(cwd: string): Promise<string> {
  const root = await resolveProjectInstructionRoot(cwd, process.env.TYCLI_CWD?.trim())
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
    if (current === root) break
    const parentDir = resolve(current, '..')
    if (parentDir === current) break
    current = parentDir
  }
  if (parts.length <= 0) return ''
  return `## Project Instructions\n\nThe following project instructions were loaded from files found in the workspace:\n\n${parts.reverse().join('\n\n')}`
}

async function resolveProjectInstructionRoot(
  cwd: string,
  explicitInvocationCwd?: string,
): Promise<string> {
  if (explicitInvocationCwd) {
    const explicitRoot = resolve(explicitInvocationCwd)
    const current = resolve(cwd)
    const relativeToExplicitRoot = relative(explicitRoot, current)
    if (!relativeToExplicitRoot || !relativeToExplicitRoot.startsWith('..')) {
      return explicitRoot
    }
  }
  const nearestRoot = await findNearestAncestorWithAnyFile(cwd, ['.git', 'package.json'])
  return nearestRoot ?? resolve(cwd)
}

async function findNearestAncestorWithAnyFile(
  cwd: string,
  names: string[],
): Promise<string | undefined> {
  let current = resolve(cwd)
  for (;;) {
    for (const name of names) {
      try {
        await stat(join(current, name))
        return current
      } catch {
        // Try the next root marker.
      }
    }
    const parentDir = resolve(current, '..')
    if (parentDir === current) return undefined
    current = parentDir
  }
}

async function main() {
  adoptInvocationWorkingDirectory()
  const taskyonClientCommand = parseTaskyonClientCliArgs(process.argv.slice(2))

  let restoreConsoleLogging: (() => void) | undefined
  const sessionStartedAt = new Date()
  writeLine('Starting tycli...')
  try {
    writeLine('Initializing runtime log...')
    runtimeLog = await createRuntimeLog()
    restoreConsoleLogging = installRuntimeConsoleLogging(runtimeLog)
  } catch (error) {
    writeError(`Runtime log unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }
  writeLine('Loading CLI configuration...')
  const startupMeta = await loadStartupMeta()
  const { cryptoSession, stored } = await initPersistentCryptoSession()
  const configDir = await resolveConfigDirectoryPath()
  const dataDir = await resolveDataDirectoryPath()
  configureStaticEmbeddingAssetReader(
    createStaticEmbeddingAssetReader(join(dataDir, 'models', 'static-embeddings')),
  )
  const previousSessions = normalizeSessionRecords(stored.sessions)
  const previousSession = previousSessions[0]
  const pgliteNodeDir = join(configDir, 'runtime', `${errorTimestamp()}-${process.pid}`, 'pglite')
  await mkdir(pgliteNodeDir, { recursive: true })
  const cliSecretStore = createCliSecretStore(cryptoSession)
  const selectedApi = resolveProviderSelection(stored)

  if (!SUPPORTED_PROVIDERS.includes(selectedApi as (typeof SUPPORTED_PROVIDERS)[number])) {
    throw new Error(
      `Unsupported provider '${selectedApi}'. Choose one of: ${SUPPORTED_PROVIDERS.join(', ')}`,
    )
  }

  const model = resolveStoredModel(stored, selectedApi)
  const providerKey = resolveKeyForProvider(selectedApi)
  const config = {
    selectedApi,
    ...(model ? { model } : {}),
    ...(providerKey ? { key: providerKey } : {}),
  } as CliApiConfig
  const chatCompletionTrace = resolveCliChatCompletionTrace()
  if (chatCompletionTrace) {
    setChatCompletionTraceWriter(createCliChatCompletionTraceWriter(chatCompletionTrace.dir))
  } else {
    setChatCompletionTraceWriter(undefined)
  }
  const explorationContextFiles: Record<string, string> = {}
  const explorationTool = createExplorationTool(explorationContextFiles)

  const llmState = createCliLlmState(config)
  const uiSettings = {
    showRoleTag: stored.cliUi?.showRoleTag ?? true,
    showFullFunctionResults: false,
    searchOpenMode: stored.cliUi?.searchOpenMode ?? 'conversation',
    vectorizer: stored.cliUi?.vectorizer ?? 'static-multilingual',
  }
  const toolRenderOptions: Record<string, { hideChat?: boolean }> = {}
  const projectInstructions = await loadProjectInstructions(process.cwd())
  const taskyonRef: { current?: Taskyon } = {}
  writeLine(`Initializing Taskyon runtime for provider '${selectedApi}'...`)
  const cliEntryNodeTool = createStandardEntryNodeTool({
    name: ENTRY_NODE_TOOL_NAME,
    renderOptions: { hideLlm: true, hideChat: true },
    toolChooser: { enabled: true, useTools: true },
    getToolCatalog: async ({ taskChain, allowedTools }) => {
      const ty = taskyonRef.current
      if (!ty) return []
      const allTools = await createCliTaskyonClient(ty.port).tools.list({
        includeHidden: true,
      })
      return resolveInitialAgentToolCatalog(
        allTools,
        taskChain,
        CLI_UNAVAILABLE_TOOL_NAMES,
        allowedTools,
      )
    },
    searchToolCatalog: async (query, limit) => {
      const ty = taskyonRef.current
      if (!ty) return []
      const allTools = await createCliTaskyonClient(ty.port).tools.list({
        includeHidden: true,
      })
      return searchAgentToolCatalog(allTools, query, limit, CLI_UNAVAILABLE_TOOL_NAMES)
    },
    stableContext: () => buildCliStableContext(projectInstructions),
    extraContext: () => buildCliVolatileContext(),
    includeRoutinePrompt: false,
  })
  const cliEntryTask = toolCall({
    name: ENTRY_NODE_TOOL_NAME,
    arguments: {},
  })
  llmState.settings = {
    ...llmState.settings,
    entryFunction: ENTRY_NODE_TOOL_NAME,
  }
  llmState.toolchainProfiles.base = {
    entryNode: {
      providerToolCalling: true,
      use_baseprompt: true,
      use_multimodal: true,
      max_error_retries: 3,
      ...(chatCompletionTrace
        ? {
            trace: {
              enabled: true,
              ...(chatCompletionTrace.label ? { label: chatCompletionTrace.label } : {}),
            },
          }
        : {}),
      prompt_templates: DEFAULT_PROMPT_TEMPLATES,
    },
  }
  const { x: taskStorageClientPort, y: taskStorageServicePort } =
    createProtocolPort(taskyonStorageProtocol)
  const storageRoot = join(dataDir, 'storage')
  await createCliSelectedStorageService({
    port: taskStorageServicePort,
    dataDirectory: dataDir,
    selection: resolveCliStorageSelection(stored),
  })
  const storageClient = createStorageClient(taskStorageClientPort)
  const { x: loggingClientPort, y: loggingServicePort } = createProtocolPort(taskyonLoggingProtocol)
  const directRuntimeLog = runtimeLog
  const stopLoggingService = directRuntimeLog
    ? createLoggingProtocolServer(loggingServicePort, {
        write: ({ level, source, message }) => {
          directRuntimeLog.append(`${level}:${source}`, message)
        },
        flush: directRuntimeLog.flush,
      })
    : () => undefined
  if (directRuntimeLog) {
    runtimeLog = routeRuntimeLogThroughProtocol(
      directRuntimeLog,
      createLoggingClient(loggingClientPort),
      `tycli-${sessionStartedAt.toISOString()}-${process.pid}`,
    )
    restoreConsoleLogging?.()
    restoreConsoleLogging = installRuntimeConsoleLogging(runtimeLog)
  }
  const taskyon = await tyCore(
    () => llmState.settings,
    () => cliEntryTask,
    getSelectedToolchainConfig(llmState),
    cryptoSession,
    {
      toolSetup: createDefaultTaskyonToolSetup({
        unavailableToolNames: CLI_UNAVAILABLE_TOOL_NAMES,
      }),
      createIframeMultiPlexer: () =>
        createUnavailableIframeMux('Iframe message bridging is not available in tycli.'),
      indexTaskVectors: false,
      nodePgLiteDataDir: pgliteNodeDir,
      secretStore: cliSecretStore,
      taskManagerStorageFactory: ({ sessionId }) =>
        connectTaskManagerStorageFromProtocol(taskStorageClientPort, sessionId),
      artifactStoreFactory: ({ sessionId }) =>
        createArtifactStore(
          createProtocolStorageBlobBackend(taskStorageClientPort, `${sessionId}/artifacts`),
        ),
    },
  )
  taskyonRef.current = taskyon
  const taskSearchIndex = 'tasks'
  const taskSearchBackend = createPgLiteSearchIndexBackend(
    await getInMemoryDatabase(`tycli-task-search-${process.pid}`),
    'tycliTaskSearch',
  )
  const { x: taskSearchClientPort, y: taskSearchServicePort } =
    createProtocolPort(taskyonSearchProtocol)
  const stopTaskSearchService = createSearchProtocolServer(taskSearchServicePort, (index) => {
    if (index !== taskSearchIndex) throw new Error(`Unknown CLI search index: ${index}`)
    return taskSearchBackend
  })
  const taskSearchClient = createSearchClient(taskSearchClientPort)
  const taskSearchState: {
    loadedVectorizer?: 'static-multilingual' | 'transformer-minilm'
    ids: Set<string>
  } = { ids: new Set() }
  const taskStorageNamespace = `${await cryptoSession.getSessionId()}/taskyonNodes`
  writeLine('Synchronizing provider credentials...')
  await syncProviderRuntimeConfig(taskyon, llmState, selectedApi)
  writeLine('Preparing conversation storage...')
  const conversationPersistence = await createConversationPersistence({
    taskyon,
    storageRoot,
    storageClient,
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
  let currentSessionRecorded = false
  const recordCurrentSession = async (endedAt?: string) => {
    if (!conversationPersistence.hasPersistedConversation()) return
    if (currentSessionRecorded && !endedAt) return
    await persistConfigPatch({
      sessions: normalizeSessionRecords([
        { ...currentSession, ...(endedAt ? { endedAt } : {}) },
        ...normalizeSessionRecords((await loadStoredConfig()).sessions).filter(
          (session) => session.conversationPath !== currentSession.conversationPath,
        ),
      ]),
    })
    currentSessionRecorded = true
  }

  const persistedKey = await taskyon.getSecret(API_KEY_STORE_NAME, selectedApi, false, false)
  const bootstrapKey = persistedKey ?? config.key
  if (bootstrapKey) {
    await taskyon.setSecret(API_KEY_STORE_NAME, selectedApi, bootstrapKey)
    await taskyon.updateChatCompletionApiKey(selectedApi, bootstrapKey)
  }

  if (llmState.selectedToolchainProfile === 'local' && taskyonClientCommand === null) {
    const localApi = getProviderSettings(llmState, 'local')
    if (!localApi) throw new Error('Local provider profile is missing')
    const isReachable = await canReachLocalApi(localApi.baseURL)
    if (!isReachable) {
      writeLine(
        'Warning: local provider selected but http://localhost:8080 is unreachable. Configure a provider via /keys and switch with /provider.',
      )
    }
  }

  const { x: clientPort, y: bridgePort } = createProtocolPort(taskyonProtocol)
  const taskyonApi = createCliTaskyonClient(clientPort)
  const unsubscribeBridgeToTaskyon = bridgePort.receive((msg: unknown) =>
    taskyon.port.send(msg as Parameters<typeof taskyon.port.send>[0]),
  )
  const unsubscribeTaskyonToBridge = taskyon.port.receive((msg: unknown) =>
    bridgePort.send(msg as Parameters<typeof bridgePort.send>[0]),
  )

  writeLine('Registering CLI tools...')
  const documentationLoader = createNodeResourceFilesLoader(
    fileURLToPath(new URL('../../../public/docs', import.meta.url)),
    () => taskyonApi.discovery.describe({}),
  )
  const documentationBases = createProtocolDocumentationBaseStore(
    storageClient,
    documentationLoader,
  )
  await documentationBases.register(taskyonDocumentationManifest, 'taskyon')
  const interactiveReadlineRef: { current?: ReturnType<typeof createInterface> } = {}
  const cliTools: InternalTool[] = [
    cliEntryNodeTool,
    createCliClarificationTool(() => interactiveReadlineRef.current),
    explorationTool,
    updateFilesTool,
    downloadFileTool,
    mapSearchTool,
    overpassMapTool,
    githubIssuesTool,
    gitlabTool,
    dagGraphProjectTool,
    cliBashTool,
    createDocumentationIndexClientTool(documentationBases),
    taskyonDocumentationTool,
  ].map((tool) => InternalToolSchema.parse(tool))
  const cliToolRpcExecutor = await registerToolRpcTools({
    port: clientPort,
    tools: cliTools,
    createContext: (call, stopSignal) =>
      createExternalToolContext(stopSignal, {
        getExecutionTaskChain: () => {
          if (!call.taskId) {
            throw new Error(
              'getExecutionTaskChain is not available for this tool call because no task id was provided.',
            )
          }
          return taskyonApi.task.getChain({ id: call.taskId })
        },
      }),
  })
  await refreshToolRenderOptions(taskyon, toolRenderOptions)
  writeLine('Opening interactive prompt...')

  if (taskyonClientCommand !== null) {
    try {
      await handleClientCommand(
        { client: taskyonApi, taskPort: clientPort as Parameters<typeof waitForTaskResult>[0] },
        taskyonClientCommand,
      )
      await recordCurrentSession(new Date().toISOString()).catch(() => {})
    } finally {
      cliToolRpcExecutor.destroy()
      unsubscribeBridgeToTaskyon()
      unsubscribeTaskyonToBridge()
      taskyon.cancelCurrentRun('tycli client command complete')
      setChatCompletionTraceWriter(undefined)
      restoreConsoleLogging?.()
      await runtimeLog?.flush().catch(() => {})
    }
    process.exit(0)
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    history: normalizeInputHistory(stored.inputHistory),
    historySize: 500,
    removeHistoryDuplicates: false,
  })
  interactiveReadlineRef.current = rl
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
  let waitingForTask = false
  let interruptedCurrentTask = false
  let interruptNoticePrinted = false
  let requestQuitOnNextPrompt = false
  let quitPromptAbortController: AbortController | null = null
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
  let toolProgressLines: string[] = []
  let thinkingText = ''
  let thinkingPanelHeight = 0
  let thinkingRenderTimer: ReturnType<typeof setTimeout> | null = null
  let renderedThinkingPanelText = ''
  const pendingHiddenNodeMarkers: string[] = []
  let workerIdleSettleTimer: ReturnType<typeof setTimeout> | null = null
  const activeWorkerTasks = new Set<string>()
  const suppressedTaskIds = new Set<string>()
  const completedSubtaskSummaryIds = new Set<string>()
  let hasWorkerProcessing = false
  let taskProcessingStatus: 'idle' | 'processing' | 'finished' = 'idle'
  const taskSnapshotById = new Map<string, string>()
  const taskById = new Map<string, TaskNode>()
  const workerTaskStateById = new Map<string, TyTaskStreamData['stage']>()
  const footer = await createCliFooter()
  const workerSpinnerFrames = ['-', '\\', '|', '/']
  let workerStatusTimer: ReturnType<typeof setInterval> | null = null
  let workerStatusFrameIndex = 0
  let workerStatusText = ''
  let workerStatusRendered = false

  const clearWorkerStatusLine = () => {
    if (!workerStatusRendered) return
    process.stdout.write('\r\x1b[2K')
    workerStatusRendered = false
  }

  clearTransientStatusLine = clearWorkerStatusLine

  const renderWorkerStatusLine = () => {
    if (!process.stdout.isTTY || !workerStatusText || activeCliMenuDepth > 0) return
    const frame = workerSpinnerFrames[workerStatusFrameIndex % workerSpinnerFrames.length] ?? '-'
    workerStatusFrameIndex += 1
    process.stdout.write(`\r\x1b[2K${frame} ${workerStatusText}`)
    workerStatusRendered = true
  }

  const setWorkerStatusLine = (text: string) => {
    if (!process.stdout.isTTY) return
    if (activeCliMenuDepth > 0) {
      clearWorkerStatusLine()
      workerStatusText = text
      return
    }
    workerStatusText = text
    if (workerStatusTimer === null) {
      workerStatusTimer = setInterval(renderWorkerStatusLine, 120)
      workerStatusTimer.unref()
    }
    renderWorkerStatusLine()
  }

  const stopWorkerStatusLine = () => {
    if (workerStatusTimer !== null) {
      clearInterval(workerStatusTimer)
      workerStatusTimer = null
    }
    workerStatusText = ''
    workerStatusFrameIndex = 0
    clearWorkerStatusLine()
  }

  const clearWorkerIdleSettleTimer = () => {
    if (workerIdleSettleTimer === null) return
    clearTimeout(workerIdleSettleTimer)
    workerIdleSettleTimer = null
  }

  const updateWorkerStatusLine = (event: WorkerEvent, suppressed: boolean) => {
    if (activeTaskCount() <= 0) {
      stopWorkerStatusLine()
      return
    }
    if (isInteractivePromptWorkerEvent(event)) {
      stopWorkerStatusLine()
      return
    }
    if (activeCliMenuDepth > 0) {
      clearWorkerStatusLine()
      return
    }
    if (suppressed) return
    const text = resolveWorkerStatusText(event, (name) =>
      Boolean(toolRenderOptions[name]?.hideChat),
    )
    if (text) setWorkerStatusLine(text)
    else if (event.stage === 'processing' || event.stage === 'subtasks') {
      setWorkerStatusLine('task: processing')
    } else stopWorkerStatusLine()
  }

  const conversationPersistQueue = createConversationPersistQueue(
    async (leafId) => {
      await conversationPersistence.persist(leafId)
      await recordCurrentSession()
    },
    (error) => {
      writeDebug(
        `Failed to persist conversation: ${error instanceof Error ? error.message : String(error)}`,
      )
    },
  )

  const queueConversationPersist = (leafId: string | undefined = currentLeafId) => {
    conversationPersistQueue.request(leafId)
  }

  const flushConversationPersist = async () => {
    queueConversationPersist(currentLeafId)
    await conversationPersistQueue.flush()
  }

  const currentProviderModel = () => {
    const provider = llmState.selectedToolchainProfile
    const settings = getSelectedProviderSettings(llmState)
    return {
      provider,
      model: settings.model,
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

  const workerIdleWaiters = new Set<() => void>()

  const notifyWorkerIdleWaiters = () => {
    if (activeTaskCount() > 0) return
    const waiters = [...workerIdleWaiters]
    workerIdleWaiters.clear()
    waiters.forEach((resolve) => resolve())
  }

  const waitForWorkerIdle = async (timeoutMs: number, signal?: AbortSignal) =>
    await new Promise<void>((resolve, reject) => {
      if (activeTaskCount() <= 0) {
        resolve()
        return
      }
      if (signal?.aborted) {
        reject(new DOMException('Worker idle wait aborted', 'AbortError'))
        return
      }

      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out waiting for worker to settle after ${timeoutMs}ms`))
      }, timeoutMs)

      const cleanup = () => {
        clearTimeout(timeout)
        workerIdleWaiters.delete(onIdle)
        signal?.removeEventListener('abort', onAbort)
      }

      const onIdle = () => {
        cleanup()
        resolve()
      }

      const onAbort = () => {
        cleanup()
        reject(new DOMException('Worker idle wait aborted', 'AbortError'))
      }

      workerIdleWaiters.add(onIdle)
      signal?.addEventListener('abort', onAbort, { once: true })
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

  const noteHiddenNode = (toolName: string) => {
    pendingHiddenNodeMarkers.push(toolName)
  }

  const flushHiddenNodeMarkers = () => {
    if (pendingHiddenNodeMarkers.length <= 0) return
    writeLine(pendingHiddenNodeMarkers.map((toolName) => `>${toolName}`).join('\n'))
    pendingHiddenNodeMarkers.length = 0
  }

  const renderCompletedSubtaskSummary = (event: WorkerEvent) => {
    const taskId = event.task?.id ?? event.taskId
    if (event.stage !== 'finished' || !taskId || completedSubtaskSummaryIds.has(taskId)) return
    const toolCallCount = countDelegatedSubtaskToolCalls(taskId, taskById.values())
    if (toolCallCount === null) return
    completedSubtaskSummaryIds.add(taskId)
    clearThinkingPanel()
    flushHiddenNodeMarkers()
    writeLine(
      `>subtask completed: ${String(toolCallCount)} ${toolCallCount === 1 ? 'tool call' : 'tool calls'}`,
    )
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
    stopWorkerStatusLine()
    clearWorkerIdleSettleTimer()
    thinkingLines = []
    toolProgressLines = []
    thinkingText = ''
    activeWorkerTasks.clear()
    workerTaskStateById.clear()
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

  const isInteractivePromptWorkerEvent = (event: WorkerEvent) => {
    const functionName =
      event.task?.content?.type === 'functioncall' ? event.task.content.data?.name : undefined
    return typeof functionName === 'string' && INTERACTIVE_PROMPT_TOOL_NAMES.has(functionName)
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
    const currentTask = currentLeafId ? taskById.get(currentLeafId) : undefined
    const siblingChains = currentTask?.parentID
      ? selectChildTaskChains(currentTask.parentID, taskById.values())
      : []
    const lineage: TaskNode[] = []
    const visited = new Set<string>()
    let cursor = currentTask
    while (cursor && !visited.has(cursor.id)) {
      visited.add(cursor.id)
      lineage.push(cursor)
      cursor = cursor.parentID ? taskById.get(cursor.parentID) : undefined
    }
    const childChains = lineage
      .filter((task) => task.content.type === 'functioncall')
      .flatMap((task) => selectChildTaskChains(task.id, taskById.values()))
    const queuedTasks = selectTaskQueueBranches(
      [...siblingChains, ...childChains],
      workerTaskStateById,
    )
      .flatMap((branch) => branch.pendingTasks)
      .filter(
        (task) =>
          task.content.type === 'message' ||
          (task.content.type === 'functioncall' &&
            !toolRenderOptions[task.content.data.name]?.hideChat),
      )
    const queueLines =
      queuedTasks.length > 0
        ? [
            `[queue] ${queuedTasks.length} ${queuedTasks.length === 1 ? 'task' : 'tasks'} queued`,
            ...queuedTasks.slice(0, 3).map((task) => `  - ${getTaskQueueLabel(task)}`),
            ...(queuedTasks.length > 3 ? [`  - ... ${queuedTasks.length - 3} more`] : []),
          ]
        : []
    const recent = thinkingLines.slice(-5)
    const progressPanel =
      toolProgressLines.length > 0
        ? ['[tool progress]', ...toolProgressLines.map((line) => `  ${line}`)]
        : []
    const thinkingPanel =
      recent.length > 0 ? ['[thinking]', ...recent.map((line) => `  ${line}`)] : []
    const panel = [...queueLines, ...progressPanel, ...thinkingPanel]
    const panelText = panel.join('\n')
    if (panelText === renderedThinkingPanelText) return

    clearThinkingRenderTimer()
    eraseThinkingPanel()
    if (panel.length <= 0) {
      renderedThinkingPanelText = ''
      return
    }

    clearWorkerStatusLine()
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
    if (stage === 'tool progress' && event.progress) {
      const prefix = event.progress.kind ? `[${event.progress.kind}] ` : ''
      const lines = event.progress.message
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => `${prefix}${line.slice(0, 160)}`)
      toolProgressLines = [...toolProgressLines, ...lines].slice(-5)
      writeDebug(
        `tool progress: ${JSON.stringify({ taskId, toolName: event.toolName, ...event.progress })}`,
      )
      scheduleThinkingRender()
    }
    if (taskId && event.stage) {
      if (['processed', 'finished', 'aborted', 'error'].includes(event.stage)) {
        workerTaskStateById.delete(taskId)
      } else {
        workerTaskStateById.set(taskId, event.stage)
      }
      scheduleThinkingRender()
    }
    if (stage !== 'waiting') clearWorkerIdleSettleTimer()
    if (stage === 'queued' || stage === 'processing') {
      if (taskId) activeWorkerTasks.add(taskId)
      if (stage === 'processing') hasWorkerProcessing = true
    }
    if (stage === 'processing' || stage === 'in loop' || stage === 'subtasks') {
      taskProcessingStatus = 'processing'
    }
    if (stage === 'all processed') {
      clearWorkerIdleSettleTimer()
      activeWorkerTasks.clear()
      hasWorkerProcessing = false
      taskProcessingStatus = 'finished'
      clearWorkerCleanupNoticeTimer()
      stopWorkerStatusLine()
      clearThinkingPanel()
      flushHiddenNodeMarkers()
    }
    if (stage === 'waiting' && activeTaskCount() > 0 && workerIdleSettleTimer === null) {
      workerIdleSettleTimer = setTimeout(() => {
        workerIdleSettleTimer = null
        activeWorkerTasks.clear()
        hasWorkerProcessing = false
        taskProcessingStatus = 'finished'
        clearWorkerCleanupNoticeTimer()
        stopWorkerStatusLine()
        updateFooter()
        notifyWorkerIdleWaiters()
      }, 100)
      workerIdleSettleTimer.unref()
    }
    if (stage === 'processed' || stage === 'finished' || stage === 'aborted' || stage === 'error') {
      if (taskId) activeWorkerTasks.delete(taskId)
      if (stage !== 'processed' && stage !== 'finished') hasWorkerProcessing = false
      if (activeWorkerTasks.size === 0 && (stage === 'processed' || stage === 'finished')) {
        hasWorkerProcessing = false
      }
      if (activeWorkerTasks.size === 0 && !hasWorkerProcessing) taskProcessingStatus = 'finished'
      if (stage !== 'processed' && stage !== 'finished') clearWorkerCleanupNoticeTimer()
      if (activeTaskCount() <= 0) stopWorkerStatusLine()
    }
    updateFooter()
    notifyWorkerIdleWaiters()
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
    stopWorkerStatusLine()
    footer.restore()
    writeSessionLocations('Session Locations', currentSessionLocations())
    restoreTerminalInput()
    try {
      taskyon.cancelCurrentRun(reason)
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
      taskyon.cancelCurrentRun(`Interrupted by ${source}`)
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
      quitPromptAbortController?.abort()
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
    if (requestQuitOnNextPrompt) {
      eofRequested = true
      requestQuitOnNextPrompt = false
      quitPromptAbortController?.abort()
      noteInterruptPhase('Ctrl-D received.')
      return
    }
    eofRequested = true
    noteInterruptPhase('Ctrl-D received.')
  }
  const startTaskInterruptKeys = () => {
    const stdin = process.stdin
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') return undefined
    emitKeypressEvents(stdin)
    let cleanedUp = false
    const preserveReadlineOnSigint = () => undefined
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
      rl.on('SIGINT', preserveReadlineOnSigint)
    } catch {
      return undefined
    }
    return () => {
      if (cleanedUp) return
      cleanedUp = true
      stdin.off('keypress', onKeypress)
      rl.off('SIGINT', preserveReadlineOnSigint)
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
  const unsubscribeTaskProgress = clientPort.receive((msg) => {
    if (!isTaskCreatedMessage(msg)) return
    const task = msg.task
    const suppressed = isSuppressedTask(task)
    const snapshot = JSON.stringify(task.content)
    const prev = taskSnapshotById.get(task.id)
    if (prev === snapshot) return
    taskSnapshotById.set(task.id, snapshot)
    taskById.set(task.id, task)
    currentLeafId = task.id
    queueConversationPersist(task.id)
    if (suppressed) return
    scheduleThinkingRender()
    renderTaskProgress(
      {
        debugEnabled: () => debugLogsEnabled,
        showRoleTag: () => uiSettings.showRoleTag,
        showFullFunctionResults: () => uiSettings.showFullFunctionResults,
        isFunctionHiddenInChat: (name: string) => Boolean(toolRenderOptions[name]?.hideChat),
        noteHiddenNode,
        flushHiddenNodeMarkers,
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
    trackWorkerProgress(workerEvent)
    updateWorkerStatusLine(workerEvent, suppressed)
    if (suppressed) return
    renderCompletedSubtaskSummary(workerEvent)
    renderWorkerProgress(
      {
        debugEnabled: () => debugLogsEnabled,
        showRoleTag: () => uiSettings.showRoleTag,
        showFullFunctionResults: () => uiSettings.showFullFunctionResults,
        isFunctionHiddenInChat: (name: string) => Boolean(toolRenderOptions[name]?.hideChat),
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
  const activeApi = getSelectedProviderSettings(llmState)
  writeNotice(
    'info',
    `tycli ready. provider=${llmState.selectedToolchainProfile} model=${activeApi.model}`,
  )
  writeNotice(
    'info',
    'Slash commands: /keys, /provider, /model, /tools, /debug, /settings, /client, /resume, /search, /tree, /exit, /quit',
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
        quitPromptAbortController = new AbortController()
        const answerRaw = await askQuestion(rl, '> ', {
          signal: quitPromptAbortController.signal,
          interruptNotice: false,
          onSigint,
        })
        quitPromptAbortController = null
        if (eofRequested) {
          eofRequested = false
          requestImmediateShutdown('EOF/Readline closed', 0)
          break
        }
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
        onSigint,
        onCtrld,
        () => {
          if (!interruptedCurrentTask || interruptNoticePrinted) return
          setImmediate(writeTaskInterruptedNotice)
        },
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
              storageClient,
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
        if (parsed.name === 'search') {
          inMenuInteraction = true
          try {
            const selectedLeafId = await handleSearchCommand({
              rl,
              storageClient,
              taskStorageNamespace,
              query: parsed.args,
              searchClient: taskSearchClient,
              searchIndex: taskSearchIndex,
              searchDataDirectory: join(dataDir, 'search', 'tasks'),
              searchState: taskSearchState,
              uiSettings,
            })
            if (selectedLeafId) currentLeafId = selectedLeafId
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
          taskyonApi,
          clientPort as Parameters<typeof waitForTaskResult>[0],
          llmState,
          uiSettings,
          toolRenderOptions,
          currentLeafId,
        )
        inMenuInteraction = false
        if (!keepRunning) {
          stopMainLoop = true
          requestedExitCode = 0
          break
        }
        continue
      }

      const currentProvider = llmState.selectedToolchainProfile
      if (!(await taskyon.getSecret(API_KEY_STORE_NAME, currentProvider, false, false))) {
        writeError(`No key configured for '${currentProvider}'. Run /keys first.`)
        continue
      }

      pendingHiddenNodeMarkers.length = 0
      completedSubtaskSummaryIds.clear()

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

      await taskyonApi.task.createChain({
        tasks: taskChain,
        execute: true,
        show: true,
      })
      writeDebug(`queued task chain: ${taskChain.map((task) => task.id).join(', ')}`)
      try {
        waitingForTask = true
        interruptedCurrentTask = false
        interruptNoticePrinted = false
        resetThinking()
        taskProcessingStatus = 'processing'
        hasWorkerProcessing = true
        updateFooter()
        setWorkerStatusLine('task: processing')
        renderThinkingPanel()
        taskInterruptKeysCleanup = startTaskInterruptKeys()
        activeTaskWaitController = new AbortController()
        const result = await waitForTaskResult(
          clientPort as Parameters<typeof waitForTaskResult>[0],
          taskChain.map((task) => task.id),
          ['message', 'error', 'return'],
          10 * 60 * 1000,
          activeTaskWaitController.signal,
          (task) => task.content.type === 'message',
          () => activeTaskCount() <= 0,
        )
        currentLeafId = result.id
        writeDebug(`received result task: ${result.id} (${result.content.type})`)
        await waitForWorkerIdle(10 * 60 * 1000, activeTaskWaitController.signal)
        waitingForTask = false
        activeTaskWaitController = undefined
        taskInterruptKeysCleanup?.()
        taskInterruptKeysCleanup = undefined
        clearWorkerCleanupNoticeTimer()
        clearThinkingPanel()
        stopWorkerStatusLine()
        if (interruptedCurrentTask) {
          await flushConversationPersist()
          restorePromptIfIdle()
          continue
        }
        await flushConversationPersist()
        restorePromptIfIdle()
      } catch (error) {
        waitingForTask = false
        activeTaskWaitController = undefined
        taskInterruptKeysCleanup?.()
        taskInterruptKeysCleanup = undefined
        clearWorkerCleanupNoticeTimer()
        clearThinkingPanel()
        stopWorkerStatusLine()
        if (interruptedCurrentTask) {
          await flushConversationPersist()
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
    stopTaskSearchService()
    unsubscribeBridgeToTaskyon()
    unsubscribeTaskyonToBridge()
    activeTaskWaitController = undefined
    taskInterruptKeysCleanup?.()
    taskInterruptKeysCleanup = undefined
    clearWorkerCleanupNoticeTimer()
    stopWorkerStatusLine()
    clearTransientStatusLine = undefined
    await flushConversationPersist().catch(() => {})
    taskyon.cancelCurrentRun('tycli exit')
    setChatCompletionTraceWriter(undefined)
    if (conversationPersistence.hasPersistedConversation()) {
      writeOutro(`Conversation saved: ${conversationPersistence.filePath}`)
      await recordCurrentSession(new Date().toISOString()).catch(() => {})
    } else {
      writeOutro('No conversation saved: no messages.')
    }
    await flushConfigWrites().catch((error: unknown) => {
      writeDebug(
        `Failed to flush CLI configuration: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    writeOutro(`tycli log: ${runtimeLog?.filePath ?? 'unavailable'}`)
    restoreConsoleLogging?.()
    await runtimeLog?.flush().catch(() => {})
    stopLoggingService()
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
