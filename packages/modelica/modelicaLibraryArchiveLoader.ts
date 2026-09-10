import { nextTick } from 'vue'
import { Notify } from 'quasar'
import { appendModelicaLog } from './modelica'
import {
  MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION,
  arrayBufferFromUint8Array,
  buildArchiveFingerprint,
  libraryParsedCacheId,
  readCachedLazyLibraryIndex,
  readLibraryArchive,
  readLibraryParsedCacheMetadata,
  readParsedCache,
  writeLazyLibraryIndexCache,
  writeLibraryParsedCacheMetadata,
  writeParsedCache,
} from './modelicaLibraryPersistence'
import type { ModelicaLibraryState } from './modelicaLibraryState'
import type { ModelicaWorkerClient } from './modelicaWorkerClient'

const AUTO_RESTORE_FULL_PARSED_CACHE_ON_STARTUP = false

const nowMs = (): number => performance.now()
const elapsedMs = (startedAt: number): number => Math.round(performance.now() - startedAt)
const bytesToMiB = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10

type ArchiveInput = {
  file: File
  archiveId: string | undefined
  archiveBuffer: ArrayBuffer
  fingerprint: string
}

type CachedLazyIndex = NonNullable<Awaited<ReturnType<typeof readCachedLazyLibraryIndex>>>['index']

type ParsedCacheRequest = {
  archiveName: string
  archiveId: string
  archiveFingerprint: string
  sourceRootUris: string[]
  fileCount: number
  documentCount: number
}

type LoadedArchive = {
  input: ArchiveInput
  worker: ModelicaWorkerClient
  result:
    | Awaited<ReturnType<ModelicaWorkerClient['loadMslZip']>>
    | Awaited<ReturnType<ModelicaWorkerClient['mergeMslZip']>>
  cachedLazyIndex: CachedLazyIndex | null
  shouldMerge: boolean
  loadStartedAt: number
  workerLoadStartedAt: number
}

const addActiveLibraryLoad = (state: ModelicaLibraryState, label: string): void => {
  const nextLabel = String(label || '').trim()
  if (!nextLabel || state.activeLibraryLoads.value.includes(nextLabel)) return
  state.activeLibraryLoads.value = [...state.activeLibraryLoads.value, nextLabel]
}

const removeActiveLibraryLoad = (state: ModelicaLibraryState, label: string): void => {
  state.activeLibraryLoads.value = state.activeLibraryLoads.value.filter((entry) => entry !== label)
}

const startLoading = (state: ModelicaLibraryState, label: string): void => {
  state.activeLoadCount.value += 1
  state.mslLoading.value = true
  addActiveLibraryLoad(state, label)
}

const finishLoading = (state: ModelicaLibraryState, label: string): void => {
  state.activeLoadCount.value = Math.max(0, state.activeLoadCount.value - 1)
  removeActiveLibraryLoad(state, label)
  state.mslLoading.value = state.activeLoadCount.value > 0
}

const trackLoadedLibraryCacheId = (state: ModelicaLibraryState, id: string): void => {
  const normalized = state.loadedLibraryCacheIds.value
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
  state.loadedLibraryCacheIds.value = Array.from(new Set([...normalized, id.trim()])).filter(
    Boolean,
  )
}

const readArchiveInput = async (
  state: ModelicaLibraryState,
  file: File,
  archiveId?: string,
): Promise<ArchiveInput> => {
  const fileReadStartedAt = nowMs()
  const archiveBuffer = await file.arrayBuffer()
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: `Read Modelica archive bytes in ${elapsedMs(fileReadStartedAt)} ms: ${file.name} (${bytesToMiB(archiveBuffer.byteLength)} MiB)`,
    details: { archiveId, archiveName: file.name, byteLength: archiveBuffer.byteLength },
  })
  const fingerprintStartedAt = nowMs()
  const fingerprint = await buildArchiveFingerprint(file, archiveBuffer, state.cacheVersionMarker())
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: `Computed Modelica archive fingerprint in ${elapsedMs(fingerprintStartedAt)} ms: ${file.name}`,
    details: { archiveId, archiveName: file.name, fingerprint },
  })
  return { file, archiveId, archiveBuffer, fingerprint }
}

