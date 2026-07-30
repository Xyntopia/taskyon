import { nextTick, ref, type Ref } from 'vue'
import { Notify } from 'quasar'
import { appendModelicaLog } from './modelica'
import type { ModelicaWorkerClient } from './modelicaWorkerClient'
import { getDefaultModelicaLibraryUrl } from './modelicaLibraryCatalog'
import type {
  LazyModelicaClassTreeNode,
  LazyModelicaLibraryIndex,
} from './lazyModelicaLibraryIndex'
import type { TaskyonStorageClient } from '@taskyon/taskyon/api'

type LibraryParsedCacheMetadata = {
  archiveName: string
  archiveId: string
  archiveFingerprint: string
  cacheId: string
  cacheSchemaVersion: number
  documentCount: number
  fileCount: number
  rumocaVersionMarker: string
}

type LibraryLazyIndexCache = {
  archiveName: string
  archiveId: string
  archiveFingerprint: string
  cacheSchemaVersion: number
  fileCount: number
  totalClasses: number
  rumocaVersionMarker: string
  index: LazyModelicaLibraryIndex
}

const MODEL_LIBRARY_ARCHIVE_NAMESPACE = 'modelica/library-archives'
const MODEL_LIBRARY_ARCHIVE_METADATA_NAMESPACE = 'modelica/library-archive-metadata'
const MODEL_LIBRARY_PARSED_NAMESPACE = 'modelica/library-parsed-cache'
const MODEL_LIBRARY_PARSED_METADATA_NAMESPACE = 'modelica/library-parsed-metadata'
const MODEL_LIBRARY_LAZY_INDEX_NAMESPACE = 'modelica/library-lazy-index'
const MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION = 1
const MODELICA_LAZY_INDEX_CACHE_SCHEMA_VERSION = 1
const AUTO_RESTORE_FULL_PARSED_CACHE_ON_STARTUP = false

const nowMs = (): number => performance.now()

const elapsedMs = (startedAt: number): number => Math.round(performance.now() - startedAt)

const bytesToMiB = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10

