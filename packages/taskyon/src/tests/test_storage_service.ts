import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import {
  createStorageClient,
  createStorageProtocolServer,
  taskyonStorageProtocol,
  type StorageRecordBackend,
} from '../api/storageProtocol'
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
    const missingTask = await reader.getTask('missing-task')

    assert(missingTask === null, 'Expected missing protocol-backed tasks to resolve as null')

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
testTaskManagerCanUseProtocolBackedStorage.timeoutMs = 60_000

export const testStorageAuthorizationDeniesBeforeBackendAccess = async () => {
  const { x: clientPort, y: servicePort } = createProtocolPort(taskyonStorageProtocol)
  let backendResolved = false
  const backend: StorageRecordBackend = {
    get: async () => null,
    getMany: async () => [],
    set: async () => undefined,
    setMany: async () => undefined,
    upsert: async (_id, value) => value,
    delete: async () => undefined,
    list: async () => [],
    listIds: async () => [],
    find: async () => ({}),
    clear: async () => undefined,
  }
  const stop = createStorageProtocolServer(
    servicePort,
    {
      records: () => {
        backendResolved = true
        return backend
      },
    },
    {
      mode: 'authorize',
      authorize: ({ namespace }) => namespace === 'allowed',
    },
  )
  const storage = createStorageClient(clientPort)

  try {
    let denied = false
    try {
      await storage.get({ namespace: 'denied', id: 'record' })
    } catch (error) {
      denied = error instanceof Error && error.message.includes('denied')
    }
    assert(denied, 'Expected the storage policy to deny the request')
    assert(!backendResolved, 'Expected denial before resolving the physical backend')
  } finally {
    stop()
  }
}

testStorageAuthorizationDeniesBeforeBackendAccess.description =
  'Denies storage protocol operations before resolving or touching a physical backend.'
