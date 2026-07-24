import type { ChatCompletionProviderSettings } from '../types/chatCompletion'
import { availableModels } from './chat'
import { TOKEN_SERVICE_BASE_URL } from '../taskyon.space/tokenservice.types'
import { joinUrl } from '../utils/httpUtils'

type ModelDiscoveryOptions = {
  useTokenServiceForOpenrouter?: boolean
  useTokenServiceForTaskyon?: boolean
}

const resolveModelEndpoint = (
  api: ChatCompletionProviderSettings,
  options: ModelDiscoveryOptions,
): string => {
  if (api.provider === 'openrouter.ai' && options.useTokenServiceForOpenrouter) {
    return `${TOKEN_SERVICE_BASE_URL}/api/models_openrouter`
  }
  if (api.provider === 'taskyon' && options.useTokenServiceForTaskyon) {
    return `${TOKEN_SERVICE_BASE_URL}/api/models`
  }
  return joinUrl(api.baseURL, api.routes.models)
}

const resolveModelApiKey = async (
  api: ChatCompletionProviderSettings,
  getApiKey: (name: string) => Promise<string | null>,
  options: ModelDiscoveryOptions,
): Promise<string> => {
  if (api.provider === 'openrouter.ai' && options.useTokenServiceForOpenrouter) {
    return (await getApiKey('taskyon')) || (await getApiKey(api.provider)) || ''
  }
  if (api.provider === 'taskyon' && options.useTokenServiceForTaskyon) {
    return (await getApiKey('taskyon')) || ''
  }
  return (await getApiKey(api.provider)) || ''
}

export async function fetchModelsForProvider(
  api: ChatCompletionProviderSettings,
  getApiKey: (name: string) => Promise<string | null>,
  options: ModelDiscoveryOptions = {
    useTokenServiceForOpenrouter: false,
    useTokenServiceForTaskyon: false,
  },
) {
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
