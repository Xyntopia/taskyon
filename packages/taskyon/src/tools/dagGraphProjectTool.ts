import { createTool } from '../types/toolApi'
import type { Hash } from '@taskyon/comp-dag/caching'
import { canonicalHash } from '@taskyon/comp-dag/caching'
import {
  compileDagNodeRecordGraph,
  savedStoredNodesToRecordGraph,
} from '@taskyon/comp-dag/dagNodeRecordGraph'
import {
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
  type DagRunCodeCompiler,
} from '@taskyon/comp-dag/designRepositorySnapshot'
import {
  createDagInvocationEvaluators,
  executeInvocation,
} from '@taskyon/comp-dag/invocationExecution'
import {
  iterateInvocationRowRange,
  type InvocationRowStorageClient,
} from '@taskyon/comp-dag/storageInvocationRows'
import type { JSONSchema7 } from 'json-schema'
import type { JSONSchema } from 'json-schema-to-ts'
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
import {
  parseAuthoredGraphDefinition,
  publishAuthoredGraph,
  readAuthoredGraph,
} from '@taskyon/comp-dag/dagGraphAuthoring'
import {
  projectInputReadCapability,
  projectInputSourceDeclaration,
  readProjectInput,
} from '@taskyon/comp-dag/projectInputSource'
import {
  createSourceManifestRepository,
  createSourceSnapshot,
} from '@taskyon/comp-dag/sourceManifest'
import { httpSourceDeclaration } from '@taskyon/comp-dag/httpSource'

type GraphProjectAction =
  | 'createNode'
  | 'createProject'
  | 'saveInvocation'
  | 'runInvocation'
  | 'readRunRows'
  | 'inspectProject'
  | 'inspectGraph'
  | 'importInputFile'

