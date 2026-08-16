import type { Hash } from './caching.ts'
import type { DagNode } from './dagCore.ts'
import {
  createDagModuleArtifact,
  createDagModuleLock,
  type DagModuleArtifact,
  type DagModuleLock,
  type StoredDagPackageName,
} from './dagModule.ts'
import {
  defineDagNodeRecord,
  getDagNodeRecordInputHashes,
  recordInputsToRuntimeInputs,
  type DagNodeRecord,
} from './dagNodeRecord.ts'
import { compileDagNodeRecord } from './dagNodeRecordCompiler.ts'
import type { FetchCapability } from '@taskyon/common/modules/webFetching/mediatedFetch'
import { objectSchema, oneOfSchema, type DagJsonSchema } from './dagSchema.ts'
import {
  loadStoredGraphNodeFiles,
  type SavedStoredGraphNode,
  type StoredGraphNodeFile,
} from './dagNodeLoader.ts'

export type DagNodeRecordGraph = Record<Hash, DagNodeRecord>
export type CompiledDagNodeGraph = Record<Hash, DagNode>

export const savedStoredNodesToRecordGraph = (
  nodesByHash: Record<Hash, SavedStoredGraphNode>,
): DagNodeRecordGraph => {
  const graph: DagNodeRecordGraph = {}
  for (const [hash, saved] of Object.entries(nodesByHash) as [Hash, SavedStoredGraphNode][]) {
    graph[hash] = saved.node
  }
  return graph
}

export const loadDagNodeRecordGraph = async (
  files: readonly StoredGraphNodeFile[],
): Promise<DagNodeRecordGraph> =>
  savedStoredNodesToRecordGraph(await loadStoredGraphNodeFiles(files))

export const canReadStoredGraphNodeDirectory = (): boolean =>
  typeof process !== 'undefined' && Boolean(process.versions?.node)

export const readStoredGraphNodeDirectory = async (
  dirUrl: URL,
  opts?: { pathPrefix?: string },
): Promise<StoredGraphNodeFile[]> => {
  if (!canReadStoredGraphNodeDirectory()) {
    throw new Error('Stored graph node directory loading requires Node.')
  }

  const [{ readFile, readdir }, { fileURLToPath }, path] = await Promise.all([
    import('node:fs/promises'),
    import('node:url'),
    import('node:path'),
  ])
  const pathPrefix = opts?.pathPrefix ?? 'nodes'

  const readDir = async (absDir: string, relDir: string): Promise<StoredGraphNodeFile[]> => {
    const entries = await readdir(absDir, { withFileTypes: true })
    const files = await Promise.all(
      entries
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (entry) => {
          const absPath = path.join(absDir, entry.name)
          const relPath = relDir ? `${relDir}/${entry.name}` : entry.name
          if (entry.isDirectory()) return await readDir(absPath, relPath)
          if (!entry.isFile() || !entry.name.endsWith('.ts')) return []
          return [
            {
              path: `${pathPrefix}/${relPath}`,
              source: await readFile(absPath, 'utf8'),
            },
          ]
        }),
    )
    return files.flat()
  }

  return await readDir(fileURLToPath(dirUrl), '')
}

export const getDagNodeRecordClosure = (graph: DagNodeRecordGraph, rootHash: Hash): Hash[] => {
  const visited = new Set<Hash>()
  const out: Hash[] = []

  const visit = (hash: Hash) => {
    if (visited.has(hash)) return
    visited.add(hash)
    const record = graph[hash]
    if (!record) throw new Error(`Missing DAG node record ${hash}`)
    for (const inputHash of getDagNodeRecordInputHashes(record)) visit(inputHash)
    out.push(hash)
  }

  visit(rootHash)
  return out
}

export const getDagNodeRecordRelations = (
  graph: DagNodeRecordGraph,
  nodeHash: Hash,
): { upstream: Hash[]; downstream: Hash[] } => {
  const node = graph[nodeHash]
  if (!node) throw new Error(`Missing DAG node record ${nodeHash}`)
  const upstream = [...new Set(getDagNodeRecordInputHashes(node))]
  const downstream = (Object.entries(graph) as [Hash, DagNodeRecord][])
    .filter(([, candidate]) => getDagNodeRecordInputHashes(candidate).includes(nodeHash))
    .map(([hash]) => hash)
  return { upstream, downstream }
}

