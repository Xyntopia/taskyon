import type * as TauriFsModule from '@tauri-apps/plugin-fs'
import {
  createFileSystemStorageProvider,
  type StorageDirectoryEntry,
  type StorageFileSystem,
} from '@taskyon/taskyon/api'

export const NATIVE_STORAGE_ROOT = 'taskyon-storage'

let fsModule: Promise<typeof TauriFsModule> | undefined

const loadFs = () => (fsModule ??= import('@tauri-apps/plugin-fs'))

const trailingSlash = /\/+$/

const parentPath = (path: string) => {
  const separator = path.lastIndexOf('/')
  return separator <= 0 ? '' : path.slice(0, separator)
}

export const createTauriStorageFileSystem = async (
  root = NATIVE_STORAGE_ROOT,
): Promise<StorageFileSystem> => {
  const fs = await loadFs()
  const { BaseDirectory, exists, readFile, writeFile, remove, mkdir, readDir, stat, rename } = fs
  const baseDir = BaseDirectory.AppData
  const full = (path: string) => {
    const normalized = path.replace(/^\/+|\/+$/g, '')
    return normalized ? `${root}/${normalized}` : root
  }
  const ensureParent = async (path: string) => {
    const parent = parentPath(full(path))
    if (parent) await mkdir(parent, { baseDir, recursive: true })
  }
  const present = (path: string) => exists(full(path), { baseDir })

  return {
    readFile: async (path) =>
      (await present(path)) ? await readFile(full(path), { baseDir }) : null,
    writeFile: async (path, data) => {
      await ensureParent(path)
      await writeFile(full(path), data, { baseDir })
    },
    remove: async (path, options) => {
      if (!(await present(path))) return
      await remove(full(path), { baseDir, recursive: options?.recursive ?? false })
    },
    mkdir: async (path) => {
      if (!path) return
      await mkdir(full(path), { baseDir, recursive: true })
    },
    list: async (path): Promise<StorageDirectoryEntry[]> => {
      if (!(await present(path))) return []
      const entries = await readDir(full(path), { baseDir })
      return entries.map((entry) => ({
        name: entry.name.replace(trailingSlash, ''),
        isDirectory: entry.isDirectory,
        isFile: entry.isFile,
      }))
    },
    stat: async (path) => {
      if (!(await present(path))) return null
      const info = await stat(full(path), { baseDir })
      return { size: info.size, modifiedAtMs: info.mtime ? info.mtime.getTime() : Date.now() }
    },
    rename: async (from, to) => {
      await ensureParent(to)
      await rename(full(from), full(to), { oldPathBaseDir: baseDir, newPathBaseDir: baseDir })
    },
  }
}

export const createTauriStorageProvider = async () =>
  createFileSystemStorageProvider(await createTauriStorageFileSystem())
