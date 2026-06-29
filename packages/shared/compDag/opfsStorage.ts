// opfsStorage.ts
// Minimal OPFS helpers for read/write by path.

export {}

const hasBrowserOpfs = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'

const nodeOpfsRoot = (): string => {
  const proc = globalThis as unknown as {
    process?: { cwd?: () => string; env?: Record<string, string | undefined> }
  }
  const cwd = proc.process?.cwd?.() ?? '.'
  return proc.process?.env?.TASKYON_NODE_OPFS_ROOT ?? `${cwd}/.joulios/opfs`
}

const safeNodePath = async (path: string): Promise<string> => {
  const pathMod = await import(/* @vite-ignore */ 'node:path')
  const root = pathMod.resolve(nodeOpfsRoot())
  const resolved = pathMod.resolve(root, path)
  if (resolved !== root && !resolved.startsWith(`${root}${pathMod.sep}`)) {
    throw new Error(`OPFS path escapes Node storage root: ${path}`)
  }
  return resolved
}

/**
 * Returns the origin private file system root directory handle.
 *
 * @returns the OPFS root directory handle
 */
async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

/**
 * Resolves a file handle for the given path, optionally creating directories.
 *
 * @param path the OPFS path to resolve
 * @param create whether to create missing directories or files
 * @returns the file handle for the path
 */
async function getFileHandle(path: string, create: boolean): Promise<FileSystemFileHandle> {
  const root = await getRoot()
  const parts = path.split('/').filter((p) => p.length > 0)
  if (parts.length === 0) {
    throw new Error('Path must not be empty')
  }
  const fileName = parts[parts.length - 1]!
  let dir = root
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part, { create })
  }
  return dir.getFileHandle(fileName, { create })
}

/**
 * Opens a file from OPFS for reading.
 *
 * @param path the OPFS path to open
 * @returns the file contents as a File object
 */
export async function openFile(path: string): Promise<File> {
  if (!hasBrowserOpfs()) {
    const fs = await import(/* @vite-ignore */ 'node:fs/promises')
    const data = await fs.readFile(await safeNodePath(path))
    return new File([new Uint8Array(data)], path.split('/').pop() ?? 'data')
  }
  const handle = await getFileHandle(path, false)
  return handle.getFile()
}

/**
 * Writes a file to OPFS, creating intermediate directories as needed.
 *
 * @param path the OPFS path to write
 * @param file the file contents to persist
 * @returns a promise that resolves when the write completes
 */
export async function writeFile(path: string, file: File): Promise<void> {
  if (!hasBrowserOpfs()) {
    const fs = await import(/* @vite-ignore */ 'node:fs/promises')
    const pathMod = await import(/* @vite-ignore */ 'node:path')
    const target = await safeNodePath(path)
    await fs.mkdir(pathMod.dirname(target), { recursive: true })
    await fs.writeFile(target, new Uint8Array(await file.arrayBuffer()))
    return
  }
  const handle = await getFileHandle(path, true)
  const writable = await handle.createWritable()
  await writable.write(file)
  await writable.close()
}

/**
 * Deletes a file from OPFS if it exists.
 *
 * @param path the OPFS path to delete
 */
export async function deleteFile(path: string): Promise<void> {
  if (!hasBrowserOpfs()) {
    const fs = await import(/* @vite-ignore */ 'node:fs/promises')
    await fs.rm(await safeNodePath(path), { force: true })
    return
  }
  const root = await getRoot()
  const parts = path.split('/').filter((p) => p.length > 0)
  if (parts.length === 0) return
  const fileName = parts[parts.length - 1]!
  let dir = root
  for (const part of parts.slice(0, -1)) {
    dir = await dir.getDirectoryHandle(part, { create: false })
  }
  await dir.removeEntry(fileName)
}

/**
 * Lists file names directly under the given directory path.
 *
 * @param dirPath the OPFS directory path
 * @returns file names in the directory (not recursive)
 */
export async function listFiles(dirPath: string): Promise<string[]> {
  if (!hasBrowserOpfs()) {
    const fs = await import(/* @vite-ignore */ 'node:fs/promises')
    const entries = await fs.readdir(await safeNodePath(dirPath), { withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  }
  const root = await getRoot()
  const parts = dirPath.split('/').filter((p) => p.length > 0)
  let dir = root
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: false })
  }
  const out: string[] = []
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') out.push(name)
  }
  return out
}
