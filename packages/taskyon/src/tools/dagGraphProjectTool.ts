import { createTool } from '../types/toolApi'
import type { Hash } from '@taskyon/comp-dag/caching'
import {
  compileDagNodeRecordGraph,
  savedStoredNodesToRecordGraph,
} from '@taskyon/comp-dag/dagNodeRecordGraph'
import { saveStoredGraphNodeSource } from '@taskyon/comp-dag/dagNodeLoader'
import {
  createGraphRevision,
  createInvocationDefinition,
  createProjectRevision,
  type InvocationConstraint,
  type InvocationRequestedPolicy,
} from '@taskyon/comp-dag/designGraphModel'
import {
  createDesignGraphRepository,
  createStorageDesignGraphObjectStore,
  normalizeRefName,
  type DesignGraphStorageClient,
} from '@taskyon/comp-dag/designGraphRepository'
import {
  compileDesignRepositoryNodes,
  loadDesignRepositoryNodeClosure,
} from '@taskyon/comp-dag/designRepositorySnapshot'
import {
  createDagInvocationEvaluators,
  executeInvocation,
} from '@taskyon/comp-dag/invocationExecution'
import type { JSONSchema7 } from 'json-schema'
import z from 'zod'
import {
  objectiveSchema,
  optimizationCaptureSpecSchema,
  optimizationInputSpecSchema,
  variableSpecSchema,
  type Objective,
  type OptimizationCaptureSpec,
  type OptimizationInputSpec,
  type VariableSpec,
} from '@taskyon/comp-dag/optimization'
import { createStorageDagBackend } from '@taskyon/comp-dag/storageDagBackend'
import {
  createStorageInvocationArtifactStore,
  type InvocationArtifactStorageClient,
} from '@taskyon/comp-dag/storageInvocationArtifacts'

type GraphProjectAction =
  | 'createNode'
  | 'createProject'
  | 'saveInvocation'
  | 'runInvocation'
  | 'inspectProject'

type DagGraphProjectToolArgs = {
  action: GraphProjectAction
  projectId?: string
  displayName?: string
  invocationName?: string
  nodeSource?: string
  rootNodeId?: Hash
  invocationId?: Hash
  variables?: Record<string, VariableSpec>
  inputs?: Record<string, OptimizationInputSpec>
  objectives?: Objective[]
  constraints?: InvocationConstraint[]
  capture?: OptimizationCaptureSpec[]
  policy?: InvocationRequestedPolicy
  expectedProjectRevisionId?: Hash
}

const requireInvocationFields = (args: DagGraphProjectToolArgs) => {
  if (!args.rootNodeId) throw new Error(`${args.action} requires rootNodeId.`)
  return createInvocationDefinition({
    rootNodeId: args.rootNodeId,
    variables: args.variables ?? {},
    inputs: args.inputs ?? {},
    objectives: args.objectives ?? [],
    constraints: args.constraints ?? [],
    capture: args.capture ?? [],
    policy: args.policy ?? { accuracy: 'exact' },
    reducerOverrides: {},
  })
}

