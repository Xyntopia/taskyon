import {
  connectTaskManagerStorageFromProtocol,
  createArtifactStore,
  createCryptoSession,
  tyCore,
  type CryptoSession,
} from '@taskyon/taskyon/runtime-core'
import {
  createProtocolPort,
  createProtocolStorageBlobBackend,
  createStorageClient,
  createTaskyonHostClient,
  createTaskyonClient,
  createTaskRecordReader,
  taskyonHostProtocol,
  taskyonProtocol,
  taskyonStorageProtocol,
  type Port,
  type TaskyonClient,
  type TaskyonHostMessage,
  type TaskyonMessageType,
  type TaskyonStorageClient,
  type TaskyonStorageMessage,
} from '@taskyon/taskyon/api'
import { startBrowserStorageService, type BrowserRuntimeStorageService } from './storage'

type TyCoreToolSetup = NonNullable<NonNullable<Parameters<typeof tyCore>[4]>['toolSetup']>

export type TaskyonCoreStorage =
  | BrowserRuntimeStorageService
  | {
      kind: 'client'
      port: Port<TaskyonStorageMessage, TaskyonStorageMessage>
    }

export type TaskyonBrowserCoreRuntimeOptions = {
  llmSettings: Parameters<typeof tyCore>[0]
  entryNode: Parameters<typeof tyCore>[1]
  toolchainConfig: Parameters<typeof tyCore>[2]
  cryptoSession?: CryptoSession | Promise<CryptoSession>
  databaseFactory?: NonNullable<Parameters<typeof tyCore>[4]>['databaseFactory']
  indexTaskVectors?: NonNullable<Parameters<typeof tyCore>[4]>['indexTaskVectors']
  taskSearchVectorizer?: NonNullable<Parameters<typeof tyCore>[4]>['taskSearchVectorizer']
  authorizeSandboxFetch?: NonNullable<Parameters<typeof tyCore>[4]>['authorizeSandboxFetch']
  createFetchWithPolicy?: (
    storageClient: TaskyonStorageClient,
  ) => NonNullable<NonNullable<Parameters<typeof tyCore>[4]>['fetchWithPolicy']>
  fetchPolicy?: NonNullable<Parameters<typeof tyCore>[4]>['fetchPolicy']
  allowPrivateSandboxFetch?: boolean
  authorizePopup?: NonNullable<Parameters<typeof tyCore>[4]>['authorizePopup']
  onStage?: (stage: TaskyonCoreRuntimeStage) => void
  storageNamespacePrefix?: string
  storageSessionId?: string
  storage: TaskyonCoreStorage
  toolSetup:
    | TyCoreToolSetup
    | ((storageClient: ReturnType<typeof createStorageClient>) => TyCoreToolSetup)
}

export type TaskyonCoreRuntimeStage =
  | 'connecting-storage'
  | 'creating-crypto-session'
  | 'creating-core'
  | 'connecting-core-protocol'
  | 'ready'

export type TaskyonBrowserCoreRuntime = {
  taskyon: ReturnType<typeof tyCore>
  client: TaskyonClient
  host: ReturnType<typeof createTaskyonHostClient>
  hostPort: Port<TaskyonHostMessage>
  storageClient: TaskyonStorageClient
  port: Port<TaskyonMessageType>
  stop: (reason?: string) => Promise<void>
}

const createStorageConnection = (storage: TaskyonCoreStorage) => {
  if (storage.kind === 'client') {
    return {
      port: storage.port,
      start: () => undefined,
    }
  }

  const { x: storageClientPort, y: storageServicePort } = createProtocolPort(taskyonStorageProtocol)
  return {
    port: storageClientPort,
    start: async () => {
      const stop = await startBrowserStorageService(storageServicePort, storage)
      return typeof stop === 'function' ? stop : undefined
    },
  }
}

