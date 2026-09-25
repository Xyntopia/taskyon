import {
  createProtocolPort,
  createStorageClient,
  createTaskyonHostClient,
  createTaskyonClient,
  createTaskRecordReader,
  taskyonHostProtocol,
  taskyonProtocol,
  taskyonStorageProtocol,
  type FunctionArguments,
  type InternalTool,
  type Port,
  type TaskyonMessageType,
  type llmSettings,
  type partialTaskDraft,
} from '@taskyon/taskyon/api'
import type { StreamSubscription } from '@taskyon/common/modules/frpBus'
import { createPortFromMessagePort, MessageChannelBridge } from '@taskyon/common/modules/frpBusWeb'
import type { ChatCompletionStreamEvent, TyTaskStreamData } from '@taskyon/taskyon'
import {
  createExternalToolContext,
  registerToolRpcTools,
  type ToolRpcCreateContext,
} from '@taskyon/taskyon/api'
import { startBrowserStorageService, type BrowserRuntimeStorageService } from './storage'
import type { TaskyonCoreRuntimeStage } from './core'
import type { TaskyonBrowserWorkerInitMessage, TaskyonBrowserWorkerMessage } from './workerProtocol'
import type { TaskyonBrowserProviderTransport, TaskyonDirectFallbackRequest } from './providerFetch'
import { startTaskyonDirectFallbackHost } from './directFallbackProtocol'
import { startHostFetchResponder, type HostFetchContext } from './hostFetchBridge'
import type { FetchCapability } from '@taskyon/common/modules/webFetching/mediatedFetch'
import type { ToolIdentity } from '@taskyon/taskyon'

export type TaskyonBrowserRuntimeOptions = {
  llmSettings: llmSettings
  entryNode?: partialTaskDraft
  toolchainConfig?: Record<string, FunctionArguments>
  providerTransport?: TaskyonBrowserProviderTransport
  approveDirectFallback?: (request: TaskyonDirectFallbackRequest) => Promise<boolean>
  hostFetch?: {
    fetch: (context: HostFetchContext, request: Request) => Promise<Response>
    authorize: (tool: ToolIdentity, capability: FetchCapability) => Promise<boolean>
  }
  tools?: InternalTool[]
  createTools?: (
    services: TaskyonBrowserRuntimeServices,
  ) => InternalTool[] | Promise<InternalTool[]>
  createToolContext?: ToolRpcCreateContext
  persistCryptoSession?: boolean
  cryptoNamespace?: string
  readinessTimeoutMs?: number
  storage?: BrowserRuntimeStorageService
  storageNamespacePrefix?: string
  storageSessionId?: string
  createWorker?: () => Worker
  onStage?: (stage: TaskyonCoreRuntimeStage) => void
}

export type TaskyonBrowserRuntimeServices = {
  client: ReturnType<typeof createTaskyonClient>
  storageClient: ReturnType<typeof createStorageClient>
}

export type TaskyonBrowserRuntime = {
  client: ReturnType<typeof createTaskyonClient>
  host: ReturnType<typeof createTaskyonHostClient>
  storageClient: ReturnType<typeof createStorageClient>
  port: Port<TaskyonMessageType, TaskyonMessageType>
  chatCompletionStream: StreamSubscription<ChatCompletionStreamEvent>
  workerStream: StreamSubscription<TyTaskStreamData>
  stop: (reason?: string) => void
}

const createDefaultWorker = () =>
  new Worker(new URL('./coreWorker.ts', import.meta.url), {
    type: 'module',
    name: 'taskyon-core-runtime',
  })

