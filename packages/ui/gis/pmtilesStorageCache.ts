import { canonicalHash, sha256HashBytes } from '@taskyon/common/modules/canonicalHash'
import type { TaskyonStorageClient } from '@taskyon/taskyon/api'
import { EtagMismatch, type RangeResponse, type Source } from 'pmtiles'

const CACHE_INDEX_NAMESPACE = 'pmtiles/cache-index'
const cacheBlobNamespace = (sourceKey: string) => `pmtiles/ranges/${sourceId(sourceKey)}`
const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024

type CachedRange = {
  id: string
  start: number
  end: number
  size: number
  lastAccessed: number
}

type CacheIndex = {
  sourceKey: string
  etag?: string
  updatedAt: number
  ranges: CachedRange[]
}

type PmtilesCacheOptions = {
  customHeaders?: HeadersInit
}

const globalConfig = { maxBytesPerArchive: DEFAULT_MAX_BYTES }

const sourceId = (sourceKey: string) => canonicalHash(sourceKey).slice('sha256:'.length)

const parseIndex = (value: unknown, sourceKey: string): CacheIndex => {
  if (!value || typeof value !== 'object') {
    return { sourceKey, updatedAt: 0, ranges: [] }
  }
  const source = value as Partial<CacheIndex>
  if (source.sourceKey !== sourceKey || !Array.isArray(source.ranges)) {
    return { sourceKey, updatedAt: 0, ranges: [] }
  }
  const ranges = source.ranges.filter(
    (range): range is CachedRange =>
      !!range &&
      typeof range.id === 'string' &&
      Number.isFinite(range.start) &&
      Number.isFinite(range.end) &&
      Number.isFinite(range.size) &&
      Number.isFinite(range.lastAccessed) &&
      range.end > range.start,
  )
  return {
    sourceKey,
    updatedAt: Number.isFinite(source.updatedAt) ? source.updatedAt! : 0,
    ranges,
    ...(typeof source.etag === 'string' ? { etag: source.etag } : {}),
  }
}

const fetchRange = async (
  url: string,
  offset: number,
  length: number,
  signal?: AbortSignal,
  etag?: string,
  customHeaders?: HeadersInit,
): Promise<RangeResponse> => {
  const headers = new Headers(customHeaders)
  headers.set('range', `bytes=${offset}-${offset + length - 1}`)
  const response = await fetch(url, { headers, ...(signal ? { signal } : {}) })
  if (!response.ok && response.status !== 206) {
    throw new Error(`PMTiles range request failed: HTTP ${response.status}`)
  }
  let responseEtag = response.headers.get('etag') ?? undefined
  if (responseEtag?.startsWith('W/')) responseEtag = undefined
  if (etag && responseEtag && etag !== responseEtag) {
    throw new EtagMismatch(`Server returned non-matching ETag ${responseEtag}.`)
  }
  const result: RangeResponse = { data: await response.arrayBuffer() }
  if (responseEtag) result.etag = responseEtag
  return result
}

const coveringRanges = (ranges: CachedRange[], start: number, end: number) => {
  const covering: CachedRange[] = []
  let cursor = start
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    if (range.end <= cursor) continue
    if (range.start > cursor) return null
    covering.push(range)
    cursor = Math.max(cursor, range.end)
    if (cursor >= end) return covering
  }
  return null
}

const readCachedRange = async (
  storageClient: TaskyonStorageClient,
  index: CacheIndex,
  offset: number,
  length: number,
) => {
  const end = offset + length
  const ranges = coveringRanges(index.ranges, offset, end)
  if (!ranges) return null
  const result = new Uint8Array(length)
  let cursor = offset
  for (const range of ranges) {
    const stored = await storageClient.getBlob({
      namespace: cacheBlobNamespace(index.sourceKey),
      id: range.id,
    })
    if (!stored) return null
    const localStart = Math.max(cursor, range.start)
    const localEnd = Math.min(end, range.end)
    result.set(
      stored.data.subarray(localStart - range.start, localEnd - range.start),
      localStart - offset,
    )
    cursor = localEnd
    range.lastAccessed = Date.now()
  }
  return result.buffer
}

const evictRanges = async (
  storageClient: TaskyonStorageClient,
  sourceKey: string,
  ranges: CachedRange[],
): Promise<CachedRange[]> => {
  const sorted = [...ranges].sort((left, right) => left.lastAccessed - right.lastAccessed)
  let total = sorted.reduce((sum, range) => sum + range.size, 0)
  while (total > globalConfig.maxBytesPerArchive && sorted.length > 0) {
    const removed = sorted.shift()!
    total -= removed.size
    await storageClient.deleteBlob({
      namespace: cacheBlobNamespace(sourceKey),
      id: removed.id,
    })
  }
  return sorted
}

class StoragePmtilesSource implements Source {
  constructor(
    private readonly storageClient: TaskyonStorageClient,
    private readonly sourceKey: string,
    private readonly customHeaders?: HeadersInit,
  ) {}

  getKey() {
    return this.sourceKey
  }

  private async index() {
    const stored = await this.storageClient.get({
      namespace: CACHE_INDEX_NAMESPACE,
      id: sourceId(this.sourceKey),
    })
    return parseIndex(stored.value, this.sourceKey)
  }

