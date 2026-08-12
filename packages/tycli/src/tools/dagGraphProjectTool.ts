import { createTool } from '@taskyon/taskyon/api'
import type { Hash } from '@taskyon/comp-dag/caching'
import {
  compileDagNodeRecordGraph,
  loadDagNodeRecordGraph,
} from '@taskyon/comp-dag/dagNodeRecordGraph'
import {
  saveStoredGraphNodeSource,
  type StoredGraphNodeFile,
} from '@taskyon/comp-dag/dagNodeLoader'
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
  type DesignGraphStorageClient,
} from '@taskyon/comp-dag/designGraphRepository'
import { executeInvocation } from '@taskyon/comp-dag/invocationExecution'
import type {
  Objective,
  OptimizationCaptureSpec,
  OptimizationInputSpec,
  VariableSpec,
} from '@taskyon/comp-dag/optimization'
import { toDagExploreInputs } from '@taskyon/comp-dag/runtime/runPlanner'
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
  projectId: string
  displayName?: string
  invocationName?: string
  nodeSource?: string
  rootNodeId?: Hash
  variables?: Record<string, VariableSpec>
  inputs?: Record<string, OptimizationInputSpec>
  objectives?: Objective[]
  constraints?: InvocationConstraint[]
  capture?: OptimizationCaptureSpec[]
  policy?: InvocationRequestedPolicy
  expectedProjectRevisionId?: Hash
}

const normalizeProjectId = (projectId: string): string => {
  const normalized = projectId.trim().replace(/[^a-zA-Z0-9._-]/g, '-')
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error('projectId must contain at least one safe filename character.')
  }
  return normalized
}

const projectRefName = (projectId: string) => `projects/${projectId}`

