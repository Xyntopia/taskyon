import {
  createCryptoSession,
  createPgLiteTaskManagerStorageService,
  createTaskNode,
  toolCall,
} from '@taskyon/taskyon'
import {
  createMemoryStorageRecordBackend,
  createTaskyonHostClient,
  createTool,
  setTaskyonProviderCredential,
} from '@taskyon/taskyon/api'
import { createInMemoryDatabasePool } from '@taskyon/taskyon/test-support'
import { createEncryptedOauthSecretStore } from '@taskyon/taskyon/browser'
import { createStream } from '@taskyon/common/modules/frpBus'
import { createTaskyonBrowserCoreRuntime } from '../index'
import { initCryptoSessionFromBrowser } from '../persistentCryptoSession'
import { forwardStreamToMessagePort } from '../streamBridge'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

export const testBrowserRuntimeForwardsStreamEvents = async () => {
  const { stream, emit } = createStream<number>()
  const { port1, port2 } = new MessageChannel()
  const received: number[] = []
  const firstEvent = new Promise<number>((resolve) => {
    port1.addEventListener('message', (event: MessageEvent<number>) => {
      received.push(event.data)
      resolve(event.data)
    })
    port1.start()
  })
  let stopForwarding: (() => void) | undefined

  try {
    stopForwarding = forwardStreamToMessagePort(stream, port2)
    emit(42)
    assert((await firstEvent) === 42, 'Expected the stream event to reach the browser port.')
    stopForwarding()
    emit(43)
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert(received.length === 1, 'Expected stream forwarding to stop after cleanup.')
  } finally {
    stopForwarding?.()
    port1.close()
    port2.close()
  }
  return { success: true }
}

testBrowserRuntimeForwardsStreamEvents.description =
  'Forwards live runtime stream events through a browser MessagePort and cleans up safely.'

export const testBrowserCryptoSessionPersistsDeviceKey = async () => {
  if (!globalThis.indexedDB) {
    return { skipped: true, reason: 'IndexedDB is unavailable in this runtime.' }
  }
  const namespace = `diagnostics-${crypto.randomUUID()}`
  try {
    const firstSession = await initCryptoSessionFromBrowser(undefined, true, { namespace })
    const restoredSession = await initCryptoSessionFromBrowser(undefined, false, { namespace })
    assert(
      (await restoredSession.deviceId()) === (await firstSession.deviceId()),
      'Expected the browser crypto session to restore its persisted device key.',
    )
    return { success: true }
  } finally {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(`CryptoSession_${namespace}`)
      request.onsuccess = () => resolve()
      request.onerror = () =>
        reject(request.error ?? new Error('Synthetic crypto database deletion failed'))
    })
  }
}

testBrowserCryptoSessionPersistsDeviceKey.description =
  'Restores the same browser device key after persisting a crypto session.'

export const testBrowserRuntimePreservesTaskyonStorageAcrossRestart = async () => {
  const cryptoSession = await createCryptoSession()
  const sessionId = await cryptoSession.getSessionId()
  const createdRuntimes: ReturnType<typeof createTaskyonBrowserCoreRuntime>[] = []
  const storageNamespacePrefix = 'taskyon'
  const testDatabases = createInMemoryDatabasePool()
  const createRuntime = () => {
    const runtime = createTaskyonBrowserCoreRuntime({
      llmSettings: () => ({
        entryFunction: 'entryNode',
        taskWorker: { maxConcurrency: 1 },
      }),
      entryNode: () => toolCall({ name: 'entryNode', arguments: {} }),
      toolchainConfig: {},
      cryptoSession,
      databaseFactory: testDatabases.databaseFactory,
      indexTaskVectors: false,
      toolSetup: {
        baseTools: [],
        chatCompletionToolName: 'chatCompletion',
        createSessionTools: () => ({ tools: [] }),
      },
      storageNamespacePrefix,
      storage: {
        kind: 'service',
        createService: (port) =>
          createPgLiteTaskManagerStorageService(
            port,
            storageNamespacePrefix,
            testDatabases.databaseFactory,
          ),
      },
    })
    createdRuntimes.push(runtime)
    return runtime
  }

  try {
    const firstRuntime = createRuntime()
    await firstRuntime.taskyon
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
    await secondRuntime.taskyon
    await secondRuntime.client.taskModel.loadLineage(createdTask.id)
    assert(
      secondRuntime.client.taskModel.get(createdTask.id)?.content.data === createdTask.content.data,
      'Expected the restarted chat model to read through its storage capability',
    )
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
    try {
      await Promise.all(
        createdRuntimes.map((runtime) => runtime.stop('shared browser runtime diagnostic cleanup')),
      )
    } finally {
      await testDatabases.closeDatabases()
    }
  }
}

