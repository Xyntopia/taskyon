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
  const tool = createStorageTool(storage.storageClient)
  const download = (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input)
    requests.push(url)
    return Promise.resolve(
      url.endsWith('/wanted.pdf')
        ? new Response('', { status: 404 })
        : new Response('%PDF-1.7 unrelated'),
    )
  }
  const context = createExternalToolContext(new AbortController().signal, {
    fetch: download,
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

export const testStorageDownloadRequiresInvocationFetch = async () => {
  const database = await createInMemoryDatabase('storage-invocation-fetch-test')
  const storage = await createStorage(database, ['reports'])
  const tool = createStorageTool(storage.storageClient)
  const requests: string[] = []
  const context = {
    ...createExternalToolContext(new AbortController().signal),
    fetch: (input: RequestInfo | URL) => {
      requests.push(input instanceof Request ? input.url : String(input))
      return Promise.resolve(new Response('%PDF-synthetic'))
    },
  }
  const args = {
    action: 'download' as const,
    namespace: 'reports',
    id: 'synthetic.pdf',
    url: 'https://example.test/synthetic.pdf',
    httpPolicy: { minDelayMs: 0 },
  }
  try {
    await tool.function(args, context)
    if (requests.length !== 1 || requests[0] !== args.url)
      throw new Error('Storage bypassed invocation fetch')
    let message = ''
    try {
      await tool.function(args, createExternalToolContext(new AbortController().signal))
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    if (!message.includes('fetch capability'))
      throw new Error('Storage must fail closed without invocation fetch')
  } finally {
    storage.destroy()
    await database.close()
  }
}

export const testStorageDownloadValidatesSplitPdfPrefixBeforePublication = async () => {
  const database = await createInMemoryDatabase('synthetic-streamed-pdf-test')
  const storage = await createStorage(database,['reports'])
  const tool = createStorageTool(storage.storageClient)
  let valid = true
  let cancelled = false
  const context = createExternalToolContext(new AbortController().signal, {
    fetch: (_input,init) => {
      if (init?.cache !== 'no-store') throw new Error('Download did not skip Taskyon cache')
      const chunks = valid ? ['%P','DF-','synthetic'] : ['<h','tml>','synthetic']
      const response = new Response(new ReadableStream({
        pull(controller) {
          const chunk = chunks.shift()
          if (chunk === undefined) controller.close()
          else controller.enqueue(new TextEncoder().encode(chunk))
        },
        cancel() { cancelled = true },
      },{ highWaterMark: 0 }))
      response.arrayBuffer = () => Promise.reject(new Error('Whole-response buffering is forbidden'))
      return Promise.resolve(response)
    },
  })
  const args = { action: 'download' as const,namespace: 'reports',id: 'synthetic.pdf',url: 'https://example.test/synthetic.pdf',httpPolicy: { minDelayMs: 0 } }
  try {
    await tool.function(args,context)
    valid = false
    let rejected = false
    try { await tool.function(args,context) } catch { rejected = true }
    if (!rejected || !cancelled) throw new Error('Invalid PDF stream was not cancelled')
    const stored = await storage.storageClient.getBlob({ namespace: 'reports',id: 'synthetic.pdf' })
    if (!stored || new TextDecoder().decode(stored.data) !== '%PDF-synthetic')
      throw new Error('Failed PDF download replaced the previous object')
  } finally { storage.destroy(); await database.close() }
}
