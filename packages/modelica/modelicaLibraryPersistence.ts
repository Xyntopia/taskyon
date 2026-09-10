import type { TaskyonStorageClient } from '@taskyon/taskyon/api'
import type {
  LazyModelicaClassTreeNode,
  LazyModelicaLibraryIndex,
} from './lazyModelicaLibraryIndex'

export const MODEL_LIBRARY_ARCHIVE_NAMESPACE = 'modelica/library-archives'
export const MODEL_LIBRARY_ARCHIVE_METADATA_NAMESPACE = 'modelica/library-archive-metadata'
export const MODEL_LIBRARY_PARSED_NAMESPACE = 'modelica/library-parsed-cache'
export const MODEL_LIBRARY_PARSED_METADATA_NAMESPACE = 'modelica/library-parsed-metadata'
export const MODEL_LIBRARY_LAZY_INDEX_NAMESPACE = 'modelica/library-lazy-index'
export const MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION = 1
export const MODELICA_LAZY_INDEX_CACHE_SCHEMA_VERSION = 1

export type LibraryParsedCacheMetadata = {
  archiveName: string
  archiveId: string
  archiveFingerprint: string
  cacheId: string
  cacheSchemaVersion: number
  documentCount: number
  fileCount: number
  rumocaVersionMarker: string
}

export type LibraryLazyIndexCache = {
  archiveName: string
  archiveId: string
  archiveFingerprint: string
  cacheSchemaVersion: number
  fileCount: number
  totalClasses: number
  rumocaVersionMarker: string
  index: LazyModelicaLibraryIndex
}

