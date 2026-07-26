import type { GraphData } from '@taskyon/common/modules/graph'
import type { DagStorageBackend, Hash } from '@taskyon/comp-dag/caching'
import {
  compileDagNodeRecordGraph,
  getDagNodeRecordInputSchema,
  getDagNodeRecordClosure,
  getDagNodeRecordRelations,
  savedStoredNodesToRecordGraph,
  type DagNodeRecordGraph,
} from '@taskyon/comp-dag/dagNodeGraph'
import { loadStoredGraphNodeFiles, type StoredGraphNodeFile } from '@taskyon/comp-dag/dagNodeLoader'
import {
  createUrlDesignRepositoryReader,
  loadDesignRepositorySnapshot,
} from '@taskyon/comp-dag/designRepositorySnapshot'
import {
  createDesignEvaluationRecord,
  createDesignExecutionConfig,
  type DesignRevisionId,
  type DesignEvaluationRecordV1,
  type DesignRevisionV1,
  type DesignSpaceRecord,
} from '@taskyon/comp-dag/designRevision'
import type {
  DesignProjectObjectStore,
  DesignProjectRepository,
} from '@taskyon/comp-dag/designProjectRepository'
import { canonicalHash } from '@taskyon/comp-dag/caching'
import type { DesignStudyConfig } from '@taskyon/comp-dag/designRevision'
import { recordInputsToRuntimeInputs } from '@taskyon/comp-dag/dagNodeRecord'
import type { DagJsonSchema } from '@taskyon/comp-dag/dagSchema'
import { createWithDefaults } from '@taskyon/taskyon'
import type { JSONSchema7 } from 'json-schema'
import { bundledDesignExamples } from 'src/modules/bundledDesignExamples'

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
  rootNames: string[]
  selectedRoot: boolean
}

export type DesignGraphRecordData =
  | DesignGraphNodeData
  | { kind: 'revision'; hash: DesignRevisionId }
  | { kind: 'parent-revision'; hash: DesignRevisionId }
  | { kind: 'design-space'; hash: Hash; schemaVersion: number }
  | { kind: 'ref'; name: string; revisionId: DesignRevisionId }

export type DesignCheckout =
  | { kind: 'ref'; name: string }
  | { kind: 'revision'; id: DesignRevisionId }

export type DesignWorkspaceProject = {
  checkout: DesignCheckout
  revision: DesignRevisionV1
  designSpace: DesignSpaceRecord
  rootName: string
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
  const enumValues = schema.enum
  if (Array.isArray(enumValues) && enumValues.length) {
    return enumValues.slice(0, 3).map(String).join(' | ')
  }
  const variants = schema.oneOf ?? schema.anyOf
  if (variants?.length) {
    const labels = variants.slice(0, 3).map((variant) => schemaTypeSummary(variant, depth + 1))
    return [...new Set(labels)].join(' | ')
  }
  const type = schema.type
  if (type === 'array') {
    const item = Array.isArray(schema.items) ? schema.items[0] : schema.items
    return `${item ? schemaTypeSummary(item, depth + 1) : 'unknown'}[]`
  }
  if (type === 'object') {
    const properties = Object.entries(schema.properties ?? {})
    if (depth > 0 || properties.length === 0) return 'object'
    const fields = properties
      .slice(0, 3)
      .map(([name, field]) => `${name}: ${schemaTypeSummary(field, depth + 1)}`)
    return `{ ${fields.join('; ')}${properties.length > 3 ? '; …' : ''} }`
  }
  if (!type) return 'unknown'
  return typeof type === 'string' ? type : [...type].join(' | ')
}

const nodeInputPorts = (
  records: ReturnType<typeof savedStoredNodesToRecordGraph>,
  hash: Hash,
): DesignGraphPort[] => {
  const record = records[hash]!
  const runtimeInputs = recordInputsToRuntimeInputs(record)
  const dependencyPorts = [
    ...Object.entries(runtimeInputs.hiddenInputs).map(([name, input]) => ({
      name,
      type: schemaTypeSummary(records[input.nodeId]!.outputSchema),
      role: 'internal' as const,
    })),
    ...Object.entries(runtimeInputs.exposedInputs).map(([name, input]) => {
      const nodeIds = 'kind' in input ? input.nodeIds : [input.nodeId]
      const types = nodeIds.map((nodeId) => schemaTypeSummary(records[nodeId]!.outputSchema))
      return { name, type: [...new Set(types)].join(' | '), role: 'exposed' as const }
    }),
  ]
  const parameterType = schemaTypeSummary(record.localParamsSchema)
  const parameterPorts =
    parameterType === 'object'
      ? []
      : [{ name: 'params', type: parameterType, role: 'parameter' as const }]
  return [...parameterPorts, ...dependencyPorts]
}

const nodeFiles = async (store: DesignProjectObjectStore): Promise<StoredGraphNodeFile[]> => {
  const names = await store.list('nodes')
  return await Promise.all(
    names
      .filter((name) => name.endsWith('.ts'))
      .map(async (name) => {
        const source = await store.read(`nodes/${name}`)
        if (typeof source !== 'string') throw new Error(`Invalid stored node source: ${name}`)
        return { path: `nodes/${name}`, source }
      }),
  )
}

