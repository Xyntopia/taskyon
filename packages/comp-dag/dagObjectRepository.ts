import type { Hash } from './caching.ts'
import {
  parseDagEvaluationRecord,
  parseDagInvocation,
  type DagEvaluationRecord,
  type DagInvocationRecord,
} from './dagInvocation.ts'
import type { SavedStoredGraphNode } from './dagNodeLoader.ts'
import { getDagNodeRecordInputHashes } from './dagNodeRecord.ts'

export type DagObjectRefTarget = { nodeId: Hash } | { invocationId: Hash }

export type DagObjectStorage = {
  get: (request: { namespace: string; id: string }) => Promise<{ value: unknown | null }>
  set: (request: { namespace: string; id: string; value: unknown }) => Promise<unknown>
  list: (request: {
    namespace: string
  }) => Promise<{ rows: Array<{ id: string | number; data: unknown }> }>
}

type StoredDagNodeObject = {
  schemaVersion: 1
  id: Hash
  localName: string
  source: string
  dependencies: Hash[]
}

const safeRefName = (value: string): string => {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._/-]/g, '-')
    .replace(/^\/+|\/+$/g, '')
  if (
    !normalized ||
    normalized.split('/').some((segment) => segment === '.' || segment === '..' || !segment)
  ) {
    throw new Error('DAG ref name must contain safe path segments.')
  }
  return normalized
}

const requireObject = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value as Record<string, unknown>
}

const parseRefTarget = (value: unknown): DagObjectRefTarget => {
  const target = requireObject(value, 'DAG ref target')
  if (typeof target.nodeId === 'string') return { nodeId: target.nodeId as Hash }
  if (typeof target.invocationId === 'string') {
    return { invocationId: target.invocationId as Hash }
  }
  throw new Error('DAG ref must target a node or invocation.')
}

export const createDagObjectRepository = (storage: DagObjectStorage, namespace = 'dag/objects') => {
  const objectNamespace = (kind: 'nodes' | 'invocations' | 'evaluations' | 'refs') =>
    `${namespace}/${kind}`

  const putImmutable = async (
    kind: 'nodes' | 'invocations' | 'evaluations',
    id: Hash,
    value: unknown,
  ) => {
    const existing = await storage.get({ namespace: objectNamespace(kind), id })
    if (existing.value !== null && JSON.stringify(existing.value) !== JSON.stringify(value)) {
      throw new Error(`Immutable DAG object collision for ${id}.`)
    }
    if (existing.value === null) {
      await storage.set({ namespace: objectNamespace(kind), id, value })
    }
    return id
  }

  const getRequired = async (kind: 'nodes' | 'invocations' | 'evaluations', id: Hash) => {
    const result = await storage.get({ namespace: objectNamespace(kind), id })
    if (result.value === null) throw new Error(`DAG ${kind.slice(0, -1)} not found: ${id}`)
    return result.value
  }

  const putNode = async (node: SavedStoredGraphNode) =>
    await putImmutable('nodes', node.hash, {
      schemaVersion: 1,
      id: node.hash,
      localName: node.node.localName,
      source: node.file.source,
      dependencies: getDagNodeRecordInputHashes(node.node),
    } satisfies StoredDagNodeObject)

  const getNode = async (id: Hash): Promise<StoredDagNodeObject> => {
    const value = requireObject(await getRequired('nodes', id), 'Stored DAG node')
    if (
      value.schemaVersion !== 1 ||
      value.id !== id ||
      typeof value.localName !== 'string' ||
      typeof value.source !== 'string' ||
      !Array.isArray(value.dependencies)
    ) {
      throw new Error(`Stored DAG node is invalid: ${id}`)
    }
    return {
      schemaVersion: 1,
      id,
      localName: value.localName,
      source: value.source,
      dependencies: value.dependencies.map((dependency) => {
        if (typeof dependency !== 'string') throw new Error(`Invalid dependency in node ${id}`)
        return dependency as Hash
      }),
    }
  }

  const putInvocation = async (record: DagInvocationRecord) =>
    await putImmutable('invocations', record.id, parseDagInvocation(record))
  const getInvocation = async (id: Hash) => parseDagInvocation(await getRequired('invocations', id))
  const putEvaluation = async (record: DagEvaluationRecord) =>
    await putImmutable('evaluations', record.id, parseDagEvaluationRecord(record))
  const getEvaluation = async (id: Hash) =>
    parseDagEvaluationRecord(await getRequired('evaluations', id))

  const getRef = async (name: string): Promise<DagObjectRefTarget | null> => {
    const result = await storage.get({
      namespace: objectNamespace('refs'),
      id: safeRefName(name),
    })
    return result.value === null ? null : parseRefTarget(result.value)
  }

  const advanceRef = async (args: {
    name: string
    target: DagObjectRefTarget
    expected?: DagObjectRefTarget | null
  }) => {
    if ('nodeId' in args.target) await getNode(args.target.nodeId)
    else await getInvocation(args.target.invocationId)
    const current = await getRef(args.name)
    if (args.expected !== undefined && JSON.stringify(current) !== JSON.stringify(args.expected)) {
      throw new Error(`DAG ref conflict for ${args.name}.`)
    }
    await storage.set({
      namespace: objectNamespace('refs'),
      id: safeRefName(args.name),
      value: args.target,
    })
    return args.target
  }

  const listRefs = async (): Promise<Record<string, DagObjectRefTarget>> => {
    const rows = await storage.list({ namespace: objectNamespace('refs') })
    return Object.fromEntries(rows.rows.map((row) => [String(row.id), parseRefTarget(row.data)]))
  }

  return {
    putNode,
    getNode,
    putInvocation,
    getInvocation,
    putEvaluation,
    getEvaluation,
    getRef,
    advanceRef,
    listRefs,
  }
}
