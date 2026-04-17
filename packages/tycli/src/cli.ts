import './node-shims.ts'

import { createInterface } from 'node:readline/promises'
import { emitKeypressEvents } from 'node:readline'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import process from 'node:process'
import { createDuplexChannel } from '../../shared/modules/frpBus.ts'
import { createTaskNode } from '../../taskyon/src/core/createTasks.ts'
import { tyCore } from '../../taskyon/src/core/init.ts'
import type { Taskyon } from '../../taskyon/src/core/init.ts'
import { isTaskyonKey } from '../../taskyon/src/core/tyCrypto.ts'
import { TOKEN_SERVICE_BASE_URL } from '../../taskyon/src/taskyon.space/tokenservice.types.ts'
import type { TaskyonMessage } from '../../taskyon/src/types/apiTypes.ts'
import type { RemoteFunctionCall } from '../../taskyon/src/types/messages.ts'
import type { llmSettings } from '../../taskyon/src/types/profiles.ts'
import type {
  partialTaskDraft,
  TaskContentType,
  TaskNode,
} from '../../taskyon/src/types/taskNode.ts'
import { createTool, makeTaskResult, toolCall } from '../../taskyon/src/types/toolApi.ts'
import { createCryptoSession } from '../../taskyon/src/utils/cryptoSession.ts'
import { serializeObject } from '../../shared/modules/serializeObject.ts'
import { formatExplorationContext, createExplorationTool } from './tools/explorationTool.ts'
import { updateFilesTool } from './tools/patchTool.ts'

type StoredConfig = {
  deviceKeyPairJwk?: {
    privateJwk: JsonWebKey
    publicJwk: JsonWebKey
  }
  selectedApi?: string
  taskyonModel?: string
  wrappedSessionKey?: string
}

type CliApiConfig = {
  key?: string
  model?: string
  selectedApi: string
}

type BashToolArgs = {
  command?: string
  cwd?: string
  timeoutMs?: number
}

type SlashParsed = {
  name: string
  args: string
}

type ChatCompletionTaskArgs = {
  allowedTools: string[]
  goal?: 'SimpleCompletion' | 'ChooseTool'
  prompts?: string[]
}

type LlmModel = {
  id: string
  architecture?: { modality?: string }
  pricing?: { prompt?: string; completion?: string }
}

const PREFERRED_CONFIG_DIR = join(homedir(), '.config', 'tycli')
const FALLBACK_CONFIG_DIR = join('/tmp', 'tycli')
const API_KEY_STORE_NAME = 'AiProviderKey'
const SUPPORTED_PROVIDERS = ['openai', 'openrouter.ai', 'taskyon', 'local'] as const
let cachedConfigFile: string | null = null
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
const ENABLE_DEBUG_LOGS = process.env.TYCLI_DEBUG === '1'
const MAX_MODEL_OPTIONS = 10

function writeLine(text: string) {
  process.stdout.write(`${text}\n`)
}

function writeError(text: string) {
  process.stderr.write(`${text}\n`)
}

function writeDebug(text: string) {
  if (!ENABLE_DEBUG_LOGS) return
  process.stderr.write(`[debug] ${text}\n`)
}

function writeDebugYaml(label: string, value: unknown) {
  if (!ENABLE_DEBUG_LOGS) return
  const dumped = serializeObject(value, {
    format: 'yaml',
    maxDepth: 5,
    maxArrayLength: 12,
    maxObjectKeys: 30,
    maxStringLength: 300,
    includeTruncationMeta: true,
  }).trim()
  process.stderr.write(`[debug] ${label}\n${dumped}\n`)
}

process.title = 'tycli'

