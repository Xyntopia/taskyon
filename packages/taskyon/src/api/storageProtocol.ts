import {
  createPortClient,
  createPortServer,
  defineFrpServiceProtocol,
  type Port,
  type ProtocolMessage,
} from '@taskyon/common/modules/frpBus'
import { z } from 'zod'
import type { PartialDeep } from 'type-fest'
import type { CrudWrapper } from '../utils/crudWrapper'

const storageId = z.union([z.string(), z.number()])
const storageNamespace = z.string().min(1)
const storageValue = z.unknown()
const storageRow = z.object({
  id: storageId,
  data: storageValue,
})

export const taskyonStorageProtocol = defineFrpServiceProtocol({
  service: 'storage.records',
  version: '1',
  commands: {
    get: {
      request: z.object({
        namespace: storageNamespace,
        id: storageId,
      }),
      response: z.object({
        value: storageValue.nullable(),
      }),
    },
    set: {
      request: z.object({
        namespace: storageNamespace,
        id: storageId,
        value: storageValue,
      }),
    },
    upsert: {
      request: z.object({
        namespace: storageNamespace,
        id: storageId,
        value: storageValue,
        strategy: z.enum(['shallow_merge', 'replace', 'deepmerge', 'native_shallow']).optional(),
      }),
      response: z.object({
        value: storageValue,
      }),
    },
    delete: {
      request: z.object({
        namespace: storageNamespace,
        id: storageId,
      }),
    },
    list: {
      request: z.object({
        namespace: storageNamespace,
      }),
      response: z.object({
        rows: z.array(storageRow),
      }),
    },
    listIds: {
      request: z.object({
        namespace: storageNamespace,
      }),
      response: z.object({
        ids: z.array(storageId),
      }),
    },
    find: {
      request: z.object({
        namespace: storageNamespace,
        query: storageValue.optional(),
      }),
      response: z.object({
        values: z.record(z.string(), storageValue),
      }),
    },
    clear: {
      request: z.object({
        namespace: storageNamespace,
      }),
    },
  },
})

export type TaskyonStorageMessage = ProtocolMessage<typeof taskyonStorageProtocol>

export const createStorageClient = (port: Port<TaskyonStorageMessage, TaskyonStorageMessage>) =>
  createPortClient(port, taskyonStorageProtocol).storage.records

export type StorageRecordCrud<T> = CrudWrapper<T> & {
  find: (where: PartialDeep<T>) => Promise<Record<string, T>>
}

export type StorageRecordBackend = {
  get: (id: string | number) => Promise<unknown>
  set: (id: string | number, value: unknown) => Promise<void>
  upsert: (
    id: string | number,
    value: unknown,
    strategy?: 'shallow_merge' | 'replace' | 'deepmerge' | 'native_shallow',
  ) => Promise<unknown>
  delete: (id: string | number) => Promise<void>
  list: () => Promise<{ id: string | number; data: unknown }[]>
  listIds: () => Promise<(string | number)[]>
  find: (query: unknown) => Promise<Record<string, unknown>>
  clear: () => Promise<void>
}

export const createStorageRecordBackend = <T>(
  crud: StorageRecordCrud<T>,
  schema: z.ZodType<T>,
): StorageRecordBackend => {
  const parseValue = (value: unknown) => schema.parse(value)
  return {
    get: crud.get,
    set: async (id, value) => crud.set(id, parseValue(value)),
    upsert: async (id, value, strategy) => crud.upsert(id, parseValue(value), strategy),
    delete: crud.delete,
    list: crud.list,
    listIds: crud.listIds,
    find: async (query) => crud.find(query as PartialDeep<T>),
    clear: crud.clear,
  }
}

export const createStorageProtocolServer = (
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  resolveBackend: (namespace: string) => Promise<StorageRecordBackend> | StorageRecordBackend,
) =>
  createPortServer(port, taskyonStorageProtocol, {
    storage: {
      records: {
        get: async ({ namespace, id }) => ({
          value: await (await resolveBackend(namespace)).get(id),
        }),
        set: async ({ namespace, id, value }) => {
          await (await resolveBackend(namespace)).set(id, value)
        },
        upsert: async ({ namespace, id, value, strategy }) => ({
          value: await (await resolveBackend(namespace)).upsert(id, value, strategy),
        }),
        delete: async ({ namespace, id }) => {
          await (await resolveBackend(namespace)).delete(id)
        },
        list: async ({ namespace }) => ({
          rows: await (await resolveBackend(namespace)).list(),
        }),
        listIds: async ({ namespace }) => ({
          ids: await (await resolveBackend(namespace)).listIds(),
        }),
        find: async ({ namespace, query }) => ({
          values: await (await resolveBackend(namespace)).find(query),
        }),
        clear: async ({ namespace }) => {
          await (await resolveBackend(namespace)).clear()
        },
      },
    },
  })

export const createProtocolStorageCrudWrapper = <T>(
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  namespace: string,
  schema: z.ZodType<T>,
): StorageRecordCrud<T> => {
  const client = createPortClient(port, taskyonStorageProtocol)
  const parseValue = (value: unknown) => schema.parse(value)
  const parseRecord = (values: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(values).map(([id, value]) => [id, parseValue(value)]))

  return {
    get: async (id) => {
      const { value } = await client.storage.records.get({ namespace, id })
      return value === null ? null : parseValue(value)
    },
    set: async (id, value) => {
      await client.storage.records.set({ namespace, id, value })
    },
    upsert: async (id, value, strategy) => {
      const result = await client.storage.records.upsert({ namespace, id, value, strategy })
      return parseValue(result.value)
    },
    delete: async (id) => {
      await client.storage.records.delete({ namespace, id })
    },
    list: async () => {
      const { rows } = await client.storage.records.list({ namespace })
      return rows.map((row) => ({ id: row.id, data: parseValue(row.data) }))
    },
    listAll: async () => {
      const { rows } = await client.storage.records.list({ namespace })
      return rows.map((row) => ({ id: row.id, data: parseValue(row.data) }))
    },
    listIds: async () => {
      const { ids } = await client.storage.records.listIds({ namespace })
      return ids
    },
    find: async (where) => {
      const { values } = await client.storage.records.find({ namespace, query: where })
      return parseRecord(values)
    },
    clear: async () => {
      await client.storage.records.clear({ namespace })
    },
  }
}
