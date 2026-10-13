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
  sandboxFetchIdleTimeoutMs?: NonNullable<Parameters<typeof tyCore>[4]>['sandboxFetchIdleTimeoutMs']
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

const createBufferedSendPort = <Tx, Rx>(port: Port<Tx, Rx>) => {
  const pending: Tx[] = []
  let connected = false
  return {
    port: {
      ...port,
      send: (message: Tx) => {
        if (connected) port.send(message)
        else pending.push(message)
      },
    } satisfies Port<Tx, Rx>,
    connect: () => {
      connected = true
      for (const message of pending.splice(0)) port.send(message)
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
  const bufferedStoragePort = createBufferedSendPort(storage.port)
  const storageClient = createStorageClient(bufferedStoragePort.port, {
    namespacePrefix: options.storageNamespacePrefix ?? 'taskyon',
    distribution: 'local-only',
  })
  let disconnectCore: (() => void) | undefined
  let disconnectHost: (() => void) | undefined
  let stopStorage: (() => void) | undefined
  let stopReason: string | undefined
  let disposed = false

  const pendingClientMessages: TaskyonMessageType[] = []
  const pendingHostMessages: TaskyonHostMessage[] = []
  let sendToCore: ((message: TaskyonMessageType) => void) | undefined
  let sendToCoreHost: ((message: TaskyonHostMessage) => void) | undefined

  const unsubscribeClientQueue = corePort.receive((message) => {
    if (disposed) return
    if (sendToCore) sendToCore(message)
    else pendingClientMessages.push(message)
  })
  const unsubscribeHostQueue = coreHostPort.receive((message) => {
    if (disposed) return
    if (sendToCoreHost) sendToCoreHost(message)
    else pendingHostMessages.push(message)
  })

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
    unsubscribeClientQueue()
    unsubscribeHostQueue()
    pendingClientMessages.length = 0
    pendingHostMessages.length = 0
    try {
      try {
        await core.dispose(reason)
      } finally {
        await core.closeMetadataPersistence()
      }
    } finally {
      stopStorageService()
      await core.getCryptoSession().close?.()
    }
  }

  const taskyon = (async () => {
    options.onStage?.('connecting-storage')
    let cryptoSession: CryptoSession | undefined
    try {
      stopStorage = await storage.start()
      bufferedStoragePort.connect()
      options.onStage?.('creating-crypto-session')
      cryptoSession = await (options.cryptoSession ?? createCryptoSession())
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
          ...(options.sandboxFetchIdleTimeoutMs !== undefined
            ? { sandboxFetchIdleTimeoutMs: options.sandboxFetchIdleTimeoutMs }
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
      disconnectCore = core.port.receive((message) => corePort.send(message))
      disconnectHost = core.hostPort.receive((message) => coreHostPort.send(message))
      sendToCore = (message) => core.port.send(message)
      sendToCoreHost = (message) => core.hostPort.send(message)
      for (const message of pendingClientMessages.splice(0)) sendToCore(message)
      for (const message of pendingHostMessages.splice(0)) sendToCoreHost(message)
      corePort.send({ type: 'taskyonReady' })
      options.onStage?.('ready')
      if (stopReason) await disposeCore(core, stopReason)
      return core
    } catch (error) {
      client.dispose()
      unsubscribeClientQueue()
      unsubscribeHostQueue()
      pendingClientMessages.length = 0
      pendingHostMessages.length = 0
      stopStorageService()
      const failedSession = cryptoSession ?? (await options.cryptoSession)
      await failedSession?.close?.()
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
