import type { Hash } from './caching.ts'
import {
  getDagNodeRecordClosure,
  savedStoredNodesToRecordGraph,
  type DagNodeRecordGraph,
} from './dagNodeRecordGraph.ts'
import { getDagNodeRecordInputHashes } from './dagNodeRecord.ts'
import {
  loadStoredGraphNodeFiles,
  saveStoredGraphNodeSource,
  type SavedStoredGraphNode,
  type StoredGraphNodeFile,
} from './dagNodeLoader.ts'

export type DagGraphRoots = Record<string, Hash>

export type StoredDagSourceGraph = {
  files: readonly StoredGraphNodeFile[]
  nodesByHash: Record<Hash, SavedStoredGraphNode>
  graph: DagNodeRecordGraph
  roots: DagGraphRoots
}

export type StoredDagSourceGraphChangedNode = {
  localName: string
  oldHash: Hash
  newHash: Hash
}

export type StoredDagSourceGraphPatch = {
  targetLocalName: string
  resolvedOldHash: Hash
  previousRoots: DagGraphRoots
  nextRoots: DagGraphRoots
  changedNodes: Record<string, StoredDagSourceGraphChangedNode>
}

const replaceHashRefs = (source: string, replacements: Record<Hash, Hash>): string => {
  let out = source
  for (const [from, to] of Object.entries(replacements) as [Hash, Hash][]) {
    out = out.replaceAll(from, to)
  }
  return out
}

const directoryOfStoredNodePath = (filePath: string): string => {
  const index = filePath.lastIndexOf('/')
  return index >= 0 ? filePath.slice(0, index) : ''
}

const createLocalNameIndex = (graph: DagNodeRecordGraph, rootHash: Hash): Record<string, Hash> => {
  const index: Record<string, Hash> = {}
  for (const hash of getDagNodeRecordClosure(graph, rootHash)) {
    const record = graph[hash]
    if (!record) throw new Error(`Missing graph node ${hash}`)
    if (index[record.localName]) {
      throw new Error(`Duplicate local graph node name in selected subgraph: ${record.localName}`)
    }
    index[record.localName] = hash
  }
  return index
}

export const createStoredDagSourceGraph = async (args: {
  files: readonly StoredGraphNodeFile[]
  roots: DagGraphRoots
}): Promise<StoredDagSourceGraph> => {
  const nodesByHash = await loadStoredGraphNodeFiles(args.files)
  const graph = savedStoredNodesToRecordGraph(nodesByHash)
  for (const [rootName, rootHash] of Object.entries(args.roots)) {
    if (!graph[rootHash])
      throw new Error(`Graph root ${rootName} points to missing node ${rootHash}`)
  }
  return {
    files: args.files,
    nodesByHash,
    graph,
    roots: args.roots,
  }
}

export const getStoredDagSourceGraphLocalNameIndex = (args: {
  storedGraph: StoredDagSourceGraph
  rootName: string
}): Record<string, Hash> => {
  const rootHash = args.storedGraph.roots[args.rootName]
  if (!rootHash) throw new Error(`Graph root not found: ${args.rootName}`)
  return createLocalNameIndex(args.storedGraph.graph, rootHash)
}

export const patchStoredDagSourceGraphNode = async (args: {
  storedGraph: StoredDagSourceGraph
  rootName: string
  targetLocalName: string
  updateSource: (source: string) => string
}): Promise<{ storedGraph: StoredDagSourceGraph; patch: StoredDagSourceGraphPatch }> => {
  const rootHash = args.storedGraph.roots[args.rootName]
  if (!rootHash) throw new Error(`Graph root not found: ${args.rootName}`)

  const localNameIndex = createLocalNameIndex(args.storedGraph.graph, rootHash)
  const targetHash = localNameIndex[args.targetLocalName]
  if (!targetHash) throw new Error(`Local graph node not found: ${args.targetLocalName}`)

  const replacements: Record<Hash, Hash> = {}
  const changedNodes: Record<string, StoredDagSourceGraphChangedNode> = {}
  const newFiles: StoredGraphNodeFile[] = []

  for (const hash of getDagNodeRecordClosure(args.storedGraph.graph, rootHash)) {
    const saved = args.storedGraph.nodesByHash[hash]
    if (!saved) throw new Error(`Stored graph node not found: ${hash}`)

    const source =
      hash === targetHash
        ? args.updateSource(saved.file.source)
        : getDagNodeRecordInputHashes(saved.node).some((inputHash) => replacements[inputHash])
          ? replaceHashRefs(saved.file.source, replacements)
          : null
    if (source === null) continue

    const next = await saveStoredGraphNodeSource(source, {
      directory: directoryOfStoredNodePath(saved.file.path),
    })
    replacements[hash] = next.hash
    changedNodes[saved.node.localName] = {
      localName: saved.node.localName,
      oldHash: hash,
      newHash: next.hash,
    }
    newFiles.push(next.file)
  }

  if (!replacements[targetHash]) {
    throw new Error(`Patch did not change target graph node ${args.targetLocalName}`)
  }

  const previousRoots = args.storedGraph.roots
  const nextRoots = {
    ...previousRoots,
    [args.rootName]: replacements[rootHash] ?? rootHash,
  }
  const storedGraph = await createStoredDagSourceGraph({
    files: [...args.storedGraph.files, ...newFiles],
    roots: nextRoots,
  })

  return {
    storedGraph,
    patch: {
      targetLocalName: args.targetLocalName,
      resolvedOldHash: targetHash,
      previousRoots,
      nextRoots,
      changedNodes,
    },
  }
}
