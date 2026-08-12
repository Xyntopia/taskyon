import { createSha256Hasher } from '@taskyon/common/modules/canonicalHash'
import type { StorageBlobBackend } from '../api/storageProtocol'
import type { FileAttachment } from '../types/taskNode'
import { sha256HashesFromFile } from '../utils/encoding'

const CHUNK_SIZE = 1024 * 1024
const artifactBlobId = (hash: string) =>
  hash.startsWith('sha256:') ? `sha256-${hash.slice('sha256:'.length)}` : hash
const artifactHash = (id: string) =>
  /^sha256-[A-Za-z0-9_-]{43}$/.test(id) ? `sha256:${id.slice('sha256-'.length)}` : id

const writeFile = async (storage: StorageBlobBackend, attachment: FileAttachment, file: File) => {
  const id = artifactBlobId(attachment.hash)
  const { writeId } = await storage.beginWrite(id, attachment.mediaType)
  let offset = 0
  try {
    const reader = file.stream().getReader()
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        for (let start = 0; start < chunk.value.byteLength; start += CHUNK_SIZE) {
          const data = chunk.value.slice(start, start + CHUNK_SIZE)
          offset = (await storage.writeChunk(id, writeId, offset, data)).nextOffset
        }
      }
    } finally {
      reader.releaseLock()
    }
    await storage.commitWrite(id, writeId, attachment.size, attachment.hash)
  } catch (error) {
    await storage.abortWrite(id, writeId).catch(() => undefined)
    throw error
  }
}

const readFile = async (storage: StorageBlobBackend, reference: FileAttachment | string) => {
  const hash = typeof reference === 'string' ? reference : reference.hash
  const id = artifactBlobId(hash)
  const metadata = await storage.stat(id)
  if (!metadata) return undefined
  const attachment =
    typeof reference === 'string'
      ? {
          hash,
          name: hash,
          mediaType: metadata.contentType ?? 'application/octet-stream',
          size: metadata.size,
        }
      : reference
  const parts: BlobPart[] = []
  const hasher = createSha256Hasher()
  let offset = 0
  while (true) {
    const chunk = await storage.readRange(id, offset, CHUNK_SIZE)
    parts.push(chunk.data)
    hasher.update(chunk.data)
    if (chunk.eof) break
    if (chunk.nextOffset <= offset) {
      throw new Error(`Artifact read made no progress for "${attachment.hash}".`)
    }
    offset = chunk.nextOffset
  }
  if (attachment.hash.startsWith('sha256:') && hasher.digest() !== attachment.hash) {
    throw new Error(`Artifact checksum mismatch for "${attachment.hash}".`)
  }
  return new File(parts, attachment.name, { type: attachment.mediaType })
}

export type ArtifactStore = {
  put: (file: File) => Promise<FileAttachment>
  get: (attachment: FileAttachment | string) => Promise<File | undefined>
  list: StorageBlobBackend['list']
}

export const createArtifactStore = (storage: StorageBlobBackend): ArtifactStore => ({
  put: async (file) => {
    const { sha256 } = await sha256HashesFromFile(file)
    const attachment: FileAttachment = {
      hash: sha256,
      name: file.name,
      mediaType: file.type || 'application/octet-stream',
      size: file.size,
    }
    const existing = await storage.stat(artifactBlobId(attachment.hash))
    if (existing && existing.size !== attachment.size) {
      throw new Error(`Stored artifact size does not match "${attachment.hash}".`)
    }
    if (!existing) await writeFile(storage, attachment, file)
    return attachment
  },
  get: async (attachment) => await readFile(storage, attachment),
  list: async () =>
    (await storage.list()).map((metadata) => ({
      ...metadata,
      id: artifactHash(metadata.id),
    })),
})