testBrowserRuntimePreservesTaskyonStorageAcrossRestart.description =
  'Starts Taskyon through the shared browser runtime and restores its persisted task after restart.'

export const testBrowserRuntimeProviderAuthKeepsOauthInHostStorage = async () => {
  const cryptoSession = await createCryptoSession()
  const databases = createInMemoryDatabasePool()
  const hostStorage = createMemoryStorageRecordBackend()
  const runtime = createTaskyonBrowserCoreRuntime({
    llmSettings: () => ({ entryFunction: 'entryNode' }),
    entryNode: () => toolCall({ name: 'entryNode', arguments: {} }),
    toolchainConfig: {},
    cryptoSession,
    databaseFactory: databases.databaseFactory,
    indexTaskVectors: false,
    toolSetup: {
      baseTools: [
        createTool({
          name: 'chatCompletion',
          description: 'Provider credential owner for this diagnostic.',
          parameters: { type: 'object', additionalProperties: false },
          function: () => undefined,
        }),
      ],
      chatCompletionToolName: 'chatCompletion',
      createSessionTools: () => ({ tools: [] }),
    },
    storage: {
      kind: 'service',
      createService: (port) =>
        createPgLiteTaskManagerStorageService(
          port,
          'taskyon',
          databases.databaseFactory,
          () => hostStorage,
        ),
    },
  })
  const runtimeClient = createTaskyonHostClient(runtime.hostPort)
  try {
    await runtime.taskyon
    const credentials = JSON.stringify({
      type: 'oauth-credentials',
      access_token: 'codex-access-token',
      service: 'https://auth.openai.com/oauth/token',
      created_at: Date.now(),
    })
    const oauthSecrets = createEncryptedOauthSecretStore(runtime.storageClient, cryptoSession)
    await oauthSecrets.setSecret('llm:chatgpt-codex', credentials)
    const stored = await oauthSecrets.getSecret('llm:chatgpt-codex')
    assert(
      stored === credentials,
      'Expected browser provider authentication to persist in encrypted host storage',
    )
    const raw = await runtime.storageClient.get({
      namespace: 'provider-auth/v1',
      id: 'oauth-credentials',
    })
    assert(
      raw.value !== null && !JSON.stringify(raw.value).includes('codex-access-token'),
      'Expected host storage to encrypt OAuth credentials at rest',
    )

    const beforeSet = await runtimeClient.providerCredentials.has({
      provider: 'chatgpt-codex',
    })
    assert(beforeSet.ok && !beforeSet.configured, 'Expected no worker credential before install')
    await setTaskyonProviderCredential(runtimeClient, 'chatgpt-codex', 'codex-access-token')
    const afterSet = await runtimeClient.providerCredentials.has({
      provider: 'chatgpt-codex',
    })
    assert(afterSet.ok && afterSet.configured, 'Expected the worker credential after install')

    await oauthSecrets.deleteSecret('llm:chatgpt-codex')
    const deleted = await oauthSecrets.getSecret('llm:chatgpt-codex')
    assert(deleted === null, 'Expected deleting host OAuth credentials to remove the secret')
  } finally {
    try {
      await runtime.stop('provider authentication diagnostic cleanup')
    } finally {
      await databases.closeDatabases()
    }
  }
}

testBrowserRuntimeProviderAuthKeepsOauthInHostStorage.description =
  'Keeps encrypted OAuth credentials in host storage and sends only the access token to Taskyon.'

const createEarlyRequestRuntime = (
  databaseFactory: ReturnType<typeof createInMemoryDatabasePool>['databaseFactory'],
) =>
  createTaskyonBrowserCoreRuntime({
    llmSettings: () => ({ entryFunction: 'entryNode' }),
    entryNode: () => toolCall({ name: 'entryNode', arguments: {} }),
    toolchainConfig: {},
    cryptoSession: createCryptoSession(),
    databaseFactory,
    indexTaskVectors: false,
    toolSetup: {
      baseTools: [],
      chatCompletionToolName: 'chatCompletion',
      createSessionTools: () => ({ tools: [] }),
    },
    storageNamespacePrefix: 'taskyon',
    storage: {
      kind: 'service',
      createService: async (port) => {
        await new Promise((resolve) => setTimeout(resolve, 0))
        return createPgLiteTaskManagerStorageService(port, 'taskyon', databaseFactory, () =>
          createMemoryStorageRecordBackend(),
        )
      },
    },
  })

