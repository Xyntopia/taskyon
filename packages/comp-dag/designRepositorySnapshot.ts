import type { Hash } from './caching.ts'
import {
  parseDesignGraphRef,
  parseGraphRevision,
  parseInvocationDefinition,
  parseProjectExtension,
  parseProjectRevision,
  type GraphRevision,
  type InvocationDefinition,
  type ProjectExtension,
  type ProjectRevision,
} from './designGraphModel.ts'
import { getDagNodeRecordInputHashes } from './dagNodeRecord.ts'
import {
  getDagModuleLockModuleIds,
  parseDagModuleArtifact,
  parseDagModuleLock,
  type DagModuleArtifact,
  type DagModuleLock,
} from './dagModule.ts'
import { compileLockedDagNodeRunCode } from './dagModuleCompiler.ts'
import {
  loadStoredGraphNodeFile,
  type SavedStoredGraphNode,
  type StoredGraphNodeFile,
} from './dagNodeLoader.ts'

export type DesignRepositoryTextReader = (path: string) => Promise<string>

export type DesignRepositoryCheckout =
  | { kind: 'ref'; name: string }
  | { kind: 'graphRevision'; id: Hash }

export type LoadedDesignRepositorySnapshot = {
  revision: GraphRevision
  files: StoredGraphNodeFile[]
  nodesByHash: Record<Hash, SavedStoredGraphNode>
  moduleLocksByHash: Record<Hash, DagModuleLock>
  modulesByHash: Record<Hash, DagModuleArtifact>
}

export type LoadedProjectRepositorySnapshot = {
  revision: ProjectRevision
  invocations: Record<Hash, InvocationDefinition>
  extensions: Record<Hash, ProjectExtension>
  files: StoredGraphNodeFile[]
  nodesByHash: Record<Hash, SavedStoredGraphNode>
  moduleLocksByHash: Record<Hash, DagModuleLock>
  modulesByHash: Record<Hash, DagModuleArtifact>
}

const safeRefName = (name: string): string => {
  if (
    !name ||
    name.includes('\\') ||
    name
      .split('/')
      .some((segment) => !/^[a-zA-Z0-9._-]+$/.test(segment) || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid design repository ref: ${name}`)
  }
  return name
}

const readJson = async (readText: DesignRepositoryTextReader, path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readText(path)) as unknown
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in design repository object ${path}`, { cause: error })
    }
    throw error
  }
}

const hashFilePart = (id: Hash) => id.replace(':', '_')

const resolveRevisionId = async (
  readText: DesignRepositoryTextReader,
  checkout: DesignRepositoryCheckout,
): Promise<Hash> => {
  if (checkout.kind === 'graphRevision') return checkout.id
  const ref = parseDesignGraphRef(
    await readJson(readText, `refs/${safeRefName(checkout.name)}.json`),
  )
  return ref.revisionId
}

const loadNodeClosure = async (
  readText: DesignRepositoryTextReader,
  rootHashes: readonly Hash[],
): Promise<Record<Hash, SavedStoredGraphNode>> => {
  const pending = [...new Set(rootHashes)]
  const nodesByHash: Record<Hash, SavedStoredGraphNode> = {}
  while (pending.length > 0) {
    const expectedHash = pending.pop()!
    if (nodesByHash[expectedHash]) continue
    const path = `nodes/${hashFilePart(expectedHash)}.ts`
    const saved = await loadStoredGraphNodeFile({ path, source: await readText(path) })
    if (saved.hash !== expectedHash) {
      throw new Error(`Design repository node ${path} resolved to unexpected hash ${saved.hash}`)
    }
    nodesByHash[saved.hash] = saved
    pending.push(...getDagNodeRecordInputHashes(saved.node))
  }
  return nodesByHash
}

const loadModuleClosure = async (
  readText: DesignRepositoryTextReader,
  nodes: Record<Hash, SavedStoredGraphNode>,
): Promise<{
  moduleLocksByHash: Record<Hash, DagModuleLock>
  modulesByHash: Record<Hash, DagModuleArtifact>
}> => {
  const moduleLocksByHash: Record<Hash, DagModuleLock> = {}
  const modulesByHash: Record<Hash, DagModuleArtifact> = {}
  const lockIds = [
    ...new Set(
      Object.values(nodes).flatMap(({ node }) => (node.moduleLockId ? [node.moduleLockId] : [])),
    ),
  ]
  for (const lockId of lockIds) {
    const lock = parseDagModuleLock(
      await readJson(readText, `module-locks/${hashFilePart(lockId)}.json`),
    )
    if (lock.id !== lockId) throw new Error(`Module lock ${lockId} has unexpected identity.`)
    moduleLocksByHash[lock.id] = lock
    for (const moduleId of getDagModuleLockModuleIds(lock)) {
      if (modulesByHash[moduleId]) continue
      const artifact = parseDagModuleArtifact(
        await readJson(readText, `modules/${hashFilePart(moduleId)}.json`),
      )
      if (artifact.id !== moduleId) throw new Error(`Module ${moduleId} has unexpected identity.`)
      modulesByHash[artifact.id] = artifact
    }
  }
  return { moduleLocksByHash, modulesByHash }
}

