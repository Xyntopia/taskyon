export type StoredConfig = {
  deviceKeyPairJwk?: {
    privateJwk: JsonWebKey
    publicJwk: JsonWebKey
  }
  providerModels?: Record<string, string>
  selectedApi?: string
  taskyonModel?: string
  wrappedSessionKey?: string
  cliUi?: {
    showRoleTag?: boolean
  }
}

export type CliApiConfig = {
  key?: string
  model?: string
  selectedApi: string
}

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
  prompts?: string[]
}

export type LlmModel = {
  id: string
  architecture?: { modality?: string }
  pricing?: { prompt?: string; completion?: string }
}

export const API_KEY_STORE_NAME = 'AiProviderKey'
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
  'exit',
  'quit',
] as const
