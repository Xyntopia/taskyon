import type { Hash } from './caching.ts'
import type { DagNode } from './dagCore.ts'
import {
  defineDagNodeRecord,
  getDagNodeRecordInputHashes,
  recordInputsToRuntimeInputs,
  type DagNodeRecord,
} from './dagNodeRecord.ts'
import { compileDagNodeRecord } from './dagNodeRecordCompiler.ts'
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
}): CompiledDagNodeGraph => {
  const compiled: CompiledDagNodeGraph = {}
  const hashes = args.rootHash
    ? getDagNodeRecordClosure(args.graph, args.rootHash)
    : Object.keys(args.graph)

  for (const hash of hashes as Hash[]) {
    compiled[hash] = compileDagNodeRecord({
      record: args.graph[hash]!,
      nodeById: compiled,
    })
  }

  return compiled
}
