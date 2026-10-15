import { canonicalHash, canonicalJson } from '@taskyon/common/modules/canonicalHash'
import type { Hash } from './caching.ts'
import {
  parseDagModuleArtifact,
  parseDagModuleLock,
  getDagModuleLockModuleIds,
  type DagModuleArtifact,
  type DagModuleLock,
} from './dagModule.ts'
import {
  parseActiveDesignVisualization,
  parseDesignGraphRef,
  parseDesignVisualization,
  parseExecutionAttempt,
  parseGraphRevision,
  parseInvocationDefinition,
  parseInvocationRun,
  parseProjectExtension,
  parseProjectRevision,
  type ActiveDesignVisualization,
  type DesignGraphRef,
  type ExecutionAttempt,
  type GraphRevision,
  type InvocationDefinition,
  type InvocationRun,
  type ProjectExtension,
  type ProjectRevision,
} from './designGraphModel.ts'

export type DesignGraphObjectStore = {
  readText: (path: string) => Promise<string>
  readManyText?: (paths: readonly string[]) => Promise<Map<string, string | null>>
  writeText: (path: string, content: string) => Promise<void>
  writeManyText?: (files: readonly { path: string; content: string }[]) => Promise<void>
  writeTextIfUnchanged: (
    path: string,
    expectedContentHash: string | null,
    content: string,
  ) => Promise<{ written: boolean; currentContentHash: string | null }>
  list: (directory: string) => Promise<string[]>
}

export type DesignGraphStorageClient = {
  get: (request: {
    namespace: string
    id: string
  }) => Promise<{ value: unknown; contentHash: string | null }>
  set: (request: { namespace: string; id: string; value: unknown }) => Promise<unknown>
  getMany?: (request: { namespace: string; ids: (string | number)[] }) => Promise<{
    rows: Array<{ id: string | number; data: unknown }>
  }>
  setMany?: (request: {
    namespace: string
    rows: { id: string | number; data: unknown }[]
  }) => Promise<unknown>
  setIfUnchanged: (request: {
    namespace: string
    id: string
    expectedContentHash: string | null
    value: unknown
  }) => Promise<{ written: boolean; currentContentHash: string | null }>
  list: (request: { namespace: string }) => Promise<{
    rows: Array<{ id: string | number; data: unknown }>
  }>
}

export type DesignGraphRepository = ReturnType<typeof createDesignGraphRepository>

