import { readFile } from 'node:fs/promises'
import { createDesignRepositoryFileReader } from '@taskyon/comp-dag/designRepositorySnapshot'
import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import { createGraphRevision } from '@taskyon/comp-dag/designGraphModel'
import {
  createDesignGraphRepository,
  createStorageDesignGraphObjectStore,
} from '@taskyon/comp-dag/designGraphRepository'
import { createAiWorkstationExample } from '@taskyon/taskyon'
import { createDagGraphProjectTool } from '@taskyon/taskyon/tools/dagGraphProjectTool'
import { augmentToolSchemaForTaskyonVariables } from '@taskyon/taskyon/tools/chatCompletion/context'
import type { JSONSchema7 } from 'json-schema'

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
      readBlobRange: ({
        namespace,
        id,
        offset,
        length,
      }: {
        namespace: string
        id: string
        offset: number
        length: number
      }) => {
        const blob = blobs(namespace).get(id)
        if (!blob) throw new Error('Missing synthetic invocation artifact.')
        const data = blob.slice(offset, offset + length)
        const nextOffset = offset + data.byteLength
        return Promise.resolve({ data, nextOffset, eof: nextOffset >= blob.byteLength })
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

export const testDagGraphProjectAcceptsItsDocumentedNodeExample = async () => {
  const storage = createMemoryStorage()
  const tool = createDagGraphProjectTool(storage.client)
  const nodeSourceSchema = tool.parameters.properties?.nodeSource
  assert(
    nodeSourceSchema && typeof nodeSourceSchema === 'object',
    'Expected dagGraphProject to document the nodeSource parameter.',
  )
  const nodeSource = nodeSourceSchema.examples?.[0]
  assert(typeof nodeSource === 'string', 'Expected a runnable nodeSource example.')

  const result = await tool.function({
    action: 'createNode',
    nodeSource,
  })
  assert(result.type === 'dagGraphNodeCreated', 'Expected the documented node to be accepted.')
  return { success: true }
}

export const testDagGraphProjectExposesInvocationFieldSchemas = () => {
  const storage = createMemoryStorage()
  const parameters = augmentToolSchemaForTaskyonVariables(
    createDagGraphProjectTool(storage.client).parameters as JSONSchema7,
  )
  const actionSchema = parameters.properties?.action as JSONSchema7 | undefined
  assert(
    actionSchema?.description?.includes('returned nodeId as rootNodeId') &&
      actionSchema.description.includes('invocation hash'),
    'Expected the action schema to explain the node-to-project-to-run handoff.',
  )
  assert(
    !(parameters.required ?? []).includes('projectId'),
    'Expected projectId not to be globally required for global node creation.',
  )
  const variablesSchema = parameters.properties?.variables as JSONSchema7 | undefined
  const variableSpecSchema = variablesSchema?.additionalProperties
  assert(
    JSON.stringify(variablesSchema?.examples?.[0]) ===
      JSON.stringify({ gpuMemoryGb: { kind: 'list', values: [12, 16, 24] } }),
    'Expected variables to provide a concrete object example for model calls.',
  )
  assert(
    typeof variableSpecSchema === 'object' && Array.isArray(variableSpecSchema.anyOf),
    'Expected variables to expose the supported variable-spec variants.',
  )
  assert(
    !JSON.stringify(variableSpecSchema).includes('"default"'),
    'Expected tool-call variable schemas not to advertise defaults inside unions.',
  )

  const objectivesSchema = parameters.properties?.objectives as JSONSchema7 | undefined
  const objectiveSchema = objectivesSchema?.items
  assert(
    typeof objectiveSchema === 'object' &&
      Array.isArray(objectiveSchema.required) &&
      objectiveSchema.required.includes('target'),
    'Expected objectives to require the target structure used by invocation execution.',
  )
  const rootNodeIdSchema = parameters.properties?.rootNodeId
  assert(
    typeof rootNodeIdSchema === 'object' &&
      rootNodeIdSchema.description?.includes('nodeId returned by createNode') &&
      rootNodeIdSchema.description.includes('do not include a separate nodeId'),
    'Expected rootNodeId to explain how the createNode result is passed to createProject.',
  )
  assert(parameters.properties?.$use, 'Expected the Taskyon variable mapping to be available.')
  const createProjectRule = (parameters as JSONSchema7).anyOf?.find((rule) => {
    if (!rule || typeof rule !== 'object') return false
    const actionSchema = rule.properties?.action
    return typeof actionSchema === 'object' && actionSchema.const === 'createProject'
  })
  assert(
    createProjectRule &&
      typeof createProjectRule === 'object' &&
      createProjectRule.required?.includes('projectId') &&
      createProjectRule.anyOf?.some(
        (requirement) =>
          requirement &&
          typeof requirement === 'object' &&
          requirement.required?.includes('rootNodeId'),
      ) &&
      createProjectRule.anyOf?.some(
        (requirement) =>
          requirement && typeof requirement === 'object' && requirement.required?.includes('$use'),
      ),
    'Expected createProject to require a root or accept its Taskyon $use mapping.',
  )
  const createNodeRule = (parameters as JSONSchema7).anyOf?.find((rule) => {
    if (!rule || typeof rule !== 'object') return false
    const actionSchema = rule.properties?.action
    return typeof actionSchema === 'object' && actionSchema.const === 'createNode'
  })
  assert(
    createNodeRule &&
      typeof createNodeRule === 'object' &&
      createNodeRule.required?.includes('nodeSource') &&
      !createNodeRule.required?.includes('projectId'),
    'Expected global node creation to require source but not a project identifier.',
  )
  const readRowsRule = (parameters as JSONSchema7).anyOf?.find((rule) => {
    if (!rule || typeof rule !== 'object') return false
    const actionSchema = rule.properties?.action
    return typeof actionSchema === 'object' && actionSchema.const === 'readRunRows'
  })
  assert(
    readRowsRule &&
      typeof readRowsRule === 'object' &&
      readRowsRule.required?.includes('projectId') &&
      readRowsRule.required.includes('runId'),
    'Expected row reading to require a project and returned run ID.',
  )
  return { success: true }
}

export const testDagGraphProjectToolUsesUnifiedProjectAndInvocationModel = async () => {
  const storage = createMemoryStorage()
  const repositoryUrl = new URL(
    '../../../../../public/design-repositories/ai-workstation/',
    import.meta.url,
  )
  const paths = JSON.parse(
    await readFile(new URL('repository-index.json', repositoryUrl), 'utf8'),
  ) as string[]
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      content: await readFile(new URL(path, repositoryUrl), 'utf8'),
    })),
  )
  const reader = createDesignRepositoryFileReader(files)
  const example = await createAiWorkstationExample({
    readText: reader.readText,
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
    objectives: [{ direction: 'max', target: { path: 'recommendation.score', op: 'identity' } }],
    policy: { accuracy: 'exact', budget: { maxRows: 3 } },
  })
  assert(created.type === 'designProjectCreated', 'Expected project creation result.')
  assert(
    created.invocationName === 'main',
    'Expected project creation to return the name used to run its invocation.',
  )

  const designRepository = createDesignGraphRepository(
    createStorageDesignGraphObjectStore(storage.client),
  )
  const graphRef = await designRepository.getGraphRef('graph/main')
  const unrelatedGraph = createGraphRevision({ parents: [], nodes: {} })
  await designRepository.putGraphRevision(unrelatedGraph)
  await designRepository.advanceGraphRef({
    name: 'graph/main',
    revisionId: unrelatedGraph.id,
    expected: graphRef?.revisionId ?? null,
  })

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
  const firstPage = await tool.function({
    action: 'readRunRows',
    projectId: 'ai-workstation',
    runId: run.run.id,
    limit: 2,
  })
  assert(firstPage.type === 'designInvocationRows', 'Expected readable invocation rows.')
  assert(firstPage.rows.length === 2 && firstPage.hasMore, 'Expected a bounded first page.')
  const secondPage = await tool.function({
    action: 'readRunRows',
    projectId: 'ai-workstation',
    runId: run.run.id,
    startRow: 2,
    limit: 2,
  })
  assert(secondPage.type === 'designInvocationRows', 'Expected a second row page.')
  assert(secondPage.rows.length === 1 && !secondPage.hasMore, 'Expected the final row only.')
  const options = [...firstPage.rows, ...secondPage.rows]
  const scores = options.map((row) => row.objectives['objective-0'])
  assert(new Set(scores).size > 1, 'Expected distinct candidate scores to compare.')
  assert(
    scores.every((score) => typeof score === 'number'),
    'Expected numeric objectives.',
  )
  let oversizedRead: unknown
  try {
    await tool.function({
      action: 'readRunRows',
      projectId: 'ai-workstation',
      runId: run.run.id,
      limit: 100,
    })
  } catch (error) {
    oversizedRead = error
  }
  assert(oversizedRead instanceof Error, 'Expected oversized row pages to be rejected.')
  await tool.function({
    action: 'createProject',
    projectId: 'other-project',
    rootNodeId: example.rootHash,
  })
  let foreignProjectRead: unknown
  try {
    await tool.function({
      action: 'readRunRows',
      projectId: 'other-project',
      runId: run.run.id,
    })
  } catch (error) {
    foreignProjectRead = error
  }
  assert(
    foreignProjectRead instanceof Error,
    'Expected rows to be scoped to the project invocation.',
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

export const testProjectToolPreservesNestedProjectReferences = async () => {
  const storage = createMemoryStorage()
  const tool = createDagGraphProjectTool(storage.client)
  const created = await tool.function({
    action: 'createProject',
    projectId: 'templates/example',
    displayName: 'Synthetic example',
    rootNodeId: canonicalHash('synthetic-root'),
  })
  assert(created.type === 'designProjectCreated', 'Expected project creation.')
  const repository = createDesignGraphRepository(
    createStorageDesignGraphObjectStore(storage.client),
  )
  assert(
    await repository.getProjectRef('projects/templates/example'),
    'Nested project refs must not be rewritten into hyphenated names.',
  )
  const inspected = await tool.function({
    action: 'inspectProject',
    projectId: 'projects/templates/example',
  })
  assert(
    inspected.type === 'designProjectInspected',
    'Full project refs must be accepted without adding the prefix twice.',
  )
  return { success: true }
}

export const testProjectToolReusesExactInvocationDefinition = async () => {
  const storage = createMemoryStorage()
  const tool = createDagGraphProjectTool(storage.client)
  const source = await tool.function({
    action: 'createProject',
    projectId: 'source',
    rootNodeId: canonicalHash('synthetic-root'),
    variables: {
      nested: { kind: 'constant', value: { settings: { retained: true } } },
    },
  })
  assert(source.type === 'designProjectCreated', 'Expected source project.')
  const cloned = await tool.function({
    action: 'createProject',
    projectId: 'copy',
    invocationId: source.invocation.id,
  })
  assert(cloned.type === 'designProjectCreated', 'Expected copied project.')
  assert(
    cloned.invocation.id === source.invocation.id,
    'Reusing an invocation must preserve its exact identity, including nested parameters and source pins.',
  )
  return { success: true }
}

testDagGraphProjectToolUsesUnifiedProjectAndInvocationModel.description =
  'Creates and inspects an immutable project revision with one named invocation.'
