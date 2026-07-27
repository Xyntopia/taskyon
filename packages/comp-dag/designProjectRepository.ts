import type { Hash } from './caching'
import {
  parseDesignEvaluationRecord,
  parseDesignRef,
  parseDesignRevision,
  parseDesignSpaceRecord,
  type DesignEvaluationRecordV1,
  type DesignExecutionConfigV1,
  type DesignObjectId,
  type DesignRefV1,
  type DesignRevisionId,
  type DesignRevisionMetadataV1,
  type DesignRevisionV1,
  type DesignSpaceRecord,
  type SavedDesignRefV1,
} from './designRevision'

export type DesignProjectObjectStore = {
  read: (path: string) => Promise<unknown>
  write: (path: string, value: unknown) => Promise<void>
  list: (directory: string) => Promise<string[]>
}

export type DesignProjectRepository = ReturnType<typeof createDesignProjectRepository>

const safeSegment = (value: string, label: string): string => {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]/g, '-')
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new Error(`${label} must contain a safe filename character.`)
  }
  return normalized
}

const objectPath = (kind: string, id: Hash) => `${kind}/${id}.json`
const rootDirectory = (kind: string, rootName: string) =>
  `${kind}/${safeSegment(rootName, 'rootName')}`

export const createDesignProjectRepository = (store: DesignProjectObjectStore) => {
  const putDesignSpace = async (record: DesignSpaceRecord) => {
    parseDesignSpaceRecord(record)
    await store.write(objectPath('design-spaces', record.id), record)
    return record.id
  }

  const getDesignSpace = async (id: DesignObjectId) => {
    const value = await store.read(objectPath('design-spaces', id))
    if (value === null) throw new Error(`Design space not found: ${id}`)
    return parseDesignSpaceRecord(value)
  }

  const putRevision = async (record: DesignRevisionV1, metadata?: DesignRevisionMetadataV1) => {
    parseDesignRevision(record)
    await store.write(objectPath('revisions', record.id), record)
    if (metadata) await store.write(objectPath('metadata/revisions', record.id), metadata)
    return record.id
  }

  const getRevision = async (id: DesignRevisionId) => {
    const value = await store.read(objectPath('revisions', id))
    if (value === null) throw new Error(`Design revision not found: ${id}`)
    return parseDesignRevision(value)
  }

  const getRef = async (name: string): Promise<DesignRefV1 | null> => {
    const value = await store.read(`refs/${safeSegment(name, 'refName')}.json`)
    return value === null ? null : parseDesignRef(value)
  }

  const advanceRef = async (args: {
    name: string
    revisionId: DesignRevisionId
    expectedRevisionId?: DesignRevisionId | null
  }) => {
    await getRevision(args.revisionId)
    const current = await getRef(args.name)
    if (
      args.expectedRevisionId !== undefined &&
      (current?.revisionId ?? null) !== args.expectedRevisionId
    ) {
      throw new Error(
        `Design ref conflict for ${args.name}: expected ${String(args.expectedRevisionId)}, found ${String(current?.revisionId ?? null)}.`,
      )
    }
    const next = { schemaVersion: 1, revisionId: args.revisionId } as const
    await store.write(`refs/${safeSegment(args.name, 'refName')}.json`, next)
    return next
  }

  const listRefs = async (): Promise<Record<string, DesignRevisionId>> => {
    const names = await store.list('refs')
    const entries = await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => {
          const value = await store.read(`refs/${name}`)
          if (value === null) return null
          return [name.slice(0, -5), parseDesignRef(value).revisionId] as const
        }),
    )
    return Object.fromEntries(entries.filter((entry) => entry !== null))
  }

  const putExecutionConfig = async (
    rootName: string,
    id: DesignObjectId,
    value: DesignExecutionConfigV1,
  ) => {
    await store.write(`${rootDirectory('executions', rootName)}/${id}.json`, value)
  }

  const getExecutionConfig = async (rootName: string, id: DesignObjectId) => {
    const value = await store.read(`${rootDirectory('executions', rootName)}/${id}.json`)
    if (value === null) throw new Error(`Design execution config not found: ${id}`)
    return value as DesignExecutionConfigV1
  }

  const putEvaluation = async (record: DesignEvaluationRecordV1) => {
    parseDesignEvaluationRecord(record)
    await store.write(`${rootDirectory('evaluations', record.rootName)}/${record.id}.json`, record)
    return record.id
  }

  const getEvaluation = async (rootName: string, id: DesignObjectId) => {
    const value = await store.read(`${rootDirectory('evaluations', rootName)}/${id}.json`)
    if (value === null) throw new Error(`Design evaluation not found: ${id}`)
    return parseDesignEvaluationRecord(value)
  }

  const saveDesign = async (rootName: string, name: string, evaluationId: DesignObjectId) => {
    await getEvaluation(rootName, evaluationId)
    const record: SavedDesignRefV1 = { schemaVersion: 1, name, evaluationId }
    await store.write(
      `${rootDirectory('saved-designs', rootName)}/${safeSegment(name, 'designName')}.json`,
      record,
    )
    return record
  }

  const putVisualization = async (args: {
    rootName: string
    outputSchemaId: Hash
    visualizationId: Hash
    html: string
  }) => {
    const directory = `${rootDirectory('visualizations', args.rootName)}/${args.outputSchemaId}`
    await store.write(`${directory}/${args.visualizationId}.json`, {
      schemaVersion: 1,
      html: args.html,
    })
    await store.write(`${directory}/active.json`, {
      schemaVersion: 1,
      visualizationId: args.visualizationId,
    })
  }

  const getVisualization = async (rootName: string, outputSchemaId: Hash) => {
    const directory = `${rootDirectory('visualizations', rootName)}/${outputSchemaId}`
    const active = await store.read(`${directory}/active.json`)
    if (
      typeof active !== 'object' ||
      active === null ||
      !('visualizationId' in active) ||
      typeof active.visualizationId !== 'string'
    ) {
      return null
    }
    const value = await store.read(`${directory}/${active.visualizationId}.json`)
    if (
      typeof value !== 'object' ||
      value === null ||
      !('html' in value) ||
      typeof value.html !== 'string'
    ) {
      return null
    }
    return { visualizationId: active.visualizationId as Hash, html: value.html }
  }

  return {
    putDesignSpace,
    getDesignSpace,
    putRevision,
    getRevision,
    getRef,
    advanceRef,
    listRefs,
    putExecutionConfig,
    getExecutionConfig,
    putEvaluation,
    getEvaluation,
    saveDesign,
    putVisualization,
    getVisualization,
  }
}
