import type { GraphData } from '@taskyon/common/modules/graph'
import type { Hash } from '@taskyon/comp-dag/caching'
import {
  createGraphRevision,
  createInvocationDefinition,
  type GraphRevision,
  type InvocationDefinition,
  type InvocationRun,
  type ProjectRevision,
} from '@taskyon/comp-dag/designGraphModel'
import type {
  DesignGraphObjectStore,
  DesignGraphRepository,
} from '@taskyon/comp-dag/designGraphRepository'
import {
  createUrlDesignRepositoryReader,
  loadDesignRepositorySnapshot,
  loadProjectRepositorySnapshot,
} from '@taskyon/comp-dag/designRepositorySnapshot'
import {
  compileDagNodeRecordGraph,
  getDagNodeRecordClosure,
  getDagNodeRecordInputSchema,
  getDagNodeRecordRelations,
  savedStoredNodesToRecordGraph,
  type DagNodeRecordGraph,
} from '@taskyon/comp-dag/dagNodeRecordGraph'
import { loadStoredGraphNodeFiles, type StoredGraphNodeFile } from '@taskyon/comp-dag/dagNodeLoader'
import { recordInputsToRuntimeInputs } from '@taskyon/comp-dag/dagNodeRecord'
import type { DagJsonSchema } from '@taskyon/comp-dag/dagSchema'
import {
  executeInvocation,
  type InvocationArtifactStore,
  type InvocationRow,
} from '@taskyon/comp-dag/invocationExecution'
import { createWithDefaults } from '@taskyon/taskyon'
import { toDagExploreInputs } from '@taskyon/comp-dag/runtime/runPlanner'
import type { JSONSchema7 } from 'json-schema'

export type DesignGraphPort = {
  name: string
  type: string
  role: 'parameter' | 'internal' | 'exposed'
}

export type DesignGraphNodeData = {
  kind: 'computation'
  hash: Hash
  localName: string
  inputs: DesignGraphPort[]
  outputType: string
  selectedRoot: boolean
}

export type DesignGraphRecordData =
  | DesignGraphNodeData
  | { kind: 'project-revision'; hash: Hash }
  | { kind: 'parent-project-revision'; hash: Hash }
  | { kind: 'invocation'; hash: Hash; name: string; rootNodeId: Hash; selected: boolean }
  | { kind: 'ref'; name: string; revisionId: Hash }

export type DesignCheckout = { kind: 'ref'; name: string } | { kind: 'revision'; id: Hash }

export type DesignWorkspaceProject = {
  checkout: DesignCheckout
  revision: ProjectRevision
  invocationName: string
  invocation: InvocationDefinition
  files: StoredGraphNodeFile[]
  graph: Awaited<ReturnType<typeof loadStoredGraphNodeFiles>>
  records: DagNodeRecordGraph
  compiledRoot: ReturnType<typeof compileDagNodeRecordGraph>[Hash]
  graphData: GraphData<DesignGraphRecordData, { alias: string }>
}

export type DesignNodeViewerData = {
  hash: Hash
  label: string
  localName: string
  path: string
  source: string
  inputSchema: DagJsonSchema
  outputSchema: DagJsonSchema
  upstream: Array<{ hash: Hash; label: string; localName: string }>
  downstream: Array<{ hash: Hash; label: string; localName: string }>
}

const schemaTypeSummary = (schema: DagJsonSchema, depth = 0): string => {
  if (schema === true) return 'unknown'
  if (schema === false) return 'never'
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.slice(0, 3).map(String).join(' | ')
  }
  const variants = schema.oneOf ?? schema.anyOf
  if (variants?.length) {
    return [
      ...new Set(variants.slice(0, 3).map((variant) => schemaTypeSummary(variant, depth + 1))),
    ].join(' | ')
  }
  if (schema.type === 'array') {
    const item = Array.isArray(schema.items) ? schema.items[0] : schema.items
    return `${item ? schemaTypeSummary(item, depth + 1) : 'unknown'}[]`
  }
  if (schema.type === 'object') {
    const properties = Object.entries(schema.properties ?? {})
    if (depth > 0 || properties.length === 0) return 'object'
    const fields = properties
      .slice(0, 3)
      .map(([name, field]) => `${name}: ${schemaTypeSummary(field, depth + 1)}`)
    return `{ ${fields.join('; ')}${properties.length > 3 ? '; …' : ''} }`
  }
  if (!schema.type) return 'unknown'
  return typeof schema.type === 'string' ? schema.type : [...schema.type].join(' | ')
}

