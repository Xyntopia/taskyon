import { nextTick, ref, type Ref } from 'vue'
import { Notify } from 'quasar'
import { DEFAULT_MSL_ZIP_URL, appendModelicaLog } from './modelica'
import type { ModelicaWorkerClient } from './modelicaWorkerClient'

export function useModelicaLibraries(params: { worker: Ref<ModelicaWorkerClient | null> }) {
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
  const mslDownloadUrl = ref(DEFAULT_MSL_ZIP_URL)
  const standardMslCachedZipPath = ref('')
  const standardMslLoaded = ref(false)
  const loadedLibraryCachePaths = ref<string[]>([])
  const loadedArchiveFingerprints = ref<Set<string>>(new Set())
  const inFlightArchiveLoads = new Map<string, Promise<void>>()
  const inFlightDownloads = new Map<string, Promise<string>>()
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

  async function writeBlobToOpfsMslCache(blob: Blob, fileNameHint: string): Promise<string> {
    const navAny = navigator as unknown as {
      storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
    }
    if (!navAny.storage?.getDirectory) {
      throw new Error('OPFS not supported in this browser')
    }
    const root = await navAny.storage.getDirectory()
    const mslDir = await root.getDirectoryHandle('modelicaMslCache', { create: true })
    const fileName = sanitizeOpfsFileName(fileNameHint)
    const handle = await mslDir.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return `modelicaMslCache/${fileName}`
  }

  async function readFileFromOpfs(relativePath: string): Promise<File> {
    const navAny = navigator as unknown as {
      storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
    }
    if (!navAny.storage?.getDirectory) {
      throw new Error('OPFS not supported in this browser')
    }
    const root = await navAny.storage.getDirectory()
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

  function buildArchiveFingerprint(file: File): string {
    return `${file.name}::${file.size}`
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

  async function loadLibraryArchiveFile(file: File) {
    const worker = params.worker.value
    if (!worker) throw new Error('Modelica worker not loaded')
    const fingerprint = buildArchiveFingerprint(file)
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

      const bytes = await file.arrayBuffer()
      const effectiveMode = 'merge' as const
      const result = await worker.mergeMslZip(file.name, bytes)
      loadedArchiveFingerprints.value.add(fingerprint)

      mslLoaded.value = true
      mslArchiveName.value = result.archiveName
      mslFileCount.value = result.fileCount

      appendModelicaLog({
        level: 'success',
        phase: 'general',
        message: `Modelica libraries ${effectiveMode}: ${result.parsedCount} files parsed`,
      })
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

  async function downloadMslZipToOpfs(urlOverride?: string) {
    const url = String(urlOverride || mslDownloadUrl.value || DEFAULT_MSL_ZIP_URL).trim()
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
      const standardUrl = String(DEFAULT_MSL_ZIP_URL).trim()
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

  async function loadCachedMslZipFromOpfs() {
    try {
      await nextTick()
      let cachedPath = normalizeCachedZipPath(mslCachedZipPath.value)
      if (!cachedPath) {
        const fallbackUrl = String(mslDownloadUrl.value || DEFAULT_MSL_ZIP_URL).trim()
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
    } finally {
    }
  }

  async function loadStandardMslZipFromOpfs() {
    if (standardMslLoaded.value) return
    if (inFlightStandardMslLoad) {
      await inFlightStandardMslLoad
      return
    }
    inFlightStandardMslLoad = (async () => {
      await nextTick()
      const standardUrl = String(DEFAULT_MSL_ZIP_URL).trim()
      const knownPath = normalizeCachedZipPath(standardMslCachedZipPath.value)
      const inferredPath = inferCachedZipPathFromUrl(standardUrl)
      const candidatePaths = [knownPath, inferredPath].filter(Boolean)
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
          message: `Standard MSL cache missing; downloading from ${DEFAULT_MSL_ZIP_URL}`,
        })
        cachedPath = await downloadMslZipToOpfs(DEFAULT_MSL_ZIP_URL)
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
      await loadLibraryArchiveFile(file)
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

  async function loadLibraryArchivesFromOpfs(paths: string[]) {
    const normalizedPaths = normalizeLibraryCachePaths(paths)
    if (normalizedPaths.length === 0) return
    for (const path of normalizedPaths) {
      await loadLibraryArchiveFromOpfsPath(path)
    }
  }

  async function loadLibraryArchiveFromOpfsPath(path: string) {
    const normalizedPath = String(path || '').trim()
    if (!normalizedPath) throw new Error('Missing OPFS library path')
    const file = await readFileFromOpfs(normalizedPath)
    await loadLibraryArchiveFile(file)
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
