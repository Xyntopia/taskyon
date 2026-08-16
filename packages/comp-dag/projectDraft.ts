import { canonicalHash, type Hash } from './caching.ts'
import { createProjectRevision, type ProjectRevision } from './designGraphModel.ts'
import type { DesignGraphRepository } from './designGraphRepository.ts'

export type ProjectDraftSnapshot = Pick<
  ProjectRevision,
  'displayName' | 'invocations' | 'extensions'
>

export type ProjectWorkingDraft = {
  schemaVersion: 1
  projectRef: string
  baseRevisionId: Hash | null
  snapshots: ProjectDraftSnapshot[]
  cursor: number
}

export type ProjectDraftState = ProjectWorkingDraft & {
  current: ProjectDraftSnapshot
}

type ProjectDraftStorage = {
  get: (request: { namespace: string; id: string }) => Promise<{ value: unknown }>
  set: (request: { namespace: string; id: string; value: unknown }) => Promise<unknown>
  list: (request: { namespace: string }) => Promise<{
    rows: Array<{ id: string | number; data: unknown }>
  }>
}

const namespace = 'design-graph/project-drafts/v1'
const hashPattern = /^sha256:[A-Za-z0-9_-]{43}$/

const validateProjectRef = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^projects\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/.test(value)
  ) {
    throw new Error('Project draft ref must be a safe projects/ ref.')
  }
  return value
}

const validateHash = (value: unknown): Hash => {
  if (typeof value !== 'string' || !hashPattern.test(value)) {
    throw new Error('Project draft base revision must be a canonical sha256 hash.')
  }
  return value as Hash
}

const validateHashMap = (value: unknown, label: string): Record<string, Hash> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, validateHash(item)]))
}

const validateSnapshot = (value: unknown): ProjectDraftSnapshot => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Project draft snapshot must be an object.')
  }
  const snapshot = value as Partial<ProjectDraftSnapshot>
  if (typeof snapshot.displayName !== 'string' || snapshot.displayName.trim().length === 0) {
    throw new Error('Project draft display name must be a non-empty string.')
  }
  return {
    displayName: snapshot.displayName,
    invocations: validateHashMap(snapshot.invocations, 'Project draft invocations'),
    extensions: validateHashMap(snapshot.extensions, 'Project draft extensions'),
  }
}

const parseDraft = (value: unknown): ProjectWorkingDraft => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Project draft must be an object.')
  }
  const draft = value as Partial<ProjectWorkingDraft>
  if (
    draft.schemaVersion !== 1 ||
    !Array.isArray(draft.snapshots) ||
    draft.snapshots.length === 0 ||
    !Number.isInteger(draft.cursor) ||
    draft.cursor === undefined ||
    draft.cursor < 0 ||
    draft.cursor >= draft.snapshots.length
  ) {
    throw new Error('Unsupported project draft.')
  }
  return {
    schemaVersion: 1,
    projectRef: validateProjectRef(draft.projectRef),
    baseRevisionId: draft.baseRevisionId === null ? null : validateHash(draft.baseRevisionId),
    snapshots: draft.snapshots.map(validateSnapshot),
    cursor: draft.cursor,
  }
}

const state = (draft: ProjectWorkingDraft): ProjectDraftState => ({
  ...draft,
  current: draft.snapshots[draft.cursor]!,
})

const snapshotFromRevision = (revision: ProjectRevision): ProjectDraftSnapshot => ({
  displayName: revision.displayName,
  invocations: { ...revision.invocations },
  extensions: { ...revision.extensions },
})

export const createProjectDraftStore = (storage: ProjectDraftStorage, maxSnapshots = 200) => {
  if (!Number.isInteger(maxSnapshots) || maxSnapshots < 1) {
    throw new Error('Project draft history limit must be a positive integer.')
  }

  const write = async (draft: ProjectWorkingDraft) => {
    const parsed = parseDraft(draft)
    await storage.set({ namespace, id: parsed.projectRef, value: parsed })
    return state(parsed)
  }

  const load = async (projectRef: string): Promise<ProjectDraftState | null> => {
    const ref = validateProjectRef(projectRef)
    const value = (await storage.get({ namespace, id: ref })).value
    return value === null || value === undefined ? null : state(parseDraft(value))
  }

  const list = async () =>
    (await storage.list({ namespace })).rows
      .map(({ data }) => state(parseDraft(data)))
      .sort((left, right) => left.projectRef.localeCompare(right.projectRef))

  const requireDraft = async (projectRef: string) => {
    const draft = await load(projectRef)
    if (!draft) throw new Error(`Project draft not found: ${projectRef}`)
    return draft
  }

  const create = (projectRef: string, revision: ProjectRevision) =>
    write({
      schemaVersion: 1,
      projectRef: validateProjectRef(projectRef),
      baseRevisionId: revision.id,
      snapshots: [snapshotFromRevision(revision)],
      cursor: 0,
    })

  const createNew = (projectRef: string, snapshot: ProjectDraftSnapshot) =>
    write({
      schemaVersion: 1,
      projectRef: validateProjectRef(projectRef),
      baseRevisionId: null,
      snapshots: [validateSnapshot(snapshot)],
      cursor: 0,
    })

  const update = async (
    projectRef: string,
    transform: (current: ProjectDraftSnapshot) => ProjectDraftSnapshot,
  ) => {
    const draft = await requireDraft(projectRef)
    const next = validateSnapshot(transform(draft.current))
    if (canonicalHash(next) === canonicalHash(draft.current)) return draft
    const snapshots = [...draft.snapshots.slice(0, draft.cursor + 1), next].slice(-maxSnapshots)
    return await write({ ...draft, snapshots, cursor: snapshots.length - 1 })
  }

  const move = async (projectRef: string, offset: -1 | 1) => {
    const draft = await requireDraft(projectRef)
    const cursor = Math.min(Math.max(draft.cursor + offset, 0), draft.snapshots.length - 1)
    return cursor === draft.cursor ? draft : await write({ ...draft, cursor })
  }

  const save = async (projectRef: string, repository: DesignGraphRepository) => {
    const draft = await requireDraft(projectRef)
    const revision = createProjectRevision({
      parents: draft.baseRevisionId === null ? [] : [draft.baseRevisionId],
      ...draft.current,
    })
    await repository.putProjectRevision(revision)
    await repository.advanceProjectRef({
      name: draft.projectRef,
      revisionId: revision.id,
      expected: draft.baseRevisionId,
    })
    await write({
      schemaVersion: 1,
      projectRef: draft.projectRef,
      baseRevisionId: revision.id,
      snapshots: [snapshotFromRevision(revision)],
      cursor: 0,
    })
    return revision
  }

  return {
    list,
    load,
    create,
    createNew,
    update,
    undo: (projectRef: string) => move(projectRef, -1),
    redo: (projectRef: string) => move(projectRef, 1),
    save,
  }
}