const nodeInputPorts = (records: DagNodeRecordGraph, hash: Hash): DesignGraphPort[] => {
  const record = records[hash]!
  const runtimeInputs = recordInputsToRuntimeInputs(record)
  const dependencies = [
    ...Object.entries(runtimeInputs.hiddenInputs).map(([name, input]) => ({
      name,
      type: schemaTypeSummary(records[input.nodeId]!.outputSchema),
      role: 'internal' as const,
    })),
    ...Object.entries(runtimeInputs.exposedInputs).map(([name, input]) => {
      const nodeIds = 'kind' in input ? input.nodeIds : [input.nodeId]
      return {
        name,
        type: [
          ...new Set(nodeIds.map((nodeId) => schemaTypeSummary(records[nodeId]!.outputSchema))),
        ].join(' | '),
        role: 'exposed' as const,
      }
    }),
  ]
  const parameterType = schemaTypeSummary(record.localParamsSchema)
  return parameterType === 'object'
    ? dependencies
    : [{ name: 'params', type: parameterType, role: 'parameter' }, ...dependencies]
}

const nodeFiles = async (store: DesignGraphObjectStore): Promise<StoredGraphNodeFile[]> =>
  await Promise.all(
    (await store.list('nodes'))
      .filter((name) => name.endsWith('.ts'))
      .map(async (name) => ({
        path: `nodes/${name}`,
        source: await store.readText(`nodes/${name}`),
      })),
  )

const projectBaseUrl = (projectId: string) =>
  new URL(`/design-repositories/${projectId}/`, location.origin)

export const prepareBundledDesignProject = async (args: {
  projectId: string
  store: DesignGraphObjectStore
  repository: DesignGraphRepository
}): Promise<{ graph: GraphRevision; project: ProjectRevision }> => {
  const readText = createUrlDesignRepositoryReader({
    baseUrl: projectBaseUrl(args.projectId),
    fetch,
  })
  const [graphSnapshot, projectSnapshot] = await Promise.all([
    loadDesignRepositorySnapshot({ readText, checkout: { kind: 'ref', name: 'graph/main' } }),
    loadProjectRepositorySnapshot({
      readText,
      checkout: { kind: 'ref', name: 'projects/template' },
    }),
  ])
  for (const file of graphSnapshot.files) await args.store.writeText(file.path, file.source)
  await args.repository.putGraphRevision(graphSnapshot.revision)
  for (const invocation of Object.values(projectSnapshot.invocations)) {
    await args.repository.putInvocation(invocation)
  }
  for (const extension of Object.values(projectSnapshot.extensions)) {
    await args.repository.putExtension(extension)
  }
  await args.repository.putProjectRevision(projectSnapshot.revision)

  const currentGraphRef = await args.repository.getGraphRef('graph/main')
  const currentGraph = currentGraphRef
    ? await args.repository.getGraphRevision(currentGraphRef.revisionId)
    : null
  const mergedGraph = currentGraph
    ? createGraphRevision({
        parents: [currentGraph.id, graphSnapshot.revision.id],
        nodes: { ...currentGraph.nodes, ...graphSnapshot.revision.nodes },
      })
    : graphSnapshot.revision
  await args.repository.putGraphRevision(mergedGraph)
  await args.repository.advanceGraphRef({
    name: 'graph/main',
    revisionId: mergedGraph.id,
    expected: currentGraphRef?.revisionId ?? null,
  })
  return { graph: mergedGraph, project: projectSnapshot.revision }
}

export const ensureBundledDesignProject = async (args: {
  projectId: string
  store: DesignGraphObjectStore
  repository: DesignGraphRepository
  refName?: string
}): Promise<ProjectRevision> => {
  const refName = args.refName ?? `projects/${encodeURIComponent(args.projectId)}`
  const current = await args.repository.getProjectRef(refName)
  if (current) return await args.repository.getProjectRevision(current.revisionId)
  const prepared = await prepareBundledDesignProject(args)
  await args.repository.advanceProjectRef({
    name: refName,
    revisionId: prepared.project.id,
    expected: null,
  })
  return prepared.project
}

