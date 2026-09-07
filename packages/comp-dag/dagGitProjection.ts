import { canonicalHash, canonicalJson } from '@taskyon/common/modules/canonicalHash'
import type { Hash } from './caching.ts'
import {
  getDagModuleLockModuleIds,
  parseDagModuleArtifact,
  parseDagModuleLock,
} from './dagModule.ts'
import {
  createGraphRevision,
  createInvocationDefinition,
  parseDesignGraphRef,
  parseGraphRevision,
  parseInvocationDefinition,
  parseProjectExtension,
  parseProjectRevision,
  createProjectRevision,
} from './designGraphModel.ts'
import type { DesignGraphObjectStore } from './designGraphRepository.ts'
import { getDagNodeRecordInputHashes, type DagNodeRecordInputRef } from './dagNodeRecord.ts'
import {
  loadStoredGraphNodeFile,
  loadStoredGraphNodeFiles,
  saveStoredGraphNodeSource,
  type SavedStoredGraphNode,
} from './dagNodeLoader.ts'
import { SELF_HASH_PLACEHOLDER } from './dagNodeIdentity.ts'
import {
  createStoredDagSourceGraph,
  getStoredDagSourceGraphLocalNameIndex,
  patchStoredDagSourceGraphNode,
} from './storedDagSourceGraph.ts'

export type DagProjectedFile = { path: string; content: string }

export type DesignGraphSnapshotSelector =
  | { kind: 'global' }
  | { kind: 'project'; projectRef: string }
  | { kind: 'graphRevision'; revisionId: Hash }
  | { kind: 'node'; nodeId: Hash }

export type DesignGraphGitSyncResult =
  | { status: 'unchanged' | 'pulled' | 'pushed'; oid: string }
  | { status: 'conflict'; local: string; remote: string }

export type DesignGraphGitSynchronizer = {
  writeProjection: (files: readonly DagProjectedFile[], branch?: string) => Promise<void>
  commit: (args: { message: string; author: { name: string; email: string } }) => Promise<string>
  synchronize: (branch?: string) => Promise<DesignGraphGitSyncResult>
  readProjection: () => Promise<DagProjectedFile[]>
}

export const DESIGN_GRAPH_GIT_DIRECTORIES = [
  'modules',
  'module-locks',
  'nodes',
  'graph-revisions',
  'project-revisions',
  'invocations',
  'extensions',
  'source-manifests',
  'refs',
] as const

const hashFilePart = (id: Hash) => id.replace(':', '_')
const objectPath = (kind: string, id: Hash) => `${kind}/${hashFilePart(id)}.json`

type ProjectedObjectKind =
  | 'modules'
  | 'module-locks'
  | 'nodes'
  | 'graph-revisions'
  | 'project-revisions'
  | 'invocations'
  | 'extensions'

type ProjectedObject = {
  file: DagProjectedFile
  kind: ProjectedObjectKind
  id: Hash
  candidates: string[]
}

type NamingMetadata = {
  localName?: string
  label?: string
  displayName?: string
  namespace?: string
}

const shortHash = (id: Hash) => hashFilePart(id).slice('sha256_'.length, 'sha256_'.length + 8)

const safeName = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'unnamed'
}

const suffixPath = (path: string, id: Hash): string => {
  const extension = path.endsWith('.ts') ? '.ts' : '.json'
  return `${path.slice(0, -extension.length)}--${shortHash(id)}${extension}`
}

const projectObjectPath = (kind: ProjectedObjectKind, name: string): string => {
  const extension = kind === 'nodes' ? '.ts' : '.json'
  return `${kind}/${name}${extension}`
}

type ProjectedNodeFileLoader = (file: {
  path: string
  source: string
}) => Promise<SavedStoredGraphNode>

const prepareProjectedNodeFile = async (file: {
  path: string
  source: string
}): Promise<SavedStoredGraphNode> => {
  const saved = await saveStoredGraphNodeSource(file.source)
  return {
    ...saved,
    file: { path: file.path, source: saved.file.source },
  }
}

const createProjectedNodeFileLoader = (
  preloadedNodes: readonly SavedStoredGraphNode[] = [],
): ProjectedNodeFileLoader => {
  const cache = new Map<string, Promise<Omit<SavedStoredGraphNode, 'file'> & { source: string }>>()
  for (const node of preloadedNodes) {
    const loaded = {
      hash: node.hash,
      node: node.node,
      source: node.normalizedSource.replace(SELF_HASH_PLACEHOLDER, node.hash),
      normalizedSource: node.normalizedSource,
    }
    cache.set(node.file.source, Promise.resolve(loaded))
    cache.set(loaded.source, Promise.resolve(loaded))
  }
  return async (file) => {
    let prepared = cache.get(file.source)
    if (!prepared) {
      prepared = prepareProjectedNodeFile(file).then(({ file: normalizedFile, ...saved }) => ({
        ...saved,
        source: normalizedFile.source,
      }))
      cache.set(file.source, prepared)
    }
    const loaded = await prepared
    if (!cache.has(loaded.source)) cache.set(loaded.source, Promise.resolve(loaded))
    return {
      hash: loaded.hash,
      node: loaded.node,
      file: { path: file.path, source: loaded.source },
      normalizedSource: loaded.normalizedSource,
    }
  }
}

