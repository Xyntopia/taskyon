import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, relative } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { createTool } from '@taskyon/taskyon/api'
import type { Hash } from '@taskyon/comp-dag/caching'
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
import { assertPathInsideArtifactRoot, resolveWorkspacePath } from './workspacePaths'

const DEFAULT_GRAPH_DIR = 'taskyon-artifacts/dag-graphs'
const DEFAULT_ROOT_NAME = 'main'

type GraphProjectAction = 'createNode' | 'patchNode' | 'runRoot' | 'studyRoot'

type DagGraphProjectToolArgs = {
  action: GraphProjectAction
  projectId: string
  nodeSource?: string
  localName?: string
  rootName?: string
  rootHash?: Hash
  params?: Record<string, unknown>
  study?: StudyOptions
  artifactRoot?: string
}

const nodeDirectoryFor = (projectId: string) => `${DEFAULT_GRAPH_DIR}/${projectId}/nodes`
const rootsPathFor = (projectId: string) => `${DEFAULT_GRAPH_DIR}/${projectId}/roots.json`

const isMissingFileError = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

const normalizeProjectId = (projectId: string): string => {
  const normalized = projectId.trim().replace(/[^a-zA-Z0-9._-]/g, '-')
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error('projectId must contain at least one safe filename character.')
  }
  return normalized
}

const writeStoredNodeFile = async (projectId: string, file: StoredGraphNodeFile) => {
  const fullPath = resolveWorkspacePath(`${DEFAULT_GRAPH_DIR}/${projectId}/${file.path}`)
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, file.source, 'utf8')
  return relative(process.cwd(), fullPath)
}