export const loadDesignWorkspaceProject = async (args: {
  store: DesignGraphObjectStore
  repository: DesignGraphRepository
  checkout: DesignCheckout
  invocationName?: string
}): Promise<DesignWorkspaceProject> => {
  let revisionId: Hash
  if (args.checkout.kind === 'revision') {
    revisionId = args.checkout.id
  } else {
    const ref = await args.repository.getProjectRef(args.checkout.name)
    if (!ref) throw new Error(`Project ref not found: ${args.checkout.name}`)
    revisionId = ref.revisionId
  }
  const revision = await args.repository.getProjectRevision(revisionId)
  const invocationName = args.invocationName ?? Object.keys(revision.invocations)[0]
  if (!invocationName) throw new Error(`Project revision ${revision.id} has no invocations.`)
  const invocationId = revision.invocations[invocationName]
  if (!invocationId) throw new Error(`Project invocation not found: ${invocationName}`)
  const invocation = await args.repository.getInvocation(invocationId)
  const files = await nodeFiles(args.store)
  const graph = await loadStoredGraphNodeFiles(files)
  const records = savedStoredNodesToRecordGraph(graph)
  const compiled = compileDagNodeRecordGraph({ graph: records, rootHash: invocation.rootNodeId })
  const compiledRoot = compiled[invocation.rootNodeId]
  if (!compiledRoot) throw new Error(`Compiled project root not found: ${invocation.rootNodeId}`)
  const closure = getDagNodeRecordClosure(records, invocation.rootNodeId)
  const computationNodes = closure.map((hash) => ({
    id: hash,
    label: records[hash]!.label,
    type: hash === invocation.rootNodeId ? 'root' : 'node',
    data: {
      kind: 'computation' as const,
      localName: records[hash]!.localName,
      hash,
      inputs: nodeInputPorts(records, hash),
      outputType: schemaTypeSummary(records[hash]!.outputSchema),
      selectedRoot: hash === invocation.rootNodeId,
    },
  }))
  const computationEdges = closure.flatMap((hash) =>
    Object.entries(records[hash]!.inputs ?? {}).flatMap(([alias, input]) => {
      const nodeIds = 'kind' in input ? input.nodeIds : [input.nodeId]
      return nodeIds.map((source) => ({
        id: `${source}:${hash}:${alias}`,
        source,
        target: hash,
        label: alias,
        type: 'kind' in input ? 'choice' : 'dependency',
        data: { alias },
      }))
    }),
  )
  const revisionNodeId = `project-revision:${revision.id}`
  const invocationNodes = await Promise.all(
    Object.entries(revision.invocations).map(async ([name, id]) => {
      const definition = id === invocation.id ? invocation : await args.repository.getInvocation(id)
      return {
        id: `invocation:${id}`,
        label: name,
        type: 'invocation',
        data: {
          kind: 'invocation' as const,
          hash: id,
          name,
          rootNodeId: definition.rootNodeId,
          selected: id === invocation.id,
        },
      }
    }),
  )
  const recordNodes: DesignWorkspaceProject['graphData']['nodes'] = [
    ...revision.parents.map((parent) => ({
      id: `project-revision:${parent}`,
      label: 'Parent project revision',
      type: 'parent-project-revision',
      data: { kind: 'parent-project-revision' as const, hash: parent },
    })),
    {
      id: revisionNodeId,
      label: revision.displayName,
      type: 'project-revision',
      data: { kind: 'project-revision', hash: revision.id },
    },
    ...invocationNodes,
    ...(args.checkout.kind === 'ref'
      ? [
          {
            id: `ref:${args.checkout.name}`,
            label: args.checkout.name,
            type: 'ref',
            data: { kind: 'ref' as const, name: args.checkout.name, revisionId: revision.id },
          },
        ]
      : []),
  ]
  const recordEdges: DesignWorkspaceProject['graphData']['edges'] = [
    ...revision.parents.map((parent) => ({
      id: `project-revision:${parent}:${revisionNodeId}`,
      source: `project-revision:${parent}`,
      target: revisionNodeId,
      type: 'revision-parent',
      label: 'parent',
      data: { alias: 'parent' },
    })),
    ...invocationNodes.flatMap((node) => [
      {
        id: `${node.id}:${revisionNodeId}`,
        source: node.id,
        target: revisionNodeId,
        type: 'project-invocation',
        label: node.data.name,
        data: { alias: node.data.name },
      },
      {
        id: `${node.data.rootNodeId}:${node.id}`,
        source: node.data.rootNodeId,
        target: node.id,
        type: 'invocation-root',
        label: 'root',
        data: { alias: 'root' },
      },
    ]),
    ...(args.checkout.kind === 'ref'
      ? [
          {
            id: `${revisionNodeId}:ref:${args.checkout.name}`,
            source: revisionNodeId,
            target: `ref:${args.checkout.name}`,
            type: 'project-ref',
            label: 'points to',
            data: { alias: args.checkout.name },
          },
        ]
      : []),
  ]
  return {
    checkout: args.checkout,
    revision,
    invocationName,
    invocation,
    files,
    graph,
    records,
    compiledRoot,
    graphData: {
      nodes: [...computationNodes, ...recordNodes],
      edges: [...computationEdges, ...recordEdges],
    },
  }
}

export const designNodeViewerData = (
  project: DesignWorkspaceProject,
  hash: Hash,
): DesignNodeViewerData => {
  const saved = project.graph[hash]
  if (!saved) throw new Error(`Design graph node not found: ${hash}`)
  const relations = getDagNodeRecordRelations(project.records, hash)
  const relationData = (nodeHash: Hash) => {
    const node = project.records[nodeHash]
    if (!node) throw new Error(`Design graph node not found: ${nodeHash}`)
    return { hash: nodeHash, label: node.label, localName: node.localName }
  }
  return {
    hash,
    label: saved.node.label,
    localName: saved.node.localName,
    path: saved.file.path,
    source: saved.file.source,
    inputSchema: getDagNodeRecordInputSchema(project.records, hash),
    outputSchema: saved.node.outputSchema,
    upstream: relations.upstream.map(relationData),
    downstream: relations.downstream.map(relationData),
  }
}

