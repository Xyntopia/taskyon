import {
  createProtocolPort,
  getDatabase,
  getInMemoryDatabase,
  taskyonStorageProtocol,
  toolCall,
  type llmSettings,
  type partialTaskDraft,
} from '@taskyon/taskyon'
import { MessageChannelBridge } from '@taskyon/common/modules/frpBusWeb'
import { createTaskyonBrowserCoreRuntime } from './core'
import { initCryptoSessionFromBrowser } from './persistentCryptoSession'
import type { TaskyonBrowserWorkerInitMessage, TaskyonBrowserWorkerMessage } from './workerProtocol'

let stopCurrentRuntime: ((reason: string) => Promise<void>) | undefined

const defaultEntryNode = (settings: llmSettings): partialTaskDraft =>
  toolCall({
    name: settings.entryFunction || 'entryNode',
    arguments: {},
  })

self.onmessage = (event: MessageEvent<TaskyonBrowserWorkerInitMessage>) => {
  if (event.data.type !== 'init') return
  const {
    corePort,
    storagePort,
    hostPort,
    llmSettings,
    entryNode,
    toolchainConfig = {},
    storageNamespacePrefix,
    storageSessionId,
    persistCryptoSession = false,
    cryptoNamespace,
  } = event.data

  void (async () => {
    await stopCurrentRuntime?.('reinitializing Taskyon browser worker runtime')
    const storageBridge = createProtocolPort(taskyonStorageProtocol)
    const storageMessageBridge = MessageChannelBridge(storageBridge.y, storagePort)
    const persistentCrypto = persistCryptoSession
      ? initCryptoSessionFromBrowser(undefined, true, {
          namespace: cryptoNamespace ?? storageNamespacePrefix,
        })
      : undefined
    const runtime = createTaskyonBrowserCoreRuntime({
      llmSettings: () => llmSettings,
      entryNode: () => entryNode ?? defaultEntryNode(llmSettings),
      toolchainConfig,
      ...(persistentCrypto ? { cryptoSession: persistentCrypto } : {}),
      storageNamespacePrefix,
      ...(storageSessionId ? { storageSessionId } : {}),
      databaseFactory: persistCryptoSession ? getDatabase : getInMemoryDatabase,
      onStage: (stage) => {
        const response: TaskyonBrowserWorkerMessage = {
          type: 'runtimeStage',
          stage,
        }
        self.postMessage(response)
      },
      storage: {
        kind: 'client',
        port: storageBridge.x,
      },
    })
    const core = await runtime.taskyon
    const coreMessageBridge = MessageChannelBridge(runtime.port, corePort)
    const hostMessageBridge = MessageChannelBridge(core.hostPort, hostPort)
    stopCurrentRuntime = async (reason: string) => {
      await runtime.stop(reason)
      coreMessageBridge.destroy()
      hostMessageBridge.destroy()
      storageMessageBridge.destroy()
    }
  })().catch((error: unknown) => {
    const response: TaskyonBrowserWorkerMessage = {
      type: 'runtimeError',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    }
    self.postMessage(response)
  })
}
