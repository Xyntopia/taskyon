import { parseSourceLockManifest } from '@taskyon/comp-dag/sourceManifest'
import type { Hash } from '@taskyon/comp-dag/caching'
import { fileURLToPath } from 'node:url'
import {
  createDesignRepositoryFileReader,
  loadDesignRepositoryNodeClosure,
} from '@taskyon/comp-dag/designRepositorySnapshot'
import { readDesignGraphSourceDirectory } from '@taskyon/comp-dag/designGraphSourcesNode'
import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import { createGraphRevision } from '@taskyon/comp-dag/designGraphModel'
import {
  createDesignGraphRepository,
  createStorageDesignGraphObjectStore,
} from '@taskyon/comp-dag/designGraphRepository'
import { createAiWorkstationExample, createExternalToolContext } from '@taskyon/taskyon'
import { createMediatedFetch } from '@taskyon/common/modules/webFetching/mediatedFetch'
import { createDagGraphProjectTool } from '@taskyon/taskyon/tools/dagGraphProjectTool'
import { augmentToolSchemaForTaskyonVariables } from '@taskyon/taskyon/tools/chatCompletion/context'
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema'
import {
  getDagNodeRecordClosure,
  savedStoredNodesToRecordGraph,
} from '@taskyon/comp-dag/dagNodeRecordGraph'
import { resolveAuthoredGraph } from '@taskyon/comp-dag/dagGraphAuthoring'
import { projectInputSourceDeclaration } from '@taskyon/comp-dag/projectInputSource'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertObjectSchema(
  schema: JSONSchema7Definition | undefined,
  message: string,
): asserts schema is JSONSchema7 {
  assert(
    schema !== undefined && schema !== null && typeof schema === 'object' && !Array.isArray(schema),
    message,
  )
}

