import { createPortableTestStorage } from '../testSupport/portableTestStorage'
import { createStorageTool } from '../tools/fileTools'
import { createExternalToolContext } from '../core/toolRpc'
import { createInMemoryDatabase } from '../utils/pglite.api'
import { createPgLiteStorageBlobBackend } from '../api/pgliteStorageBackend'

const createStorage = async (
  database: Awaited<ReturnType<typeof createInMemoryDatabase>>,
  namespaces: string[],
) => {
  const entries = await Promise.all(
    namespaces.map(async (namespace) => {
      const storageNamespace = `taskyon-test/${namespace}`
      return [
        storageNamespace,
        await createPgLiteStorageBlobBackend(database, storageNamespace),
      ] as const
    }),
  )
  const backends = new Map(entries)
  return createPortableTestStorage((namespace) => {
    const backend = backends.get(namespace)
    if (!backend) throw new Error(`No test blob backend for namespace "${namespace}".`)
    return backend
  })
}

export const testStorageRespectsExplicitTargetsAndGuards = async () => {
  const database = await createInMemoryDatabase('storage-target-test')
  const storage = await createStorage(database, ['scratch', 'reports'])
  const tool = createStorageTool(storage.storageClient)
  const context = createExternalToolContext(new AbortController().signal, {
    getExecutionTaskChain: () =>
      Promise.resolve([
        {
          id: 'user',
          role: 'user',
          content: {
            type: 'message',
            data: 'Save the report in namespace reports with object id final.pdf; delete scratch/temporary.txt afterwards.',
          },
        },
      ]),
  })
  try {
    for (const [namespace, id] of [
      ['scratch', 'temporary.txt'],
      ['reports', 'final.pdf'],
    ] as const) {
      await storage.storageClient.setBlob({ namespace, id, data: new Uint8Array([1]) })
    }
    await tool.function(
      { action: 'delete', namespace: 'scratch', id: 'temporary.txt', artifactRoot: 'scratch' },
      context,
    )
    if (!(await storage.storageClient.getBlob({ namespace: 'reports', id: 'final.pdf' }))) {
      throw new Error('Deleted the prose-inferred target instead of the explicit target')
    }
    if (await storage.storageClient.getBlob({ namespace: 'scratch', id: 'temporary.txt' })) {
      throw new Error('Did not delete the explicit target')
    }
    let rejected = false
    try {
      await tool.function(
        { action: 'delete', namespace: 'reports', id: 'final.pdf', artifactRoot: 'scratch' },
        context,
      )
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Task prose bypassed artifactRoot')
  } finally {
    storage.destroy()
    await database.close()
  }
}

export const testStorageDoesNotSubstituteConversationDownloads = async () => {
  const database = await createInMemoryDatabase('storage-download-test')
  const storage = await createStorage(database, ['scratch'])
  const requests: string[] = []
  const tool = createStorageTool(storage.storageClient, (input) => {
    const url = input instanceof Request ? input.url : String(input)
    requests.push(url)
    return Promise.resolve(
      url.endsWith('/wanted.pdf')
        ? new Response('', { status: 404 })
        : new Response('%PDF-1.7 unrelated'),
    )
  })
  const context = createExternalToolContext(new AbortController().signal, {
    getExecutionTaskChain: () =>
      Promise.resolve([
        {
          id: 'old',
          role: 'assistant',
          content: { type: 'message', data: 'Previous source: https://example.test/old.pdf' },
        },
      ]),
  })
  try {
    let rejected = false
    try {
      await tool.function(
        {
          action: 'download',
          namespace: 'scratch',
          id: 'wanted.pdf',
          url: 'https://example.test/wanted.pdf',
        },
        context,
      )
    } catch {
      rejected = true
    }
    if (!rejected || requests.length !== 1)
      throw new Error('Replaced a failed download with a different document')
    if (await storage.storageClient.getBlob({ namespace: 'scratch', id: 'wanted.pdf' }))
      throw new Error('Saved bytes after a failed download')
  } finally {
    storage.destroy()
    await database.close()
  }
}