export const createTaskyonBrowserRuntime = async (
  options: TaskyonBrowserRuntimeOptions,
): Promise<TaskyonBrowserRuntime> => {
  const runtimePort = createProtocolPort(taskyonProtocol)
  const taskyonClient = createTaskyonClient(runtimePort.x)
  const hostPort = createProtocolPort(taskyonHostProtocol)
  const hostClient = createTaskyonHostClient(hostPort.x)
  const storagePort = createProtocolPort(taskyonStorageProtocol)
  const storageClient = createStorageClient(storagePort.x, {
    namespacePrefix: options.storageNamespacePrefix ?? 'taskyon',
    distribution: 'local-only',
  })
  if (options.storageSessionId) {
    taskyonClient.setTaskSource(createTaskRecordReader(storageClient, options.storageSessionId))
  }
  const storageStop = await startBrowserStorageService(
    storagePort.y,
    options.storage ?? { kind: 'browser' },
  )
  const coreChannel = new MessageChannel()
  const hostChannel = new MessageChannel()
  const storageChannel = new MessageChannel()
  const chatCompletionChannel = new MessageChannel()
  const workerStreamChannel = new MessageChannel()
  const directFallbackChannel = options.approveDirectFallback ? new MessageChannel() : undefined
  const hostFetchChannel = options.hostFetch ? new MessageChannel() : undefined
  const stopHostFetch =
    hostFetchChannel && options.hostFetch
      ? startHostFetchResponder(hostFetchChannel.port1, options.hostFetch)
      : undefined
  const stopDirectFallbackHost =
    directFallbackChannel && options.approveDirectFallback
      ? startTaskyonDirectFallbackHost(directFallbackChannel.port1, options.approveDirectFallback)
      : undefined
  const coreBridge = MessageChannelBridge(runtimePort.y, coreChannel.port1)
  const hostBridge = MessageChannelBridge(hostPort.y, hostChannel.port1)
  const storageBridge = MessageChannelBridge(storagePort.x, storageChannel.port1)
  const chatCompletionStreamPort = createPortFromMessagePort<never, ChatCompletionStreamEvent>(
    chatCompletionChannel.port1,
  )
  const workerStreamPort = createPortFromMessagePort<never, TyTaskStreamData>(
    workerStreamChannel.port1,
  )
  const worker = options.createWorker ? options.createWorker() : createDefaultWorker()
  let resolveWorkerInitialization: () => void = () => {}
  let rejectWorkerInitialization: (reason: Error) => void = () => {}
  let workerStage = 'loading worker module'
  const workerInitialization = new Promise<void>((resolve, reject) => {
    resolveWorkerInitialization = resolve
    rejectWorkerInitialization = reject
  })
  const onWorkerMessage = (event: MessageEvent<TaskyonBrowserWorkerMessage>) => {
    if (event.data.type === 'runtimeStage') {
      workerStage = event.data.stage
      options.onStage?.(event.data.stage)
      if (event.data.stage === 'ready') resolveWorkerInitialization()
      return
    }
    const error = new Error(event.data.message)
    if (event.data.stack) error.stack = event.data.stack
    rejectWorkerInitialization(error)
  }
  const onWorkerError = (event: ErrorEvent) => {
    rejectWorkerInitialization(new Error(event.message || 'Taskyon browser worker failed to load.'))
  }
  worker.addEventListener('message', onWorkerMessage)
  worker.addEventListener('error', onWorkerError)

  const initMessage: TaskyonBrowserWorkerInitMessage = {
    type: 'init',
    corePort: coreChannel.port2,
    hostPort: hostChannel.port2,
    storagePort: storageChannel.port2,
    chatCompletionStreamPort: chatCompletionChannel.port2,
    workerStreamPort: workerStreamChannel.port2,
    llmSettings: options.llmSettings,
    ...(options.entryNode ? { entryNode: options.entryNode } : {}),
    toolchainConfig: options.toolchainConfig ?? {},
    ...(options.providerTransport ? { providerTransport: options.providerTransport } : {}),
    ...(directFallbackChannel ? { directFallbackPort: directFallbackChannel.port2 } : {}),
    ...(hostFetchChannel ? { hostFetchPort: hostFetchChannel.port2 } : {}),
    storageNamespacePrefix: options.storageNamespacePrefix ?? 'taskyon',
    ...(options.storageSessionId ? { storageSessionId: options.storageSessionId } : {}),
    ...(options.persistCryptoSession ? { persistCryptoSession: true } : {}),
    ...(options.cryptoNamespace ? { cryptoNamespace: options.cryptoNamespace } : {}),
  }
  worker.postMessage(initMessage, [
    coreChannel.port2,
    storageChannel.port2,
    hostChannel.port2,
    chatCompletionChannel.port2,
    workerStreamChannel.port2,
    ...(directFallbackChannel ? [directFallbackChannel.port2] : []),
    ...(hostFetchChannel ? [hostFetchChannel.port2] : []),
  ])

  let toolExecutor: Awaited<ReturnType<typeof registerToolRpcTools>> | undefined
  const readinessTimeoutMs = options.readinessTimeoutMs ?? 30_000
  const workerInitializationTimeout = setTimeout(() => {
    rejectWorkerInitialization(
      new Error(`Taskyon browser worker did not become ready within ${readinessTimeoutMs}ms.`),
    )
  }, readinessTimeoutMs)
  try {
    await workerInitialization
    clearTimeout(workerInitializationTimeout)
    await taskyonClient.waitUntilReady({ readinessTimeoutMs: 5_000 })
    const tools = [
      ...(options.tools ?? []),
      ...(options.createTools
        ? await options.createTools({ client: taskyonClient, storageClient })
        : []),
    ]
    toolExecutor = await registerToolRpcTools({
      port: runtimePort.x,
      tools,
      createContext:
        options.createToolContext ??
        ((call, stopSignal) =>
          createExternalToolContext(stopSignal, {
            getExecutionTaskChain: () => {
              if (!call.taskId) {
                throw new Error(
                  'getExecutionTaskChain is not available because the tool call has no task id.',
                )
              }
              return taskyonClient.task.getChain({ id: call.taskId })
            },
          })),
    })
  } catch (error) {
    taskyonClient.dispose()
    clearTimeout(workerInitializationTimeout)
    worker.removeEventListener('message', onWorkerMessage)
    worker.removeEventListener('error', onWorkerError)
    coreBridge.destroy()
    hostBridge.destroy()
    storageBridge.destroy()
    chatCompletionStreamPort.destroy()
    workerStreamPort.destroy()
    stopDirectFallbackHost?.()
    stopHostFetch?.()
    if (typeof storageStop === 'function') storageStop()
    worker.terminate()
    throw new Error(`Taskyon browser worker failed during "${workerStage}".`, { cause: error })
  }
  worker.removeEventListener('message', onWorkerMessage)
  worker.removeEventListener('error', onWorkerError)

  return {
    client: taskyonClient,
    host: hostClient,
    storageClient,
    port: runtimePort.x,
    chatCompletionStream: chatCompletionStreamPort.port.receive,
    workerStream: workerStreamPort.port.receive,
    stop: (reason = 'stopping Taskyon browser runtime') => {
      taskyonClient.dispose()
      toolExecutor.destroy()
      coreBridge.destroy()
      hostBridge.destroy()
      storageBridge.destroy()
      chatCompletionStreamPort.destroy()
      workerStreamPort.destroy()
      stopDirectFallbackHost?.()
      stopHostFetch?.()
      if (typeof storageStop === 'function') storageStop()
      worker.terminate()
      void reason
    },
  }
}