export const planDagNodeRecordDeletion = (
  definitions: readonly DagNodeRecord[],
  deletingHashes: ReadonlySet<Hash>,
) => {
  const deleting = definitions.filter(({ id }) => deletingHashes.has(id))
  const remaining = definitions.filter(({ id }) => !deletingHashes.has(id))
  const blockers = remaining.filter((definition) =>
    getDagNodeRecordInputHashes(definition).some((hash) => deletingHashes.has(hash)),
  )
  return { deleting, remaining, blockers }
}

export const replaceDagNodeRecordInputHashes = (
  definition: DagNodeRecord,
  replacements: ReadonlyMap<Hash, Hash>,
): Pick<DagNodeRecord, 'inputs' | 'hiddenInputs' | 'exposedInputs'> | null => {
  if (!getDagNodeRecordInputHashes(definition).some((hash) => replacements.has(hash))) return null
  const replaceHash = (hash: Hash) => replacements.get(hash) ?? hash
  return {
    ...(definition.inputs
      ? {
          inputs: Object.fromEntries(
            Object.entries(definition.inputs).map(([alias, ref]) => [
              alias,
              'kind' in ref
                ? { ...ref, nodeIds: ref.nodeIds.map(replaceHash) }
                : { ...ref, nodeId: replaceHash(ref.nodeId) },
            ]),
          ),
        }
      : {}),
    ...(definition.hiddenInputs
      ? {
          hiddenInputs: Object.fromEntries(
            Object.entries(definition.hiddenInputs).map(([alias, ref]) => [
              alias,
              { nodeId: replaceHash(ref.nodeId) },
            ]),
          ),
        }
      : {}),
    ...(definition.exposedInputs
      ? {
          exposedInputs: Object.fromEntries(
            Object.entries(definition.exposedInputs).map(([alias, ref]) => [
              alias,
              'kind' in ref
                ? { kind: 'oneOf' as const, nodeIds: ref.nodeIds.map(replaceHash) }
                : { nodeId: replaceHash(ref.nodeId) },
            ]),
          ),
        }
      : {}),
  }
}

export const rewriteDagNodeRecordGraphInputHashes = async (
  definitions: readonly DagNodeRecord[],
  replacements: ReadonlyMap<Hash, Hash>,
  redefine: (definition: DagNodeRecord) => Promise<DagNodeRecord> = defineDagNodeRecord,
): Promise<DagNodeRecord[]> => {
  let definitionsByName = Object.fromEntries(
    definitions.map((definition) => [definition.localName, definition]),
  )
  let pendingReplacements = new Map(replacements)
  const rewrittenHashes = new Set<Hash>()

  while (pendingReplacements.size > 0) {
    for (const hash of pendingReplacements.keys()) {
      if (rewrittenHashes.has(hash)) throw new Error('DAG node rewrite would create a cycle.')
      rewrittenHashes.add(hash)
    }
    const nextReplacements = new Map<Hash, Hash>()
    const nextDefinitions = { ...definitionsByName }
    for (const [localName, definition] of Object.entries(definitionsByName)) {
      const inputs = replaceDagNodeRecordInputHashes(definition, pendingReplacements)
      if (!inputs) continue
      const updated = await redefine({ ...definition, ...inputs })
      nextDefinitions[localName] = updated
      nextReplacements.set(definition.id, updated.id)
    }
    definitionsByName = nextDefinitions
    pendingReplacements = nextReplacements
  }

  return Object.values(definitionsByName)
}

