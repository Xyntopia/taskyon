import { canonicalHash, canonicalJson } from '@taskyon/common/modules/canonicalHash'
import type { Hash } from './caching.ts'
import {
  getDagModuleLockModuleIds,
  parseDagModuleArtifact,
  parseDagModuleLock,
} from './dagModule.ts'
import {
  parseDesignGraphRef,
  parseGraphRevision,
  parseInvocationDefinition,
  parseProjectExtension,
  parseProjectRevision,
} from './designGraphModel.ts'
import type { DesignGraphObjectStore } from './designGraphRepository.ts'
import { getDagNodeRecordInputHashes } from './dagNodeRecord.ts'
import { loadStoredGraphNodeFile, normalizeStoredGraphNodeSource } from './dagNodeLoader.ts'

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
  return await Promise.all(
    uniquePaths.map(async (path) => await readProjectedFile(args.store, path)),
  )
}

const parseProjectedJson = (path: string, value: unknown) => {
  if (path.startsWith('modules/')) parseDagModuleArtifact(value)
  else if (path.startsWith('module-locks/')) parseDagModuleLock(value)
  else if (path.startsWith('graph-revisions/')) parseGraphRevision(value)
  else if (path.startsWith('project-revisions/')) parseProjectRevision(value)
  else if (path.startsWith('invocations/')) parseInvocationDefinition(value)
  else if (path.startsWith('extensions/')) parseProjectExtension(value)
  else if (path.startsWith('refs/')) parseDesignGraphRef(value)
}

const normalizeProjectedFile = async (file: DagProjectedFile): Promise<DagProjectedFile> => {
  normalizeProjectedPath(file.path)
  if (file.path.startsWith('nodes/')) {
    const loaded = await loadStoredGraphNodeFile({ path: file.path, source: file.content })
    const normalized = await normalizeStoredGraphNodeSource(file.content, { id: loaded.hash })
    return { path: file.path, content: normalized.source }
  }
  if (!file.path.endsWith('.json')) throw new Error(`Unsupported design graph file: ${file.path}`)
  parseProjectedJson(file.path, JSON.parse(file.content) as unknown)
  return file
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

const validateProjectedClosure = async (
  store: DesignGraphObjectStore,
  projected: ReadonlyMap<string, string>,
) => {
  const readAvailable = async (path: string) => projected.get(path) ?? (await store.readText(path))
  for (const [path, content] of projected) {
    if (path.startsWith('nodes/')) {
      const node = (await loadStoredGraphNodeFile({ path, source: content })).node
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
        await loadStoredGraphNodeFile({
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

export const importDesignGraphSnapshot = async (args: {
  store: DesignGraphObjectStore
  files: readonly DagProjectedFile[]
  expectedRefs?: Readonly<Record<string, string | null>>
}) => {
  const normalized = await Promise.all(args.files.map(normalizeProjectedFile))
  const projected = new Map<string, string>()
  for (const file of normalized) {
    if (projected.has(file.path))
      throw new Error(`Duplicate design graph projected path: ${file.path}`)
    projected.set(file.path, file.content)
  }
  await validateProjectedClosure(args.store, projected)

  const immutable = normalized.filter((file) => !file.path.startsWith('refs/'))
  const refs = normalized.filter((file) => file.path.startsWith('refs/'))
  const missing: DagProjectedFile[] = []
  for (const file of immutable) {
    const existing = await readOptionalText(args.store, file.path)
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
  for (const file of refs) {
    const current = await readOptionalText(args.store, file.path)
    const expected = args.expectedRefs?.[file.path] ?? null
    if (current !== expected) {
      throw new Error(`Design graph ref conflict: ${file.path}`)
    }
  }
  for (const file of missing) {
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
  for (const file of refs) {
    const expected = args.expectedRefs?.[file.path] ?? null
    const result = await args.store.writeTextIfUnchanged(
      file.path,
      expected === null ? null : canonicalHash(expected),
      file.content,
    )
    if (!result.written) throw new Error(`Design graph ref conflict: ${file.path}`)
  }
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
