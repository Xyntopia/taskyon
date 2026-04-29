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
  const mslArchiveName = ref('')
  const mslFileCount = ref(0)
  const mslCachedZipPath = ref('')
  const mslDownloadUrl = ref(DEFAULT_MSL_ZIP_URL)

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

  async function loadMslArchiveFile(file: File) {
    const worker = params.worker.value
    if (!worker) throw new Error('Modelica worker not loaded')

    mslLoading.value = true
    await nextTick()
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Loading Modelica library archive: ${file.name}`,
    })

    const bytes = await file.arrayBuffer()
    const result = await worker.loadMslZip(file.name, bytes)

    mslLoaded.value = true
    mslArchiveName.value = result.archiveName
    mslFileCount.value = result.fileCount

    appendModelicaLog({
      level: 'success',
      phase: 'general',
      message: `Modelica libraries loaded: ${result.parsedCount} files parsed`,
    })
  }

  async function downloadMslZipToOpfs() {
    try {
      mslDownloading.value = true
      const url = String(mslDownloadUrl.value || DEFAULT_MSL_ZIP_URL).trim()
      if (!url) throw new Error('MSL ZIP URL is empty')

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

      Notify.create({
        type: 'positive',
        message: `MSL ZIP downloaded to OPFS (${path})`,
      })
      appendModelicaLog({
        level: 'success',
        phase: 'general',
        message: `MSL ZIP saved to OPFS: ${path}`,
      })
    } catch (err) {
      const msg = (err as Error).message
      Notify.create({ type: 'negative', message: `MSL download failed: ${msg}` })
      appendModelicaLog({
        level: 'error',
        phase: 'general',
        message: `MSL download failed: ${msg}`,
      })
    } finally {
      mslDownloading.value = false
    }
  }

  async function loadCachedMslZipFromOpfs() {
    try {
      mslLoading.value = true
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
      const file = await readFileFromOpfs(cachedPath)
      await loadMslArchiveFile(file)
      Notify.create({
        type: 'positive',
        message: `Loaded cached MSL from ${cachedPath}`,
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
      mslLoading.value = false
    }
  }

  async function onImportMslZip(e: Event) {
    const el = e.target as HTMLInputElement
    const file = el.files?.[0]
    if (!file) return

    try {
      await loadMslArchiveFile(file)
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
      mslLoading.value = false
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

  return {
    useModelicaStandardLibrary,
    mslImportEl,
    mslLoaded,
    mslLoading,
    mslDownloading,
    mslArchiveName,
    mslFileCount,
    mslCachedZipPath,
    mslDownloadUrl,
    triggerMslImport,
    downloadMslZipToOpfs,
    loadCachedMslZipFromOpfs,
    onImportMslZip,
    clearModelicaLibraries,
  }
}
