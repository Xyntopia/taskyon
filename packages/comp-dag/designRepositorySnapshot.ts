import type { Hash } from './caching.ts'
import {
  loadStoredGraphNodeFile,
  type SavedStoredGraphNode,
  type StoredGraphNodeFile,
} from './dagNodeLoader.ts'
import { hashFilePart } from './dagNodeIdentity.ts'
import { getDagNodeRecordInputHashes } from './dagNodeRecord.ts'
import {
  parseDesignRef,
  parseDesignRevision,
  parseDesignSpaceRecord,
  type DesignRevisionId,
  type DesignRevisionV1,
  type DesignSpaceRecord,
} from './designRevision.ts'

export type DesignRepositoryTextReader = (path: string) => Promise<string>

export type DesignRepositoryCheckout =
  | { kind: 'ref'; name: string }
  | { kind: 'revision'; id: DesignRevisionId }

export type LoadedDesignRepositorySnapshot = {
  revision: DesignRevisionV1
  designSpace: DesignSpaceRecord
  files: StoredGraphNodeFile[]
  nodesByHash: Record<Hash, SavedStoredGraphNode>
}

const safeRefName = (name: string): string => {
  if (!/^[a-zA-Z0-9._-]+$/.test(name) || name === '.' || name === '..') {
    throw new Error(`Invalid design repository ref: ${name}`)
  }
  return name
}

const readJson = async (readText: DesignRepositoryTextReader, path: string): Promise<unknown> => {
  const source = await readText(path)
  try {
    return JSON.parse(source) as unknown
  } catch (error) {
    throw new Error(`Invalid JSON in design repository object ${path}`, { cause: error })
  }
}

const objectPath = (kind: 'design-spaces' | 'revisions', id: Hash): string =>
  `${kind}/${hashFilePart(id)}.json`

const resolveRevisionId = async (
  readText: DesignRepositoryTextReader,
  checkout: DesignRepositoryCheckout,
): Promise<DesignRevisionId> => {
  if (checkout.kind === 'revision') return checkout.id
  const ref = parseDesignRef(await readJson(readText, `refs/${safeRefName(checkout.name)}.json`))
  return ref.revisionId
}

const loadNodeClosure = async (
  readText: DesignRepositoryTextReader,
  rootHashes: readonly Hash[],
): Promise<Record<Hash, SavedStoredGraphNode>> => {
  const pending = [...new Set(rootHashes)]
  const nodesByHash: Record<Hash, SavedStoredGraphNode> = {}
  while (pending.length) {
    const expectedHash = pending.pop()!
    if (nodesByHash[expectedHash]) continue
    const path = `nodes/${hashFilePart(expectedHash)}.ts`
    const file = { path, source: await readText(path) }
    const saved = await loadStoredGraphNodeFile(file)
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
  const revision = parseDesignRevision(
    await readJson(args.readText, objectPath('revisions', revisionId)),
  )
  const designSpace = parseDesignSpaceRecord(
    await readJson(args.readText, objectPath('design-spaces', revision.designSpaceId)),
  )
  const nodesByHash = await loadNodeClosure(
    args.readText,
    Object.values(revision.roots).map((root) => root.nodeId),
  )
  return {
    revision,
    designSpace,
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
