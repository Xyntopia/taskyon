import {
  createProtocolPort,
  createStorageClient,
  createTaskyonClient,
  taskyonProtocol,
  taskyonStorageProtocol,
  type FunctionArguments,
  type InternalTool,
  type Port,
  type TaskyonMessageType,
  type llmSettings,
  type partialTaskDraft,
} from '@taskyon/taskyon/api'
import { MessageChannelBridge } from '@taskyon/common/modules/frpBusWeb'
import {
  createExternalToolContext,
  registerToolRpcTools,
  type ToolRpcCreateContext,
} from '@taskyon/taskyon/api'
import { startBrowserStorageService, type BrowserRuntimeStorageService } from './storage'
import type { TaskyonBrowserWorkerInitMessage, TaskyonBrowserWorkerMessage } from './workerProtocol'

export type TaskyonBrowserRuntimeOptions = {
  llmSettings: llmSettings
  entryNode?: partialTaskDraft
  toolchainConfig?: Record<string, FunctionArguments>
  tools?: InternalTool[]
  createTools?: (
    services: TaskyonBrowserRuntimeServices,
  ) => InternalTool[] | Promise<InternalTool[]>
  createToolContext?: ToolRpcCreateContext
  initialProviderKeys?: Readonly<Record<string, string | undefined>>
  readinessTimeoutMs?: number
  storage?: BrowserRuntimeStorageService
  storageSessionId?: string
  createWorker?: () => Worker
}

export type TaskyonBrowserRuntimeServices = {
  client: ReturnType<typeof createTaskyonClient>
  storageClient: ReturnType<typeof createStorageClient>
}

export type TaskyonBrowserRuntime = {
  client: ReturnType<typeof createTaskyonClient>
  storageClient: ReturnType<typeof createStorageClient>
  port: Port<TaskyonMessageType, TaskyonMessageType>
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
  const storagePort = createProtocolPort(taskyonStorageProtocol)
  const storageClient = createStorageClient(storagePort.x)
  const storageStop = await startBrowserStorageService(
    storagePort.y,
    options.storage ?? { kind: 'opfs' },
  )
  const coreChannel = new MessageChannel()
  const storageChannel = new MessageChannel()
  const coreBridge = MessageChannelBridge(runtimePort.y, coreChannel.port1)
  const storageBridge = MessageChannelBridge(storagePort.x, storageChannel.port1)
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
    storagePort: storageChannel.port2,
    llmSettings: options.llmSettings,
    ...(options.entryNode ? { entryNode: options.entryNode } : {}),
    toolchainConfig: options.toolchainConfig ?? {},
    initialProviderKeys: options.initialProviderKeys ?? {},
    ...(options.storageSessionId ? { storageSessionId: options.storageSessionId } : {}),
  }
  worker.postMessage(initMessage, [coreChannel.port2, storageChannel.port2])

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
    clearTimeout(workerInitializationTimeout)
    worker.removeEventListener('message', onWorkerMessage)
    worker.removeEventListener('error', onWorkerError)
    coreBridge.destroy()
    storageBridge.destroy()
    if (typeof storageStop === 'function') storageStop()
    worker.terminate()
    throw new Error(`Taskyon browser worker failed during "${workerStage}".`, { cause: error })
  }
  worker.removeEventListener('message', onWorkerMessage)
  worker.removeEventListener('error', onWorkerError)

  return {
    client: taskyonClient,
    storageClient,
    port: runtimePort.x,
    stop: (reason = 'stopping Taskyon browser runtime') => {
      toolExecutor.destroy()
      coreBridge.destroy()
      storageBridge.destroy()
      if (typeof storageStop === 'function') storageStop()
      worker.terminate()
      void reason
    },
  }
}

export {
  createOpfsStorageBackendResolver,
  createOpfsStorageRecordFileAdapter,
  createOpfsStorageService,
} from './storage'
export {
  createTaskyonBrowserCoreRuntime,
  type TaskyonBrowserCoreRuntime,
  type TaskyonBrowserCoreRuntimeOptions,
} from './core'
export type { BrowserRuntimeStorageService, OpfsStorageOptions } from './storage'