export const replaceDagNodeRecordModuleSource = async (args: {
  definitions: readonly DagNodeRecord[]
  locks: Readonly<Record<Hash, DagModuleLock>>
  modules: Readonly<Record<Hash, DagModuleArtifact>>
  moduleId: Hash
  source: string
  redefine?: (definition: DagNodeRecord) => Promise<DagNodeRecord>
}) => {
  const previousModule = args.modules[args.moduleId]
  if (!previousModule) throw new Error(`Stored DAG module ${args.moduleId} is unavailable.`)
  const module = createDagModuleArtifact({
    mediaType: previousModule.mediaType,
    source: args.source,
  })
  const lockReplacements = new Map<Hash, DagModuleLock>()
  for (const lock of Object.values(args.locks)) {
    const affectsLock = Object.entries(lock.imports).some(
      ([referrer, imports]) =>
        referrer === args.moduleId ||
        Object.values(imports).some(
          (target) => target.kind === 'module' && target.id === args.moduleId,
        ),
    )
    if (!affectsLock) continue
    const imports = Object.fromEntries(
      Object.entries(lock.imports).map(([referrer, mappings]) => [
        referrer === args.moduleId ? module.id : referrer,
        Object.fromEntries(
          Object.entries(mappings).map(([specifier, target]) => [
            specifier,
            target.kind === 'module' && target.id === args.moduleId
              ? { kind: 'module' as const, id: module.id }
              : target,
          ]),
        ),
      ]),
    )
    lockReplacements.set(lock.id, createDagModuleLock({ imports, packages: lock.packages }))
  }
  if (lockReplacements.size === 0) {
    throw new Error(`Stored DAG module ${args.moduleId} is not referenced by the active graph.`)
  }

  const redefine = args.redefine ?? defineDagNodeRecord
  const directUpdates = await Promise.all(
    args.definitions.map(async (definition) => {
      const lock = definition.moduleLockId
        ? lockReplacements.get(definition.moduleLockId)
        : undefined
      if (!lock) return { definition }
      const updated = await redefine({
        ...definition,
        version: definition.version + 1,
        moduleLockId: lock.id,
      })
      return { definition: updated, replacement: [definition.id, updated.id] as const }
    }),
  )
  const directReplacements = new Map(
    directUpdates.flatMap(({ replacement }) => (replacement ? [replacement] : [])),
  )
  const definitions = await rewriteDagNodeRecordGraphInputHashes(
    directUpdates.map(({ definition }) => definition),
    directReplacements,
    redefine,
  )
  return {
    module,
    locks: [...lockReplacements.values()],
    definitions,
    affectedNodeCount: directReplacements.size,
  }
}

export const replaceDagNodeRecordPackageRange = async (args: {
  definitions: readonly DagNodeRecord[]
  locks: Readonly<Record<Hash, DagModuleLock>>
  packageName: StoredDagPackageName
  range: string
  redefine?: (definition: DagNodeRecord) => Promise<DagNodeRecord>
}) => {
  const lockReplacements = new Map<Hash, DagModuleLock>()
  for (const lock of Object.values(args.locks)) {
    if (!lock.packages[args.packageName]) continue
    lockReplacements.set(
      lock.id,
      createDagModuleLock({
        imports: lock.imports,
        packages: {
          ...lock.packages,
          [args.packageName]: { range: args.range },
        },
      }),
    )
  }
  if (lockReplacements.size === 0) {
    throw new Error(`Package ${args.packageName} is not required by the active graph.`)
  }

  const redefine = args.redefine ?? defineDagNodeRecord
  const directUpdates = await Promise.all(
    args.definitions.map(async (definition) => {
      const lock = definition.moduleLockId
        ? lockReplacements.get(definition.moduleLockId)
        : undefined
      if (!lock) return { definition }
      const updated = await redefine({
        ...definition,
        version: definition.version + 1,
        moduleLockId: lock.id,
      })
      return { definition: updated, replacement: [definition.id, updated.id] as const }
    }),
  )
  const replacements = new Map(
    directUpdates.flatMap(({ replacement }) => (replacement ? [replacement] : [])),
  )
  return {
    locks: [...lockReplacements.values()],
    definitions: await rewriteDagNodeRecordGraphInputHashes(
      directUpdates.map(({ definition }) => definition),
      replacements,
      redefine,
    ),
    affectedNodeCount: replacements.size,
  }
}

