import { constants } from 'node:fs'
import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import {
  access,
  appendFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Port } from '@taskyon/common/modules/frpBus'
import {
  createStorageProtocolServer,
  type StorageBlobBackend,
  type StorageBlobMetadata,
  type TaskyonStorageMessage,
} from '../../../taskyon/src/api/storageProtocol'
import {
  createStorageRecordFileBackend,
  parseStorageRecordFile,
  type StorageRecordFileAdapter,
} from '../../../taskyon/src/api/storageRecordFileBackend'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const LOCK_WAIT_TIMEOUT_MS = 10_000
const LOCK_OWNER_INITIALIZATION_GRACE_MS = 1_000
const LOCK_OWNER_FILE = 'owner.json'

const isAlreadyExistsError = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST'

const isMissingError = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'

const parseLockOwnerPid = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !('pid' in value))
    return undefined
  const pid = value.pid
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

const isAbandonedLock = async (lockDir: string) => {
  try {
    const owner = JSON.parse(await readFile(join(lockDir, LOCK_OWNER_FILE), 'utf8')) as unknown
    const ownerPid = parseLockOwnerPid(owner)
    return ownerPid !== undefined && !isProcessAlive(ownerPid)
  } catch (error) {
    if (!isMissingError(error) && !(error instanceof SyntaxError)) throw error
    try {
      const lockStat = await stat(lockDir)
      return Date.now() - lockStat.mtimeMs >= LOCK_OWNER_INITIALIZATION_GRACE_MS
    } catch (statError) {
      if (isMissingError(statError)) return false
      throw statError
    }
  }
}

const reclaimAbandonedLock = async (lockDir: string) => {
  if (!(await isAbandonedLock(lockDir))) return false
  const reclaimedDir = `${lockDir}.reclaimed-${process.pid}-${Date.now()}`
  try {
    await rename(lockDir, reclaimedDir)
  } catch (error) {
    if (isMissingError(error)) return false
    throw error
  }
  await rm(reclaimedDir, { recursive: true, force: true })
  return true
}

const writeLockOwner = async (lockDir: string) => {
  await writeFile(
    join(lockDir, LOCK_OWNER_FILE),
    `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`,
    'utf8',
  )
}

const toStoragePath = (storageRoot: string, path: string) => join(storageRoot, ...path.split('/'))

const safePathPart = (value: string) => encodeURIComponent(value)
const blobDirectory = (namespace: string) =>
  ['blobs', ...namespace.split('/').map(safePathPart)].join('/')
const blobPath = (namespace: string, id: string) =>
  `${blobDirectory(namespace)}/${safePathPart(id)}`
const blobMetadataPath = (namespace: string, id: string) =>
  `${blobDirectory(namespace)}/.metadata/${safePathPart(id)}.json`

export const resolveCliBlobStoragePath = (storageRoot: string, namespace: string, id: string) =>
  toStoragePath(storageRoot, blobPath(namespace, id))
const stagedBlobPath = (namespace: string, writeId: string) =>
  `${blobDirectory(namespace)}/.staging/${safePathPart(writeId)}`
const stagedBlobMetadataPath = (namespace: string, writeId: string) =>
  `${blobDirectory(namespace)}/.staging/${safePathPart(writeId)}.json`

const fileSha256 = async (path: string) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return `sha256:${hash.digest('hex')}`
}

const fileMetadata = async (
  path: string,
  id: string,
  details?: { contentType?: string; sha256?: string },
): Promise<StorageBlobMetadata> => {
  const value = await stat(path)
  return {
    id,
    size: value.size,
    modifiedAt: value.mtime.toISOString(),
    ...(details?.contentType ? { contentType: details.contentType } : {}),
    ...(details?.sha256 ? { sha256: details.sha256 } : {}),
  }
}

const missingAsNull = async <T>(operation: () => Promise<T>) => {
  try {
    return await operation()
  } catch (error) {
    if (isMissingError(error)) return null
    throw error
  }
}

const writeAllAt = async (
  handle: Awaited<ReturnType<typeof open>>,
  data: Uint8Array<ArrayBuffer>,
  position: number,
) => {
  let written = 0
  while (written < data.byteLength) {
    const result = await handle.write(data, written, data.byteLength - written, position + written)
    if (result.bytesWritten === 0) throw new Error('Blob write made no progress.')
    written += result.bytesWritten
  }
}

const readAllAt = async (
  handle: Awaited<ReturnType<typeof open>>,
  data: Uint8Array<ArrayBuffer>,
  position: number,
) => {
  let read = 0
  while (read < data.byteLength) {
    const result = await handle.read(data, read, data.byteLength - read, position + read)
    if (result.bytesRead === 0) break
    read += result.bytesRead
  }
  return read === data.byteLength ? data : data.slice(0, read)
}