const safePath = (value: string, label: string): string => {
  const normalized = value.trim().replace(/^\/+|\/+$/g, '')
  if (
    !normalized ||
    normalized.includes('\\') ||
    normalized
      .split('/')
      .some((segment) => !/^[a-zA-Z0-9._-]+$/.test(segment) || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must contain safe path segments.`)
  }
  return normalized
}

const missingObject = (path: string) => new Error(`Design graph object not found: ${path}`)

export const createStorageDesignGraphObjectStore = (
  storage: DesignGraphStorageClient,
  namespace = 'design-graph/authoring-v1',
): DesignGraphObjectStore => {
  const cache = new Map<string, string>()
  const isImmutablePath = (id: string) => !id.startsWith('refs/') && !id.startsWith('inputs/')
  const readStoredText = (id: string, value: unknown) => {
    if (typeof value !== 'string') throw new Error(`Design graph object is not text: ${id}`)
    if (isImmutablePath(id)) cache.set(id, value)
    return value
  }
  const readMany = async (ids: string[]) => {
    if (storage.getMany) return await storage.getMany({ namespace, ids })
    const rows = await Promise.all(
      ids.map(async (id) => ({ id, data: (await storage.get({ namespace, id })).value })),
    )
    return { rows }
  }
  const writeMany = async (rows: { id: string; data: string }[]) => {
    if (storage.setMany) {
      await storage.setMany({ namespace, rows })
      return
    }
    await Promise.all(rows.map(({ id, data }) => storage.set({ namespace, id, value: data })))
  }
  return {
    readText: async (path) => {
      const id = safePath(path, 'Repository path')
      const cached = cache.get(id)
      if (cached !== undefined) return cached
      const value = (await storage.get({ namespace, id })).value
      if (value === null || value === undefined) throw missingObject(id)
      return readStoredText(id, value)
    },
    readManyText: async (paths) => {
      const ids = paths.map((path) => safePath(path, 'Repository path'))
      const values = new Map<string, string | null>()
      const missing = ids.filter((id) => {
        const cached = cache.get(id)
        if (cached === undefined) return true
        values.set(id, cached)
        return false
      })
      if (missing.length === 0) return values
      const rows = await readMany(missing)
      const byId = new Map(rows.rows.map((row) => [String(row.id), row.data]))
      for (const id of missing) {
        const value = byId.get(id)
        values.set(id, value === undefined ? null : readStoredText(id, value))
      }
      return values
    },
    writeText: async (path, content) => {
      const id = safePath(path, 'Repository path')
      await storage.set({
        namespace,
        id,
        value: content,
      })
      if (isImmutablePath(id)) cache.set(id, content)
    },
    writeManyText: async (files) => {
      const rows = files.map(({ path, content }) => ({
        id: safePath(path, 'Repository path'),
        data: content,
      }))
      await writeMany(rows)
      for (const row of rows) {
        if (isImmutablePath(row.id)) cache.set(row.id, row.data)
      }
    },
    writeTextIfUnchanged: async (path, expectedContentHash, content) => {
      const id = safePath(path, 'Repository path')
      const result = await storage.setIfUnchanged({
        namespace,
        id,
        expectedContentHash,
        value: content,
      })
      if (result.written && isImmutablePath(id)) cache.set(id, content)
      return result
    },
    list: async (directory) => {
      const prefix = `${safePath(directory, 'Repository directory')}/`
      const rows = await storage.list({ namespace })
      for (const row of rows.rows) readStoredText(String(row.id), row.data)
      return rows.rows
        .map((row) => String(row.id))
        .filter((id) => id.startsWith(prefix))
        .map((id) => id.slice(prefix.length))
        .sort()
    },
  }
}

const hashFilePart = (id: Hash) => id.replace(':', '_')
const objectPath = (kind: string, id: Hash) => `${kind}/${hashFilePart(id)}.json`
const jsonText = (value: unknown) => `${canonicalJson(value, 2)}\n`

const readJson = async (store: DesignGraphObjectStore, path: string): Promise<unknown> => {
  try {
    return JSON.parse(await store.readText(path)) as unknown
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error(`Invalid repository JSON: ${path}`, { cause: error })
    throw error
  }
}

const readOptionalJson = async (store: DesignGraphObjectStore, path: string): Promise<unknown> => {
  try {
    return await readJson(store, path)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Design graph object not found:')) {
      return null
    }
    throw error
  }
}

/** Content-addressed source and application bytes cannot be replaced by a later publication. */
export const putImmutableDesignGraphText = async (
  store: DesignGraphObjectStore,
  path: string,
  content: string,
) => {
  const result = await store.writeTextIfUnchanged(path, null, content)
  if (result.written) return
  if (result.currentContentHash !== canonicalHash(content))
    throw new Error(`Immutable design graph object collision: ${path}`)
}

export const putImmutableDesignGraphObject = async (
  store: DesignGraphObjectStore,
  path: string,
  value: unknown,
): Promise<void> => {
  const content = jsonText(value)
  const result = await store.writeTextIfUnchanged(path, null, content)
  if (result.written) return
  if (result.currentContentHash === null) {
    throw new Error(`Immutable design graph object disappeared while writing: ${path}`)
  }
  const currentText = await store.readText(path)
  let existing: unknown
  try {
    existing = JSON.parse(currentText) as unknown
  } catch (error) {
    throw new Error(`Invalid repository JSON: ${path}`, { cause: error })
  }
  if (canonicalJson(existing) !== canonicalJson(value)) {
    throw new Error(`Immutable design graph object collision: ${path}`)
  }
}

export const normalizeRefName = (name: string, prefix: 'graph/' | 'projects/') => {
  const normalized = safePath(name, 'Ref name')
  if (!normalized.startsWith(prefix)) {
    throw new Error(`Ref ${normalized} must start with ${prefix}.`)
  }
  return normalized
}

export const createDesignGraphRepository = (store: DesignGraphObjectStore) => {
  const putModule = async (artifact: DagModuleArtifact) => {
    const parsed = parseDagModuleArtifact(artifact)
    await putImmutableDesignGraphObject(store, objectPath('modules', parsed.id), parsed)
    return parsed.id
  }
  const getModule = async (id: Hash) =>
    parseDagModuleArtifact(await readJson(store, objectPath('modules', id)))

  const putModuleLock = async (record: DagModuleLock) => {
    const parsed = parseDagModuleLock(record)
    await Promise.all(getDagModuleLockModuleIds(parsed).map(getModule))
    await putImmutableDesignGraphObject(store, objectPath('module-locks', parsed.id), parsed)
    return parsed.id
  }
  const getModuleLock = async (id: Hash) =>
    parseDagModuleLock(await readJson(store, objectPath('module-locks', id)))

  const putGraphRevision = async (record: GraphRevision) => {
    const parsed = parseGraphRevision(record)
    await putImmutableDesignGraphObject(store, objectPath('graph-revisions', parsed.id), parsed)
    return parsed.id
  }
  const getGraphRevision = async (id: Hash) =>
    parseGraphRevision(await readJson(store, objectPath('graph-revisions', id)))

  const putInvocation = async (record: InvocationDefinition) => {
    const parsed = parseInvocationDefinition(record)
    await putImmutableDesignGraphObject(store, objectPath('invocations', parsed.id), parsed)
    return parsed.id
  }
  const getInvocation = async (id: Hash) =>
    parseInvocationDefinition(await readJson(store, objectPath('invocations', id)))

  const putProjectRevision = async (record: ProjectRevision) => {
    const parsed = parseProjectRevision(record)
    await Promise.all(parsed.parents.map(getProjectRevision))
    await Promise.all(Object.values(parsed.invocations).map(getInvocation))
    await Promise.all(Object.values(parsed.extensions).map(getExtension))
    await putImmutableDesignGraphObject(store, objectPath('project-revisions', parsed.id), parsed)
    return parsed.id
  }
  const getProjectRevision = async (id: Hash): Promise<ProjectRevision> =>
    parseProjectRevision(await readJson(store, objectPath('project-revisions', id)))

  const putExtension = async (record: ProjectExtension) => {
    const parsed = parseProjectExtension(record)
    await putImmutableDesignGraphObject(store, objectPath('extensions', parsed.id), parsed)
    return parsed.id
  }
  const getExtension = async (id: Hash) =>
    parseProjectExtension(await readJson(store, objectPath('extensions', id)))

  const putRun = async (record: InvocationRun) => {
    const parsed = parseInvocationRun(record)
    await getInvocation(parsed.invocationId)
    await putImmutableDesignGraphObject(
      store,
      `runs/${hashFilePart(parsed.invocationId)}/${hashFilePart(parsed.id)}.json`,
      parsed,
    )
    return parsed.id
  }
  const getRun = async (invocationId: Hash, runId: Hash) =>
    parseInvocationRun(
      await readJson(store, `runs/${hashFilePart(invocationId)}/${hashFilePart(runId)}.json`),
    )
  const listRuns = async (invocationId?: Hash) => {
    const directory = invocationId ? `runs/${hashFilePart(invocationId)}` : 'runs'
    const names = await store.list(directory)
    return await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => parseInvocationRun(await readJson(store, `${directory}/${name}`))),
    )
  }

  const putAttempt = async (record: ExecutionAttempt) => {
    const parsed = parseExecutionAttempt(record)
    await getInvocation(parsed.invocationId)
    await store.writeText(
      `attempts/${safePath(parsed.attemptId, 'Attempt id')}.json`,
      jsonText(parsed),
    )
  }
  const getAttempt = async (attemptId: string) => {
    const value = await readOptionalJson(
      store,
      `attempts/${safePath(attemptId, 'Attempt id')}.json`,
    )
    return value === null ? null : parseExecutionAttempt(value)
  }

  const visualizationDirectory = (scope: string, outputSchemaId: Hash) =>
    `visualizations/${safePath(scope, 'Visualization scope')}/${hashFilePart(outputSchemaId)}`

  const putVisualization = async (args: {
    scope: string
    outputSchemaId: Hash
    visualizationId: Hash
    html: string
  }) => {
    const record = parseDesignVisualization({
      schemaVersion: 1,
      visualizationId: args.visualizationId,
      html: args.html,
    })
    const directory = visualizationDirectory(args.scope, args.outputSchemaId)
    await putImmutableDesignGraphObject(
      store,
      `${directory}/${hashFilePart(record.visualizationId)}.json`,
      record,
    )
    const active: ActiveDesignVisualization = {
      schemaVersion: 1,
      visualizationId: record.visualizationId,
    }
    await store.writeText(`${directory}/active.json`, jsonText(active))
  }

  const getVisualization = async (args: { scope: string; outputSchemaId: Hash }) => {
    const directory = visualizationDirectory(args.scope, args.outputSchemaId)
    const active = await readOptionalJson(store, `${directory}/active.json`)
    if (active === null) return null
    const parsedActive = parseActiveDesignVisualization(active)
    const value = await readOptionalJson(
      store,
      `${directory}/${hashFilePart(parsedActive.visualizationId)}.json`,
    )
    return value === null ? null : parseDesignVisualization(value)
  }

  const getRef = async (name: string): Promise<DesignGraphRef | null> => {
    const value = await readOptionalJson(store, `refs/${safePath(name, 'Ref name')}.json`)
    return value === null ? null : parseDesignGraphRef(value)
  }
  const advanceRef = async (args: {
    name: string
    revisionId: Hash
    expected: Hash | null
    validate: (id: Hash) => Promise<unknown>
  }) => {
    await args.validate(args.revisionId)
    const next: DesignGraphRef = { schemaVersion: 2, revisionId: args.revisionId }
    const path = `refs/${safePath(args.name, 'Ref name')}.json`
    let currentText: string | null
    try {
      currentText = await store.readText(path)
    } catch (error) {
      if (!(error instanceof Error && error.message.startsWith('Design graph object not found:')))
        throw error
      currentText = null
    }
    const current = currentText === null ? null : parseDesignGraphRef(JSON.parse(currentText))
    if ((current?.revisionId ?? null) !== args.expected)
      throw new Error(`Design graph ref conflict for ${args.name}: reload before saving.`)
    const expectedContentHash = currentText === null ? null : canonicalHash(currentText)
    const result = await store.writeTextIfUnchanged(path, expectedContentHash, jsonText(next))
    if (!result.written) {
      const current = result.currentContentHash === null ? null : await getRef(args.name)
      throw new Error(
        `Design graph ref conflict for ${args.name}: expected ${String(args.expected)}, found ${String(current?.revisionId ?? null)}.`,
      )
    }
    return next
  }
  const advanceGraphRef = async (args: { name: string; revisionId: Hash; expected: Hash | null }) =>
    await advanceRef({
      ...args,
      name: normalizeRefName(args.name, 'graph/'),
      validate: getGraphRevision,
    })
  const advanceProjectRef = async (args: {
    name: string
    revisionId: Hash
    expected: Hash | null
  }) =>
    await advanceRef({
      ...args,
      name: normalizeRefName(args.name, 'projects/'),
      validate: getProjectRevision,
    })
  const getGraphRef = async (name: string) => await getRef(normalizeRefName(name, 'graph/'))
  const getProjectRef = async (name: string) => await getRef(normalizeRefName(name, 'projects/'))
  const listRefs = async (prefix: 'graph' | 'projects') => {
    const names = await store.list(`refs/${prefix}`)
    const entries = await Promise.all(
      names
        .filter((name) => name.endsWith('.json'))
        .map(async (name) => {
          const refName = `${prefix}/${name.slice(0, -5)}`
          const ref = await getRef(refName)
          return ref ? ([refName, ref.revisionId] as const) : null
        }),
    )
    return Object.fromEntries(entries.filter((entry) => entry !== null))
  }

  return {
    store,
    putModule,
    getModule,
    putModuleLock,
    getModuleLock,
    putGraphRevision,
    getGraphRevision,
    putInvocation,
    getInvocation,
    putProjectRevision,
    getProjectRevision,
    putExtension,
    getExtension,
    putRun,
    getRun,
    listRuns,
    putAttempt,
    getAttempt,
    putVisualization,
    getVisualization,
    advanceGraphRef,
    advanceProjectRef,
    getGraphRef,
    getProjectRef,
    listRefs,
  }
}
