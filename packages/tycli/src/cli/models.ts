import {
  TOKEN_SERVICE_BASE_URL,
  chatCompletionProviderSettings,
  isTaskyonKey,
  resolveToolchainConfig,
  type ChatCompletionProviderSettings,
  type ToolchainProfiles,
  type llmSettings,
} from '@taskyon/taskyon'
import { asyncTimeLruCache } from '@taskyon/taskyon/utils/caching'
import type { CliApiConfig, LlmModel } from './types'

export const DEFAULT_PROMPT_TEMPLATES = {
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

const CODEX_MODELS_CLIENT_VERSION = '0.144.5'

export const baseProviderProfiles: Record<string, ChatCompletionProviderSettings> = {
  taskyon: {
    provider: 'taskyon',
    name: 'taskyon',
    baseURL: 'https://share.taskyon.space',
    model: 'google/gemini-2.5-flash-lite',
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
    provider: 'openai',
    name: 'openai',
    baseURL: 'https://api.openai.com',
    model: 'gpt-5.1',
    streamSupport: true,
    routes: {
      chatCompletion: '/v1/',
      models: '/v1/models',
    },
  },
  'chatgpt-codex': {
    provider: 'chatgpt-codex',
    name: 'chatgpt-codex',
    baseURL: 'https://chatgpt.com/backend-api/codex',
    model: 'gpt-5.4',
    streamSupport: true,
    auth: {
      type: 'oauth',
      oauth: {
        authorizationUrl: 'https://auth.openai.com/oauth/authorize',
        tokenUrl: 'https://auth.openai.com/oauth/token',
        clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
        scope: 'openid profile email offline_access',
        authorizeQuery: {
          id_token_add_organizations: 'true',
          codex_cli_simplified_flow: 'true',
        },
      },
    },
    routes: {
      chatCompletion: '/responses',
      models: '/models',
    },
  },
  'openrouter.ai': {
    provider: 'openrouter.ai',
    name: 'openrouter.ai',
    baseURL: 'https://openrouter.ai',
    model: 'google/gemini-2.5-flash-lite',
    streamSupport: true,
    routes: {
      chatCompletion: '/api/v1/',
      models: '/api/v1/models',
    },
  },
  local: {
    provider: 'local',
    name: 'local LLM server',
    baseURL: 'http://localhost:8080',
    model: 'qwen3-4b',
    streamSupport: true,
    routes: {
      chatCompletion: '/v1/',
      models: '/v1/models',
    },
  },
}

export type CliLlmState = {
  settings: llmSettings
  toolchainProfiles: ToolchainProfiles
  selectedToolchainProfile: string
}

export type CliProviderIdentity = {
  referer: string
  title: string
}

const TASKYON_CLI_PROVIDER_IDENTITY: CliProviderIdentity = {
  referer: 'https://tycli.local',
  title: 'tycli',
}

export function createCliLlmState(
  config: CliApiConfig,
  providerIdentity: CliProviderIdentity = TASKYON_CLI_PROVIDER_IDENTITY,
): CliLlmState {
  const selectedProviderSettings = baseProviderProfiles[config.selectedApi]
  if (!selectedProviderSettings) {
    throw new Error(`Unsupported provider: ${config.selectedApi}`)
  }
  return {
    settings: {
      entryFunction: 'entryNode',
    },
    toolchainProfiles: {
      base: {},
      profiles: Object.fromEntries(
        Object.entries(baseProviderProfiles).map(([provider, settings]) => [
          provider,
          {
            chatCompletion: {
              ...settings,
              ...(['taskyon', 'openrouter.ai'].includes(provider)
                ? {
                    defaultHeaders: {
                      ...(settings.defaultHeaders ?? {}),
                      'HTTP-Referer': providerIdentity.referer,
                      'X-Title': providerIdentity.title,
                    },
                  }
                : {}),
              ...(provider === config.selectedApi && config.model ? { model: config.model } : {}),
            },
          },
        ]),
      ),
    },
    selectedToolchainProfile: config.selectedApi,
  }
}

export const getProviderSettings = (llmState: CliLlmState, provider: string) => {
  const settings = llmState.toolchainProfiles.profiles[provider]?.chatCompletion
  return settings ? chatCompletionProviderSettings.parse(settings) : undefined
}

export const getSelectedProviderSettings = (llmState: CliLlmState) =>
  chatCompletionProviderSettings.parse(getSelectedToolchainConfig(llmState).chatCompletion)

export const getSelectedToolchainConfig = (llmState: CliLlmState) =>
  resolveToolchainConfig(llmState.toolchainProfiles, llmState.selectedToolchainProfile)

export const setSelectedProvider = (llmState: CliLlmState, provider: string) => {
  if (!getProviderSettings(llmState, provider)) throw new Error(`Unknown provider: ${provider}`)
  llmState.selectedToolchainProfile = provider
}

export const setProviderModel = (llmState: CliLlmState, provider: string, model: string) => {
  const profile = llmState.toolchainProfiles.profiles[provider]
  const settings = getProviderSettings(llmState, provider)
  if (!profile || !settings) throw new Error(`Unknown provider: ${provider}`)
  llmState.toolchainProfiles.profiles[provider] = {
    ...profile,
    chatCompletion: { ...settings, model },
  }
}

export function applyCodexAccountHeader(
  llmState: CliLlmState,
  accountId: string | undefined,
): void {
  const codexProfile = llmState.toolchainProfiles.profiles['chatgpt-codex']
  const codexSettings = getProviderSettings(llmState, 'chatgpt-codex')
  if (!codexProfile || !codexSettings) return
  const nextHeaders = { ...(codexSettings.defaultHeaders ?? {}) }
  if (accountId) nextHeaders['ChatGPT-Account-Id'] = accountId
  else delete nextHeaders['ChatGPT-Account-Id']
  llmState.toolchainProfiles.profiles['chatgpt-codex'] = {
    ...codexProfile,
    chatCompletion: {
      ...codexSettings,
      defaultHeaders: nextHeaders,
    },
  }
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path
  const left = base.replace(/\/+$/, '')
  const right = path.replace(/^\/+/, '')
  return `${left}/${right}`
}

type ProviderModelsResponse =
  | LlmModel[]
  | {
      data?: LlmModel[]
      models?: Array<{ slug: string; input_modalities?: string[] }>
    }

async function fetchProviderModelsUncached(
  provider: string,
  api: ChatCompletionProviderSettings,
  key: string,
  forceRefresh = false,
): Promise<Record<string, LlmModel>> {
  let modelsUrl = joinUrl(api.baseURL, api.routes.models)
  if (provider === 'openrouter.ai') modelsUrl = `${TOKEN_SERVICE_BASE_URL}/api/models_openrouter`
  if (provider === 'taskyon') modelsUrl = `${TOKEN_SERVICE_BASE_URL}/api/models`
  if (provider === 'chatgpt-codex' || forceRefresh) {
    const url = new URL(modelsUrl)
    if (provider === 'chatgpt-codex') {
      url.searchParams.set('client_version', CODEX_MODELS_CLIENT_VERSION)
    }
    if (forceRefresh) url.searchParams.set('_', String(Date.now()))
    modelsUrl = url.toString()
  }
  const response = await fetch(modelsUrl, {
    method: 'GET',
    headers: {
      ...(api.defaultHeaders ?? {}),
      Authorization: `Bearer ${key}`,
      'Cache-Control': 'no-cache',
    },
  })
  if (!response.ok) throw new Error(`Failed to fetch models (${response.status}) from ${modelsUrl}`)
  const raw = (await response.json()) as ProviderModelsResponse
  const list = Array.isArray(raw)
    ? raw
    : provider === 'chatgpt-codex'
      ? (raw.models ?? []).map((model) => ({
          id: model.slug,
          ...(model.input_modalities?.includes('image')
            ? { architecture: { modality: 'text+image->text' } }
            : {}),
        }))
      : (raw.data ?? [])
  return list.reduce<Record<string, LlmModel>>((acc, m) => {
    if (m?.id) acc[m.id] = m
    return acc
  }, {})
}

const fetchCachedProviderModels = asyncTimeLruCache(10, 5 * 60 * 1000)(fetchProviderModelsUncached)

export async function fetchProviderModels(
  provider: string,
  api: ChatCompletionProviderSettings,
  key: string,
  options: { forceRefresh?: boolean } = {},
): Promise<Record<string, LlmModel>> {
  if (options.forceRefresh) return await fetchProviderModelsUncached(provider, api, key, true)
  return await fetchCachedProviderModels(provider, api, key)
}

export function getAllowedTaskyonModels(key: string | undefined): string[] | undefined {
  const parsed = isTaskyonKey(key, false)
  if (!parsed || !parsed.model || parsed.model.length <= 0 || parsed.model.includes('*'))
    return undefined
  return parsed.model
}

export function modelOptionsForProvider(
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

export async function canReachLocalApi(baseUrl: string): Promise<boolean> {
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
