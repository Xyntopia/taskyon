import {
  createPortClient,
  createPortServer,
  defineFrpServiceProtocol,
  type Port,
  type ProtocolMessage,
} from '@taskyon/common/modules/frpBus'
import { z } from 'zod'
import { createVectorStore } from '../utils/crudWrapper'
import type { TyPGDB } from '../utils/pglite.api'
import type { SearchVectorizerPreset } from '../utils/searchEngine'

const searchMetadataValue = z.union([z.string(), z.number(), z.boolean()])
export const SearchIndexDocument = z.object({
  id: z.string(),
  text: z.string(),
  vector: z.array(z.number()).optional(),
  keywords: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  metadata: z.record(z.string(), searchMetadataValue).optional(),
})
export type SearchIndexDocument = z.infer<typeof SearchIndexDocument>

const indexRequest = z.object({ index: z.string().min(1) })
const vectorizer = z.enum(['static-multilingual', 'transformer-minilm'])

export const taskyonSearchProtocol = defineFrpServiceProtocol({
  service: 'search.index',
  version: '1',
  commands: {
    configure: {
      request: indexRequest.extend({ vectorizer, modelName: z.string().optional() }),
    },
    upsertMany: {
      request: indexRequest.extend({ documents: z.array(SearchIndexDocument) }),
    },
    removeMany: {
      request: indexRequest.extend({ ids: z.array(z.string()) }),
    },
    query: {
      request: indexRequest.extend({
        text: z.string(),
        limit: z.number().int().positive().max(100).default(10),
        allowedIds: z.array(z.string()).optional(),
        metadata: z.record(z.string(), searchMetadataValue).optional(),
      }),
      response: z.object({
        results: z.array(z.object({ id: z.string(), score: z.number() })),
      }),
    },
    count: { request: indexRequest, response: z.object({ count: z.number().int().nonnegative() }) },
    clear: { request: indexRequest },
    status: {
      request: indexRequest,
      response: z.object({
        state: z.enum(['ready', 'indexing', 'degraded']),
        detail: z.string().optional(),
      }),
    },
    snapshot: {
      request: indexRequest,
      response: z.object({ documents: z.array(SearchIndexDocument) }),
    },
  },
})

export type TaskyonSearchMessage = ProtocolMessage<typeof taskyonSearchProtocol>
export const createSearchClient = (port: Port<TaskyonSearchMessage, TaskyonSearchMessage>) =>
  createPortClient(port, taskyonSearchProtocol).search.index

export type SearchIndexBackend = {
  configure: (options: { vectorizer: SearchVectorizerPreset; modelName?: string }) => Promise<void>
  upsertMany: (documents: readonly SearchIndexDocument[]) => Promise<void>
  removeMany: (ids: readonly string[]) => Promise<void>
  query: (options: {
    text: string
    limit: number
    allowedIds?: string[]
    metadata?: Record<string, string | number | boolean>
  }) => Promise<{ id: string; score: number }[]>
  count: () => Promise<number>
  clear: () => Promise<void>
  status: () => Promise<{ state: 'ready' | 'indexing' | 'degraded'; detail?: string }>
  snapshot: () => Promise<SearchIndexDocument[]>
}

export const createSearchProtocolServer = (
  port: Port<TaskyonSearchMessage, TaskyonSearchMessage>,
  resolveBackend: (index: string) => Promise<SearchIndexBackend> | SearchIndexBackend,
) =>
  createPortServer(port, taskyonSearchProtocol, {
    search: {
      index: {
        configure: async ({ index, vectorizer, modelName }) =>
          (await resolveBackend(index)).configure({
            vectorizer,
            ...(modelName ? { modelName } : {}),
          }),
        upsertMany: async ({ index, documents }) =>
          (await resolveBackend(index)).upsertMany(documents),
        removeMany: async ({ index, ids }) => (await resolveBackend(index)).removeMany(ids),
        query: async ({ index, text, limit, allowedIds, metadata }) => ({
          results: await (
            await resolveBackend(index)
          ).query({
            text,
            limit,
            ...(allowedIds ? { allowedIds } : {}),
            ...(metadata ? { metadata } : {}),
          }),
        }),
        count: async ({ index }) => ({ count: await (await resolveBackend(index)).count() }),
        clear: async ({ index }) => (await resolveBackend(index)).clear(),
        status: async ({ index }) => await (await resolveBackend(index)).status(),
        snapshot: async ({ index }) => ({
          documents: await (await resolveBackend(index)).snapshot(),
        }),
      },
    },
  })

export const createPgLiteSearchIndexBackend = (
  db: TyPGDB,
  tablePrefix: string,
): SearchIndexBackend => {
  let selected: { vectorizer: SearchVectorizerPreset; modelName?: string } = {
    vectorizer: 'static-multilingual',
  }
  let store: Awaited<ReturnType<typeof createVectorStore<SearchIndexDocument>>> | undefined
  const getStore = async () => {
    store ??= await createVectorStore<SearchIndexDocument>(db, tablePrefix, selected)
    return store
  }
  return {
    configure: (options) => {
      if (options.vectorizer !== selected.vectorizer || options.modelName !== selected.modelName) {
        selected = options
        store = undefined
      }
      return Promise.resolve()
    },
    upsertMany: async (documents) => {
      const index = await getStore()
      await index.upsertManyDocuments(
        documents.map((document) => ({
          id: document.id,
          text: document.text,
          data: document,
          ...(document.vector ? { vector: document.vector } : {}),
        })),
      )
    },
    removeMany: async (ids) => {
      const index = await getStore()
      await Promise.all(ids.map((id) => index.delete(id)))
    },
    query: async ({ text, limit, allowedIds, metadata }) => {
      const results = await (
        await getStore()
      ).search(text, limit, allowedIds, metadata ? { metadata } : undefined)
      return results.map(({ id, distance }) => ({
        id,
        score: distance >= 1_000_000 ? 0 : 1 / (distance + 0.01),
      }))
    },
    count: async () => await (await getStore()).count(),
    clear: async () => await (await getStore()).clear(),
    status: () => Promise.resolve({ state: 'ready' }),
    snapshot: async () =>
      (await (await getStore()).listSearchDocuments()).map(({ id, text, vector, data }) => ({
        ...data,
        id,
        text,
        ...(vector ? { vector } : {}),
      })),
  }
}
