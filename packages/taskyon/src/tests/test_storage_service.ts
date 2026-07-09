import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import { taskyonStorageProtocol } from '../api/storageProtocol'
import {
  connectTaskManagerStorageFromProtocol,
  createPgLiteTaskManagerStorageService,
  useTyTaskManager,
} from '../core/taskManager'
import { getDatabase } from '../utils/pglite.api'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testTaskManagerCanUseProtocolBackedStorage = async () => {
  const sessionId = `storage-service-diagnostic-${Date.now()}`
  const { x: storageClientPort, y: storageServicePort } = createProtocolPort(taskyonStorageProtocol)
  const unsubscribeStorageService = createPgLiteTaskManagerStorageService(
    storageServicePort,
    getDatabase,
  )

  try {
    const writer = await useTyTaskManager(await getDatabase(`${sessionId}-writer`), {
      indexTaskVectors: false,
      storage: connectTaskManagerStorageFromProtocol(storageClientPort, sessionId),
    })
    const reader = await useTyTaskManager(await getDatabase(`${sessionId}-reader`), {
      indexTaskVectors: false,
      storage: connectTaskManagerStorageFromProtocol(storageClientPort, sessionId),
    })

    const task = await writer.addPartialTask2Tree({
      role: 'user',
      content: {
        type: 'message',
        data: 'stored through protocol-backed task storage',
      },
    })
    const loadedTask = await reader.getTask(task.id)

    assert(loadedTask?.id === task.id, 'Expected second task manager to load the stored task')
    assert(
      loadedTask.content.type === 'message' &&
        loadedTask.content.data === 'stored through protocol-backed task storage',
      'Expected loaded task content to roundtrip through storage service',
    )
  } finally {
    unsubscribeStorageService()
  }
}

testTaskManagerCanUseProtocolBackedStorage.description =
  'Shares task records between task managers through the Taskyon storage protocol service.'
