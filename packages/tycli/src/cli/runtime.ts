import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createPortClient, createProtocolPort } from '@taskyon/common/modules/frpBus'
import { createUnavailableIframeMux } from '@taskyon/common/modules/frpBusWeb'
import { taskyonRuntimeProtocol } from '@taskyon/taskyon/api'
import { tyCore } from '../../../taskyon/src/core/init'
import type { Taskyon } from '../../../taskyon/src/core/init'
import { connectTaskManagerStorageFromProtocol } from '../../../taskyon/src/core/taskManager'
import { createArtifactStore } from '../../../taskyon/src/core/artifactStore'
import {
  createProtocolStorageBlobBackend,
  taskyonStorageProtocol,
} from '../../../taskyon/src/api/storageProtocol'
import { createDefaultTaskyonToolSetup } from '../../../taskyon/src/tools'
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
import { createCliSelectedStorageService, resolveCliStorageSelection } from './storageService'
import {
  applyCodexAccountHeader,
  createCliLlmState,
  getProviderSettings,
  getSelectedToolchainConfig,
  type CliLlmState,
} from './models'
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
  llmState: CliLlmState,
  providerId: string,
): Promise<null | { accessToken: string; accountId?: string }> {
  let cachedSession: null | { accessToken: string; accountId?: string } = null

  if (providerId === 'chatgpt-codex') {
    const api = getProviderSettings(llmState, providerId)
    if (api) {
      cachedSession = await resolveCachedProviderOauthSession({
        providerName: providerId,
        api,
        taskyon: ty,
      })
      const accountId =
        cachedSession?.accountId ?? (await readProviderOauthAccountId(ty, providerId))
      applyCodexAccountHeader(llmState, accountId)
      if (cachedSession?.accessToken) {
        await ty.setSecret(API_KEY_STORE_NAME, providerId, cachedSession.accessToken)
        await ty.updateChatCompletionApiKey(providerId, cachedSession.accessToken)
      }
    }
  }

  await applyCliRuntimeConfig(ty, llmState)
  return cachedSession
}

export async function applyCliRuntimeConfig(ty: Taskyon, llmState: CliLlmState) {
  const result = await createPortClient(ty.hostPort, taskyonRuntimeProtocol).runtime.configure({
    toolchainConfig: getSelectedToolchainConfig(llmState),
  })
  if (!result.ok) throw new Error(`Could not configure Taskyon runtime: ${result.error}`)
}

export async function bootstrapCliTaskyon(args?: {
  nodePgLiteDataDir?: string
  selectedApi?: string
  model?: string
}): Promise<{
  taskyon: Taskyon
  llmState: CliLlmState
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

  const llmState = createCliLlmState(config)
  const { x: taskStorageClientPort, y: taskStorageServicePort } =
    createProtocolPort(taskyonStorageProtocol)
  await createCliSelectedStorageService({
    port: taskStorageServicePort,
    dataDirectory: dataDir,
    selection: resolveCliStorageSelection(stored),
  })
  const taskyon = await tyCore(
    () => llmState.settings,
    () =>
      toolCall({
        name: DIAGNOSTICS_ENTRY_NODE_NAME,
        arguments: {},
      }),
    getSelectedToolchainConfig(llmState),
    cryptoSession,
    {
      toolSetup: createDefaultTaskyonToolSetup(),
      createIframeMultiPlexer: () =>
        createUnavailableIframeMux('Iframe message bridging is not available in tycli.'),
      nodePgLiteDataDir: pgliteNodeDir,
      secretStore: cliSecretStore,
      taskManagerStorageFactory: ({ sessionId }) =>
        connectTaskManagerStorageFromProtocol(taskStorageClientPort, sessionId),
      artifactStoreFactory: ({ sessionId }) =>
        createArtifactStore(
          createProtocolStorageBlobBackend(taskStorageClientPort, `${sessionId}/artifacts`),
        ),
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