const readCachedLazyLibraryIndexWithLog = async (
  state: ModelicaLibraryState,
  archiveFingerprint: string,
): Promise<LoadedArchive['cachedLazyIndex']> => {
  const startedAt = nowMs()
  const cached = await readCachedLazyLibraryIndex(
    state.storageClient,
    archiveFingerprint,
    state.cacheVersionMarker(),
  )
  if (!cached) {
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Modelica lazy index cache miss after ${elapsedMs(startedAt)} ms; archive will be indexed once`,
      details: { cacheId: archiveFingerprint },
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
}

const loadArchiveWithWorker = async (
  state: ModelicaLibraryState,
  input: ArchiveInput,
  worker: ModelicaWorkerClient,
  loadStartedAt: number,
): Promise<LoadedArchive> => {
  const shouldMerge = state.mslLoaded.value || state.loadedArchiveFingerprints.value.size > 0
  const cachedLazyIndex =
    !shouldMerge && input.archiveId
      ? await readCachedLazyLibraryIndexWithLog(state, input.fingerprint)
      : null
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
      message: 'Indexing Modelica library for fast browsing. Source files are parsed on demand.',
    })
  }
  const workerLoadStartedAt = nowMs()
  const result = shouldMerge
    ? await worker.mergeMslZip(input.file.name, input.archiveBuffer)
    : await worker.loadMslZip(input.file.name, input.archiveBuffer, cachedLazyIndex ?? undefined)
  return {
    input,
    worker,
    result,
    cachedLazyIndex,
    shouldMerge,
    loadStartedAt,
    workerLoadStartedAt,
  }
}

const updateLoadedArchiveState = (state: ModelicaLibraryState, loaded: LoadedArchive): void => {
  const { result } = loaded
  state.latestLazyLibraryClassTree.value =
    'classes' in result && Array.isArray(result.classes) && result.classes.length > 0
      ? result.classes
      : []
  state.loadedArchiveFingerprints.value.add(loaded.input.fingerprint)
  state.mslLoaded.value = true
  state.mslArchiveName.value = result.archiveName
  state.mslFileCount.value = result.fileCount
}

const logLoadedArchive = (loaded: LoadedArchive): void => {
  const { result } = loaded
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
    message: `${loadMessage} in ${elapsedMs(loaded.loadStartedAt)} ms`,
    details: {
      workerLoadMs: elapsedMs(loaded.workerLoadStartedAt),
      archiveId: loaded.input.archiveId,
      archiveName: result.archiveName,
      loadMode: result.loadMode,
      fileCount: result.fileCount,
      parsedCount: result.parsedCount,
      classCount: 'classCount' in result ? result.classCount : undefined,
      documentCount: result.documentCount,
      sourceRootUriCount: result.sourceRootUris?.length ?? 0,
      usedCachedLazyIndex: Boolean(loaded.cachedLazyIndex),
      shouldMerge: loaded.shouldMerge,
    },
  })
}

const persistLazyIndex = async (
  state: ModelicaLibraryState,
  loaded: LoadedArchive,
): Promise<void> => {
  if (
    !loaded.input.archiveId ||
    loaded.result.loadMode !== 'lazy-index' ||
    !('lazyIndex' in loaded.result) ||
    !loaded.result.lazyIndex ||
    loaded.cachedLazyIndex
  ) {
    return
  }
  await writeLazyLibraryIndexCache({
    storageClient: state.storageClient,
    archiveName: loaded.input.file.name,
    archiveId: loaded.input.archiveId,
    archiveFingerprint: loaded.input.fingerprint,
    index: loaded.result.lazyIndex,
    rumocaVersionMarker: state.cacheVersionMarker(),
  })
}

const persistParsedArchiveCache = async (
  state: ModelicaLibraryState,
  loaded: LoadedArchive,
): Promise<void> => {
  if (
    !loaded.input.archiveId ||
    loaded.result.loadMode === 'lazy-index' ||
    loaded.result.sourceRootUris.length === 0
  ) {
    return
  }
  const cacheBytes = await loaded.worker.exportSourceRootBinaryCache(loaded.result.sourceRootUris)
  if (cacheBytes.length === 0) return
  const cacheId = libraryParsedCacheId(loaded.input.fingerprint)
  await writeParsedCache(state.storageClient, cacheId, arrayBufferFromUint8Array(cacheBytes))
  await writeLibraryParsedCacheMetadata(state.storageClient, {
    archiveName: loaded.input.file.name,
    archiveId: loaded.input.archiveId,
    archiveFingerprint: loaded.input.fingerprint,
    cacheId,
    cacheSchemaVersion: MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION,
    documentCount: loaded.result.documentCount,
    fileCount: loaded.result.fileCount,
    rumocaVersionMarker: state.cacheVersionMarker(),
  })
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: `Cached parsed AST for ${loaded.input.file.name} for faster future loads`,
  })
}

const runParsedCacheTask = (
  state: ModelicaLibraryState,
  archiveFingerprint: string,
  delayMs: number,
  task: () => Promise<void>,
): void => {
  if (
    state.inFlightParsedCacheTasks.has(archiveFingerprint) ||
    state.handledParsedCacheFingerprints.has(archiveFingerprint)
  ) {
    return
  }
  state.inFlightParsedCacheTasks.add(archiveFingerprint)
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: `Scheduled parsed Modelica cache task in ${delayMs} ms`,
    details: { archiveFingerprint },
  })
  window.setTimeout(() => {
    void task().finally(() => state.inFlightParsedCacheTasks.delete(archiveFingerprint))
  }, delayMs)
}

const restoreParsedCache = async (
  state: ModelicaLibraryState,
  request: ParsedCacheRequest,
  metadata: NonNullable<Awaited<ReturnType<typeof readLibraryParsedCacheMetadata>>>,
): Promise<void> => {
  const worker = state.worker.value
  if (!worker) return
  const taskStartedAt = nowMs()
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: `Restoring full parsed Modelica cache in background: ${metadata.archiveName}`,
  })
  const cacheReadStartedAt = nowMs()
  const cacheBytes = await readParsedCache(state.storageClient, metadata.cacheId)
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: `Read full parsed Modelica cache in ${elapsedMs(cacheReadStartedAt)} ms (${bytesToMiB(cacheBytes.byteLength)} MiB)`,
    details: {
      cacheId: metadata.cacheId,
      byteLength: cacheBytes.byteLength,
      fileCount: metadata.fileCount,
      documentCount: metadata.documentCount,
    },
  })
  const restoreStartedAt = nowMs()
  const restoredCount = await worker.restoreSourceRootBinaryCache(cacheBytes)
  state.handledParsedCacheFingerprints.add(request.archiveFingerprint)
  appendModelicaLog({
    level: 'success',
    phase: 'general',
    message: `Full parsed Modelica cache restored in background in ${elapsedMs(taskStartedAt)} ms: ${restoredCount} source roots`,
    details: {
      restoreWorkerMs: elapsedMs(restoreStartedAt),
      restoredCount,
      cacheId: metadata.cacheId,
    },
  })
}

const warmParsedCache = async (
  state: ModelicaLibraryState,
  request: ParsedCacheRequest,
): Promise<void> => {
  const worker = state.worker.value
  if (!worker) return
  const taskStartedAt = nowMs()
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: `Building full parsed Modelica cache in background after startup idle delay: ${request.archiveName}`,
  })
  const exportStartedAt = nowMs()
  const cacheBytes = await worker.exportSourceRootBinaryCache(request.sourceRootUris)
  if (cacheBytes.length === 0) return
  const cacheId = libraryParsedCacheId(request.archiveFingerprint)
  const storageWriteStartedAt = nowMs()
  await writeParsedCache(state.storageClient, cacheId, arrayBufferFromUint8Array(cacheBytes))
  await writeLibraryParsedCacheMetadata(state.storageClient, {
    archiveName: request.archiveName,
    archiveId: request.archiveId,
    archiveFingerprint: request.archiveFingerprint,
    cacheId,
    cacheSchemaVersion: MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION,
    documentCount: request.documentCount,
    fileCount: request.fileCount,
    rumocaVersionMarker: state.cacheVersionMarker(),
  })
  state.handledParsedCacheFingerprints.add(request.archiveFingerprint)
  appendModelicaLog({
    level: 'success',
    phase: 'general',
    message: `Full parsed Modelica cache stored in ${elapsedMs(taskStartedAt)} ms: ${request.archiveName}`,
    details: {
      exportWorkerMs: elapsedMs(exportStartedAt),
      storageWriteAndMetadataMs: elapsedMs(storageWriteStartedAt),
      byteLength: cacheBytes.length,
      byteMiB: bytesToMiB(cacheBytes.length),
      sourceRootUriCount: request.sourceRootUris.length,
      cacheId,
    },
  })
}

const restoreOrWarmParsedCacheInBackground = async (
  state: ModelicaLibraryState,
  request: ParsedCacheRequest,
): Promise<void> => {
  if (state.handledParsedCacheFingerprints.has(request.archiveFingerprint)) return
  const metadataCheckStartedAt = nowMs()
  const metadata = await readLibraryParsedCacheMetadata(
    state.storageClient,
    request.archiveFingerprint,
    state.cacheVersionMarker(),
  )
  const delayMs = metadata ? 3000 : 30000
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: metadata
      ? `Found parsed Modelica cache metadata in ${elapsedMs(metadataCheckStartedAt)} ms`
      : `No parsed Modelica cache metadata found after ${elapsedMs(metadataCheckStartedAt)} ms`,
    details: {
      archiveName: request.archiveName,
      archiveId: request.archiveId,
      cacheId: metadata?.cacheId,
      fileCount: metadata?.fileCount ?? request.fileCount,
      documentCount: metadata?.documentCount ?? request.documentCount,
      sourceRootUriCount: request.sourceRootUris.length,
      scheduledDelayMs: delayMs,
    },
  })
  runParsedCacheTask(state, request.archiveFingerprint, delayMs, async () => {
    if (state.handledParsedCacheFingerprints.has(request.archiveFingerprint)) return
    const freshMetadata = await readLibraryParsedCacheMetadata(
      state.storageClient,
      request.archiveFingerprint,
      state.cacheVersionMarker(),
    )
    if (freshMetadata) {
      await restoreParsedCache(state, request, freshMetadata)
      return
    }
    await warmParsedCache(state, request)
  })
}

const maybePersistArchiveCaches = async (
  state: ModelicaLibraryState,
  loaded: LoadedArchive,
): Promise<void> => {
  await persistLazyIndex(state, loaded)
  const hasSourceRoots = loaded.result.sourceRootUris.length > 0
  if (
    AUTO_RESTORE_FULL_PARSED_CACHE_ON_STARTUP &&
    loaded.input.archiveId &&
    loaded.result.loadMode === 'lazy-index' &&
    hasSourceRoots
  ) {
    await restoreOrWarmParsedCacheInBackground(state, {
      archiveName: loaded.input.file.name,
      archiveId: loaded.input.archiveId,
      archiveFingerprint: loaded.input.fingerprint,
      sourceRootUris: loaded.result.sourceRootUris,
      fileCount: loaded.result.fileCount,
      documentCount: loaded.result.documentCount,
    })
  } else if (loaded.input.archiveId && loaded.result.loadMode === 'lazy-index' && hasSourceRoots) {
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message:
        'Skipping automatic full parsed Modelica cache restore during startup; source roots will be parsed on demand.',
      details: {
        archiveName: loaded.input.file.name,
        archiveId: loaded.input.archiveId,
        sourceRootUriCount: loaded.result.sourceRootUris.length,
      },
    })
  }
  await persistParsedArchiveCache(state, loaded)
}

const performArchiveLoad = async (
  state: ModelicaLibraryState,
  input: ArchiveInput,
  worker: ModelicaWorkerClient,
): Promise<void> => {
  const loadStartedAt = nowMs()
  startLoading(state, input.file.name)
  try {
    await nextTick()
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Loading Modelica library archive: ${input.file.name}`,
      details: {
        archiveId: input.archiveId,
        archiveName: input.file.name,
        byteLength: input.archiveBuffer.byteLength,
        byteMiB: bytesToMiB(input.archiveBuffer.byteLength),
        alreadyLoadedArchiveCount: state.loadedArchiveFingerprints.value.size,
        mslLoaded: state.mslLoaded.value,
      },
    })
    const loaded = await loadArchiveWithWorker(state, input, worker, loadStartedAt)
    updateLoadedArchiveState(state, loaded)
    logLoadedArchive(loaded)
    await maybePersistArchiveCaches(state, loaded)
  } finally {
    finishLoading(state, input.file.name)
  }
}