export const testBrowserRuntimeDeliversHostRequestsIssuedBeforeReadiness = async () => {
  const databases = createInMemoryDatabasePool()
  const runtime = createEarlyRequestRuntime(databases.databaseFactory)
  try {
    const configuration = runtime.host.runtime.configure({ toolchainConfig: {} }).then(
      (result) => ({ ok: true as const, result }),
      (error: unknown) => ({ ok: false as const, error }),
    )
    await runtime.taskyon
    const outcome = await configuration
    if (!outcome.ok) throw outcome.error
    assert(outcome.result.ok, 'Expected the early host configuration to be accepted')
  } finally {
    try {
      await runtime.stop('early host request diagnostic cleanup')
    } finally {
      await databases.closeDatabases()
    }
  }
  return { success: true }
}

testBrowserRuntimeDeliversHostRequestsIssuedBeforeReadiness.description =
  'Delivers host requests issued while the browser runtime is still connecting.'

export const testBrowserRuntimeDeliversStorageRequestsIssuedBeforeReadiness = async () => {
  const databases = createInMemoryDatabasePool()
  const runtime = createEarlyRequestRuntime(databases.databaseFactory)
  try {
    const write = runtime.storageClient
      .set({
        namespace: 'early-writes',
        id: 'record',
        value: { hello: 'world' },
      })
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      )
    await runtime.taskyon
    const written = await write
    if (!written.ok) throw written.error
    const stored = await runtime.storageClient.get({ namespace: 'early-writes', id: 'record' })
    assert(
      stored.value !== null &&
        typeof stored.value === 'object' &&
        'hello' in stored.value &&
        stored.value.hello === 'world',
      'Expected the early storage write to persist after readiness',
    )
  } finally {
    try {
      await runtime.stop('early storage request diagnostic cleanup')
    } finally {
      await databases.closeDatabases()
    }
  }
  return { success: true }
}

testBrowserRuntimeDeliversStorageRequestsIssuedBeforeReadiness.description =
  'Delivers storage requests issued while the browser runtime is still connecting.'

export const testBrowserCryptoSessionRejectsUnusableStoredIdentity = async () => {
  if (!globalThis.indexedDB) return { skipped: true, reason: 'IndexedDB is unavailable.' }
  const namespace = `diagnostics-invalid-${crypto.randomUUID()}`
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(`CryptoSession_${namespace}`, 1)
    request.onupgradeneeded = () => request.result.createObjectStore('keys')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Synthetic database open failed'))
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('keys', 'readwrite')
      transaction.objectStore('keys').put(null, 'deviceKeyPair')
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(new Error('Synthetic null-key write failed'))
    })
    database.close()
    let rejected = false
    try {
      await initCryptoSessionFromBrowser(undefined, true, { namespace })
    } catch (error) {
      rejected = error instanceof Error && error.message.includes('refusing to replace')
    }
    assert(rejected, 'An unusable stored identity must fail instead of silently regenerating.')
  } finally {
    database.close()
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(`CryptoSession_${namespace}`)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(new Error('Synthetic database cleanup failed'))
    })
  }
  return { success: true }
}
testBrowserCryptoSessionRejectsUnusableStoredIdentity.description =
  'Fails closed when IndexedDB returns a stored but unusable device identity.'

export const testBrowserRuntimeClosesCryptoOwnerOnInitializationFailure = async () => {
  const session = await createCryptoSession()
  let closes = 0
  const runtime = createTaskyonBrowserCoreRuntime({
    llmSettings: () => ({ entryFunction: 'entryNode' }),
    entryNode: () => toolCall({ name: 'entryNode', arguments: {} }),
    toolchainConfig: {},
    toolSetup: {
      baseTools: [],
      chatCompletionToolName: 'chatCompletion',
      createSessionTools: () => ({ tools: [] }),
    },
    cryptoSession: {
      ...session,
      close: () => {
        closes += 1
        return Promise.resolve()
      },
    },
    storage: {
      kind: 'service',
      createService: () => Promise.reject(new Error('Synthetic storage startup failure')),
    },
  })
  let failed = false
  try {
    await runtime.taskyon
  } catch {
    failed = true
  }
  assert(failed, 'Expected the synthetic startup failure.')
  assert(closes === 1, 'Startup failure must release the supplied crypto owner exactly once.')
  return { success: true }
}
testBrowserRuntimeClosesCryptoOwnerOnInitializationFailure.description =
  'Releases an injected crypto owner when storage startup fails before core initialization.'