function maskKey(key: string | undefined): string {
  if (!key) return 'missing'
  if (key.length <= 6) return '******'
  return `***${key.slice(-4)}`
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

async function resolveConfigFilePath() {
  if (cachedConfigFile) return cachedConfigFile
  try {
    await mkdir(PREFERRED_CONFIG_DIR, { recursive: true })
    cachedConfigFile = join(PREFERRED_CONFIG_DIR, 'config.json')
    return cachedConfigFile
  } catch {
    await mkdir(FALLBACK_CONFIG_DIR, { recursive: true })
    cachedConfigFile = join(FALLBACK_CONFIG_DIR, 'config.json')
    return cachedConfigFile
  }
}

async function resolveConfigDirectoryPath() {
  const configFile = await resolveConfigFilePath()
  return dirname(configFile)
}

async function loadStoredConfig(): Promise<StoredConfig> {
  try {
    const configFile = await resolveConfigFilePath()
    const raw = await readFile(configFile, 'utf8')
    const parsed = JSON.parse(raw) as StoredConfig
    return parsed ?? {}
  } catch {
    return {}
  }
}

async function saveStoredConfig(next: StoredConfig) {
  const configFile = await resolveConfigFilePath()
  await mkdir(dirname(configFile), { recursive: true })
  await writeFile(configFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

async function persistConfigPatch(patch: Partial<StoredConfig>) {
  const current = await loadStoredConfig()
  await saveStoredConfig({ ...current, ...patch })
}

async function importDeviceKeyPair(
  jwk: NonNullable<StoredConfig['deviceKeyPairJwk']>,
): Promise<CryptoKeyPair> {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk.privateJwk,
    { name: 'X25519' },
    true,
    ['deriveKey', 'deriveBits'],
  )
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk.publicJwk,
    { name: 'X25519' },
    true,
    [],
  )
  return { privateKey, publicKey }
}

async function exportDeviceKeyPair(keyPair: CryptoKeyPair) {
  if (!keyPair.privateKey.extractable || !keyPair.publicKey.extractable) {
    throw new Error('Device key pair is not extractable')
  }
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey)
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey)
  return { privateJwk, publicJwk }
}

async function createPersistableDeviceKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey({ name: 'X25519' }, true, [
    'deriveKey',
    'deriveBits',
  ])) as CryptoKeyPair
}

async function initPersistentCryptoSession() {
  const stored = await loadStoredConfig()
  const persistedDevice = stored.deviceKeyPairJwk
    ? await importDeviceKeyPair(stored.deviceKeyPairJwk)
    : await createPersistableDeviceKeyPair()

  const cs = await createCryptoSession({
    deviceKeyPair: persistedDevice,
    wrappedSK: stored.wrappedSessionKey,
  })

  let exported: Awaited<ReturnType<typeof exportDeviceKeyPair>>
  try {
    exported = await exportDeviceKeyPair(cs.getDeviceKey())
  } catch {
    const freshPair = await createPersistableDeviceKeyPair()
    const refreshed = await createCryptoSession({
      deviceKeyPair: freshPair,
      wrappedSK: stored.wrappedSessionKey,
    })
    exported = await exportDeviceKeyPair(refreshed.getDeviceKey())
    const wrappedSessionKey = await refreshed.exportSessionKey()
    await saveStoredConfig({
      ...stored,
      deviceKeyPairJwk: exported,
      wrappedSessionKey,
    })
    return { cryptoSession: refreshed, stored }
  }
  const wrappedSessionKey = await cs.exportSessionKey()
  await saveStoredConfig({
    ...stored,
    deviceKeyPairJwk: exported,
    wrappedSessionKey,
  })

  return { cryptoSession: cs, stored }
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
const ACTIVE_LLM_TOOLS = [cliBashTool.name, 'exploration', updateFilesTool.name] as const

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
    '1. Prefer answering directly when no shell action is needed.',
    '2. Use the bash tool only when command execution is required to answer correctly.',
    '3. Keep destructive or risky shell commands clearly justified and minimal.',
  ].join('\n')
}

function renderTaskProgressLine(task: TaskNode): string | null {
  if (task.content.type === 'functioncall') {
    const name = task.content.data.name
    return `[tool call] ${name}`
  }
  if (task.content.type === 'toolresult') {
    const toolName = task.content.data.name ?? 'tool'
    return `[tool result] ${toolName}`
  }
  if (task.content.type === 'error') {
    return `[error] ${String(task.content.data?.message ?? 'task error')}`
  }
  return null
}

