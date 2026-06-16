import {
  TOKEN_SERVICE_BASE_URL,
  isTaskyonKey,
  type apiConfig,
  type llmSettings,
} from '@taskyon/taskyon'
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

export const baseApiDefinitions: Record<string, apiConfig> = {
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

export function createCliLlmSettings(config: CliApiConfig): llmSettings {
  const selectedApiConfig = baseApiDefinitions[config.selectedApi]
  if (!selectedApiConfig) {
    throw new Error(`Unsupported provider: ${config.selectedApi}`)
  }
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
    entryFunction: 'entryNode',
  }
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path
  const left = base.replace(/\/+$/, '')
  const right = path.replace(/^\/+/, '')
  return `${left}/${right}`
}

export async function fetchProviderModels(
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
