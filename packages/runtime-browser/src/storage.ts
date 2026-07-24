import {
  createStorageProtocolServer,
  createStorageRecordFileBackend,
  parseStorageRecordFile,
  type Port,
  type StorageRecordFileAdapter,
  type TaskyonStorageMessage,
} from '@taskyon/taskyon/api'

export type OpfsStorageOptions = {
  rootDirectory?: string
  lockNamePrefix?: string
}

export type BrowserRuntimeStorageService =
  | {
      kind: 'opfs'
      rootDirectory?: string
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

const listJsonFiles = async (root: FileSystemDirectoryHandle, directory: string) => {
  try {
    const dir = await getDirectory(root, normalizeRelativePath(directory), false)
    const paths: string[] = []
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'file' && name.endsWith('.json')) paths.push(`${directory}/${name}`)
    }
    return paths
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
    list: async (directory) => await listJsonFiles(root, directory),
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
) => createStorageProtocolServer(port, createOpfsStorageBackendResolver(options))

export const startBrowserStorageService = async (
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  storage: BrowserRuntimeStorageService,
) => {
  if (storage.kind === 'opfs') {
    return createOpfsStorageService(port, {
      ...(storage.rootDirectory ? { rootDirectory: storage.rootDirectory } : {}),
    })
  }
  return await storage.createService(port)
}