function summarizeTask(task: TaskNode): string {
  const role = task.role ?? 'unknown'
  if (task.content.type === 'functioncall') {
    return `[${role}|functioncall]\n${serializeObject(task.content.data, {
      format: 'yaml',
      maxDepth: 5,
      maxArrayLength: 12,
      maxObjectKeys: 30,
      maxStringLength: 300,
      includeTruncationMeta: true,
    }).trim()}`
  }
  if (task.content.type === 'toolresult') {
    return `[${role}|toolresult]\n${serializeObject(task.content.data, {
      format: 'yaml',
      maxDepth: 5,
      maxArrayLength: 12,
      maxObjectKeys: 30,
      maxStringLength: 300,
      includeTruncationMeta: true,
    }).trim()}`
  }
  if (task.content.type === 'message') {
    const txt = String(task.content.data ?? '')
    return `[${role}|message] ${txt}`
  }
  if (task.content.type === 'error') {
    return `[${role}|error]\n${serializeObject(task.content.data, {
      format: 'yaml',
      maxDepth: 5,
      maxArrayLength: 12,
      maxObjectKeys: 30,
      maxStringLength: 300,
      includeTruncationMeta: true,
    }).trim()}`
  }
  return `[${role}|${task.content.type}]`
}

function summarizeWorkerEvent(event: {
  stage: string
  taskId?: string | null
  task?: TaskNode | null
  info?: string
}): string {
  const taskId = event.task?.id ?? event.taskId ?? 'n/a'
  const toolName =
    event.task?.content.type === 'functioncall' ? event.task.content.data.name : undefined
  const info = event.info ? ` info=${event.info}` : ''
  const tool = toolName ? ` tool=${toolName}` : ''
  return `stage=${event.stage} task=${taskId}${tool}${info}`
}

const baseApiDefinitions: NonNullable<llmSettings['llmApis']> = {
  taskyon: {
    name: 'taskyon',
    baseURL: 'https://share.taskyon.space',
    defaultModel: 'google/gemini-2.5-flash-lite',
    streamSupport: true,
    defaultHeaders: {
      apiKey: 'sb_publishable_WrQ1aIRvl9BrMtpMQ9TocQ_JN7I9kJm',
    },
    routes: {
      chatCompletion: '/chatCompletion/api/v1/',
      models: '/chatCompletion/api/v1/models',
    },
  },
  openai: {
    name: 'openai',
    baseURL: 'https://api.openai.com',
    defaultModel: 'gpt-5.1',
    streamSupport: true,
    routes: {
      chatCompletion: '/v1/',
      models: '/v1/models',
    },
  },
  'openrouter.ai': {
    name: 'openrouter.ai',
    baseURL: 'https://openrouter.ai',
    defaultModel: 'google/gemini-2.5-flash-lite',
    streamSupport: true,
    routes: {
      chatCompletion: '/api/v1/',
      models: '/api/v1/models',
    },
  },
  local: {
    name: 'local LLM server',
    baseURL: 'http://localhost:8080',
    defaultModel: 'qwen3-4b',
    streamSupport: true,
    routes: {
      chatCompletion: '/v1/',
      models: '/v1/models',
    },
  },
}

function resolveProviderSelection(stored: StoredConfig): string {
  const explicitApi = process.env.TASKYON_SELECTED_API
  if (explicitApi) return explicitApi
  if (stored.selectedApi) return stored.selectedApi
  if (process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.OPENROUTER_API_KEY) return 'openrouter.ai'
  if (process.env.TASKYON_API_KEY) return 'taskyon'
  return 'local'
}

function resolveKeyForProvider(provider: string): string | undefined {
  if (provider === 'openai') return process.env.TASKYON_OPENAI_API_KEY ?? process.env.OPENAI_API_KEY
  if (provider === 'openrouter.ai') {
    return process.env.TASKYON_OPENROUTER_API_KEY ?? process.env.OPENROUTER_API_KEY
  }
  if (provider === 'taskyon') return process.env.TASKYON_API_KEY
  if (provider === 'local') return process.env.TASKYON_LOCAL_API_KEY ?? 'local'
  return undefined
}

