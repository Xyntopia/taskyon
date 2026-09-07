import { TaskNodeRecord } from '../types/taskNode'
import { createTaskRecordHydrator } from '../utils/taskRecords'
import type { TaskyonStorageClient } from './storageProtocol'

export const taskStorageTables = [
  'taskyonNodes',
  'taskyonContents',
  'metaDb',
  'toolRegistry',
  'toolSettings',
] as const

export const taskManagerStorageNamespace = (
  sessionId: string,
  table: (typeof taskStorageTables)[number],
) => `${sessionId}/${table}`

/** Read-only domain access; the supplied StorageClient retains codec and provider ownership. */
export const createTaskRecordReader = (
  storage: Pick<TaskyonStorageClient, 'get' | 'getMany' | 'find'>,
  sessionId: string,
) => {
  const nodes = taskManagerStorageNamespace(sessionId, 'taskyonNodes')
  const contents = taskManagerStorageNamespace(sessionId, 'taskyonContents')
  const { hydrate } = createTaskRecordHydrator(
    async (id) => (await storage.get({ namespace: contents, id })).value,
    0,
  )
  return {
    get: async ({ id }: { id: string }) => {
      const { value } = await storage.get({ namespace: nodes, id })
      if (value === null) return null
      const record = TaskNodeRecord.parse(value)
      if (record.id !== id) throw new Error('Stored task id mismatch.')
      return hydrate(record)
    },
    getMany: async ({ ids }: { ids: string[] }) => {
      const { rows } = await storage.getMany({ namespace: nodes, ids })
      return Promise.all(
        rows.map(({ id, data }) => {
          const record = TaskNodeRecord.parse(data)
          if (record.id !== id) throw new Error('Stored task id mismatch.')
          return hydrate(record)
        }),
      )
    },
    readRecords: async (
      request:
        | { mode: 'ids'; ids: string[] }
        | { mode: 'children'; parentID: string; after?: string },
    ) => {
      const values =
        request.mode === 'ids'
          ? (await storage.getMany({ namespace: nodes, ids: request.ids })).rows.map(
              (row) => row.data,
            )
          : Object.values(
              (await storage.find({ namespace: nodes, query: { parentID: request.parentID } }))
                .values,
            )
      return { records: values.map((value) => TaskNodeRecord.parse(value)), next: null }
    },
  }
}
