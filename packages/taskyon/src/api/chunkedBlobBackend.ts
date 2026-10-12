import { z } from 'zod'
import { createSha256Hasher } from '@taskyon/common/modules/canonicalHash'
import { blobMetadata, type StorageBlobBackend } from './storageProtocol'

export const STORAGE_CHUNK_BYTES = 1024 * 1024
export const blobGenerationSchema = z.object({
  generation: z.string().uuid().optional(),
  metadata: blobMetadata,
})
export const blobWriteGenerationSchema = z.object({
  id: blobMetadata.shape.id,
  generation: z.string().uuid(),
  size: blobMetadata.shape.size,
  contentType: blobMetadata.shape.contentType,
})
export type BlobGeneration = z.output<typeof blobGenerationSchema>
export type BlobWriteGeneration = z.output<typeof blobWriteGenerationSchema>

/** Adapters own atomic transactions/publication and legacy range reads; no growing blob values. */
export interface BlobChunkStore {
  transaction<T>(operation: (store: BlobChunkStore) => Promise<T>): Promise<T>
  get(id: string): Promise<BlobGeneration | null>
  list(): Promise<BlobGeneration[]>
  publish(id: string, value: BlobGeneration): Promise<void>
  remove(id: string): Promise<void>
  getWrite(writeId: string): Promise<BlobWriteGeneration | null>
  putWrite(writeId: string, value: BlobWriteGeneration): Promise<void>
  removeWrite(writeId: string): Promise<void>
  readChunk(generation: string, index: number): Promise<Uint8Array<ArrayBuffer>>
  putChunk(generation: string, index: number, data: Uint8Array<ArrayBuffer>): Promise<void>
  removeGeneration(generation: string): Promise<void>
  readLegacy(id: string, offset: number, length: number): Promise<Uint8Array<ArrayBuffer>>
  clear(): Promise<void>
}

async function readRange(
  store: BlobChunkStore,
  id: string,
  row: BlobGeneration,
  offset: number,
  length: number,
) {
  const size = Math.max(0, Math.min(length, row.metadata.size - offset))
  if (!row.generation) return store.readLegacy(id, offset, size)
  const data = new Uint8Array(size)
  for (let written = 0; written < size; ) {
    const position = offset + written
    const chunk = await store.readChunk(row.generation, Math.floor(position / STORAGE_CHUNK_BYTES))
    const part = chunk.subarray(
      position % STORAGE_CHUNK_BYTES,
      Math.min(chunk.length, (position % STORAGE_CHUNK_BYTES) + size - written),
    )
    if (!part.length) throw new Error('Stored blob chunk is missing or truncated')
    data.set(part, written)
    written += part.length
  }
  return data
}

async function writeChunks(
  store: BlobChunkStore,
  row: BlobWriteGeneration,
  offset: number,
  data: Uint8Array<ArrayBuffer>,
) {
  if (offset > row.size || offset < 0) throw new Error('Blob write offset exceeds size')
  for (let consumed = 0; consumed < data.length; ) {
    const position = offset + consumed
    const index = Math.floor(position / STORAGE_CHUNK_BYTES)
    const start = position % STORAGE_CHUNK_BYTES
    const length = Math.min(STORAGE_CHUNK_BYTES - start, data.length - consumed)
    const current = await store.readChunk(row.generation, index)
    const expected = Math.max(
      0,
      Math.min(STORAGE_CHUNK_BYTES, row.size - index * STORAGE_CHUNK_BYTES),
    )
    if (current.length !== expected) throw new Error('Stored blob chunk is missing or truncated')
    const next = new Uint8Array(Math.max(current.length, start + length))
    next.set(current)
    next.set(data.subarray(consumed, consumed + length), start)
    await store.putChunk(row.generation, index, next)
    consumed += length
  }
  return { ...row, size: Math.max(row.size, offset + data.length) }
}

async function requireWrite(store: BlobChunkStore, id: string, writeId: string) {
  const row = await store.getWrite(writeId)
  if (!row || row.id !== id) throw new Error('Unknown blob write')
  return row
}

