/** Read only the bytes needed for preflight, then release the network response. */
export async function readResponsePrefix(response: Response, length: number) {
  if (!Number.isSafeInteger(length) || length <= 0) throw new Error('Prefix length must be positive')
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const prefix = new Uint8Array(length)
  let size = 0
  try {
    while (size < length) {
      const chunk = await reader.read()
      if (chunk.done) break
      const part = chunk.value.subarray(0,length-size)
      prefix.set(part,size)
      size += part.length
    }
    return prefix.subarray(0,size)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
