import { writeBlobStream } from '../api/storageStreaming'
import type { TaskyonStorageClient } from '../api/storageProtocol'

export const testStorageStreamWritesBeforeReadingAhead = async () => {
  let reads = 0
  let writes = 0
  let committed = false
  const client: Pick<
    TaskyonStorageClient,
    'beginBlobWrite' | 'writeBlobChunk' | 'commitBlobWrite' | 'abortBlobWrite'
  > = {
    beginBlobWrite: () => Promise.resolve().then(() => ({ writeId: 'synthetic' })),
    writeBlobChunk: ({ offset, data }) =>
      Promise.resolve().then(() => {
        if (reads !== writes + 1) throw new Error('Stream read ahead of storage')
        if (data.length > 1024 * 1024) throw new Error('Storage chunk exceeds wire bound')
        writes++
        return { nextOffset: offset + data.length }
      }),
    commitBlobWrite: ({ expectedSize, id }) =>
      Promise.resolve().then(() => {
        committed = true
        if (expectedSize !== 17 * 1024 * 1024) throw new Error('Incomplete stream')
        return { id, size: expectedSize, modifiedAt: 'synthetic' }
      }),
    abortBlobWrite: () => Promise.resolve().then(() => undefined),
  }
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>(
    {
      pull(controller) {
        if (reads === 17) {
          controller.close()
          return
        }
        reads++
        controller.enqueue(new Uint8Array(1024 * 1024))
      },
    },
    { highWaterMark: 0 },
  )
  await writeBlobStream(client, { namespace: 'synthetic', id: 'large' }, body)
  if (!committed || writes !== 17) throw new Error('Stream was not committed')
}

export const testStorageStreamAbortsAndCancelsOnFailure = async () => {
  let aborted = false
  let cancelled = false
  const client: Pick<
    TaskyonStorageClient,
    'beginBlobWrite' | 'writeBlobChunk' | 'commitBlobWrite' | 'abortBlobWrite'
  > = {
    beginBlobWrite: () => Promise.resolve().then(() => ({ writeId: 'synthetic' })),
    writeBlobChunk: () =>
      Promise.resolve().then(() => {
        throw new Error('synthetic quota failure')
      }),
    commitBlobWrite: () =>
      Promise.resolve().then(() => {
        throw new Error('Must not publish')
      }),
    abortBlobWrite: () =>
      Promise.resolve().then(() => {
        aborted = true
        return undefined
      }),
  }
  const body = new ReadableStream<Uint8Array<ArrayBuffer>>(
    {
      pull(controller) {
        controller.enqueue(new Uint8Array([1]))
      },
      cancel() {
        cancelled = true
      },
    },
    { highWaterMark: 0 },
  )
  let message = ''
  try {
    await writeBlobStream(client, { namespace: 'synthetic', id: 'value' }, body)
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  if (!aborted || !cancelled || message !== 'synthetic quota failure')
    throw new Error('Failed stream did not preserve its error and clean up')
}
