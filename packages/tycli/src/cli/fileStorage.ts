import { constants } from 'node:fs'
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Port } from '@taskyon/common/modules/frpBus'
import {
  createStorageProtocolServer,
  type TaskyonStorageMessage,
} from '../../../taskyon/src/api/storageProtocol'
import {
  createStorageRecordFileBackend,
  parseStorageRecordFile,
  type StorageRecordFileAdapter,
} from '../../../taskyon/src/api/storageRecordFileBackend'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const isAlreadyExistsError = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'EEXIST'

const toStoragePath = (storageRoot: string, path: string) => join(storageRoot, ...path.split('/'))

const withDirectoryLock = async <T>(lockDir: string, operation: () => Promise<T>): Promise<T> => {
  const startedAt = Date.now()
  await mkdir(dirname(lockDir), { recursive: true })
  while (true) {
    try {
      await mkdir(lockDir, { recursive: false })
      break
    } catch (error) {
      if (!isAlreadyExistsError(error) || Date.now() - startedAt > 10_000) throw error
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
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
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
  const adapter: StorageRecordFileAdapter = {
    read: async (path) => await readJsonFile(toStoragePath(storageRoot, path)),
    write: async (path, value) => await writeJsonFile(toStoragePath(storageRoot, path), value),
    remove: async (path) => await rm(toStoragePath(storageRoot, path), { force: true }),
    list: async (directory) =>
      (await listRecordFileNames(toStoragePath(storageRoot, directory))).map(
        (fileName) => `${directory}/${fileName}`,
      ),
    clearDirectory: async (directory) => {
      const dir = toStoragePath(storageRoot, directory)
      await rm(dir, { recursive: true, force: true })
      await mkdir(dir, { recursive: true })
    },
    withNamespaceLock: async (namespaceDirectory, operation) =>
      await withDirectoryLock(`${toStoragePath(storageRoot, namespaceDirectory)}.lock`, operation),
  }

  return createStorageRecordFileBackend(adapter, namespace)
}

export const createCliFileStorageService = (
  port: Port<TaskyonStorageMessage, TaskyonStorageMessage>,
  storageRoot: string,
) =>
  createStorageProtocolServer(port, async (namespace) => {
    await mkdir(storageRoot, { recursive: true })
    await access(storageRoot, constants.W_OK)
    return createCliFileStorageBackend(storageRoot, namespace)
  })
