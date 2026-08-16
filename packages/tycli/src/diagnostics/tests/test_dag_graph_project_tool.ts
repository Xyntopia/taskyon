import { readFile } from 'node:fs/promises'
import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import { createAiWorkstationExample } from '@taskyon/taskyon'
import { createDagGraphProjectTool } from '@taskyon/taskyon/tools/dagGraphProjectTool'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const createMemoryStorage = () => {
  const rowsByNamespace = new Map<string, Map<string, unknown>>()
  const blobsByNamespace = new Map<string, Map<string, Uint8Array<ArrayBuffer>>>()
  const writes = new Map<string, Uint8Array<ArrayBuffer>>()
  const rows = (namespace: string) => {
    const existing = rowsByNamespace.get(namespace) ?? new Map<string, unknown>()
    rowsByNamespace.set(namespace, existing)
    return existing
  }
  const blobs = (namespace: string) => {
    const existing = blobsByNamespace.get(namespace) ?? new Map<string, Uint8Array<ArrayBuffer>>()
    blobsByNamespace.set(namespace, existing)
    return existing
  }
  return {
    rowsByNamespace,
    client: {
      get: ({ namespace, id }: { namespace: string; id: string | number }) =>
        Promise.resolve({
          value: rows(namespace).get(String(id)) ?? null,
          contentHash: rows(namespace).has(String(id))
            ? canonicalHash(rows(namespace).get(String(id)))
            : null,
        }),
      set: ({
        namespace,
        id,
        value,
      }: {
        namespace: string
        id: string | number
        value: unknown
      }) => {
        rows(namespace).set(String(id), value)
        return Promise.resolve()
      },
      setIfUnchanged: ({
        namespace,
        id,
        expectedContentHash,
        value,
      }: {
        namespace: string
        id: string | number
        expectedContentHash: string | null
        value: unknown
      }) => {
        const records = rows(namespace)
        const current = records.get(String(id)) ?? null
        const currentContentHash = current === null ? null : canonicalHash(current)
        if (currentContentHash !== expectedContentHash) {
          return Promise.resolve({ written: false, currentContentHash })
        }
        records.set(String(id), value)
        return Promise.resolve({ written: true, currentContentHash: canonicalHash(value) })
      },
      list: ({ namespace }: { namespace: string }) =>
        Promise.resolve({
          rows: [...rows(namespace)].map(([id, data]) => ({ id, data })),
        }),
      statBlob: ({ namespace, id }: { namespace: string; id: string }) => {
        const data = blobs(namespace).get(id)
        return Promise.resolve(data ? { id, size: data.byteLength } : null)
      },
      beginBlobWrite: ({ id }: { id: string }) => {
        const writeId = `write-${id}`
        writes.set(writeId, new Uint8Array())
        return Promise.resolve({ writeId })
      },
      writeBlobChunk: ({
        writeId,
        offset,
        data,
      }: {
        writeId: string
        offset: number
        data: Uint8Array<ArrayBuffer>
      }) => {
        const previous = writes.get(writeId)
        if (!previous || previous.byteLength !== offset)
          throw new Error('Invalid staged write offset.')
        const next = new Uint8Array(previous.byteLength + data.byteLength)
        next.set(previous)
        next.set(data, previous.byteLength)
        writes.set(writeId, next)
        return Promise.resolve({ nextOffset: next.byteLength })
      },
      commitBlobWrite: ({
        namespace,
        targetId,
        writeId,
        expectedSha256,
      }: {
        namespace: string
        targetId: string
        writeId: string
        expectedSha256: string
      }) => {
        const data = writes.get(writeId)
        if (!data) throw new Error('Missing staged write.')
        blobs(namespace).set(targetId, data)
        writes.delete(writeId)
        return Promise.resolve({ id: targetId, size: data.byteLength, sha256: expectedSha256 })
      },
      abortBlobWrite: ({ writeId }: { writeId: string }) => {
        writes.delete(writeId)
        return Promise.resolve()
      },
    },
  }
}

export const testDagGraphProjectToolUsesUnifiedProjectAndInvocationModel = async () => {
  const storage = createMemoryStorage()
  const repositoryUrl = new URL(
    '../../../../../public/design-repositories/ai-workstation/',
    import.meta.url,
  )
  const example = await createAiWorkstationExample({
    readText: async (path) => await readFile(new URL(path, repositoryUrl), 'utf8'),
  })
  const exampleInvocationId = example.revision.invocations.main
  const exampleInvocation = exampleInvocationId
    ? example.invocations[exampleInvocationId]
    : undefined
  assert(exampleInvocation, 'Expected the example main invocation.')
  const tool = createDagGraphProjectTool(storage.client)
  for (const node of example.nodes) {
    const created = await tool.function({
      action: 'createNode',
      projectId: 'ai-workstation',
      nodeSource: node.file.source,
    })
    assert(created.type === 'dagGraphNodeCreated', 'Expected node creation result.')
    assert(created.nodeId === node.hash, 'Expected content-addressed node identity.')
  }

  const created = await tool.function({
    action: 'createProject',
    projectId: 'ai-workstation',
    displayName: 'AI workstation',
    rootNodeId: example.rootHash,
    variables: {
      'requirements.budgetUsd': { kind: 'constant', value: 5500 },
      'requirements.model': { kind: 'constant', value: 'llama-3.1-8b' },
    },
    inputs: exampleInvocation.inputs,
    policy: { accuracy: 'exact', budget: { maxRows: 2 } },
  })
  assert(created.type === 'designProjectCreated', 'Expected project creation result.')

  const inspected = await tool.function({
    action: 'inspectProject',
    projectId: 'ai-workstation',
  })
  assert(inspected.type === 'designProjectInspected', 'Expected project inspection result.')
  assert(inspected.project.displayName === 'AI workstation', 'Expected project display name.')
  assert(inspected.invocations.main, 'Expected the named main invocation.')
  const run = await tool.function({ action: 'runInvocation', projectId: 'ai-workstation' })
  assert(run.type === 'designInvocationRun', 'Expected invocation run result.')
  assert(
    run.run.status === 'completed',
    `Expected the invocation to complete: ${run.run.error ?? run.run.status}`,
  )
  assert(
    storage.rowsByNamespace.get('design-graph/v2')?.has('refs/projects/ai-workstation.json'),
    'Expected the stable project ref in the unified repository.',
  )
  return {
    projectRevisionId: inspected.project.id,
    invocationId: inspected.invocations.main.id,
    nodeCount: example.nodes.length,
  }
}

testDagGraphProjectToolUsesUnifiedProjectAndInvocationModel.description =
  'Creates and inspects an immutable project revision with one named invocation.'
