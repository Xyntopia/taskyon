import { nextTick, ref, type Ref } from 'vue'
import { Notify } from 'quasar'
import { appendModelicaLog } from './modelica'
import type { ModelicaWorkerClient } from './modelicaWorkerClient'
import { getDefaultModelicaLibraryUrl } from './modelicaLibraryCatalog'
import type {
  LazyModelicaClassTreeNode,
  LazyModelicaLibraryIndex,
} from './lazyModelicaLibraryIndex'

type LibraryParsedCacheMetadata = {
  archiveName: string
  archivePath: string
  archiveFingerprint: string
  cachePath: string
  cacheSchemaVersion: number
  documentCount: number
  fileCount: number
  rumocaVersionMarker: string
}

type LibraryLazyIndexCache = {
  archiveName: string
  archivePath: string
  archiveFingerprint: string
  cacheSchemaVersion: number
  fileCount: number
  totalClasses: number
  rumocaVersionMarker: string
  index: LazyModelicaLibraryIndex
}

const MODELICA_SOURCE_ROOT_CACHE_DIR = 'modelicaSourceRootCache'
const MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION = 1
const MODELICA_LAZY_INDEX_CACHE_DIR = 'modelicaLazyIndexCache'
const MODELICA_LAZY_INDEX_CACHE_SCHEMA_VERSION = 1
const AUTO_RESTORE_FULL_PARSED_CACHE_ON_STARTUP = false

const nowMs = (): number => performance.now()

const elapsedMs = (startedAt: number): number => Math.round(performance.now() - startedAt)

const bytesToMiB = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10

