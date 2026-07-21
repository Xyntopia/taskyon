import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createProtocolPort, createUnavailableIframeMux } from '@taskyon/common/modules/frpBus'
import { tyCore } from '../../../taskyon/src/core/init'
import type { Taskyon } from '../../../taskyon/src/core/init'
import { connectTaskManagerStorageFromProtocol } from '../../../taskyon/src/core/taskManager'
import { taskyonStorageProtocol } from '../../../taskyon/src/api/storageProtocol'
import { createDefaultTaskyonToolSetup } from '../../../taskyon/src/tools'
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
  createCliSecretStore,
  resolveDataDirectoryPath,
  resolveConfigDirectoryPath,
  resolveKeyForProvider,
  resolveProviderSelection,
  resolveStoredModel,
} from './config'
import { createCliFileStorageService } from './fileStorage'
import { applyCodexAccountHeader, createCliLlmSettings } from './models'
import { readProviderOauthAccountId, resolveCachedProviderOauthSession } from '../oauthLogin'

const DIAGNOSTICS_ENTRY_NODE_NAME = 'entryNode'

const runtimeDirectoryName = () => {
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
    '-',
    process.pid,
  ].join('')
}

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
  nodePgLiteDataDir?: string
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
  const dataDir = await resolveDataDirectoryPath()
  const pgliteNodeDir =
    args?.nodePgLiteDataDir ?? join(configDir, 'runtime', runtimeDirectoryName(), 'pglite')
  await mkdir(pgliteNodeDir, { recursive: true })
  const cliSecretStore = createCliSecretStore(cryptoSession)

  const selectedApi = args?.selectedApi ?? resolveProviderSelection(stored)
  if (!SUPPORTED_PROVIDERS.includes(selectedApi as (typeof SUPPORTED_PROVIDERS)[number])) {
    throw new Error(
      `Unsupported provider '${selectedApi}'. Choose one of: ${SUPPORTED_PROVIDERS.join(', ')}`,
    )
  }

  const model = args?.model ?? resolveStoredModel(stored, selectedApi)
  const envProviderKey = resolveKeyForProvider(selectedApi)
  const config: CliApiConfig = {
    selectedApi,
    ...(model ? { model } : {}),
    ...(envProviderKey ? { key: envProviderKey } : {}),
  }

  const llmState = createCliLlmSettings(config)
  const { x: taskStorageClientPort, y: taskStorageServicePort } =
    createProtocolPort(taskyonStorageProtocol)
  createCliFileStorageService(taskStorageServicePort, join(dataDir, 'storage'))
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
      toolSetup: createDefaultTaskyonToolSetup(),
      createIframeMultiPlexer: () =>
        createUnavailableIframeMux('Iframe message bridging is not available in tycli.'),
      nodePgLiteDataDir: pgliteNodeDir,
      secretStore: cliSecretStore,
      taskManagerStorageFactory: ({ sessionId }) =>
        connectTaskManagerStorageFromProtocol(taskStorageClientPort, sessionId),
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