  private async withSourceLock<T>(operation: () => Promise<T>): Promise<T> {
    const locks = globalThis.navigator?.locks
    return locks
      ? await locks.request(`taskyon:pmtiles:${sourceId(this.sourceKey)}`, operation)
      : await operation()
  }

  private async getBytesLocked(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ) {
    const index = await this.index()
    const cached = await readCachedRange(this.storageClient, index, offset, length)
    if (cached) {
      if (etag && index.etag && etag !== index.etag) {
        throw new EtagMismatch(`Cached ETag mismatch for ${this.sourceKey}.`)
      }
      await this.storageClient.set({
        namespace: CACHE_INDEX_NAMESPACE,
        id: sourceId(this.sourceKey),
        value: { ...index, updatedAt: Date.now() },
      })
      return { data: cached, ...(index.etag ? { etag: index.etag } : {}) }
    }

    const fetched = await fetchRange(
      this.sourceKey,
      offset,
      length,
      signal,
      etag,
      this.customHeaders,
    )
    const data = new Uint8Array(fetched.data)
    if (index.etag && fetched.etag && index.etag !== fetched.etag) await this.clearLocked()
    const id = sha256HashBytes(data).slice('sha256:'.length)
    await this.storageClient.setBlob({
      namespace: cacheBlobNamespace(this.sourceKey),
      id,
      data,
      contentType: 'application/vnd.pmtiles.range',
    })
    const current = index.etag && fetched.etag && index.etag !== fetched.etag ? [] : index.ranges
    const ranges = await evictRanges(this.storageClient, this.sourceKey, [
      ...current.filter((range) => range.start !== offset || range.end !== offset + data.length),
      { id, start: offset, end: offset + data.length, size: data.length, lastAccessed: Date.now() },
    ])
    await this.storageClient.set({
      namespace: CACHE_INDEX_NAMESPACE,
      id: sourceId(this.sourceKey),
      value: {
        sourceKey: this.sourceKey,
        updatedAt: Date.now(),
        ranges,
        ...(fetched.etag ? { etag: fetched.etag } : {}),
      },
    })
    return fetched
  }

  async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string) {
    return await this.withSourceLock(
      async () => await this.getBytesLocked(offset, length, signal, etag),
    )
  }

  private async clearLocked() {
    const index = await this.index()
    await Promise.all(
      index.ranges.map((range) =>
        this.storageClient.deleteBlob({
          namespace: cacheBlobNamespace(this.sourceKey),
          id: range.id,
        }),
      ),
    )
    await this.storageClient.delete({
      namespace: CACHE_INDEX_NAMESPACE,
      id: sourceId(this.sourceKey),
    })
  }

  async clear() {
    await this.withSourceLock(async () => await this.clearLocked())
  }
}

class DirectPmtilesSource implements Source {
  constructor(
    private readonly sourceKey: string,
    private readonly customHeaders?: HeadersInit,
  ) {}
  getKey() {
    return this.sourceKey
  }
  async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string) {
    return await fetchRange(this.sourceKey, offset, length, signal, etag, this.customHeaders)
  }
  async clear() {}
}

export const setPmtilesStorageCacheGlobalConfig = (partial: { maxBytesPerArchive?: number }) => {
  const value = partial.maxBytesPerArchive
  globalConfig.maxBytesPerArchive =
    value && Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MAX_BYTES
}

export const createPmtilesStorageSource = (
  storageClient: TaskyonStorageClient | undefined,
  url: string,
  options: PmtilesCacheOptions = {},
): Source & { clear: () => Promise<void> } =>
  storageClient
    ? new StoragePmtilesSource(storageClient, url, options.customHeaders)
    : new DirectPmtilesSource(url, options.customHeaders)

export const clearPmtilesStorageCache = async (storageClient: TaskyonStorageClient, url: string) =>
  await new StoragePmtilesSource(storageClient, url).clear()

export const getPmtilesStorageCacheDebugSnapshot = async (storageClient: TaskyonStorageClient) => {
  const { rows } = await storageClient.list({ namespace: CACHE_INDEX_NAMESPACE })
  const archives = await Promise.all(
    rows.flatMap((row) => {
      if (!row.data || typeof row.data !== 'object') return []
      const sourceKey = (row.data as Partial<CacheIndex>).sourceKey
      if (typeof sourceKey !== 'string') return []
      return [
        storageClient.listBlobs({ namespace: cacheBlobNamespace(sourceKey) }).then(({ blobs }) => ({
          sourceKey,
          rangeCount: blobs.length,
          bytes: blobs.reduce((sum, blob) => sum + blob.size, 0),
          updatedAt: (row.data as Partial<CacheIndex>).updatedAt ?? null,
          etag: (row.data as Partial<CacheIndex>).etag ?? null,
        })),
      ]
    }),
  )
  return {
    backend: 'StorageClient',
    maxBytesPerArchive: globalConfig.maxBytesPerArchive,
    archiveCount: archives.length,
    totalBytes: archives.reduce((sum, archive) => sum + archive.bytes, 0),
    archives,
  }
}