const loadProjectedNodeFile: ProjectedNodeFileLoader = async (file) =>
  await prepareProjectedNodeFile(file)

const addCandidate = (map: Map<Hash, string[]>, id: Hash, candidate: string) => {
  const candidates = map.get(id) ?? []
  candidates.push(candidate)
  map.set(id, candidates)
}

const collectNamingHints = (files: readonly DagProjectedFile[]) => {
  const graphRevisions = new Map<Hash, string[]>()
  const projectRevisions = new Map<Hash, string[]>()
  const invocations = new Map<Hash, string[]>()
  const extensions = new Map<Hash, string[]>()
  const projectNames = new Map<Hash, string>()

  for (const file of files.filter(({ path }) => path.startsWith('refs/'))) {
    const ref = parseDesignGraphRef(JSON.parse(file.content) as unknown)
    if (file.path.startsWith('refs/graph/')) {
      addCandidate(graphRevisions, ref.revisionId, file.path.slice('refs/graph/'.length, -5))
    } else if (file.path.startsWith('refs/projects/')) {
      projectNames.set(ref.revisionId, file.path.slice('refs/projects/'.length, -5))
    }
  }

  for (const file of files.filter(({ path }) => path.startsWith('project-revisions/'))) {
    const revision = parseProjectRevision(JSON.parse(file.content) as unknown)
    const projectName = projectNames.get(revision.id) ?? revision.displayName
    addCandidate(projectRevisions, revision.id, projectName)
    for (const [name, id] of Object.entries(revision.invocations)) {
      addCandidate(invocations, id, `${projectName}/${name}`)
    }
    for (const [name, id] of Object.entries(revision.extensions)) {
      addCandidate(extensions, id, `${projectName}/${name}`)
    }
  }

  return { graphRevisions, projectRevisions, invocations, extensions }
}

const objectCandidates = (
  kind: ProjectedObjectKind,
  id: Hash,
  metadata: NamingMetadata,
  hints: ReturnType<typeof collectNamingHints>,
): string[] => {
  if (kind === 'nodes') {
    return [String(metadata.localName ?? metadata.label ?? `node-${shortHash(id)}`)]
  }
  if (kind === 'graph-revisions') return hints.graphRevisions.get(id) ?? []
  if (kind === 'project-revisions') {
    return hints.projectRevisions.get(id) ?? [String(metadata.displayName ?? '')]
  }
  if (kind === 'invocations') return hints.invocations.get(id) ?? []
  if (kind === 'extensions') {
    return hints.extensions.get(id) ?? [String(metadata.namespace ?? '')]
  }
  return []
}

const fallbackObjectName = (kind: ProjectedObjectKind, id: Hash) =>
  `${kind.slice(0, -1)}--${shortHash(id)}`

const jsonNamingMetadata = (kind: ProjectedObjectKind, value: unknown): NamingMetadata => {
  if (kind === 'project-revisions') {
    return { displayName: parseProjectRevision(value).displayName }
  }
  if (kind === 'extensions') return { namespace: parseProjectExtension(value).namespace }
  return {}
}

const createNamedObjectPaths = async (
  files: readonly DagProjectedFile[],
): Promise<Map<string, string>> => {
  const hints = collectNamingHints(files)
  const objects: ProjectedObject[] = []
  for (const file of files) {
    if (file.path.startsWith('refs/')) continue
    const kind = file.path.split('/')[0] as ProjectedObjectKind
    if (
      ![
        'modules',
        'module-locks',
        'nodes',
        'graph-revisions',
        'project-revisions',
        'invocations',
        'extensions',
      ].includes(kind)
    )
      continue
    const parsed =
      kind === 'nodes' ? null : parseProjectedJson(file.path, JSON.parse(file.content) as unknown)
    const node =
      kind === 'nodes'
        ? await loadStoredGraphNodeFile({ path: file.path, source: file.content })
        : null
    if (kind === 'nodes' && !node) throw new Error(`Could not parse projected node: ${file.path}`)
    const id = kind === 'nodes' ? node!.hash : parsed
    if (!id) throw new Error(`Projected object ${file.path} has no content identity.`)
    const value = kind === 'nodes' ? null : (JSON.parse(file.content) as unknown)
    const metadata = kind === 'nodes' ? node!.node : jsonNamingMetadata(kind, value)
    const candidates = objectCandidates(kind, id, metadata, hints).map(safeName).filter(Boolean)
    objects.push({
      file,
      kind,
      id,
      candidates: [candidates[0] ?? fallbackObjectName(kind, id)],
    })
  }

  const proposed = objects.map((object) => ({
    ...object,
    path: projectObjectPath(object.kind, object.candidates[0]!),
  }))
  const collisions = new Map<string, typeof proposed>()
  for (const object of proposed) {
    const group = collisions.get(object.path) ?? []
    group.push(object)
    collisions.set(object.path, group)
  }
  const output = new Map<string, string>()
  for (const object of proposed) {
    const group = collisions.get(object.path)!
    const path = group.length > 1 ? suffixPath(object.path, object.id) : object.path
    if (output.has(object.file.path))
      throw new Error(`Duplicate projected source path: ${object.file.path}`)
    output.set(object.file.path, path)
  }
  return output
}