export function useModelicaLibraries(params: {
  worker: Ref<ModelicaWorkerClient | null>
  storageClient: TaskyonStorageClient
  cacheVersionMarker?: Ref<string>
}) {
  const useModelicaStandardLibrary = ref(false)
  const mslImportEl = ref<HTMLInputElement | null>(null)
  const mslLoaded = ref(false)
  const mslLoading = ref(false)
  const mslDownloading = ref(false)
  const activeLibraryLoads = ref<string[]>([])
  const activeLoadCount = ref(0)
  const activeDownloadCount = ref(0)
  const mslArchiveName = ref('')
  const mslFileCount = ref(0)
  const mslCachedZipId = ref('')
  const mslDownloadUrl = ref(getDefaultModelicaLibraryUrl())
  const standardMslCachedZipId = ref('')
  const standardMslLoaded = ref(false)
  const loadedLibraryCacheIds = ref<string[]>([])
  const latestLazyLibraryClassTree = ref<LazyModelicaClassTreeNode[]>([])
  const loadedArchiveFingerprints = ref<Set<string>>(new Set())
  const inFlightArchiveLoads = new Map<string, Promise<void>>()
  const inFlightDownloads = new Map<string, Promise<string>>()
  const inFlightParsedCacheTasks = new Set<string>()
  const handledParsedCacheFingerprints = new Set<string>()
  let inFlightStandardMslLoad: Promise<void> | null = null

  function triggerMslImport() {
    mslImportEl.value?.click()
  }

  function sanitizeArchiveName(fileName: string): string {
    const cleaned = String(fileName || '')
      .split('/')
      .pop()
      ?.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
      .trim()
    return cleaned && cleaned.length > 0 ? cleaned : 'ModelicaStandardLibrary-v4.1.0.zip'
  }

  async function writeArchive(blob: Blob, fileNameHint: string): Promise<string> {
    const data = new Uint8Array(await blob.arrayBuffer())
    const id = await sha256Hex(arrayBufferFromUint8Array(data))
    await params.storageClient.setBlob({
      namespace: MODEL_LIBRARY_ARCHIVE_NAMESPACE,
      id,
      data,
      contentType: blob.type || 'application/zip',
    })
    await params.storageClient.set({
      namespace: MODEL_LIBRARY_ARCHIVE_METADATA_NAMESPACE,
      id,
      value: { fileName: sanitizeArchiveName(fileNameHint) },
    })
    return id
  }

  async function readArchive(id: string): Promise<File> {
    const stored = await params.storageClient.getBlob({
      namespace: MODEL_LIBRARY_ARCHIVE_NAMESPACE,
      id,
    })
    if (!stored) throw new Error(`Modelica library archive not found: ${id}`)
    const metadata = await params.storageClient.get({
      namespace: MODEL_LIBRARY_ARCHIVE_METADATA_NAMESPACE,
      id,
    })
    const fileName =
      metadata.value &&
      typeof metadata.value === 'object' &&
      'fileName' in metadata.value &&
      typeof metadata.value.fileName === 'string'
        ? metadata.value.fileName
        : `${id}.zip`
    return new File([stored.data], fileName, {
      type: stored.metadata.contentType ?? 'application/zip',
    })
  }

  const archiveExists = async (id: string) =>
    (await params.storageClient.statBlob({ namespace: MODEL_LIBRARY_ARCHIVE_NAMESPACE, id })) !==
    null

  const writeParsedCache = async (id: string, content: ArrayBuffer) =>
    await params.storageClient.setBlob({
      namespace: MODEL_LIBRARY_PARSED_NAMESPACE,
      id,
      data: new Uint8Array(content),
      contentType: 'application/octet-stream',
    })

  const readParsedCache = async (id: string) => {
    const stored = await params.storageClient.getBlob({
      namespace: MODEL_LIBRARY_PARSED_NAMESPACE,
      id,
    })
    if (!stored) throw new Error(`Parsed Modelica cache not found: ${id}`)
    return arrayBufferFromUint8Array(stored.data)
  }

  function arrayBufferFromUint8Array(bytes: Uint8Array): ArrayBuffer {
    if (
      bytes.byteOffset === 0 &&
      bytes.byteLength === bytes.buffer.byteLength &&
      bytes.buffer instanceof ArrayBuffer
    ) {
      return bytes.buffer
    }
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }

  function normalizeCachedZipId(raw: unknown): string {
    if (typeof raw === 'string') return raw.trim()
    if (raw && typeof raw === 'object') {
      const maybeRef = raw as { value?: unknown; id?: unknown }
      if (typeof maybeRef.value === 'string') return maybeRef.value.trim()
      if (typeof maybeRef.id === 'string') return maybeRef.id.trim()
    }
    const typeLabel = Object.prototype.toString.call(raw)
    throw new Error(`Cached MSL ZIP id has invalid type: ${typeLabel}`)
  }

  async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  function currentRumocaVersionMarker(): string {
    const value = params.cacheVersionMarker?.value
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'unknown'
  }

  async function buildArchiveFingerprint(file: File, bytes: ArrayBuffer): Promise<string> {
    const contentHash = await sha256Hex(bytes)
    const versionMarker = currentRumocaVersionMarker()
    const identity = [
      `schema=${MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION}`,
      `version=${versionMarker}`,
      `name=${file.name}`,
      `size=${file.size}`,
      `hash=${contentHash}`,
    ].join('|')
    return await sha256Hex(new TextEncoder().encode(identity).buffer)
  }

  const libraryParsedCacheId = (archiveFingerprint: string) => archiveFingerprint

  async function writeLibraryParsedCacheMetadata(
    metadata: LibraryParsedCacheMetadata,
  ): Promise<void> {
    await params.storageClient.set({
      namespace: MODEL_LIBRARY_PARSED_METADATA_NAMESPACE,
      id: metadata.archiveFingerprint,
      value: metadata,
    })
  }

  async function readLibraryParsedCacheMetadata(
    archiveFingerprint: string,
  ): Promise<LibraryParsedCacheMetadata | null> {
    try {
      const stored = await params.storageClient.get({
        namespace: MODEL_LIBRARY_PARSED_METADATA_NAMESPACE,
        id: archiveFingerprint,
      })
      const parsed = stored.value as Partial<LibraryParsedCacheMetadata> | null
      if (!parsed) return null
      if (parsed.archiveFingerprint !== archiveFingerprint) return null
      if (parsed.cacheSchemaVersion !== MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION) return null
      if (parsed.rumocaVersionMarker !== currentRumocaVersionMarker()) return null
      if (typeof parsed.cacheId !== 'string' || !parsed.cacheId.trim()) return null
      if (
        !(await params.storageClient.statBlob({
          namespace: MODEL_LIBRARY_PARSED_NAMESPACE,
          id: parsed.cacheId,
        }))
      )
        return null
      return parsed as LibraryParsedCacheMetadata
    } catch {
      return null
    }
  }

  function parseLazyIndexCache(
    raw: unknown,
    expectedFingerprint: string,
  ): LibraryLazyIndexCache | null {
    if (!raw || typeof raw !== 'object') return null
    const parsed = raw as Partial<LibraryLazyIndexCache>
    if (parsed.archiveFingerprint !== expectedFingerprint) return null
    if (parsed.cacheSchemaVersion !== MODELICA_LAZY_INDEX_CACHE_SCHEMA_VERSION) return null
    if (parsed.rumocaVersionMarker !== currentRumocaVersionMarker()) return null
    const index = parsed.index
    if (!index || typeof index !== 'object') return null
    if (!Array.isArray(index.classes)) return null
    if (!Array.isArray(index.sourceRootUris)) return null
    if (!index.classToUris || typeof index.classToUris !== 'object') return null
    if (!index.uriToClasses || typeof index.uriToClasses !== 'object') return null
    if (!Number.isFinite(index.totalClasses) || !Number.isFinite(index.fileCount)) return null
    return parsed as LibraryLazyIndexCache
  }

  async function readCachedLazyLibraryIndex(
    archiveFingerprint: string,
  ): Promise<LazyModelicaLibraryIndex | null> {
    const startedAt = nowMs()
    try {
      const stored = await params.storageClient.get({
        namespace: MODEL_LIBRARY_LAZY_INDEX_NAMESPACE,
        id: archiveFingerprint,
      })
      const cached = parseLazyIndexCache(stored.value, archiveFingerprint)
      if (!cached) {
        appendModelicaLog({
          level: 'warning',
          phase: 'general',
          message: `Ignoring stale Modelica lazy index cache after ${elapsedMs(startedAt)} ms: ${archiveFingerprint}`,
        })
        return null
      }
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Modelica lazy index cache hit in ${elapsedMs(startedAt)} ms: ${cached.fileCount} files, ${cached.totalClasses} classes`,
        details: {
          cacheId: archiveFingerprint,
          fileCount: cached.fileCount,
          totalClasses: cached.totalClasses,
        },
      })
      return cached.index
    } catch {
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Modelica lazy index cache miss after ${elapsedMs(startedAt)} ms; archive will be indexed once`,
        details: { cacheId: archiveFingerprint },
      })
      return null
    }
  }

  async function writeLazyLibraryIndexCache(cache: {
    archiveName: string
    archiveId: string
    archiveFingerprint: string
    index: LazyModelicaLibraryIndex
  }): Promise<void> {
    const payload: LibraryLazyIndexCache = {
      archiveName: cache.archiveName,
      archiveId: cache.archiveId,
      archiveFingerprint: cache.archiveFingerprint,
      cacheSchemaVersion: MODELICA_LAZY_INDEX_CACHE_SCHEMA_VERSION,
      fileCount: cache.index.fileCount,
      totalClasses: cache.index.totalClasses,
      rumocaVersionMarker: currentRumocaVersionMarker(),
      index: cache.index,
    }
    await params.storageClient.set({
      namespace: MODEL_LIBRARY_LAZY_INDEX_NAMESPACE,
      id: cache.archiveFingerprint,
      value: payload,
    })
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Cached Modelica lazy index: ${payload.fileCount} files, ${payload.totalClasses} classes`,
    })
  }

  function runParsedCacheTask(
    archiveFingerprint: string,
    delayMs: number,
    task: () => Promise<void>,
  ): void {
    if (
      inFlightParsedCacheTasks.has(archiveFingerprint) ||
      handledParsedCacheFingerprints.has(archiveFingerprint)
    ) {
      return
    }
    inFlightParsedCacheTasks.add(archiveFingerprint)
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Scheduled parsed Modelica cache task in ${delayMs} ms`,
      details: { archiveFingerprint },
    })
    window.setTimeout(() => {
      void task().finally(() => {
        inFlightParsedCacheTasks.delete(archiveFingerprint)
      })
    }, delayMs)
  }

  async function restoreOrWarmParsedCacheInBackground(cacheRequest: {
    archiveName: string
    archiveId: string
    archiveFingerprint: string
    sourceRootUris: string[]
    fileCount: number
    documentCount: number
  }): Promise<void> {
    if (handledParsedCacheFingerprints.has(cacheRequest.archiveFingerprint)) return
    const metadataCheckStartedAt = nowMs()
    const metadata = await readLibraryParsedCacheMetadata(cacheRequest.archiveFingerprint)
    const delayMs = metadata ? 3000 : 30000
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: metadata
        ? `Found parsed Modelica cache metadata in ${elapsedMs(metadataCheckStartedAt)} ms`
        : `No parsed Modelica cache metadata found after ${elapsedMs(metadataCheckStartedAt)} ms`,
      details: {
        archiveName: cacheRequest.archiveName,
        archiveId: cacheRequest.archiveId,
        cacheId: metadata?.cacheId,
        fileCount: metadata?.fileCount ?? cacheRequest.fileCount,
        documentCount: metadata?.documentCount ?? cacheRequest.documentCount,
        sourceRootUriCount: cacheRequest.sourceRootUris.length,
        scheduledDelayMs: delayMs,
      },
    })
    runParsedCacheTask(cacheRequest.archiveFingerprint, delayMs, async () => {
      if (handledParsedCacheFingerprints.has(cacheRequest.archiveFingerprint)) return
      const worker = params.worker.value
      if (!worker) return
      const taskStartedAt = nowMs()
      const freshMetadata = await readLibraryParsedCacheMetadata(cacheRequest.archiveFingerprint)
      if (freshMetadata) {
        appendModelicaLog({
          level: 'info',
          phase: 'general',
          message: `Restoring full parsed Modelica cache in background: ${freshMetadata.archiveName}`,
        })
        const cacheReadStartedAt = nowMs()
        const cacheBytes = await readParsedCache(freshMetadata.cacheId)
        appendModelicaLog({
          level: 'info',
          phase: 'general',
          message: `Read full parsed Modelica cache in ${elapsedMs(cacheReadStartedAt)} ms (${bytesToMiB(cacheBytes.byteLength)} MiB)`,
          details: {
            cacheId: freshMetadata.cacheId,
            byteLength: cacheBytes.byteLength,
            fileCount: freshMetadata.fileCount,
            documentCount: freshMetadata.documentCount,
          },
        })
        const restoreStartedAt = nowMs()
        const restoredCount = await worker.restoreSourceRootBinaryCache(cacheBytes)
        handledParsedCacheFingerprints.add(cacheRequest.archiveFingerprint)
        appendModelicaLog({
          level: 'success',
          phase: 'general',
          message: `Full parsed Modelica cache restored in background in ${elapsedMs(taskStartedAt)} ms: ${restoredCount} source roots`,
          details: {
            restoreWorkerMs: elapsedMs(restoreStartedAt),
            restoredCount,
            cacheId: freshMetadata.cacheId,
          },
        })
        return
      }

      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Building full parsed Modelica cache in background after startup idle delay: ${cacheRequest.archiveName}`,
      })
      const exportStartedAt = nowMs()
      const cacheBytes = await worker.exportSourceRootBinaryCache(cacheRequest.sourceRootUris)
      if (cacheBytes.length === 0) return
      const cacheId = libraryParsedCacheId(cacheRequest.archiveFingerprint)
      const storageWriteStartedAt = nowMs()
      await writeParsedCache(cacheId, arrayBufferFromUint8Array(cacheBytes))
      await writeLibraryParsedCacheMetadata({
        archiveName: cacheRequest.archiveName,
        archiveId: cacheRequest.archiveId,
        archiveFingerprint: cacheRequest.archiveFingerprint,
        cacheId,
        cacheSchemaVersion: MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION,
        documentCount: cacheRequest.documentCount,
        fileCount: cacheRequest.fileCount,
        rumocaVersionMarker: currentRumocaVersionMarker(),
      })
      handledParsedCacheFingerprints.add(cacheRequest.archiveFingerprint)
      appendModelicaLog({
        level: 'success',
        phase: 'general',
        message: `Full parsed Modelica cache stored in ${elapsedMs(taskStartedAt)} ms: ${cacheRequest.archiveName}`,
        details: {
          exportWorkerMs: elapsedMs(exportStartedAt),
          storageWriteAndMetadataMs: elapsedMs(storageWriteStartedAt),
          byteLength: cacheBytes.length,
          byteMiB: bytesToMiB(cacheBytes.length),
          sourceRootUriCount: cacheRequest.sourceRootUris.length,
          cacheId,
        },
      })
    })
  }

  function normalizeLibraryCacheIds(ids: string[]): string[] {
    const normalized = ids.map((id) => String(id || '').trim()).filter(Boolean)
    return Array.from(new Set(normalized))
  }

  function trackLoadedLibraryCacheId(id: string): void {
    loadedLibraryCacheIds.value = normalizeLibraryCacheIds([...loadedLibraryCacheIds.value, id])
  }

  function addActiveLibraryLoad(label: string): void {
    const nextLabel = String(label || '').trim()
    if (!nextLabel) return
    if (activeLibraryLoads.value.includes(nextLabel)) return
    activeLibraryLoads.value = [...activeLibraryLoads.value, nextLabel]
  }

  function removeActiveLibraryLoad(label: string): void {
    activeLibraryLoads.value = activeLibraryLoads.value.filter((entry) => entry !== label)
  }

  function startLoading(label: string): void {
    activeLoadCount.value += 1
    mslLoading.value = true
    addActiveLibraryLoad(label)
  }

  function finishLoading(label: string): void {
    activeLoadCount.value = Math.max(0, activeLoadCount.value - 1)
    removeActiveLibraryLoad(label)
    mslLoading.value = activeLoadCount.value > 0
  }

  function startDownloading(): void {
    activeDownloadCount.value += 1
    mslDownloading.value = true
  }

  function finishDownloading(): void {
    activeDownloadCount.value = Math.max(0, activeDownloadCount.value - 1)
    mslDownloading.value = activeDownloadCount.value > 0
  }

  async function loadLibraryArchiveFile(file: File, archiveId?: string) {
    const worker = params.worker.value
    if (!worker) throw new Error('Modelica worker not loaded')
    const fileReadStartedAt = nowMs()
    const archiveBuffer = await file.arrayBuffer()
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Read Modelica archive bytes in ${elapsedMs(fileReadStartedAt)} ms: ${file.name} (${bytesToMiB(archiveBuffer.byteLength)} MiB)`,
      details: {
        archiveId,
        archiveName: file.name,
        byteLength: archiveBuffer.byteLength,
      },
    })
    const fingerprintStartedAt = nowMs()
    const fingerprint = await buildArchiveFingerprint(file, archiveBuffer)
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Computed Modelica archive fingerprint in ${elapsedMs(fingerprintStartedAt)} ms: ${file.name}`,
      details: {
        archiveId,
        archiveName: file.name,
        fingerprint,
      },
    })
    if (loadedArchiveFingerprints.value.has(fingerprint)) {
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Library archive already loaded, skipping: ${file.name}`,
      })
      return
    }
    const existingLoad = inFlightArchiveLoads.get(fingerprint)
    if (existingLoad) {
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Waiting for in-flight Modelica archive load: ${file.name}`,
        details: { archiveId, archiveName: file.name, fingerprint },
      })
      await existingLoad
      return
    }

    const loadPromise = (async () => {
      const loadStartedAt = nowMs()
      startLoading(file.name)
      await nextTick()
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Loading Modelica library archive: ${file.name}`,
        details: {
          archiveId,
          archiveName: file.name,
          byteLength: archiveBuffer.byteLength,
          byteMiB: bytesToMiB(archiveBuffer.byteLength),
          alreadyLoadedArchiveCount: loadedArchiveFingerprints.value.size,
          mslLoaded: mslLoaded.value,
        },
      })

      const shouldMerge = mslLoaded.value || loadedArchiveFingerprints.value.size > 0
      const cachedLazyIndex =
        !shouldMerge && archiveId ? await readCachedLazyLibraryIndex(fingerprint) : null
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: cachedLazyIndex
          ? 'Restoring Modelica lazy index. Source files are still parsed on demand.'
          : 'Indexing Modelica library for fast browsing. Source files are parsed on demand.',
      })
      if (!cachedLazyIndex) {
        Notify.create({
          type: 'info',
          message:
            'Indexing Modelica library for fast browsing. Source files are parsed on demand.',
        })
      }
      const workerLoadStartedAt = nowMs()
      const result = shouldMerge
        ? await worker.mergeMslZip(file.name, archiveBuffer)
        : await worker.loadMslZip(file.name, archiveBuffer, cachedLazyIndex ?? undefined)
      latestLazyLibraryClassTree.value =
        'classes' in result && Array.isArray(result.classes) && result.classes.length > 0
          ? result.classes
          : []
      loadedArchiveFingerprints.value.add(fingerprint)

      mslLoaded.value = true
      mslArchiveName.value = result.archiveName
      mslFileCount.value = result.fileCount

      const loadMessage =
        result.loadMode === 'lazy-index'
          ? `Modelica libraries indexed: ${result.fileCount} files scanned, ${result.classCount ?? 0} classes discovered`
          : result.loadMode === 'index'
            ? `Modelica libraries indexed: ${result.fileCount} files scanned, ${result.classCount ?? 0} classes discovered`
            : result.loadMode === 'merge'
              ? `Modelica libraries merged: ${result.parsedCount} files parsed`
              : `Modelica libraries loaded: ${result.parsedCount} files parsed`

      appendModelicaLog({
        level: 'success',
        phase: 'general',
        message: `${loadMessage} in ${elapsedMs(loadStartedAt)} ms`,
        details: {
          workerLoadMs: elapsedMs(workerLoadStartedAt),
          archiveId,
          archiveName: result.archiveName,
          loadMode: result.loadMode,
          fileCount: result.fileCount,
          parsedCount: result.parsedCount,
          classCount: 'classCount' in result ? result.classCount : undefined,
          documentCount: result.documentCount,
          sourceRootUriCount: result.sourceRootUris?.length ?? 0,
          usedCachedLazyIndex: Boolean(cachedLazyIndex),
          shouldMerge,
        },
      })

      if (archiveId && result.loadMode === 'lazy-index' && result.lazyIndex && !cachedLazyIndex) {
        await writeLazyLibraryIndexCache({
          archiveName: file.name,
          archiveId,
          archiveFingerprint: fingerprint,
          index: result.lazyIndex,
        })
      }

      if (
        AUTO_RESTORE_FULL_PARSED_CACHE_ON_STARTUP &&
        archiveId &&
        result.loadMode === 'lazy-index' &&
        Array.isArray(result.sourceRootUris) &&
        result.sourceRootUris.length > 0
      ) {
        await restoreOrWarmParsedCacheInBackground({
          archiveName: file.name,
          archiveId,
          archiveFingerprint: fingerprint,
          sourceRootUris: result.sourceRootUris,
          fileCount: result.fileCount,
          documentCount: result.documentCount,
        })
      } else if (
        archiveId &&
        result.loadMode === 'lazy-index' &&
        Array.isArray(result.sourceRootUris) &&
        result.sourceRootUris.length > 0
      ) {
        appendModelicaLog({
          level: 'info',
          phase: 'general',
          message:
            'Skipping automatic full parsed Modelica cache restore during startup; source roots will be parsed on demand.',
          details: {
            archiveName: file.name,
            archiveId,
            sourceRootUriCount: result.sourceRootUris.length,
          },
        })
      }

      if (
        archiveId &&
        result.loadMode !== 'lazy-index' &&
        Array.isArray(result.sourceRootUris) &&
        result.sourceRootUris.length > 0
      ) {
        const cacheBytes = await worker.exportSourceRootBinaryCache(result.sourceRootUris)
        if (cacheBytes.length > 0) {
          const cacheId = libraryParsedCacheId(fingerprint)
          await writeParsedCache(cacheId, arrayBufferFromUint8Array(cacheBytes))
          await writeLibraryParsedCacheMetadata({
            archiveName: file.name,
            archiveId,
            archiveFingerprint: fingerprint,
            cacheId,
            cacheSchemaVersion: MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION,
            documentCount: result.documentCount,
            fileCount: result.fileCount,
            rumocaVersionMarker: currentRumocaVersionMarker(),
          })
          appendModelicaLog({
            level: 'info',
            phase: 'general',
            message: `Cached parsed AST for ${file.name} for faster future loads`,
          })
        }
      }
    })().finally(() => {
      finishLoading(file.name)
    })
    inFlightArchiveLoads.set(fingerprint, loadPromise)
    try {
      await loadPromise
    } finally {
      inFlightArchiveLoads.delete(fingerprint)
    }
  }

  function resolveLibraryDownloadUrl(urlOverride?: string): string {
    return String(urlOverride || mslDownloadUrl.value || getDefaultModelicaLibraryUrl()).trim()
  }

  async function downloadMslZipToStorage(urlOverride?: string) {
    const url = resolveLibraryDownloadUrl(urlOverride)
    if (!url) throw new Error('MSL ZIP URL is empty')
    const existingDownload = inFlightDownloads.get(url)
    if (existingDownload) {
      const existingPath = await existingDownload
      mslCachedZipId.value = existingPath
      return existingPath
    }

    const downloadPromise = (async (): Promise<string> => {
      startDownloading()
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Downloading MSL ZIP: ${url}`,
      })
      const res = await fetch(url)
      if (!res.ok) {
        throw new Error(`Download failed with status ${res.status}`)
      }
      const blob = await res.blob()
      let fileNameHint = 'ModelicaStandardLibrary-v4.1.0.zip'
      try {
        fileNameHint = new URL(url).pathname || fileNameHint
      } catch {
        fileNameHint = url
      }
      const path = await writeArchive(blob, fileNameHint)
      mslCachedZipId.value = path
      const standardUrl = getDefaultModelicaLibraryUrl()
      if (url === standardUrl) {
        standardMslCachedZipId.value = path
      }
      appendModelicaLog({
        level: 'success',
        phase: 'general',
        message: `MSL ZIP saved to storage: ${path}`,
      })
      return path
    })()
    inFlightDownloads.set(url, downloadPromise)
    try {
      const path = await downloadPromise

      Notify.create({
        type: 'positive',
        message: `MSL ZIP downloaded to storage (${path})`,
      })
      return path
    } catch (err) {
      const msg = (err as Error).message
      Notify.create({ type: 'negative', message: `MSL download failed: ${msg}` })
      appendModelicaLog({
        level: 'error',
        phase: 'general',
        message: `MSL download failed: ${msg}`,
      })
      throw err
    } finally {
      inFlightDownloads.delete(url)
      finishDownloading()
    }
  }

  function formatLoadReason(reason: string | undefined): string {
    const normalized = String(reason || '').trim()
    return normalized ? ` (reason: ${normalized})` : ''
  }

  async function loadCachedMslZipFromStorage(reason?: string) {
    try {
      await nextTick()
      let cachedPath = normalizeCachedZipId(mslCachedZipId.value)
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Loading cached MSL ZIP from storage${formatLoadReason(reason)}`,
      })
      if (!cachedPath) {
        const fallbackUrl = resolveLibraryDownloadUrl()
        if (!fallbackUrl) {
          throw new Error('No Modelica library download URL configured')
        }
        appendModelicaLog({
          level: 'warning',
          phase: 'general',
          message: `No cached MSL ZIP ID set; downloading from ${fallbackUrl}`,
        })
        await downloadMslZipToStorage()
        cachedPath = normalizeCachedZipId(mslCachedZipId.value)
      }
      if (!cachedPath) {
        throw new Error('No cached MSL ZIP ID set')
      }
      await loadLibraryArchiveFromStorage(cachedPath)
      Notify.create({
        type: 'positive',
        message: `Loaded cached Modelica library from ${cachedPath}`,
      })
    } catch (err) {
      const msg = (err as Error).message
      Notify.create({ type: 'negative', message: `Failed to load cached MSL ZIP: ${msg}` })
      appendModelicaLog({
        level: 'error',
        phase: 'general',
        message: `Failed to load cached MSL ZIP: ${msg}`,
      })
    }
  }

  async function loadStandardMslZipFromStorage(reason?: string) {
    if (standardMslLoaded.value) return
    if (inFlightStandardMslLoad) {
      await inFlightStandardMslLoad
      return
    }
    inFlightStandardMslLoad = (async () => {
      await nextTick()
      const standardUrl = getDefaultModelicaLibraryUrl()
      if (!standardUrl) {
        throw new Error('No standard Modelica library download URL configured')
      }
      const knownPath = normalizeCachedZipId(standardMslCachedZipId.value)
      const candidatePaths = [knownPath].filter(Boolean)
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Loading standard MSL${formatLoadReason(reason)}`,
      })
      let cachedPath = ''
      for (const candidate of candidatePaths) {
        if (await archiveExists(candidate)) {
          cachedPath = candidate
          break
        }
      }
      if (!cachedPath) {
        appendModelicaLog({
          level: 'info',
          phase: 'general',
          message: `Standard MSL cache missing; downloading from ${standardUrl}`,
        })
        cachedPath = await downloadMslZipToStorage(standardUrl)
      } else {
        mslCachedZipId.value = cachedPath
        standardMslCachedZipId.value = cachedPath
      }
      if (!cachedPath) throw new Error('No cached standard MSL ZIP ID set')
      await loadLibraryArchiveFromStorage(cachedPath)
      standardMslLoaded.value = true
      Notify.create({
        type: 'positive',
        message: `Loaded standard MSL from ${cachedPath}`,
      })
    })()
    try {
      await inFlightStandardMslLoad
    } catch (err) {
      const msg = (err as Error).message
      Notify.create({ type: 'negative', message: `Failed to load standard MSL: ${msg}` })
      appendModelicaLog({
        level: 'error',
        phase: 'general',
        message: `Failed to load standard MSL: ${msg}`,
      })
    } finally {
      inFlightStandardMslLoad = null
    }
  }

  async function onImportMslZip(e: Event) {
    const el = e.target as HTMLInputElement
    const file = el.files?.[0]
    if (!file) return

    try {
      const persistedPath = await writeArchive(file, file.name)
      mslCachedZipId.value = persistedPath
      await loadLibraryArchiveFile(file, persistedPath)
      trackLoadedLibraryCacheId(persistedPath)
      Notify.create({ type: 'positive', message: `Loaded MSL archive: ${file.name}` })
    } catch (err) {
      mslLoaded.value = false
      mslArchiveName.value = ''
      mslFileCount.value = 0
      const msg = (err as Error).message
      appendModelicaLog({
        level: 'error',
        phase: 'general',
        message: `Failed to load MSL archive: ${msg}`,
      })
      Notify.create({ type: 'negative', message: `Failed to load MSL: ${msg}` })
    } finally {
      el.value = ''
    }
  }

  async function clearModelicaLibraries() {
    try {
      const worker = params.worker.value
      if (!worker) throw new Error('Modelica worker not loaded')
      await worker.clearLibraries()
      await Promise.all([
        params.storageClient.clearBlobs({ namespace: MODEL_LIBRARY_ARCHIVE_NAMESPACE }),
        params.storageClient.clear({ namespace: MODEL_LIBRARY_ARCHIVE_METADATA_NAMESPACE }),
        params.storageClient.clearBlobs({ namespace: MODEL_LIBRARY_PARSED_NAMESPACE }),
        params.storageClient.clear({ namespace: MODEL_LIBRARY_PARSED_METADATA_NAMESPACE }),
        params.storageClient.clear({ namespace: MODEL_LIBRARY_LAZY_INDEX_NAMESPACE }),
      ])
      mslLoaded.value = false
      mslArchiveName.value = ''
      mslFileCount.value = 0
      mslCachedZipId.value = ''
      standardMslCachedZipId.value = ''
      standardMslLoaded.value = false
      loadedLibraryCacheIds.value = []
      latestLazyLibraryClassTree.value = []
      loadedArchiveFingerprints.value = new Set()
      inFlightArchiveLoads.clear()
      inFlightDownloads.clear()
      inFlightStandardMslLoad = null
      activeLoadCount.value = 0
      activeDownloadCount.value = 0
      activeLibraryLoads.value = []
      mslLoading.value = false
      mslDownloading.value = false
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: 'Cleared cached Modelica libraries',
      })
      Notify.create({ type: 'positive', message: 'Cleared Modelica library cache' })
    } catch (err) {
      Notify.create({
        type: 'negative',
        message: `Failed to clear Modelica libraries: ${(err as Error).message}`,
      })
    }
  }

  async function loadLibraryArchivesFromStorage(paths: string[], reason?: string) {
    const normalizedPaths = normalizeLibraryCacheIds(paths)
    if (normalizedPaths.length === 0) return
    const startedAt = nowMs()
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Loading ${normalizedPaths.length} persisted Modelica library archive(s)${formatLoadReason(reason)}`,
      details: { paths: normalizedPaths },
    })
    for (const path of normalizedPaths) {
      await loadLibraryArchiveFromStorage(path)
    }
    appendModelicaLog({
      level: 'success',
      phase: 'general',
      message: `Loaded ${normalizedPaths.length} persisted Modelica library archive(s) from storage in ${elapsedMs(startedAt)} ms`,
      details: { paths: normalizedPaths },
    })
  }

  async function loadLibraryArchiveFromStorage(path: string) {
    const normalizedPath = String(path || '').trim()
    if (!normalizedPath) throw new Error('Missing Modelica library storage id')
    const startedAt = nowMs()
    const file = await readArchive(normalizedPath)
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Read Modelica archive from storage in ${elapsedMs(startedAt)} ms: ${normalizedPath}`,
      details: {
        path: normalizedPath,
        fileName: file.name,
        byteLength: file.size,
        byteMiB: bytesToMiB(file.size),
      },
    })
    await loadLibraryArchiveFile(file, normalizedPath)
    trackLoadedLibraryCacheId(normalizedPath)
  }

  return {
    useModelicaStandardLibrary,
    mslImportEl,
    mslLoaded,
    mslLoading,
    mslDownloading,
    activeLibraryLoads,
    mslArchiveName,
    mslFileCount,
    mslCachedZipId,
    standardMslCachedZipId,
    standardMslLoaded,
    loadedLibraryCacheIds,
    latestLazyLibraryClassTree,
    mslDownloadUrl,
    triggerMslImport,
    downloadMslZipToStorage,
    loadCachedMslZipFromStorage,
    loadStandardMslZipFromStorage,
    loadLibraryArchivesFromStorage,
    onImportMslZip,
    clearModelicaLibraries,
  }
}
