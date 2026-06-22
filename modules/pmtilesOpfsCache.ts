import { EtagMismatch, type RangeResponse, type Source } from 'pmtiles'

const CACHE_DIR = 'pmtiles-opfs-cache'
const FOOTER_MAGIC = 'PMOCIDX1'
const FOOTER_TRAILER_BYTES = 12
const VERSION = 1
const channelName = 'pmtiles-opfs-cache-events'

type CachedSegment = {
  start: number
  end: number
  dataOffset: number
  lastAccessed: number
}

type CacheFooter = {
  version: number
  sourceKey: string
  etag?: string
  updatedAt: number
  ranges: CachedSegment[]
}

type ParsedFooter = {
  footer: CacheFooter
  footerOffset: number
  fileSize: number
}

type CacheState = {
  fileHandle: FileSystemFileHandle
  footer: CacheFooter
  footerOffset: number
  dirty: boolean
}

interface PmtilesOpfsSourceOptions {
  customHeaders?: HeadersInit
  lockNamespace?: string
}

interface PmtilesOpfsCacheGlobalConfig {
  maxBytesPerArchive: number
}

type PmtilesOpfsCacheDebugEntry = {
  sourceKey: string
  fileName: string
  fileSizeBytes: number
  liveBytes: number
  rangeCount: number
  etag?: string
  updatedAt: number
}

type PmtilesOpfsCacheDebugSnapshot = {
  config: PmtilesOpfsCacheGlobalConfig
  totalFiles: number
  totalFileSizeBytes: number
  totalLiveBytes: number
  entries: PmtilesOpfsCacheDebugEntry[]
}

const DEFAULT_MAX_BYTES = 1024 * 1024 * 1024
const globalConfig: PmtilesOpfsCacheGlobalConfig = {
  maxBytesPerArchive: DEFAULT_MAX_BYTES,
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer
  }
  return bytes.slice().buffer
}

