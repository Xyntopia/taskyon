import type { ReadonlyDeep } from 'type-fest'
import type { llmSettings } from '../types/profiles'
import { availableModels } from './chat'
import { TOKEN_SERVICE_BASE_URL } from '../taskyon.space/tokenservice.types'
import { joinUrl } from '../utils/httpUtils'

type ModelDiscoveryOptions = {
  useTokenServiceForOpenrouter?: boolean
  useTokenServiceForTaskyon?: boolean
}

const resolveModelEndpoint = (
  api: NonNullable<llmSettings['llmApis']>[string],
  options: ModelDiscoveryOptions,
): string => {
  if (api.name === 'openrouter.ai' && options.useTokenServiceForOpenrouter) {
    return `${TOKEN_SERVICE_BASE_URL}/api/models_openrouter`
  }
  if (api.name === 'taskyon' && options.useTokenServiceForTaskyon) {
    return `${TOKEN_SERVICE_BASE_URL}/api/models`
  }
  return joinUrl(api.baseURL, api.routes.models)
}

const resolveModelApiKey = async (
  api: NonNullable<llmSettings['llmApis']>[string],
  getApiKey: (name: string) => Promise<string | null>,
  options: ModelDiscoveryOptions,
): Promise<string> => {
  if (api.name === 'openrouter.ai' && options.useTokenServiceForOpenrouter) {
    return (await getApiKey('taskyon')) || (await getApiKey(api.name)) || ''
  }
  if (api.name === 'taskyon' && options.useTokenServiceForTaskyon) {
    return (await getApiKey('taskyon')) || ''
  }
  return (await getApiKey(api.name)) || ''
}

export async function fetchModelsForSelectedApi(
  settings: ReadonlyDeep<Pick<llmSettings, 'selectedApi' | 'llmApis'>>,
  getApiKey: (name: string) => Promise<string | null>,
  options: ModelDiscoveryOptions = {
    useTokenServiceForOpenrouter: false,
    useTokenServiceForTaskyon: false,
  },
) {
  const selectedApi = settings.selectedApi || ''
  const api = settings.llmApis[selectedApi]
  if (!api) return {}

  let modelsUrl: string
  try {
    modelsUrl = resolveModelEndpoint(api, options)
  } catch (err) {
    console.warn('Invalid model URL', err)
    return {}
  }

  const key = await resolveModelApiKey(api, getApiKey, options)
  try {
    return await availableModels(modelsUrl, key, api.defaultHeaders ?? {})
  } catch {
    console.log("couldn't download models from", modelsUrl)
    return {}
  }
}

export const getProviderModelFallbacks = (providerName: string): string[] => {
  if (providerName === 'chatgpt-codex') {
    return ['gpt-5.4']
  }
  return []
}
