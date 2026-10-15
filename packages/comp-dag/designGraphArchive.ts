import { strToU8, unzipSync, zipSync } from 'fflate'
import { normalizeProjectedPath, type DagProjectedFile } from './dagGitProjection.ts'

// Bound both uploaded bytes and the expanded text before allocating decompressed entries.
export const DESIGN_GRAPH_ZIP_MAX_BYTES = 32 * 1024 * 1024
const maxEntryCount = 4096

const createArchiveEntryValidator = () => {
  const paths = new Set<string>()
  let totalBytes = 0
  return (path: string, size: number) => {
    normalizeProjectedPath(path)
    if (paths.has(path)) throw new Error('The graph ZIP contains duplicate file paths.')
    paths.add(path)
    totalBytes += size
    if (paths.size > maxEntryCount || totalBytes > DESIGN_GRAPH_ZIP_MAX_BYTES)
      throw new Error('The graph ZIP exceeds the supported file count or expanded size.')
  }
}

export const encodeDesignGraphZip = (files: readonly DagProjectedFile[]) => {
  const validate = createArchiveEntryValidator()
  const entries = files.map(({ path, content }) => {
    const bytes = strToU8(content)
    validate(path, bytes.byteLength)
    return [path, bytes] as const
  })
  if (!entries.length) throw new Error('The graph ZIP must contain repository files.')
  const archive = zipSync(Object.fromEntries(entries))
  if (archive.byteLength > DESIGN_GRAPH_ZIP_MAX_BYTES)
    throw new Error('The graph ZIP exceeds the supported upload size.')
  return archive
}

export const decodeDesignGraphZip = (archive: Uint8Array): DagProjectedFile[] => {
  if (archive.byteLength > DESIGN_GRAPH_ZIP_MAX_BYTES)
    throw new Error('The graph ZIP exceeds the supported upload size.')
  const validate = createArchiveEntryValidator()
  const entries = unzipSync(archive, {
    filter: ({ name, originalSize }) => {
      if (name.endsWith('/')) {
        validate(name.slice(0, -1), originalSize)
        return false
      }
      validate(name, originalSize)
      return true
    },
  })
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const files = Object.entries(entries).map(([path, bytes]) => ({
    path,
    content: decoder.decode(bytes),
  }))
  if (!files.length) throw new Error('The graph ZIP must contain repository files.')
  return files
}