async function commit(
  store: BlobChunkStore,
  id: string,
  writeId: string,
  expectedSize: number,
  expectedSha256?: string,
  targetId = id,
) {
  const row = await requireWrite(store, id, writeId)
  if (row.size !== expectedSize) throw new Error('Blob size mismatch')
  const hash = createSha256Hasher()
  for (let offset = 0; offset < row.size; offset += STORAGE_CHUNK_BYTES) {
    const data = await store.readChunk(row.generation, offset / STORAGE_CHUNK_BYTES)
    if (data.length !== Math.min(STORAGE_CHUNK_BYTES, row.size - offset))
      throw new Error('Stored blob chunk is truncated')
    hash.update(data)
  }
  const sha256 = hash.digest()
  if (expectedSha256 && expectedSha256 !== sha256) throw new Error('Blob checksum mismatch')
  const previous = await store.get(targetId)
  const metadata = {
    id: targetId,
    size: row.size,
    modifiedAt: new Date().toISOString(),
    sha256,
    ...(row.contentType ? { contentType: row.contentType } : {}),
  }
  await store.publish(targetId, { generation: row.generation, metadata })
  await store.removeWrite(writeId)
  if (previous?.generation) await store.removeGeneration(previous.generation)
  return metadata
}

export function createChunkedBlobBackend(store: BlobChunkStore): StorageBlobBackend {
  const beginWrite = (id: string, contentType?: string) =>
    store.transaction(async (store) => {
      const writeId = crypto.randomUUID()
      await store.putWrite(writeId, {
        id,
        generation: crypto.randomUUID(),
        size: 0,
        ...(contentType ? { contentType } : {}),
      })
      return { writeId }
    })
  const writeChunk: StorageBlobBackend['writeChunk'] = (id, writeId, offset, data) =>
    store.transaction(async (store) => {
      const row = await writeChunks(store, await requireWrite(store, id, writeId), offset, data)
      await store.putWrite(writeId, row)
      return { nextOffset: row.size }
    })
  const commitWrite: StorageBlobBackend['commitWrite'] = (id, writeId, size, hash, target) =>
    store.transaction((store) => commit(store, id, writeId, size, hash, target))
  const abortWrite: StorageBlobBackend['abortWrite'] = (id, writeId) =>
    store.transaction(async (store) => {
      const row = await store.getWrite(writeId)
      if (!row || row.id !== id) return
      await store.removeWrite(writeId)
      await store.removeGeneration(row.generation)
    })
  return {
    get: (id) =>
      store.transaction(async (store) => {
        const row = await store.get(id)
        return row
          ? { metadata: row.metadata, data: await readRange(store, id, row, 0, row.metadata.size) }
          : null
      }),
    stat: (id) => store.transaction(async (store) => (await store.get(id))?.metadata ?? null),
    list: () => store.transaction(async (store) => (await store.list()).map((row) => row.metadata)),
    readRange: (id, offset, length) =>
      store.transaction(async (store) => {
        const row = await store.get(id)
        if (!row) throw new Error('Blob not found')
        const data = await readRange(store, id, row, offset, length)
        return {
          data,
          nextOffset: offset + data.length,
          eof: offset + data.length >= row.metadata.size,
        }
      }),
    beginWrite,
    writeChunk,
    commitWrite,
    abortWrite,
    writeStatus: (id, writeId) =>
      store.transaction(async (store) => ({ size: (await requireWrite(store, id, writeId)).size })),
    set: async (id, data, contentType) => {
      const { writeId } = await beginWrite(id, contentType)
      try {
        await writeChunk(id, writeId, 0, data)
        return await commitWrite(id, writeId, data.length)
      } catch (error) {
        await abortWrite(id, writeId).catch(() => undefined)
        throw error
      }
    },
    append: (id, data, size, contentType) =>
      store.transaction(async (store) => {
        const previous = await store.get(id)
        if ((previous?.metadata.size ?? 0) !== size) throw new Error('Blob append offset mismatch')
        const writeId = crypto.randomUUID()
        const type = contentType ?? previous?.metadata.contentType
        let row: BlobWriteGeneration = {
          id,
          generation: crypto.randomUUID(),
          size: 0,
          ...(type ? { contentType: type } : {}),
        }
        await store.putWrite(writeId, row)
        try {
          for (let offset = 0; previous && offset < size; offset += STORAGE_CHUNK_BYTES)
            row = await writeChunks(
              store,
              row,
              offset,
              await readRange(store, id, previous, offset, STORAGE_CHUNK_BYTES),
            )
          row = await writeChunks(store, row, size, data)
          await store.putWrite(writeId, row)
          return await commit(store, id, writeId, row.size)
        } catch (error) {
          await store.removeWrite(writeId).catch(() => undefined)
          await store.removeGeneration(row.generation).catch(() => undefined)
          throw error
        }
      }),
    delete: (id) =>
      store.transaction(async (store) => {
        const previous = await store.get(id)
        await store.remove(id)
        if (previous?.generation) await store.removeGeneration(previous.generation)
      }),
    clear: () => store.transaction((store) => store.clear()),
  }
}