const loadNodeFiles = async (
  store: ReturnType<typeof createStorageDesignGraphObjectStore>,
): Promise<StoredGraphNodeFile[]> =>
  await Promise.all(
    (await store.list('nodes'))
      .filter((name) => name.endsWith('.ts') && !name.includes('/'))
      .map(async (name) => ({
        path: `nodes/${name}`,
        source: await store.readText(`nodes/${name}`),
      })),
  )

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
) => {
  const store = createStorageDesignGraphObjectStore(storageClient)
  const repository = createDesignGraphRepository(store)
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
    longDescription: `Use this for reproducible design, exploration, and optimization work. The global graph contains immutable TypeScript node objects; projects reference that shared graph rather than copying it. A stable project ref advances explicitly to immutable project revisions, which name immutable invocation definitions. Running an invocation evaluates its exact computational root, streams rows into content-addressed artifacts, and records one terminal invocation run. Every write returns the hashes needed for later calls.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'projectId'] as string[],
      properties: {
        action: {
          type: 'string',
          enum: [
            'createNode',
            'createProject',
            'saveInvocation',
            'runInvocation',
            'inspectProject',
          ],
          description:
            'Operation to perform: add a global graph node, create a project, save a new invocation revision, run a named invocation, or inspect a project.',
        },
        projectId: {
          type: 'string',
          description:
            'Stable project identifier used to derive the mutable projects/<projectId> ref.',
        },
        displayName: {
          type: 'string',
          description: 'Human-readable project name stored in the immutable project revision.',
        },
        invocationName: {
          type: 'string',
          default: 'main',
          description: 'Project-local name of the invocation to create, replace, run, or inspect.',
        },
        nodeSource: {
          type: 'string',
          description:
            "Full standalone TypeScript source for createNode. Export one default formatVersion 2 object with id '__TASKYON_SELF_HASH__', localName, label, version, localParamsSchema, outputSchema, optional hashed inputs, and an async run({ params, use }) function. Do not import application types.",
          examples: [
            "export default { formatVersion: 2, id: '__TASKYON_SELF_HASH__', localName: 'score', label: 'Score', version: 1, localParamsSchema: { type: 'object', properties: { value: { type: 'number' } }, required: ['value'] }, outputSchema: { type: 'number' }, inputs: {}, async run({ params }) { return params.value } }",
          ],
        },
        rootNodeId: {
          type: 'string',
          description:
            'Content hash of the exact computational root for createProject or saveInvocation.',
        },
        variables: {
          type: 'object',
          additionalProperties: true,
          description: 'Invocation parameter constants, ranges, sets, and other variable domains.',
        },
        inputs: {
          type: 'object',
          additionalProperties: true,
          description: 'Invocation domains and strategies assigned to named computational inputs.',
        },
        objectives: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Optimization objectives; omit them for design or exploration invocations.',
        },
        constraints: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: 'Constraints applied while planning and evaluating the invocation.',
        },
        capture: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
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
    } as const,
    function: async (rawArgs: DagGraphProjectToolArgs) => {
      const projectId = normalizeProjectId(rawArgs.projectId)
      const invocationName = rawArgs.invocationName?.trim() || 'main'

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
          projectId,
          nodeId: saved.hash,
          localName: saved.node.localName,
          graphRevisionId: revision.id,
        }
      }

      if (rawArgs.action === 'createProject') {
        const invocation = requireInvocationFields(rawArgs)
        await repository.putInvocation(invocation)
        const revision = createProjectRevision({
          parents: [],
          displayName: rawArgs.displayName?.trim() || projectId,
          invocations: { [invocationName]: invocation.id },
          extensions: {},
        })
        await repository.putProjectRevision(revision)
        await repository.advanceProjectRef({
          name: projectRefName(projectId),
          revisionId: revision.id,
          expected: null,
        })
        return { type: 'designProjectCreated' as const, projectId, revision, invocation }
      }

      const ref = await repository.getProjectRef(projectRefName(projectId))
      if (!ref) throw new Error(`Design graph project not found: ${projectId}`)
      const project = await repository.getProjectRevision(ref.revisionId)

      if (rawArgs.action === 'saveInvocation') {
        const invocation = requireInvocationFields(rawArgs)
        await repository.putInvocation(invocation)
        const revision = createProjectRevision({
          parents: [project.id],
          displayName: rawArgs.displayName?.trim() || project.displayName,
          invocations: { ...project.invocations, [invocationName]: invocation.id },
          extensions: project.extensions,
        })
        await repository.putProjectRevision(revision)
        await repository.advanceProjectRef({
          name: projectRefName(projectId),
          revisionId: revision.id,
          expected: rawArgs.expectedProjectRevisionId ?? project.id,
        })
        return { type: 'designInvocationSaved' as const, projectId, revision, invocation }
      }

      if (rawArgs.action === 'runInvocation') {
        const invocationId = project.invocations[invocationName]
        if (!invocationId) throw new Error(`Project invocation not found: ${invocationName}`)
        const invocation = await repository.getInvocation(invocationId)
        const graph = await loadDagNodeRecordGraph(await loadNodeFiles(store))
        const compiled = compileDagNodeRecordGraph({ graph, rootHash: invocation.rootNodeId })
        const root = compiled[invocation.rootNodeId]
        if (!root) throw new Error(`Invocation root node not found: ${invocation.rootNodeId}`)
        const result = await executeInvocation({
          invocation,
          dependencies: {
            repository,
            artifacts: artifactStore,
            makeAttemptId: () => crypto.randomUUID(),
            evaluate: async ({ params, signal }) => {
              if (signal?.aborted) throw new Error('Invocation cancelled.')
              const evaluated = await root.call(params).run(undefined, {
                execution: { mode: 'local' },
                storageBackend: dagBackend,
              })
              return { outputs: evaluated.value }
            },
            evaluateRows: async ({ params, maxRows, signal, onRow }) => {
              if (signal?.aborted) throw new Error('Invocation cancelled.')
              const inputs = toDagExploreInputs(invocation.inputs)
              const studyParams = Object.fromEntries(
                Object.keys(invocation.inputs).map((alias) => [alias, params[alias] ?? {}]),
              )
              await root.call({ ...params, ...studyParams }).study(
                {
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
                  ...(maxRows === undefined ? {} : { budget: { maxRows } }),
                  collectRows: false,
                  collectHistory: Object.values(invocation.inputs).some(
                    (input) =>
                      input.strategy?.id !== undefined && input.strategy.id !== 'sequential',
                  ),
                  onRow: async (row) =>
                    await onRow({
                      outputs: row.row,
                      ...(row.captured ? { captured: row.captured } : {}),
                      inputSelection: {
                        rowKey: row.rowKey,
                        sourceIndexByAlias: row.sourceIndexByAlias,
                      },
                    }),
                },
                undefined,
                { execution: { mode: 'local' }, storageBackend: dagBackend },
              )
            },
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
