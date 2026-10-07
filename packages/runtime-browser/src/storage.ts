import { z } from 'zod'
import {
  createStorageProtocolServer,
  createChunkedBlobBackend,
  blobGenerationSchema,
  blobWriteGenerationSchema,
  type BlobChunkStore,
  type BlobGeneration,
  createStorageRecordFileBackend,
  parseStorageRecordFile,
  type Port,
  type StorageRecordFileAdapter,
  type StorageBlobBackend,
  type StorageBlobMetadata,
  type TaskyonStorageMessage,
} from '@taskyon/taskyon/api'
import type {
  BrowserStorageBackendKind,
  BrowserStoragePreferenceStore,
} from './browserStorageSelection'

export type OpfsStorageOptions = {
  rootDirectory?: string
  lockNamePrefix?: string
}

export const requestBrowserStoragePersistence = async (
  storageManager: Pick<StorageManager, 'persisted' | 'persist'> | undefined = typeof navigator ===
  'undefined'
    ? undefined
    : navigator.storage,
) => {
  if (
    !storageManager ||
    typeof storageManager.persisted !== 'function' ||
    typeof storageManager.persist !== 'function'
  ) {
    return false
  }
  if (await storageManager.persisted()) return true
  return await storageManager.persist()
}

export type BrowserRuntimeStorageService =
  | {
      kind: 'browser'
      databaseName?: string
      records?: readonly BrowserStorageBackendKind[]
      blobs?: readonly BrowserStorageBackendKind[]
      preferences?: BrowserStoragePreferenceStore
    }
  | {
      kind: 'service'
      createService: (
        port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
      ) => void | (() => void) | Promise<void | (() => void)>
    }

const assertBrowserOpfs = () => {
  if (typeof navigator === 'undefined' || typeof navigator.storage?.getDirectory !== 'function') {
    throw new Error('Taskyon OPFS storage requires browser OPFS support.')
  }
}

const isFileHandle = (handle: FileSystemHandle): handle is FileSystemFileHandle =>
  handle.kind === 'file' && 'getFile' in handle

const normalizeRelativePath = (path: string) => {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '')
  const segments = normalized.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0) throw new Error('OPFS path must not be empty.')
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`OPFS path escapes the storage root: ${path}`)
  }
  return segments
}

const getDirectory = async (
  root: FileSystemDirectoryHandle,
  parts: readonly string[],
  create: boolean,
) => {
  let dir = root
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create })
  }
  return dir
}

const getRootDirectory = async (options: OpfsStorageOptions = {}) => {
  assertBrowserOpfs()
  const root = await navigator.storage.getDirectory()
  const rootDirectory = options.rootDirectory?.trim()
  if (!rootDirectory) return root
  return await getDirectory(root, normalizeRelativePath(rootDirectory), true)
}

const readJsonFile = async (
  root: FileSystemDirectoryHandle,
  path: string,
): ReturnType<StorageRecordFileAdapter['read']> => {
  const parts = normalizeRelativePath(path)
  const fileName = parts.at(-1)
  if (!fileName) throw new Error('OPFS file path must include a filename.')
  try {
    const dir = await getDirectory(root, parts.slice(0, -1), false)
    const file = await dir.getFileHandle(fileName, { create: false })
    const raw = await (await file.getFile()).text()
    if (raw.trim() === '') {
      try {
        await dir.removeEntry(fileName)
      } catch (error) {
        if (!(error instanceof Error && error.name === 'NotFoundError')) throw error
      }
      return null
    }
    return parseStorageRecordFile(JSON.parse(raw))
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') return null
    throw error
  }
}

const writeJsonFile = async (
  root: FileSystemDirectoryHandle,
  path: string,
  value: Parameters<StorageRecordFileAdapter['write']>[1],
) => {
  const parts = normalizeRelativePath(path)
  const fileName = parts.at(-1)
  if (!fileName) throw new Error('OPFS file path must include a filename.')
  const dir = await getDirectory(root, parts.slice(0, -1), true)
  const file = await dir.getFileHandle(fileName, { create: true })
  const writable = await file.createWritable()
  try {
    await writable.write(`${JSON.stringify(value, null, 2)}\n`)
  } finally {
    await writable.close()
  }
}

const removeFile = async (root: FileSystemDirectoryHandle, path: string) => {
  const parts = normalizeRelativePath(path)
  const fileName = parts.at(-1)
  if (!fileName) return
  try {
    const dir = await getDirectory(root, parts.slice(0, -1), false)
    await dir.removeEntry(fileName)
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') return
    throw error
  }
}

const storageRecordFileName = /^[A-Za-z0-9_-]{41}$/