const LEGACY_WORKSTATION_ROOT = 'sha256:Ho1QE-8_1GkNuFXapRSnR3mR-XV4ppe-J2KMdN1gDks' as Hash

export const prepareBundledDesignRevision = async (args: {
  projectId: string
  store: DesignProjectObjectStore
  repository: DesignProjectRepository
}): Promise<DesignRevisionV1> => {
  const catalogExample = bundledDesignExamples[args.projectId]
  if (args.projectId !== 'ai-workstation' && !catalogExample) {
    throw new Error(`No bundled design example exists for ${args.projectId}.`)
  }
  const snapshot = await loadDesignRepositorySnapshot({
    readText: createUrlDesignRepositoryReader({
      baseUrl: new URL(`/design-repositories/${args.projectId}/`, location.origin),
      fetch,
    }),
    checkout: { kind: 'ref', name: 'main' },
  })
  for (const file of snapshot.files) {
    await args.store.write(file.path, file.source)
  }
  const files = await nodeFiles(args.store)
  await loadStoredGraphNodeFiles(files)
  await args.repository.putDesignSpace(snapshot.designSpace)
  await args.repository.putRevision(snapshot.revision, {
    schemaVersion: 1,
    revisionId: snapshot.revision.id,
    message: catalogExample?.message ?? 'Evidence-backed AI workstation design space',
    createdAtMs: Date.now(),
  })
  return snapshot.revision
}

export const ensureBundledDesignProject = async (args: {
  projectId: string
  store: DesignProjectObjectStore
  repository: DesignProjectRepository
  refName?: string
}): Promise<DesignRevisionV1> => {
  const refName = args.refName ?? 'main'
  const current = await args.repository.getRef(refName)
  const prepared = await prepareBundledDesignRevision(args)
  if (current) {
    const revision = await args.repository.getRevision(current.revisionId)
    const currentRoot = revision.roots.main?.nodeId
    if (args.projectId !== 'ai-workstation' || currentRoot !== LEGACY_WORKSTATION_ROOT) {
      return revision
    }
  }
  await args.repository.advanceRef({
    name: refName,
    revisionId: prepared.id,
    expectedRevisionId: current?.revisionId ?? null,
  })
  return prepared
}