export const createCliFileBlobStorageBackend = (
  storageRoot: string,
  namespace: string,
): StorageBlobBackend => {
  const directory = toStoragePath(storageRoot, blobDirectory(namespace))
  const lockDirectory = `${directory}.lock`
  const targetPath = (id: string) => toStoragePath(storageRoot, blobPath(namespace, id))
  const stagingPath = (writeId: string) =>
    toStoragePath(storageRoot, stagedBlobPath(namespace, writeId))
  const detailsPath = (id: string) => toStoragePath(storageRoot, blobMetadataPath(namespace, id))
  const stagingDetailsPath = (writeId: string) =>
    toStoragePath(storageRoot, stagedBlobMetadataPath(namespace, writeId))
  const readDetails = async (path: string) =>
    (await missingAsNull(
      async () =>
        JSON.parse(await readFile(path, 'utf8')) as {
          contentType?: string
          sha256?: string
        },
    )) ?? {}
  const writeDetails = async (path: string, details: { contentType?: string; sha256?: string }) =>
    await writeJsonFile(path, details)
  const locked = <T>(operation: () => Promise<T>) => withDirectoryLock(lockDirectory, operation)

  return {
    get: async (id) =>
      await missingAsNull(async () => {
        const path = targetPath(id)
        const data = new Uint8Array(await readFile(path))
        return { data, metadata: await fileMetadata(path, id, await readDetails(detailsPath(id))) }
      }),
    set: async (id, data, contentType) =>
      await locked(async () => {
        const path = targetPath(id)
        await mkdir(dirname(path), { recursive: true })
        const temporary = `${path}.tmp-${randomUUID()}`
        await writeFile(temporary, data)
        await rename(temporary, path)
        const details = {
          ...(contentType ? { contentType } : {}),
          sha256: `sha256:${createHash('sha256').update(data).digest('hex')}`,
        }
        await writeDetails(detailsPath(id), details)
        return await fileMetadata(path, id, details)
      }),
    stat: async (id) =>
      await missingAsNull(
        async () => await fileMetadata(targetPath(id), id, await readDetails(detailsPath(id))),
      ),
    list: async () => {
      try {
        const entries = await readdir(directory, { withFileTypes: true })
        return await Promise.all(
          entries
            .filter((entry) => entry.isFile())
            .map(async (entry) => {
              const id = decodeURIComponent(entry.name)
              return await fileMetadata(
                join(directory, entry.name),
                id,
                await readDetails(detailsPath(id)),
              )
            }),
        )
      } catch (error) {
        if (isMissingError(error)) return []
        throw error
      }
    },
    readRange: async (id, offset, length) => {
      const handle = await open(targetPath(id), 'r')
      try {
        const info = await handle.stat()
        const size = Math.max(0, Math.min(length, info.size - offset))
        const data = new Uint8Array(size)
        const bytes = size > 0 ? await readAllAt(handle, data, offset) : data
        const nextOffset = offset + bytes.byteLength
        return { data: bytes, nextOffset, eof: nextOffset >= info.size }
      } finally {
        await handle.close()
      }
    },
    append: async (id, data, expectedSize, contentType) =>
      await locked(async () => {
        const path = targetPath(id)
        await mkdir(dirname(path), { recursive: true })
        const currentSize = (await missingAsNull(async () => (await stat(path)).size)) ?? 0
        if (currentSize !== expectedSize) {
          throw new Error(
            `Blob append offset mismatch for "${id}": expected ${expectedSize}, found ${currentSize}.`,
          )
        }
        await appendFile(path, data)
        const existing = await readDetails(detailsPath(id))
        const details = {
          ...((contentType ?? existing.contentType)
            ? { contentType: contentType ?? existing.contentType }
            : {}),
        }
        await writeDetails(detailsPath(id), details)
        return await fileMetadata(path, id, details)
      }),
    beginWrite: async (_id, contentType) => {
      const writeId = randomUUID()
      const path = stagingPath(writeId)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, new Uint8Array())
      await writeDetails(stagingDetailsPath(writeId), contentType ? { contentType } : {})
      return { writeId }
    },
    writeChunk: async (_id, writeId, offset, data) =>
      await locked(async () => {
        const path = stagingPath(writeId)
        const handle = await open(path, 'r+')
        try {
          const info = await handle.stat()
          if (offset > info.size)
            throw new Error(`Blob write offset ${offset} exceeds size ${info.size}.`)
          await writeAllAt(handle, data, offset)
          return { nextOffset: Math.max(info.size, offset + data.byteLength) }
        } finally {
          await handle.close()
        }
      }),
    writeStatus: async (_id, writeId) => ({ size: (await stat(stagingPath(writeId))).size }),
    commitWrite: async (id, writeId, expectedSize, expectedSha256, targetId) =>
      await locked(async () => {
        const staged = stagingPath(writeId)
        const info = await stat(staged)
        if (info.size !== expectedSize) {
          throw new Error(
            `Blob size mismatch for "${id}": expected ${expectedSize}, found ${info.size}.`,
          )
        }
        const sha256 = await fileSha256(staged)
        if (expectedSha256 && sha256 !== expectedSha256) {
          throw new Error(`Blob checksum mismatch for "${id}".`)
        }
        const publishedId = targetId ?? id
        const target = targetPath(publishedId)
        const details = { ...(await readDetails(stagingDetailsPath(writeId))), sha256 }
        await mkdir(dirname(target), { recursive: true })
        await rename(staged, target)
        await writeDetails(detailsPath(publishedId), details)
        await rm(stagingDetailsPath(writeId), { force: true })
        return await fileMetadata(target, publishedId, details)
      }),
    abortWrite: async (_id, writeId) => {
      await Promise.all([
        rm(stagingPath(writeId), { force: true }),
        rm(stagingDetailsPath(writeId), { force: true }),
      ])
    },
    delete: async (id) => {
      await Promise.all([rm(targetPath(id), { force: true }), rm(detailsPath(id), { force: true })])
    },
    clear: async () => await rm(directory, { recursive: true, force: true }),
  }
}

