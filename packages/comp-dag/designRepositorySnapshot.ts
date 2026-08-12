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
}

export type LoadedProjectRepositorySnapshot = {
  revision: ProjectRevision
  invocations: Record<Hash, InvocationDefinition>
  extensions: Record<Hash, ProjectExtension>
  files: StoredGraphNodeFile[]
  nodesByHash: Record<Hash, SavedStoredGraphNode>
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

export const loadDesignRepositorySnapshot = async (args: {
  readText: DesignRepositoryTextReader
  checkout: DesignRepositoryCheckout
}): Promise<LoadedDesignRepositorySnapshot> => {
  const revisionId = await resolveRevisionId(args.readText, args.checkout)
  const revision = parseGraphRevision(
    await readJson(args.readText, `graph-revisions/${hashFilePart(revisionId)}.json`),
  )
  const nodesByHash = await loadNodeClosure(args.readText, Object.values(revision.nodes))
  return {
    revision,
    nodesByHash,
    files: Object.values(nodesByHash)
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
  return {
    revision,
    invocations,
    extensions,
    nodesByHash,
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