export {
  createOpfsBlobStorageBackend,
  createOpfsStorageBackendResolver,
  createOpfsStorageRecordFileAdapter,
  createOpfsStorageService,
} from './storage'
export {
  clearBrowserDesignGraphGitRepositories,
  createBrowserDagGitRepository,
  synchronizeBrowserDesignGraph,
  type BrowserDagGitCredentials,
  type BrowserDesignGraphGitSettings,
} from './dagGitRepository'
export {
  deleteBrowserCryptoSession,
  initCryptoSessionFromBrowser,
  persistBrowserCryptoSession,
  type BrowserCryptoPersistence,
} from './persistentCryptoSession'
export {
  createIndexedDbBlobBackend,
  createIndexedDbRecordBackend,
  openTaskyonIndexedDb,
} from './indexedDbStorage'
export {
  createBrowserStoragePreferenceStore,
  selectBrowserStorageProvider,
  type BrowserStorageBackendKind,
  type BrowserStorageCapability,
  type BrowserStoragePreferenceStore,
} from './browserStorageSelection'
export {
  createTaskyonBrowserCoreRuntime,
  type TaskyonBrowserCoreRuntime,
  type TaskyonBrowserCoreRuntimeOptions,
} from './core'
export type { BrowserRuntimeStorageService, OpfsStorageOptions } from './storage'
export { createBrowserDagRunCodeCompiler } from './dagRunCodeCompiler'
export { createBrowserStoredGraphNodeLoader } from './storedGraphNodeLoader'
export {
  createTaskyonProviderFetch,
  createTaskyonProviderFetchWithTokenGetter,
  isHostedBrowserProviderRuntime,
  sanitizeProviderRequestHeaders,
} from './providerFetch'
export type { TaskyonBrowserProviderTransport, TaskyonDirectFallbackRequest } from './providerFetch'
export type { HostFetchContext } from './hostFetchBridge'
export {
  createCustomProxyFetch,
  createHostNetwork,
  resolveToolHostTransport,
  resolveHostTransport,
  HOST_NETWORK_TRANSPORTS,
} from './hostNetwork'
export type { HostNetworkSelection, HostNetworkTransport, HostProviderNetwork } from './hostNetwork'