type DagGraphProjectToolArgs = {
  action: GraphProjectAction
  projectId?: string
  displayName?: string
  invocationName?: string
  nodeSource?: string
  definitionPath?: string
  expectedGraphRevisionId?: Hash
  inputPath?: string
  inputContent?: string
  bindingId?: string
  rootNodeId?: Hash
  invocationId?: Hash
  runId?: Hash
  startRow?: number
  limit?: number
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

const requireStoredInvocation = async (
  args: DagGraphProjectToolArgs,
  repository: ReturnType<typeof createDesignGraphRepository>,
) => {
  const invocation = args.invocationId
    ? await repository.getInvocation(args.invocationId).catch((cause: unknown) => {
        throw new Error(
          `Saved invocation ${args.invocationId} is unavailable. Copy the complete pinnedInvocationId returned by runInvocation into invocationId, including its final characters; do not shorten or reconstruct the hash.`,
          { cause },
        )
      })
    : requireInvocationFields(args)
  try {
    await loadDesignRepositoryNodeClosure({
      readText: repository.store.readText,
      rootNodeId: invocation.rootNodeId,
    })
  } catch (cause) {
    throw new Error(
      `Invocation root or dependency is unavailable: ${invocation.rootNodeId}. Use inspectGraph and copy the exact returned nodeId before saving.`,
      { cause },
    )
  }
  return invocation
}

export const createDagGraphProjectTool = (
  storageClient: DesignGraphStorageClient &
    InvocationArtifactStorageClient &
    InvocationRowStorageClient,
  prepareRepository?: () => Promise<void>,
  compileRunCode?: DagRunCodeCompiler,
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
    }) as JSONSchema7 & JSONSchema
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
    description:
      'Author computational graphs and external data sources, then save, pin and run their studies.',
    longDescription:
      'Create and run a computational design. If a service URL is unknown, discover and verify it from the provider catalog or official API documentation before wiring a saved study. A guessed URL or an HTML response is not verified API metadata. Use inspectProject with inputPath to read an existing small project input before assuming its field names. Inspection is read-only; saved calculations must still consume a declared source to pin that input. For external data, keep acquisition and calculation separate: an HTTP source returns the complete unmodified response body as text or bytes (optionally with status/headers). Put JSON parsing, filtering, counts and all derived outputs in a connected pure consumer, and save that consumer as the study root. Pinning a derived summary alone loses the original evidence. inspectGraph returns readable binding IDs and node hashes. createNode writes to the global graph and needs no projectId. A binding input is an object: { source: "upstreamBindingId" }, never a bare string or { type, id }. Keep inputsSchema (upstream output contracts) separate from ids.<binding>.inputs (connections). Source parameters are passed at execution through use.<alias>({ ...params }); they are not binding fields. For a new project, pass the returned nodeId as createProject.rootNodeId. For an existing project, add or replace a named study using saveInvocation with rootNodeId and invocationName; do not call createProject again. Then run the project with the invocationName returned by createProject or saveInvocation (default: main). runInvocation takes the name, not the invocation hash. Use readRunRows with the returned run.id to inspect scored results before recommending a candidate. To retain acquired data, save the returned pinnedInvocationId using saveInvocation.invocationId with the same projectId and invocationName; omitting the name saves under main. Rerun the pinned study before reading its rows because earlier runs belong to the earlier invocation definition.',
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
            'readRunRows',
            'inspectProject',
            'inspectGraph',
            'importInputFile',
          ] as GraphProjectAction[],
          description:
            'Operation to perform. Inspect an existing project with inspectProject; add its study with createNode → saveInvocation (projectId, invocationName, returned nodeId as rootNodeId) → runInvocation. Use createProject only for a project that does not exist. runInvocation takes the invocationName, not the invocation hash. After a completed run, save its pinnedInvocationId with saveInvocation.invocationId and the SAME projectId and invocationName to retain acquired sources. Omitting invocationName saves under main. After pinning, run the pinned study again before reading its rows; the earlier run belongs to the earlier invocation definition.',
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
            "Reusable TypeScript definition for createNode: export default { formatVersion: 3, localParamsSchema, inputsSchema, outputSchema, ids: { bindingId: { inputs: { alias: { source: 'upstream-binding' } } } }, run: async ({ params, use, services }) => ... }. Use the exact readable IDs returned in nodeIds. The ids keys name newly declared nodes; they are not input aliases. Every use.alias call must have the same alias in inputsSchema and ids.<binding>.inputs. To call an existing calculation internally, declare inputsSchema.calculator: true and ids.<binding>.inputs.calculator: { source: 'existingBinding', role: 'internal' }, then await use.calculator(calculationParams). The internal role keeps those parameters at the explicit call instead of exposing them as root study inputs. Inputs are objects, never strings. The resolver writes recursive hashes into the graph lock. Compatible alternatives must be parameters through choose. Repeated bindings serve simultaneous roles. Imports require exact module locks. HTTP sources declare effect: 'source' and await mediated services.fetch with an absolute URL; await response.text() for raw text or response.arrayBuffer() for bytes. Fetch authorization is supplied by the host, separate from the capabilities list. Keep JSON parsing and calculations in a separate pure consumer that awaits use.<alias>({...params}). Required source parameters (such as path or url) must be forwarded explicitly by that consumer: use.<alias>({ path: params.path }) or use.<alias>({ url: params.url }). Calling use.<alias>({}) passes an empty object; invocation variables do not fill that object automatically. Project input paths are logical repository paths, not host filesystem paths. Project file readers declare effect: 'source', declare capability 'taskyon.project-input.read-text/v1', and call services.callCapability('taskyon.project-input.read-text/v1', { path }); do not fetch file paths or use host filesystem tools to read them. To inspect an existing JSON input before assuming its field names, connect a pure JSON-parsing preview consumer to that source, save/run it as the named study, and read its result rows. The HTTP and file source examples below have complete output contracts; consumer inputsSchema must match the producer contract, not just its top-level type. Loading never executes arbitrary code. Examples include a project file source, a connected pure converter and a reusable HTTP GET source.",
          examples: [
            "export default { formatVersion: 3, localParamsSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] }, outputSchema: { type: 'number' }, ids: { score: { inputs: {} } }, run: async ({ params }) => params.value }",
            projectInputSourceDeclaration,
            "export default { formatVersion: 3, localParamsSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, inputsSchema: { data: { type: 'string' } }, outputSchema: { type: 'object', additionalProperties: true, description: 'Inspect the parsed contents of a pinned JSON input before configuring its consumer.' }, ids: { inspectJsonInput: { inputs: { data: { source: 'projectInput' } } } }, run: async ({ params, use }) => JSON.parse(await use.data({ path: params.path })) }",
            "export default { formatVersion: 3, localParamsSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, inputsSchema: { data: { type: 'string' } }, outputSchema: { type: 'object', properties: { parcelCount: { type: 'integer' } }, required: ['parcelCount'] }, ids: { parcelCount: { inputs: { data: { source: 'projectInput' } } } }, run: async ({ params, use }) => ({ parcelCount: JSON.parse(await use.data({ path: params.path })).parcels.length }) }",
            httpSourceDeclaration,
            "export default { formatVersion: 3, localParamsSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }, inputsSchema: { data: { type: 'string' }, calculator: true }, outputSchema: { type: 'object', properties: { score: { type: 'number' } }, required: ['score'] }, ids: { scoredProjectInput: { inputs: { data: { source: 'projectInput' }, calculator: { source: 'score', role: 'internal' } } } }, run: async ({ params, use }) => { const data = JSON.parse(await use.data({ path: params.path })); return { score: await use.calculator({ value: data.value }) } } }",
          ] as string[],
        },
        definitionPath: {
          type: 'string',
          description:
            'Graph-relative nodes/*.ts declaration path to create, replace, or inspect. Replacing a shared definition updates all its bindings.',
        },
        inputPath: {
          type: 'string',
          description:
            'Logical project input path under inputs/<projectId>/. Use inspectProject with inputPath to read an existing small input without creating a study or accessing host files; inspection returns the exact content up to 64 KiB and rejects larger files. importInputFile writes inputContent to this path. Both operations are project scoped.',
        },
        bindingId: {
          type: 'string',
          description:
            'Optional readable binding ID to inspect with its resolved input/output and parameter contracts.',
        },
        inputContent: {
          type: 'string',
          maxLength: 2000000,
          description:
            'Exact UTF-8 data file contents for importInputFile; retained observations are pinned on evaluation.',
        },
        expectedGraphRevisionId: {
          type: 'string',
          description:
            'Exact revision returned by inspectGraph; rejects edits after concurrent changes.',
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
        runId: {
          type: 'string',
          description: 'Run ID returned by runInvocation; required when reading its rows.',
        },
        startRow: {
          type: 'integer',
          minimum: 0,
          description: 'First result row to read; defaults to zero.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 25,
          description: 'Maximum result rows to read in one call; defaults to 10.',
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
          properties: { action: { const: 'importInputFile' } },
          required: ['action', 'projectId', 'inputPath', 'inputContent'],
        },
        { properties: { action: { const: 'inspectGraph' } }, required: ['action'] },
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
          properties: { action: { const: 'readRunRows' } },
          required: ['action', 'projectId', 'runId'],
        },
        {
          properties: { action: { const: 'inspectProject' } },
          required: ['action', 'projectId'],
        },
      ],
    } as JSONSchema7 & JSONSchema,
    function: async (rawArgs: DagGraphProjectToolArgs, ctx) => {
      await prepareRepository?.()
      const requested = rawArgs.projectId?.trim()
      const projectRef = requested
        ? normalizeRefName(
            requested.startsWith('projects/') ? requested : `projects/${requested}`,
            'projects/',
          )
        : undefined
      const projectId = projectRef?.slice('projects/'.length)

      if (rawArgs.action === 'inspectGraph') {
        const ref = await repository.getGraphRef('graph/main')
        const revision = ref ? await repository.getGraphRevision(ref.revisionId) : undefined
        const resolved = revision?.authoringLockId
          ? await readAuthoredGraph(store, revision.authoringLockId)
          : undefined
        const files = resolved?.files ?? []
        const graph = resolved ? compileDagNodeRecordGraph({ graph: resolved.resolvedNodes }) : {}
        const bindings = Object.entries(revision?.nodes ?? {}).filter(
          ([id]) => !rawArgs.bindingId || id === rawArgs.bindingId,
        )
        const page = bindings.slice(
          rawArgs.startRow ?? 0,
          (rawArgs.startRow ?? 0) + Math.min(rawArgs.limit ?? 20, 100),
        )
        return {
          type: 'dagGraphInspection' as const,
          graphRevisionId: ref?.revisionId ?? null,
          bindings: page.map(([id, nodeId]) => ({
            id,
            nodeId,
            label: resolved?.bindingLabels[id] ?? id,
            paramsSchema: graph[nodeId]?.paramsSchema,
            outputSchema: graph[nodeId]?.outputSchema,
            inputs: resolved?.resolvedNodes[nodeId]?.inputs ?? {},
          })),
          totalBindings: bindings.length,
          definitions: files.map((file) => ({
            path: file.path,
            ...(rawArgs.definitionPath === file.path ? { source: file.source } : {}),
          })),
        }
      }
      if (rawArgs.action === 'createNode') {
        if (!rawArgs.nodeSource) throw new Error('createNode requires nodeSource.')
        const currentRef = await repository.getGraphRef('graph/main')
        const current = currentRef
          ? await repository.getGraphRevision(currentRef.revisionId)
          : undefined
        if (current && Object.keys(current.nodes).length && !current.authoringLockId)
          throw new Error(
            'This repository requires the explicit graph authoring cutover before edits.',
          )
        const parsed = await parseAuthoredGraphDefinition({
          path: 'nodes/new.ts',
          source: rawArgs.nodeSource,
        })
        const localName = Object.keys(parsed.bindings)[0]!
        const definitionPath = rawArgs.definitionPath ?? `nodes/${localName}.ts`
        if (
          !/^nodes\/[A-Za-z0-9_./-]+\.ts$/.test(definitionPath) ||
          definitionPath.split('/').some((part) => part === '..' || part === '.')
        )
          throw new Error('Unsafe definition path.')
        const existing = current?.authoringLockId
          ? (await readAuthoredGraph(store, current.authoringLockId)).files
          : []
        const saved = await publishAuthoredGraph({
          store,
          files: [
            ...existing.filter((file) => file.path !== definitionPath),
            { path: definitionPath, source: rawArgs.nodeSource },
          ],
          expectedGraphRevisionId:
            rawArgs.expectedGraphRevisionId ?? currentRef?.revisionId ?? null,
        })
        return {
          type: 'dagGraphNodeCreated' as const,
          ...(projectId ? { projectId } : {}),
          nodeId: saved.bindings[localName],
          nodeIds: Object.fromEntries(
            Object.keys(parsed.bindings).map((id) => [id, saved.bindings[id]]),
          ),
          localName,
          graphRevisionId: saved.revision.id,
          graphLockId: saved.lock.id,
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
        if (await repository.getProjectRef(projectRef))
          throw new Error(
            'Project already exists. Use saveInvocation with this projectId, invocationName, and rootNodeId to add a study; or supply invocationId to pin an existing invocation.',
          )
        const invocation = await requireStoredInvocation(rawArgs, repository)
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
      if (rawArgs.action === 'importInputFile') {
        if (
          !rawArgs.inputPath?.startsWith(`inputs/${projectId}/`) ||
          rawArgs.inputContent === undefined
        )
          throw new Error(
            `Input files must belong to inputs/${projectId}/. Use a full project-relative inputPath such as inputs/${projectId}/data.json; bare filenames are not accepted.`,
          )
        await readProjectInput({ path: rawArgs.inputPath }, () =>
          Promise.resolve(rawArgs.inputContent!),
        )
        await store.writeText(rawArgs.inputPath, rawArgs.inputContent)
        return {
          type: 'projectInputImported' as const,
          path: rawArgs.inputPath,
          contentHash: canonicalHash(rawArgs.inputContent),
        }
      }

      if (rawArgs.action === 'saveInvocation') {
        const invocation = await requireStoredInvocation(rawArgs, repository)
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
        const graph = savedStoredNodesToRecordGraph(
          await compileDesignRepositoryNodes(snapshot, compileRunCode),
        )
        const compiled = compileDagNodeRecordGraph({
          graph,
          rootHash: invocation.rootNodeId,
          ...(ctx?.fetch ? { mediatedFetch: ctx.fetch } : {}),
          callCapability: async (id, input) => {
            if (id !== projectInputReadCapability)
              throw new Error(`Capability ${id} is unavailable in this runtime.`)
            return await readProjectInput(input, store.readText, projectId)
          },
        })
        const sourceRecords = {
          get: async (namespace: string, id: string) =>
            (await storageClient.get({ namespace, id })).value,
          set: async (namespace: string, id: string, value: unknown) => {
            await storageClient.set({ namespace, id, value })
          },
        }
        const sourceRepository = createSourceManifestRepository(sourceRecords)
        const consumed: Record<string, Hash> = {}
        const root = compiled[invocation.rootNodeId]
        if (!root) throw new Error(`Invocation root node not found: ${invocation.rootNodeId}`)
        const result = await executeInvocation({
          invocation,
          reuseCompletedRun: !Object.values(graph).some((node) => node.effect === 'source'),
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
                sourceExecution: {
                  repository: sourceRepository,
                  defaultPolicy: { mode: 'manual' },
                  nodePolicies: Object.fromEntries(
                    Object.values(graph)
                      .filter((node) => node.capabilities?.includes(projectInputReadCapability))
                      .map((node) => [node.id, { mode: 'always' as const }]),
                  ),
                  refreshedAcquisitionKeys: new Set(),
                },
                onSourceManifest: (key, hash) => {
                  consumed[key] = hash
                },
              },
            }),
          },
        })
        if (result.run.status !== 'completed')
          return {
            type: 'designInvocationRun' as const,
            projectId,
            invocationName,
            ...result,
            pinnedInvocationId: undefined,
            sourceSnapshotId: undefined,
            nextAction:
              'Inspect the run error and fix the source, connection or parameters before pinning a completed evaluation. inspectGraph exposes each node paramsSchema. Set required root variables and forward required upstream parameters inside the consumer through use.<alias>({ path: params.path }) or use.<alias>({ url: params.url }); use.<alias>({}) does not inherit invocation variables. Rerun successfully, then save pinnedInvocationId with saveInvocation.invocationId.',
          }
        const observationSnapshot = createSourceSnapshot(consumed)
        await sourceRepository.putSnapshot(observationSnapshot)
        const pinned = createInvocationDefinition({
          ...invocation,
          sourceSnapshotId: observationSnapshot.id,
        })
        await repository.putInvocation(pinned)
        return {
          type: 'designInvocationRun' as const,
          projectId,
          invocationName,
          ...result,
          pinnedInvocationId: pinned.id,
          sourceSnapshotId: observationSnapshot.id,
          ...(Object.keys(consumed).length
            ? {
                nextAction: `Preserve this exact source replay with saveInvocation: projectId=${JSON.stringify(projectId)}, invocationName=${JSON.stringify(invocationName)}, invocationId=${JSON.stringify(pinned.id)}. Keep the same invocationName; omitting it saves under main. Then runInvocation with this projectId and invocationName before readRunRows; the earlier run belongs to the earlier invocation definition.`,
              }
            : {}),
        }
      }

      if (rawArgs.action === 'readRunRows') {
        if (!rawArgs.runId) throw new Error('readRunRows requires runId.')
        const startRow = rawArgs.startRow ?? 0
        const limit = rawArgs.limit ?? 10
        if (!Number.isInteger(startRow) || startRow < 0) {
          throw new Error('startRow must be a nonnegative integer.')
        }
        if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
          throw new Error('limit must be an integer from 1 to 25.')
        }
        const invocationId = project.invocations[invocationName]
        if (!invocationId) throw new Error(`Project invocation not found: ${invocationName}`)
        const run = await repository.getRun(invocationId, rawArgs.runId)
        const rowsArtifact = run.artifacts.rows
        const rowIndexArtifact = run.artifacts.rowIndex
        if (!rowsArtifact || !rowIndexArtifact) {
          throw new Error('Invocation run has no readable row artifacts.')
        }
        const rows = []
        for await (const row of iterateInvocationRowRange({
          storage: storageClient,
          rows: rowsArtifact,
          rowIndex: rowIndexArtifact,
          startRow,
          limit: limit + 1,
        })) {
          rows.push(row)
        }
        return {
          type: 'designInvocationRows' as const,
          projectId,
          invocationName,
          runId: run.id,
          startRow,
          rows: rows.slice(0, limit),
          hasMore: rows.length > limit,
        }
      }

      if (rawArgs.action === 'inspectProject') {
        const input = rawArgs.inputPath
          ? {
              path: rawArgs.inputPath,
              content: await readProjectInput(
                { path: rawArgs.inputPath },
                store.readText,
                projectId,
              ),
            }
          : undefined
        if (input && new TextEncoder().encode(input.content).byteLength > 64 * 1024)
          throw new Error(
            'Project input inspection is limited to 64 KiB. Evaluate the project-input source for larger data.',
          )
        const invocations = Object.fromEntries(
          await Promise.all(
            Object.entries(project.invocations).map(async ([name, id]) => [
              name,
              await repository.getInvocation(id),
            ]),
          ),
        )
        return {
          type: 'designProjectInspected' as const,
          projectId,
          ref,
          project,
          invocations,
          ...(input ? { input } : {}),
        }
      }

      throw new Error(`Unknown dagGraphProject action: ${String(rawArgs.action)}`)
    },
  })
}
