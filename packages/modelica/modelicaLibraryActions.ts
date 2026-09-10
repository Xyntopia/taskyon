import { nextTick } from 'vue'
import { Notify } from 'quasar'
import { appendModelicaLog } from './modelica'
import {
  MODEL_LIBRARY_ARCHIVE_METADATA_NAMESPACE,
  MODEL_LIBRARY_ARCHIVE_NAMESPACE,
  MODEL_LIBRARY_LAZY_INDEX_NAMESPACE,
  MODEL_LIBRARY_PARSED_METADATA_NAMESPACE,
  MODEL_LIBRARY_PARSED_NAMESPACE,
  archiveExists,
  normalizeCachedZipId,
  sha256Hex,
  writeLibraryArchive,
} from './modelicaLibraryPersistence'
import {
  formatModelicaLoadReason,
  loadModelicaLibraryArchiveFile,
  loadModelicaLibraryArchiveFromStorage,
  loadModelicaLibraryArchivesFromStorage,
} from './modelicaLibraryArchiveLoader'
import type { ModelicaLibraryState } from './modelicaLibraryState'
import { getDefaultModelicaLibraryUrl } from './modelicaLibraryCatalog'

const startDownloading = (state: ModelicaLibraryState): void => {
  state.activeDownloadCount.value += 1
  state.mslDownloading.value = true
}

const finishDownloading = (state: ModelicaLibraryState): void => {
  state.activeDownloadCount.value = Math.max(0, state.activeDownloadCount.value - 1)
  state.mslDownloading.value = state.activeDownloadCount.value > 0
}

const resolveLibraryDownloadUrl = (state: ModelicaLibraryState, urlOverride?: string): string =>
  String(urlOverride || state.mslDownloadUrl.value || getDefaultModelicaLibraryUrl()).trim()

