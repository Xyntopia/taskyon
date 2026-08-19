import {
  createStorageProtocolServer,
  createStorageRecordFileBackend,
  parseStorageRecordFile,
  type Port,
  type StorageRecordFileAdapter,
  type StorageBlobBackend,
  type StorageBlobMetadata,
  type TaskyonStorageMessage,
} from '@taskyon/taskyon/api'
import { createSha256Hasher } from '@taskyon/common/modules/canonicalHash'
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

type NavigatorWithLocks = Navigator & {
  locks?: {
    request: <T>(name: string, callback: () => Promise<T>) => Promise<T>
  }
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
    return parseStorageRecordFile(JSON.parse(await (await file.getFile()).text()))
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

const writeBlobDetails = async (
  root: FileSystemDirectoryHandle,
  path: string,
  details: { contentType?: string; sha256?: string },
) => {
  const writable = await (await getFile(root, path, true)).createWritable()
  await writable.write(JSON.stringify(details))
  await writable.close()
}

const hashFile = async (file: File) => {
  const hash = createSha256Hasher()
  const reader = file.stream().getReader()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) return hash.digest()
      hash.update(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
}

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
  const lockPrefix = options.lockNamePrefix ?? 'taskyon-opfs-storage'
  const locked = <T>(operation: () => Promise<T>) =>
    withBrowserLock(`${lockPrefix}:blobs:${namespace}`, operation)
  const target = (id: string) => blobPath(namespace, id)
  const staged = (writeId: string) => stagedBlobPath(namespace, writeId)
  const details = (id: string) => blobMetadataPath(namespace, id)
  const stagedDetails = (writeId: string) => stagedBlobMetadataPath(namespace, writeId)

  return {
    get: async (id) =>
      await missingBlobAsNull(async () => {
        const handle = await getFile(root, target(id))
        const file = await handle.getFile()
        return {
          data: new Uint8Array(await file.arrayBuffer()),
          metadata: await blobMetadata(
            handle,
            id,
            (await readBlobDetails(root, details(id))) ?? {},
          ),
        }
      }),
    set: async (id, data, contentType) =>
      await locked(async () => {
        const handle = await getFile(root, target(id), true)
        const writable = await handle.createWritable()
        await writable.write(data)
        await writable.close()
        const metadataDetails = {
          ...(contentType ? { contentType } : {}),
          sha256: await hashFile(await handle.getFile()),
        }
        await writeBlobDetails(root, details(id), metadataDetails)
        return await blobMetadata(handle, id, metadataDetails)
      }),
    stat: async (id) =>
      await missingBlobAsNull(
        async () =>
          await blobMetadata(
            await getFile(root, target(id)),
            id,
            (await readBlobDetails(root, details(id))) ?? {},
          ),
      ),
    list: async () => {
      try {
        const directory = await getDirectory(
          root,
          normalizeRelativePath(blobDirectory(namespace)),
          false,
        )
        const values: StorageBlobMetadata[] = []
        for await (const [name, handle] of directory.entries()) {
          if (!isFileHandle(handle)) continue
          const id = decodeURIComponent(name)
          values.push(
            await blobMetadata(handle, id, (await readBlobDetails(root, details(id))) ?? {}),
          )
        }
        return values
      } catch (error) {
        if (error instanceof Error && error.name === 'NotFoundError') return []
        throw error
      }
    },
    readRange: async (id, offset, length) => {
      const file = await (await getFile(root, target(id))).getFile()
      const data = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer())
      const nextOffset = offset + data.byteLength
      return { data, nextOffset, eof: nextOffset >= file.size }
    },
    append: async (id, data, expectedSize, contentType) =>
      await locked(async () => {
        const handle = await getFile(root, target(id), true)
        const current = await handle.getFile()
        if (current.size !== expectedSize) {
          throw new Error(
            `Blob append offset mismatch for "${id}": expected ${expectedSize}, found ${current.size}.`,
          )
        }
        const writable = await handle.createWritable({ keepExistingData: true })
        await writable.seek(current.size)
        await writable.write(data)
        await writable.close()
        const existing = (await readBlobDetails(root, details(id))) ?? {}
        const metadataDetails = {
          ...((contentType ?? existing.contentType)
            ? { contentType: contentType ?? existing.contentType }
            : {}),
        }
        await writeBlobDetails(root, details(id), metadataDetails)
        return await blobMetadata(handle, id, metadataDetails)
      }),
    beginWrite: async (_id, contentType) => {
      const writeId = crypto.randomUUID()
      const writable = await (await getFile(root, staged(writeId), true)).createWritable()
      await writable.close()
      await writeBlobDetails(root, stagedDetails(writeId), contentType ? { contentType } : {})
      return { writeId }
    },
    writeChunk: async (_id, writeId, offset, data) =>
      await locked(async () => {
        const handle = await getFile(root, staged(writeId))
        const current = await handle.getFile()
        if (offset > current.size)
          throw new Error(`Blob write offset ${offset} exceeds size ${current.size}.`)
        const writable = await handle.createWritable({ keepExistingData: true })
        await writable.seek(offset)
        await writable.write(data)
        await writable.close()
        return { nextOffset: Math.max(current.size, offset + data.byteLength) }
      }),
    writeStatus: async (_id, writeId) => ({
      size: (await (await getFile(root, staged(writeId))).getFile()).size,
    }),
    commitWrite: async (id, writeId, expectedSize, expectedSha256, targetId) =>
      await locked(async () => {
        const stagedHandle = await getFile(root, staged(writeId))
        const file = await stagedHandle.getFile()
        if (file.size !== expectedSize) {
          throw new Error(
            `Blob size mismatch for "${id}": expected ${expectedSize}, found ${file.size}.`,
          )
        }
        const sha256 = await hashFile(file)
        if (expectedSha256 && sha256 !== expectedSha256) {
          throw new Error(`Blob checksum mismatch for "${id}".`)
        }
        const publishedId = targetId ?? id
        const targetHandle = await getFile(root, target(publishedId), true)
        const writable = await targetHandle.createWritable()
        await writable.write(file)
        await writable.close()
        const metadataDetails = {
          ...((await readBlobDetails(root, stagedDetails(writeId))) ?? {}),
          sha256,
        }
        await writeBlobDetails(root, details(publishedId), metadataDetails)
        await removeFile(root, staged(writeId))
        await removeFile(root, stagedDetails(writeId))
        return await blobMetadata(targetHandle, publishedId, metadataDetails)
      }),
    abortWrite: async (_id, writeId) => {
      await Promise.all([
        removeFile(root, staged(writeId)),
        removeFile(root, stagedDetails(writeId)),
      ])
    },
    delete: async (id) => {
      await Promise.all([removeFile(root, target(id)), removeFile(root, details(id))])
    },
    clear: async () => await clearDirectory(root, blobDirectory(namespace)),
  }
}

const withBrowserLock = async <T>(lockName: string, operation: () => Promise<T>): Promise<T> => {
  const locks = (navigator as NavigatorWithLocks).locks
  if (!locks) return await operation()
  return await locks.request(lockName, operation)
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
    withNamespaceLock: async (namespaceDirectory, operation) =>
      await withBrowserLock(`${lockPrefix}:${namespaceDirectory}`, operation),
  }
}

export const createOpfsStorageBackendResolver = (options: OpfsStorageOptions = {}) => {
  const adapter = createOpfsStorageRecordFileAdapter(options)
  return async (namespace: string) => createStorageRecordFileBackend(await adapter, namespace)
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
