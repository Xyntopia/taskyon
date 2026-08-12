import { createSha256Hasher } from '@taskyon/common/modules/canonicalHash'
import type { InvocationArtifact } from './designGraphModel.ts'
import type { InvocationArtifactStore, StagedArtifactWriter } from './invocationExecution.ts'

export type InvocationArtifactStorageClient = {
  statBlob: (request: {
    namespace: string
    id: string
  }) => Promise<{ id: string; size: number; sha256?: string | undefined } | null>
  beginBlobWrite: (request: {
    namespace: string
    id: string
    contentType: string
  }) => Promise<{ writeId: string }>
  writeBlobChunk: (request: {
    namespace: string
    id: string
    writeId: string
    offset: number
    data: Uint8Array<ArrayBuffer>
  }) => Promise<{ nextOffset: number }>
  commitBlobWrite: (request: {
    namespace: string
    id: string
    targetId: string
    writeId: string
    expectedSize: number
    expectedSha256: string
  }) => Promise<{
    id: string
    size: number
    contentType?: string | undefined
    sha256?: string | undefined
  }>
  abortBlobWrite: (request: { namespace: string; id: string; writeId: string }) => Promise<void>
}

const storageId = (hash: string) => hash.replace(':', '_')

export const createStorageInvocationArtifactStore = (
  storage: InvocationArtifactStorageClient,
  makeStagingId: () => string,
  namespace = 'design-graph/v2/artifacts',
): InvocationArtifactStore => {
  const begin = async (mediaType: string): Promise<StagedArtifactWriter> => {
    const stagingId = `staging_${makeStagingId()}`
    const { writeId } = await storage.beginBlobWrite({
      namespace,
      id: stagingId,
      contentType: mediaType,
    })
    const hasher = createSha256Hasher()
    let offset = 0
    let closed = false
    return {
      write: async (chunk) => {
        if (closed) throw new Error('Cannot write to a finalized invocation artifact.')
        hasher.update(chunk)
        const result = await storage.writeBlobChunk({
          namespace,
          id: stagingId,
          writeId,
          offset,
          data: new Uint8Array(chunk),
        })
        offset = result.nextOffset
      },
      commit: async () => {
        if (closed) throw new Error('Invocation artifact is already finalized.')
        closed = true
        const id = hasher.digest()
        const metadata = await storage.commitBlobWrite({
          namespace,
          id: stagingId,
          targetId: storageId(id),
          writeId,
          expectedSize: offset,
          expectedSha256: id,
        })
        return { id, size: metadata.size, mediaType: metadata.contentType ?? mediaType }
      },
      abort: async () => {
        if (closed) return
        closed = true
        await storage.abortBlobWrite({
          namespace,
          id: stagingId,
          writeId,
        })
      },
    }
  }
  return {
    begin,
    write: async (value, mediaType) => {
      const writer = await begin(mediaType)
      await writer.write(new TextEncoder().encode(JSON.stringify(value)))
      return await writer.commit()
    },
    exists: async (artifact: InvocationArtifact) => {
      const metadata = await storage.statBlob({
        namespace,
        id: storageId(artifact.id),
      })
      return (
        metadata !== null &&
        metadata.sha256 === artifact.id &&
        (artifact.size === undefined || metadata.size === artifact.size)
      )
    },
  }
}
