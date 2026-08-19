import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
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
import {
  createLockedDagNodeRunCodeCompiler,
  createUncachedDagRunCodeCompiler,
} from './dagModuleCompiler.ts'
import {
  loadStoredGraphNodeFiles,
  type SavedStoredGraphNode,
  type StoredGraphNodeFile,
} from './dagNodeLoader.ts'

export type DesignRepositoryTextReader = (path: string) => Promise<string>
export type DesignRepositoryBulkTextReader = (
  paths: readonly string[],
) => Promise<Map<string, string | null>>
export type DesignRepositoryNodeFileLoader = typeof loadStoredGraphNodeFiles

export type DesignRepositoryCheckout =
  | { kind: 'ref'; name: string }
  | { kind: 'graphRevision'; id: Hash }

export type ProjectRepositoryCheckout =
  | { kind: 'ref'; name: string }
  | { kind: 'projectRevision'; id: Hash }

export type LoadedDesignRepositorySnapshot = {
  revision: GraphRevision
  files: StoredGraphNodeFile[]
  nodesByHash: Record<Hash, SavedStoredGraphNode>
  moduleLocksByHash: Record<Hash, DagModuleLock>
  modulesByHash: Record<Hash, DagModuleArtifact>
}

export type LoadedDesignRepositoryNodeSnapshot = Pick<
  LoadedDesignRepositorySnapshot,
  'files' | 'nodesByHash' | 'moduleLocksByHash' | 'modulesByHash'
>

export type LoadedProjectRepositorySnapshot = {
  revision: ProjectRevision
  invocations: Record<Hash, InvocationDefinition>
  extensions: Record<Hash, ProjectExtension>
  files: StoredGraphNodeFile[]
  nodesByHash: Record<Hash, SavedStoredGraphNode>
  moduleLocksByHash: Record<Hash, DagModuleLock>
  modulesByHash: Record<Hash, DagModuleArtifact>
}

export type LoadedProjectRepositoryPresentation = Pick<
  LoadedProjectRepositorySnapshot,
  'revision' | 'invocations' | 'extensions' | 'nodesByHash'
>

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

