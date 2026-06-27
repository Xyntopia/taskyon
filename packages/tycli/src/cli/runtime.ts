import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createUnavailableIframeMux } from '../../../shared/modules/frpBus'
import { tyCore } from '../../../taskyon/src/core/init'
import type { Taskyon } from '../../../taskyon/src/core/init'
import type { llmSettings } from '../../../taskyon/src/types/profiles'
import { toolCall } from '../../../taskyon/src/types/toolApi'
import {
  API_KEY_STORE_NAME,
  type CliApiConfig,
  type StoredConfig,
  SUPPORTED_PROVIDERS,
} from './types'
import {
  initPersistentCryptoSession,
  resolveConfigDirectoryPath,
  resolveKeyForProvider,
  resolveProviderSelection,
  resolveStoredModel,
} from './config'
import {
  applyCodexAccountHeader,
  createCliLlmSettings,
  normalizeStoredModelForProvider,
} from './models'
import { readProviderOauthAccountId, resolveCachedProviderOauthSession } from '../oauthLogin'

const DIAGNOSTICS_ENTRY_NODE_NAME = 'entryNode'

export async function syncProviderRuntimeConfig(
  ty: Taskyon,
  llmState: llmSettings,
  providerId: string,
): Promise<null | { accessToken: string; accountId?: string }> {
  if (providerId !== 'chatgpt-codex') return null
  const api = llmState.llmApis[providerId]
  if (!api) return null

  const cachedSession = await resolveCachedProviderOauthSession({
    providerName: providerId,
    api,
    taskyon: ty,
  })
  const accountId = cachedSession?.accountId ?? (await readProviderOauthAccountId(ty, providerId))
  applyCodexAccountHeader(llmState, accountId)
  if (cachedSession?.accessToken) {
    await ty.setSecret(API_KEY_STORE_NAME, providerId, cachedSession.accessToken)
    await ty.updateChatCompletionApiKey(providerId, cachedSession.accessToken)
  }
  return cachedSession
}

export async function bootstrapCliTaskyon(args?: {
  selectedApi?: string
  model?: string
}): Promise<{
  taskyon: Taskyon
  llmState: llmSettings
  configDir: string
  selectedApi: string
  model?: string
  stored: StoredConfig
  providerKey?: string
  oauthSession?: { accessToken: string; accountId?: string } | null
}> {
  const { cryptoSession, stored } = await initPersistentCryptoSession()
  const configDir = await resolveConfigDirectoryPath()
  const pgliteNodeDir = join(configDir, 'pglite')
  await mkdir(pgliteNodeDir, { recursive: true })

  const selectedApi = args?.selectedApi ?? resolveProviderSelection(stored)
  if (!SUPPORTED_PROVIDERS.includes(selectedApi as (typeof SUPPORTED_PROVIDERS)[number])) {
    throw new Error(
      `Unsupported provider '${selectedApi}'. Choose one of: ${SUPPORTED_PROVIDERS.join(', ')}`,
    )
  }

  const model =
    args?.model ??
    process.env.TASKYON_MODEL ??
    normalizeStoredModelForProvider(selectedApi, resolveStoredModel(stored, selectedApi))
  const envProviderKey = resolveKeyForProvider(selectedApi)
  const config: CliApiConfig = {
    selectedApi,
    ...(model ? { model } : {}),
    ...(envProviderKey ? { key: envProviderKey } : {}),
  }

  const llmState = createCliLlmSettings(config)
  const taskyon = await tyCore(
    () => llmState,
    () =>
      toolCall({
        name: DIAGNOSTICS_ENTRY_NODE_NAME,
        arguments: {},
      }),
    () => ({}),
    cryptoSession,
    {
      createIframeMultiPlexer: () =>
        createUnavailableIframeMux('Iframe message bridging is not available in tycli.'),
      nodePgLiteDataDir: pgliteNodeDir,
    },
  )

  const persistedKey = await taskyon.getSecret(API_KEY_STORE_NAME, selectedApi, false, false)
  const bootstrapKey = persistedKey ?? config.key
  if (bootstrapKey) {
    await taskyon.setSecret(API_KEY_STORE_NAME, selectedApi, bootstrapKey)
    await taskyon.updateChatCompletionApiKey(selectedApi, bootstrapKey)
  }

  const oauthSession = await syncProviderRuntimeConfig(taskyon, llmState, selectedApi)
  const providerKey = oauthSession?.accessToken ?? bootstrapKey

  return {
    taskyon,
    llmState,
    configDir,
    selectedApi,
    ...(model ? { model } : {}),
    stored,
    ...(providerKey ? { providerKey } : {}),
    oauthSession,
  }
}