export const defaultDesignParams = (project: DesignWorkspaceProject): Record<string, unknown> =>
  createWithDefaults(project.compiledRoot.paramsSchema as JSONSchema7)

const flattenParams = (
  value: Record<string, unknown>,
  prefix = '',
): Record<string, { kind: 'constant'; value: unknown }> =>
  Object.fromEntries(
    Object.entries(value).flatMap(([name, child]) => {
      const path = prefix ? `${prefix}.${name}` : name
      return child && typeof child === 'object' && !Array.isArray(child)
        ? Object.entries(flattenParams(child as Record<string, unknown>, path))
        : [[path, { kind: 'constant' as const, value: child }]]
    }),
  )

const invocationRowEvaluator = (
  project: DesignWorkspaceProject,
  invocation: InvocationDefinition,
) =>
  async function evaluateRows(args: {
    params: Record<string, unknown>
    maxRows?: number
    signal?: AbortSignal
    onRow: (row: {
      outputs: unknown
      captured?: Record<string, unknown>
      inputSelection?: {
        rowKey: Record<string, string | number>
        sourceIndexByAlias: Record<string, number>
      }
    }) => Promise<void>
  }) {
    if (args.signal?.aborted) throw new Error('Invocation cancelled.')
    const inputs = toDagExploreInputs(invocation.inputs)
    const studyParams = Object.fromEntries(
      Object.keys(invocation.inputs).map((alias) => [alias, args.params[alias] ?? {}]),
    )
    await project.compiledRoot.call({ ...args.params, ...studyParams }).study({
      ...(invocation.objectives[0]?.target.op === 'identity'
        ? {
            mode: 'optimize' as const,
            objective: {
              path: invocation.objectives[0].target.path,
              direction: invocation.objectives[0].direction,
            },
          }
        : {}),
      ...(inputs ? { inputs } : {}),
      capture: invocation.capture.map((capture) => ({
        path: capture.path,
        ...(capture.as === undefined ? {} : { as: capture.as }),
      })),
      ...(args.maxRows === undefined ? {} : { budget: { maxRows: args.maxRows } }),
      collectRows: false,
      collectHistory: Object.values(invocation.inputs).some(
        (input) => input.strategy?.id !== undefined && input.strategy.id !== 'sequential',
      ),
      onRow: async (row) =>
        await args.onRow({
          outputs: row.row,
          ...(row.captured ? { captured: row.captured } : {}),
          inputSelection: {
            rowKey: row.rowKey,
            sourceIndexByAlias: row.sourceIndexByAlias,
          },
        }),
    })
  }

export const evaluateDesign = async (args: {
  project: DesignWorkspaceProject
  repository: DesignGraphRepository
  artifacts: InvocationArtifactStore
  params: Record<string, unknown>
  makeAttemptId: () => string
}): Promise<{ value: unknown; run: InvocationRun }> => {
  const invocation = createInvocationDefinition({
    ...args.project.invocation,
    variables: flattenParams(args.params),
    objectives: [],
  })
  await args.repository.putInvocation(invocation)
  let value: unknown
  const completed = await executeInvocation({
    invocation,
    dependencies: {
      repository: args.repository,
      artifacts: args.artifacts,
      makeAttemptId: args.makeAttemptId,
      evaluate: async ({ params }) => {
        const result = await args.project.compiledRoot.call(params).run()
        return { outputs: result.value }
      },
      evaluateRows: invocationRowEvaluator(args.project, invocation),
    },
    onRow: (row) => {
      value = row.outputs
    },
  })
  return { value, run: completed.run }
}

export const evaluateDesignInvocation = async (args: {
  project: DesignWorkspaceProject
  repository: DesignGraphRepository
  artifacts: InvocationArtifactStore
  invocation: InvocationDefinition
  makeAttemptId: () => string
  onRow?: (row: InvocationRow) => void | Promise<void>
}) => {
  await args.repository.putInvocation(args.invocation)
  return await executeInvocation({
    invocation: args.invocation,
    dependencies: {
      repository: args.repository,
      artifacts: args.artifacts,
      makeAttemptId: args.makeAttemptId,
      evaluate: async ({ params }) => {
        const result = await args.project.compiledRoot.call(params).run()
        return { outputs: result.value }
      },
      evaluateRows: invocationRowEvaluator(args.project, args.invocation),
    },
    ...(args.onRow ? { onRow: args.onRow } : {}),
  })
}