const compileImportedNodes = async (
  nodes: Record<Hash, SavedStoredGraphNode>,
  moduleLocksByHash: Record<Hash, DagModuleLock>,
  modulesByHash: Record<Hash, DagModuleArtifact>,
): Promise<Record<Hash, SavedStoredGraphNode>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(nodes).map(async ([id, saved]) => {
        if (!saved.node.importsSource || !saved.node.moduleLockId) return [id, saved]
        const lock = moduleLocksByHash[saved.node.moduleLockId]
        if (!lock) throw new Error(`DAG node ${id} references unavailable module lock.`)
        return [
          id,
          {
            ...saved,
            node: {
              ...saved.node,
              runCode: await compileLockedDagNodeRunCode({
                importsSource: saved.node.importsSource,
                runSource: saved.node.runSource,
                lock,
                modules: modulesByHash,
              }),
            },
          },
        ]
      }),
    ),
  ) as Record<Hash, SavedStoredGraphNode>

export const loadDesignRepositorySnapshot = async (args: {
  readText: DesignRepositoryTextReader
  checkout: DesignRepositoryCheckout
}): Promise<LoadedDesignRepositorySnapshot> => {
  const revisionId = await resolveRevisionId(args.readText, args.checkout)
  const revision = parseGraphRevision(
    await readJson(args.readText, `graph-revisions/${hashFilePart(revisionId)}.json`),
  )
  const nodesByHash = await loadNodeClosure(args.readText, Object.values(revision.nodes))
  const modules = await loadModuleClosure(args.readText, nodesByHash)
  const compiledNodes = await compileImportedNodes(
    nodesByHash,
    modules.moduleLocksByHash,
    modules.modulesByHash,
  )
  return {
    revision,
    nodesByHash: compiledNodes,
    ...modules,
    files: Object.values(compiledNodes)
      .map((node) => node.file)
      .sort((left, right) => left.path.localeCompare(right.path)),
  }
}

export const loadProjectRepositorySnapshot = async (args: {
  readText: DesignRepositoryTextReader
  projectRef: string
}): Promise<LoadedProjectRepositorySnapshot> => {
  const refName = args.projectRef.startsWith('projects/')
    ? args.projectRef
    : `projects/${args.projectRef}`
  const ref = parseDesignGraphRef(
    await readJson(args.readText, `refs/${safeRefName(refName)}.json`),
  )
  const revision = parseProjectRevision(
    await readJson(args.readText, `project-revisions/${hashFilePart(ref.revisionId)}.json`),
  )
  const invocations = Object.fromEntries(
    await Promise.all(
      Object.values(revision.invocations).map(async (id) => [
        id,
        parseInvocationDefinition(
          await readJson(args.readText, `invocations/${hashFilePart(id)}.json`),
        ),
      ]),
    ),
  ) as Record<Hash, InvocationDefinition>
  const extensions = Object.fromEntries(
    await Promise.all(
      Object.values(revision.extensions).map(async (id) => [
        id,
        parseProjectExtension(await readJson(args.readText, `extensions/${hashFilePart(id)}.json`)),
      ]),
    ),
  ) as Record<Hash, ProjectExtension>
  const nodesByHash = await loadNodeClosure(
    args.readText,
    Object.values(invocations).map((invocation) => invocation.rootNodeId),
  )
  const modules = await loadModuleClosure(args.readText, nodesByHash)
  const compiledNodes = await compileImportedNodes(
    nodesByHash,
    modules.moduleLocksByHash,
    modules.modulesByHash,
  )
  return {
    revision,
    invocations,
    extensions,
    nodesByHash: compiledNodes,
    ...modules,
    files: Object.values(compiledNodes)
      .map((node) => node.file)
      .sort((left, right) => left.path.localeCompare(right.path)),
  }
}

export const createUrlDesignRepositoryReader = (args: {
  baseUrl: URL
  fetch: typeof globalThis.fetch
}): DesignRepositoryTextReader => {
  const fetchUrl = args.fetch.bind(globalThis)
  const baseUrl = new URL(
    args.baseUrl.href.endsWith('/') ? args.baseUrl.href : `${args.baseUrl.href}/`,
  )
  return async (path) => {
    const response = await fetchUrl(new URL(path, baseUrl))
    if (!response.ok) {
      throw new Error(`Failed to read design repository object ${path}: HTTP ${response.status}`)
    }
    return await response.text()
  }
}