const keyHash = (input: string): string => {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

const getRootDir = async (): Promise<FileSystemDirectoryHandle> => {
  return navigator.storage.getDirectory()
}

const getOrCreateCacheDir = async (): Promise<FileSystemDirectoryHandle> => {
  const root = await getRootDir()
  return root.getDirectoryHandle(CACHE_DIR, { create: true })
}

const buildFileName = (sourceKey: string): string => {
  return `${keyHash(sourceKey)}.pmtcache`
}

const emptyFooter = (sourceKey: string): CacheFooter => ({
  version: VERSION,
  sourceKey,
  updatedAt: Date.now(),
  ranges: [],
})

const normalizeSegments = (segments: CachedSegment[]): CachedSegment[] => {
  if (segments.length === 0) return []
  const sorted = [...segments].sort((a, b) => a.start - b.start || a.end - b.end)
  const normalized: CachedSegment[] = []

  for (const seg of sorted) {
    const prev = normalized[normalized.length - 1]
    if (!prev) {
      normalized.push(seg)
      continue
    }

    if (seg.end <= prev.end) {
      continue
    }

    if (seg.start < prev.end) {
      normalized.push({
        start: prev.end,
        end: seg.end,
        dataOffset: seg.dataOffset + (prev.end - seg.start),
        lastAccessed: seg.lastAccessed,
      })
      continue
    }

    normalized.push(seg)
  }

  return normalized
}

const liveBytes = (segments: CachedSegment[]): number =>
  segments.reduce((acc, segment) => acc + (segment.end - segment.start), 0)

const readBlobAsArrayBuffer = async (
  fileHandle: FileSystemFileHandle,
  start: number,
  end: number,
): Promise<ArrayBuffer> => {
  const file = await fileHandle.getFile()
  return file.slice(start, end).arrayBuffer()
}

const encodeFooter = (footer: CacheFooter): Uint8Array => {
  return new TextEncoder().encode(JSON.stringify(footer))
}

const parseFooter = async (fileHandle: FileSystemFileHandle): Promise<ParsedFooter | null> => {
  const file = await fileHandle.getFile()
  const fileSize = file.size
  if (fileSize < FOOTER_TRAILER_BYTES) return null

  const trailer = await file.slice(fileSize - FOOTER_TRAILER_BYTES, fileSize).arrayBuffer()
  const trailerView = new DataView(trailer)
  const footerLength = trailerView.getUint32(0, true)
  const magic = new TextDecoder().decode(new Uint8Array(trailer, 4, 8))

  if (magic !== FOOTER_MAGIC) return null
  if (footerLength > fileSize - FOOTER_TRAILER_BYTES) return null

  const footerStart = fileSize - FOOTER_TRAILER_BYTES - footerLength
  const footerBuffer = await file.slice(footerStart, fileSize - FOOTER_TRAILER_BYTES).arrayBuffer()
  const footerText = new TextDecoder().decode(footerBuffer)
  const parsed = JSON.parse(footerText) as CacheFooter

  if (!parsed || parsed.version !== VERSION || typeof parsed.sourceKey !== 'string') return null
  if (!Array.isArray(parsed.ranges)) return null

  const parsedRanges = parsed.ranges
    .filter((segment) => {
      return (
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        Number.isFinite(segment.dataOffset) &&
        segment.end > segment.start
      )
    })
    .map((segment) => ({
      ...segment,
      lastAccessed: Number.isFinite(segment.lastAccessed) ? segment.lastAccessed : parsed.updatedAt,
    }))

  return {
    footer: {
      ...parsed,
      ranges: normalizeSegments(parsedRanges),
    },
    footerOffset: footerStart,
    fileSize,
  }
}

const findCoveringSegments = (
  segments: CachedSegment[],
  rangeStart: number,
  rangeEnd: number,
): CachedSegment[] | null => {
  if (rangeStart >= rangeEnd) return []
  const covering: CachedSegment[] = []
  let cursor = rangeStart

  for (const segment of segments) {
    if (segment.end <= cursor) continue
    if (segment.start > cursor) return null
    if (segment.start <= cursor && segment.end > cursor) {
      covering.push(segment)
      cursor = segment.end
      if (cursor >= rangeEnd) return covering
    }
  }

  return null
}

const assembleFromSegments = async (
  fileHandle: FileSystemFileHandle,
  segments: CachedSegment[],
  start: number,
  end: number,
): Promise<ArrayBuffer> => {
  const totalLength = end - start
  const result = new Uint8Array(totalLength)
  let written = 0
  let cursor = start

  for (const segment of segments) {
    if (cursor >= end) break
    const localStart = Math.max(cursor, segment.start)
    const localEnd = Math.min(end, segment.end)
    if (localEnd <= localStart) continue

    const readStart = segment.dataOffset + (localStart - segment.start)
    const readEnd = readStart + (localEnd - localStart)
    const bytes = new Uint8Array(await readBlobAsArrayBuffer(fileHandle, readStart, readEnd))
    result.set(bytes, written)
    written += bytes.length
    cursor = localEnd
  }

  return result.buffer
}

const makeLockName = (sourceKey: string, lockNamespace: string): string => {
  return `${lockNamespace}:${keyHash(sourceKey)}`
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

  const init: RequestInit = { headers }
  if (signal) init.signal = signal
  const response = await fetch(url, init)

  let responseEtag = response.headers.get('Etag') ?? undefined
  if (responseEtag?.startsWith('W/')) responseEtag = undefined

  if (etag && responseEtag && etag !== responseEtag) {
    throw new EtagMismatch(`Server returned non-matching ETag ${responseEtag}.`)
  }

  if (response.status >= 300) {
    throw new Error(`Bad response code: ${response.status}`)
  }

  const contentLength = response.headers.get('Content-Length')
  if (response.status === 200 && (!contentLength || Number(contentLength) > length)) {
    throw new Error(
      'Server did not return a valid ranged response. Ensure HTTP Byte Serving is enabled.',
    )
  }

  const result: RangeResponse = { data: await response.arrayBuffer() }
  const cacheControl = response.headers.get('Cache-Control')
  const expires = response.headers.get('Expires')
  if (responseEtag) result.etag = responseEtag
  if (cacheControl) result.cacheControl = cacheControl
  if (expires) result.expires = expires
  return result
}

const loadState = async (
  sourceKey: string,
  fileHandle: FileSystemFileHandle,
): Promise<{ footer: CacheFooter; footerOffset: number }> => {
  const parsed = await parseFooter(fileHandle)
  if (parsed && parsed.footer.sourceKey === sourceKey) {
    return { footer: parsed.footer, footerOffset: parsed.footerOffset }
  }
  const file = await fileHandle.getFile()
  return { footer: emptyFooter(sourceKey), footerOffset: file.size }
}

const writeFooter = async (
  writable: FileSystemWritableFileStream,
  dataEnd: number,
  footer: CacheFooter,
): Promise<void> => {
  const footerBytes = encodeFooter(footer)
  const trailer = new Uint8Array(FOOTER_TRAILER_BYTES)
  const trailerView = new DataView(trailer.buffer)
  trailerView.setUint32(0, footerBytes.length, true)
  trailer.set(new TextEncoder().encode(FOOTER_MAGIC), 4)

  await writable.write({
    type: 'write',
    position: dataEnd,
    data: toArrayBuffer(footerBytes),
  })
  await writable.write({
    type: 'write',
    position: dataEnd + footerBytes.length,
    data: toArrayBuffer(trailer),
  })
}

const enforceMaxBytes = (segments: CachedSegment[], maxBytesPerArchive: number): CachedSegment[] => {
  if (!Number.isFinite(maxBytesPerArchive) || maxBytesPerArchive <= 0) return []

  const kept = [...segments]
  while (liveBytes(kept) > maxBytesPerArchive && kept.length > 0) {
    let oldestIndex = 0
    for (let i = 1; i < kept.length; i += 1) {
      if ((kept[i]?.lastAccessed ?? 0) < (kept[oldestIndex]?.lastAccessed ?? 0)) oldestIndex = i
    }
    kept.splice(oldestIndex, 1)
  }
  return kept
}

const compactArchive = async (
  fileHandle: FileSystemFileHandle,
  footer: CacheFooter,
): Promise<{ footer: CacheFooter; footerOffset: number }> => {
  const liveSegments = enforceMaxBytes(footer.ranges, globalConfig.maxBytesPerArchive)
  const sorted = [...liveSegments].sort((a, b) => a.dataOffset - b.dataOffset)

  let writePosition = 0
  const rewritten: CachedSegment[] = []
  const writable = await fileHandle.createWritable()

  for (const segment of sorted) {
    const readStart = segment.dataOffset
    const readEnd = segment.dataOffset + (segment.end - segment.start)
    const bytes = new Uint8Array(await readBlobAsArrayBuffer(fileHandle, readStart, readEnd))
    await writable.write({
      type: 'write',
      position: writePosition,
      data: toArrayBuffer(bytes),
    })
    rewritten.push({
      ...segment,
      dataOffset: writePosition,
    })
    writePosition += bytes.byteLength
  }

  const nextFooter: CacheFooter = {
    ...footer,
    ranges: normalizeSegments(rewritten),
    updatedAt: Date.now(),
  }

  await writeFooter(writable, writePosition, nextFooter)
  await writable.close()

  return {
    footer: nextFooter,
    footerOffset: writePosition,
  }
}

class PmtilesOpfsSource implements Source {
  private readonly sourceKey: string
  private readonly lockName: string
  private readonly customHeaders: HeadersInit | undefined
  private cacheState: CacheState | null = null
  private channel: BroadcastChannel | null = null

  constructor(sourceKey: string, options: PmtilesOpfsSourceOptions = {}) {
    this.sourceKey = sourceKey
    this.customHeaders = options.customHeaders
    this.lockName = makeLockName(sourceKey, options.lockNamespace ?? 'pmtiles-opfs-source')

    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(channelName)
      this.channel.onmessage = (event) => {
        if (event.data?.sourceKey === this.sourceKey) {
          if (this.cacheState) this.cacheState.dirty = true
        }
      }
    }
  }

  getKey(): string {
    return this.sourceKey
  }

  private async getState(): Promise<CacheState> {
    if (this.cacheState && !this.cacheState.dirty) return this.cacheState

    const dir = await getOrCreateCacheDir()
    const fileHandle = await dir.getFileHandle(buildFileName(this.sourceKey), { create: true })
    const loaded = await loadState(this.sourceKey, fileHandle)

    this.cacheState = {
      fileHandle,
      footer: loaded.footer,
      footerOffset: loaded.footerOffset,
      dirty: false,
    }

    return this.cacheState
  }

  private async reloadState(): Promise<CacheState> {
    this.cacheState = null
    return this.getState()
  }

  private notifyChange(): void {
    if (this.channel) {
      this.channel.postMessage({ sourceKey: this.sourceKey, ts: Date.now() })
    }
  }

  private async tryReadCached(offset: number, length: number): Promise<RangeResponse | null> {
    const state = await this.getState()
    const rangeEnd = offset + length
    const covering = findCoveringSegments(state.footer.ranges, offset, rangeEnd)
    if (!covering) return null

    const now = Date.now()
    for (const segment of covering) {
      segment.lastAccessed = now
    }

    const data = await assembleFromSegments(state.fileHandle, covering, offset, rangeEnd)
    const result: RangeResponse = { data }
    if (state.footer.etag) result.etag = state.footer.etag
    return result
  }

  async getBytes(
    offset: number,
    length: number,
    signal?: AbortSignal,
    etag?: string,
  ): Promise<RangeResponse> {
    const cached = await this.tryReadCached(offset, length)
    if (cached) {
      if (etag && cached.etag && etag !== cached.etag) {
        throw new EtagMismatch(`Cached ETag mismatch for ${this.sourceKey}.`)
      }
      return cached
    }

    const fetched = await fetchRange(this.sourceKey, offset, length, signal, etag, this.customHeaders)

    return navigator.locks.request(this.lockName, async () => {
      const state = await this.reloadState()

      const nowCached = await this.tryReadCached(offset, length)
      if (nowCached) return nowCached

      if (etag && fetched.etag && etag !== fetched.etag) {
        throw new EtagMismatch(`Server returned non-matching ETag ${fetched.etag}.`)
      }

      if (state.footer.etag && fetched.etag && state.footer.etag !== fetched.etag) {
        state.footer = emptyFooter(this.sourceKey)
        state.footerOffset = 0
      }

      const data = new Uint8Array(fetched.data)
      const segment: CachedSegment = {
        start: offset,
        end: offset + data.byteLength,
        dataOffset: state.footerOffset,
        lastAccessed: Date.now(),
      }

      const writable = await state.fileHandle.createWritable({ keepExistingData: true })
      await writable.truncate(state.footerOffset)
      await writable.write({
        type: 'write',
        position: state.footerOffset,
        data: toArrayBuffer(data),
      })

      const dataEnd = state.footerOffset + data.byteLength
      const mergedFooter: CacheFooter = {
        ...state.footer,
        updatedAt: Date.now(),
        ranges: normalizeSegments([...state.footer.ranges, segment]),
      }
      const mergedEtag = fetched.etag ?? state.footer.etag
      if (mergedEtag) mergedFooter.etag = mergedEtag

      await writeFooter(writable, dataEnd, mergedFooter)
      await writable.close()

      const postWriteLiveBytes = liveBytes(mergedFooter.ranges)
      if (postWriteLiveBytes > globalConfig.maxBytesPerArchive) {
        const compacted = await compactArchive(state.fileHandle, mergedFooter)
        state.footer = compacted.footer
        state.footerOffset = compacted.footerOffset
      } else {
        state.footer = mergedFooter
        state.footerOffset = dataEnd
      }
      state.dirty = false
      this.notifyChange()

      return fetched
    })
  }

  async clear(): Promise<void> {
    await navigator.locks.request(this.lockName, async () => {
      const dir = await getOrCreateCacheDir()
      await dir.removeEntry(buildFileName(this.sourceKey)).catch(() => {})
      this.cacheState = null
      this.notifyChange()
    })
  }
}

