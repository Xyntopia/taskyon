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
import { updateToolchainConfigValue } from '../../../taskyon/src/types/profiles'
import {
  isReasoningEffort,
  type CliApiConfig,
  type LlmModel,
  type ReasoningEffort,
} from './types'

const CODEX_MODELS_CLIENT_VERSION = '0.144.5'

export type CliLlmState = {
  settings: llmSettings
  toolchainProfiles: ToolchainProfiles
  selectedToolchainProfile: string
}

export const reasoningEffortOptions: { label: string; value: ReasoningEffort }[] = [
  { label: 'none (fastest)', value: 'none' },
  { label: 'low', value: 'low' },
  { label: 'medium', value: 'medium' },
  { label: 'high (deepest)', value: 'high' },
]

export function createCliLlmState(
  config: CliApiConfig,
  toolchainProfiles: ToolchainProfiles,
  entryFunction: string,
): CliLlmState {
  const profiles = structuredClone(toolchainProfiles)
  const selectedProfile = profiles.profiles[config.selectedApi]
  if (!selectedProfile?.chatCompletion) {
    throw new Error(`Unsupported provider: ${config.selectedApi}`)
  }
  if (config.model) {
    selectedProfile.chatCompletion = { ...selectedProfile.chatCompletion, model: config.model }
  }
  const state = {
    settings: { entryFunction },
    toolchainProfiles: profiles,
    selectedToolchainProfile: config.selectedApi,
  }
  if (config.reasoningEffort) setReasoningEffort(state, config.reasoningEffort)
  return state
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

export const getSelectedReasoningEffort = (
  llmState: CliLlmState,
): ReasoningEffort | undefined => {
  const value = getSelectedToolchainConfig(llmState)[llmState.settings.entryFunction]
    ?.reasoning_effort
  return isReasoningEffort(value) ? value : undefined
}

export const setReasoningEffort = (llmState: CliLlmState, reasoningEffort: ReasoningEffort) => {
  llmState.toolchainProfiles = updateToolchainConfigValue(
    llmState.toolchainProfiles,
    llmState.selectedToolchainProfile,
    [llmState.settings.entryFunction, 'reasoning_effort'],
    reasoningEffort,
  )
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
