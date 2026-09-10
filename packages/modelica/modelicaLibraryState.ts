import type { Ref } from 'vue'
import type { TaskyonStorageClient } from '@taskyon/taskyon/api'
import type { LazyModelicaClassTreeNode } from './lazyModelicaLibraryIndex'
import type { ModelicaWorkerClient } from './modelicaWorkerClient'

export type ModelicaLibraryState = {
  worker: Ref<ModelicaWorkerClient | null>
  storageClient: TaskyonStorageClient
  cacheVersionMarker: () => string
  mslLoaded: Ref<boolean>
  mslLoading: Ref<boolean>
  mslDownloading: Ref<boolean>
  activeLibraryLoads: Ref<string[]>
  activeLoadCount: Ref<number>
  activeDownloadCount: Ref<number>
  mslArchiveName: Ref<string>
  mslFileCount: Ref<number>
  mslCachedZipId: Ref<string>
  mslDownloadUrl: Ref<string>
  standardMslCachedZipId: Ref<string>
  standardMslLoaded: Ref<boolean>
  loadedLibraryCacheIds: Ref<string[]>
  latestLazyLibraryClassTree: Ref<LazyModelicaClassTreeNode[]>
  loadedArchiveFingerprints: Ref<Set<string>>
  inFlightArchiveLoads: Map<string, Promise<void>>
  inFlightDownloads: Map<string, Promise<string>>
  inFlightParsedCacheTasks: Set<string>
  handledParsedCacheFingerprints: Set<string>
  inFlightStandardMslLoad: Promise<void> | null
}
