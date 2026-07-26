import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { createTool } from '@taskyon/taskyon/api'
import type { Hash } from '@taskyon/comp-dag/caching'
import { canonicalHash, type DagStorageBackend } from '@taskyon/comp-dag/caching'
import {
  compileDagNodeRecordGraph,
  loadDagNodeRecordGraph,
  readStoredGraphNodeDirectory,
} from '@taskyon/comp-dag/dagNodeGraph'
import {
  saveStoredGraphNodeSource,
  type StoredGraphNodeFile,
} from '@taskyon/comp-dag/dagNodeLoader'
import { createDagGraphPatchTool } from '@taskyon/comp-dag/dagGraphTool'
import type { StudyOptions } from '@taskyon/comp-dag/dagCore'
import type { DagGraphRoots } from '@taskyon/comp-dag/storedDagGraph'
import {
  createDesignEvaluationRecord,
  createDesignExecutionConfig,
  createDesignRevision,
  createDesignSpaceRecord,
  createEmptyDesignSpaceRecord,
  parseDesignSpaceRecord,
  type DesignRevisionId,
  type DesignRevisionV1,
  type DesignSpaceRecord,
} from '@taskyon/comp-dag/designRevision'
import {
  createDesignProjectRepository,
  type DesignProjectObjectStore,
} from '@taskyon/comp-dag/designProjectRepository'
import { assertPathInsideArtifactRoot, resolveWorkspacePath } from './workspacePaths'

const DEFAULT_GRAPH_DIR = 'taskyon-artifacts/dag-graphs'
const DEFAULT_ROOT_NAME = 'main'

type GraphProjectAction =
  | 'createNode'
  | 'createRevision'
  | 'advanceRef'
  | 'patchNode'
  | 'runRoot'
  | 'studyRoot'
  | 'saveDesign'
  | 'migrateLegacyProject'
  | 'inspectProject'

type DagGraphProjectToolArgs = {
  action: GraphProjectAction
  projectId: string
  nodeSource?: string
  localName?: string
  rootName?: string
  revisionId?: DesignRevisionId
  refName?: string
  expectedRevisionId?: DesignRevisionId
  roots?: DagGraphRoots
  parents?: DesignRevisionId[]
  designSpace?:
    | DesignSpaceRecord
    | {
        variables?: Record<string, unknown>
        objectives?: unknown[]
        constraints?: unknown[]
        inputPolicies?: Record<string, unknown>
      }
  message?: string
  taskIds?: string[]
  designName?: string
  evaluationId?: Hash
  params?: Record<string, unknown>
  study?: StudyOptions
  artifactRoot?: string
}

type DagGraphProjectFileSystem = {
  workspaceRoot: string
}

const nodeDirectoryFor = (projectId: string) => `${DEFAULT_GRAPH_DIR}/${projectId}/nodes`
const rootsPathFor = (projectId: string) => `${DEFAULT_GRAPH_DIR}/${projectId}/roots.json`
const projectPathFor = (projectId: string, path: string) =>
  `${DEFAULT_GRAPH_DIR}/${projectId}/${path}`

const isMissingFileError = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

const normalizeProjectId = (projectId: string): string => {
  const normalized = projectId.trim().replace(/[^a-zA-Z0-9._-]/g, '-')
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error('projectId must contain at least one safe filename character.')
  }
  return normalized
}