const listRecordFiles = async (
  root: FileSystemDirectoryHandle,
  directory: string,
  currentDirectory = directory,
): Promise<string[]> => {
  try {
    const dir = await getDirectory(root, normalizeRelativePath(currentDirectory), false)
    const paths: string[][] = []
    for await (const [name, handle] of dir.entries()) {
      const path = `${currentDirectory}/${name}`
      if (handle.kind === 'directory') {
        paths.push(await listRecordFiles(root, directory, path))
      } else if (storageRecordFileName.test(name)) {
        paths.push([path])
      }
    }
    return paths.flat()
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') return []
    throw error
  }
}

const clearDirectory = async (root: FileSystemDirectoryHandle, directory: string) => {
  const dir = await getDirectory(root, normalizeRelativePath(directory), true)
  for await (const [name] of dir.entries()) {
    await dir.removeEntry(name, { recursive: true })
  }
}

const blobDirectory = (namespace: string) =>
  ['blobs', ...namespace.split('/').map(encodeURIComponent)].join('/')
const blobPath = (namespace: string, id: string) =>
  `${blobDirectory(namespace)}/${encodeURIComponent(id)}`
const blobMetadataPath = (namespace: string, id: string) =>
  `${blobDirectory(namespace)}/.metadata/${encodeURIComponent(id)}.json`
const stagedBlobPath = (namespace: string, writeId: string) =>
  `${blobDirectory(namespace)}/.staging/${encodeURIComponent(writeId)}`
const stagedBlobMetadataPath = (namespace: string, writeId: string) =>
  `${blobDirectory(namespace)}/.staging/${encodeURIComponent(writeId)}.json`

const getFile = async (root: FileSystemDirectoryHandle, path: string, create = false) => {
  const parts = normalizeRelativePath(path)
  const name = parts.at(-1)
  if (!name) throw new Error('Blob path must include a filename.')
  const directory = await getDirectory(root, parts.slice(0, -1), create)
  return await directory.getFileHandle(name, { create })
}

const blobMetadata = async (
  handle: FileSystemFileHandle,
  id: string,
  details?: { contentType?: string; sha256?: string },
): Promise<StorageBlobMetadata> => {
  const file = await handle.getFile()
  return {
    id,
    size: file.size,
    modifiedAt: new Date(file.lastModified).toISOString(),
    ...(details?.contentType ? { contentType: details.contentType } : {}),
    ...(details?.sha256 ? { sha256: details.sha256 } : {}),
  }
}

const readBlobDetails = async (root: FileSystemDirectoryHandle, path: string) =>
  await missingBlobAsNull(async () => {
    const file = await (await getFile(root, path)).getFile()
    return JSON.parse(await file.text()) as { contentType?: string; sha256?: string }
  })

const missingBlobAsNull = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof Error && error.name === 'NotFoundError') return null
    throw error
  }
}