export const downloadMslZipToStorage = async (
  state: ModelicaLibraryState,
  urlOverride?: string,
): Promise<string> => {
  const url = resolveLibraryDownloadUrl(state, urlOverride)
  if (!url) throw new Error('MSL ZIP URL is empty')
  const existingDownload = state.inFlightDownloads.get(url)
  if (existingDownload) {
    const existingPath = await existingDownload
    state.mslCachedZipId.value = existingPath
    return existingPath
  }

  const downloadPromise = (async (): Promise<string> => {
    startDownloading(state)
    appendModelicaLog({ level: 'info', phase: 'general', message: `Downloading MSL ZIP: ${url}` })
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Download failed with status ${res.status}`)
    const blob = await res.blob()
    let fileNameHint = 'ModelicaStandardLibrary-v4.1.0.zip'
    try {
      fileNameHint = new URL(url).pathname || fileNameHint
    } catch {
      fileNameHint = url
    }
    const path = await writeLibraryArchive(state.storageClient, blob, fileNameHint, sha256Hex)
    state.mslCachedZipId.value = path
    if (url === getDefaultModelicaLibraryUrl()) state.standardMslCachedZipId.value = path
    appendModelicaLog({
      level: 'success',
      phase: 'general',
      message: `MSL ZIP saved to storage: ${path}`,
    })
    return path
  })()
  state.inFlightDownloads.set(url, downloadPromise)
  try {
    const path = await downloadPromise
    Notify.create({ type: 'positive', message: `MSL ZIP downloaded to storage (${path})` })
    return path
  } catch (err) {
    const msg = (err as Error).message
    Notify.create({ type: 'negative', message: `MSL download failed: ${msg}` })
    appendModelicaLog({ level: 'error', phase: 'general', message: `MSL download failed: ${msg}` })
    throw err
  } finally {
    state.inFlightDownloads.delete(url)
    finishDownloading(state)
  }
}

export const loadCachedMslZipFromStorage = async (
  state: ModelicaLibraryState,
  reason?: string,
): Promise<void> => {
  try {
    await nextTick()
    let cachedPath = normalizeCachedZipId(state.mslCachedZipId.value)
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Loading cached MSL ZIP from storage${formatModelicaLoadReason(reason)}`,
    })
    if (!cachedPath) {
      const fallbackUrl = resolveLibraryDownloadUrl(state)
      if (!fallbackUrl) throw new Error('No Modelica library download URL configured')
      appendModelicaLog({
        level: 'warning',
        phase: 'general',
        message: `No cached MSL ZIP ID set; downloading from ${fallbackUrl}`,
      })
      await downloadMslZipToStorage(state)
      cachedPath = normalizeCachedZipId(state.mslCachedZipId.value)
    }
    if (!cachedPath) throw new Error('No cached MSL ZIP ID set')
    await loadModelicaLibraryArchiveFromStorage(state, cachedPath)
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

export const loadStandardMslZipFromStorage = async (
  state: ModelicaLibraryState,
  reason?: string,
): Promise<void> => {
  if (state.standardMslLoaded.value) return
  if (state.inFlightStandardMslLoad) {
    await state.inFlightStandardMslLoad
    return
  }
  state.inFlightStandardMslLoad = (async () => {
    await nextTick()
    const standardUrl = getDefaultModelicaLibraryUrl()
    if (!standardUrl) throw new Error('No standard Modelica library download URL configured')
    const knownPath = normalizeCachedZipId(state.standardMslCachedZipId.value)
    const candidatePaths = [knownPath].filter(Boolean)
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Loading standard MSL${formatModelicaLoadReason(reason)}`,
    })
    let cachedPath = ''
    for (const candidate of candidatePaths) {
      if (await archiveExists(state.storageClient, candidate)) {
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
      cachedPath = await downloadMslZipToStorage(state, standardUrl)
    } else {
      state.mslCachedZipId.value = cachedPath
      state.standardMslCachedZipId.value = cachedPath
    }
    if (!cachedPath) throw new Error('No cached standard MSL ZIP ID set')
    await loadModelicaLibraryArchiveFromStorage(state, cachedPath)
    state.standardMslLoaded.value = true
    Notify.create({ type: 'positive', message: `Loaded standard MSL from ${cachedPath}` })
  })()
  try {
    await state.inFlightStandardMslLoad
  } catch (err) {
    const msg = (err as Error).message
    Notify.create({ type: 'negative', message: `Failed to load standard MSL: ${msg}` })
    appendModelicaLog({
      level: 'error',
      phase: 'general',
      message: `Failed to load standard MSL: ${msg}`,
    })
  } finally {
    state.inFlightStandardMslLoad = null
  }
}

export const onImportMslZip = async (state: ModelicaLibraryState, event: Event): Promise<void> => {
  const element = event.target as HTMLInputElement
  const file = element.files?.[0]
  if (!file) return
  try {
    const persistedPath = await writeLibraryArchive(state.storageClient, file, file.name, sha256Hex)
    state.mslCachedZipId.value = persistedPath
    await loadModelicaLibraryArchiveFile(state, file, persistedPath)
    state.loadedLibraryCacheIds.value = Array.from(
      new Set([...state.loadedLibraryCacheIds.value, persistedPath]),
    )
    Notify.create({ type: 'positive', message: `Loaded MSL archive: ${file.name}` })
  } catch (err) {
    state.mslLoaded.value = false
    state.mslArchiveName.value = ''
    state.mslFileCount.value = 0
    const msg = (err as Error).message
    appendModelicaLog({
      level: 'error',
      phase: 'general',
      message: `Failed to load MSL archive: ${msg}`,
    })
    Notify.create({ type: 'negative', message: `Failed to load MSL: ${msg}` })
  } finally {
    element.value = ''
  }
}

export const clearModelicaLibraries = async (state: ModelicaLibraryState): Promise<void> => {
  try {
    const worker = state.worker.value
    if (!worker) throw new Error('Modelica worker not loaded')
    await worker.clearLibraries()
    await Promise.all([
      state.storageClient.clearBlobs({ namespace: MODEL_LIBRARY_ARCHIVE_NAMESPACE }),
      state.storageClient.clear({ namespace: MODEL_LIBRARY_ARCHIVE_METADATA_NAMESPACE }),
      state.storageClient.clearBlobs({ namespace: MODEL_LIBRARY_PARSED_NAMESPACE }),
      state.storageClient.clear({ namespace: MODEL_LIBRARY_PARSED_METADATA_NAMESPACE }),
      state.storageClient.clear({ namespace: MODEL_LIBRARY_LAZY_INDEX_NAMESPACE }),
    ])
    state.mslLoaded.value = false
    state.mslArchiveName.value = ''
    state.mslFileCount.value = 0
    state.mslCachedZipId.value = ''
    state.standardMslCachedZipId.value = ''
    state.standardMslLoaded.value = false
    state.loadedLibraryCacheIds.value = []
    state.latestLazyLibraryClassTree.value = []
    state.loadedArchiveFingerprints.value = new Set()
    state.inFlightArchiveLoads.clear()
    state.inFlightDownloads.clear()
    state.inFlightStandardMslLoad = null
    state.activeLoadCount.value = 0
    state.activeDownloadCount.value = 0
    state.activeLibraryLoads.value = []
    state.mslLoading.value = false
    state.mslDownloading.value = false
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

export const createModelicaLibraryActions = (state: ModelicaLibraryState) => ({
  downloadMslZipToStorage: (urlOverride?: string) => downloadMslZipToStorage(state, urlOverride),
  loadCachedMslZipFromStorage: (reason?: string) => loadCachedMslZipFromStorage(state, reason),
  loadStandardMslZipFromStorage: (reason?: string) => loadStandardMslZipFromStorage(state, reason),
  loadLibraryArchivesFromStorage: (paths: string[], reason?: string) =>
    loadModelicaLibraryArchivesFromStorage(state, paths, reason),
  onImportMslZip: (event: Event) => onImportMslZip(state, event),
  clearModelicaLibraries: () => clearModelicaLibraries(state),
})

export { loadModelicaLibraryArchiveFromStorage }
