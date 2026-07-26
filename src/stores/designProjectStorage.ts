import {
  createDesignProjectRepository,
  type DesignProjectObjectStore,
} from '@taskyon/comp-dag/designProjectRepository'
import type { createStorageClient } from '@taskyon/taskyon'

type TaskyonStorageClient = ReturnType<typeof createStorageClient>

export type DesignProjectCatalogEntry = {
  projectId: string
  title: string
  refName: string
  lastOpenedAtMs: number
}

const catalogNamespace = 'design-projects/catalog'

const parseCatalogEntry = (value: unknown): DesignProjectCatalogEntry | null => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('projectId' in value) ||
    typeof value.projectId !== 'string' ||
    !('title' in value) ||
    typeof value.title !== 'string' ||
    !('refName' in value) ||
    typeof value.refName !== 'string' ||
    !('lastOpenedAtMs' in value) ||
    typeof value.lastOpenedAtMs !== 'number'
  ) {
    return null
  }
  return {
    projectId: value.projectId,
    title: value.title,
    refName: value.refName,
    lastOpenedAtMs: value.lastOpenedAtMs,
  }
}

const createProjectObjectStore = (
  storageClient: TaskyonStorageClient,
  projectId: string,
): DesignProjectObjectStore => {
  const namespace = `design-graphs/${encodeURIComponent(projectId)}`
  return {
    read: async (path) => (await storageClient.get({ namespace, id: path })).value,
    write: async (path, value) => {
      await storageClient.set({ namespace, id: path, value })
    },
    list: async (directory) =>
      (await storageClient.list({ namespace })).rows
        .map((row) => String(row.id))
        .filter((id) => id.startsWith(`${directory}/`))
        .map((id) => id.slice(directory.length + 1))
        .filter((id) => !id.includes('/')),
  }
}

export const createDesignProjectStorage = (storageClient: TaskyonStorageClient) => ({
  designProjectStore: (projectId: string) => {
    const objects = createProjectObjectStore(storageClient, projectId)
    return { objects, repository: createDesignProjectRepository(objects) }
  },
  registerDesignProject: async (entry: Omit<DesignProjectCatalogEntry, 'lastOpenedAtMs'>) => {
    const value: DesignProjectCatalogEntry = { ...entry, lastOpenedAtMs: Date.now() }
    await storageClient.set({
      namespace: catalogNamespace,
      id: entry.projectId,
      value,
    })
    return value
  },
  listDesignProjects: async (): Promise<DesignProjectCatalogEntry[]> =>
    (await storageClient.list({ namespace: catalogNamespace })).rows.flatMap((row) => {
      const entry = parseCatalogEntry(row.data)
      return entry ? [entry] : []
    }),
})
