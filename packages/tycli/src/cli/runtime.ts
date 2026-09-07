import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createPortClient, createProtocolPort } from '@taskyon/common/modules/frpBus'
import { createUnavailableIframeMux } from '@taskyon/common/modules/frpBusWeb'
import type { DiagnosticsProviderSession } from '@taskyon/common/modules/diagnosticsRunner'
import { CODEX_PROVIDER_NAME, resolveProviderAccessToken } from '@taskyon/taskyon'
import { taskyonRuntimeProtocol } from '@taskyon/taskyon/api'
import { tyCore } from '../../../taskyon/src/core/init'
import type { Taskyon } from '../../../taskyon/src/core/init'
import { connectTaskManagerStorageFromProtocol } from '../../../taskyon/src/core/taskManager'
import { createArtifactStore } from '../../../taskyon/src/core/artifactStore'
import {
  createProtocolStorageBlobBackend,
  createStorageClient,
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
  createCliConfigStore,
  resolveProviderSelection,
  resolveStoredModel,
  resolveStoredReasoningEffort,
} from './config'
import { createCliSelectedStorageService, resolveCliStorageSelection } from './storageService'
import type { CliStoragePaths } from './storagePaths'
import { resolveTaskyonCliStoragePaths } from './storagePaths'
import {
  applyCodexAccountHeader,
  createCliLlmState,
  getProviderSettings,
  getSelectedToolchainConfig,
  type CliLlmState,
} from './models'
import { CLI_FLOW_TOOL_NAME, cliToolchainProfiles } from './toolchainSettings'
import { resolveCachedCodexOauthSession } from '../codexOauthLogin'
import { resolveCachedProviderOauthCredentials } from '../oauthLogin'
import type { CliOauthStorage } from '../oauthLogin'

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

export async function resolveProviderCredential(
  ty: Pick<Taskyon, 'getSecret' | 'setSecret'>,
  llmState: CliLlmState,
  providerId: string,
  oauthStorage: CliOauthStorage,
): Promise<string | null> {
  const api = getProviderSettings(llmState, providerId)
  const codexSession =
    providerId === CODEX_PROVIDER_NAME && api
      ? await resolveCachedCodexOauthSession({
          api,
          taskyon: ty,
          storage: oauthStorage,
        })
      : null
  const providerCredentials =
    providerId !== CODEX_PROVIDER_NAME && api
      ? await resolveCachedProviderOauthCredentials({
          providerName: providerId,
          api,
          taskyon: ty,
          storage: oauthStorage,
        })
      : null
  const oauthAccessToken =
    codexSession?.accessToken ??
    (providerCredentials && api ? await resolveProviderAccessToken(providerCredentials, api) : null)
  if (providerId === CODEX_PROVIDER_NAME) {
    applyCodexAccountHeader(llmState, codexSession?.accountId)
  }
  return (
    oauthAccessToken ??
    (await ty.getSecret(API_KEY_STORE_NAME, providerId, false, false)) ??
    (providerId === 'local' ? 'local' : null)
  )
}

export async function syncProviderRuntimeConfig(
  ty: Taskyon,
  llmState: CliLlmState,
  providerId: string,
  oauthStorage: CliOauthStorage,
): Promise<DiagnosticsProviderSession | undefined> {
  const providerSession: DiagnosticsProviderSession = {
    provider: providerId,
    authenticate: async (runtime) => {
      const credential = await resolveProviderCredential(ty, llmState, providerId, oauthStorage)
      if (!credential) return false
      await runtime.updateChatCompletionApiKey(providerId, credential)
      return true
    },
  }
  const authenticated = await providerSession.authenticate(ty)
  await applyCliRuntimeConfig(ty, llmState)
  return authenticated ? providerSession : undefined
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
  storagePaths?: CliStoragePaths
  oauthSecretId?: string
  environmentPrefix?: string
  storageNamespace?: string
}): Promise<{
  taskyon: Taskyon
  llmState: CliLlmState
  configDir: string
  selectedApi: string
  model?: string
  stored: StoredConfig
  providerSession?: DiagnosticsProviderSession
  taskyonAuth?: string
}> {
  const configStore = createCliConfigStore(args?.storagePaths ?? resolveTaskyonCliStoragePaths())
  const { cryptoSession, stored } = await configStore.initPersistentCryptoSession()
  const configDir = await configStore.resolveConfigDirectoryPath()
  const dataDir = await configStore.resolveDataDirectoryPath()
  const pgliteNodeDir =
    args?.nodePgLiteDataDir ?? join(configDir, 'runtime', runtimeDirectoryName(), 'pglite')
  await mkdir(pgliteNodeDir, { recursive: true })
  const cliSecretStore = configStore.createCliSecretStore(cryptoSession)
  const oauthStorage = {
    authDir: configStore.paths.authDir,
    secretId: args?.oauthSecretId ?? 'taskyon-cli:oauth',
  }

  const environmentPrefix = args?.environmentPrefix ?? 'TASKYON'
  const selectedApi = args?.selectedApi ?? resolveProviderSelection(stored, environmentPrefix)
  if (!SUPPORTED_PROVIDERS.includes(selectedApi as (typeof SUPPORTED_PROVIDERS)[number])) {
    throw new Error(
      `Unsupported provider '${selectedApi}'. Choose one of: ${SUPPORTED_PROVIDERS.join(', ')}`,
    )
  }

  const model = args?.model ?? resolveStoredModel(stored, selectedApi)
  const reasoningEffort = resolveStoredReasoningEffort(stored)
  const config: CliApiConfig = {
    selectedApi,
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }

  const llmState = createCliLlmState(config, cliToolchainProfiles, CLI_FLOW_TOOL_NAME)
  const { x: taskStorageClientPort, y: taskStorageServicePort } =
    createProtocolPort(taskyonStorageProtocol)
  await createCliSelectedStorageService({
    port: taskStorageServicePort,
    dataDirectory: dataDir,
    selection: resolveCliStorageSelection(stored),
  })
  const storageClient = createStorageClient(taskStorageClientPort, {
    namespacePrefix: args?.storageNamespace ?? 'taskyon',
    distribution: 'local-only',
  })
  const taskyon = await tyCore(
    () => llmState.settings,
    () =>
      toolCall({
        name: CLI_FLOW_TOOL_NAME,
        arguments: {},
      }),
    getSelectedToolchainConfig(llmState),
    cryptoSession,
    {
      toolSetup: createDefaultTaskyonToolSetup({ pythonTool: null, storageClient }),
      createIframeMultiPlexer: () =>
        createUnavailableIframeMux('Iframe message bridging is not available in tycli.'),
      nodePgLiteDataDir: pgliteNodeDir,
      secretStore: cliSecretStore,
      taskManagerStorageFactory: ({ sessionId }) =>
        connectTaskManagerStorageFromProtocol(storageClient, sessionId),
      artifactStoreFactory: ({ sessionId }) =>
        createArtifactStore(
          createProtocolStorageBlobBackend(storageClient, `${sessionId}/artifacts`),
        ),
    },
  )

  const providerSession = await syncProviderRuntimeConfig(
    taskyon,
    llmState,
    selectedApi,
    oauthStorage,
  )
  const taskyonAuth = await taskyon.getSecret(API_KEY_STORE_NAME, 'taskyon', false, false)

  return {
    taskyon,
    llmState,
    configDir,
    selectedApi,
    ...(model ? { model } : {}),
    stored,
    ...(providerSession ? { providerSession } : {}),
    ...(taskyonAuth ? { taskyonAuth } : {}),
  }
}