export const createOpfsBlobStorageBackend = async (
  namespace: string,
  options: OpfsStorageOptions = {},
): Promise<StorageBlobBackend> => {
  const root = await getRootDirectory(options)
  const directory = blobDirectory(namespace)
  const lockPrefix = options.lockNamePrefix ?? 'taskyon-opfs-storage'
  const manifest = (id: string) => blobMetadataPath(namespace, id)
  const staging = (id: string) => stagedBlobMetadataPath(namespace, id)
  const generationDirectory = (generation: string) =>
    `${directory}/.generations/${encodeURIComponent(generation)}`
  const readJson = async (path: string): Promise<unknown> =>
    missingBlobAsNull(async () =>
      JSON.parse(await (await (await getFile(root, path)).getFile()).text()),
    )
  const writeJson = async (path: string, value: unknown) => {
    const writable = await (await getFile(root, path, true)).createWritable()
    try {
      await writable.write(JSON.stringify(value))
      await writable.close()
    } catch (error) {
      await writable.abort().catch(() => undefined)
      throw error
    }
  }
  const store: BlobChunkStore = {
    transaction: (operation) =>
      withBrowserLock(`${lockPrefix}:blobs:${namespace}`, 'exclusive', () => operation(store)),
    get: async (id) => {
      const value = await readJson(manifest(id))
      if (z.object({ deleted: z.literal(true) }).safeParse(value).success) return null
      const current = blobGenerationSchema.safeParse(value)
      if (current.success && current.data.generation) return current.data
      return missingBlobAsNull(async () => ({
        metadata: await blobMetadata(
          await getFile(root, blobPath(namespace, id)),
          id,
          (await readBlobDetails(root, manifest(id))) ?? {},
        ),
      }))
    },
    list: async () => {
      const ids = new Set<string>()
      for (const path of [directory, `${directory}/.metadata`]) {
        const dir = await missingBlobAsNull(() =>
          getDirectory(root, normalizeRelativePath(path), false),
        )
        if (!dir) continue
        for await (const [name, handle] of dir.entries()) {
          if (isFileHandle(handle))
            ids.add(
              decodeURIComponent(path.endsWith('/.metadata') ? name.replace(/\.json$/, '') : name),
            )
        }
      }
      const rows = await Promise.all([...ids].map((id) => store.get(id)))
      return rows.filter((row): row is BlobGeneration => row !== null)
    },
    publish: async (id, value) => {
      // Closing one manifest publishes data and metadata together. Chunk files stay immutable
      // once published; a failed close leaves the old manifest and old generation visible.
      await writeJson(manifest(id), value)
      await removeFile(root, blobPath(namespace, id)).catch(() => undefined)
    },
    remove: async (id) => {
      await writeJson(manifest(id), { deleted: true })
      await removeFile(root, blobPath(namespace, id)).catch(() => undefined)
    },
    getWrite: async (writeId) => {
      const value = await readJson(staging(writeId))
      const current = blobWriteGenerationSchema.safeParse(value)
      if (current.success) return current.data
      // Old OPFS staging files did not persist object IDs. They cannot safely be claimed
      // by a new caller; committed legacy files remain readable and migrate on append.
      if (await missingBlobAsNull(() => getFile(root, stagedBlobPath(namespace, writeId))))
        throw new Error('Legacy OPFS staging write has no object identity; restart the write')
      return null
    },
    putWrite: (writeId, value) => writeJson(staging(writeId), value),
    removeWrite: async (writeId) => {
      await removeFile(root, staging(writeId)).catch(() => undefined)
    },
    readChunk: async (generation, index) =>
      (await missingBlobAsNull(
        async () =>
          new Uint8Array(
            await (
              await (await getFile(root, `${generationDirectory(generation)}/${index}`)).getFile()
            ).arrayBuffer(),
          ),
      )) ?? new Uint8Array(),
    putChunk: async (generation, index, data) => {
      const writable = await (
        await getFile(root, `${generationDirectory(generation)}/${index}`, true)
      ).createWritable()
      try {
        await writable.write(data)
        await writable.close()
      } catch (error) {
        await writable.abort().catch(() => undefined)
        throw error
      }
    },
    removeGeneration: async (generation) => {
      // A stale staging manifest after a cleanup failure must never delete live data.
      if ((await store.list()).some((row) => row.generation === generation)) return
      const dir = await getDirectory(root, normalizeRelativePath(`${directory}/.generations`), true)
      await dir
        .removeEntry(encodeURIComponent(generation), { recursive: true })
        .catch(() => undefined)
    },
    readLegacy: async (id, offset, length) =>
      new Uint8Array(
        await (await (await getFile(root, blobPath(namespace, id))).getFile())
          .slice(offset, offset + length)
          .arrayBuffer(),
      ),
    clear: () => clearDirectory(root, directory),
  }
  return createChunkedBlobBackend(store)
}

const withBrowserLock = async <T>(
  lockName: string,
  mode: 'shared' | 'exclusive',
  operation: () => Promise<T>,
): Promise<T> => {
  if (!navigator.locks) return await operation()
  return await navigator.locks.request(lockName, { mode }, operation)
}

export const createOpfsStorageRecordFileAdapter = async (
  options: OpfsStorageOptions = {},
): Promise<StorageRecordFileAdapter> => {
  const root = await getRootDirectory(options)
  const lockPrefix = options.lockNamePrefix ?? 'taskyon-opfs-storage'
  return {
    read: async (path) => await readJsonFile(root, path),
    write: async (path, value) => await writeJsonFile(root, path, value),
    remove: async (path) => await removeFile(root, path),
    list: async (directory) => await listRecordFiles(root, directory),
    clearDirectory: async (directory) => await clearDirectory(root, directory),
    withNamespaceLock: async (namespaceDirectory, operation, mode) =>
      await withBrowserLock(`${lockPrefix}:${namespaceDirectory}`, mode, operation),
  }
}

export const createOpfsStorageBackendResolver = (options: OpfsStorageOptions = {}) => {
  let adapter: Promise<StorageRecordFileAdapter> | undefined
  return async (namespace: string) => {
    adapter ??= createOpfsStorageRecordFileAdapter(options)
    return createStorageRecordFileBackend(await adapter, namespace)
  }
}

export const createOpfsStorageService = (
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  options: OpfsStorageOptions = {},
) =>
  createStorageProtocolServer(
    port,
    {
      records: createOpfsStorageBackendResolver(options),
      blobs: async (namespace) => await createOpfsBlobStorageBackend(namespace, options),
    },
    { mode: 'trusted-local' },
  )

export const startBrowserStorageService = async (
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  storage: BrowserRuntimeStorageService,
) => {
  if (storage.kind === 'browser') {
    const { selectBrowserStorageProvider } = await import('./browserStorageSelection')
    const { provider } = await selectBrowserStorageProvider({
      ...(storage.databaseName ? { databaseName: storage.databaseName } : {}),
      ...(storage.records ? { records: storage.records } : {}),
      ...(storage.blobs ? { blobs: storage.blobs } : {}),
      ...(storage.preferences ? { preferences: storage.preferences } : {}),
    })
    return createStorageProtocolServer(port, provider, { mode: 'trusted-local' })
  }
  return await storage.createService(port)
}
