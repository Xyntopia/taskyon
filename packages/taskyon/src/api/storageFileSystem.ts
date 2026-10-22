import { z } from 'zod'
import {
  blobGenerationSchema,
  blobWriteGenerationSchema,
  createChunkedBlobBackend,
  type BlobChunkStore,
  type BlobGeneration,
} from './chunkedBlobBackend'
import {
  createStorageRecordFileBackend,
  parseStorageRecordFile,
  type StorageRecordFileAdapter,
} from './storageRecordFileBackend'
import type { StorageBlobBackend, StorageBlobMetadata } from './storageProtocol'
import { blobProvenance } from './storageProtocol'

export type StorageDirectoryEntry = {
  name: string
  isDirectory: boolean
  isFile: boolean
}

/**
 * Minimal filesystem primitives shared by the Node, Tauri and browser file backends.
 * Paths are POSIX-style and relative to the storage root owned by the adapter.
 * Missing paths return null or empty results instead of runtime-specific errors.
 */
export type StorageFileSystem = {
  readFile: (path: string) => Promise<Uint8Array<ArrayBuffer> | null>
  writeFile: (path: string, data: Uint8Array<ArrayBuffer>) => Promise<void>
  remove: (path: string, options?: { recursive?: boolean }) => Promise<void>
  mkdir: (path: string) => Promise<void>
  list: (path: string) => Promise<StorageDirectoryEntry[]>
  stat: (path: string) => Promise<{ size: number; modifiedAtMs: number } | null>
  rename: (from: string, to: string) => Promise<void>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const joinPath = (...parts: string[]) =>
  parts
    .filter((part) => part.length > 0)
    .join('/')
    .replace(/\/+/g, '/')

const parentPath = (path: string) => {
  const separator = path.lastIndexOf('/')
  return separator <= 0 ? '' : path.slice(0, separator)
}

const readText = async (fs: StorageFileSystem, path: string) => {
  const data = await fs.readFile(path)
  return data === null ? null : decoder.decode(data)
}

const ensureParent = async (fs: StorageFileSystem, path: string) => {
  const parent = parentPath(path)
  if (parent) await fs.mkdir(parent)
}

const writeJson = async (fs: StorageFileSystem, path: string, value: unknown) => {
  const temporary = `${path}.tmp-${crypto.randomUUID()}`
  await ensureParent(fs, path)
  await fs.writeFile(temporary, encoder.encode(JSON.stringify(value)))
  await fs.rename(temporary, path)
}

const readJson = async (fs: StorageFileSystem, path: string): Promise<unknown> => {
  const text = await readText(fs, path)
  return text === null ? null : JSON.parse(text)
}

const namespaceSegments = (namespace: string) => namespace.split('/').map(encodeSegment)

const encodeSegment = (value: string) => encodeURIComponent(value).replace(/^\./, '%2E')

const blobDirectory = (namespace: string) => joinPath('blobs', ...namespaceSegments(namespace))
const blobManifestPath = (namespace: string, id: string) =>
  joinPath(blobDirectory(namespace), 'metadata', `${encodeSegment(id)}.json`)
const blobLegacyPath = (namespace: string, id: string) =>
  joinPath(blobDirectory(namespace), 'files', encodeSegment(id))
const blobStagingPath = (namespace: string, writeId: string) =>
  joinPath(blobDirectory(namespace), 'staging', `${encodeSegment(writeId)}.json`)
const blobGenerationDirectory = (namespace: string, generation: string) =>
  joinPath(blobDirectory(namespace), 'generations', encodeSegment(generation))

const serialMutex = () => {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(operation: () => Promise<T>): Promise<T> => {
    const run = tail.then(operation, operation)
    tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

const blobMetadata = (
  id: string,
  info: { size: number; modifiedAtMs: number },
  details: {
    contentType?: string | undefined
    sha256?: string | undefined
    provenance?: StorageBlobMetadata['provenance']
  },
): StorageBlobMetadata => ({
  id,
  size: info.size,
  modifiedAt: new Date(info.modifiedAtMs).toISOString(),
  ...(details.contentType ? { contentType: details.contentType } : {}),
  ...(details.sha256 ? { sha256: details.sha256 } : {}),
  ...(details.provenance ? { provenance: details.provenance } : {}),
})

export const createFileSystemBlobStorageBackend = (
  fs: StorageFileSystem,
  namespace: string,
): StorageBlobBackend => {
  const lock = serialMutex()
  const manifest = (id: string) => blobManifestPath(namespace, id)
  const generationDirectory = (generation: string) => blobGenerationDirectory(namespace, generation)

  const store: BlobChunkStore = {
    transaction: (operation) => lock(() => operation(store)),
    get: async (id) => {
      const value = await readJson(fs, manifest(id))
      if (z.object({ deleted: z.literal(true) }).safeParse(value).success) return null
      const current = blobGenerationSchema.safeParse(value)
      if (current.success && current.data.generation) return current.data
      const info = await fs.stat(blobLegacyPath(namespace, id))
      if (!info) return null
      const details = z
        .object({
          contentType: z.string().optional(),
          sha256: z.string().optional(),
          provenance: blobProvenance.optional(),
        })
        .safeParse(value)
      return {
        metadata: blobMetadata(id, info, details.success ? details.data : {}),
      }
    },
    list: async () => {
      const ids = new Set<string>()
      for (const [path, stripJson] of [
        [joinPath(blobDirectory(namespace), 'metadata'), true],
        [joinPath(blobDirectory(namespace), 'files'), false],
      ] as const) {
        for (const entry of await fs.list(path)) {
          if (entry.isFile)
            ids.add(decodeURIComponent(stripJson ? entry.name.replace(/\.json$/, '') : entry.name))
        }
      }
      const rows = await Promise.all([...ids].map((id) => store.get(id)))
      return rows.filter((row): row is BlobGeneration => row !== null)
    },
    publish: async (id, value) => {
      await writeJson(fs, manifest(id), value)
      await fs.remove(blobLegacyPath(namespace, id)).catch(() => undefined)
    },
    remove: async (id) => {
      await writeJson(fs, manifest(id), { deleted: true })
      await fs.remove(blobLegacyPath(namespace, id)).catch(() => undefined)
    },
    getWrite: async (writeId) => {
      const value = await readJson(fs, blobStagingPath(namespace, writeId))
      const current = blobWriteGenerationSchema.safeParse(value)
      return current.success ? current.data : null
    },
    putWrite: (writeId, value) => writeJson(fs, blobStagingPath(namespace, writeId), value),
    removeWrite: async (writeId) => {
      await fs.remove(blobStagingPath(namespace, writeId)).catch(() => undefined)
    },
    readChunk: async (generation, index) => {
      const data = await fs.readFile(joinPath(generationDirectory(generation), String(index)))
      return data ?? new Uint8Array()
    },
    putChunk: async (generation, index, data) => {
      await fs.writeFile(joinPath(generationDirectory(generation), String(index)), data)
    },
    removeGeneration: async (generation) => {
      if ((await store.list()).some((row) => row.generation === generation)) return
      await fs
        .remove(joinPath(blobDirectory(namespace), 'generations', encodeSegment(generation)), {
          recursive: true,
        })
        .catch(() => undefined)
    },
    readLegacy: async (id, offset, length) => {
      const data = await fs.readFile(blobLegacyPath(namespace, id))
      if (data === null) throw new Error('Legacy blob not found')
      return data.slice(offset, offset + length)
    },
    clear: () => fs.remove(blobDirectory(namespace), { recursive: true }),
  }
  return createChunkedBlobBackend(store)
}

const storageRecordFileName = /^[A-Za-z0-9_-]{41}$/

const listRecordFiles = async (
  fs: StorageFileSystem,
  currentDirectory: string,
): Promise<string[]> => {
  const paths: string[][] = []
  for (const entry of await fs.list(currentDirectory)) {
    const path = `${currentDirectory}/${entry.name}`
    if (entry.isDirectory) paths.push(await listRecordFiles(fs, path))
    else if (entry.isFile && storageRecordFileName.test(entry.name)) paths.push([path])
  }
  return paths.flat()
}

export const createFileSystemStorageRecordFileAdapter = (
  fs: StorageFileSystem,
): StorageRecordFileAdapter => {
  const lock = serialMutex()
  return {
    read: async (path) => {
      const text = await readText(fs, path)
      if (text === null) return null
      if (text.trim() === '') {
        await fs.remove(path).catch(() => undefined)
        return null
      }
      return parseStorageRecordFile(JSON.parse(text))
    },
    write: async (path, value) => await writeJson(fs, path, { id: value.id, data: value.data }),
    remove: async (path) => await fs.remove(path),
    list: async (directory) => await listRecordFiles(fs, directory),
    clearDirectory: async (directory) => await fs.remove(directory, { recursive: true }),
    withNamespaceLock: async (_namespaceDirectory, operation) => await lock(operation),
  }
}

export const createFileSystemStorageProvider = (fs: StorageFileSystem) => {
  const adapter = createFileSystemStorageRecordFileAdapter(fs)
  return {
    records: (namespace: string) => createStorageRecordFileBackend(adapter, namespace),
    blobs: (namespace: string) => createFileSystemBlobStorageBackend(fs, namespace),
  }
}
