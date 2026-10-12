import type { TaskyonStorageClient } from './storageProtocol'

/** Publish only a complete stream; keep at most one network chunk and one wire chunk in flight. */
export async function writeBlobStream(
  client: Pick<
    TaskyonStorageClient,
    'beginBlobWrite' | 'writeBlobChunk' | 'commitBlobWrite' | 'abortBlobWrite'
  >,
  target: { namespace: string; id: string; contentType?: string },
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
  options: { validatePrefix?: (prefix: Uint8Array) => void; signal?: AbortSignal } = {},
) {
  const reader = body.getReader()
  let writeId: string | undefined
  let size = 0
  let prefix = new Uint8Array()
  const abort = () => {
    void reader.cancel(options.signal?.reason).catch(() => undefined)
  }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    options.signal?.throwIfAborted()
    writeId = (await client.beginBlobWrite(target)).writeId
    for (;;) {
      options.signal?.throwIfAborted()
      const chunk = await reader.read()
      options.signal?.throwIfAborted()
      if (chunk.done) break
      if (prefix.length < 5) {
        const next = new Uint8Array(Math.min(5, prefix.length + chunk.value.length))
        next.set(prefix)
        next.set(chunk.value.subarray(0, next.length - prefix.length), prefix.length)
        prefix = next
        if (prefix.length === 5) options.validatePrefix?.(prefix)
      }
      for (let offset = 0; offset < chunk.value.length; offset += 1024 * 1024) {
        options.signal?.throwIfAborted()
        const data = chunk.value.slice(offset, offset + 1024 * 1024)
        await client.writeBlobChunk({ ...target, writeId, offset: size, data })
        size += data.length
      }
    }
    options.validatePrefix?.(prefix)
    options.signal?.throwIfAborted()
    return await client.commitBlobWrite({ ...target, writeId, expectedSize: size })
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    if (writeId) await client.abortBlobWrite({ ...target, writeId }).catch(() => undefined)
    throw error
  } finally {
    options.signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}