export const loadDesignWorkspaceProject = async (args: {
  store: DesignProjectObjectStore
  repository: DesignProjectRepository
  checkout: DesignCheckout
  rootName?: string
}): Promise<DesignWorkspaceProject> => {
  const checkout = args.checkout
  const revisionId =
    checkout.kind === 'revision'
      ? checkout.id
      : await args.repository.getRef(checkout.name).then((ref) => {
          if (!ref) throw new Error(`Design ref not found: ${checkout.name}`)
          return ref.revisionId
        })
  const revision = await args.repository.getRevision(revisionId)
  const designSpace = await args.repository.getDesignSpace(revision.designSpaceId)
  const rootName = args.rootName ?? Object.keys(revision.roots)[0]
  if (!rootName) throw new Error(`Design revision ${revision.id} has no roots.`)
  const rootRef = revision.roots[rootName]
  if (!rootRef) throw new Error(`Design root not found: ${rootName}`)
  const files = await nodeFiles(args.store)
  const graph = await loadStoredGraphNodeFiles(files)
  const records = savedStoredNodesToRecordGraph(graph)
  const compiled = compileDagNodeRecordGraph({ graph: records, rootHash: rootRef.nodeId })
  const compiledRoot = compiled[rootRef.nodeId]
  if (!compiledRoot) throw new Error(`Compiled design root not found: ${rootRef.nodeId}`)
  const rootNamesByHash = Object.entries(revision.roots).reduce<Record<Hash, string[]>>(
    (byHash, [name, root]) => ({
      ...byHash,
      [root.nodeId]: [...(byHash[root.nodeId] ?? []), name],
    }),
    {},
  )
  const closure = [
    ...new Set(
      Object.values(revision.roots).flatMap((root) =>
        getDagNodeRecordClosure(records, root.nodeId),
      ),
    ),
  ]
  const nodes = closure.map((hash) => ({
    id: hash,
    label: records[hash]!.label,
    type: rootNamesByHash[hash]?.length ? 'root' : 'node',
    data: {
      kind: 'computation' as const,
      localName: records[hash]!.localName,
      hash,
      inputs: nodeInputPorts(records, hash),
      outputType: schemaTypeSummary(records[hash]!.outputSchema),
      rootNames: rootNamesByHash[hash] ?? [],
      selectedRoot: hash === rootRef.nodeId,
    },
  }))
  const computationEdges = closure.flatMap((hash) => {
    const record = records[hash]!
    const inputs = record.inputs ?? {}
    return Object.entries(inputs).flatMap(([alias, input]) => {
      const nodeIds = 'kind' in input ? input.nodeIds : [input.nodeId]
      return nodeIds.map((source) => ({
        id: `${source}:${hash}:${alias}`,
        source,
        target: hash,
        label: alias,
        type: 'kind' in input ? 'choice' : 'dependency',
        data: { alias },
      }))
    })
  })
  const revisionNodeId = `revision:${revision.id}`
  const designSpaceNodeId = `design-space:${designSpace.id}`
  const recordNodes: GraphData<DesignGraphRecordData, { alias: string }>['nodes'] = [
    {
      id: designSpaceNodeId,
      label: 'Design space',
      type: 'design-space',
      data: {
        kind: 'design-space',
        hash: designSpace.id,
        schemaVersion: designSpace.schemaVersion,
      },
    },
    ...revision.parents.map((parent) => ({
      id: `revision:${parent}`,
      label: 'Parent revision',
      type: 'parent-revision',
      data: { kind: 'parent-revision' as const, hash: parent },
    })),
    {
      id: revisionNodeId,
      label: 'Design revision',
      type: 'revision',
      data: { kind: 'revision', hash: revision.id },
    },
    ...(args.checkout.kind === 'ref'
      ? [
          {
            id: `ref:${args.checkout.name}`,
            label: args.checkout.name,
            type: 'ref',
            data: {
              kind: 'ref' as const,
              name: args.checkout.name,
              revisionId: revision.id,
            },
          },
        ]
      : []),
  ]
  const recordEdges: GraphData<DesignGraphRecordData, { alias: string }>['edges'] = [
    {
      id: `${designSpaceNodeId}:${revisionNodeId}`,
      source: designSpaceNodeId,
      target: revisionNodeId,
      type: 'design-space',
      label: 'design space',
      data: { alias: 'designSpaceId' },
    },
    ...revision.parents.map((parent) => ({
      id: `revision:${parent}:${revisionNodeId}`,
      source: `revision:${parent}`,
      target: revisionNodeId,
      type: 'revision-parent',
      label: 'parent',
      data: { alias: 'parent' },
    })),
    ...Object.entries(revision.roots).map(([name, root]) => ({
      id: `${root.nodeId}:${revisionNodeId}:${name}`,
      source: root.nodeId,
      target: revisionNodeId,
      type: 'revision-root',
      label: `root · ${name}`,
      data: { alias: name },
    })),
    ...(args.checkout.kind === 'ref'
      ? [
          {
            id: `${revisionNodeId}:ref:${args.checkout.name}`,
            source: revisionNodeId,
            target: `ref:${args.checkout.name}`,
            type: 'design-ref',
            label: 'points to',
            data: { alias: args.checkout.name },
          },
        ]
      : []),
  ]
  return {
    checkout: args.checkout,
    revision,
    designSpace,
    rootName,
    files,
    graph,
    records,
    compiledRoot,
    graphData: {
      nodes: [...nodes, ...recordNodes],
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

export const evaluateDesign = async (args: {
  project: DesignWorkspaceProject
  repository: DesignProjectRepository
  storageBackend: DagStorageBackend
  params: Record<string, unknown>
}): Promise<{ value: unknown; evaluation: DesignEvaluationRecordV1 }> => {
  const run = await args.project.compiledRoot.call(args.params).run(undefined, {
    execution: { mode: 'local' },
    storageBackend: args.storageBackend,
  })
  const execution = createDesignExecutionConfig({ kind: 'design', params: args.params })
  await args.repository.putExecutionConfig(args.project.rootName, execution.id, execution.value)
  const evaluation = createDesignEvaluationRecord({
    revisionId: args.project.revision.id,
    rootName: args.project.rootName,
    executionConfigId: execution.id,
    resultArtifactId: run.artifactHash,
  })
  await args.repository.putEvaluation(evaluation)
  return { value: run.value, evaluation }
}

export const evaluateDesignStudy = async (args: {
  project: DesignWorkspaceProject
  repository: DesignProjectRepository
  storageBackend: DagStorageBackend
  params: Record<string, unknown>
  config: DesignStudyConfig
}) => {
  const study = await args.project.compiledRoot.call(args.params).study(args.config, undefined, {
    execution: { mode: 'local' },
    storageBackend: args.storageBackend,
  })
  const execution =
    args.config.mode === 'optimize'
      ? createDesignExecutionConfig({
          kind: 'optimization',
          config: { ...args.config, mode: 'optimize' },
        })
      : createDesignExecutionConfig({
          kind: 'study',
          config: { ...args.config, mode: 'explore' },
        })
  await args.repository.putExecutionConfig(args.project.rootName, execution.id, execution.value)
  const evaluation = createDesignEvaluationRecord({
    revisionId: args.project.revision.id,
    rootName: args.project.rootName,
    executionConfigId: execution.id,
    resultArtifactId: await args.storageBackend.writeArtifact(study),
  })
  await args.repository.putEvaluation(evaluation)
  return { value: study, evaluation }
}

export const designOutputSchemaId = (project: DesignWorkspaceProject): Hash =>
  canonicalHash(project.compiledRoot.outputSchema)