const createProjectObjectStore = (
  fileSystem: DagGraphProjectFileSystem,
  projectId: string,
): DesignProjectObjectStore => ({
  read: async (path) => {
    const fullPath = resolveWorkspacePath(projectPathFor(projectId, path), fileSystem.workspaceRoot)
    return await readFile(fullPath, 'utf8')
      .then((text) => JSON.parse(text) as unknown)
      .catch((error: unknown) => {
        if (isMissingFileError(error)) return null
        throw error
      })
  },
  write: async (path, value) => {
    const fullPath = resolveWorkspacePath(projectPathFor(projectId, path), fileSystem.workspaceRoot)
    await mkdir(dirname(fullPath), { recursive: true })
    await writeFile(fullPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  },
  list: async (directory) => {
    const fullPath = resolveWorkspacePath(
      projectPathFor(projectId, directory),
      fileSystem.workspaceRoot,
    )
    return await readdir(fullPath).catch((error: unknown) => {
      if (isMissingFileError(error)) return []
      throw error
    })
  },
})

const createProjectDagBackend = (
  fileSystem: DagGraphProjectFileSystem,
  projectId: string,
): DagStorageBackend => {
  const store = createProjectObjectStore(fileSystem, projectId)
  const cachePath = 'cache/index.json'
  return {
    readArtifact: async <O>(hash: Hash) => {
      const value = await store.read(`artifacts/${hash}.json`)
      if (value === null) throw new Error(`Artifact not found: ${hash}`)
      return value as O
    },
    writeArtifact: async (value) => {
      const hash = canonicalHash(JSON.stringify(value))
      await store.write(`artifacts/${hash}.json`, value)
      return hash
    },
    getCacheEntry: async (key) => {
      const index = (await store.read(cachePath)) as Record<string, { artifact: Hash }> | null
      return index?.[key] ?? null
    },
    setCacheEntry: async (key, entry) => {
      const index = ((await store.read(cachePath)) ?? {}) as Record<string, { artifact: Hash }>
      await store.write(cachePath, { ...index, [key]: entry })
    },
  }
}

const projectRepository = (fileSystem: DagGraphProjectFileSystem, projectId: string) =>
  createDesignProjectRepository(createProjectObjectStore(fileSystem, projectId))

const writeStoredNodeFile = async (
  fileSystem: DagGraphProjectFileSystem,
  projectId: string,
  file: StoredGraphNodeFile,
) => {
  const fullPath = resolveWorkspacePath(
    `${DEFAULT_GRAPH_DIR}/${projectId}/${file.path}`,
    fileSystem.workspaceRoot,
  )
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, file.source, 'utf8')
  return relative(fileSystem.workspaceRoot, fullPath)
}

