import { createProtocolPort } from '@taskyon/common/modules/frpBus'
import {
  createStorageClient,
  createStorageProtocolServer,
  taskyonStorageProtocol,
  type StorageRecordBackend,
  type StorageRecordCodec,
} from '../api/storageProtocol'
import { storageValueContentHash } from '../api/storageRecordOperations'
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
  const storage = createStorageClient(storageClientPort, {
    namespacePrefix: 'taskyon-test',
    distribution: 'local-only',
  })

  try {
    const writer = await useTyTaskManager(await getDatabase(`${sessionId}-writer`), {
      indexTaskVectors: false,
      storage: connectTaskManagerStorageFromProtocol(storage, sessionId),
    })
    const reader = await useTyTaskManager(await getDatabase(`${sessionId}-reader`), {
      indexTaskVectors: false,
      storage: connectTaskManagerStorageFromProtocol(storage, sessionId),
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
    const compactTask = await reader.getTask(task.id)
    const loadedTask = await reader.getTask(task.id, { contentMode: 'hydrated' })
    const repeatedTask = await writer.addPartialTask2Tree({
      role: 'user',
      content: task.content,
      priorID: task.id,
    })
    const storedContents = await writer.getJsonTaskBackup()

    assert(loadedTask?.id === task.id, 'Expected second task manager to load the stored task')
    assert(
      loadedTask.content.type === 'message' &&
        loadedTask.content.data === 'stored through protocol-backed task storage',
      'Expected loaded task content to roundtrip through storage service',
    )
    assert(compactTask?.contentRef !== undefined, 'Expected default getTask to expose contentRef')
    assert(task.id !== repeatedTask.id, 'Expected repeated content to remain separate task calls')
    const archive = JSON.parse(storedContents) as { contents: Record<string, unknown> }
    assert(
      Object.keys(archive.contents).length === 1,
      'Expected repeated TaskContent to be stored once',
    )
    const scopedDefinition = {
      role: 'system' as const,
      content: {
        type: 'tooldefinition' as const,
        data: {
          name: 'scopedEcho',
          description: 'Scoped echo.',
          parameters: { type: 'object' as const, properties: {} },
          code: 'async () => undefined',
        },
      },
    }
    const declarationChain = await writer.addTaskChain([
      scopedDefinition,
      { role: 'assistant', content: { type: 'message', data: 'between declarations' } },
      scopedDefinition,
    ])
    assert(
      declarationChain.length === 3,
      'Expected persistence to preserve the submitted task-chain topology',
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
    get: () => Promise.resolve(null),
    getMany: () => Promise.resolve([]),
    set: () => Promise.resolve(),
    setIfUnchanged: (_id, _expectedStoredContentHash, value) =>
      Promise.resolve({
        written: true,
        currentStoredContentHash: storageValueContentHash(value),
      }),
    setMany: () => Promise.resolve(),
    upsert: (_id, value) => Promise.resolve(value),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    listIds: () => Promise.resolve([]),
    find: () => Promise.resolve({}),
    clear: () => Promise.resolve(),
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
      authorize: ({ namespace }) => namespace === 'authorization-test/allowed',
    },
  )
  const storage = createStorageClient(clientPort, {
    namespacePrefix: 'authorization-test',
    distribution: 'local-only',
  })

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

export const testPlaintextStorageRejectsRemoteDistribution = async () => {
  const { x: clientPort, y: servicePort } = createProtocolPort(taskyonStorageProtocol)
  let backendResolved = false
  const backend: StorageRecordBackend = {
    get: () => Promise.resolve(null),
    getMany: () => Promise.resolve([]),
    set: () => Promise.resolve(),
    setIfUnchanged: (_id, _expectedStoredContentHash, value) =>
      Promise.resolve({
        written: true,
        currentStoredContentHash: storageValueContentHash(value),
      }),
    setMany: () => Promise.resolve(),
    upsert: (_id, value) => Promise.resolve(value),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve([]),
    listIds: () => Promise.resolve([]),
    find: () => Promise.resolve({}),
    clear: () => Promise.resolve(),
  }
  const stop = createStorageProtocolServer(
    servicePort,
    {
      records: () => {
        backendResolved = true
        return backend
      },
    },
    { mode: 'trusted-local' },
  )
  const storage = createStorageClient(clientPort, {
    namespacePrefix: 'remote-policy-test',
    distribution: 'remote-allowed',
  })

  try {
    let rejected = false
    try {
      await storage.set({ namespace: 'policy', id: 'record', value: true })
    } catch (error) {
      rejected = error instanceof Error && error.message.includes('plaintext')
    }
    assert(rejected, 'Expected plaintext storage to reject remote distribution')
    assert(!backendResolved, 'Expected remote distribution rejection before backend access')
  } finally {
    stop()
  }
}

testPlaintextStorageRejectsRemoteDistribution.description =
  'Rejects remote eligibility when the configured coordinator only has plaintext storage.'

const createMemoryRecordBackend = (
  records: Map<string | number, unknown>,
): StorageRecordBackend => ({
  get: (id) => Promise.resolve(records.get(id) ?? null),
  getMany: (ids) =>
    Promise.resolve(ids.flatMap((id) => (records.has(id) ? [{ id, data: records.get(id) }] : []))),
  set: (id, value) => {
    records.set(id, value)
    return Promise.resolve()
  },
  setIfUnchanged: (id, expectedStoredContentHash, value) => {
    const current = records.get(id) ?? null
    const currentStoredContentHash = current === null ? null : storageValueContentHash(current)
    if (currentStoredContentHash !== expectedStoredContentHash) {
      return Promise.resolve({ written: false, currentStoredContentHash })
    }
    records.set(id, value)
    return Promise.resolve({
      written: true,
      currentStoredContentHash: storageValueContentHash(value),
    })
  },
  setMany: (rows) => {
    for (const { id, data } of rows) records.set(id, data)
    return Promise.resolve()
  },
  upsert: (id, value) => {
    records.set(id, value)
    return Promise.resolve(value)
  },
  delete: (id) => {
    records.delete(id)
    return Promise.resolve()
  },
  list: () => Promise.resolve([...records].map(([id, data]) => ({ id, data }))),
  listIds: () => Promise.resolve([...records.keys()]),
  find: () => Promise.resolve(Object.fromEntries(records)),
  clear: () => {
    records.clear()
    return Promise.resolve()
  },
})

export const testStorageClientAppliesNamespacePrefix = async () => {
  const namespaces: string[] = []
  const records = new Map<string, Map<string | number, unknown>>()
  const provider = {
    records: (namespace: string) => {
      namespaces.push(namespace)
      const stored = records.get(namespace) ?? new Map<string | number, unknown>()
      records.set(namespace, stored)
      return createMemoryRecordBackend(stored)
    },
  }
  const ports = createProtocolPort(taskyonStorageProtocol)
  const stop = createStorageProtocolServer(ports.y, provider, { mode: 'trusted-local' })

  try {
    const first = createStorageClient(ports.x, {
      namespacePrefix: 'taskyon/personal',
      distribution: 'local-only',
    })
    const second = createStorageClient(ports.x, {
      namespacePrefix: 'taskyon/team',
      distribution: 'local-only',
    })
    await first.set({ namespace: 'projects', id: 'same-key', value: 'personal' })
    await second.set({ namespace: 'projects', id: 'same-key', value: 'team' })
    assert(
      (await first.get({ namespace: 'projects', id: 'same-key' })).value === 'personal',
      'Expected the personal namespace prefix to retain its own value',
    )
    assert(
      (await second.get({ namespace: 'projects', id: 'same-key' })).value === 'team',
      'Expected the team namespace prefix to retain its own value',
    )
    assert(
      namespaces.includes('taskyon/personal/projects') &&
        namespaces.includes('taskyon/team/projects'),
      `Expected client-prefixed namespaces, received ${namespaces.join(', ')}`,
    )
  } finally {
    stop()
  }
}

testStorageClientAppliesNamespacePrefix.description =
  'Prefixes identical logical keys inside StorageClient rather than at domain call sites.'

export const testStorageClientRejectsRelativeNamespaceSegments = async () => {
  const ports = createProtocolPort(taskyonStorageProtocol)
  let backendResolved = false
  const stop = createStorageProtocolServer(
    ports.y,
    {
      records: () => {
        backendResolved = true
        return createMemoryRecordBackend(new Map())
      },
    },
    { mode: 'trusted-local' },
  )
  const storage = createStorageClient(ports.x, {
    namespacePrefix: 'taskyon/personal',
    distribution: 'local-only',
  })

  try {
    let rejected = false
    try {
      await storage.set({ namespace: '../escape', id: 'record', value: true })
    } catch (error) {
      rejected = error instanceof Error && error.message.includes('relative segments')
    }
    assert(rejected, 'Expected relative namespace segments to be rejected')
    assert(!backendResolved, 'Expected namespace rejection before backend access')
  } finally {
    stop()
  }
}

testStorageClientRejectsRelativeNamespaceSegments.description =
  'Rejects namespace traversal before a scoped request reaches a storage provider.'

export const testStorageCoordinatorTranslatesConditionalWriteHashes = async () => {
  const ports = createProtocolPort(taskyonStorageProtocol)
  const records = new Map<string | number, unknown>()
  let providerExpectedHash: string | null | undefined
  const backend = createMemoryRecordBackend(records)
  const codec: StorageRecordCodec = {
    remoteEligible: false,
    encode: (value) => ({ encoded: value }),
    decode: (stored) => {
      if (typeof stored !== 'object' || stored === null || !('encoded' in stored)) {
        throw new Error('Invalid test storage envelope')
      }
      return stored.encoded
    },
  }
  const stop = createStorageProtocolServer(
    ports.y,
    {
      records: () => ({
        ...backend,
        setIfUnchanged: (id, expectedStoredContentHash, value) => {
          providerExpectedHash = expectedStoredContentHash
          return backend.setIfUnchanged(id, expectedStoredContentHash, value)
        },
      }),
    },
    { mode: 'trusted-local' },
  )

  try {
    const storage = createStorageClient(ports.x, {
      namespacePrefix: 'taskyon/hash-test',
      distribution: 'local-only',
      recordCodec: codec,
    })
    await storage.set({ namespace: 'records', id: 'one', value: { count: 1 } })
    const current = await storage.get({ namespace: 'records', id: 'one' })
    const result = await storage.setIfUnchanged({
      namespace: 'records',
      id: 'one',
      expectedContentHash: current.contentHash,
      value: { count: 2 },
    })
    assert(result.written, 'Expected the logical conditional write to succeed')
    assert(
      providerExpectedHash === storageValueContentHash({ encoded: { count: 1 } }),
      'Expected the provider to compare the stored envelope hash',
    )
    assert(
      providerExpectedHash !== current.contentHash,
      'Expected logical and stored content hashes to remain distinct',
    )
  } finally {
    stop()
  }
}

testStorageCoordinatorTranslatesConditionalWriteHashes.description =
  'Translates logical conditional-write hashes into physical stored-envelope hashes.'
