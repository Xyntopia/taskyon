// opfsStorage.ts
// Minimal OPFS helpers for read/write by path.

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
  const handle = await getFileHandle(path, true)
  const writable = await handle.createWritable()
  await writable.write(file)
  await writable.close()
}