export const createDagGraphProjectTool = (
  storageClient: DesignGraphStorageClient & InvocationArtifactStorageClient,
  prepareRepository?: () => Promise<void>,
) => {
  const store = createStorageDesignGraphObjectStore(storageClient)
  const repository = createDesignGraphRepository(store)
  const toToolInputSchema = (schema: z.ZodType) =>
    z.toJSONSchema(schema, {
      target: 'draft-7',
      io: 'input',
      unrepresentable: 'any',
      override: ({ jsonSchema }) => {
        delete jsonSchema.default
      },
    }) as JSONSchema7
  const variableSpecJsonSchema = toToolInputSchema(variableSpecSchema)
  const optimizationInputJsonSchema = toToolInputSchema(optimizationInputSpecSchema)
  const objectiveJsonSchema = toToolInputSchema(objectiveSchema)
  const captureJsonSchema = toToolInputSchema(optimizationCaptureSpecSchema)
  const dagBackend = createStorageDagBackend({
    get: async (namespace, id) => (await storageClient.get({ namespace, id })).value,
    set: async (namespace, id, value) => {
      await storageClient.set({ namespace, id, value })
    },
  })
  const artifactStore = createStorageInvocationArtifactStore(storageClient, () =>
    crypto.randomUUID(),
  )

  return createTool({
    name: 'dagGraphProject',
    description: 'Create nodes and manage immutable design-graph projects and invocation runs.',
    longDescription:
      'Create and run a computational design. createNode writes to the global graph and needs no projectId. For a new project, pass its returned nodeId as createProject.rootNodeId, then run the project with the invocationName returned by createProject (default: main). runInvocation takes the name, not the invocation hash.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'] as string[],
      properties: {
        action: {
          type: 'string',
          enum: [
            'createNode',
            'createProject',
            'saveInvocation',
            'runInvocation',
            'inspectProject',
          ] as GraphProjectAction[],
          description:
            'Operation to perform. For a new node-based project: createNode → createProject with its returned nodeId as rootNodeId → runInvocation with the returned invocationName. runInvocation takes the name, not the invocation hash.',
        },
        projectId: {
          type: 'string',
          description:
            'Required for project actions. Optional for createNode because graph nodes are global. Nested refs such as projects/templates/example are preserved; unsafe path segments are rejected.',
        },
        displayName: {
          type: 'string',
          description: 'Human-readable project name stored in the immutable project revision.',
        },
        invocationName: {
          type: 'string',
          default: 'main',
          description:
            'Project-local invocation name to create, replace, run, or inspect. Use the name returned by createProject or saveInvocation; this is a name, not an invocation hash.',
        },
        nodeSource: {
          type: 'string',
          description:
            "Full standalone TypeScript source for createNode. Its only export must be a direct object literal written as `export default { ... }` (no parentheses, named variable, `as` assertion, or `satisfies` wrapper). Set formatVersion to 2 and include id '__TASKYON_SELF_HASH__', localName, label, version, localParamsSchema, outputSchema, optional hashed inputs, and a `run` property whose value is an async arrow function. Do not import application types.",
          examples: [
            "export default { formatVersion: 2, id: '__TASKYON_SELF_HASH__', localName: 'score', label: 'Score', version: 1, localParamsSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] }, outputSchema: { type: 'number' }, inputs: {}, run: async ({ params }) => params.value }",
          ] as string[],
        },
        rootNodeId: {
          type: 'string',
          description:
            'Content hash of the exact computational root for createProject or saveInvocation. For createProject, use the nodeId returned by createNode as this value; do not include a separate nodeId argument.',
        },
        invocationId: {
          type: 'string',
          description:
            'For createProject or saveInvocation, reuse this exact existing invocation instead of reconstructing its parameters. Do not combine with definition fields such as rootNodeId or variables.',
        },
        variables: {
          type: 'object',
          additionalProperties: variableSpecJsonSchema,
          description:
            'Map each node parameter to a variable spec, such as {"kind":"list","values":[12,16,24]} or {"kind":"constant","value":750}.',
          examples: [{ gpuMemoryGb: { kind: 'list', values: [12, 16, 24] } }],
        },
        inputs: {
          type: 'object',
          additionalProperties: optimizationInputJsonSchema,
          description: 'Invocation domains and strategies assigned to named computational inputs.',
        },
        objectives: {
          type: 'array',
          items: objectiveJsonSchema,
          description:
            'Optimization objectives use direction "min" or "max" and a target object such as {"path":"score","op":"identity"}. Omit for exploration.',
        },
        constraints: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Constraints applied while planning and evaluating the invocation.',
        },
        capture: {
          type: 'array',
          items: captureJsonSchema,
          description: 'Output paths to retain for each streamed invocation row.',
        },
        policy: {
          type: 'object',
          additionalProperties: true,
          description:
            'Result-affecting execution policy stored as part of the invocation definition.',
        },
        expectedProjectRevisionId: {
          type: 'string',
          description:
            'Expected current project revision used for conflict-safe saveInvocation advancement.',
        },
      },
      anyOf: [
        {
          properties: { action: { const: 'createNode' } },
          required: ['action', 'nodeSource'],
        },
        {
          properties: { action: { const: 'createProject' } },
          required: ['action', 'projectId'],
          anyOf: [
            { required: ['rootNodeId'] },
            { required: ['invocationId'] },
            { required: ['$use'] },
          ],
        },
        {
          properties: { action: { const: 'saveInvocation' } },
          required: ['action', 'projectId'],
          anyOf: [
            { required: ['rootNodeId'] },
            { required: ['invocationId'] },
            { required: ['$use'] },
          ],
        },
        {
          properties: { action: { const: 'runInvocation' } },
          required: ['action', 'projectId'],
        },
        {
          properties: { action: { const: 'inspectProject' } },
          required: ['action', 'projectId'],
        },
      ],
    } as const,
    function: async (rawArgs: DagGraphProjectToolArgs) => {
      await prepareRepository?.()
      const requested = rawArgs.projectId?.trim()
      const projectRef = requested
        ? normalizeRefName(
            requested.startsWith('projects/') ? requested : `projects/${requested}`,
            'projects/',
          )
        : undefined
      const projectId = projectRef?.slice('projects/'.length)

      if (rawArgs.action === 'createNode') {
        if (!rawArgs.nodeSource) throw new Error('createNode requires nodeSource.')
        const saved = await saveStoredGraphNodeSource(rawArgs.nodeSource, { directory: 'nodes' })
        await store.writeText(saved.file.path, saved.file.source)
        const currentRef = await repository.getGraphRef('graph/main')
        const current = currentRef
          ? await repository.getGraphRevision(currentRef.revisionId)
          : undefined
        const revision = createGraphRevision({
          parents: current ? [current.id] : [],
          nodes: { ...(current?.nodes ?? {}), [saved.node.localName]: saved.hash },
        })
        await repository.putGraphRevision(revision)
        await repository.advanceGraphRef({
          name: 'graph/main',
          revisionId: revision.id,
          expected: currentRef?.revisionId ?? null,
        })
        return {
          type: 'dagGraphNodeCreated' as const,
          ...(projectId ? { projectId } : {}),
          nodeId: saved.hash,
          localName: saved.node.localName,
          graphRevisionId: revision.id,
        }
      }

      if (!projectRef || !projectId) throw new Error(`${rawArgs.action} requires a projectId.`)
      const invocationName = rawArgs.invocationName?.trim() || 'main'
      if (
        rawArgs.invocationId &&
        [
          rawArgs.rootNodeId,
          rawArgs.variables,
          rawArgs.inputs,
          rawArgs.objectives,
          rawArgs.constraints,
          rawArgs.capture,
          rawArgs.policy,
        ].some((value) => value !== undefined)
      )
        throw new Error('Choose an existing invocationId or a new definition, not both.')

      if (rawArgs.action === 'createProject') {
        const invocation = rawArgs.invocationId
          ? await repository.getInvocation(rawArgs.invocationId)
          : requireInvocationFields(rawArgs)
        await repository.putInvocation(invocation)
        const revision = createProjectRevision({
          parents: [],
          displayName: rawArgs.displayName?.trim() || projectId,
          invocations: { [invocationName]: invocation.id },
          extensions: {},
        })
        await repository.putProjectRevision(revision)
        await repository.advanceProjectRef({
          name: projectRef,
          revisionId: revision.id,
          expected: null,
        })
        return {
          type: 'designProjectCreated' as const,
          projectId,
          invocationName,
          revision,
          invocation,
        }
      }

      const ref = await repository.getProjectRef(projectRef)
      if (!ref) throw new Error(`Design graph project not found: ${projectId}`)
      const project = await repository.getProjectRevision(ref.revisionId)

      if (rawArgs.action === 'saveInvocation') {
        const invocation = rawArgs.invocationId
          ? await repository.getInvocation(rawArgs.invocationId)
          : requireInvocationFields(rawArgs)
        await repository.putInvocation(invocation)
        const revision = createProjectRevision({
          parents: [project.id],
          displayName: rawArgs.displayName?.trim() || project.displayName,
          invocations: { ...project.invocations, [invocationName]: invocation.id },
          extensions: project.extensions,
        })
        await repository.putProjectRevision(revision)
        await repository.advanceProjectRef({
          name: projectRef,
          revisionId: revision.id,
          expected: rawArgs.expectedProjectRevisionId ?? project.id,
        })
        return {
          type: 'designInvocationSaved' as const,
          projectId,
          invocationName,
          revision,
          invocation,
        }
      }

      if (rawArgs.action === 'runInvocation') {
        const invocationId = project.invocations[invocationName]
        if (!invocationId) throw new Error(`Project invocation not found: ${invocationName}`)
        const invocation = await repository.getInvocation(invocationId)
        const snapshot = await loadDesignRepositoryNodeClosure({
          readText: store.readText,
          ...(store.readManyText ? { readManyText: store.readManyText } : {}),
          rootNodeId: invocation.rootNodeId,
        })
        const graph = savedStoredNodesToRecordGraph(await compileDesignRepositoryNodes(snapshot))
        const compiled = compileDagNodeRecordGraph({ graph, rootHash: invocation.rootNodeId })
        const root = compiled[invocation.rootNodeId]
        if (!root) throw new Error(`Invocation root node not found: ${invocation.rootNodeId}`)
        const result = await executeInvocation({
          invocation,
          dependencies: {
            repository,
            artifacts: artifactStore,
            makeAttemptId: () => crypto.randomUUID(),
            ...createDagInvocationEvaluators({
              root,
              invocation,
              engineConfig: {
                execution: { mode: 'local' },
                storageBackend: dagBackend,
              },
            }),
          },
        })
        return { type: 'designInvocationRun' as const, projectId, invocationName, ...result }
      }

      if (rawArgs.action === 'inspectProject') {
        const invocations = Object.fromEntries(
          await Promise.all(
            Object.entries(project.invocations).map(async ([name, id]) => [
              name,
              await repository.getInvocation(id),
            ]),
          ),
        )
        return { type: 'designProjectInspected' as const, projectId, ref, project, invocations }
      }

      throw new Error(`Unknown dagGraphProject action: ${String(rawArgs.action)}`)
    },
  })
}