export function setPmtilesOpfsCacheGlobalConfig(
  partial: Partial<PmtilesOpfsCacheGlobalConfig>,
): void {
  if (partial.maxBytesPerArchive != null) {
    if (!Number.isFinite(partial.maxBytesPerArchive) || partial.maxBytesPerArchive <= 0) {
      globalConfig.maxBytesPerArchive = DEFAULT_MAX_BYTES
    } else {
      globalConfig.maxBytesPerArchive = Math.floor(partial.maxBytesPerArchive)
    }
  }
}

export function getPmtilesOpfsCacheGlobalConfig(): PmtilesOpfsCacheGlobalConfig {
  return { ...globalConfig }
}

export async function getPmtilesOpfsCacheDebugSnapshot(): Promise<PmtilesOpfsCacheDebugSnapshot> {
  const empty: PmtilesOpfsCacheDebugSnapshot = {
    config: getPmtilesOpfsCacheGlobalConfig(),
    totalFiles: 0,
    totalFileSizeBytes: 0,
    totalLiveBytes: 0,
    entries: [],
  }

  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return empty

  const dir = await getOrCreateCacheDir().catch(() => null)
  if (!dir) return empty

  const entries: PmtilesOpfsCacheDebugEntry[] = []

  const iterable =
    typeof (dir as unknown as { entries?: unknown }).entries === 'function'
      ? (dir as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries()
      : null

  if (!iterable) return empty

  // OPFS directory iteration is async by design.
  for await (const [fileName, handle] of iterable) {
    if (handle.kind !== 'file') continue
    const fileHandle = handle as FileSystemFileHandle
    const parsed = await parseFooter(fileHandle)
    const file = await fileHandle.getFile()
    if (!parsed) {
      entries.push({
        sourceKey: '(unrecognized)',
        fileName,
        fileSizeBytes: file.size,
        liveBytes: 0,
        rangeCount: 0,
        updatedAt: 0,
      })
      continue
    }

    const entry: PmtilesOpfsCacheDebugEntry = {
      sourceKey: parsed.footer.sourceKey,
      fileName,
      fileSizeBytes: file.size,
      liveBytes: liveBytes(parsed.footer.ranges),
      rangeCount: parsed.footer.ranges.length,
      updatedAt: parsed.footer.updatedAt,
    }
    if (parsed.footer.etag) entry.etag = parsed.footer.etag
    entries.push(entry)
  }

  entries.sort((a, b) => b.updatedAt - a.updatedAt)

  return {
    config: getPmtilesOpfsCacheGlobalConfig(),
    totalFiles: entries.length,
    totalFileSizeBytes: entries.reduce((acc, entry) => acc + entry.fileSizeBytes, 0),
    totalLiveBytes: entries.reduce((acc, entry) => acc + entry.liveBytes, 0),
    entries,
  }
}

export function createPmtilesOpfsSource(
  url: string,
  options: PmtilesOpfsSourceOptions = {},
): Source & { clear: () => Promise<void> } {
  return new PmtilesOpfsSource(url, options)
}

export async function clearPmtilesOpfsCache(url: string): Promise<void> {
  const source = new PmtilesOpfsSource(url)
  await source.clear()
}