const withDirectoryLock = async <T>(lockDir: string, operation: () => Promise<T>): Promise<T> => {
  const startedAt = Date.now()
  await mkdir(dirname(lockDir), { recursive: true })
  while (true) {
    try {
      await mkdir(lockDir, { recursive: false })
      try {
        await writeLockOwner(lockDir)
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true })
        throw error
      }
      break
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error
      if (await reclaimAbandonedLock(lockDir)) continue
      if (Date.now() - startedAt > LOCK_WAIT_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for active storage lock: ${lockDir}`, { cause: error })
      }
      await sleep(25)
    }
  }

  try {
    return await operation()
  } finally {
    await rm(lockDir, { recursive: true, force: true })
  }
}

const readJsonFile = async (filePath: string): ReturnType<StorageRecordFileAdapter['read']> => {
  try {
    const raw = await readFile(filePath, 'utf8')
    return parseStorageRecordFile(JSON.parse(raw))
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }
}

const writeJsonFile = async (filePath: string, value: unknown) => {
  await mkdir(dirname(filePath), { recursive: true })
  const tempPath = join(
    dirname(filePath),
    `.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(tempPath, filePath)
  } catch (error) {
    await rm(tempPath, { force: true })
    throw error
  }
}

const storageRecordFileName = /^[a-f0-9]{62}$/

const listRecordFileNames = async (dir: string, root = dir): Promise<string[]> => {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) return await listRecordFileNames(path, root)
        return entry.isFile() && storageRecordFileName.test(entry.name)
          ? [path.slice(root.length + 1)]
          : []
      }),
    )
    return nested.flat()
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

export const createCliFileStorageBackend = (
  storageRoot: string,
  namespace: string,
): ReturnType<typeof createStorageRecordFileBackend> => {
  let namespaceOperation = Promise.resolve()
  const serializeNamespaceOperation = <T>(operation: () => Promise<T>) => {
    const result = namespaceOperation.then(operation, operation)
    namespaceOperation = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  const adapter: StorageRecordFileAdapter = {
    read: async (path) => await readJsonFile(toStoragePath(storageRoot, path)),
    write: async (path, value) => await writeJsonFile(toStoragePath(storageRoot, path), value),
    remove: async (path) => await rm(toStoragePath(storageRoot, path), { force: true }),
    list: async (directory) =>
      (await listRecordFileNames(toStoragePath(storageRoot, directory))).map(
        (relativePath) => `${directory}/${relativePath.split('\\').join('/')}`,
      ),
    clearDirectory: async (directory) => {
      const dir = toStoragePath(storageRoot, directory)
      await rm(dir, { recursive: true, force: true })
      await mkdir(dir, { recursive: true })
    },
    withNamespaceLock: async (namespaceDirectory, operation) =>
      await serializeNamespaceOperation(
        async () =>
          await withDirectoryLock(
            `${toStoragePath(storageRoot, namespaceDirectory)}.lock`,
            operation,
          ),
      ),
  }

  return createStorageRecordFileBackend(adapter, namespace)
}

export const createCliFileStorageService = (
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  storageRoot: string,
) => {
  const backends = new Map<string, ReturnType<typeof createCliFileStorageBackend>>()
  const blobBackends = new Map<string, StorageBlobBackend>()
  return createStorageProtocolServer(
    port,
    {
      records: async (namespace) => {
        await mkdir(storageRoot, { recursive: true })
        await access(storageRoot, constants.W_OK)
        const existing = backends.get(namespace)
        if (existing) return existing
        const backend = createCliFileStorageBackend(storageRoot, namespace)
        backends.set(namespace, backend)
        return backend
      },
      blobs: (namespace) => {
        const existing = blobBackends.get(namespace)
        if (existing) return existing
        const backend = createCliFileBlobStorageBackend(storageRoot, namespace)
        blobBackends.set(namespace, backend)
        return backend
      },
    },
    { mode: 'trusted-local' },
  )
}
