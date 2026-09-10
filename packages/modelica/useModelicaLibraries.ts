import { ref, type Ref } from 'vue'
import { getDefaultModelicaLibraryUrl } from './modelicaLibraryCatalog'
import { createModelicaLibraryActions } from './modelicaLibraryActions'
import type { ModelicaLibraryState } from './modelicaLibraryState'
import type { LazyModelicaClassTreeNode } from './lazyModelicaLibraryIndex'
import type { TaskyonStorageClient } from '@taskyon/taskyon/api'
import type { ModelicaWorkerClient } from './modelicaWorkerClient'

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

  const state: ModelicaLibraryState = {
    worker: params.worker,
    storageClient: params.storageClient,
    cacheVersionMarker: () => {
      const value = params.cacheVersionMarker?.value
      return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'unknown'
    },
    mslLoaded,
    mslLoading,
    mslDownloading,
    activeLibraryLoads,
    activeLoadCount,
    activeDownloadCount,
    mslArchiveName,
    mslFileCount,
    mslCachedZipId,
    mslDownloadUrl,
    standardMslCachedZipId,
    standardMslLoaded,
    loadedLibraryCacheIds,
    latestLazyLibraryClassTree,
    loadedArchiveFingerprints,
    inFlightArchiveLoads,
    inFlightDownloads,
    inFlightParsedCacheTasks,
    handledParsedCacheFingerprints,
    inFlightStandardMslLoad: null,
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
    triggerMslImport: () => mslImportEl.value?.click(),
    ...createModelicaLibraryActions(state),
  }
}