const loadRoots = async (
  fileSystem: DagGraphProjectFileSystem,
  projectId: string,
): Promise<DagGraphRoots> => {
  const fullPath = resolveWorkspacePath(rootsPathFor(projectId), fileSystem.workspaceRoot)
  const text = await readFile(fullPath, 'utf8').catch((error: unknown) => {
    if (isMissingFileError(error)) return '{}'
    throw error
  })
  const parsed = JSON.parse(text) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Graph project ${projectId}: roots.json must be an object.`)
  }
  return parsed as DagGraphRoots
}

const loadProjectFiles = async (
  fileSystem: DagGraphProjectFileSystem,
  projectId: string,
): Promise<StoredGraphNodeFile[]> => {
  const dirPath = resolveWorkspacePath(nodeDirectoryFor(projectId), fileSystem.workspaceRoot)
  const exists = await readdir(dirPath)
    .then(() => true)
    .catch((error: unknown) => {
      if (isMissingFileError(error)) return false
      throw error
    })
  if (!exists) return []
  return await readStoredGraphNodeDirectory(pathToFileURL(`${dirPath}/`))
}

const requireProjectFiles = async (fileSystem: DagGraphProjectFileSystem, projectId: string) => {
  const files = await loadProjectFiles(fileSystem, projectId)
  if (files.length === 0) {
    throw new Error(`Graph project ${projectId}: no stored DAG node files found.`)
  }
  return files
}

const requireRoots = async (fileSystem: DagGraphProjectFileSystem, projectId: string) => {
  const roots = await loadRoots(fileSystem, projectId)
  if (Object.keys(roots).length === 0) {
    throw new Error(`Graph project ${projectId}: roots.json has no roots.`)
  }
  return roots
}

const applyPatchToProject = async (args: {
  fileSystem: DagGraphProjectFileSystem
  projectId: string
  revision: DesignRevisionV1
  rootName: string
  localName: string
  nodeSource: string
}) => {
  const files = await requireProjectFiles(args.fileSystem, args.projectId)
  const roots = Object.fromEntries(
    Object.entries(args.revision.roots).map(([name, root]) => [name, root.nodeId]),
  )
  const patchTool = createDagGraphPatchTool(<T>(tool: T) => tool)
  return await patchTool.function({
    projectId: args.projectId,
    files,
    roots,
    rootName: args.rootName,
    targetLocalName: args.localName,
    source: args.nodeSource,
  })
}

const resolveRevision = async (args: {
  fileSystem: DagGraphProjectFileSystem
  projectId: string
  revisionId?: DesignRevisionId
  refName?: string
}): Promise<DesignRevisionV1> => {
  const repository = projectRepository(args.fileSystem, args.projectId)
  if (args.revisionId) return await repository.getRevision(args.revisionId)
  const refName = args.refName?.trim() || DEFAULT_ROOT_NAME
  const ref = await repository.getRef(refName)
  if (!ref) throw new Error(`Graph project ${args.projectId}: ref not found: ${refName}`)
  return await repository.getRevision(ref.revisionId)
}

const requireRevisionRoot = (revision: DesignRevisionV1, rootName: string): Hash => {
  const root = revision.roots[rootName]
  if (!root) throw new Error(`Design revision ${revision.id}: root not found: ${rootName}`)
  return root.nodeId
}

const runProjectRoot = async (args: {
  fileSystem: DagGraphProjectFileSystem
  projectId: string
  rootName: string
  revisionId?: DesignRevisionId
  refName?: string
  params?: Record<string, unknown>
}) => {
  const files = await requireProjectFiles(args.fileSystem, args.projectId)
  const revision = await resolveRevision(args)
  const rootHash = requireRevisionRoot(revision, args.rootName)
  const graph = await loadDagNodeRecordGraph(files)
  const compiled = compileDagNodeRecordGraph({ graph, rootHash })
  const root = compiled[rootHash]
  if (!root) throw new Error(`Graph project ${args.projectId}: missing root node ${rootHash}`)
  const run = await root.call(args.params ?? {}).run(undefined, {
    execution: { mode: 'local' },
    storageBackend: createProjectDagBackend(args.fileSystem, args.projectId),
  })
  const repository = projectRepository(args.fileSystem, args.projectId)
  const execution = createDesignExecutionConfig({
    kind: 'design',
    params: args.params ?? {},
  })
  await repository.putExecutionConfig(args.rootName, execution.id, execution.value)
  const evaluation = createDesignEvaluationRecord({
    revisionId: revision.id,
    rootName: args.rootName,
    executionConfigId: execution.id,
    resultArtifactId: run.artifactHash,
  })
  await repository.putEvaluation(evaluation)
  return {
    revisionId: revision.id,
    rootHash,
    localName: root.localName ?? root.name,
    value: run.value,
    artifactHash: run.artifactHash,
    executionConfigId: execution.id,
    evaluationId: evaluation.id,
  }
}

const studyProjectRoot = async (args: {
  fileSystem: DagGraphProjectFileSystem
  projectId: string
  rootName: string
  revisionId?: DesignRevisionId
  refName?: string
  params?: Record<string, unknown>
  study?: StudyOptions
}) => {
  const files = await requireProjectFiles(args.fileSystem, args.projectId)
  const revision = await resolveRevision(args)
  const rootHash = requireRevisionRoot(revision, args.rootName)
  const graph = await loadDagNodeRecordGraph(files)
  const compiled = compileDagNodeRecordGraph({ graph, rootHash })
  const root = compiled[rootHash]
  if (!root) throw new Error(`Graph project ${args.projectId}: missing root node ${rootHash}`)
  const storageBackend = createProjectDagBackend(args.fileSystem, args.projectId)
  const result = await root.call(args.params ?? {}).study(args.study ?? {}, undefined, {
    execution: { mode: 'local' },
    storageBackend,
  })
  const mode = args.study?.mode ?? 'explore'
  const config = {
    variables: args.study?.variables ?? {},
    inputs: args.study?.inputs ?? {},
    ...(args.study?.objective ? { objective: args.study.objective } : {}),
    ...(args.study?.budget ? { budget: args.study.budget } : {}),
    ...(args.study?.capture ? { capture: args.study.capture } : {}),
    ...(typeof args.study?.rngSeed === 'number' ? { rngSeed: args.study.rngSeed } : {}),
  }
  const execution =
    mode === 'optimize'
      ? createDesignExecutionConfig({
          kind: 'optimization',
          config: { ...config, mode: 'optimize' },
        })
      : createDesignExecutionConfig({
          kind: 'study',
          config: { ...config, mode: 'explore' },
        })
  const repository = projectRepository(args.fileSystem, args.projectId)
  await repository.putExecutionConfig(args.rootName, execution.id, execution.value)
  const resultArtifactId = await storageBackend.writeArtifact(result)
  const evaluation = createDesignEvaluationRecord({
    revisionId: revision.id,
    rootName: args.rootName,
    executionConfigId: execution.id,
    resultArtifactId,
  })
  await repository.putEvaluation(evaluation)
  return {
    revisionId: revision.id,
    rootHash,
    localName: root.localName ?? root.name,
    bestIndex: result.bestIndex,
    best: result.best,
    completedEvals: result.completedEvals,
    stoppedReason: result.stoppedReason,
    plan: result.plan,
    rows: result.rows,
    rowKeys: result.rowKeys,
    resultArtifactId,
    executionConfigId: execution.id,
    evaluationId: evaluation.id,
  }
}

const createNode = async (args: {
  fileSystem: DagGraphProjectFileSystem
  projectId: string
  nodeSource?: string
}) => {
  if (!args.nodeSource) throw new Error('createNode requires nodeSource.')
  const saved = await saveStoredGraphNodeSource(args.nodeSource, {
    directory: 'nodes',
  })
  const nodePath = await writeStoredNodeFile(args.fileSystem, args.projectId, saved.file)
  return {
    type: 'dagGraphNodeCreated' as const,
    projectId: args.projectId,
    rootHash: saved.hash,
    localName: saved.node.localName,
    nodePath,
    file: saved.file,
  }
}

const patchNode = async (args: {
  fileSystem: DagGraphProjectFileSystem
  projectId: string
  nodeSource?: string
  localName?: string
  rootName: string
  revisionId?: DesignRevisionId
  refName?: string
  message?: string
  taskIds?: string[]
}) => {
  if (!args.nodeSource) throw new Error('patchNode requires nodeSource.')
  if (!args.localName) throw new Error('patchNode requires localName.')
  const previousRevision = await resolveRevision(args)
  const result = await applyPatchToProject({
    fileSystem: args.fileSystem,
    projectId: args.projectId,
    revision: previousRevision,
    rootName: args.rootName,
    localName: args.localName,
    nodeSource: args.nodeSource,
  })
  const nodePaths = await Promise.all(
    result.createdFiles.map((file) => writeStoredNodeFile(args.fileSystem, args.projectId, file)),
  )
  const nextRevision = createDesignRevision({
    parents: [previousRevision.id],
    roots: Object.fromEntries(
      Object.entries(result.nextRoots).map(([name, nodeId]) => [
        name,
        { nodeId, output: '$' as const },
      ]),
    ),
    designSpaceId: previousRevision.designSpaceId,
  })
  await projectRepository(args.fileSystem, args.projectId).putRevision(nextRevision, {
    schemaVersion: 1,
    revisionId: nextRevision.id,
    ...(args.message ? { message: args.message } : {}),
    ...(args.taskIds ? { taskIds: args.taskIds } : {}),
    createdAtMs: Date.now(),
  })
  return {
    ...result,
    previousRevisionId: previousRevision.id,
    nextRevisionId: nextRevision.id,
    nodePaths,
  }
}

const createRevisionRecord = async (args: {
  fileSystem: DagGraphProjectFileSystem
  projectId: string
  roots?: DagGraphRoots
  parents?: DesignRevisionId[]
  designSpace?: DagGraphProjectToolArgs['designSpace']
  message?: string
  taskIds?: string[]
}) => {
  if (!args.roots || Object.keys(args.roots).length === 0) {
    throw new Error('createRevision requires at least one named root.')
  }
  const files = await requireProjectFiles(args.fileSystem, args.projectId)
  const graph = await loadDagNodeRecordGraph(files)
  for (const [name, hash] of Object.entries(args.roots)) {
    if (!graph[hash]) throw new Error(`Revision root ${name} points to missing node ${hash}`)
  }
  const repository = projectRepository(args.fileSystem, args.projectId)
  const suppliedDesignSpace = args.designSpace
  const designSpace = suppliedDesignSpace
    ? 'schemaVersion' in suppliedDesignSpace
      ? parseDesignSpaceRecord(suppliedDesignSpace)
      : createDesignSpaceRecord({
          variables: suppliedDesignSpace.variables ?? {},
          objectives: suppliedDesignSpace.objectives ?? [],
          constraints: suppliedDesignSpace.constraints ?? [],
          inputPolicies: suppliedDesignSpace.inputPolicies ?? {},
        })
    : createEmptyDesignSpaceRecord()
  await repository.putDesignSpace(designSpace)
  const revision = createDesignRevision({
    parents: args.parents ?? [],
    roots: Object.fromEntries(
      Object.entries(args.roots).map(([name, nodeId]) => [name, { nodeId, output: '$' as const }]),
    ),
    designSpaceId: designSpace.id,
  })
  await repository.putRevision(revision, {
    schemaVersion: 1,
    revisionId: revision.id,
    ...(args.message ? { message: args.message } : {}),
    ...(args.taskIds ? { taskIds: args.taskIds } : {}),
    createdAtMs: Date.now(),
  })
  return { revision, designSpace }
}

const migrateLegacyProject = async (args: {
  fileSystem: DagGraphProjectFileSystem
  projectId: string
  refName: string
}) => {
  const roots = await requireRoots(args.fileSystem, args.projectId)
  const created = await createRevisionRecord({
    ...args,
    roots,
    message: 'Migrated from roots.json',
  })
  const repository = projectRepository(args.fileSystem, args.projectId)
  await repository.advanceRef({
    name: args.refName,
    revisionId: created.revision.id,
    expectedRevisionId: null,
  })
  const legacyPath = resolveWorkspacePath(
    rootsPathFor(args.projectId),
    args.fileSystem.workspaceRoot,
  )
  const archivePath = resolveWorkspacePath(
    projectPathFor(args.projectId, 'legacy/roots.v0.json'),
    args.fileSystem.workspaceRoot,
  )
  await mkdir(dirname(archivePath), { recursive: true })
  await writeFile(archivePath, await readFile(legacyPath, 'utf8'), 'utf8')
  return { ...created, refName: args.refName, archivedRootsPath: archivePath }
}

const optionalField = <Name extends string, Value>(
  name: Name,
  value: Value | undefined,
): Record<Name, Value> | Record<string, never> =>
  value === undefined ? {} : ({ [name]: value } as Record<Name, Value>)

export const createDagGraphProjectTool = (options: { workspaceRoot?: string } = {}) => {
  const fileSystem = { workspaceRoot: resolve(options.workspaceRoot ?? process.cwd()) }
  return createTool({
    name: 'dagGraphProject',
    description:
      'Create, revise, evaluate, and inspect file-backed immutable design-graph projects.',
    longDescription: `Use this for design and optimization workflows that should persist their reasoning as immutable DAG graph nodes.
Create stored nodes without selecting them, create immutable revisions with named roots, advance named refs explicitly, patch a revision into a candidate revision, and evaluate exact revisions.

Node source format:
- Export one standalone default object; stored node files do not import application types.
- Include formatVersion: 2, id: '__TASKYON_SELF_HASH__', localName, label, version: 1, localParamsSchema, outputSchema, optional inputs, and run.
- Use inputs like { requirements: { nodeId: '<hash from a previous result>', role: 'internal' } }.
- Stored run functions receive { params, use }. Call await use.requirements({}) only when that dependency is needed; exposed inputs may be called without explicit params.
- The tool normalizes source, computes the real hash, writes a .ts node file, and returns the new rootHash.`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action', 'projectId'] as string[],
      properties: {
        action: {
          type: 'string',
          enum: [
            'createNode',
            'createRevision',
            'advanceRef',
            'patchNode',
            'runRoot',
            'studyRoot',
            'saveDesign',
            'migrateLegacyProject',
            'inspectProject',
          ],
        },
        projectId: {
          type: 'string',
          description: 'Safe project id used under taskyon-artifacts/dag-graphs/<projectId>.',
        },
        nodeSource: {
          type: 'string',
          description: 'Full TypeScript stored DAG node source for createNode or patchNode.',
        },
        localName: {
          type: 'string',
          description: 'Local node name to patch when action is patchNode.',
        },
        rootName: {
          type: 'string',
          default: DEFAULT_ROOT_NAME,
          description: 'Named graph root to create, patch, run, or study.',
        },
        revisionId: {
          type: 'string',
          description: 'Exact immutable revision. If omitted, refName is resolved.',
        },
        refName: {
          type: 'string',
          default: DEFAULT_ROOT_NAME,
          description: 'Mutable named ref used to resolve or advance a revision.',
        },
        expectedRevisionId: {
          type: 'string',
          description: 'Expected current ref target used for conflict-safe advancement.',
        },
        roots: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'Named node hashes selected by createRevision.',
        },
        parents: {
          type: 'array',
          items: { type: 'string' },
          description: 'Parent revision ids for createRevision.',
        },
        designSpace: {
          type: 'object',
          additionalProperties: true,
          description: 'Semantic variables, objectives, constraints, and input policies.',
        },
        message: {
          type: 'string',
          description: 'Human revision metadata; excluded from revision identity.',
        },
        taskIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Task provenance metadata; excluded from revision identity.',
        },
        designName: {
          type: 'string',
          description: 'Human name for a saved design evaluation.',
        },
        evaluationId: {
          type: 'string',
          description: 'Evaluation id selected by saveDesign.',
        },
        params: {
          type: 'object',
          additionalProperties: true,
          description: 'Root node params for runRoot or studyRoot.',
        },
        study: {
          type: 'object',
          additionalProperties: true,
          description:
            'StudyOptions for studyRoot, including mode, variables, objective, and budget.',
        },
        artifactRoot: {
          type: 'string',
          description: 'Optional relative root; when set, graph project files must stay below it.',
        },
      },
    } as const,
    function: async (rawArgs: DagGraphProjectToolArgs) => {
      const projectId = normalizeProjectId(rawArgs.projectId)
      const rootName = rawArgs.rootName?.trim() || DEFAULT_ROOT_NAME
      assertPathInsideArtifactRoot(`${DEFAULT_GRAPH_DIR}/${projectId}`, rawArgs.artifactRoot)

      if (rawArgs.action === 'createNode') {
        return await createNode({
          fileSystem,
          projectId,
          ...optionalField('nodeSource', rawArgs.nodeSource),
        })
      }
      if (rawArgs.action === 'createRevision') {
        return {
          type: 'designRevisionCreated' as const,
          projectId,
          ...(await createRevisionRecord({
            fileSystem,
            projectId,
            ...optionalField('roots', rawArgs.roots),
            ...optionalField('parents', rawArgs.parents),
            ...optionalField('designSpace', rawArgs.designSpace),
            ...optionalField('message', rawArgs.message),
            ...optionalField('taskIds', rawArgs.taskIds),
          })),
        }
      }
      if (rawArgs.action === 'advanceRef') {
        if (!rawArgs.revisionId) throw new Error('advanceRef requires revisionId.')
        return {
          type: 'designRefAdvanced' as const,
          projectId,
          refName: rawArgs.refName?.trim() || DEFAULT_ROOT_NAME,
          ref: await projectRepository(fileSystem, projectId).advanceRef({
            name: rawArgs.refName?.trim() || DEFAULT_ROOT_NAME,
            revisionId: rawArgs.revisionId,
            ...(rawArgs.expectedRevisionId
              ? { expectedRevisionId: rawArgs.expectedRevisionId }
              : {}),
          }),
        }
      }
      if (rawArgs.action === 'patchNode') {
        return await patchNode({
          fileSystem,
          projectId,
          rootName,
          ...optionalField('revisionId', rawArgs.revisionId),
          ...optionalField('refName', rawArgs.refName),
          ...optionalField('message', rawArgs.message),
          ...optionalField('taskIds', rawArgs.taskIds),
          ...optionalField('localName', rawArgs.localName),
          ...optionalField('nodeSource', rawArgs.nodeSource),
        })
      }
      if (rawArgs.action === 'runRoot') {
        return {
          type: 'dagGraphRunResult' as const,
          projectId,
          ...(await runProjectRoot({
            fileSystem,
            projectId,
            rootName,
            ...optionalField('revisionId', rawArgs.revisionId),
            ...optionalField('refName', rawArgs.refName),
            ...optionalField('params', rawArgs.params),
          })),
        }
      }
      if (rawArgs.action === 'studyRoot') {
        return {
          type: 'dagGraphStudyResult' as const,
          projectId,
          ...(await studyProjectRoot({
            fileSystem,
            projectId,
            rootName,
            ...optionalField('revisionId', rawArgs.revisionId),
            ...optionalField('refName', rawArgs.refName),
            ...optionalField('params', rawArgs.params),
            ...optionalField('study', rawArgs.study),
          })),
        }
      }
      if (rawArgs.action === 'saveDesign') {
        if (!rawArgs.designName || !rawArgs.evaluationId) {
          throw new Error('saveDesign requires designName and evaluationId.')
        }
        return {
          type: 'designSaved' as const,
          projectId,
          rootName,
          savedDesign: await projectRepository(fileSystem, projectId).saveDesign(
            rootName,
            rawArgs.designName,
            rawArgs.evaluationId,
          ),
        }
      }
      if (rawArgs.action === 'migrateLegacyProject') {
        return {
          type: 'designProjectMigrated' as const,
          projectId,
          ...(await migrateLegacyProject({
            fileSystem,
            projectId,
            refName: rawArgs.refName?.trim() || DEFAULT_ROOT_NAME,
          })),
        }
      }
      if (rawArgs.action === 'inspectProject') {
        const repository = projectRepository(fileSystem, projectId)
        const refs = await repository.listRefs()
        return { type: 'designProjectInspected' as const, projectId, refs }
      }
      throw new Error(`Unknown dagGraphProject action: ${String(rawArgs.action)}`)
    },
  })
}

export const dagGraphProjectTool = createDagGraphProjectTool()
