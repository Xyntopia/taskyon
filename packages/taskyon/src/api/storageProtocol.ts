import {
  createPortClient,
  createPortServer,
  defineFrpServiceProtocol,
  mergeFrpProtocols,
  type Port,
  type ProtocolMessage,
} from '@taskyon/common/modules/frpBus'
import { z } from 'zod'
import type { PartialDeep } from 'type-fest'
import type { CrudWrapper } from '../utils/crudWrapper'

const storageId = z.union([z.string(), z.number()])
const storageNamespace = z.string().min(1)
const storageValue = z.unknown()
const blobId = z
  .string()
  .min(1)
  .max(180)
  .regex(/^[A-Za-z0-9._~-]+$/, 'Blob ids must be filesystem-safe opaque identifiers.')
const storageRow = z.object({
  id: storageId,
  data: storageValue,
})

const taskyonStorageRecordProtocol = defineFrpServiceProtocol({
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
    getMany: {
      request: z.object({
        namespace: storageNamespace,
        ids: z.array(storageId),
      }),
      response: z.object({
        rows: z.array(storageRow),
      }),
    },
    set: {
      request: z.object({
        namespace: storageNamespace,
        id: storageId,
        value: storageValue,
      }),
    },
    setMany: {
      request: z.object({
        namespace: storageNamespace,
        rows: z.array(storageRow),
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

const blobBytes = z.instanceof(Uint8Array<ArrayBuffer>) as z.ZodType<Uint8Array<ArrayBuffer>>
const blobChunk = blobBytes.refine((data) => data.byteLength <= 1024 * 1024, {
  message: 'Blob chunks must not exceed 1 MiB.',
})
const blobMetadata = z.object({
  id: blobId,
  size: z.number().int().nonnegative(),
  contentType: z.string().optional(),
  modifiedAt: z.string(),
  sha256: z.string().optional(),
})

const taskyonStorageBlobProtocol = defineFrpServiceProtocol({
  service: 'storage.blobs',
  version: '1',
  commands: {
    get: {
      request: z.object({ namespace: storageNamespace, id: blobId }),
      response: z.object({ data: blobBytes, metadata: blobMetadata }).nullable(),
    },
    set: {
      request: z.object({
        namespace: storageNamespace,
        id: blobId,
        data: blobBytes,
        contentType: z.string().optional(),
      }),
      response: blobMetadata,
    },
    stat: {
      request: z.object({ namespace: storageNamespace, id: blobId }),
      response: blobMetadata.nullable(),
    },
    list: {
      request: z.object({ namespace: storageNamespace }),
      response: z.object({ blobs: z.array(blobMetadata) }),
    },
    readRange: {
      request: z.object({
        namespace: storageNamespace,
        id: blobId,
        offset: z.number().int().nonnegative(),
        length: z
          .number()
          .int()
          .positive()
          .max(1024 * 1024),
      }),
      response: z.object({
        data: blobBytes,
        nextOffset: z.number().int().nonnegative(),
        eof: z.boolean(),
      }),
    },
    append: {
      request: z.object({
        namespace: storageNamespace,
        id: blobId,
        data: blobChunk,
        expectedSize: z.number().int().nonnegative(),
        contentType: z.string().optional(),
      }),
      response: blobMetadata,
    },
    beginWrite: {
      request: z.object({
        namespace: storageNamespace,
        id: blobId,
        contentType: z.string().optional(),
      }),
      response: z.object({ writeId: z.string() }),
    },
    writeChunk: {
      request: z.object({
        namespace: storageNamespace,
        id: blobId,
        writeId: z.string(),
        offset: z.number().int().nonnegative(),
        data: blobChunk,
      }),
      response: z.object({ nextOffset: z.number().int().nonnegative() }),
    },
    writeStatus: {
      request: z.object({ namespace: storageNamespace, id: blobId, writeId: z.string() }),
      response: z.object({ size: z.number().int().nonnegative() }),
    },
    commitWrite: {
      request: z.object({
        namespace: storageNamespace,
        id: blobId,
        writeId: z.string(),
        expectedSize: z.number().int().nonnegative(),
        expectedSha256: z.string().optional(),
      }),
      response: blobMetadata,
    },
    abortWrite: {
      request: z.object({ namespace: storageNamespace, id: blobId, writeId: z.string() }),
    },
    delete: {
      request: z.object({ namespace: storageNamespace, id: blobId }),
    },
    clear: {
      request: z.object({ namespace: storageNamespace }),
    },
  },
})

export const taskyonStorageProtocol = mergeFrpProtocols({
  id: 'taskyon.storage',
  version: '1',
  base: taskyonStorageRecordProtocol,
  extension: taskyonStorageBlobProtocol,
})

export type TaskyonStorageMessage = ProtocolMessage<typeof taskyonStorageProtocol>

export const createStorageClient = (port: Port<TaskyonStorageMessage, TaskyonStorageMessage>) => {
  const storage = createPortClient(port, taskyonStorageProtocol).storage
  function get(request: {
    namespace: string
    id: string | number
    mode?: 'record'
  }): ReturnType<typeof storage.records.get>
  function get(request: {
    namespace: string
    id: string
    mode: 'blob'
  }): ReturnType<typeof storage.blobs.get>
  function get(
    request:
      | { namespace: string; id: string | number; mode?: 'record' }
      | { namespace: string; id: string; mode: 'blob' },
  ) {
    return request.mode === 'blob'
      ? storage.blobs.get({ namespace: request.namespace, id: request.id })
      : storage.records.get({ namespace: request.namespace, id: request.id })
  }
  function set(request: {
    namespace: string
    id: string | number
    value: unknown
    mode?: 'record'
  }): ReturnType<typeof storage.records.set>
  function set(request: {
    namespace: string
    id: string
    data: Uint8Array<ArrayBuffer>
    contentType?: string
    mode: 'blob'
  }): ReturnType<typeof storage.blobs.set>
  function set(
    request:
      | { namespace: string; id: string | number; value: unknown; mode?: 'record' }
      | {
          namespace: string
          id: string
          data: Uint8Array<ArrayBuffer>
          contentType?: string
          mode: 'blob'
        },
  ) {
    return request.mode === 'blob'
      ? storage.blobs.set({
          namespace: request.namespace,
          id: request.id,
          data: request.data,
          ...(request.contentType ? { contentType: request.contentType } : {}),
        })
      : storage.records.set({ namespace: request.namespace, id: request.id, value: request.value })
  }

  return {
    ...storage.records,
    get,
    set,
    getBlob: storage.blobs.get,
    setBlob: storage.blobs.set,
    statBlob: storage.blobs.stat,
    listBlobs: storage.blobs.list,
    readBlobRange: storage.blobs.readRange,
    appendBlob: storage.blobs.append,
    beginBlobWrite: storage.blobs.beginWrite,
    writeBlobChunk: storage.blobs.writeChunk,
    getBlobWriteStatus: storage.blobs.writeStatus,
    commitBlobWrite: storage.blobs.commitWrite,
    abortBlobWrite: storage.blobs.abortWrite,
    deleteBlob: storage.blobs.delete,
    clearBlobs: storage.blobs.clear,
  }
}

export type TaskyonStorageClient = ReturnType<typeof createStorageClient>

export const createProtocolStorageBlobBackend = (
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  namespace: string,
): StorageBlobBackend => {
  const client = createStorageClient(port)
  return {
    get: async (id) => await client.getBlob({ namespace, id }),
    set: async (id, data, contentType) =>
      await client.setBlob({ namespace, id, data, ...(contentType ? { contentType } : {}) }),
    stat: async (id) => await client.statBlob({ namespace, id }),
    list: async () => (await client.listBlobs({ namespace })).blobs,
    readRange: async (id, offset, length) =>
      await client.readBlobRange({ namespace, id, offset, length }),
    append: async (id, data, expectedSize, contentType) =>
      await client.appendBlob({
        namespace,
        id,
        data,
        expectedSize,
        ...(contentType ? { contentType } : {}),
      }),
    beginWrite: async (id, contentType) =>
      await client.beginBlobWrite({ namespace, id, ...(contentType ? { contentType } : {}) }),
    writeChunk: async (id, writeId, offset, data) =>
      await client.writeBlobChunk({ namespace, id, writeId, offset, data }),
    writeStatus: async (id, writeId) => await client.getBlobWriteStatus({ namespace, id, writeId }),
    commitWrite: async (id, writeId, expectedSize, expectedSha256) =>
      await client.commitBlobWrite({
        namespace,
        id,
        writeId,
        expectedSize,
        ...(expectedSha256 ? { expectedSha256 } : {}),
      }),
    abortWrite: async (id, writeId) => await client.abortBlobWrite({ namespace, id, writeId }),
    delete: async (id) => await client.deleteBlob({ namespace, id }),
    clear: async () => await client.clearBlobs({ namespace }),
  }
}

export type StorageRecordCrud<T> = CrudWrapper<T> & {
  find: (where: PartialDeep<T>) => Promise<Record<string, T>>
  getMany: (ids: readonly (string | number)[]) => Promise<{ id: string | number; data: T }[]>
  setMany: (rows: readonly { id: string | number; data: T }[]) => Promise<void>
}

export type StorageRecordBackend = {
  get: (id: string | number) => Promise<unknown>
  getMany: (ids: readonly (string | number)[]) => Promise<{ id: string | number; data: unknown }[]>
  set: (id: string | number, value: unknown) => Promise<void>
  setMany: (rows: readonly { id: string | number; data: unknown }[]) => Promise<void>
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

export type StorageBlobMetadata = z.output<typeof blobMetadata>

export type StorageBlobBackend = {
  get: (
    id: string,
  ) => Promise<{ data: Uint8Array<ArrayBuffer>; metadata: StorageBlobMetadata } | null>
  set: (
    id: string,
    data: Uint8Array<ArrayBuffer>,
    contentType?: string,
  ) => Promise<StorageBlobMetadata>
  stat: (id: string) => Promise<StorageBlobMetadata | null>
  list: () => Promise<StorageBlobMetadata[]>
  readRange: (
    id: string,
    offset: number,
    length: number,
  ) => Promise<{ data: Uint8Array<ArrayBuffer>; nextOffset: number; eof: boolean }>
  append: (
    id: string,
    data: Uint8Array<ArrayBuffer>,
    expectedSize: number,
    contentType?: string,
  ) => Promise<StorageBlobMetadata>
  beginWrite: (id: string, contentType?: string) => Promise<{ writeId: string }>
  writeChunk: (
    id: string,
    writeId: string,
    offset: number,
    data: Uint8Array<ArrayBuffer>,
  ) => Promise<{ nextOffset: number }>
  writeStatus: (id: string, writeId: string) => Promise<{ size: number }>
  commitWrite: (
    id: string,
    writeId: string,
    expectedSize: number,
    expectedSha256?: string,
  ) => Promise<StorageBlobMetadata>
  abortWrite: (id: string, writeId: string) => Promise<void>
  delete: (id: string) => Promise<void>
  clear: () => Promise<void>
}

export type StorageAccessRequest =
  | {
      service: 'storage.records'
      operation:
        | 'get'
        | 'getMany'
        | 'set'
        | 'setMany'
        | 'upsert'
        | 'delete'
        | 'list'
        | 'listIds'
        | 'find'
        | 'clear'
      namespace: string
      id?: string | number
    }
  | {
      service: 'storage.blobs'
      operation:
        | 'get'
        | 'set'
        | 'stat'
        | 'list'
        | 'readRange'
        | 'append'
        | 'beginWrite'
        | 'writeChunk'
        | 'writeStatus'
        | 'commitWrite'
        | 'abortWrite'
        | 'delete'
        | 'clear'
      namespace: string
      id?: string
    }

export type StorageAccessMode =
  | { mode: 'trusted-local' }
  | {
      mode: 'authorize'
      authorize: (request: StorageAccessRequest) => Promise<boolean> | boolean
    }

export type StorageBackendProvider = {
  records?: (namespace: string) => Promise<StorageRecordBackend> | StorageRecordBackend
  blobs?: (namespace: string) => Promise<StorageBlobBackend> | StorageBlobBackend
}

const storageNamespacePrefix = z
  .string()
  .regex(
    /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/,
    'Storage namespace prefixes must contain non-empty filesystem-safe segments.',
  )

export const scopeStorageBackendProvider = (
  backends: StorageBackendProvider,
  prefix: string,
): StorageBackendProvider => {
  const parsedPrefix = storageNamespacePrefix.parse(prefix)
  const scopedNamespace = (namespace: string) => `${parsedPrefix}/${namespace}`
  const records = backends.records
  const blobs = backends.blobs
  return {
    ...(records ? { records: (namespace: string) => records(scopedNamespace(namespace)) } : {}),
    ...(blobs ? { blobs: (namespace: string) => blobs(scopedNamespace(namespace)) } : {}),
  }
}

export const createStorageRecordBackend = <T>(
  crud: StorageRecordCrud<T>,
  schema: z.ZodType<T>,
): StorageRecordBackend => {
  const parseValue = (value: unknown) => schema.parse(value)
  return {
    get: crud.get,
    getMany: crud.getMany,
    set: async (id, value) => crud.set(id, parseValue(value)),
    setMany: async (rows) =>
      crud.setMany(rows.map(({ id, data }) => ({ id, data: parseValue(data) }))),
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
  backends: StorageBackendProvider,
  access: StorageAccessMode,
) => {
  const authorize = async (request: StorageAccessRequest) => {
    if (access.mode === 'trusted-local') return
    if (!(await access.authorize(request))) {
      throw new Error(
        `Storage access denied for ${request.operation} on namespace "${request.namespace}".`,
      )
    }
  }
  const recordBackend = async (
    operation: Extract<StorageAccessRequest, { service: 'storage.records' }>['operation'],
    namespace: string,
    id?: string | number,
  ) => {
    await authorize({
      service: 'storage.records',
      operation,
      namespace,
      ...(id !== undefined ? { id } : {}),
    })
    if (!backends.records) {
      throw new Error(`Record storage is unavailable for namespace "${namespace}".`)
    }
    return await backends.records(namespace)
  }
  const blobBackend = async (
    operation: Extract<StorageAccessRequest, { service: 'storage.blobs' }>['operation'],
    namespace: string,
    id?: string,
  ) => {
    await authorize({
      service: 'storage.blobs',
      operation,
      namespace,
      ...(id !== undefined ? { id } : {}),
    })
    if (!backends.blobs)
      throw new Error(`Blob storage is unavailable for namespace "${namespace}".`)
    return await backends.blobs(namespace)
  }

  return createPortServer(port, taskyonStorageProtocol, {
    storage: {
      records: {
        get: async ({ namespace, id }) => ({
          value: (await (await recordBackend('get', namespace, id)).get(id)) ?? null,
        }),
        getMany: async ({ namespace, ids }) => ({
          rows: await (await recordBackend('getMany', namespace)).getMany(ids),
        }),
        set: async ({ namespace, id, value }) => {
          await (await recordBackend('set', namespace, id)).set(id, value)
        },
        setMany: async ({ namespace, rows }) => {
          await (await recordBackend('setMany', namespace)).setMany(rows)
        },
        upsert: async ({ namespace, id, value, strategy }) => ({
          value: await (await recordBackend('upsert', namespace, id)).upsert(id, value, strategy),
        }),
        delete: async ({ namespace, id }) => {
          await (await recordBackend('delete', namespace, id)).delete(id)
        },
        list: async ({ namespace }) => ({
          rows: await (await recordBackend('list', namespace)).list(),
        }),
        listIds: async ({ namespace }) => ({
          ids: await (await recordBackend('listIds', namespace)).listIds(),
        }),
        find: async ({ namespace, query }) => ({
          values: await (await recordBackend('find', namespace)).find(query),
        }),
        clear: async ({ namespace }) => {
          await (await recordBackend('clear', namespace)).clear()
        },
      },
      blobs: {
        get: async ({ namespace, id }) => await (await blobBackend('get', namespace, id)).get(id),
        set: async ({ namespace, id, data, contentType }) =>
          await (await blobBackend('set', namespace, id)).set(id, data, contentType),
        stat: async ({ namespace, id }) =>
          await (await blobBackend('stat', namespace, id)).stat(id),
        list: async ({ namespace }) => ({
          blobs: await (await blobBackend('list', namespace)).list(),
        }),
        readRange: async ({ namespace, id, offset, length }) =>
          await (await blobBackend('readRange', namespace, id)).readRange(id, offset, length),
        append: async ({ namespace, id, data, expectedSize, contentType }) =>
          await (
            await blobBackend('append', namespace, id)
          ).append(id, data, expectedSize, contentType),
        beginWrite: async ({ namespace, id, contentType }) =>
          await (await blobBackend('beginWrite', namespace, id)).beginWrite(id, contentType),
        writeChunk: async ({ namespace, id, writeId, offset, data }) =>
          await (
            await blobBackend('writeChunk', namespace, id)
          ).writeChunk(id, writeId, offset, data),
        writeStatus: async ({ namespace, id, writeId }) =>
          await (await blobBackend('writeStatus', namespace, id)).writeStatus(id, writeId),
        commitWrite: async ({ namespace, id, writeId, expectedSize, expectedSha256 }) =>
          await (
            await blobBackend('commitWrite', namespace, id)
          ).commitWrite(id, writeId, expectedSize, expectedSha256),
        abortWrite: async ({ namespace, id, writeId }) => {
          await (await blobBackend('abortWrite', namespace, id)).abortWrite(id, writeId)
        },
        delete: async ({ namespace, id }) => {
          await (await blobBackend('delete', namespace, id)).delete(id)
        },
        clear: async ({ namespace }) => {
          await (await blobBackend('clear', namespace)).clear()
        },
      },
    },
  })
}

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
    getMany: async (ids) => {
      const { rows } = await client.storage.records.getMany({ namespace, ids: [...ids] })
      return rows.map(({ id, data }) => ({ id, data: parseValue(data) }))
    },
    set: async (id, value) => {
      await client.storage.records.set({ namespace, id, value })
    },
    setMany: async (rows) => {
      await client.storage.records.setMany({ namespace, rows: [...rows] })
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
