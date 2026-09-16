import {
  createProtocolPort,
  taskyonStorageProtocol,
  toolCall,
  type llmSettings,
  type partialTaskDraft,
} from '@taskyon/taskyon/api'
import { getDatabase, getInMemoryDatabase } from '@taskyon/taskyon/db'
import { MessageChannelBridge } from '@taskyon/common/modules/frpBusWeb'
import { createTaskyonBrowserCoreRuntime } from './core'
import { initCryptoSessionFromBrowser } from './persistentCryptoSession'
import { createDefaultTaskyonToolSetup } from '@taskyon/taskyon/tools'
import type { TaskyonBrowserWorkerInitMessage, TaskyonBrowserWorkerMessage } from './workerProtocol'
import { createTaskyonProviderFetch } from './providerFetch'
import { forwardStreamToMessagePort } from './streamBridge'
import { createTaskyonDirectFallbackRequester } from './directFallbackProtocol'

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
    hostPort,
    storagePort,
    chatCompletionStreamPort,
    workerStreamPort,
    llmSettings,
    entryNode,
    toolchainConfig = {},
    providerTransport,
    directFallbackPort,
    storageNamespacePrefix,
    storageSessionId,
    persistCryptoSession = false,
    cryptoNamespace,
  } = event.data

  void (async () => {
    await stopCurrentRuntime?.('reinitializing Taskyon browser worker runtime')
    const directFallback = directFallbackPort
      ? createTaskyonDirectFallbackRequester(directFallbackPort)
      : undefined
    const providerFetch = providerTransport
      ? createTaskyonProviderFetch(providerTransport, {
          requestKind: 'chat-completion',
          ...(directFallback ? { approveDirectFallback: directFallback.request } : {}),
        })
      : undefined
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
      toolSetup: (storageClient) =>
        createDefaultTaskyonToolSetup({
          storageClient,
          ...(providerFetch ? { chatCompletionFetch: providerFetch } : {}),
        }),
    })
    const taskyon = await runtime.taskyon
    const unsubscribeChatCompletionStream = chatCompletionStreamPort
      ? forwardStreamToMessagePort(taskyon.chatCompletionStream, chatCompletionStreamPort)
      : () => {}
    const unsubscribeWorkerStream = workerStreamPort
      ? forwardStreamToMessagePort(taskyon.workerStream, workerStreamPort)
      : () => {}
    const coreMessageBridge = MessageChannelBridge(runtime.port, corePort)
    const hostMessageBridge = MessageChannelBridge(runtime.hostPort, hostPort)
    stopCurrentRuntime = async (reason: string) => {
      try {
        await runtime.stop(reason)
      } finally {
        unsubscribeChatCompletionStream()
        unsubscribeWorkerStream()
        coreMessageBridge.destroy()
        hostMessageBridge.destroy()
        storageMessageBridge.destroy()
        directFallback?.destroy()
        chatCompletionStreamPort?.close()
        workerStreamPort?.close()
      }
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