export const mergeDagNodeRecordDefaults = async (args: {
  local: readonly DagNodeRecord[]
  defaults: readonly DagNodeRecord[]
}) => {
  const localByName = Object.fromEntries(args.local.map((node) => [node.localName, node]))
  const defaultsByName = Object.fromEntries(args.defaults.map((node) => [node.localName, node]))
  const replacements = new Map<Hash, Hash>(
    args.defaults.flatMap((node) => {
      const previous = localByName[node.localName]
      return previous && previous.id !== node.id ? [[previous.id, node.id]] : []
    }),
  )
  const definitions = await rewriteDagNodeRecordGraphInputHashes(
    Object.values({ ...localByName, ...defaultsByName }),
    replacements,
  )

  const defaultNames = new Set(Object.keys(defaultsByName))
  return {
    definitions: definitions.toSorted((left, right) =>
      left.localName.localeCompare(right.localName),
    ),
    addedDefaultCount: args.defaults.filter((node) => !localByName[node.localName]).length,
    updatedDefaultCount: args.defaults.filter(
      (node) =>
        localByName[node.localName]?.id !== undefined &&
        localByName[node.localName]?.id !== node.id,
    ).length,
    preservedCustomCount: args.local.filter((node) => !defaultNames.has(node.localName)).length,
  }
}

export const getDagNodeRecordInputSchema = (
  graph: DagNodeRecordGraph,
  nodeHash: Hash,
): DagJsonSchema => {
  const node = graph[nodeHash]
  if (!node) throw new Error(`Missing DAG node record ${nodeHash}`)
  const properties: Record<string, DagJsonSchema> = {
    params: node.localParamsSchema,
  }
  const runtimeInputs = recordInputsToRuntimeInputs(node)
  const inputs = { ...runtimeInputs.hiddenInputs, ...runtimeInputs.exposedInputs }
  for (const [alias, input] of Object.entries(inputs)) {
    const nodeIds = 'kind' in input ? input.nodeIds : [input.nodeId]
    properties[alias] = oneOfSchema(
      nodeIds.map((hash) => {
        const provider = graph[hash]
        if (!provider) throw new Error(`Missing DAG node record ${hash} for input "${alias}"`)
        return provider.outputSchema
      }),
    )
  }
  return objectSchema({
    properties,
    required: Object.keys(properties),
    title: `${node.label} inputs`,
  })
}

export const compileDagNodeRecordGraph = (args: {
  graph: DagNodeRecordGraph
  rootHash?: Hash
  authorizeFetch?: (record: DagNodeRecord, capability: FetchCapability) => Promise<boolean>
  fetch?: typeof fetch
  callCapability?: (id: string, input: unknown) => Promise<unknown>
  loadRunCode?: (record: DagNodeRecord) => Promise<string>
  onProgress?: (event: { record: DagNodeRecord; completed: number; total: number }) => void
}): CompiledDagNodeGraph => {
  const compiled: CompiledDagNodeGraph = {}
  const hashes = args.rootHash
    ? getDagNodeRecordClosure(args.graph, args.rootHash)
    : [
        ...new Set(
          (Object.keys(args.graph) as Hash[])
            .sort()
            .flatMap((hash) => getDagNodeRecordClosure(args.graph, hash)),
        ),
      ]

  for (const [index, hash] of (hashes as Hash[]).entries()) {
    const record = args.graph[hash]!
    compiled[hash] = compileDagNodeRecord({
      record,
      nodeById: compiled,
      ...(args.authorizeFetch
        ? { authorizeFetch: async (capability) => await args.authorizeFetch!(record, capability) }
        : {}),
      ...(args.fetch ? { fetch: args.fetch } : {}),
      ...(args.callCapability ? { callCapability: args.callCapability } : {}),
      ...(args.loadRunCode ? { loadRunCode: args.loadRunCode } : {}),
    })
    args.onProgress?.({ record, completed: index + 1, total: hashes.length })
  }

  return compiled
}
