import { githubIssuesTool } from '../../tools/githubIssuesTool'
import { createExternalToolContext } from '@taskyon/taskyon'
import { createCliWorkflowHost } from '../../cli'
import { createTaskyonInteractiveCliHost } from '../../taskyonHost'
import { createNodeWorkspaceOperations } from '../../tools/nodeWorkspaceOperations'
import { createInMemoryDatabasePool } from '../../../../taskyon/src/testSupport/inMemoryDatabasePool'
import { createPortableTestStorage } from '../../../../taskyon/src/testSupport/portableTestStorage'
import { createTaskyonClient, processTasksDetailed } from '@taskyon/taskyon/api'
import { createTool, toolCall } from '@taskyon/taskyon/types/toolApi'
import { tyCore } from '@taskyon/taskyon/core/init'

export const testCliNativeToolUsesRevisionScopedMediatedFetch = async () => {
  const databases = createInMemoryDatabasePool()
  const storage = createPortableTestStorage()
  const requests: string[] = []
  const permissions: Array<{ revision: string; access: string }> = []
  const tool = createTool({
    name: 'syntheticCliNetworkTool',
    description: 'Exercise native CLI fetch authorization with synthetic data.',
    parameters: { type: 'object', properties: {}, additionalProperties: false } as const,
    function: async (_args, context) => {
      if (!context.fetch) throw new Error('Missing CLI fetch capability')
      const read = await context.fetch('https://example.test/read')
      let denied = false
      try {
        await context.fetch('https://example.test/write', { method: 'POST', body: 'synthetic' })
      } catch {
        denied = true
      }
      return { body: await read.text(), denied }
    },
  })
  const host = createCliWorkflowHost({
    host: createTaskyonInteractiveCliHost(),
    projectInstructions: '',
    workspaceOperations: createNodeWorkspaceOperations(process.cwd()),
    explorationContextFiles: {},
    nativePythonExecutable: null,
    getReadline: () => undefined,
    authorizePython: () => Promise.resolve(false),
    authorizeFetch: ({ tool, capability }) => {
      if (capability.action !== 'fetch') return Promise.resolve(false)
      permissions.push({ revision: tool.revision, access: capability.access })
      return Promise.resolve(capability.access === 'read')
    },
    fetchWithPolicy: (input) => {
      requests.push(input instanceof Request ? input.url : String(input))
      return Promise.resolve(new Response('synthetic CLI response'))
    },
  })
  const ty = await tyCore(
    () => ({ entryFunction: 'entryNode' }),
    () => toolCall({ name: 'entryNode', arguments: {} }),
    {},
    undefined,
    {
      databaseFactory: databases.databaseFactory,
      taskManagerStorageFactory: storage.taskManagerStorageFactory,
      indexTaskVectors: false,
      toolSetup: {
        baseTools: [
          createTool({
            name: 'entryNode',
            description: 'Synthetic continuation',
            parameters: { type: 'object', properties: {}, additionalProperties: false } as const,
            function: () => undefined,
          }),
        ],
        chatCompletionToolName: 'chatCompletion',
        createSessionTools: () => ({ tools: [] }),
      },
    },
  )
  const client = createTaskyonClient(ty.port)
  const registration = await host.registerTools(ty, [], { tools: [tool], taskyonApi: client })
  try {
    const resolved = await client.tools.resolve({ name: tool.name })
    const result = await processTasksDetailed(ty.port)(
      [[toolCall({ name: tool.name, arguments: {} })]],
      'toolresult',
      { timeoutMs: 10_000, interruptOnSettle: (reason) => ty.cancelCurrentRun(reason) },
    )
    const data =
      result.status === 'matched' && result.result.content.type === 'toolresult'
        ? result.result.content.data
        : undefined
    if (
      !data ||
      typeof data !== 'object' ||
      !('body' in data) ||
      !('denied' in data) ||
      data.body !== 'synthetic CLI response' ||
      data.denied !== true
    )
      throw new Error('CLI did not enforce mediated read/write permissions')
    if (requests.length !== 1 || requests[0] !== 'https://example.test/read')
      throw new Error('Denied CLI request reached the transport')
    if (
      permissions.length !== 2 ||
      permissions.some((p) => p.revision !== resolved?.identity.revision)
    )
      throw new Error('CLI permissions were not scoped to the registered immutable revision')
  } finally {
    registration.destroy()
    client.dispose()
    await ty.dispose('synthetic CLI fetch diagnostic complete')
    storage.destroy()
    await databases.closeDatabases()
  }
}

export const testGithubToolRequiresInvocationFetch = async () => {
  let message = ''
  try {
    await githubIssuesTool.function(
      { action: 'listRepos' },
      createExternalToolContext(new AbortController().signal),
    )
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  if (!message.includes('fetch capability'))
    throw new Error('GitHub tool must fail before authentication without invocation fetch')
}

export const testGithubToolOAuthUsesInvocationFetch = async () => {
  const requests: string[] = []
  let message = ''
  const context = createExternalToolContext(new AbortController().signal, {
    fetch: (input) => {
      requests.push(input instanceof Request ? input.url : String(input))
      return Promise.reject(new Error('synthetic OAuth denial'))
    },
  })
  try {
    await githubIssuesTool.function(
      {
        action: 'listRepos',
        forceLogin: true,
        clientId: 'synthetic-client',
      },
      context,
    )
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  if (
    requests[0] !== 'https://github.com/login/device/code' ||
    message !== 'synthetic OAuth denial'
  )
    throw new Error('GitHub tool OAuth bypassed invocation fetch')
}