function createCliLlmSettings(config: CliApiConfig): llmSettings {
  const selectedApiConfig = baseApiDefinitions[config.selectedApi]
  return {
    selectedApi: config.selectedApi,
    llmApis: {
      ...baseApiDefinitions,
      [config.selectedApi]: {
        ...selectedApiConfig,
        ...(config.model ? { selectedModel: config.model } : {}),
      },
    },
    siteUrl: 'https://tycli.local',
    summaryModel: 'Xenova/distilbart-cnn-6-6',
    vectorizationModel: undefined,
    maxAutonomousTasks: 5,
    enableToolChooser: true,
  }
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

function fuzzyFilterModelOptions(
  query: string,
  options: { label: string; value: string }[],
): { label: string; value: string }[] {
  const keyword = query.toLowerCase().trim()
  if (!keyword) return options.slice(0, MAX_MODEL_OPTIONS)
  const threshold = 0.7 * 1.1
  const maxLen = (x: string, y: string) => (x.length > y.length ? x.length : y.length)
  return options
    .map((option) => {
      const optionValue = option.value.toLowerCase()
      const distance = levenshteinDistance(keyword, optionValue)
      const matches = maxLen(keyword, optionValue) - distance
      const score =
        matches / keyword.length +
        ((0.1 * keyword.length) / optionValue.length) * (matches / optionValue.length)
      return { ...option, score }
    })
    .filter((option) => option.score > threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MODEL_OPTIONS)
    .map(({ label, value }) => ({ label, value }))
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path
  const left = base.replace(/\/+$/, '')
  const right = path.replace(/^\/+/, '')
  return `${left}/${right}`
}

async function fetchProviderModels(
  provider: string,
  api: NonNullable<llmSettings['llmApis']>[string],
  key: string,
): Promise<Record<string, LlmModel>> {
  let modelsUrl = joinUrl(api.baseURL, api.routes.models)
  if (provider === 'openrouter.ai') modelsUrl = `${TOKEN_SERVICE_BASE_URL}/api/models_openrouter`
  if (provider === 'taskyon') modelsUrl = `${TOKEN_SERVICE_BASE_URL}/api/models`
  const response = await fetch(modelsUrl, {
    method: 'GET',
    headers: {
      ...(api.defaultHeaders ?? {}),
      Authorization: `Bearer ${key}`,
      'Cache-Control': 'no-cache',
    },
  })
  if (!response.ok) throw new Error(`Failed to fetch models (${response.status}) from ${modelsUrl}`)
  const raw = (await response.json()) as { data?: LlmModel[] } | LlmModel[]
  const list = Array.isArray(raw) ? raw : (raw.data ?? [])
  return list.reduce<Record<string, LlmModel>>((acc, m) => {
    if (m?.id) acc[m.id] = m
    return acc
  }, {})
}

function getAllowedTaskyonModels(key: string | undefined): string[] | undefined {
  const parsed = isTaskyonKey(key, false)
  if (!parsed || !parsed.model || parsed.model.length <= 0 || parsed.model.includes('*'))
    return undefined
  return parsed.model
}

function modelOptionsForProvider(
  provider: string,
  modelMap: Record<string, LlmModel>,
  allowedModels?: string[],
  onlyVision = false,
): { label: string; value: string }[] {
  const all = Object.values(modelMap)
  if (provider === 'openai') {
    return all.sort((a, b) => a.id.localeCompare(b.id)).map((m) => ({ label: m.id, value: m.id }))
  }
  let filtered = all
  if (allowedModels) filtered = filtered.filter((m) => allowedModels.includes(m.id))
  if (onlyVision) filtered = filtered.filter((m) => m.architecture?.modality === 'text+image->text')
  return filtered
    .map((m) => {
      const p = Number.parseFloat(m.pricing?.prompt || '')
      const c = Number.parseFloat(m.pricing?.completion || '')
      const total = (Number.isFinite(p) ? p : 0) + (Number.isFinite(c) ? c : 0)
      return { m, total }
    })
    .sort((a, b) => a.total - b.total)
    .map(({ m }) => ({
      label: `${m.architecture?.modality === 'text+image->text' ? '[vision] ' : ''}${m.id}`,
      value: m.id,
    }))
}

async function canReachLocalApi(baseUrl: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1500)
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/models`, {
      method: 'GET',
      signal: controller.signal,
    })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function createChatCompletionTask(args: ChatCompletionTaskArgs) {
  const { allowedTools, goal = 'SimpleCompletion', prompts = [] } = args
  return toolCall({
    name: 'chatCompletion',
    arguments: {
      goal,
      allowedTools,
      prompts,
      llmTools: true,
      use_baseprompt: true,
      prompt_templates: DEFAULT_PROMPT_TEMPLATES,
      reasoning_effort: 'low',
    },
  })
}

function isTaskCreatedMessage(
  msg: TaskyonMessage,
): msg is Extract<TaskyonMessage, { type: 'taskCreated' }> & { task: TaskNode } {
  return msg.type === 'taskCreated' && !!msg.task
}

function isRemoteFunctionCall(msg: TaskyonMessage): msg is RemoteFunctionCall {
  return msg.type === 'functionCall'
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
  quitCondition: TaskContentType | TaskContentType[],
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

function renderTask(task: TaskNode): string {
  switch (task.content.type) {
    case 'message':
      return task.content.data
    case 'structured':
    case 'toolresult':
    case 'error':
      return JSON.stringify(task.content.data, null, 2)
    case 'return':
      return task.content.data
    default:
      return JSON.stringify(task.content, null, 2)
  }
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
) {
  writeLine(title)
  options.forEach((option, idx) => writeLine(`${idx + 1}. ${option}`))
  const answerRaw = await askQuestion(rl, 'Select: ')
  if (answerRaw === null) return null
  const answer = answerRaw.trim()
  const num = Number(answer)
  if (!Number.isInteger(num) || num < 1 || num > options.length) return null
  return num - 1
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

async function setSelectedApi(ty: Taskyon, nextApi: string) {
  await persistConfigPatch({ selectedApi: nextApi })
  const key =
    (await ty.getSecret(API_KEY_STORE_NAME, nextApi, false, false)) ??
    resolveKeyForProvider(nextApi)
  await ty.updateChatCompletionApiKey(nextApi, key ?? undefined)
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
  writeLine(`Current provider: ${llmState.selectedApi}`)
  writeLine(
    `Current model: ${llmState.llmApis[llmState.selectedApi]?.selectedModel ?? llmState.llmApis[llmState.selectedApi]?.defaultModel ?? 'unknown'}`,
  )
  const action = await selectFromList(rl, '\nModel menu', [
    'change provider',
    'select model from provider list',
    'set model id manually',
    'back',
  ])
  if (action === null || action === 3) return

  if (action === 0) {
    const idx = await selectFromList(rl, '\nSelect provider', [...SUPPORTED_PROVIDERS])
    if (idx === null) return
    const nextApi = SUPPORTED_PROVIDERS[idx]!
    llmState.selectedApi = nextApi
    await setSelectedApi(ty, nextApi)
    writeLine(`Selected provider: ${nextApi}`)
    return
  }

  if (action === 1) {
    const selectedApi = llmState.selectedApi
    const api = llmState.llmApis[selectedApi]
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
    llmState.llmApis[selectedApi] = {
      ...llmState.llmApis[selectedApi],
      selectedModel: model,
    }
    await persistConfigPatch({ taskyonModel: model })
    writeLine(`Selected model for ${selectedApi}: ${model}`)
    return
  }

  if (action === 2) {
    const modelInput = await askQuestion(rl, 'Enter model id: ')
    if (modelInput === null) return
    const model = modelInput.trim()
    if (!model) {
      writeError('Model id cannot be empty.')
      return
    }
    const selectedApi = llmState.selectedApi
    llmState.llmApis[selectedApi] = {
      ...llmState.llmApis[selectedApi],
      selectedModel: model,
    }
    await persistConfigPatch({ taskyonModel: model })
    writeLine(`Selected model for ${selectedApi}: ${model}`)
  }
}

async function handleToolsCommand(ty: Taskyon) {
  const all = await ty.updateToolDefinitions(true)
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

async function handleSlashCommand(
  parsed: SlashParsed,
  rl: ReturnType<typeof createInterface>,
  ty: Taskyon,
  llmState: llmSettings,
): Promise<boolean> {
  if (parsed.name === 'keys') {
    await handleKeysCommand(rl, ty, llmState)
    return true
  }

  if (parsed.name === 'model') {
    await handleModelCommand(rl, ty, llmState)
    return true
  }

  if (parsed.name === 'tools') {
    await handleToolsCommand(ty)
    return true
  }

  if (parsed.name === 'exit' || parsed.name === 'quit') {
    return false
  }

  writeError(`Unknown command '/${parsed.name}'. Supported: /keys, /model, /tools, /exit, /quit`)
  return true
}

async function main() {
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
  const config: CliApiConfig = {
    selectedApi,
    model,
    key: resolveKeyForProvider(selectedApi),
  }
  const explorationContextFiles: Record<string, string> = {}
  const explorationTool = createExplorationTool(explorationContextFiles)

  let llmState = createCliLlmSettings(config)
  const cliEntryNodeTool = createTool({
    name: ENTRY_NODE_TOOL_NAME,
    description:
      'CLI entry node that injects terminal/system context and delegates to chatCompletion.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        toolResultSection: {
          type: 'string',
          description: 'Internal tool result summary routed back to entryNode.',
        },
      },
    } as const,
    renderOptions: { hideLlm: true, hideChat: false },
    function: ({ toolResultSection }: { toolResultSection?: string } = {}) =>
      makeTaskResult([
        createChatCompletionTask({
          goal: 'ChooseTool',
          allowedTools: [...ACTIVE_LLM_TOOLS],
          prompts: [
            buildCliEnvironmentContext(
              toolResultSection || '(none)',
              formatExplorationContext(explorationContextFiles),
            ),
          ],
        }),
      ]),
  })
  llmState = {
    ...llmState,
    entryNode: toolCall({
      name: ENTRY_NODE_TOOL_NAME,
      arguments: {},
    }),
  }
  const taskyon = await tyCore(
    () => llmState,
    () => ({
      chatCompletion: {
        llmTools: true,
      },
    }),
    [cliEntryNodeTool, explorationTool, updateFilesTool],
    cryptoSession,
    {
      nodePgLiteDataDir: pgliteNodeDir,
    },
  )

  const persistedKey = await taskyon.getSecret(API_KEY_STORE_NAME, selectedApi, false, false)
  const bootstrapKey = persistedKey ?? config.key
  if (bootstrapKey) {
    await taskyon.setSecret(API_KEY_STORE_NAME, selectedApi, bootstrapKey)
    await taskyon.updateChatCompletionApiKey(selectedApi, bootstrapKey)
  }

  if (llmState.selectedApi === 'local') {
    const localApi = llmState.llmApis.local
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
          'Warning: local provider selected but http://localhost:8080 is unreachable. Configure a provider via /keys and switch with /model.',
        )
      }
    }
  }

  const { x: clientPort, y: bridgePort } = createDuplexChannel<TaskyonMessage, TaskyonMessage>()
  const unsubscribeBridgeToTaskyon = bridgePort.receive((msg) => taskyon.port.send(msg))
  const unsubscribeTaskyonToBridge = taskyon.port.receive((msg) => bridgePort.send(msg))

  const unsubscribeFunctionCalls = clientPort.receive(async (msg) => {
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

  clientPort.send({ type: 'functionDescription', ...cliBashTool })

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let currentLeafId: string | undefined
  let waitingForTask = false
  let interruptedCurrentTask = false
  let requestQuitOnNextPrompt = false
  let inMenuInteraction = false
  let thinkingLines: string[] = []
  let thinkingPanelHeight = 0
  const taskFeed: TaskNode[] = []
  const taskSnapshotById = new Map<string, string>()

  const clearThinkingPanel = () => {
    if (thinkingPanelHeight <= 0) return
    for (let i = 0; i < thinkingPanelHeight; i += 1) {
      process.stdout.write('\x1b[1A\x1b[2K')
    }
    thinkingPanelHeight = 0
  }

  const resetThinking = () => {
    clearThinkingPanel()
    thinkingLines = []
  }

  const renderThinkingPanel = () => {
    if (!waitingForTask) return
    const recent = thinkingLines.slice(-5)
    clearThinkingPanel()
    if (recent.length <= 0) return
    const panel = ['[thinking]', ...recent.map((line) => `  ${line}`)]
    process.stdout.write(`${panel.join('\n')}\n`)
    thinkingPanelHeight = panel.length
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

  const onSigint = () => {
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
  process.on('SIGINT', onSigint)
  const unsubscribeThinkingStream = taskyon.chatCompletionStream(({ chunk }) => {
    if (!waitingForTask) return
    appendThinkingText(normalizeThinkingChunk(chunk))
  })
  const unsubscribeTaskProgress = clientPort.receive((msg) => {
    if (!isTaskCreatedMessage(msg)) return
    const task = msg.task
    const snapshot = JSON.stringify(task.content)
    const prev = taskSnapshotById.get(task.id)
    if (prev === snapshot) return
    taskSnapshotById.set(task.id, snapshot)
    const existingIdx = taskFeed.findIndex((t) => t.id === task.id)
    if (existingIdx >= 0) taskFeed[existingIdx] = task
    else taskFeed.push(task)
    const line = summarizeTask(task)
    clearThinkingPanel()
    writeLine(prev ? `[task updated] ${line}` : `[task] ${line}`)
    if (ENABLE_DEBUG_LOGS && task.content.type === 'functioncall') {
      writeDebugYaml(`toolcall ${task.content.data.name}`, task.content.data)
    }
    if (ENABLE_DEBUG_LOGS && task.content.type === 'toolresult') {
      writeDebugYaml('toolresult', task.content.data)
    }
    if (ENABLE_DEBUG_LOGS && task.content.type === 'error') {
      writeDebugYaml('error', task.content.data)
    }
    renderThinkingPanel()
  })
  const unsubscribeWorkerProgress = taskyon.workerStream((event) => {
    const shouldPrintInNormalMode =
      event.stage === 'queued' ||
      event.stage === 'processing' ||
      event.stage === 'processed' ||
      event.stage === 'error' ||
      event.stage === 'aborted'
    if (!ENABLE_DEBUG_LOGS && !shouldPrintInNormalMode) return
    clearThinkingPanel()
    writeLine(`[worker] ${summarizeWorkerEvent(event)}`)
    if (ENABLE_DEBUG_LOGS) writeDebugYaml('worker event', event)
    renderThinkingPanel()
  })

  writeLine(
    `tycli ready. provider=${llmState.selectedApi} model=${llmState.llmApis[llmState.selectedApi]?.selectedModel ?? baseApiDefinitions[llmState.selectedApi]?.defaultModel}`,
  )
  writeLine('Slash commands: /keys, /model, /tools, /exit, /quit')
  if (ENABLE_DEBUG_LOGS) writeLine('Debug logs enabled (TYCLI_DEBUG=1).')

  try {
    while (true) {
      let input = ''
      inMenuInteraction = false
      if (requestQuitOnNextPrompt) {
        const answerRaw = await askQuestion(rl, '> ')
        requestQuitOnNextPrompt = false
        if (answerRaw === null) continue
        const answer = answerRaw.trim().toLowerCase()
        if (answer === 'y' || answer === 'yes') break
        continue
      }
      const inputRaw = await askQuestion(rl, '\n> ')
      if (inputRaw === null) {
        if (isReadlineClosed(rl)) break
        continue
      }
      input = inputRaw.trim()
      if (!input) continue

      const parsed = parseSlashName(input)
      if (parsed) {
        inMenuInteraction = true
        const keepRunning = await handleSlashCommand(parsed, rl, taskyon, llmState)
        inMenuInteraction = false
        if (!keepRunning) break
        continue
      }

      if (!(await taskyon.getSecret(API_KEY_STORE_NAME, llmState.selectedApi, false, false))) {
        writeError(`No key configured for '${llmState.selectedApi}'. Run /keys first.`)
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

      clientPort.send({ type: 'tasks', tasks: taskChain, execute: true, show: true })
      writeDebug(`queued task chain: ${taskChain.map((task) => task.id).join(', ')}`)
      activeTaskIds = new Set(taskChain.map((task) => task.id))

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
          continue
        }
        currentLeafId = result.id
        writeDebug(`received result task: ${result.id} (${result.content.type})`)
        writeLine(`\n${renderTask(result)}`)
      } catch (error) {
        waitingForTask = false
        clearThinkingPanel()
        if (interruptedCurrentTask) {
          writeLine('Task interrupted.')
          continue
        }
        writeError(error instanceof Error ? error.message : String(error))
      }
    }
  } finally {
    process.off('SIGINT', onSigint)
    unsubscribeThinkingStream()
    unsubscribeTaskProgress()
    unsubscribeWorkerProgress()
    rl.close()
    unsubscribeFunctionCalls()
    unsubscribeBridgeToTaskyon()
    unsubscribeTaskyonToBridge()
    taskyon.workerStop('tycli exit')
  }
}

void main().catch((error) => {
  writeError(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exitCode = 1
})
let activeTaskIds = new Set<string>()
