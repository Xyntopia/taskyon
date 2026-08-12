import {
  createDesignGraphRepository,
  createStorageDesignGraphObjectStore,
} from '@taskyon/comp-dag/designGraphRepository'
import type { createStorageClient } from '@taskyon/taskyon'

type TaskyonStorageClient = ReturnType<typeof createStorageClient>

export type DesignProjectCatalogEntry = {
  projectId: string
  title: string
  refName: string
  lastOpenedAtMs: number
}

const projectIdFromRef = (refName: string) => refName.slice('projects/'.length)

export const createDesignProjectStorage = (storageClient: TaskyonStorageClient) => {
  const objects = createStorageDesignGraphObjectStore(storageClient)
  const repository = createDesignGraphRepository(objects)
  const recentNamespace = 'taskyon/ui-state/v1/design-projects'
  return {
    designProjectStore: (projectId: string) => ({
      objects,
      repository,
      refName: (name: string) =>
        name === 'main'
          ? `projects/${encodeURIComponent(projectId)}`
          : `projects/${encodeURIComponent(projectId)}/branches/${name}`,
    }),
    registerDesignProject: async (entry: Omit<DesignProjectCatalogEntry, 'lastOpenedAtMs'>) => {
      const ref = await repository.getProjectRef(entry.refName)
      if (!ref) throw new Error(`Project ref not found: ${entry.refName}`)
      const revision = await repository.getProjectRevision(ref.revisionId)
      if (revision.displayName !== entry.title) {
        throw new Error('Project catalog titles must come from the immutable project revision.')
      }
      const lastOpenedAtMs = Date.now()
      await storageClient.set({
        namespace: recentNamespace,
        id: entry.refName,
        value: { lastOpenedAtMs },
      })
      return { ...entry, lastOpenedAtMs }
    },
    listDesignProjects: async (): Promise<DesignProjectCatalogEntry[]> => {
      const refs = await repository.listRefs('projects')
      const recent = await storageClient.list({ namespace: recentNamespace })
      const recentByRef = new Map(
        recent.rows.map((row) => {
          const value = row.data
          const lastOpenedAtMs =
            typeof value === 'object' &&
            value !== null &&
            'lastOpenedAtMs' in value &&
            typeof value.lastOpenedAtMs === 'number'
              ? value.lastOpenedAtMs
              : 0
          return [String(row.id), lastOpenedAtMs]
        }),
      )
      const projects = await Promise.all(
        Object.entries(refs).map(async ([refName, revisionId]) => {
          const revision = await repository.getProjectRevision(revisionId)
          return {
            projectId: projectIdFromRef(refName),
            title: revision.displayName,
            refName,
            lastOpenedAtMs: recentByRef.get(refName) ?? 0,
          }
        }),
      )
      return projects.sort((left, right) => right.lastOpenedAtMs - left.lastOpenedAtMs)
    },
  }
}
