import { constants } from 'node:fs'
import { createReadStream } from 'node:fs'
import { randomUUID } from 'node:crypto'
import {
  access,
  appendFile,
  copyFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  readlink,
  symlink,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createSha256Hasher, sha256HashBytes } from '@taskyon/common/modules/canonicalHash'
import type { Port } from '@taskyon/common/modules/frpBus'
import {
  createStorageProtocolServer,
  type BlobProvenance,
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
  const hash = createSha256Hasher()
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest()
}

const fileMetadata = async (
  path: string,
  id: string,
  details?: { contentType?: string; sha256?: string; provenance?: BlobProvenance },
): Promise<StorageBlobMetadata> => {
  const value = await stat(path)
  return {
    id,
    size: value.size,
    modifiedAt: value.mtime.toISOString(),
    ...(details?.contentType ? { contentType: details.contentType } : {}),
    ...(details?.sha256 ? { sha256: details.sha256 } : {}),
    ...(details?.provenance ? { provenance: details.provenance } : {}),
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
          id?: string
          contentType?: string
          sha256?: string
          provenance?: BlobProvenance
        },
    )) ?? {}
  const writeDetails = async (
    path: string,
    details: {
      id?: string
      generation?: string
      contentType?: string
      sha256?: string
      provenance?: BlobProvenance
    },
  ) => await writeJsonFile(path, details)
  const locked = <T>(operation: () => Promise<T>) => withDirectoryLock(lockDirectory, operation)

  const generationPath = (generation: string) =>
    join(directory, '.generations', safePathPart(generation))
  const visiblePath = async (id: string) => {
    const link = await missingAsNull(async () => {
      try {
        return await readlink(targetPath(id))
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'EINVAL') return null
        throw error
      }
    })
    return link ? join(dirname(targetPath(id)), link) : targetPath(id)
  }
  const visibleDetails = async (id: string, path: string) =>
    readDetails(path === targetPath(id) ? detailsPath(id) : `${path}.json`)
  const requireWrite = async (id: string, writeId: string) => {
    const details = await readDetails(stagingDetailsPath(writeId))
    if (details.id !== id)
      throw new Error('Unknown blob write or legacy staging write without object identity')
    return details
  }
  const publish = async (
    id: string,
    path: string,
    details: { contentType?: string; sha256?: string; provenance?: BlobProvenance },
  ) => {
    const generation = randomUUID()
    const destination = generationPath(generation)
    await mkdir(dirname(destination), { recursive: true })
    const previous = await visiblePath(id)
    await rename(path, destination)
    const link = `${targetPath(id)}.tmp-${generation}`
    try {
      await writeDetails(`${destination}.json`, details)
      await symlink(`.generations/${safePathPart(generation)}`, link)
      await rename(link, targetPath(id))
    } catch (error) {
      await Promise.all([
        rm(destination, { force: true }),
        rm(`${destination}.json`, { force: true }),
        rm(link, { force: true }),
      ]).catch(() => undefined)
      throw error
    }
    if (previous !== targetPath(id)) {
      await Promise.all([
        rm(previous, { force: true }),
        rm(`${previous}.json`, { force: true }),
      ]).catch(() => undefined)
    }
    await rm(detailsPath(id), { force: true }).catch(() => undefined)
    return fileMetadata(destination, id, details)
  }

  return {
    get: async (id) =>
      await locked(() =>
        missingAsNull(async () => {
          const path = await visiblePath(id)
          const data = new Uint8Array(await readFile(path))
          return { data, metadata: await fileMetadata(path, id, await visibleDetails(id, path)) }
        }),
      ),
    set: async (id, data, contentType, provenance) =>
      locked(async () => {
        const temporary = stagingPath(randomUUID())
        await mkdir(dirname(temporary), { recursive: true })
        try {
          await writeFile(temporary, data)
          return await publish(id, temporary, {
            ...(contentType ? { contentType } : {}),
            sha256: sha256HashBytes(data),
            ...(provenance ? { provenance } : {}),
          })
        } finally {
          await rm(temporary, { force: true }).catch(() => undefined)
        }
      }),
    stat: async (id) =>
      locked(() =>
        missingAsNull(async () => {
          const path = await visiblePath(id)
          return fileMetadata(path, id, await visibleDetails(id, path))
        }),
      ),
    list: () =>
      locked(async () => {
        const entries = await missingAsNull(() => readdir(directory, { withFileTypes: true }))
        const rows = await Promise.all(
          (entries ?? [])
            .filter((entry) => entry.isFile() || entry.isSymbolicLink())
            .map((entry) =>
              missingAsNull(async () => {
                const id = decodeURIComponent(entry.name)
                const path = await visiblePath(id)
                return fileMetadata(path, id, await visibleDetails(id, path))
              }),
            ),
        )
        return rows.filter((row): row is StorageBlobMetadata => row !== null)
      }),
    readRange: async (id, offset, length) => {
      const handle = await open(await visiblePath(id), 'r')
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
    append: async (id, data, expectedSize, contentType, provenance) =>
      locked(async () => {
        const path = await visiblePath(id)
        const size = (await missingAsNull(() => stat(path)))?.size ?? 0
        if (size !== expectedSize) throw new Error('Blob append offset mismatch')
        const temporary = stagingPath(randomUUID())
        await mkdir(dirname(temporary), { recursive: true })
        try {
          if (size) await copyFile(path, temporary)
          else await writeFile(temporary, new Uint8Array())
          await appendFile(temporary, data)
          const previous = await visibleDetails(id, path)
          return await publish(id, temporary, {
            contentType: contentType ?? previous.contentType,
            sha256: await fileSha256(temporary),
            ...(provenance ?? previous.provenance
              ? { provenance: provenance ?? previous.provenance }
              : {}),
          })
        } finally {
          await rm(temporary, { force: true }).catch(() => undefined)
        }
      }),
    beginWrite: async (id, contentType, provenance) => {
      const writeId = randomUUID()
      const path = stagingPath(writeId)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, new Uint8Array())
      await writeDetails(stagingDetailsPath(writeId), {
        id,
        ...(contentType ? { contentType } : {}),
        ...(provenance ? { provenance } : {}),
      })
      return { writeId }
    },
    writeChunk: async (id, writeId, offset, data) =>
      await locked(async () => {
        await requireWrite(id, writeId)
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
    writeStatus: async (id, writeId) =>
      locked(async () => {
        await requireWrite(id, writeId)
        return { size: (await stat(stagingPath(writeId))).size }
      }),
    commitWrite: async (id, writeId, expectedSize, expectedSha256, targetId) =>
      await locked(async () => {
        const stagedDetails = await requireWrite(id, writeId)
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
        const details = {
          ...(stagedDetails.contentType ? { contentType: stagedDetails.contentType } : {}),
          sha256,
          ...(stagedDetails.provenance ? { provenance: stagedDetails.provenance } : {}),
        }
        const metadata = await publish(publishedId, staged, details)
        await rm(stagingDetailsPath(writeId), { force: true }).catch(() => undefined)
        return metadata
      }),
    abortWrite: async (id, writeId) =>
      locked(async () => {
        if ((await readDetails(stagingDetailsPath(writeId))).id !== id) return
        await Promise.all([
          rm(stagingPath(writeId), { force: true }),
          rm(stagingDetailsPath(writeId), { force: true }),
        ])
      }),
    delete: async (id) =>
      locked(async () => {
        const path = await visiblePath(id)
        await rm(targetPath(id), { force: true })
        await rm(detailsPath(id), { force: true })
        if (path !== targetPath(id))
          await Promise.all([rm(path, { force: true }), rm(`${path}.json`, { force: true })])
      }),
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

const storageRecordFileName = /^[A-Za-z0-9_-]{41}$/

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