const nodeReferenceEntries = (node: { inputs?: Record<string, DagNodeRecordInputRef> }) =>
  Object.entries(node.inputs ?? {}).flatMap(([alias, reference]) => {
    const nodeIds = 'kind' in reference ? reference.nodeIds : [reference.nodeId]
    return nodeIds.map((nodeId) => ({ alias, nodeId }))
  })

const decorateNodeSource = (
  source: string,
  node: { inputs?: Record<string, DagNodeRecordInputRef> },
  names: ReadonlyMap<Hash, { localName: string; label: string }>,
) => {
  const references = nodeReferenceEntries(node)
  if (references.length === 0) return source
  const comments = references.map(({ alias, nodeId }) => {
    const name = names.get(nodeId)
    return `  // ${alias} -> ${name ? `${name.localName} — ${name.label}` : nodeId}`
  })
  const marker = '\n  inputs: {'
  if (!source.includes(marker)) return source
  return source.replace(marker, `\n  // Input node references:\n${comments.join('\n')}${marker}`)
}

const decorateProjectedNodeSources = async (files: readonly DagProjectedFile[]) => {
  const names = new Map<Hash, { localName: string; label: string }>()
  for (const file of files.filter(({ path }) => path.startsWith('nodes/'))) {
    const loaded = await loadProjectedNodeFile({ path: file.path, source: file.content })
    names.set(loaded.hash, { localName: loaded.node.localName, label: loaded.node.label })
  }
  return await Promise.all(
    files.map(async (file) => {
      if (!file.path.startsWith('nodes/')) return file
      const loaded = await loadStoredGraphNodeFile({ path: file.path, source: file.content })
      return {
        ...file,
        content: decorateNodeSource(file.content, loaded.node, names),
      }
    }),
  )
}

