import { nextTick, ref, type Ref } from 'vue'
import { Notify } from 'quasar'
import { appendModelicaLog } from './modelica'
import type {
  BundledSourceRootArchive,
  BundledSourceRootManifest,
  ModelicaWorkerClient,
} from './modelicaWorkerClient'
import { getDefaultModelicaLibraryUrl } from './modelicaLibraryCatalog'

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

const MODELICA_SOURCE_ROOT_CACHE_DIR = 'modelicaSourceRootCache'
const MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION = 1

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
  const loadedArchiveFingerprints = ref<Set<string>>(new Set())
  const inFlightArchiveLoads = new Map<string, Promise<void>>()
  const inFlightDownloads = new Map<string, Promise<string>>()
  let inFlightStandardMslLoad: Promise<void> | null = null
  let bundledStandardMslArchive: BundledSourceRootArchive | null | undefined

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

  async function readArrayBufferFromOpfs(relativePath: string): Promise<ArrayBuffer> {
    const file = await readFileFromOpfs(relativePath)
    return await file.arrayBuffer()
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

  async function readTextFromOpfs(relativePath: string): Promise<string> {
    const file = await readFileFromOpfs(relativePath)
    return await file.text()
  }

  async function deleteOpfsFile(relativePath: string): Promise<void> {
    const root = await getOpfsRoot()
    const parts = String(relativePath || '')
      .split('/')
      .filter(Boolean)
    if (parts.length === 0) throw new Error('Missing OPFS path')

    let dir: FileSystemDirectoryHandle = root
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i]!)
    }
    await dir.removeEntry(parts[parts.length - 1]!)
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

  async function readLibraryParsedCacheMetadata(
    archiveFingerprint: string,
  ): Promise<LibraryParsedCacheMetadata | null> {
    try {
      const raw = await readTextFromOpfs(libraryParsedCacheMetadataPath(archiveFingerprint))
      const parsed = JSON.parse(raw) as Partial<LibraryParsedCacheMetadata>
      if (
        typeof parsed.archivePath !== 'string' ||
        typeof parsed.cachePath !== 'string' ||
        typeof parsed.archiveFingerprint !== 'string' ||
        typeof parsed.archiveName !== 'string'
      ) {
        return null
      }
      return {
        archiveName: parsed.archiveName,
        archivePath: parsed.archivePath,
        archiveFingerprint: parsed.archiveFingerprint,
        cachePath: parsed.cachePath,
        cacheSchemaVersion: Number(parsed.cacheSchemaVersion) || 0,
        documentCount: Number(parsed.documentCount) || 0,
        fileCount: Number(parsed.fileCount) || 0,
        rumocaVersionMarker: String(parsed.rumocaVersionMarker || ''),
      }
    } catch {
      return null
    }
  }

  async function writeLibraryParsedCacheMetadata(
    metadata: LibraryParsedCacheMetadata,
  ): Promise<void> {
    await writeTextToOpfs(
      libraryParsedCacheMetadataPath(metadata.archiveFingerprint),
      `${JSON.stringify(metadata, null, 2)}\n`,
    )
  }

  async function deleteLibraryParsedCache(archiveFingerprint: string): Promise<void> {
    const deleteIfPresent = async (path: string): Promise<void> => {
      try {
        await deleteOpfsFile(path)
      } catch {
        // Ignore missing entries while clearing stale cache artifacts.
      }
    }
    await deleteIfPresent(libraryParsedCachePath(archiveFingerprint))
    await deleteIfPresent(libraryParsedCacheMetadataPath(archiveFingerprint))
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
    const archiveBuffer = await file.arrayBuffer()
    const fingerprint = await buildArchiveFingerprint(file, archiveBuffer)
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
      await existingLoad
      return
    }

    const loadPromise = (async () => {
      startLoading(file.name)
      await nextTick()
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Loading Modelica library archive: ${file.name}`,
      })

      if (archivePath) {
        const cacheMetadata = await readLibraryParsedCacheMetadata(fingerprint)
        if (cacheMetadata && (await opfsFileExists(cacheMetadata.cachePath))) {
          try {
            const cachedBuffer = await readArrayBufferFromOpfs(cacheMetadata.cachePath)
            const restoredCount = await worker.restoreSourceRootBinaryCache(cachedBuffer)
            loadedArchiveFingerprints.value.add(fingerprint)
            mslLoaded.value = true
            mslArchiveName.value = file.name
            mslFileCount.value = cacheMetadata.fileCount || restoredCount
            appendModelicaLog({
              level: 'success',
              phase: 'general',
              message: `Restored cached AST for ${file.name}: ${restoredCount} documents loaded`,
            })
            return
          } catch (error) {
            await deleteLibraryParsedCache(fingerprint)
            appendModelicaLog({
              level: 'warning',
              phase: 'general',
              message: `Discarded stale cached AST for ${file.name}: ${(error as Error).message}`,
            })
          }
        }
      }

      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message:
          'First load of this library may take a little longer while creating the cached AST for future loads.',
      })
      Notify.create({
        type: 'info',
        message:
          'First load of this library may take a little longer while creating the cached AST for future loads.',
      })

      const shouldMerge = mslLoaded.value || loadedArchiveFingerprints.value.size > 0
      const result = shouldMerge
        ? await worker.mergeMslZip(file.name, archiveBuffer)
        : await worker.loadMslZip(file.name, archiveBuffer)
      loadedArchiveFingerprints.value.add(fingerprint)

      mslLoaded.value = true
      mslArchiveName.value = result.archiveName
      mslFileCount.value = result.fileCount

      const loadMessage =
        result.loadMode === 'index'
          ? `Modelica libraries indexed: ${result.fileCount} files scanned, ${result.classCount ?? 0} classes discovered`
          : result.loadMode === 'merge'
            ? `Modelica libraries merged: ${result.parsedCount} files parsed`
            : `Modelica libraries loaded: ${result.parsedCount} files parsed`

      appendModelicaLog({
        level: 'success',
        phase: 'general',
        message: loadMessage,
      })

      if (archivePath && Array.isArray(result.sourceRootUris) && result.sourceRootUris.length > 0) {
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

  function isStandardMslArchive(entry: BundledSourceRootArchive): boolean {
    const archiveId = String(entry.archiveId || '').toLowerCase()
    const fileName = String(entry.fileName || '').toLowerCase()
    return archiveId.includes('msl') || fileName.includes('modelicastandardlibrary')
  }

  function findBundledStandardMslArchive(
    manifest: BundledSourceRootManifest,
  ): BundledSourceRootArchive | null {
    const archives = Array.isArray(manifest.archives) ? manifest.archives : []
    return archives.find(isStandardMslArchive) ?? null
  }

  async function getBundledStandardMslArchive(): Promise<BundledSourceRootArchive | null> {
    if (bundledStandardMslArchive !== undefined) return bundledStandardMslArchive
    const worker = params.worker.value
    if (!worker) throw new Error('Modelica worker not loaded')
    const manifest = await worker.getBundledSourceRootManifest()
    bundledStandardMslArchive = findBundledStandardMslArchive(manifest)
    return bundledStandardMslArchive
  }

  async function tryLoadBundledStandardMsl(reason?: string): Promise<boolean> {
    const worker = params.worker.value
    if (!worker) throw new Error('Modelica worker not loaded')
    const archive = await getBundledStandardMslArchive()
    if (!archive) return false

    startLoading(archive.fileName || archive.archiveId)
    await nextTick()
    try {
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Loading bundled standard MSL${formatLoadReason(reason)}`,
      })
      const result = await worker.loadBundledSourceRootCache(archive.archiveId)
      mslLoaded.value = true
      standardMslLoaded.value = true
      mslArchiveName.value = archive.fileName || archive.archiveId
      mslFileCount.value = Number(archive.fileCount) || 0
      appendModelicaLog({
        level: 'success',
        phase: 'general',
        message: `Loaded bundled standard MSL: ${archive.fileName || archive.archiveId} (${result.documentCount} documents ready)`,
      })
      Notify.create({
        type: 'positive',
        message: `Loaded bundled standard MSL: ${archive.fileName || archive.archiveId}`,
      })
      return true
    } finally {
      finishLoading(archive.fileName || archive.archiveId)
    }
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
      try {
        if (await tryLoadBundledStandardMsl(reason)) {
          return
        }
      } catch (err) {
        appendModelicaLog({
          level: 'warning',
          phase: 'general',
          message: `Bundled standard MSL unavailable, falling back to ZIP load: ${(err as Error).message}`,
        })
      }
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
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Loading ${normalizedPaths.length} persisted Modelica library archive(s)${formatLoadReason(reason)}`,
    })
    for (const path of normalizedPaths) {
      await loadLibraryArchiveFromOpfsPath(path)
    }
  }

  async function loadLibraryArchiveFromOpfsPath(path: string) {
    const normalizedPath = String(path || '').trim()
    if (!normalizedPath) throw new Error('Missing OPFS library path')
    const file = await readFileFromOpfs(normalizedPath)
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