export function useModelicaLibraries(params: {
  worker: Ref<ModelicaWorkerClient | null>
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
  const mslCachedZipPath = ref('')
  const mslDownloadUrl = ref(getDefaultModelicaLibraryUrl())
  const standardMslCachedZipPath = ref('')
  const standardMslLoaded = ref(false)
  const loadedLibraryCachePaths = ref<string[]>([])
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

  function sanitizeOpfsFileName(fileName: string): string {
    const cleaned = String(fileName || '')
      .split('/')
      .pop()
      ?.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
      .trim()
    return cleaned && cleaned.length > 0 ? cleaned : 'ModelicaStandardLibrary-v4.1.0.zip'
  }

  async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
    const navAny = navigator as unknown as {
      storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
    }
    if (!navAny.storage?.getDirectory) {
      throw new Error('OPFS not supported in this browser')
    }
    return await navAny.storage.getDirectory()
  }

  async function writeBlobToOpfsMslCache(blob: Blob, fileNameHint: string): Promise<string> {
    const root = await getOpfsRoot()
    const mslDir = await root.getDirectoryHandle('modelicaMslCache', { create: true })
    const fileName = sanitizeOpfsFileName(fileNameHint)
    const handle = await mslDir.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return `modelicaMslCache/${fileName}`
  }

  async function readFileFromOpfs(relativePath: string): Promise<File> {
    const root = await getOpfsRoot()
    const parts = String(relativePath || '')
      .split('/')
      .filter(Boolean)
    if (parts.length === 0) throw new Error('Missing OPFS path')

    let dir: FileSystemDirectoryHandle = root
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]!)
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]!)
    return await fileHandle.getFile()
  }

  async function readTextFromOpfs(relativePath: string): Promise<string> {
    return await (await readFileFromOpfs(relativePath)).text()
  }

  async function opfsFileExists(relativePath: string): Promise<boolean> {
    try {
      await readFileFromOpfs(relativePath)
      return true
    } catch {
      return false
    }
  }

  async function writeArrayBufferToOpfs(relativePath: string, content: ArrayBuffer): Promise<void> {
    const root = await getOpfsRoot()
    const parts = String(relativePath || '')
      .split('/')
      .filter(Boolean)
    if (parts.length === 0) throw new Error('Missing OPFS path')

    let dir: FileSystemDirectoryHandle = root
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]!, { create: true })
    }
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]!, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(content)
    await writable.close()
  }

  async function writeTextToOpfs(relativePath: string, content: string): Promise<void> {
    const encoder = new TextEncoder()
    await writeArrayBufferToOpfs(relativePath, encoder.encode(content).buffer)
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

  function normalizeCachedZipPath(raw: unknown): string {
    if (typeof raw === 'string') return raw.trim()
    if (raw && typeof raw === 'object') {
      const maybeRef = raw as { value?: unknown; path?: unknown }
      if (typeof maybeRef.value === 'string') return maybeRef.value.trim()
      if (typeof maybeRef.path === 'string') return maybeRef.path.trim()
    }
    const typeLabel = Object.prototype.toString.call(raw)
    throw new Error(`Cached MSL ZIP path has invalid type: ${typeLabel}`)
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
    return [
      `schema=${MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION}`,
      `version=${versionMarker}`,
      `name=${file.name}`,
      `size=${file.size}`,
      `hash=${contentHash}`,
    ].join('|')
  }

  function libraryParsedCachePath(archiveFingerprint: string): string {
    return `${MODELICA_SOURCE_ROOT_CACHE_DIR}/${archiveFingerprint}.bin`
  }

  function libraryParsedCacheMetadataPath(archiveFingerprint: string): string {
    return `${MODELICA_SOURCE_ROOT_CACHE_DIR}/${archiveFingerprint}.json`
  }

  function libraryLazyIndexCachePath(archiveFingerprint: string): string {
    return `${MODELICA_LAZY_INDEX_CACHE_DIR}/${archiveFingerprint}.json`
  }

  async function writeLibraryParsedCacheMetadata(
    metadata: LibraryParsedCacheMetadata,
  ): Promise<void> {
    await writeTextToOpfs(
      libraryParsedCacheMetadataPath(metadata.archiveFingerprint),
      `${JSON.stringify(metadata, null, 2)}\n`,
    )
  }

  async function readLibraryParsedCacheMetadata(
    archiveFingerprint: string,
  ): Promise<LibraryParsedCacheMetadata | null> {
    try {
      const raw = await readTextFromOpfs(libraryParsedCacheMetadataPath(archiveFingerprint))
      const parsed = JSON.parse(raw) as Partial<LibraryParsedCacheMetadata>
      if (parsed.archiveFingerprint !== archiveFingerprint) return null
      if (parsed.cacheSchemaVersion !== MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION) return null
      if (parsed.rumocaVersionMarker !== currentRumocaVersionMarker()) return null
      if (typeof parsed.cachePath !== 'string' || !parsed.cachePath.trim()) return null
      if (!(await opfsFileExists(parsed.cachePath))) return null
      return parsed as LibraryParsedCacheMetadata
    } catch {
      return null
    }
  }

  function parseLazyIndexCache(
    raw: string,
    expectedFingerprint: string,
  ): LibraryLazyIndexCache | null {
    const parsed = JSON.parse(raw) as Partial<LibraryLazyIndexCache>
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
    const cachePath = libraryLazyIndexCachePath(archiveFingerprint)
    const startedAt = nowMs()
    try {
      const raw = await readTextFromOpfs(cachePath)
      const cached = parseLazyIndexCache(raw, archiveFingerprint)
      if (!cached) {
        appendModelicaLog({
          level: 'warning',
          phase: 'general',
          message: `Ignoring stale Modelica lazy index cache after ${elapsedMs(startedAt)} ms: ${cachePath}`,
        })
        return null
      }
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Modelica lazy index cache hit in ${elapsedMs(startedAt)} ms: ${cached.fileCount} files, ${cached.totalClasses} classes`,
        details: {
          cachePath,
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
        details: { cachePath },
      })
      return null
    }
  }

  async function writeLazyLibraryIndexCache(params: {
    archiveName: string
    archivePath: string
    archiveFingerprint: string
    index: LazyModelicaLibraryIndex
  }): Promise<void> {
    const payload: LibraryLazyIndexCache = {
      archiveName: params.archiveName,
      archivePath: params.archivePath,
      archiveFingerprint: params.archiveFingerprint,
      cacheSchemaVersion: MODELICA_LAZY_INDEX_CACHE_SCHEMA_VERSION,
      fileCount: params.index.fileCount,
      totalClasses: params.index.totalClasses,
      rumocaVersionMarker: currentRumocaVersionMarker(),
      index: params.index,
    }
    await writeTextToOpfs(
      libraryLazyIndexCachePath(params.archiveFingerprint),
      `${JSON.stringify(payload)}\n`,
    )
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Cached Modelica lazy index in OPFS: ${payload.fileCount} files, ${payload.totalClasses} classes`,
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
    archivePath: string
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
        archivePath: cacheRequest.archivePath,
        cachePath: metadata?.cachePath,
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
          message: `Restoring full parsed Modelica cache from OPFS in background: ${freshMetadata.archiveName}`,
        })
        const cacheReadStartedAt = nowMs()
        const cacheFile = await readFileFromOpfs(freshMetadata.cachePath)
        const cacheBytes = await cacheFile.arrayBuffer()
        appendModelicaLog({
          level: 'info',
          phase: 'general',
          message: `Read full parsed Modelica cache from OPFS in ${elapsedMs(cacheReadStartedAt)} ms (${bytesToMiB(cacheBytes.byteLength)} MiB)`,
          details: {
            cachePath: freshMetadata.cachePath,
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
            cachePath: freshMetadata.cachePath,
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
      const cachePath = libraryParsedCachePath(cacheRequest.archiveFingerprint)
      const opfsWriteStartedAt = nowMs()
      await writeArrayBufferToOpfs(cachePath, arrayBufferFromUint8Array(cacheBytes))
      await writeLibraryParsedCacheMetadata({
        archiveName: cacheRequest.archiveName,
        archivePath: cacheRequest.archivePath,
        archiveFingerprint: cacheRequest.archiveFingerprint,
        cachePath,
        cacheSchemaVersion: MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION,
        documentCount: cacheRequest.documentCount,
        fileCount: cacheRequest.fileCount,
        rumocaVersionMarker: currentRumocaVersionMarker(),
      })
      handledParsedCacheFingerprints.add(cacheRequest.archiveFingerprint)
      appendModelicaLog({
        level: 'success',
        phase: 'general',
        message: `Full parsed Modelica cache stored in OPFS in ${elapsedMs(taskStartedAt)} ms: ${cacheRequest.archiveName}`,
        details: {
          exportWorkerMs: elapsedMs(exportStartedAt),
          opfsWriteAndMetadataMs: elapsedMs(opfsWriteStartedAt),
          byteLength: cacheBytes.length,
          byteMiB: bytesToMiB(cacheBytes.length),
          sourceRootUriCount: cacheRequest.sourceRootUris.length,
          cachePath,
        },
      })
    })
  }

  function normalizeLibraryCachePaths(paths: string[]): string[] {
    const normalized = paths.map((path) => String(path || '').trim()).filter(Boolean)
    return Array.from(new Set(normalized))
  }

  function trackLoadedLibraryCachePath(path: string): void {
    loadedLibraryCachePaths.value = normalizeLibraryCachePaths([
      ...loadedLibraryCachePaths.value,
      path,
    ])
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

  async function loadLibraryArchiveFile(file: File, archivePath?: string) {
    const worker = params.worker.value
    if (!worker) throw new Error('Modelica worker not loaded')
    const fileReadStartedAt = nowMs()
    const archiveBuffer = await file.arrayBuffer()
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Read Modelica archive bytes in ${elapsedMs(fileReadStartedAt)} ms: ${file.name} (${bytesToMiB(archiveBuffer.byteLength)} MiB)`,
      details: {
        archivePath,
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
        archivePath,
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
        details: { archivePath, archiveName: file.name, fingerprint },
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
          archivePath,
          archiveName: file.name,
          byteLength: archiveBuffer.byteLength,
          byteMiB: bytesToMiB(archiveBuffer.byteLength),
          alreadyLoadedArchiveCount: loadedArchiveFingerprints.value.size,
          mslLoaded: mslLoaded.value,
        },
      })

      const shouldMerge = mslLoaded.value || loadedArchiveFingerprints.value.size > 0
      const cachedLazyIndex =
        !shouldMerge && archivePath ? await readCachedLazyLibraryIndex(fingerprint) : null
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: cachedLazyIndex
          ? 'Restoring Modelica lazy index from OPFS. Source files are still parsed on demand.'
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
          archivePath,
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

      if (archivePath && result.loadMode === 'lazy-index' && result.lazyIndex && !cachedLazyIndex) {
        await writeLazyLibraryIndexCache({
          archiveName: file.name,
          archivePath,
          archiveFingerprint: fingerprint,
          index: result.lazyIndex,
        })
      }

      if (
        AUTO_RESTORE_FULL_PARSED_CACHE_ON_STARTUP &&
        archivePath &&
        result.loadMode === 'lazy-index' &&
        Array.isArray(result.sourceRootUris) &&
        result.sourceRootUris.length > 0
      ) {
        await restoreOrWarmParsedCacheInBackground({
          archiveName: file.name,
          archivePath,
          archiveFingerprint: fingerprint,
          sourceRootUris: result.sourceRootUris,
          fileCount: result.fileCount,
          documentCount: result.documentCount,
        })
      } else if (
        archivePath &&
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
            archivePath,
            sourceRootUriCount: result.sourceRootUris.length,
          },
        })
      }

      if (
        archivePath &&
        result.loadMode !== 'lazy-index' &&
        Array.isArray(result.sourceRootUris) &&
        result.sourceRootUris.length > 0
      ) {
        const cacheBytes = await worker.exportSourceRootBinaryCache(result.sourceRootUris)
        if (cacheBytes.length > 0) {
          const cachePath = libraryParsedCachePath(fingerprint)
          await writeArrayBufferToOpfs(cachePath, arrayBufferFromUint8Array(cacheBytes))
          await writeLibraryParsedCacheMetadata({
            archiveName: file.name,
            archivePath,
            archiveFingerprint: fingerprint,
            cachePath,
            cacheSchemaVersion: MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION,
            documentCount: result.documentCount,
            fileCount: result.fileCount,
            rumocaVersionMarker: currentRumocaVersionMarker(),
          })
          appendModelicaLog({
            level: 'info',
            phase: 'general',
            message: `Cached parsed AST for ${file.name} in OPFS for faster future loads`,
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

  function inferCachedZipPathFromUrl(url: string): string {
    const inferredName = sanitizeOpfsFileName(url)
    return `modelicaMslCache/${inferredName}`
  }

  function resolveLibraryDownloadUrl(urlOverride?: string): string {
    return String(urlOverride || mslDownloadUrl.value || getDefaultModelicaLibraryUrl()).trim()
  }

  async function downloadMslZipToOpfs(urlOverride?: string) {
    const url = resolveLibraryDownloadUrl(urlOverride)
    if (!url) throw new Error('MSL ZIP URL is empty')
    const existingDownload = inFlightDownloads.get(url)
    if (existingDownload) {
      const existingPath = await existingDownload
      mslCachedZipPath.value = existingPath
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
      const path = await writeBlobToOpfsMslCache(blob, fileNameHint)
      mslCachedZipPath.value = path
      const standardUrl = getDefaultModelicaLibraryUrl()
      if (url === standardUrl) {
        standardMslCachedZipPath.value = path
      }
      appendModelicaLog({
        level: 'success',
        phase: 'general',
        message: `MSL ZIP saved to OPFS: ${path}`,
      })
      return path
    })()
    inFlightDownloads.set(url, downloadPromise)
    try {
      const path = await downloadPromise

      Notify.create({
        type: 'positive',
        message: `MSL ZIP downloaded to OPFS (${path})`,
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

  async function loadCachedMslZipFromOpfs(reason?: string) {
    try {
      await nextTick()
      let cachedPath = normalizeCachedZipPath(mslCachedZipPath.value)
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Loading cached MSL ZIP from OPFS${formatLoadReason(reason)}`,
      })
      if (!cachedPath) {
        const fallbackUrl = resolveLibraryDownloadUrl()
        if (!fallbackUrl) {
          throw new Error('No Modelica library download URL configured')
        }
        appendModelicaLog({
          level: 'warning',
          phase: 'general',
          message: `No cached MSL ZIP path set; downloading from ${fallbackUrl}`,
        })
        await downloadMslZipToOpfs()
        cachedPath = normalizeCachedZipPath(mslCachedZipPath.value)
      }
      if (!cachedPath) {
        throw new Error('No cached MSL ZIP path set')
      }
      await loadLibraryArchiveFromOpfsPath(cachedPath)
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

  async function loadStandardMslZipFromOpfs(reason?: string) {
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
      const knownPath = normalizeCachedZipPath(standardMslCachedZipPath.value)
      const inferredPath = inferCachedZipPathFromUrl(standardUrl)
      const candidatePaths = [knownPath, inferredPath].filter(Boolean)
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Loading standard MSL${formatLoadReason(reason)}`,
      })
      let cachedPath = ''
      for (const candidate of candidatePaths) {
        if (await opfsFileExists(candidate)) {
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
        cachedPath = await downloadMslZipToOpfs(standardUrl)
      } else {
        mslCachedZipPath.value = cachedPath
        standardMslCachedZipPath.value = cachedPath
      }
      if (!cachedPath) throw new Error('No cached standard MSL ZIP path set')
      await loadLibraryArchiveFromOpfsPath(cachedPath)
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
      const persistedPath = await writeBlobToOpfsMslCache(file, file.name)
      mslCachedZipPath.value = persistedPath
      await loadLibraryArchiveFile(file, persistedPath)
      trackLoadedLibraryCachePath(persistedPath)
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
      mslLoaded.value = false
      mslArchiveName.value = ''
      mslFileCount.value = 0
      mslCachedZipPath.value = ''
      standardMslCachedZipPath.value = ''
      standardMslLoaded.value = false
      loadedLibraryCachePaths.value = []
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

  async function loadLibraryArchivesFromOpfs(paths: string[], reason?: string) {
    const normalizedPaths = normalizeLibraryCachePaths(paths)
    if (normalizedPaths.length === 0) return
    const startedAt = nowMs()
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Loading ${normalizedPaths.length} persisted Modelica library archive(s)${formatLoadReason(reason)}`,
      details: { paths: normalizedPaths },
    })
    for (const path of normalizedPaths) {
      await loadLibraryArchiveFromOpfsPath(path)
    }
    appendModelicaLog({
      level: 'success',
      phase: 'general',
      message: `Loaded ${normalizedPaths.length} persisted Modelica library archive(s) from OPFS in ${elapsedMs(startedAt)} ms`,
      details: { paths: normalizedPaths },
    })
  }

  async function loadLibraryArchiveFromOpfsPath(path: string) {
    const normalizedPath = String(path || '').trim()
    if (!normalizedPath) throw new Error('Missing OPFS library path')
    const startedAt = nowMs()
    const file = await readFileFromOpfs(normalizedPath)
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Read Modelica archive file handle from OPFS in ${elapsedMs(startedAt)} ms: ${normalizedPath}`,
      details: {
        path: normalizedPath,
        fileName: file.name,
        byteLength: file.size,
        byteMiB: bytesToMiB(file.size),
      },
    })
    await loadLibraryArchiveFile(file, normalizedPath)
    trackLoadedLibraryCachePath(normalizedPath)
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
    mslCachedZipPath,
    standardMslCachedZipPath,
    standardMslLoaded,
    loadedLibraryCachePaths,
    latestLazyLibraryClassTree,
    mslDownloadUrl,
    triggerMslImport,
    downloadMslZipToOpfs,
    loadCachedMslZipFromOpfs,
    loadStandardMslZipFromOpfs,
    loadLibraryArchivesFromOpfs,
    onImportMslZip,
    clearModelicaLibraries,
  }
}