const normalizeProjectedPath = (path: string) => {
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Invalid design graph projected path: ${path}`)
  }
  return path
}

const readJson = async (store: DesignGraphObjectStore, path: string): Promise<unknown> =>
  JSON.parse(await store.readText(path)) as unknown

const readProjectedFile = async (
  store: DesignGraphObjectStore,
  path: string,
): Promise<DagProjectedFile> =>
  await normalizeProjectedFile({ path, content: await store.readText(path) })

const listPaths = async (store: DesignGraphObjectStore, directories: readonly string[]) =>
  (
    await Promise.all(
      directories.map(async (directory) =>
        (await store.list(directory)).map((name) => `${directory}/${name}`),
      ),
    )
  ).flat()

const collectNodeClosure = async (store: DesignGraphObjectStore, roots: readonly Hash[]) => {
  const pending = [...new Set(roots)]
  const paths: string[] = []
  const visited = new Set<Hash>()
  while (pending.length > 0) {
    const id = pending.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    const path = `nodes/${hashFilePart(id)}.ts`
    const saved = await loadStoredGraphNodeFile({ path, source: await store.readText(path) })
    if (saved.hash !== id) throw new Error(`Stored graph node hash mismatch: ${path}`)
    paths.push(path)
    if (saved.node.moduleLockId) {
      const lockPath = objectPath('module-locks', saved.node.moduleLockId)
      const lock = parseDagModuleLock(await readJson(store, lockPath))
      paths.push(lockPath)
      for (const moduleId of getDagModuleLockModuleIds(lock)) {
        const modulePath = objectPath('modules', moduleId)
        parseDagModuleArtifact(await readJson(store, modulePath))
        paths.push(modulePath)
      }
    }
    pending.push(...getDagNodeRecordInputHashes(saved.node))
  }
  return paths
}

const collectGraphRevision = async (
  store: DesignGraphObjectStore,
  revisionId: Hash,
  visited = new Set<Hash>(),
): Promise<string[]> => {
  if (visited.has(revisionId)) return []
  visited.add(revisionId)
  const path = objectPath('graph-revisions', revisionId)
  const revision = parseGraphRevision(await readJson(store, path))
  return [
    path,
    ...(await collectNodeClosure(store, Object.values(revision.nodes))),
    ...(
      await Promise.all(
        revision.parents.map(async (parent) => await collectGraphRevision(store, parent, visited)),
      )
    ).flat(),
  ]
}

const collectProjectRevision = async (
  store: DesignGraphObjectStore,
  revisionId: Hash,
  visited = new Set<Hash>(),
): Promise<{ paths: string[]; nodeRoots: Hash[] }> => {
  if (visited.has(revisionId)) return { paths: [], nodeRoots: [] }
  visited.add(revisionId)
  const path = objectPath('project-revisions', revisionId)
  const revision = parseProjectRevision(await readJson(store, path))
  const invocationEntries = await Promise.all(
    Object.values(revision.invocations).map(async (id) => {
      const invocationPath = objectPath('invocations', id)
      const invocation = parseInvocationDefinition(await readJson(store, invocationPath))
      return { path: invocationPath, rootNodeId: invocation.rootNodeId }
    }),
  )
  const extensionPaths = await Promise.all(
    Object.values(revision.extensions).map(async (id) => {
      const extensionPath = objectPath('extensions', id)
      parseProjectExtension(await readJson(store, extensionPath))
      return extensionPath
    }),
  )
  const parents = await Promise.all(
    revision.parents.map(async (parent) => await collectProjectRevision(store, parent, visited)),
  )
  return {
    paths: [
      path,
      ...invocationEntries.map((entry) => entry.path),
      ...extensionPaths,
      ...parents.flatMap((parent) => parent.paths),
    ],
    nodeRoots: [
      ...invocationEntries.map((entry) => entry.rootNodeId),
      ...parents.flatMap((parent) => parent.nodeRoots),
    ],
  }
}

const collectProject = async (store: DesignGraphObjectStore, projectRef: string) => {
  const refName = projectRef.startsWith('projects/') ? projectRef : `projects/${projectRef}`
  const refPath = `refs/${normalizeProjectedPath(refName)}.json`
  const ref = parseDesignGraphRef(await readJson(store, refPath))
  const revision = await collectProjectRevision(store, ref.revisionId)
  return [refPath, ...revision.paths, ...(await collectNodeClosure(store, revision.nodeRoots))]
}

export const projectDesignGraphSnapshot = async (args: {
  store: DesignGraphObjectStore
  selector: DesignGraphSnapshotSelector
}): Promise<DagProjectedFile[]> => {
  let paths: string[]
  switch (args.selector.kind) {
    case 'global':
      paths = await listPaths(args.store, DESIGN_GRAPH_GIT_DIRECTORIES)
      break
    case 'project':
      paths = await collectProject(args.store, args.selector.projectRef)
      break
    case 'graphRevision':
      paths = await collectGraphRevision(args.store, args.selector.revisionId)
      break
    case 'node':
      paths = await collectNodeClosure(args.store, [args.selector.nodeId])
      break
  }
  const uniquePaths = [...new Set(paths)].sort()
  const files = await Promise.all(
    uniquePaths.map(async (path) => await readProjectedFile(args.store, path)),
  )
  const namedPaths = await createNamedObjectPaths(files)
  const namedFiles = await decorateProjectedNodeSources(files)
  return namedFiles.map((file) => ({
    ...file,
    path: namedPaths.get(file.path) ?? file.path,
  }))
}

const parseProjectedJson = (path: string, value: unknown): Hash | null => {
  if (path.startsWith('modules/')) return parseDagModuleArtifact(value).id
  if (path.startsWith('module-locks/')) return parseDagModuleLock(value).id
  if (path.startsWith('graph-revisions/')) return parseGraphRevision(value).id
  if (path.startsWith('project-revisions/')) return parseProjectRevision(value).id
  if (path.startsWith('invocations/')) return parseInvocationDefinition(value).id
  if (path.startsWith('extensions/')) return parseProjectExtension(value).id
  if (path.startsWith('source-manifests/')) return null
  if (path.startsWith('refs/')) {
    parseDesignGraphRef(value)
    return null
  }
  throw new Error(`Unsupported design graph JSON file: ${path}`)
}

const normalizeProjectedFile = async (
  file: DagProjectedFile,
  loadNodeFile: ProjectedNodeFileLoader = loadProjectedNodeFile,
): Promise<DagProjectedFile> => {
  normalizeProjectedPath(file.path)
  if (file.path.startsWith('nodes/')) {
    const loaded = await loadNodeFile({ path: file.path, source: file.content })
    return { path: file.path, content: loaded.file.source }
  }
  if (!file.path.endsWith('.json')) throw new Error(`Unsupported design graph file: ${file.path}`)
  parseProjectedJson(file.path, JSON.parse(file.content) as unknown)
  return file
}

const resolveCanonicalProjectedPath = async (
  file: DagProjectedFile,
  loadNodeFile: ProjectedNodeFileLoader,
): Promise<string> => {
  if (file.path.startsWith('refs/')) return file.path
  if (file.path.startsWith('nodes/')) {
    const loaded = await loadNodeFile({ path: file.path, source: file.content })
    return `nodes/${hashFilePart(loaded.hash)}.ts`
  }
  const kind = file.path.split('/')[0] ?? ''
  const id = parseProjectedJson(file.path, JSON.parse(file.content) as unknown)
  if (!id) return file.path
  return objectPath(kind, id)
}

export const canonicalProjectedPath = async (file: DagProjectedFile): Promise<string> =>
  await resolveCanonicalProjectedPath(file, loadProjectedNodeFile)

export const canonicalProjectedPaths = async (
  files: readonly DagProjectedFile[],
  nodeFileLoader: typeof loadStoredGraphNodeFiles = loadStoredGraphNodeFiles,
): Promise<Map<string, string>> => {
  const nodeFiles = files.filter(({ path }) => path.startsWith('nodes/'))
  const nodes = await nodeFileLoader(
    nodeFiles.map(({ path, content }) => ({ path, source: content })),
  )
  const nodesByPath = new Map(Object.values(nodes).map((node) => [node.file.path, node]))
  return new Map(
    await Promise.all(
      files.map(async (file) => {
        if (!file.path.startsWith('nodes/')) {
          return [file.path, await canonicalProjectedPath(file)] as const
        }
        const node = nodesByPath.get(file.path)
        if (!node) throw new Error(`Design repository node loader omitted ${file.path}`)
        return [file.path, `nodes/${hashFilePart(node.hash)}.ts`] as const
      }),
    ),
  )
}

const immutableComparisonContent = (file: DagProjectedFile) =>
  file.path.endsWith('.json') ? canonicalJson(JSON.parse(file.content) as unknown) : file.content

const readOptionalText = async (store: DesignGraphObjectStore, path: string) => {
  try {
    return await store.readText(path)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Design graph object not found:')) {
      return null
    }
    throw error
  }
}

const repositoryJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

const replaceNodeHashRefs = (source: string, replacements: ReadonlyMap<Hash, Hash>) => {
  let result = source
  for (const [from, to] of replacements) result = result.replaceAll(from, to)
  return result
}

const incomingNodeMatchesHash = (node: SavedStoredGraphNode, hash: Hash) =>
  node.file.path.endsWith(`--${shortHash(hash)}.ts`)

const readIncomingNodes = async (
  files: readonly DagProjectedFile[],
  loadNodeFile: ProjectedNodeFileLoader,
) => {
  const entries = await Promise.all(
    files
      .filter(({ path }) => path.startsWith('nodes/'))
      .map(async (file) => await loadNodeFile({ path: file.path, source: file.content })),
  )
  const nodes = new Map<string, SavedStoredGraphNode[]>()
  for (const node of entries)
    nodes.set(node.node.localName, [...(nodes.get(node.node.localName) ?? []), node])
  return nodes
}

const patchNamedRoots = async (args: {
  store: DesignGraphObjectStore
  roots: Record<string, Hash>
  incomingNodes: ReadonlyMap<string, SavedStoredGraphNode[]>
}) => {
  const paths = await collectNodeClosure(args.store, Object.values(args.roots))
  const files = await Promise.all(
    paths
      .filter((path) => path.startsWith('nodes/'))
      .map(async (path) => ({ path, source: await args.store.readText(path) })),
  )
  let storedGraph = await createStoredDagSourceGraph({ files, roots: args.roots })
  const replacements = new Map<Hash, Hash>()
  const createdFiles = new Map<string, { path: string; source: string }>()

  for (const rootName of Object.keys(args.roots)) {
    const localNames = getStoredDagSourceGraphLocalNameIndex({ storedGraph, rootName })
    for (const [localName, currentHash] of Object.entries(localNames)) {
      const namedCandidates = (args.incomingNodes.get(localName) ?? []).filter((candidate) =>
        incomingNodeMatchesHash(candidate, currentHash),
      )
      const candidates = (
        namedCandidates.length > 0 ? namedCandidates : (args.incomingNodes.get(localName) ?? [])
      ).filter((candidate) => candidate.hash !== currentHash)
      if (candidates.length > 1) {
        throw new Error(`Named graph edit is ambiguous for local node ${localName}`)
      }
      const candidate = candidates[0]
      if (!candidate) continue
      const patched = await patchStoredDagSourceGraphNode({
        storedGraph,
        rootName,
        targetLocalName: localName,
        updateSource: () => replaceNodeHashRefs(candidate.file.source, replacements),
      })
      storedGraph = patched.storedGraph
      const change = patched.patch.changedNodes[localName]
      if (!change) throw new Error(`Named graph edit did not change ${localName}`)
      replacements.set(currentHash, change.newHash)
      for (const changed of Object.values(patched.patch.changedNodes)) {
        const file = patched.storedGraph.nodesByHash[changed.newHash]?.file
        if (file) createdFiles.set(file.path, file)
      }
    }
  }

  return {
    roots: storedGraph.roots,
    replacements,
    files: [...createdFiles.values()],
  }
}

const updateNamedNodeReferences = async (args: {
  store: DesignGraphObjectStore
  files: readonly DagProjectedFile[]
  loadNodeFile: ProjectedNodeFileLoader
}): Promise<DagProjectedFile[]> => {
  const incomingNodes = await readIncomingNodes(args.files, args.loadNodeFile)
  const output = new Map(args.files.map((file) => [file.path, file]))
  const rootReplacements = new Map<Hash, Hash>()
  const graphRevisionUpdates = new Map<Hash, GraphRevisionUpdate>()

  for (const refFile of args.files.filter(({ path }) => path.startsWith('refs/graph/'))) {
    const incomingRef = parseDesignGraphRef(JSON.parse(refFile.content) as unknown)
    const currentRef = await readOptionalText(args.store, refFile.path)
    if (!currentRef) continue
    const currentRefValue = parseDesignGraphRef(JSON.parse(currentRef) as unknown)
    if (currentRefValue.revisionId !== incomingRef.revisionId) continue
    const cached = graphRevisionUpdates.get(currentRefValue.revisionId)
    if (cached) {
      output.set(refFile.path, {
        path: refFile.path,
        content: repositoryJson({ schemaVersion: 2, revisionId: cached.revision.id }),
      })
      continue
    }
    const revision = parseGraphRevision(
      await readJson(args.store, objectPath('graph-revisions', currentRefValue.revisionId)),
    )
    const patched = await patchNamedRoots({
      store: args.store,
      roots: revision.nodes,
      incomingNodes,
    })
    for (const file of patched.files)
      output.set(file.path, { path: file.path, content: file.source })
    if (patched.replacements.size === 0) continue
    for (const [oldRoot, newRoot] of Object.entries(revision.nodes)) {
      const nextRoot = patched.roots[oldRoot]
      if (nextRoot && nextRoot !== newRoot) rootReplacements.set(newRoot, nextRoot)
    }
    const nextRevision = createGraphRevision({ parents: [revision.id], nodes: patched.roots })
    const update = { revision: nextRevision }
    graphRevisionUpdates.set(revision.id, update)
    output.set(`graph-revisions/${hashFilePart(nextRevision.id)}.json`, {
      path: `graph-revisions/${hashFilePart(nextRevision.id)}.json`,
      content: repositoryJson(nextRevision),
    })
    output.set(refFile.path, {
      path: refFile.path,
      content: repositoryJson({ schemaVersion: 2, revisionId: nextRevision.id }),
    })
  }

  const projectRevisionUpdates = new Map<Hash, ProjectRevisionUpdate>()
  for (const refFile of args.files.filter(({ path }) => path.startsWith('refs/projects/'))) {
    const incomingRef = parseDesignGraphRef(JSON.parse(refFile.content) as unknown)
    const currentRef = await readOptionalText(args.store, refFile.path)
    if (!currentRef) continue
    const currentRefValue = parseDesignGraphRef(JSON.parse(currentRef) as unknown)
    if (currentRefValue.revisionId !== incomingRef.revisionId) continue
    const cached = projectRevisionUpdates.get(currentRefValue.revisionId)
    if (cached) {
      output.set(refFile.path, {
        path: refFile.path,
        content: repositoryJson({ schemaVersion: 2, revisionId: cached.revision.id }),
      })
      continue
    }
    const revision = parseProjectRevision(
      await readJson(args.store, objectPath('project-revisions', currentRefValue.revisionId)),
    )
    const invocations: Record<string, ReturnType<typeof createInvocationDefinition>> = {}
    let changed = false
    for (const [name, invocationId] of Object.entries(revision.invocations)) {
      const invocation = parseInvocationDefinition(
        await readJson(args.store, objectPath('invocations', invocationId)),
      )
      let rootNodeId = rootReplacements.get(invocation.rootNodeId)
      if (!rootNodeId) {
        const patched = await patchNamedRoots({
          store: args.store,
          roots: { [name]: invocation.rootNodeId },
          incomingNodes,
        })
        for (const file of patched.files)
          output.set(file.path, { path: file.path, content: file.source })
        rootNodeId = patched.roots[name]
        if (rootNodeId && rootNodeId !== invocation.rootNodeId) {
          rootReplacements.set(invocation.rootNodeId, rootNodeId)
        }
      }
      if (rootNodeId && rootNodeId !== invocation.rootNodeId) {
        changed = true
        const nextInvocation = createInvocationDefinition({
          rootNodeId,
          variables: invocation.variables,
          inputs: invocation.inputs,
          objectives: invocation.objectives,
          constraints: invocation.constraints,
          capture: invocation.capture,
          policy: invocation.policy,
          reducerOverrides: invocation.reducerOverrides,
        })
        invocations[name] = nextInvocation
        output.set(`invocations/${hashFilePart(nextInvocation.id)}.json`, {
          path: `invocations/${hashFilePart(nextInvocation.id)}.json`,
          content: repositoryJson(nextInvocation),
        })
      } else {
        invocations[name] = invocation
      }
    }
    if (!changed) continue
    const nextRevision = createProjectRevision({
      parents: [revision.id],
      displayName: revision.displayName,
      invocations: Object.fromEntries(
        Object.entries(invocations).map(([name, invocation]) => [name, invocation.id]),
      ),
      extensions: revision.extensions,
    })
    projectRevisionUpdates.set(revision.id, { revision: nextRevision })
    output.set(`project-revisions/${hashFilePart(nextRevision.id)}.json`, {
      path: `project-revisions/${hashFilePart(nextRevision.id)}.json`,
      content: repositoryJson(nextRevision),
    })
    output.set(refFile.path, {
      path: refFile.path,
      content: repositoryJson({ schemaVersion: 2, revisionId: nextRevision.id }),
    })
  }
  return [...output.values()]
}

type GraphRevisionUpdate = { revision: ReturnType<typeof createGraphRevision> }
type ProjectRevisionUpdate = { revision: ReturnType<typeof createProjectRevision> }

const validateProjectedClosure = async (
  store: DesignGraphObjectStore,
  projected: ReadonlyMap<string, string>,
  loadNodeFile: ProjectedNodeFileLoader,
) => {
  const readAvailable = async (path: string) => projected.get(path) ?? (await store.readText(path))
  for (const [path, content] of projected) {
    if (path.startsWith('nodes/')) {
      const node = (await loadNodeFile({ path, source: content })).node
      if (node.moduleLockId) {
        const lock = parseDagModuleLock(
          JSON.parse(await readAvailable(objectPath('module-locks', node.moduleLockId))) as unknown,
        )
        for (const moduleId of getDagModuleLockModuleIds(lock)) {
          parseDagModuleArtifact(
            JSON.parse(await readAvailable(objectPath('modules', moduleId))) as unknown,
          )
        }
      }
    }
    if (path.startsWith('project-revisions/')) {
      const revision = parseProjectRevision(JSON.parse(content) as unknown)
      for (const parent of revision.parents) {
        parseProjectRevision(
          JSON.parse(await readAvailable(objectPath('project-revisions', parent))) as unknown,
        )
      }
      for (const invocationId of Object.values(revision.invocations)) {
        const invocation = parseInvocationDefinition(
          JSON.parse(await readAvailable(objectPath('invocations', invocationId))) as unknown,
        )
        await loadNodeFile({
          path: `nodes/${hashFilePart(invocation.rootNodeId)}.ts`,
          source: await readAvailable(`nodes/${hashFilePart(invocation.rootNodeId)}.ts`),
        })
      }
      for (const extensionId of Object.values(revision.extensions)) {
        parseProjectExtension(
          JSON.parse(await readAvailable(objectPath('extensions', extensionId))) as unknown,
        )
      }
    }
    if (path.startsWith('graph-revisions/')) {
      const revision = parseGraphRevision(JSON.parse(content) as unknown)
      for (const parent of revision.parents) {
        parseGraphRevision(
          JSON.parse(await readAvailable(objectPath('graph-revisions', parent))) as unknown,
        )
      }
    }
  }
}

export type DesignGraphSnapshotImportProgress = {
  step: string
  durationMs: number
  details?: Record<string, unknown>
}

export const importDesignGraphSnapshot = async (args: {
  store: DesignGraphObjectStore
  files: readonly DagProjectedFile[]
  expectedRefs?: Readonly<Record<string, string | null>>
  preloadedNodes?: Readonly<Record<Hash, SavedStoredGraphNode>>
  onProgress?: (event: DesignGraphSnapshotImportProgress) => void
}) => {
  const timeImportStep = async <T>(
    step: string,
    run: () => T | Promise<T>,
    details?: (result: T) => Record<string, unknown>,
  ): Promise<T> => {
    const startedAtMs = performance.now()
    const result = await run()
    args.onProgress?.({
      step,
      durationMs: performance.now() - startedAtMs,
      ...(details ? { details: details(result) } : {}),
    })
    return result
  }
  const loadNodeFile = createProjectedNodeFileLoader(Object.values(args.preloadedNodes ?? {}))
  const reconciledFiles = await timeImportStep(
    'update-named-node-references',
    async () =>
      await updateNamedNodeReferences({
        store: args.store,
        files: args.files,
        loadNodeFile,
      }),
    (files) => ({ fileCount: files.length }),
  )
  const normalized = await timeImportStep(
    'normalize-projected-files',
    async () =>
      await Promise.all(
        reconciledFiles.map(async (file) => await normalizeProjectedFile(file, loadNodeFile)),
      ),
    (files) => ({ fileCount: files.length }),
  )
  const canonical = await timeImportStep(
    'resolve-canonical-paths',
    async () =>
      await Promise.all(
        normalized.map(async (file) => ({
          ...file,
          path: await resolveCanonicalProjectedPath(file, loadNodeFile),
        })),
      ),
    (files) => ({ fileCount: files.length }),
  )
  const projected = await timeImportStep(
    'deduplicate-projected-files',
    () => {
      const filesByPath = new Map<string, string>()
      for (const file of canonical) {
        const existing = filesByPath.get(file.path)
        if (existing !== undefined && existing !== file.content) {
          throw new Error(`Conflicting design graph objects resolve to ${file.path}`)
        }
        filesByPath.set(file.path, file.content)
      }
      return filesByPath
    },
    (files) => ({ fileCount: canonical.length, objectCount: files.size }),
  )
  await timeImportStep(
    'validate-projected-closure',
    async () => {
      await validateProjectedClosure(args.store, projected, loadNodeFile)
    },
    () => ({ objectCount: projected.size }),
  )

  const { immutable, refs } = await timeImportStep(
    'partition-projected-files',
    () => ({
      immutable: canonical.filter((file) => !file.path.startsWith('refs/')),
      refs: canonical.filter((file) => file.path.startsWith('refs/')),
    }),
    ({ immutable: immutableFiles, refs: refFiles }) => ({
      immutableFileCount: immutableFiles.length,
      refFileCount: refFiles.length,
    }),
  )
  const missing: DagProjectedFile[] = []
  const existingImmutable = await timeImportStep(
    'read-existing-immutable-objects',
    async () =>
      args.store.readManyText
        ? await args.store.readManyText(immutable.map((file) => file.path))
        : null,
    (existing) => ({ fileCount: immutable.length, bulkRead: existing !== null }),
  )
  await timeImportStep(
    'compare-existing-immutable-objects',
    async () => {
      for (const file of immutable) {
        const existing = existingImmutable
          ? (existingImmutable.get(file.path) ?? null)
          : await readOptionalText(args.store, file.path)
        if (existing === null) missing.push(file)
        else {
          const normalizedExisting = await normalizeProjectedFile({
            path: file.path,
            content: existing,
          })
          if (immutableComparisonContent(normalizedExisting) !== immutableComparisonContent(file)) {
            throw new Error(`Immutable design graph object collision: ${file.path}`)
          }
        }
      }
    },
    () => ({ checkedFileCount: immutable.length, missingFileCount: missing.length }),
  )
  await timeImportStep(
    'validate-refs',
    async () => {
      for (const file of refs) {
        const current = await readOptionalText(args.store, file.path)
        const expected = args.expectedRefs?.[file.path] ?? null
        if (current !== expected) {
          throw new Error(`Design graph ref conflict: ${file.path}`)
        }
      }
    },
    () => ({ refFileCount: refs.length }),
  )
  const batchableDirectories = [
    'nodes/',
    'modules/',
    'module-locks/',
    'graph-revisions/',
    'project-revisions/',
    'invocations/',
    'extensions/',
  ]
  const batched = args.store.writeManyText
    ? missing.filter((file) => batchableDirectories.some((prefix) => file.path.startsWith(prefix)))
    : []
  await timeImportStep(
    'write-missing-batched-objects',
    async () => {
      if (batched.length > 0) await args.store.writeManyText!(batched)
    },
    () => ({ fileCount: batched.length }),
  )
  const conditional = missing.filter((file) => !batched.includes(file))
  await timeImportStep(
    'write-missing-conditional-objects',
    async () => {
      for (const file of conditional) {
        const result = await args.store.writeTextIfUnchanged(file.path, null, file.content)
        if (!result.written) {
          const current = await readOptionalText(args.store, file.path)
          if (
            current === null ||
            immutableComparisonContent({ path: file.path, content: current }) !==
              immutableComparisonContent(file)
          ) {
            throw new Error(`Immutable design graph object collision: ${file.path}`)
          }
        }
      }
    },
    () => ({ fileCount: conditional.length }),
  )
  await timeImportStep(
    'write-refs',
    async () => {
      for (const file of refs) {
        const expected = args.expectedRefs?.[file.path] ?? null
        const result = await args.store.writeTextIfUnchanged(
          file.path,
          expected === null ? null : canonicalHash(expected),
          file.content,
        )
        if (!result.written) throw new Error(`Design graph ref conflict: ${file.path}`)
      }
    },
    () => ({ refFileCount: refs.length }),
  )
  return { imported: normalized.length }
}
export const synchronizeDesignGraphRepository = async (args: {
  store: DesignGraphObjectStore
  selector: DesignGraphSnapshotSelector
  synchronizer: DesignGraphGitSynchronizer
  branch: string
  commit: { message: string; author: { name: string; email: string } }
}) => {
  const files = await projectDesignGraphSnapshot({ store: args.store, selector: args.selector })
  await args.synchronizer.writeProjection(files, args.branch)
  const commitId = await args.synchronizer.commit(args.commit)
  const result = await args.synchronizer.synchronize(args.branch)
  if (result.status !== 'pulled') {
    return { ...result, commitId, exported: files.length, imported: 0 }
  }
  const pulledFiles = await args.synchronizer.readProjection()
  const expectedRefs = Object.fromEntries(
    files.filter((file) => file.path.startsWith('refs/')).map((file) => [file.path, file.content]),
  )
  const imported = await importDesignGraphSnapshot({
    store: args.store,
    files: pulledFiles,
    expectedRefs,
  })
  return { ...result, commitId, exported: files.length, imported: imported.imported }
}
