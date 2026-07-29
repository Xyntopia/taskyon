import {
  connectTaskManagerStorageFromProtocol,
  createArtifactStore,
  createCryptoSession,
  tyCore,
  type CryptoSession,
} from '@taskyon/taskyon'
import {
  createProtocolPort,
  createProtocolStorageBlobBackend,
  createStorageClient,
  createTaskyonClient,
  taskyonProtocol,
  taskyonStorageProtocol,
  type Port,
  type TaskyonStorageMessage,
} from '@taskyon/taskyon/api'
import { createDefaultTaskyonToolSetup } from '@taskyon/taskyon/tools'
import { startBrowserStorageService, type BrowserRuntimeStorageService } from './storage'

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
  initialProviderKeys?: Readonly<Record<string, string | undefined>>
  onStage?: (stage: TaskyonCoreRuntimeStage) => void
  storageSessionId?: string
  storage: TaskyonCoreStorage
  toolSetup?: NonNullable<Parameters<typeof tyCore>[4]>['toolSetup']
}

export type TaskyonCoreRuntimeStage =
  | 'connecting-storage'
  | 'creating-crypto-session'
  | 'creating-core'
  | 'configuring-providers'
  | 'connecting-core-protocol'
  | 'ready'

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

export const createTaskyonBrowserCoreRuntime = (options: TaskyonBrowserCoreRuntimeOptions) => {
  const { x: clientPort, y: corePort } = createProtocolPort(taskyonProtocol)
  const client = createTaskyonClient(clientPort, { taskCacheSize: 0 })
  const storage = createStorageConnection(options.storage)
  const storageClient = createStorageClient(storage.port)
  let disconnectCore: (() => void) | undefined
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
    disconnectCore?.()
    disconnectCore = undefined
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
          toolSetup: options.toolSetup ?? createDefaultTaskyonToolSetup(),
          ...(options.databaseFactory ? { databaseFactory: options.databaseFactory } : {}),
          ...(options.indexTaskVectors !== undefined
            ? { indexTaskVectors: options.indexTaskVectors }
            : {}),
          ...(options.taskSearchVectorizer
            ? { taskSearchVectorizer: options.taskSearchVectorizer }
            : {}),
          taskManagerStorageFactory: ({ sessionId }) =>
            connectTaskManagerStorageFromProtocol(
              storage.port,
              options.storageSessionId ?? sessionId,
            ),
          artifactStoreFactory: ({ sessionId }) =>
            createArtifactStore(
              createProtocolStorageBlobBackend(
                storage.port,
                `${options.storageSessionId ?? sessionId}/artifacts`,
              ),
            ),
        },
      )
      options.onStage?.('configuring-providers')
      for (const [provider, key] of Object.entries(options.initialProviderKeys ?? {})) {
        if (!key) continue
        await core.updateChatCompletionApiKey(provider, key)
      }
      options.onStage?.('connecting-core-protocol')
      disconnectCore = corePort.connect(core.port)
      corePort.send({ type: 'taskyonReady' })
      options.onStage?.('ready')
      if (stopReason) await disposeCore(core, stopReason)
      return core
    } catch (error) {
      stopStorageService()
      throw error
    }
  })()

  return {
    taskyon,
    client,
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

export type TaskyonBrowserCoreRuntime = ReturnType<typeof createTaskyonBrowserCoreRuntime>
