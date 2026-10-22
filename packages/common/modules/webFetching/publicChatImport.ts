import { validateSandboxFetchUrl } from './mediatedFetch'

export const PUBLIC_CHAT_MAX_BYTES = 2 * 1024 * 1024
export const PUBLIC_CHAT_MAX_REDIRECTS = 5

export type PublicChatDocumentFetch = (request: Request) => Promise<Response>

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

const readBoundedText = async (response: Response, maxBytes: number) => {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) throw new Error(`Public chat document exceeds ${maxBytes} bytes`)
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } catch (error) {
    await reader.cancel(error).catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}

export const fetchPublicChatDocument = async (
  fetchDocument: PublicChatDocumentFetch,
  source: string,
  options: { maxBytes?: number; maxRedirects?: number } = {},
): Promise<{ url: string; text: string }> => {
  let target = validateSandboxFetchUrl(source)
  const maxBytes = options.maxBytes ?? PUBLIC_CHAT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? PUBLIC_CHAT_MAX_REDIRECTS

  for (let redirects = 0; ; redirects++) {
    const response = await fetchDocument(new Request(target, { redirect: 'manual' }))
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (redirects >= maxRedirects) throw new Error('Public chat document redirected too many times')
      if (!location) throw new Error('Public chat redirect has no destination')
      target = validateSandboxFetchUrl(new URL(location, target))
      continue
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`Public chat download failed with HTTP ${response.status}`)
    }
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.toLowerCase().includes('text/html')) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Public chat URL returned an HTML page instead of a chat document')
    }
    return { url: target.toString(), text: await readBoundedText(response, maxBytes) }
  }
}
