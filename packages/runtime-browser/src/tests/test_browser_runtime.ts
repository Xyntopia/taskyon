import {
  createCryptoSession,
  createPgLiteTaskManagerStorageService,
  createTaskNode,
  getDatabase,
  toolCall,
} from '@taskyon/taskyon'
import {
  createMemoryStorageRecordBackend,
  createTaskyonHostClient,
  createTool,
  setTaskyonProviderCredential,
} from '@taskyon/taskyon/api'
import { createEncryptedOauthSecretStore } from '@taskyon/taskyon/browser'
import { createTaskyonBrowserCoreRuntime } from '../index'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

export const testBrowserRuntimePreservesTaskyonStorageAcrossRestart = async () => {
  const cryptoSession = await createCryptoSession()
  const sessionId = await cryptoSession.getSessionId()
  const createdRuntimes: ReturnType<typeof createTaskyonBrowserCoreRuntime>[] = []
  const storageNamespacePrefix = 'taskyon'
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
      storageNamespacePrefix,
      storage: {
        kind: 'service',
        createService: (port) =>
          createPgLiteTaskManagerStorageService(port, storageNamespacePrefix, getDatabase),
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
    await Promise.all(
      createdRuntimes.map((runtime) => runtime.stop('shared browser runtime diagnostic cleanup')),
    )
  }
}

testBrowserRuntimePreservesTaskyonStorageAcrossRestart.description =
  'Starts Taskyon through the shared browser runtime and restores its persisted task after restart.'

export const testBrowserRuntimeProviderAuthKeepsOauthInHostStorage = async () => {
  const cryptoSession = await createCryptoSession()
  const hostStorage = createMemoryStorageRecordBackend()
  const runtime = createTaskyonBrowserCoreRuntime({
    llmSettings: () => ({ entryFunction: 'entryNode' }),
    entryNode: () => toolCall({ name: 'entryNode', arguments: {} }),
    toolchainConfig: {},
    cryptoSession,
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
        createPgLiteTaskManagerStorageService(port, 'taskyon', getDatabase, () => hostStorage),
    },
  })
  const runtimeClient = createTaskyonHostClient(runtime.hostPort)
  await runtime.taskyon
  const credentials = JSON.stringify({
    type: 'oauth-credentials',
    access_token: 'codex-access-token',
    service: 'https://auth.openai.com/oauth/token',
    created_at: Date.now(),
  })
  const oauthSecrets = createEncryptedOauthSecretStore(runtime.storageClient, cryptoSession)

  try {
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
    await runtime.stop('provider authentication diagnostic cleanup')
  }
}

testBrowserRuntimeProviderAuthKeepsOauthInHostStorage.description =
  'Keeps encrypted OAuth credentials in host storage and sends only the access token to Taskyon.'