export const createTaskyonBrowserCoreRuntime = (
  options: TaskyonBrowserCoreRuntimeOptions,
): TaskyonBrowserCoreRuntime => {
  const { x: clientPort, y: corePort } = createProtocolPort(taskyonProtocol)
  const client = createTaskyonClient(clientPort, { taskCacheSize: 0 })
  const { x: hostPort, y: coreHostPort } = createProtocolPort(taskyonHostProtocol)
  const host = createTaskyonHostClient(hostPort)
  const storage = createStorageConnection(options.storage)
  const storageClient = createStorageClient(storage.port, {
    namespacePrefix: options.storageNamespacePrefix ?? 'taskyon',
    distribution: 'local-only',
  })
  let disconnectCore: (() => void) | undefined
  let disconnectHost: (() => void) | undefined
  let stopStorage: (() => void) | undefined
  let stopReason: string | undefined
  let disposed = false

  const stopStorageService = () => {
    const stop = stopStorage
    stopStorage = undefined
    stop?.()
  }

  const disposeCore = async (core: Awaited<ReturnType<typeof tyCore>>, reason: string) => {
    if (disposed) return
    disposed = true
    client.dispose()
    disconnectCore?.()
    disconnectCore = undefined
    disconnectHost?.()
    disconnectHost = undefined
    try {
      await core.dispose(reason)
    } finally {
      stopStorageService()
    }
  }

  const taskyon = (async () => {
    options.onStage?.('connecting-storage')
    stopStorage = await storage.start()
    try {
      options.onStage?.('creating-crypto-session')
      const cryptoSession = await (options.cryptoSession ?? createCryptoSession())
      options.onStage?.('creating-core')
      const core = await tyCore(
        options.llmSettings,
        options.entryNode,
        options.toolchainConfig,
        cryptoSession,
        {
          toolSetup:
            typeof options.toolSetup === 'function'
              ? options.toolSetup(storageClient)
              : options.toolSetup,
          ...(options.databaseFactory ? { databaseFactory: options.databaseFactory } : {}),
          ...(options.indexTaskVectors !== undefined
            ? { indexTaskVectors: options.indexTaskVectors }
            : {}),
          ...(options.taskSearchVectorizer
            ? { taskSearchVectorizer: options.taskSearchVectorizer }
            : {}),
          ...(options.authorizeSandboxFetch
            ? { authorizeSandboxFetch: options.authorizeSandboxFetch }
            : {}),
          ...(options.createFetchWithPolicy
            ? { fetchWithPolicy: options.createFetchWithPolicy(storageClient) }
            : {}),
          ...(options.fetchPolicy ? { fetchPolicy: options.fetchPolicy } : {}),
          ...(options.allowPrivateSandboxFetch ? { allowPrivateSandboxFetch: true } : {}),
          ...(options.authorizePopup ? { authorizePopup: options.authorizePopup } : {}),
          taskManagerStorageFactory: ({ sessionId }) => {
            const scope = options.storageSessionId ?? sessionId
            client.setTaskSource(createTaskRecordReader(storageClient, scope))
            return connectTaskManagerStorageFromProtocol(storageClient, scope)
          },
          artifactStoreFactory: ({ sessionId }) =>
            createArtifactStore(
              createProtocolStorageBlobBackend(
                storageClient,
                `${options.storageSessionId ?? sessionId}/artifacts`,
              ),
            ),
        },
      )
      options.onStage?.('connecting-core-protocol')
      disconnectCore = corePort.connect(core.port)
      disconnectHost = coreHostPort.connect(core.hostPort)
      corePort.send({ type: 'taskyonReady' })
      options.onStage?.('ready')
      if (stopReason) await disposeCore(core, stopReason)
      return core
    } catch (error) {
      client.dispose()
      stopStorageService()
      throw error
    }
  })()

  return {
    taskyon,
    client,
    host,
    hostPort,
    storageClient,
    port: clientPort,
    stop: async (reason = 'stopping Taskyon browser core runtime') => {
      if (stopReason) return
      stopReason = reason
      const core = await taskyon
      await disposeCore(core, reason)
    },
  }
}
