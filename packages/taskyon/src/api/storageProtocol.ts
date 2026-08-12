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
import {
  mergeStorageRecord,
  storageQueryMatches,
  storageValueContentHash,
} from './storageRecordOperations'

const storageId = z.union([z.string(), z.number()])
const storagePath = z
  .string()
  .regex(
    /^[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/,
    'Storage paths must contain non-empty filesystem-safe segments.',
  )
  .refine(
    (value) => value.split('/').every((segment) => segment !== '.' && segment !== '..'),
    'Storage paths must not contain relative segments.',
  )
const storageNamespace = storagePath
const storageValue = z.unknown()
const storageContentHash = z.string().startsWith('sha256:')
export type StorageDistribution = 'local-only' | 'remote-allowed'
const storageDistribution = z.enum(['local-only', 'remote-allowed'])
const storagePolicy = { distribution: storageDistribution }
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
  version: '3',
  commands: {
    get: {
      request: z.object({
        namespace: storageNamespace,
        id: storageId,
        ...storagePolicy,
      }),
      response: z.object({
        value: storageValue.nullable(),
        contentHash: storageContentHash.nullable(),
      }),
    },
    getMany: {
      request: z.object({
        namespace: storageNamespace,
        ids: z.array(storageId),
        ...storagePolicy,
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
        ...storagePolicy,
      }),
    },
    setIfUnchanged: {
      request: z.object({
        namespace: storageNamespace,
        id: storageId,
        expectedContentHash: storageContentHash.nullable(),
        value: storageValue,
        ...storagePolicy,
      }),
      response: z.object({
        written: z.boolean(),
        currentContentHash: storageContentHash.nullable(),
      }),
    },
    setMany: {
      request: z.object({
        namespace: storageNamespace,
        rows: z.array(storageRow),
        ...storagePolicy,
      }),
    },
    upsert: {
      request: z.object({
        namespace: storageNamespace,
        id: storageId,
        value: storageValue,
        strategy: z.enum(['shallow_merge', 'replace', 'deepmerge', 'native_shallow']).optional(),
        ...storagePolicy,
      }),
      response: z.object({
        value: storageValue,
      }),
    },
    delete: {
      request: z.object({
        namespace: storageNamespace,
        id: storageId,
        ...storagePolicy,
      }),
    },
    list: {
      request: z.object({
        namespace: storageNamespace,
        ...storagePolicy,
      }),
      response: z.object({
        rows: z.array(storageRow),
      }),
    },
    listIds: {
      request: z.object({
        namespace: storageNamespace,
        ...storagePolicy,
      }),
      response: z.object({
        ids: z.array(storageId),
      }),
    },
    find: {
      request: z.object({
        namespace: storageNamespace,
        query: storageValue.optional(),
        ...storagePolicy,
      }),
      response: z.object({
        values: z.record(z.string(), storageValue),
      }),
    },
    clear: {
      request: z.object({
        namespace: storageNamespace,
        ...storagePolicy,
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
  version: '3',
  commands: {
    get: {
      request: z.object({ namespace: storageNamespace, id: blobId, ...storagePolicy }),
      response: z.object({ data: blobBytes, metadata: blobMetadata }).nullable(),
    },
    set: {
      request: z.object({
        namespace: storageNamespace,
        id: blobId,
        data: blobBytes,
        contentType: z.string().optional(),
        ...storagePolicy,
      }),
      response: blobMetadata,
    },
    stat: {
      request: z.object({ namespace: storageNamespace, id: blobId, ...storagePolicy }),
      response: blobMetadata.nullable(),
    },
    list: {
      request: z.object({ namespace: storageNamespace, ...storagePolicy }),
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
        ...storagePolicy,
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
        ...storagePolicy,
      }),
      response: blobMetadata,
    },
    beginWrite: {
      request: z.object({
        namespace: storageNamespace,
        id: blobId,
        contentType: z.string().optional(),
        ...storagePolicy,
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
        ...storagePolicy,
      }),
      response: z.object({ nextOffset: z.number().int().nonnegative() }),
    },
    writeStatus: {
      request: z.object({
        namespace: storageNamespace,
        id: blobId,
        writeId: z.string(),
        ...storagePolicy,
      }),
      response: z.object({ size: z.number().int().nonnegative() }),
    },
    commitWrite: {
      request: z.object({
        namespace: storageNamespace,
        id: blobId,
        targetId: blobId.optional(),
        writeId: z.string(),
        expectedSize: z.number().int().nonnegative(),
        expectedSha256: z.string().optional(),
        ...storagePolicy,
      }),
      response: blobMetadata,
    },
    abortWrite: {
      request: z.object({
        namespace: storageNamespace,
        id: blobId,
        writeId: z.string(),
        ...storagePolicy,
      }),
    },
    delete: {
      request: z.object({ namespace: storageNamespace, id: blobId, ...storagePolicy }),
    },
    clear: {
      request: z.object({ namespace: storageNamespace, ...storagePolicy }),
    },
  },
})

export const taskyonStorageProtocol = mergeFrpProtocols({
  id: 'taskyon.storage',
  version: '3',
  base: taskyonStorageRecordProtocol,
  extension: taskyonStorageBlobProtocol,
})

export type TaskyonStorageMessage = ProtocolMessage<typeof taskyonStorageProtocol>

export type StorageRecordCodec = {
  remoteEligible: boolean
  encode: (value: unknown) => unknown
  decode: (storedValue: unknown) => unknown
}

export type StorageClientOptions = {
  namespacePrefix: string
  distribution: StorageDistribution
  recordCodec?: StorageRecordCodec
}

export const createStorageClient = (
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  options: StorageClientOptions,
) => {
  const storage = createPortClient(port, taskyonStorageProtocol).storage
  const namespacePrefix = storagePath.parse(options.namespacePrefix)
  const codec =
    options.recordCodec ??
    ({
      remoteEligible: false,
      encode: (value: unknown) => value,
      decode: (value: unknown) => value,
    } satisfies StorageRecordCodec)
  const physicalNamespace = (namespace: string) =>
    storagePath.parse(`${namespacePrefix}/${namespace}`)
  const recordLocation = (namespace: string) => {
    if (options.distribution === 'remote-allowed' && !codec.remoteEligible) {
      throw new Error('Remote distribution is unavailable for plaintext local storage.')
    }
    return {
      namespace: physicalNamespace(namespace),
      distribution: options.distribution,
    }
  }
  const blobLocation = (namespace: string) => {
    if (options.distribution === 'remote-allowed') {
      throw new Error('Remote distribution is unavailable for plaintext local storage.')
    }
    return {
      namespace: physicalNamespace(namespace),
      distribution: options.distribution,
    }
  }
  const decodeRows = (rows: readonly { id: string | number; data: unknown }[]) =>
    rows.map(({ id, data }) => ({ id, data: codec.decode(data) }))
  const getRecord = async (request: { namespace: string; id: string | number }) => {
    const response = await storage.records.get({
      ...recordLocation(request.namespace),
      id: request.id,
    })
    const value = response.value === null ? null : codec.decode(response.value)
    return {
      value,
      contentHash: value === null ? null : storageValueContentHash(value),
    }
  }
  const setRecordIfUnchanged = async (request: {
    namespace: string
    id: string | number
    expectedContentHash: string | null
    value: unknown
  }) => {
    const location = recordLocation(request.namespace)
    const current = await storage.records.get({ ...location, id: request.id })
    const currentValue = current.value === null ? null : codec.decode(current.value)
    const currentContentHash = currentValue === null ? null : storageValueContentHash(currentValue)
    if (currentContentHash !== request.expectedContentHash) {
      return { written: false, currentContentHash }
    }
    const result = await storage.records.setIfUnchanged({
      ...location,
      id: request.id,
      expectedContentHash: current.contentHash,
      value: codec.encode(request.value),
    })
    if (result.written) {
      return { written: true, currentContentHash: storageValueContentHash(request.value) }
    }
    return await getRecord(request).then(({ contentHash }) => ({
      written: false,
      currentContentHash: contentHash,
    }))
  }
  const upsertRecord = async (request: {
    namespace: string
    id: string | number
    value: unknown
    strategy?: 'shallow_merge' | 'replace' | 'deepmerge' | 'native_shallow'
  }) => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await getRecord(request)
      const value = mergeStorageRecord(current.value, request.value, request.strategy)
      const result = await setRecordIfUnchanged({
        namespace: request.namespace,
        id: request.id,
        expectedContentHash: current.contentHash,
        value,
      })
      if (result.written) return { value }
    }
    throw new Error(`Storage record changed repeatedly while updating "${String(request.id)}".`)
  }

  function get(request: {
    namespace: string
    id: string | number
    mode?: 'record'
  }): ReturnType<typeof getRecord>
  function get(request: {
    namespace: string
    id: string
    mode: 'blob'
  }): ReturnType<typeof storage.blobs.get>
  function get(
    request:
      | {
          namespace: string
          id: string | number
          mode?: 'record'
        }
      | { namespace: string; id: string; mode: 'blob' },
  ) {
    return request.mode === 'blob'
      ? storage.blobs.get({
          ...blobLocation(request.namespace),
          id: request.id,
        })
      : getRecord(request)
  }
  function set(request: {
    namespace: string
    id: string | number
    value: unknown
    mode?: 'record'
  }): Promise<void>
  function set(request: {
    namespace: string
    id: string
    data: Uint8Array<ArrayBuffer>
    contentType?: string
    mode: 'blob'
  }): ReturnType<typeof storage.blobs.set>
  function set(
    request:
      | {
          namespace: string
          id: string | number
          value: unknown
          mode?: 'record'
        }
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
          ...blobLocation(request.namespace),
          id: request.id,
          data: request.data,
          ...(request.contentType ? { contentType: request.contentType } : {}),
        })
      : storage.records.set({
          ...recordLocation(request.namespace),
          id: request.id,
          value: codec.encode(request.value),
        })
  }

  return {
    get,
    set,
    getMany: async (request: { namespace: string; ids: (string | number)[] }) => ({
      rows: decodeRows(
        (
          await storage.records.getMany({
            ...recordLocation(request.namespace),
            ids: request.ids,
          })
        ).rows,
      ),
    }),
    setIfUnchanged: setRecordIfUnchanged,
    setMany: async (request: {
      namespace: string
      rows: { id: string | number; data: unknown }[]
    }) =>
      await storage.records.setMany({
        ...recordLocation(request.namespace),
        rows: request.rows.map(({ id, data }) => ({ id, data: codec.encode(data) })),
      }),
    upsert: upsertRecord,
    delete: async (request: { namespace: string; id: string | number }) =>
      await storage.records.delete({ ...recordLocation(request.namespace), id: request.id }),
    list: async (request: { namespace: string }) => ({
      rows: decodeRows((await storage.records.list({ ...recordLocation(request.namespace) })).rows),
    }),
    listIds: async (request: { namespace: string }) =>
      await storage.records.listIds({ ...recordLocation(request.namespace) }),
    find: async (request: { namespace: string; query?: unknown }) => {
      const rows = decodeRows(
        (await storage.records.list({ ...recordLocation(request.namespace) })).rows,
      )
      return {
        values: Object.fromEntries(
          rows
            .filter(({ data }) => storageQueryMatches(data, request.query))
            .map(({ id, data }) => [id, data]),
        ),
      }
    },
    clear: async (request: { namespace: string }) =>
      await storage.records.clear({ ...recordLocation(request.namespace) }),
    getBlob: (request: { namespace: string; id: string }) =>
      storage.blobs.get({ ...blobLocation(request.namespace), id: request.id }),
    setBlob: (request: {
      namespace: string
      id: string
      data: Uint8Array<ArrayBuffer>
      contentType?: string
    }) => storage.blobs.set({ ...request, ...blobLocation(request.namespace) }),
    statBlob: (request: { namespace: string; id: string }) =>
      storage.blobs.stat({ ...blobLocation(request.namespace), id: request.id }),
    listBlobs: (request: { namespace: string }) =>
      storage.blobs.list({ ...blobLocation(request.namespace) }),
    readBlobRange: (request: { namespace: string; id: string; offset: number; length: number }) =>
      storage.blobs.readRange({ ...request, ...blobLocation(request.namespace) }),
    appendBlob: (request: {
      namespace: string
      id: string
      data: Uint8Array<ArrayBuffer>
      expectedSize: number
      contentType?: string
    }) => storage.blobs.append({ ...request, ...blobLocation(request.namespace) }),
    beginBlobWrite: (request: { namespace: string; id: string; contentType?: string }) =>
      storage.blobs.beginWrite({ ...request, ...blobLocation(request.namespace) }),
    writeBlobChunk: (request: {
      namespace: string
      id: string
      writeId: string
      offset: number
      data: Uint8Array<ArrayBuffer>
    }) => storage.blobs.writeChunk({ ...request, ...blobLocation(request.namespace) }),
    getBlobWriteStatus: (request: { namespace: string; id: string; writeId: string }) =>
      storage.blobs.writeStatus({ ...request, ...blobLocation(request.namespace) }),
    commitBlobWrite: (request: {
      namespace: string
      id: string
      targetId?: string
      writeId: string
      expectedSize: number
      expectedSha256?: string
    }) => storage.blobs.commitWrite({ ...request, ...blobLocation(request.namespace) }),
    abortBlobWrite: (request: { namespace: string; id: string; writeId: string }) =>
      storage.blobs.abortWrite({ ...request, ...blobLocation(request.namespace) }),
    deleteBlob: (request: { namespace: string; id: string }) =>
      storage.blobs.delete({ ...blobLocation(request.namespace), id: request.id }),
    clearBlobs: (request: { namespace: string }) =>
      storage.blobs.clear({ ...blobLocation(request.namespace) }),
  }
}

