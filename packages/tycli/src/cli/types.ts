import type { EncryptedDataRow } from '../../../taskyon/src/utils/encrypt'

export type StoredConfig = {
  storage?: {
    records?: 'files' | 'sqlite' | 'pglite'
    blobs?: 'files' | 'sqlite' | 'pglite'
  }
  cliSecrets?: Record<string, EncryptedDataRow>
  deviceKeyPairJwk?: {
    privateJwk: JsonWebKey
    publicJwk: JsonWebKey
  }
  providerModels?: Record<string, string>
  selectedApi?: string
  taskyonModel?: string
  inputHistory?: string[]
  sessions?: TycliSessionRecord[]
  wrappedSessionKey?: string
  cliUi?: {
    showRoleTag?: boolean
    searchOpenMode?: 'conversation' | 'lineage'
    vectorizer?: 'static-multilingual' | 'transformer-minilm'
  }
}

export type TycliSessionRecord = {
  conversationPath: string
  logPath: string
  startedAt: string
  endedAt?: string
}

export type CliApiConfig = {
  key?: string
  model?: string
  selectedApi: string
}

export const API_KEY_STORE_NAME = 'AiProviderKey'

export type BashToolArgs = {
  command?: string
  cwd?: string
  timeoutMs?: number
}

export type SlashParsed = {
  name: string
  args: string
}

export type ChatCompletionTaskArgs = {
  allowedTools: string[]
  goal?: 'SimpleCompletion' | 'ChooseTool'
  appendSystemPrompts?: string[]
}

export type LlmModel = {
  id: string
  architecture?: { modality?: string }
  pricing?: { prompt?: string; completion?: string }
}

export const SUPPORTED_PROVIDERS = [
  'openai',
  'openrouter.ai',
  'taskyon',
  'local',
  'chatgpt-codex',
] as const
export const MAX_MODEL_OPTIONS = 10
export const SLASH_COMMANDS = [
  'keys',
  'provider',
  'model',
  'tools',
  'debug',
  'settings',
  'client',
  'resume',
  'search',
  'tree',
  'stop',
  'exit',
  'quit',
] as const