export const loadModelicaLibraryArchiveFile = async (
  state: ModelicaLibraryState,
  file: File,
  archiveId?: string,
): Promise<void> => {
  const worker = state.worker.value
  if (!worker) throw new Error('Modelica worker not loaded')
  const input = await readArchiveInput(state, file, archiveId)
  if (state.loadedArchiveFingerprints.value.has(input.fingerprint)) {
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Library archive already loaded, skipping: ${file.name}`,
    })
    return
  }
  const existingLoad = state.inFlightArchiveLoads.get(input.fingerprint)
  if (existingLoad) {
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Waiting for in-flight Modelica archive load: ${file.name}`,
      details: { archiveId, archiveName: file.name, fingerprint: input.fingerprint },
    })
    await existingLoad
    return
  }
  const loadPromise = performArchiveLoad(state, input, worker)
  state.inFlightArchiveLoads.set(input.fingerprint, loadPromise)
  try {
    await loadPromise
  } finally {
    state.inFlightArchiveLoads.delete(input.fingerprint)
  }
}

export const formatModelicaLoadReason = (reason: string | undefined): string => {
  const normalized = String(reason || '').trim()
  return normalized ? ` (reason: ${normalized})` : ''
}

export const loadModelicaLibraryArchiveFromStorage = async (
  state: ModelicaLibraryState,
  path: string,
): Promise<void> => {
  const normalizedPath = String(path || '').trim()
  if (!normalizedPath) throw new Error('Missing Modelica library storage id')
  const startedAt = nowMs()
  const file = await readLibraryArchive(state.storageClient, normalizedPath)
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
  await loadModelicaLibraryArchiveFile(state, file, normalizedPath)
  trackLoadedLibraryCacheId(state, normalizedPath)
}

export const loadModelicaLibraryArchivesFromStorage = async (
  state: ModelicaLibraryState,
  paths: string[],
  reason?: string,
): Promise<void> => {
  const normalizedPaths = Array.from(
    new Set(paths.map((path) => String(path || '').trim()).filter(Boolean)),
  )
  if (normalizedPaths.length === 0) return
  const startedAt = nowMs()
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: `Loading ${normalizedPaths.length} persisted Modelica library archive(s)${formatModelicaLoadReason(reason)}`,
    details: { paths: normalizedPaths },
  })
  for (const path of normalizedPaths) {
    await loadModelicaLibraryArchiveFromStorage(state, path)
  }
  appendModelicaLog({
    level: 'success',
    phase: 'general',
    message: `Loaded ${normalizedPaths.length} persisted Modelica library archive(s) from storage in ${elapsedMs(startedAt)} ms`,
    details: { paths: normalizedPaths },
  })
}