export type TaskyonStorageClient = ReturnType<typeof createStorageClient>

export const createProtocolStorageBlobBackend = (
  client: TaskyonStorageClient,
  namespace: string,
): StorageBlobBackend => {
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
    commitWrite: async (id, writeId, expectedSize, expectedSha256, targetId) =>
      await client.commitBlobWrite({
        namespace,
        id,
        ...(targetId ? { targetId } : {}),
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
  setIfUnchanged: (
    id: string | number,
    expectedStoredContentHash: string | null,
    value: unknown,
  ) => Promise<{ written: boolean; currentStoredContentHash: string | null }>
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
    targetId?: string,
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
        | 'setIfUnchanged'
        | 'setMany'
        | 'upsert'
        | 'delete'
        | 'list'
        | 'listIds'
        | 'find'
        | 'clear'
      namespace: string
      id?: string | number
      distribution: StorageDistribution
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
      distribution: StorageDistribution
    }

export type StorageAccessMode =
  | { mode: 'trusted-local' }
  | {
      mode: 'authorize'
      authorize: (request: StorageAccessRequest) => Promise<boolean> | boolean
    }

export type StorageBackendProvider = {
  records?: (
    namespace: string,
    context?: { operation: string; distribution: StorageDistribution },
  ) => Promise<StorageRecordBackend> | StorageRecordBackend
  blobs?: (
    namespace: string,
    context?: { operation: string; distribution: StorageDistribution },
  ) => Promise<StorageBlobBackend> | StorageBlobBackend
}

export const createStorageRecordBackend = <T>(
  crud: StorageRecordCrud<T>,
  schema: z.ZodType<T>,
): StorageRecordBackend => {
  const parseValue = (value: unknown) => schema.parse(value)
  let conditionalWriteQueue = Promise.resolve()
  return {
    get: crud.get,
    getMany: crud.getMany,
    set: async (id, value) => crud.set(id, parseValue(value)),
    setIfUnchanged: async (id, expectedStoredContentHash, value) => {
      let result: { written: boolean; currentStoredContentHash: string | null } | undefined
      const operation = conditionalWriteQueue.then(async () => {
        const current = await crud.get(id)
        const currentStoredContentHash = current == null ? null : storageValueContentHash(current)
        if (currentStoredContentHash !== expectedStoredContentHash) {
          result = { written: false, currentStoredContentHash }
          return
        }
        const parsed = parseValue(value)
        await crud.set(id, parsed)
        result = {
          written: true,
          currentStoredContentHash: storageValueContentHash(parsed),
        }
      })
      conditionalWriteQueue = operation.then(
        () => undefined,
        () => undefined,
      )
      await operation
      if (!result) throw new Error('Conditional storage write did not produce a result.')
      return result
    },
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
    distribution: StorageDistribution,
    id?: string | number,
  ) => {
    await authorize({
      service: 'storage.records',
      operation,
      namespace,
      distribution,
      ...(id !== undefined ? { id } : {}),
    })
    if (!backends.records) {
      throw new Error(`Record storage is unavailable for namespace "${namespace}".`)
    }
    return await backends.records(namespace, { operation, distribution })
  }
  const blobBackend = async (
    operation: Extract<StorageAccessRequest, { service: 'storage.blobs' }>['operation'],
    namespace: string,
    distribution: StorageDistribution,
    id?: string,
  ) => {
    await authorize({
      service: 'storage.blobs',
      operation,
      namespace,
      distribution,
      ...(id !== undefined ? { id } : {}),
    })
    if (!backends.blobs)
      throw new Error(`Blob storage is unavailable for namespace "${namespace}".`)
    return await backends.blobs(namespace, { operation, distribution })
  }

  return createPortServer(port, taskyonStorageProtocol, {
    storage: {
      records: {
        get: async ({ namespace, id, distribution }) => {
          const value =
            (await (await recordBackend('get', namespace, distribution, id)).get(id)) ?? null
          return {
            value,
            contentHash: value === null ? null : storageValueContentHash(value),
          }
        },
        getMany: async ({ namespace, ids, distribution }) => ({
          rows: await (await recordBackend('getMany', namespace, distribution)).getMany(ids),
        }),
        set: async ({ namespace, id, value, distribution }) => {
          await (await recordBackend('set', namespace, distribution, id)).set(id, value)
        },
        setIfUnchanged: async ({ namespace, id, expectedContentHash, value, distribution }) => {
          const result = await (
            await recordBackend('setIfUnchanged', namespace, distribution, id)
          ).setIfUnchanged(id, expectedContentHash, value)
          return {
            written: result.written,
            currentContentHash: result.currentStoredContentHash,
          }
        },
        setMany: async ({ namespace, rows, distribution }) => {
          await (await recordBackend('setMany', namespace, distribution)).setMany(rows)
        },
        upsert: async ({ namespace, id, value, strategy, distribution }) => ({
          value: await (
            await recordBackend('upsert', namespace, distribution, id)
          ).upsert(id, value, strategy),
        }),
        delete: async ({ namespace, id, distribution }) => {
          await (await recordBackend('delete', namespace, distribution, id)).delete(id)
        },
        list: async ({ namespace, distribution }) => ({
          rows: await (await recordBackend('list', namespace, distribution)).list(),
        }),
        listIds: async ({ namespace, distribution }) => ({
          ids: await (await recordBackend('listIds', namespace, distribution)).listIds(),
        }),
        find: async ({ namespace, query, distribution }) => ({
          values: await (await recordBackend('find', namespace, distribution)).find(query),
        }),
        clear: async ({ namespace, distribution }) => {
          await (await recordBackend('clear', namespace, distribution)).clear()
        },
      },
      blobs: {
        get: async ({ namespace, id, distribution }) =>
          await (await blobBackend('get', namespace, distribution, id)).get(id),
        set: async ({ namespace, id, data, contentType, distribution }) =>
          await (await blobBackend('set', namespace, distribution, id)).set(id, data, contentType),
        stat: async ({ namespace, id, distribution }) =>
          await (await blobBackend('stat', namespace, distribution, id)).stat(id),
        list: async ({ namespace, distribution }) => ({
          blobs: await (await blobBackend('list', namespace, distribution)).list(),
        }),
        readRange: async ({ namespace, id, offset, length, distribution }) =>
          await (
            await blobBackend('readRange', namespace, distribution, id)
          ).readRange(id, offset, length),
        append: async ({ namespace, id, data, expectedSize, contentType, distribution }) =>
          await (
            await blobBackend('append', namespace, distribution, id)
          ).append(id, data, expectedSize, contentType),
        beginWrite: async ({ namespace, id, contentType, distribution }) =>
          await (
            await blobBackend('beginWrite', namespace, distribution, id)
          ).beginWrite(id, contentType),
        writeChunk: async ({ namespace, id, writeId, offset, data, distribution }) =>
          await (
            await blobBackend('writeChunk', namespace, distribution, id)
          ).writeChunk(id, writeId, offset, data),
        writeStatus: async ({ namespace, id, writeId, distribution }) =>
          await (
            await blobBackend('writeStatus', namespace, distribution, id)
          ).writeStatus(id, writeId),
        commitWrite: async ({
          namespace,
          id,
          targetId,
          writeId,
          expectedSize,
          expectedSha256,
          distribution,
        }) =>
          await (
            await blobBackend('commitWrite', namespace, distribution, id)
          ).commitWrite(id, writeId, expectedSize, expectedSha256, targetId),
        abortWrite: async ({ namespace, id, writeId, distribution }) => {
          await (
            await blobBackend('abortWrite', namespace, distribution, id)
          ).abortWrite(id, writeId)
        },
        delete: async ({ namespace, id, distribution }) => {
          await (await blobBackend('delete', namespace, distribution, id)).delete(id)
        },
        clear: async ({ namespace, distribution }) => {
          await (await blobBackend('clear', namespace, distribution)).clear()
        },
      },
    },
  })
}

export const createProtocolStorageCrudWrapper = <T>(
  storage: TaskyonStorageClient,
  namespace: string,
  schema: z.ZodType<T>,
): StorageRecordCrud<T> => {
  const parseValue = (value: unknown) => schema.parse(value)
  const parseRecord = (values: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(values).map(([id, value]) => [id, parseValue(value)]))

  return {
    get: async (id) => {
      const { value } = await storage.get({ namespace, id })
      return value === null ? null : parseValue(value)
    },
    getMany: async (ids) => {
      const { rows } = await storage.getMany({ namespace, ids: [...ids] })
      return rows.map(({ id, data }) => ({ id, data: parseValue(data) }))
    },
    set: async (id, value) => {
      await storage.set({ namespace, id, value })
    },
    setMany: async (rows) => {
      await storage.setMany({ namespace, rows: [...rows] })
    },
    upsert: async (id, value, strategy) => {
      const result = await storage.upsert({
        namespace,
        id,
        value,
        ...(strategy ? { strategy } : {}),
      })
      return parseValue(result.value)
    },
    delete: async (id) => {
      await storage.delete({ namespace, id })
    },
    list: async () => {
      const { rows } = await storage.list({ namespace })
      return rows.map((row) => ({ id: row.id, data: parseValue(row.data) }))
    },
    listAll: async () => {
      const { rows } = await storage.list({ namespace })
      return rows.map((row) => ({ id: row.id, data: parseValue(row.data) }))
    },
    listIds: async () => {
      const { ids } = await storage.listIds({ namespace })
      return ids
    },
    find: async (where) => {
      const { values } = await storage.find({ namespace, query: where })
      return parseRecord(values)
    },
    clear: async () => {
      await storage.clear({ namespace })
    },
  }
}
