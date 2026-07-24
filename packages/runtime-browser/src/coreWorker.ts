import {
  createProtocolPort,
  getInMemoryDatabase,
  MessageChannelBridge,
  taskyonStorageProtocol,
  toolCall,
  type llmSettings,
  type partialTaskDraft,
} from '@taskyon/taskyon'
import { createTaskyonBrowserCoreRuntime } from './core'
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
    llmSettings,
    entryNode,
    toolchainConfig = {},
    initialProviderKeys = {},
    storageSessionId,
  } = event.data

  void (async () => {
    await stopCurrentRuntime?.('reinitializing Taskyon browser worker runtime')
    const storageBridge = createProtocolPort(taskyonStorageProtocol)
    const storageMessageBridge = MessageChannelBridge(storageBridge.y, storagePort)
    const runtime = createTaskyonBrowserCoreRuntime({
      llmSettings: () => llmSettings,
      entryNode: () => entryNode ?? defaultEntryNode(llmSettings),
      toolchainConfig,
      initialProviderKeys,
      ...(storageSessionId ? { storageSessionId } : {}),
      databaseFactory: getInMemoryDatabase,
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
    const coreMessageBridge = MessageChannelBridge(runtime.port, corePort)
    stopCurrentRuntime = async (reason: string) => {
      await runtime.stop(reason)
      coreMessageBridge.destroy()
      storageMessageBridge.destroy()
    }
    await runtime.taskyon
  })().catch((error: unknown) => {
    const response: TaskyonBrowserWorkerMessage = {
      type: 'runtimeError',
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    }
    self.postMessage(response)
  })
}