const createMemoryStorage = () => {
  const rowsByNamespace = new Map<string, Map<string, unknown>>()
  const blobsByNamespace = new Map<string, Map<string, Uint8Array<ArrayBuffer>>>()
  const blobHashes = new Map<string, string>()
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
    blobsByNamespace,
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
        return Promise.resolve(
          data ? { id, size: data.byteLength, sha256: blobHashes.get(`${namespace}/${id}`) } : null,
        )
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
        blobHashes.set(`${namespace}/${targetId}`, expectedSha256)
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

export const testDagGraphProjectInspectionPreservesAuthoredLabels = async () => {
  const storage = createMemoryStorage()
  const tool = createDagGraphProjectTool(storage.client)
  await tool.function({
    action: 'createNode',
    nodeSource: `export default { formatVersion: 3, outputSchema: { type: 'number' },
      ids: { first: { label: 'First label', inputs: {} }, second: { label: 'Second label', inputs: {} } },
      run: () => 3 }`,
  })
  const inspected = await tool.function({ action: 'inspectGraph' })
  assert(inspected.type === 'dagGraphInspection', 'Expected graph inspection.')
  const first = inspected.bindings.find(({ id }) => id === 'first')
  const second = inspected.bindings.find(({ id }) => id === 'second')
  assert(first?.label === 'First label', 'The first label must come from its authored binding.')
  assert(
    second?.label === 'Second label',
    'Equivalent aliases must retain separate authored labels.',
  )
  assert(first.nodeId === second.nodeId, 'Labels must not change computation identity.')
}
testDagGraphProjectInspectionPreservesAuthoredLabels.description =
  'Graph inspection reads distinct authored labels for equivalent bindings from a compact-lock repository.'

export const testDagGraphProjectAcceptsItsDocumentedNodeExample = async () => {
  const storage = createMemoryStorage()
  const tool = createDagGraphProjectTool(storage.client)
  const nodeSourceSchema = tool.parameters.properties?.nodeSource
  assert(
    nodeSourceSchema && typeof nodeSourceSchema === 'object',
    'Expected dagGraphProject to document the nodeSource parameter.',
  )
  const nodeSourceExamples = nodeSourceSchema.examples
  assert(Array.isArray(nodeSourceExamples), 'Expected nodeSource to provide an example.')
  assert(
    nodeSourceExamples.some(
      (source) =>
        typeof source === 'string' &&
        source.includes("calculator: { source: 'score', role: 'internal' }") &&
        source.includes('use.calculator'),
    ),
    'Document a runnable file-to-internal-calculation composition with distinct binding and input names.',
  )
  assert(
    nodeSourceExamples.some(
      (source) => typeof source === 'string' && source.includes('services.fetch'),
    ),
    'Document an executable HTTP source at the authoring boundary.',
  )
  const createdIds: Hash[] = []
  for (const nodeSource of nodeSourceExamples) {
    assert(typeof nodeSource === 'string', 'Expected a runnable nodeSource example.')
    const result = await tool.function({ action: 'createNode', nodeSource })
    assert(result.type === 'dagGraphNodeCreated', 'Expected every documented node to be accepted.')
    createdIds.push(result.nodeId)
  }
  const rootNodeId = createdIds.at(-1)
  assert(rootNodeId, 'Expected the composed example root.')
  await tool.function({
    action: 'createProject',
    projectId: 'documented-composition',
    rootNodeId,
    variables: { path: { kind: 'constant', value: 'inputs/documented-composition/value.json' } },
  })
  await tool.function({
    action: 'importInputFile',
    projectId: 'documented-composition',
    inputPath: 'inputs/documented-composition/value.json',
    inputContent: '{"value":7}',
  })
  const run = await tool.function({ action: 'runInvocation', projectId: 'documented-composition' })
  assert(
    run.type === 'designInvocationRun' && run.run.status === 'completed',
    'The documented file/internal-calculation composition must execute.',
  )
  const rows = await tool.function({
    action: 'readRunRows',
    projectId: 'documented-composition',
    runId: run.run.id,
  })
  assert(
    rows.type === 'designInvocationRows' &&
      canonicalHash(rows.rows[0]?.outputs) === canonicalHash({ score: 7 }),
    'The example must forward the acquired value into its internal calculation.',
  )
  return { success: true }
}

export const testDagGraphProjectExposesInvocationFieldSchemas = () => {
  const storage = createMemoryStorage()
  const parameters = augmentToolSchemaForTaskyonVariables(
    createDagGraphProjectTool(storage.client).parameters as JSONSchema7,
  )
  const actionSchema = parameters.properties?.action
  assertObjectSchema(actionSchema, 'Expected action to have an object schema.')
  assert(
    actionSchema?.description?.includes('returned nodeId as rootNodeId') &&
      actionSchema.description.includes('invocation hash'),
    'Expected the action schema to explain the node-to-project-to-run handoff.',
  )
  assert(
    !(parameters.required ?? []).includes('projectId'),
    'Expected projectId not to be globally required for global node creation.',
  )
  const variablesSchema = parameters.properties?.variables
  assertObjectSchema(variablesSchema, 'Expected variables to have an object schema.')
  const variableSpecSchema = variablesSchema?.additionalProperties
  const variableExamples = variablesSchema.examples
  assert(Array.isArray(variableExamples), 'Expected variables to provide an object example.')
  assert(
    JSON.stringify(variableExamples[0]) ===
      JSON.stringify({ gpuMemoryGb: { kind: 'list', values: [12, 16, 24] } }),
    'Expected variables to provide a concrete object example for model calls.',
  )
  assert(
    variableSpecSchema !== undefined &&
      typeof variableSpecSchema === 'object' &&
      !Array.isArray(variableSpecSchema) &&
      Array.isArray(variableSpecSchema.anyOf),
    'Expected variables to expose the supported variable-spec variants.',
  )
  assert(
    !JSON.stringify(variableSpecSchema).includes('"default"'),
    'Expected tool-call variable schemas not to advertise defaults inside unions.',
  )

  const objectivesSchema = parameters.properties?.objectives
  assertObjectSchema(objectivesSchema, 'Expected objectives to have an object schema.')
  const objectiveSchema = objectivesSchema?.items
  assert(
    objectiveSchema !== undefined && !Array.isArray(objectiveSchema),
    'Expected objective items to have one object schema.',
  )
  assertObjectSchema(objectiveSchema, 'Expected objective items to have an object schema.')
  assert(
    typeof objectiveSchema === 'object' &&
      Array.isArray(objectiveSchema.required) &&
      objectiveSchema.required.includes('target'),
    'Expected objectives to require the target structure used by invocation execution.',
  )
  const rootNodeIdSchema = parameters.properties?.rootNodeId
  assertObjectSchema(rootNodeIdSchema, 'Expected rootNodeId to have an object schema.')
  assert(
    rootNodeIdSchema.description?.includes('nodeId returned by createNode') &&
      rootNodeIdSchema.description.includes('do not include a separate nodeId'),
    'Expected rootNodeId to explain how the createNode result is passed to createProject.',
  )
  assert(parameters.properties?.$use, 'Expected the Taskyon variable mapping to be available.')
  const createProjectRule = parameters.anyOf?.find((rule) => {
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
  const createNodeRule = parameters.anyOf?.find((rule) => {
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
  const readRowsRule = parameters.anyOf?.find((rule) => {
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
  const repositoryDirectory = fileURLToPath(
    new URL('../../../../../public/design-repositories/ai-workstation/', import.meta.url),
  )
  const files = await readDesignGraphSourceDirectory(repositoryDirectory)
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
  const authored = await resolveAuthoredGraph(
    files
      .filter((file) => file.path.startsWith('nodes/'))
      .map((file) => ({ path: file.path, source: file.content })),
  )
  const added = new Set<string>()
  for (const hash of getDagNodeRecordClosure(
    savedStoredNodesToRecordGraph(example.nodesByHash),
    example.rootHash,
  )) {
    const definition = authored.definitions.find((definition) =>
      Object.keys(definition.bindings).some((name) => authored.bindings[name] === hash),
    )
    if (!definition || added.has(definition.path)) continue
    const created = await tool.function({
      action: 'createNode',
      definitionPath: definition.path,
      nodeSource: definition.source,
    })
    assert(created.type === 'dagGraphNodeCreated', 'Expected node creation result.')
    assert(
      Object.values(created.nodeIds).includes(hash),
      'Expected content-addressed node identity.',
    )
    added.add(definition.path)
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
    storage.rowsByNamespace
      .get('design-graph/authoring-v1')
      ?.has('refs/projects/ai-workstation.json'),
    'Expected the stable project ref in the unified repository.',
  )
  return {
    projectRevisionId: inspected.project.id,
    invocationId: inspected.invocations.main.id,
    nodeCount: example.nodes.length,
  }
}

const createTestCalculation = async (tool: ReturnType<typeof createDagGraphProjectTool>) => {
  const node = await tool.function({
    action: 'createNode',
    nodeSource: `export default {
      formatVersion: 3,
      localParamsSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'number' },
      ids: { testCalculation: { inputs: {} } },
      run: async () => 1,
    }`,
  })
  assert(node.type === 'dagGraphNodeCreated', 'Expected a stored test calculation.')
  return node.nodeId
}

export const testProjectToolPreservesNestedProjectReferences = async () => {
  const storage = createMemoryStorage()
  const tool = createDagGraphProjectTool(storage.client)
  const rootNodeId = await createTestCalculation(tool)
  const created = await tool.function({
    action: 'createProject',
    projectId: 'templates/example',
    displayName: 'Synthetic example',
    rootNodeId,
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
  assert(
    inspected.invocations.main?.rootNodeId === rootNodeId,
    'The loaded study must reference the stored test calculation.',
  )
  return { success: true }
}

export const testProjectToolReusesExactInvocationDefinition = async () => {
  const storage = createMemoryStorage()
  const tool = createDagGraphProjectTool(storage.client)
  const rootNodeId = await createTestCalculation(tool)
  const source = await tool.function({
    action: 'createProject',
    projectId: 'source',
    rootNodeId,
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
  const inspected = await tool.function({ action: 'inspectProject', projectId: 'copy' })
  assert(inspected.type === 'designProjectInspected', 'Expected the copied project to load.')
  assert(
    inspected.invocations.main?.id === source.invocation.id &&
      inspected.invocations.main.rootNodeId === rootNodeId,
    'The loaded copy must retain the exact invocation and its stored calculation.',
  )
  return { success: true }
}

testDagGraphProjectToolUsesUnifiedProjectAndInvocationModel.description =
  'Creates and inspects an immutable project revision with one named invocation.'

export const testDagGraphProjectSourceFilesInvalidateAndPinnedRunsReopen = async () => {
  const storage = createMemoryStorage()
  const tool = createDagGraphProjectTool(storage.client)
  await tool.function({ action: 'createNode', nodeSource: projectInputSourceDeclaration })
  const node = await tool.function({
    action: 'createNode',
    nodeSource: `export default {
    formatVersion: 3,
    localParamsSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    inputsSchema: { data: { type: 'string' } }, outputSchema: { type: 'number' },
    ids: { parsedNumber: { inputs: { data: { source: 'projectInput' } } } },
    run: async ({ params, use }) => JSON.parse(await use.data({ path: params.path })).value,
  }`,
  })
  assert(node.type === 'dagGraphNodeCreated', 'Expected an authored consumer.')
  await tool.function({
    action: 'createProject',
    projectId: 'source-fixture',
    invocationName: 'source-data',
    rootNodeId: node.nodeId,
    variables: { path: { kind: 'constant', value: 'inputs/source-fixture/value.json' } },
  })
  let creationRejected = false
  try {
    await tool.function({
      action: 'createProject',
      projectId: 'source-fixture',
      invocationName: 'source-data',
      rootNodeId: node.nodeId,
    })
  } catch (error) {
    creationRejected = error instanceof Error && error.message.includes('saveInvocation')
  }
  assert(
    creationRejected,
    'Existing projects must direct the agent to saveInvocation without replacing their refs.',
  )
  await tool.function({
    action: 'importInputFile',
    projectId: 'source-fixture',
    inputPath: 'inputs/source-fixture/value.json',
    inputContent: '{"value":3}',
  })
  const first = await tool.function({
    action: 'runInvocation',
    projectId: 'source-fixture',
    invocationName: 'source-data',
  })
  assert(
    first.type === 'designInvocationRun' && first.run.status === 'completed',
    'Expected initial acquisition.',
  )
  assert(
    first.pinnedInvocationId && first.sourceSnapshotId,
    'A completed source run must provide a replay pin.',
  )
  assert(
    first.nextAction?.includes('source-data') &&
      first.nextAction.includes(first.pinnedInvocationId) &&
      first.nextAction.includes('runInvocation'),
    'Pinning guidance must preserve the named study and instruct replay before reading pinned rows.',
  )
  const initialRows = await tool.function({
    action: 'readRunRows',
    projectId: 'source-fixture',
    invocationName: 'source-data',
    runId: first.run.id,
  })
  assert(
    initialRows.type === 'designInvocationRows' && initialRows.rows[0]?.outputs === 3,
    'Expected source value.',
  )
  await createDagGraphProjectTool(storage.client).function({
    action: 'importInputFile',
    projectId: 'source-fixture',
    inputPath: 'inputs/source-fixture/value.json',
    inputContent: '{"value":8}',
  })
  const second = await tool.function({
    action: 'runInvocation',
    projectId: 'source-fixture',
    invocationName: 'source-data',
  })
  assert(
    second.type === 'designInvocationRun' && second.run.status === 'completed',
    'Expected reacquisition.',
  )
  assert(second.sourceSnapshotId, 'Changed source data must produce a replay snapshot.')
  const changedRows = await tool.function({
    action: 'readRunRows',
    projectId: 'source-fixture',
    invocationName: 'source-data',
    runId: second.run.id,
  })
  assert(
    changedRows.type === 'designInvocationRows' && changedRows.rows[0]?.outputs === 8,
    'File edits must invalidate consumers.',
  )
  assert(
    second.sourceSnapshotId !== first.sourceSnapshotId,
    'Changed observations require different snapshots.',
  )
  await tool.function({
    action: 'saveInvocation',
    projectId: 'source-fixture',
    invocationName: 'source-data',
    invocationId: first.pinnedInvocationId,
  })
  // Remove disposable execution products, preserving every captured source artifact.
  const protectedArtifacts = new Set<string>(
    [...storage.rowsByNamespace.get('dag/source-manifests')!.values()].map(
      (value) => parseSourceLockManifest(value).artifactHash,
    ),
  )
  storage.rowsByNamespace.get('dag/cache')?.clear()
  for (const id of storage.rowsByNamespace.get('dag/artifacts')?.keys() ?? [])
    if (!protectedArtifacts.has(id)) storage.rowsByNamespace.get('dag/artifacts')!.delete(id)
  for (const [namespace, records] of storage.rowsByNamespace)
    if (namespace === 'design-graph/authoring-v1')
      for (const id of records.keys())
        if (id.startsWith('runs/') || id.startsWith('attempts/')) records.delete(id)
  storage.blobsByNamespace.get('design-graph/v2/artifacts')?.clear()
  // Reopening must regenerate the run using the old captured input, not the changed live file.
  const reopened = createDagGraphProjectTool(storage.client)
  const replay = await reopened.function({
    action: 'runInvocation',
    projectId: 'source-fixture',
    invocationName: 'source-data',
  })
  assert(
    replay.type === 'designInvocationRun' && replay.run.status === 'completed',
    'Expected pinned replay.',
  )
  const rows = await reopened.function({
    action: 'readRunRows',
    projectId: 'source-fixture',
    invocationName: 'source-data',
    runId: replay.run.id,
  })
  assert(
    rows.type === 'designInvocationRows' && rows.rows[0]?.outputs === 3,
    'Pinned replay must retain its original bytes.',
  )
  assert(
    replay.sourceSnapshotId === first.sourceSnapshotId,
    'Pinned source identity must survive deletion of runs, output artifacts and calculation caches.',
  )
  await tool.function({
    action: 'createProject',
    projectId: 'other-source-fixture',
    rootNodeId: node.nodeId,
    variables: { path: { kind: 'constant', value: 'inputs/source-fixture/value.json' } },
  })
  const denied = await tool.function({ action: 'runInvocation', projectId: 'other-source-fixture' })
  assert(
    denied.type === 'designInvocationRun' && denied.run.status === 'failed',
    'Invocation file access must remain project scoped.',
  )
  assert(
    !denied.pinnedInvocationId && !denied.sourceSnapshotId,
    'A failed acquisition must not offer a partial replay pin.',
  )
  return { first: 3, changed: 8, replayed: 3 }
}

export const testDagGraphProjectHttpSourceUsesMediatedFetch = async () => {
  const storage = createMemoryStorage()
  const tool = createDagGraphProjectTool(storage.client)
  await tool.function({
    action: 'createNode',
    nodeSource: `export default {
      formatVersion: 3, effect: 'source', capabilities: [],
      localParamsSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'string' }, ids: { metadata: { inputs: {} } },
      run: async ({ services }) => {
        const response = await services.fetch('https://example.test/metadata', { method: 'GET' })
        return await response.text()
      },
    }`,
  })
  const node = await tool.function({
    action: 'createNode',
    nodeSource: `export default {
      formatVersion: 3, localParamsSchema: { type: 'object', properties: {} },
      inputsSchema: { metadata: { type: 'string' } }, outputSchema: { type: 'number' },
      ids: { count: { inputs: { metadata: { source: 'metadata' } } } },
      run: async ({ use }) => JSON.parse(await use.metadata({})).layers.length,
    }`,
  })
  assert(node.type === 'dagGraphNodeCreated', 'Expected source-backed calculation.')
  await tool.function({
    action: 'createProject',
    projectId: 'http-fixture',
    rootNodeId: node.nodeId,
  })
  let authorizations = 0
  let requests = 0
  const context = {
    ...createExternalToolContext(new AbortController().signal),
    fetch: createMediatedFetch({
      authorize: (capability) => {
        assert(capability.origin === 'https://example.test', 'Authorize only the requested origin.')
        assert(capability.access === 'read', 'GET must require read authorization.')
        authorizations += 1
        return Promise.resolve(true)
      },
      fetch: () => {
        requests += 1
        return Promise.resolve(new Response('{"layers":[{"id":0},{"id":1}]}'))
      },
    }),
  }
  const denied = await tool.function(
    { action: 'runInvocation', projectId: 'http-fixture' },
    {
      ...context,
      fetch: createMediatedFetch({
        authorize: () => Promise.resolve(false),
        fetch: () => {
          requests += 1
          return Promise.reject(new Error('Denied HTTP must not reach transport.'))
        },
      }),
    },
  )
  assert(
    denied.type === 'designInvocationRun' &&
      denied.run.status === 'failed' &&
      !denied.pinnedInvocationId &&
      !denied.sourceSnapshotId &&
      requests === 0,
    'The tool-context permission denial must fail without HTTP or a replay pin.',
  )
  const result = await tool.function(
    { action: 'runInvocation', projectId: 'http-fixture' },
    context,
  )
  assert(
    result.type === 'designInvocationRun' && result.run.status === 'completed',
    'HTTP source and its consumer must complete through the mediated service.',
  )
  assert(
    authorizations === 1 && requests === 1,
    'The source must authorize and fetch exactly once.',
  )
  assert(
    result.pinnedInvocationId && result.sourceSnapshotId,
    'The response must have a replay pin.',
  )
  const rows = await tool.function({
    action: 'readRunRows',
    projectId: 'http-fixture',
    runId: result.run.id,
  })
  assert(
    rows.type === 'designInvocationRows' && rows.rows[0]?.outputs === 2,
    'Count captured layers.',
  )
  const repeated = await tool.function(
    { action: 'runInvocation', projectId: 'http-fixture' },
    context,
  )
  assert(
    repeated.type === 'designInvocationRun' &&
      repeated.run.status === 'completed' &&
      repeated.sourceSnapshotId === result.sourceSnapshotId,
    'Repeating a completed source run must retain its acquired observation instead of pinning an empty snapshot.',
  )
  assert(requests === 1, 'A manual HTTP source must reuse its captured response.')
}
testDagGraphProjectHttpSourceUsesMediatedFetch.description =
  'HTTP sources with no host capabilities authorize mediated GET and pin their response through ordinary invocation execution.'

export const testDagGraphProjectInputReadsObserveIndependentClientWrites = async () => {
  const storage = createMemoryStorage()
  const reader = createStorageDesignGraphObjectStore(storage.client)
  const writer = createStorageDesignGraphObjectStore(storage.client)
  const path = 'inputs/synthetic-project/data.json'
  await reader.writeText(path, '{"value":1}')
  if ((await reader.readText(path)) !== '{"value":1}')
    throw new Error('Expected initial input contents.')
  await writer.writeText(path, '{"value":2}')
  if ((await reader.readText(path)) !== '{"value":2}')
    throw new Error('Mutable project inputs must not remain in the immutable object cache.')
}
testDagGraphProjectInputReadsObserveIndependentClientWrites.description =
  'A long-lived file source reader sees data changed by another browser/CLI/tool client without a catalog refresh.'
testDagGraphProjectSourceFilesInvalidateAndPinnedRunsReopen.description =
  'Creates and wires a file source through the real graph tool, verifies invalidation, and reopens its pinned invocation.'

export const testDagGraphProjectUsesHostCompiler = async () => {
  const storage = createMemoryStorage()
  const { createUncachedDagRunCodeCompiler, createLockedDagNodeRunCodeCompiler } =
    await import('@taskyon/comp-dag/dagModuleCompiler')
  const compiler = createUncachedDagRunCodeCompiler(createLockedDagNodeRunCodeCompiler())
  const compiledIds: string[] = []
  const tool = createDagGraphProjectTool(storage.client, undefined, {
    get: compiler.get,
    compile: async (input) => {
      compiledIds.push(input.nodeId)
      return await compiler.compile(input)
    },
  })
  const node = await tool.function({
    action: 'createNode',
    nodeSource: `export default { formatVersion: 3, localParamsSchema: { type: 'object', properties: {} }, outputSchema: { type: 'number' }, ids: { hostCompiled: {} }, run: async () => 9 }`,
  })
  assert(node.type === 'dagGraphNodeCreated', 'Expected a stored calculation.')
  await tool.function({
    action: 'createProject',
    projectId: 'host-compiler',
    rootNodeId: node.nodeId,
  })
  const run = await tool.function({ action: 'runInvocation', projectId: 'host-compiler' })
  assert(
    run.type === 'designInvocationRun' && run.run.status === 'completed',
    'The injected host compiler must run the saved invocation.',
  )
  const rows = await tool.function({
    action: 'readRunRows',
    projectId: 'host-compiler',
    runId: run.run.id,
  })
  assert(
    rows.type === 'designInvocationRows' && rows.rows[0]?.outputs === 9,
    'The compiled calculation must produce its actual result.',
  )
  const closure = await loadDesignRepositoryNodeClosure({
    readText: createStorageDesignGraphObjectStore(storage.client).readText,
    rootNodeId: node.nodeId,
  })
  const definitions = Object.values(closure.nodesByHash)
    .filter(({ node }) => !node.structure)
    .map(({ node }) => node.definitionHash ?? node.id)
  assert(
    definitions.length > 0 && definitions.every((id) => compiledIds.includes(id)),
    'Graph-tool execution must compile every stored definition through the host compiler.',
  )
  return { hostCompilerUsed: true, actualOutput: 9 }
}

export const testDagGraphProjectRejectsUnavailableRootBeforeSaving = async () => {
  const storage = createMemoryStorage()
  const tool = createDagGraphProjectTool(storage.client)
  const repository = createDesignGraphRepository(
    createStorageDesignGraphObjectStore(storage.client),
  )
  const node = await tool.function({
    action: 'createNode',
    nodeSource: `export default { formatVersion: 3, localParamsSchema: { type: 'object', properties: {} }, outputSchema: { type: 'number' }, ids: { availableRoot: {} }, run: async () => 1 }`,
  })
  assert(node.type === 'dagGraphNodeCreated', 'Expected an available root.')
  await tool.function({ action: 'createProject', projectId: 'valid-root', rootNodeId: node.nodeId })
  const before = await repository.getProjectRef('projects/valid-root')
  for (const action of ['saveInvocation', 'createProject'] as const) {
    let rejected = false
    try {
      await tool.function({
        action,
        projectId: action === 'saveInvocation' ? 'valid-root' : 'invalid-root',
        rootNodeId: canonicalHash('unavailable-root'),
      })
    } catch (error) {
      rejected = error instanceof Error && error.message.includes('inspectGraph')
    }
    assert(
      rejected,
      'Unavailable roots must fail before saving and direct chat to inspectGraph for the exact node hash.',
    )
    let invalidInvocationRejected = false
    try {
      await tool.function({
        action,
        projectId: action === 'saveInvocation' ? 'valid-root' : 'invalid-root',
        invocationId: canonicalHash('unavailable-invocation').slice(0, -1),
      })
    } catch (error) {
      invalidInvocationRejected =
        error instanceof Error && error.message.includes('complete pinnedInvocationId')
    }
    assert(
      invalidInvocationRejected,
      'A mistyped saved-invocation reference must identify the exact source field to copy without advancing the project.',
    )
  }
  assert(
    (await repository.getProjectRef('projects/valid-root'))?.revisionId === before?.revisionId,
    'A rejected root must preserve the saved project revision.',
  )
  assert(
    !(await repository.getProjectRef('projects/invalid-root')),
    'An unavailable root must not create a broken project.',
  )
  return { invalidRootRejected: true, existingProjectPreserved: true }
}

export const testDagGraphProjectInspectsScopedInputWithoutMutation = async () => {
  const storage = createMemoryStorage()
  const tool = createDagGraphProjectTool(storage.client)
  const root = await createTestCalculation(tool)
  await tool.function({ action: 'createProject', projectId: 'input-inspection', rootNodeId: root })
  const inputPath = 'inputs/input-inspection/list.json'
  const inputContent = '{"parcels":[{"reportApn":"synthetic-1","component":"solar"}]}'
  await tool.function({
    action: 'importInputFile',
    projectId: 'input-inspection',
    inputPath,
    inputContent,
  })
  const repository = createDesignGraphRepository(
    createStorageDesignGraphObjectStore(storage.client),
  )
  const before = await repository.getProjectRef('projects/input-inspection')
  const result = await tool.function({
    action: 'inspectProject',
    projectId: 'input-inspection',
    inputPath,
  })
  const input = 'input' in result ? result.input : undefined
  assert(
    input && input.path === inputPath && input.content === inputContent,
    'Inspect the exact logical input without a host filesystem read or study mutation.',
  )
  assert(
    (await repository.getProjectRef('projects/input-inspection'))?.revisionId ===
      before?.revisionId,
    'Input inspection must not advance the project.',
  )
  for (const path of ['inputs/other-project/list.json', 'inputs/input-inspection/../list.json']) {
    let rejected = false
    try {
      await tool.function({
        action: 'inspectProject',
        projectId: 'input-inspection',
        inputPath: path,
      })
    } catch {
      rejected = true
    }
    assert(rejected, 'Inspection must retain project and traversal boundaries.')
  }
  await tool.function({
    action: 'importInputFile',
    projectId: 'input-inspection',
    inputPath,
    inputContent: 'x'.repeat(65 * 1024),
  })
  let bounded = false
  try {
    await tool.function({ action: 'inspectProject', projectId: 'input-inspection', inputPath })
  } catch (error) {
    bounded = error instanceof Error && error.message.includes('64 KiB')
  }
  assert(
    bounded,
    'Large inputs must use the existing source execution path instead of unbounded chat inspection.',
  )
}
testDagGraphProjectInspectsScopedInputWithoutMutation.description =
  'Reads an existing small project input through scoped StorageClient access without changing studies, crossing project boundaries or returning unbounded text.'