const parseJson = (source: string, path: string): unknown => {
  try {
    return JSON.parse(source) as unknown
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in design repository object ${path}`, { cause: error })
    }
    throw error
  }
}

const readJson = async (readText: DesignRepositoryTextReader, path: string): Promise<unknown> =>
  parseJson(await readText(path), path)

const hashFilePart = (id: Hash) => id.replace(':', '_')

const readRequiredTexts = async (
  readText: DesignRepositoryTextReader,
  paths: readonly string[],
  readManyText?: DesignRepositoryBulkTextReader,
): Promise<Map<string, string>> => {
  if (paths.length === 0) return new Map()
  const values = readManyText
    ? await readManyText(paths)
    : new Map(await Promise.all(paths.map(async (path) => [path, await readText(path)] as const)))
  return new Map(
    paths.map((path) => {
      const value = values.get(path)
      if (value === null || value === undefined) {
        throw new Error(`Design graph object not found: ${path}`)
      }
      return [path, value]
    }),
  )
}

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

const resolveProjectRevisionId = async (
  readText: DesignRepositoryTextReader,
  checkout: ProjectRepositoryCheckout,
): Promise<Hash> => {
  if (checkout.kind === 'projectRevision') return checkout.id
  const name = checkout.name.startsWith('projects/') ? checkout.name : `projects/${checkout.name}`
  return parseDesignGraphRef(await readJson(readText, `refs/${safeRefName(name)}.json`)).revisionId
}

const loadProjectRevisionDefinition = async (
  readText: DesignRepositoryTextReader,
  revision: ProjectRevision,
): Promise<{
  revision: ProjectRevision
  invocations: Record<Hash, InvocationDefinition>
  extensions: Record<Hash, ProjectExtension>
}> => {
  const invocations = Object.fromEntries(
    await Promise.all(
      Object.values(revision.invocations).map(async (id) => [
        id,
        parseInvocationDefinition(await readJson(readText, `invocations/${hashFilePart(id)}.json`)),
      ]),
    ),
  ) as Record<Hash, InvocationDefinition>
  const extensions = Object.fromEntries(
    await Promise.all(
      Object.values(revision.extensions).map(async (id) => [
        id,
        parseProjectExtension(await readJson(readText, `extensions/${hashFilePart(id)}.json`)),
      ]),
    ),
  ) as Record<Hash, ProjectExtension>
  return { revision, invocations, extensions }
}

const loadProjectDefinition = async (
  readText: DesignRepositoryTextReader,
  checkout: ProjectRepositoryCheckout,
) => {
  const revisionId = await resolveProjectRevisionId(readText, checkout)
  const revision = parseProjectRevision(
    await readJson(readText, `project-revisions/${hashFilePart(revisionId)}.json`),
  )
  return await loadProjectRevisionDefinition(readText, revision)
}

const loadNodeClosure = async (
  readText: DesignRepositoryTextReader,
  rootHashes: readonly Hash[],
  readManyText?: DesignRepositoryBulkTextReader,
  loadNodeFiles?: DesignRepositoryNodeFileLoader,
): Promise<Record<Hash, SavedStoredGraphNode>> => {
  let pending = [...new Set(rootHashes)]
  const nodesByHash: Record<Hash, SavedStoredGraphNode> = {}
  while (pending.length > 0) {
    const batch = [...new Set(pending)].filter((id) => !nodesByHash[id])
    pending = []
    if (batch.length === 0) continue
    const loaded = await loadDirectNodes(readText, batch, readManyText, loadNodeFiles)
    for (const saved of Object.values(loaded)) {
      nodesByHash[saved.hash] = saved
      pending.push(...getDagNodeRecordInputHashes(saved.node))
    }
  }
  return nodesByHash
}

const loadDirectNodes = async (
  readText: DesignRepositoryTextReader,
  hashes: readonly Hash[],
  readManyText?: DesignRepositoryBulkTextReader,
  loadNodeFiles: DesignRepositoryNodeFileLoader = loadStoredGraphNodeFiles,
): Promise<Record<Hash, SavedStoredGraphNode>> => {
  const ids = [...new Set(hashes)]
  const paths = ids.map((id) => `nodes/${hashFilePart(id)}.ts`)
  const sources = await readRequiredTexts(readText, paths, readManyText)
  const loaded = await loadNodeFiles(paths.map((path) => ({ path, source: sources.get(path)! })))
  const nodes = ids.map((expectedHash, index) => {
    const path = paths[index]!
    const saved = loaded[expectedHash]
    if (!saved) {
      throw new Error(`Design repository node loader omitted ${path}`)
    }
    if (saved.hash !== expectedHash) {
      throw new Error(`Design repository node ${path} resolved to unexpected hash ${saved.hash}`)
    }
    return saved
  })
  return Object.fromEntries(nodes.map((saved) => [saved.hash, saved])) as Record<
    Hash,
    SavedStoredGraphNode
  >
}

const loadModuleClosure = async (
  readText: DesignRepositoryTextReader,
  nodes: Record<Hash, SavedStoredGraphNode>,
  readManyText?: DesignRepositoryBulkTextReader,
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
  const lockPaths = lockIds.map((id) => `module-locks/${hashFilePart(id)}.json`)
  const lockSources = await readRequiredTexts(readText, lockPaths, readManyText)
  for (const [index, lockId] of lockIds.entries()) {
    const path = lockPaths[index]!
    const lock = parseDagModuleLock(parseJson(lockSources.get(path)!, path))
    if (lock.id !== lockId) throw new Error(`Module lock ${lockId} has unexpected identity.`)
    moduleLocksByHash[lock.id] = lock
  }
  const moduleIds = [
    ...new Set(Object.values(moduleLocksByHash).flatMap(getDagModuleLockModuleIds)),
  ]
  const modulePaths = moduleIds.map((id) => `modules/${hashFilePart(id)}.json`)
  const moduleSources = await readRequiredTexts(readText, modulePaths, readManyText)
  for (const [index, moduleId] of moduleIds.entries()) {
    const path = modulePaths[index]!
    const artifact = parseDagModuleArtifact(parseJson(moduleSources.get(path)!, path))
    if (artifact.id !== moduleId) throw new Error(`Module ${moduleId} has unexpected identity.`)
    modulesByHash[artifact.id] = artifact
  }
  return { moduleLocksByHash, modulesByHash }
}

const loadNodeSnapshot = async (args: {
  readText: DesignRepositoryTextReader
  rootHashes: readonly Hash[]
  readManyText?: DesignRepositoryBulkTextReader
  loadNodeFiles?: DesignRepositoryNodeFileLoader
}): Promise<LoadedDesignRepositoryNodeSnapshot> => {
  const nodesByHash = await loadNodeClosure(
    args.readText,
    args.rootHashes,
    args.readManyText,
    args.loadNodeFiles,
  )
  const modules = await loadModuleClosure(args.readText, nodesByHash, args.readManyText)
  return {
    nodesByHash,
    ...modules,
    files: Object.values(nodesByHash)
      .map((node) => node.file)
      .sort((left, right) => left.path.localeCompare(right.path)),
  }
}

export const loadDesignRepositoryNodeClosure = async (args: {
  readText: DesignRepositoryTextReader
  rootNodeId: Hash
  readManyText?: DesignRepositoryBulkTextReader
  loadNodeFiles?: DesignRepositoryNodeFileLoader
}): Promise<LoadedDesignRepositoryNodeSnapshot> =>
  await loadNodeSnapshot({
    readText: args.readText,
    rootHashes: [args.rootNodeId],
    ...(args.readManyText ? { readManyText: args.readManyText } : {}),
    ...(args.loadNodeFiles ? { loadNodeFiles: args.loadNodeFiles } : {}),
  })

export type DagResolvedPackage = {
  name: string
  version: string
  integrity: string
}

export type DagCompiledNodeArtifact = {
  schemaVersion: 1
  cacheId: string
  compilerAbi: string
  nodeId: Hash
  moduleLockId?: Hash
  sourceBytes: number
  outputBytes: number
  packages: readonly DagResolvedPackage[]
  code: string
}

export type DagRunCodeCompilerInput = {
  nodeId: Hash
  importsSource?: string
  preambleSource?: string
  runSource: string
  lock?: DagModuleLock
  modules: Record<Hash, DagModuleArtifact>
}

export type DagRunCodeArtifactCompiler = {
  compilerAbi: string
  resolvePackages: (lock: DagModuleLock | undefined) => Promise<readonly DagResolvedPackage[]>
  compile: (
    input: DagRunCodeCompilerInput,
    packages: readonly DagResolvedPackage[],
  ) => Promise<Omit<DagCompiledNodeArtifact, 'cacheId'>>
}

export type DagRunCodeCompiler = {
  get: (input: DagRunCodeCompilerInput) => Promise<DagCompiledNodeArtifact | null>
  compile: (input: DagRunCodeCompilerInput) => Promise<DagCompiledNodeArtifact>
}

export type DagRunCodeCache = {
  get: (id: string) => Promise<unknown>
  set: (id: string, value: unknown) => Promise<void>
}

export type DagRunCodeCacheEvent = {
  status: 'hit' | 'miss' | 'compile-start' | 'compile-error'
  cacheId: string
  nodeId: Hash
  durationMs: number
  outputBytes?: number
  message?: string
}

export const createCachedDagRunCodeCompiler = (
  cache: DagRunCodeCache,
  compiler: DagRunCodeArtifactCompiler,
  onCache?: (event: DagRunCodeCacheEvent) => void,
): DagRunCodeCompiler => {
  const pending = new Map<string, Promise<DagCompiledNodeArtifact>>()
  const resolveRequest = async (input: DagRunCodeCompilerInput) => {
    const packages = [...(await compiler.resolvePackages(input.lock))].sort((left, right) =>
      left.name.localeCompare(right.name),
    )
    const cacheId = canonicalHash({
      kind: 'taskyon.dagRunCode.v2',
      compilerAbi: compiler.compilerAbi,
      nodeId: input.nodeId,
      moduleLockId: input.lock?.id ?? null,
      packages,
    })
    return { cacheId, packages }
  }
  const read = async (
    input: DagRunCodeCompilerInput,
    cacheId: string,
    packages: readonly DagResolvedPackage[],
  ) => {
    const startedAt = performance.now()
    const cached = await cache.get(cacheId)
    if (!cached || typeof cached !== 'object') return null
    const code = Reflect.get(cached, 'code')
    if (
      Reflect.get(cached, 'schemaVersion') !== 1 ||
      Reflect.get(cached, 'cacheId') !== cacheId ||
      Reflect.get(cached, 'compilerAbi') !== compiler.compilerAbi ||
      Reflect.get(cached, 'nodeId') !== input.nodeId ||
      Reflect.get(cached, 'moduleLockId') !== input.lock?.id ||
      typeof code !== 'string'
    ) {
      return null
    }
    const artifact = cached as DagCompiledNodeArtifact
    if (JSON.stringify(artifact.packages) !== JSON.stringify(packages)) return null
    onCache?.({
      status: 'hit',
      cacheId,
      nodeId: input.nodeId,
      durationMs: performance.now() - startedAt,
      outputBytes: artifact.outputBytes,
    })
    return artifact
  }
  const get = async (input: DagRunCodeCompilerInput) => {
    const { cacheId, packages } = await resolveRequest(input)
    return await read(input, cacheId, packages)
  }
  const compile = async (input: DagRunCodeCompilerInput) => {
    const { cacheId, packages } = await resolveRequest(input)
    const existing = pending.get(cacheId)
    if (existing) return await existing
    const requested = (async () => {
      const cached = await read(input, cacheId, packages)
      if (cached) return cached
      const startedAt = performance.now()
      onCache?.({
        status: 'compile-start',
        cacheId,
        nodeId: input.nodeId,
        durationMs: 0,
      })
      let output: Omit<DagCompiledNodeArtifact, 'cacheId'>
      try {
        output = await compiler.compile(input, packages)
      } catch (error) {
        onCache?.({
          status: 'compile-error',
          cacheId,
          nodeId: input.nodeId,
          durationMs: performance.now() - startedAt,
          message: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
      const artifact: DagCompiledNodeArtifact = { ...output, cacheId }
      await cache.set(cacheId, artifact)
      onCache?.({
        status: 'miss',
        cacheId,
        nodeId: input.nodeId,
        durationMs: performance.now() - startedAt,
        outputBytes: artifact.outputBytes,
      })
      return artifact
    })()
    pending.set(cacheId, requested)
    try {
      return await requested
    } finally {
      pending.delete(cacheId)
    }
  }
  return { get, compile }
}

export const compileDesignRepositoryNodes = async (
  snapshot: Pick<
    LoadedDesignRepositorySnapshot,
    'nodesByHash' | 'moduleLocksByHash' | 'modulesByHash'
  >,
  compileRunCode?: DagRunCodeCompiler,
): Promise<Record<Hash, SavedStoredGraphNode>> => {
  const compile =
    compileRunCode ?? createUncachedDagRunCodeCompiler(createLockedDagNodeRunCodeCompiler())
  return Object.fromEntries(
    await Promise.all(
      Object.entries(snapshot.nodesByHash).map(async ([id, saved]) => {
        if (saved.node.structure) return [id, saved]
        const lock = saved.node.moduleLockId
          ? snapshot.moduleLocksByHash[saved.node.moduleLockId]
          : undefined
        if (saved.node.moduleLockId && !lock) {
          throw new Error(`DAG node ${id} references unavailable module lock.`)
        }
        const artifact = await compile.compile({
          nodeId: id as Hash,
          ...(saved.node.importsSource ? { importsSource: saved.node.importsSource } : {}),
          ...(saved.node.preambleSource ? { preambleSource: saved.node.preambleSource } : {}),
          runSource: saved.node.runSource,
          ...(lock ? { lock } : {}),
          modules: snapshot.modulesByHash,
        })
        return [
          id,
          {
            ...saved,
            node: {
              ...saved.node,
              runCode: artifact.code,
            },
          },
        ]
      }),
    ),
  ) as Record<Hash, SavedStoredGraphNode>
}

export const loadDesignRepositorySnapshot = async (args: {
  readText: DesignRepositoryTextReader
  readManyText?: DesignRepositoryBulkTextReader
  loadNodeFiles?: DesignRepositoryNodeFileLoader
  checkout: DesignRepositoryCheckout
}): Promise<LoadedDesignRepositorySnapshot> => {
  const revisionId = await resolveRevisionId(args.readText, args.checkout)
  const revision = parseGraphRevision(
    await readJson(args.readText, `graph-revisions/${hashFilePart(revisionId)}.json`),
  )
  const nodeSnapshot = await loadNodeSnapshot({
    readText: args.readText,
    rootHashes: Object.values(revision.nodes),
    ...(args.readManyText ? { readManyText: args.readManyText } : {}),
    ...(args.loadNodeFiles ? { loadNodeFiles: args.loadNodeFiles } : {}),
  })
  return {
    revision,
    ...nodeSnapshot,
  }
}

const loadProjectDefinitionSnapshot = async (
  readText: DesignRepositoryTextReader,
  definition: Awaited<ReturnType<typeof loadProjectRevisionDefinition>>,
  readManyText?: DesignRepositoryBulkTextReader,
  loadNodeFiles?: DesignRepositoryNodeFileLoader,
): Promise<LoadedProjectRepositorySnapshot> => {
  const nodesByHash = await loadNodeClosure(
    readText,
    Object.values(definition.invocations).map((invocation) => invocation.rootNodeId),
    readManyText,
    loadNodeFiles,
  )
  const modules = await loadModuleClosure(readText, nodesByHash, readManyText)
  return {
    ...definition,
    nodesByHash,
    ...modules,
    files: Object.values(nodesByHash)
      .map((node) => node.file)
      .sort((left, right) => left.path.localeCompare(right.path)),
  }
}

export const loadProjectRepositorySnapshot = async (args: {
  readText: DesignRepositoryTextReader
  readManyText?: DesignRepositoryBulkTextReader
  loadNodeFiles?: DesignRepositoryNodeFileLoader
  checkout: ProjectRepositoryCheckout
}): Promise<LoadedProjectRepositorySnapshot> => {
  const definition = await loadProjectDefinition(args.readText, args.checkout)
  return await loadProjectDefinitionSnapshot(
    args.readText,
    definition,
    args.readManyText,
    args.loadNodeFiles,
  )
}

export const loadProjectRevisionSnapshot = async (args: {
  readText: DesignRepositoryTextReader
  readManyText?: DesignRepositoryBulkTextReader
  loadNodeFiles?: DesignRepositoryNodeFileLoader
  revision: ProjectRevision
}): Promise<LoadedProjectRepositorySnapshot> => {
  const definition = await loadProjectRevisionDefinition(args.readText, args.revision)
  return await loadProjectDefinitionSnapshot(
    args.readText,
    definition,
    args.readManyText,
    args.loadNodeFiles,
  )
}

const loadProjectDefinitionPresentation = async (
  readText: DesignRepositoryTextReader,
  definition: Awaited<ReturnType<typeof loadProjectRevisionDefinition>>,
  readManyText?: DesignRepositoryBulkTextReader,
  loadNodeFiles?: DesignRepositoryNodeFileLoader,
): Promise<LoadedProjectRepositoryPresentation> => {
  const nodesByHash = await loadDirectNodes(
    readText,
    Object.values(definition.invocations).map(({ rootNodeId }) => rootNodeId),
    readManyText,
    loadNodeFiles,
  )
  return { ...definition, nodesByHash }
}

export const loadProjectRepositoryPresentation = async (args: {
  readText: DesignRepositoryTextReader
  readManyText?: DesignRepositoryBulkTextReader
  loadNodeFiles?: DesignRepositoryNodeFileLoader
  checkout: ProjectRepositoryCheckout
}): Promise<LoadedProjectRepositoryPresentation> => {
  const definition = await loadProjectDefinition(args.readText, args.checkout)
  return await loadProjectDefinitionPresentation(
    args.readText,
    definition,
    args.readManyText,
    args.loadNodeFiles,
  )
}

export const loadProjectRevisionPresentation = async (args: {
  readText: DesignRepositoryTextReader
  readManyText?: DesignRepositoryBulkTextReader
  loadNodeFiles?: DesignRepositoryNodeFileLoader
  revision: ProjectRevision
}): Promise<LoadedProjectRepositoryPresentation> => {
  const definition = await loadProjectRevisionDefinition(args.readText, args.revision)
  return await loadProjectDefinitionPresentation(
    args.readText,
    definition,
    args.readManyText,
    args.loadNodeFiles,
  )
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
