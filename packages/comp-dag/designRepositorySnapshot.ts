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
  loadStoredGraphNodeFile,
  type SavedStoredGraphNode,
  type StoredGraphNodeFile,
} from './dagNodeLoader.ts'

export type DesignRepositoryTextReader = (path: string) => Promise<string>

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
  checkout: DesignRepositoryCheckout
}): Promise<LoadedDesignRepositorySnapshot> => {
  const revisionId = await resolveRevisionId(args.readText, args.checkout)
  const revision = parseGraphRevision(
    await readJson(args.readText, `graph-revisions/${hashFilePart(revisionId)}.json`),
  )
  const nodesByHash = await loadNodeClosure(args.readText, Object.values(revision.nodes))
  const modules = await loadModuleClosure(args.readText, nodesByHash)
  return {
    revision,
    nodesByHash,
    ...modules,
    files: Object.values(nodesByHash)
      .map((node) => node.file)
      .sort((left, right) => left.path.localeCompare(right.path)),
  }
}

export const loadProjectRepositorySnapshot = async (args: {
  readText: DesignRepositoryTextReader
  checkout: ProjectRepositoryCheckout
}): Promise<LoadedProjectRepositorySnapshot> => {
  const revisionId =
    args.checkout.kind === 'projectRevision'
      ? args.checkout.id
      : parseDesignGraphRef(
          await readJson(
            args.readText,
            `refs/${safeRefName(
              args.checkout.name.startsWith('projects/')
                ? args.checkout.name
                : `projects/${args.checkout.name}`,
            )}.json`,
          ),
        ).revisionId
  const revision = parseProjectRevision(
    await readJson(args.readText, `project-revisions/${hashFilePart(revisionId)}.json`),
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
  return {
    revision,
    invocations,
    extensions,
    nodesByHash,
    ...modules,
    files: Object.values(nodesByHash)
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