export const arrayBufferFromUint8Array = (bytes: Uint8Array): ArrayBuffer => {
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export const sanitizeArchiveName = (fileName: string): string => {
  const cleaned = String(fileName || '')
    .split('/')
    .pop()
    ?.replaceAll(/[^a-zA-Z0-9._-]/g, '_')
    .trim()
  return cleaned && cleaned.length > 0 ? cleaned : 'ModelicaStandardLibrary-v4.1.0.zip'
}

export const normalizeCachedZipId = (raw: unknown): string => {
  if (typeof raw === 'string') return raw.trim()
  if (raw && typeof raw === 'object') {
    const maybeRef = raw as { value?: unknown; id?: unknown }
    if (typeof maybeRef.value === 'string') return maybeRef.value.trim()
    if (typeof maybeRef.id === 'string') return maybeRef.id.trim()
  }
  const typeLabel = Object.prototype.toString.call(raw)
  throw new Error(`Cached MSL ZIP id has invalid type: ${typeLabel}`)
}

export const normalizeLibraryCacheIds = (ids: string[]): string[] => {
  const normalized = ids.map((id) => String(id || '').trim()).filter(Boolean)
  return Array.from(new Set(normalized))
}

export const libraryParsedCacheId = (archiveFingerprint: string): string => archiveFingerprint

export const writeLibraryArchive = async (
  storageClient: TaskyonStorageClient,
  blob: Blob,
  fileNameHint: string,
  sha256Hex: (bytes: ArrayBuffer) => Promise<string>,
): Promise<string> => {
  const data = new Uint8Array(await blob.arrayBuffer())
  const id = await sha256Hex(arrayBufferFromUint8Array(data))
  await storageClient.setBlob({
    namespace: MODEL_LIBRARY_ARCHIVE_NAMESPACE,
    id,
    data,
    contentType: blob.type || 'application/zip',
  })
  await storageClient.set({
    namespace: MODEL_LIBRARY_ARCHIVE_METADATA_NAMESPACE,
    id,
    value: { fileName: sanitizeArchiveName(fileNameHint) },
  })
  return id
}

export const readLibraryArchive = async (
  storageClient: TaskyonStorageClient,
  id: string,
): Promise<File> => {
  const stored = await storageClient.getBlob({
    namespace: MODEL_LIBRARY_ARCHIVE_NAMESPACE,
    id,
  })
  if (!stored) throw new Error(`Modelica library archive not found: ${id}`)
  const metadata = await storageClient.get({
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

export const archiveExists = async (
  storageClient: TaskyonStorageClient,
  id: string,
): Promise<boolean> =>
  (await storageClient.statBlob({ namespace: MODEL_LIBRARY_ARCHIVE_NAMESPACE, id })) !== null

export const writeParsedCache = async (
  storageClient: TaskyonStorageClient,
  id: string,
  content: ArrayBuffer,
): Promise<void> => {
  await storageClient.setBlob({
    namespace: MODEL_LIBRARY_PARSED_NAMESPACE,
    id,
    data: new Uint8Array(content),
    contentType: 'application/octet-stream',
  })
}

export const readParsedCache = async (
  storageClient: TaskyonStorageClient,
  id: string,
): Promise<ArrayBuffer> => {
  const stored = await storageClient.getBlob({
    namespace: MODEL_LIBRARY_PARSED_NAMESPACE,
    id,
  })
  if (!stored) throw new Error(`Parsed Modelica cache not found: ${id}`)
  return arrayBufferFromUint8Array(stored.data)
}

export const sha256Hex = async (bytes: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const buildArchiveFingerprint = async (
  file: File,
  bytes: ArrayBuffer,
  rumocaVersionMarker: string,
): Promise<string> => {
  const contentHash = await sha256Hex(bytes)
  const identity = [
    `schema=${MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION}`,
    `version=${rumocaVersionMarker}`,
    `name=${file.name}`,
    `size=${file.size}`,
    `hash=${contentHash}`,
  ].join('|')
  return await sha256Hex(new TextEncoder().encode(identity).buffer)
}

export const writeLibraryParsedCacheMetadata = async (
  storageClient: TaskyonStorageClient,
  metadata: LibraryParsedCacheMetadata,
): Promise<void> => {
  await storageClient.set({
    namespace: MODEL_LIBRARY_PARSED_METADATA_NAMESPACE,
    id: metadata.archiveFingerprint,
    value: metadata,
  })
}

export const readLibraryParsedCacheMetadata = async (
  storageClient: TaskyonStorageClient,
  archiveFingerprint: string,
  rumocaVersionMarker: string,
): Promise<LibraryParsedCacheMetadata | null> => {
  try {
    const stored = await storageClient.get({
      namespace: MODEL_LIBRARY_PARSED_METADATA_NAMESPACE,
      id: archiveFingerprint,
    })
    const parsed = stored.value as Partial<LibraryParsedCacheMetadata> | null
    if (!parsed || parsed.archiveFingerprint !== archiveFingerprint) return null
    if (parsed.cacheSchemaVersion !== MODELICA_SOURCE_ROOT_CACHE_SCHEMA_VERSION) return null
    if (parsed.rumocaVersionMarker !== rumocaVersionMarker) return null
    if (typeof parsed.cacheId !== 'string' || !parsed.cacheId.trim()) return null
    if (
      !(await storageClient.statBlob({
        namespace: MODEL_LIBRARY_PARSED_NAMESPACE,
        id: parsed.cacheId,
      }))
    ) {
      return null
    }
    return parsed as LibraryParsedCacheMetadata
  } catch {
    return null
  }
}

export const parseLazyIndexCache = (
  raw: unknown,
  expectedFingerprint: string,
  rumocaVersionMarker: string,
): LibraryLazyIndexCache | null => {
  if (!raw || typeof raw !== 'object') return null
  const parsed = raw as Partial<LibraryLazyIndexCache>
  if (parsed.archiveFingerprint !== expectedFingerprint) return null
  if (parsed.cacheSchemaVersion !== MODELICA_LAZY_INDEX_CACHE_SCHEMA_VERSION) return null
  if (parsed.rumocaVersionMarker !== rumocaVersionMarker) return null
  const index = parsed.index
  if (!index || typeof index !== 'object') return null
  if (!Array.isArray(index.classes) || !Array.isArray(index.sourceRootUris)) return null
  if (!index.classToUris || typeof index.classToUris !== 'object') return null
  if (!index.uriToClasses || typeof index.uriToClasses !== 'object') return null
  if (!Number.isFinite(index.totalClasses) || !Number.isFinite(index.fileCount)) return null
  return parsed as LibraryLazyIndexCache
}

export const readCachedLazyLibraryIndex = async (
  storageClient: TaskyonStorageClient,
  archiveFingerprint: string,
  rumocaVersionMarker: string,
): Promise<LibraryLazyIndexCache | null> => {
  try {
    const stored = await storageClient.get({
      namespace: MODEL_LIBRARY_LAZY_INDEX_NAMESPACE,
      id: archiveFingerprint,
    })
    return parseLazyIndexCache(stored.value, archiveFingerprint, rumocaVersionMarker)
  } catch {
    return null
  }
}

export const writeLazyLibraryIndexCache = async (args: {
  storageClient: TaskyonStorageClient
  archiveName: string
  archiveId: string
  archiveFingerprint: string
  index: LazyModelicaLibraryIndex
  rumocaVersionMarker: string
}): Promise<LibraryLazyIndexCache> => {
  const payload: LibraryLazyIndexCache = {
    archiveName: args.archiveName,
    archiveId: args.archiveId,
    archiveFingerprint: args.archiveFingerprint,
    cacheSchemaVersion: MODELICA_LAZY_INDEX_CACHE_SCHEMA_VERSION,
    fileCount: args.index.fileCount,
    totalClasses: args.index.totalClasses,
    rumocaVersionMarker: args.rumocaVersionMarker,
    index: args.index,
  }
  await args.storageClient.set({
    namespace: MODEL_LIBRARY_LAZY_INDEX_NAMESPACE,
    id: args.archiveFingerprint,
    value: payload,
  })
  return payload
}