const loadRoots = async (projectId: string): Promise<DagGraphRoots> => {
  const fullPath = resolveWorkspacePath(rootsPathFor(projectId))
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

const saveRoots = async (projectId: string, roots: DagGraphRoots) => {
  const fullPath = resolveWorkspacePath(rootsPathFor(projectId))
  await mkdir(dirname(fullPath), { recursive: true })
  await writeFile(fullPath, `${JSON.stringify(roots, null, 2)}\n`, 'utf8')
  return relative(process.cwd(), fullPath)
}

const loadProjectFiles = async (projectId: string): Promise<StoredGraphNodeFile[]> => {
  const dirPath = resolveWorkspacePath(nodeDirectoryFor(projectId))
  const exists = await readdir(dirPath)
    .then(() => true)
    .catch((error: unknown) => {
      if (isMissingFileError(error)) return false
      throw error
    })
  if (!exists) return []
  return await readStoredGraphNodeDirectory(pathToFileURL(`${dirPath}/`))
}

const requireProjectFiles = async (projectId: string) => {
  const files = await loadProjectFiles(projectId)
  if (files.length === 0) {
    throw new Error(`Graph project ${projectId}: no stored DAG node files found.`)
  }
  return files
}

const requireRoots = async (projectId: string) => {
  const roots = await loadRoots(projectId)
  if (Object.keys(roots).length === 0) {
    throw new Error(`Graph project ${projectId}: roots.json has no roots.`)
  }
  return roots
}

const loadExistingProject = async (projectId: string) => {
  const [files, roots] = await Promise.all([
    requireProjectFiles(projectId),
    requireRoots(projectId),
  ])
  return { files, roots }
}

const applyPatchToProject = async (args: {
  projectId: string
  rootName: string
  localName: string
  nodeSource: string
}) => {
  const { files, roots } = await loadExistingProject(args.projectId)
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

const requireRootHash = async (args: {
  projectId: string
  rootName: string
  rootHash?: Hash
}): Promise<Hash> => {
  if (args.rootHash) return args.rootHash
  const roots = await loadRoots(args.projectId)
  const rootHash = roots[args.rootName]
  if (!rootHash)
    throw new Error(`Graph project ${args.projectId}: root not found: ${args.rootName}`)
  return rootHash
}

const runProjectRoot = async (args: {
  projectId: string
  rootName: string
  rootHash?: Hash
  params?: Record<string, unknown>
}) => {
  const files = await requireProjectFiles(args.projectId)
  const rootHash = await requireRootHash(args)
  const graph = await loadDagNodeRecordGraph(files)
  const compiled = compileDagNodeRecordGraph({ graph, rootHash })
  const root = compiled[rootHash]
  if (!root) throw new Error(`Graph project ${args.projectId}: missing root node ${rootHash}`)
  const run = await root.call(args.params ?? {}).run(undefined, {
    execution: { mode: 'local' },
  })
  return {
    rootHash,
    localName: root.localName ?? root.name,
    value: run.value,
    artifactHash: run.artifactHash,
  }
}

const studyProjectRoot = async (args: {
  projectId: string
  rootName: string
  rootHash?: Hash
  params?: Record<string, unknown>
  study?: StudyOptions
}) => {
  const files = await requireProjectFiles(args.projectId)
  const rootHash = await requireRootHash(args)
  const graph = await loadDagNodeRecordGraph(files)
  const compiled = compileDagNodeRecordGraph({ graph, rootHash })
  const root = compiled[rootHash]
  if (!root) throw new Error(`Graph project ${args.projectId}: missing root node ${rootHash}`)
  const result = await root.call(args.params ?? {}).study(args.study ?? {}, undefined, {
    execution: { mode: 'local' },
  })
  return {
    rootHash,
    localName: root.localName ?? root.name,
    bestIndex: result.bestIndex,
    best: result.best,
    completedEvals: result.completedEvals,
    stoppedReason: result.stoppedReason,
    plan: result.plan,
    rows: result.rows,
    rowKeys: result.rowKeys,
  }
}

const createNode = async (args: { projectId: string; nodeSource?: string; rootName: string }) => {
  if (!args.nodeSource) throw new Error('createNode requires nodeSource.')
  const saved = await saveStoredGraphNodeSource(args.nodeSource, {
    directory: 'nodes',
  })
  const nodePath = await writeStoredNodeFile(args.projectId, saved.file)
  const roots = await loadRoots(args.projectId)
  const rootsPath = await saveRoots(args.projectId, {
    ...roots,
    [args.rootName]: saved.hash,
  })
  return {
    type: 'dagGraphNodeCreated',
    projectId: args.projectId,
    rootName: args.rootName,
    rootHash: saved.hash,
    localName: saved.node.localName,
    nodePath,
    rootsPath,
    file: saved.file,
  }
}

const patchNode = async (args: {
  projectId: string
  nodeSource?: string
  localName?: string
  rootName: string
}) => {
  if (!args.nodeSource) throw new Error('patchNode requires nodeSource.')
  if (!args.localName) throw new Error('patchNode requires localName.')
  const result = await applyPatchToProject({
    projectId: args.projectId,
    rootName: args.rootName,
    localName: args.localName,
    nodeSource: args.nodeSource,
  })
  const nodePaths = await Promise.all(
    result.createdFiles.map((file) => writeStoredNodeFile(args.projectId, file)),
  )
  const rootsPath = await saveRoots(args.projectId, result.nextRoots)
  return { ...result, nodePaths, rootsPath }
}

const optionalField = <Name extends string, Value>(
  name: Name,
  value: Value | undefined,
): Record<Name, Value> | Record<string, never> =>
  value === undefined ? {} : ({ [name]: value } as Record<Name, Value>)

export const dagGraphProjectTool = createTool({
  name: 'dagGraphProject',
  description: 'Create, patch, run, and study file-backed immutable TypeScript DAG graph projects.',
  longDescription: `Use this for design and optimization workflows that should persist their reasoning as immutable DAG graph nodes.
Create TypeScript stored DAG nodes with createNode, update selected graph roots with patchNode, run a root with runRoot, and compare variants with studyRoot.

Node source format:
- Import the type: import type { StoredDagNodeModule } from '@taskyon/comp-dag/dagNodeLoader'
- Export one default object that satisfies StoredDagNodeModule.
- Include id: '__TASKYON_SELF_HASH__', localName, label, version: 1, localParamsSchema, outputSchema, optional inputs, and run.
- Use inputs like { requirements: { nodeId: '<hash from a previous result>', role: 'internal' } }.
- The tool normalizes source, computes the real hash, writes a .ts node file, and returns the new rootHash.`,
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action', 'projectId'] as string[],
    properties: {
      action: {
        type: 'string',
        enum: ['createNode', 'patchNode', 'runRoot', 'studyRoot'],
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
      rootHash: {
        type: 'string',
        description: 'Optional explicit root hash. Defaults to roots[rootName].',
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
        projectId,
        rootName,
        ...optionalField('nodeSource', rawArgs.nodeSource),
      })
    }
    if (rawArgs.action === 'patchNode') {
      return await patchNode({
        projectId,
        rootName,
        ...optionalField('localName', rawArgs.localName),
        ...optionalField('nodeSource', rawArgs.nodeSource),
      })
    }
    if (rawArgs.action === 'runRoot') {
      return {
        type: 'dagGraphRunResult',
        projectId,
        ...(await runProjectRoot({
          projectId,
          rootName,
          ...optionalField('rootHash', rawArgs.rootHash),
          ...optionalField('params', rawArgs.params),
        })),
      }
    }
    if (rawArgs.action === 'studyRoot') {
      return {
        type: 'dagGraphStudyResult',
        projectId,
        ...(await studyProjectRoot({
          projectId,
          rootName,
          ...optionalField('rootHash', rawArgs.rootHash),
          ...optionalField('params', rawArgs.params),
          ...optionalField('study', rawArgs.study),
        })),
      }
    }
    throw new Error(`Unknown dagGraphProject action: ${String(rawArgs.action)}`)
  },
})
