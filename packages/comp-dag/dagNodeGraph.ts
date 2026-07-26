import type { Hash } from './caching.ts'
import type { DagNode } from './dagCore.ts'
import {
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
