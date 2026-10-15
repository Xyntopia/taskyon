import { createBrowserDagRunCodeCompiler } from './dagRunCodeCompiler'
import { createStorageDagRunCodeCompiler } from '@taskyon/comp-dag/designRepositorySnapshot'
import { createNativeDeviceRequester } from './nativeCryptoBridge'
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
import { createHostFetchRequester } from './hostFetchBridge'

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
    hostFetchPort,
    storageNamespacePrefix,
    storageSessionId,
    persistCryptoSession = false,
    cryptoNamespace,
    nativeDevicePort,
  } = event.data

  void (async () => {
    await stopCurrentRuntime?.('reinitializing Taskyon browser worker runtime')
    const directFallback = directFallbackPort
      ? createTaskyonDirectFallbackRequester(directFallbackPort)
      : undefined
    const hostFetch = hostFetchPort ? createHostFetchRequester(hostFetchPort) : undefined
    const providerFetch = providerTransport
      ? createTaskyonProviderFetch(providerTransport, {
          requestKind: 'chat-completion',
          ...(directFallback ? { approveDirectFallback: directFallback.request } : {}),
        })
      : undefined
    const storageBridge = createProtocolPort(taskyonStorageProtocol)
    const storageMessageBridge = MessageChannelBridge(storageBridge.y, storagePort)
    const nativeDevice = nativeDevicePort
      ? createNativeDeviceRequester(nativeDevicePort)
      : undefined
    const persistentCrypto =
      persistCryptoSession || nativeDevice
        ? initCryptoSessionFromBrowser(undefined, persistCryptoSession, {
            namespace: cryptoNamespace ?? storageNamespacePrefix,
            ...(nativeDevice ? { nativeDevice: nativeDevice.commands } : {}),
          })
        : undefined
    const dagCompiler = createBrowserDagRunCodeCompiler()
    const runtime = createTaskyonBrowserCoreRuntime({
      llmSettings: () => llmSettings,
      ...(event.data.sandboxFetchIdleTimeoutMs !== undefined
        ? { sandboxFetchIdleTimeoutMs: event.data.sandboxFetchIdleTimeoutMs }
        : {}),
      entryNode: () => entryNode ?? defaultEntryNode(llmSettings),
      toolchainConfig,
      ...(persistentCrypto ? { cryptoSession: persistentCrypto } : {}),
      storageNamespacePrefix,
      ...(storageSessionId ? { storageSessionId } : {}),
      databaseFactory: persistCryptoSession ? getDatabase : getInMemoryDatabase,
      onStage: (stage) => {
        console.log(`taskyon worker init stage: ${stage}`)
        const response: TaskyonBrowserWorkerMessage = {
          type: 'runtimeStage',
          stage,
        }
        self.postMessage(response)
      },
      onInitializationProgress: ({ step, phase, durationMs }) =>
        console.log(`taskyon worker init step: ${step} ${phase} ${Math.round(durationMs)}ms`),
      storage: {
        kind: 'client',
        port: storageBridge.x,
      },
      ...(hostFetch
        ? {
            authorizeSandboxFetch: ({ tool, capability }) => hostFetch.authorize(tool, capability),
            allowPrivateSandboxFetch: true,
            createFetchWithPolicy: () => (input, init, options) =>
              hostFetch.fetch({ kind: 'tool', ...(options ? { options } : {}) }, input, init),
          }
        : {}),
      toolSetup: (storageClient) =>
        createDefaultTaskyonToolSetup({
          storageClient,
          compileDagRunCode: createStorageDagRunCodeCompiler(storageClient, dagCompiler.compiler),
          ...(hostFetch
            ? {
                chatCompletionFetch: (connection) => (input, init) =>
                  hostFetch.fetch(
                    {
                      kind: 'provider',
                      providerId: connection.provider,
                      recommendation: connection.recommendedTransport ?? 'direct',
                    },
                    input,
                    init,
                  ),
              }
            : providerFetch
              ? { chatCompletionFetch: () => providerFetch }
              : {}),
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
        hostFetch?.stop()
        nativeDevice?.stop()
        dagCompiler.stop()
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
