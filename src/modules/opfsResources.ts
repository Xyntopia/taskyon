import type { ResourceFilesLoader } from '@taskyon/common/modules/resourceFiles'

export type OpfsResourceEntry = {
  name: string
  path: string
  kind: 'file' | 'directory'
  size?: number
}

type OpfsDirectoryHandle = FileSystemDirectoryHandle & {
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>
}

export const resolveOpfsResourceHandle = async (path: string) => {
  const segments = path.split('/').filter(Boolean)
  let directory = (await navigator.storage.getDirectory()) as OpfsDirectoryHandle
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1
    if (last) {
      try {
        return await directory.getFileHandle(segment)
      } catch {
        return await directory.getDirectoryHandle(segment)
      }
    }
    directory = (await directory.getDirectoryHandle(segment)) as OpfsDirectoryHandle
  }
  return directory
}

export const listOpfsResourceEntries = async (path: string): Promise<OpfsResourceEntry[]> => {
  const handle = await resolveOpfsResourceHandle(path)
  if (handle.kind !== 'directory') throw new Error(`OPFS resource is not a directory: ${path}`)
  const entries: OpfsResourceEntry[] = []
  for await (const [name, child] of (handle as OpfsDirectoryHandle).entries()) {
    const childPath = path ? `${path}/${name}` : name
    if (child.kind === 'directory') {
      entries.push({ name, path: childPath, kind: 'directory' })
    } else {
      const file = await child.getFile()
      entries.push({ name, path: childPath, kind: 'file', size: file.size })
    }
  }
  return entries.sort((left, right) =>
    left.kind === right.kind
      ? left.name.localeCompare(right.name)
      : left.kind === 'directory'
        ? -1
        : 1,
  )
}

export const loadOpfsResourceFiles: ResourceFilesLoader = async function* (source) {
  const initialPath = decodeURIComponent(source.slice('/resources/opfs'.length)).replace(/^\/+/, '')
  const initial = await resolveOpfsResourceHandle(initialPath)
  if (initial.kind === 'file') {
    yield {
      url: source,
      path: initial.name,
      file: await initial.getFile(),
    }
    return
  }

  const pending = [initialPath]
  while (pending.length > 0) {
    const directoryPath = pending.pop()
    if (directoryPath === undefined) continue
    for (const entry of await listOpfsResourceEntries(directoryPath)) {
      if (entry.kind === 'directory') {
        pending.push(entry.path)
        continue
      }
      const handle = await resolveOpfsResourceHandle(entry.path)
      if (handle.kind !== 'file') continue
      yield {
        url: `/resources/opfs/${entry.path}`,
        path: initialPath ? entry.path.slice(initialPath.length).replace(/^\/+/, '') : entry.path,
        file: await handle.getFile(),
      }
    }
  }
}
