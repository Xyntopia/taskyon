import {
  createCryptoSession,
  createPgLiteTaskManagerStorageService,
  createTaskNode,
  getDatabase,
  toolCall,
} from '@taskyon/taskyon'
import { createTaskyonBrowserCoreRuntime } from '../index'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

export const testBrowserRuntimePreservesTaskyonStorageAcrossRestart = async () => {
  const cryptoSession = await createCryptoSession()
  const sessionId = await cryptoSession.getSessionId()
  const createdRuntimes: ReturnType<typeof createTaskyonBrowserCoreRuntime>[] = []
  const createRuntime = () => {
    const runtime = createTaskyonBrowserCoreRuntime({
      llmSettings: () => ({
        entryFunction: 'entryNode',
        taskWorker: { maxConcurrency: 1 },
      }),
      entryNode: () => toolCall({ name: 'entryNode', arguments: {} }),
      toolchainConfig: {},
      cryptoSession,
      indexTaskVectors: false,
      toolSetup: {
        baseTools: [],
        chatCompletionToolName: 'chatCompletion',
        createSessionTools: () => ({ tools: [] }),
      },
      storage: {
        kind: 'service',
        createService: (port) => createPgLiteTaskManagerStorageService(port, getDatabase),
      },
    })
    createdRuntimes.push(runtime)
    return runtime
  }

  try {
    const firstRuntime = createRuntime()
    const createdTask = await createTaskNode({
      role: 'user',
      content: {
        type: 'message',
        data: 'persisted through the shared browser runtime',
      },
    })
    await firstRuntime.client.task.createChain({
      tasks: [createdTask],
      execute: false,
      show: false,
    })
    const storedTask = await firstRuntime.storageClient.get({
      namespace: `${sessionId}/taskyonNodes`,
      id: createdTask.id,
    })
    assert(
      storedTask.value &&
        typeof storedTask.value === 'object' &&
        'id' in storedTask.value &&
        storedTask.value.id === createdTask.id,
      'Expected the runtime storage client to read from the core task storage service',
    )

    await firstRuntime.stop('restart shared browser runtime diagnostic')
    createdRuntimes.pop()

    const secondRuntime = createRuntime()
    const restoredTask = await secondRuntime.client.task.get({ id: createdTask.id })
    assert(
      restoredTask?.id === createdTask.id,
      'Expected the restarted runtime to restore the task',
    )
    assert(
      restoredTask.content.type === 'message' &&
        restoredTask.content.data === 'persisted through the shared browser runtime',
      'Expected the restored task content to match the original task',
    )
  } finally {
    await Promise.all(
      createdRuntimes.map((runtime) => runtime.stop('shared browser runtime diagnostic cleanup')),
    )
  }
}

testBrowserRuntimePreservesTaskyonStorageAcrossRestart.description =
  'Starts Taskyon through the shared browser runtime and restores its persisted task after restart.'
