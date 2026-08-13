export type FetchCapability = {
  action: 'fetch'
  origin: string
  access: 'read' | 'write'
}

export type FetchAuthorization = (capability: FetchCapability) => Promise<boolean>

const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
]

function isBlockedHostname(hostname: string) {
  const normalized = hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^\[|\]$/g, '')
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized === 'metadata.google.internal'
  ) {
    return true
  }
  if (PRIVATE_IPV4.some((pattern) => pattern.test(normalized))) return true
  if (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('::ffff:') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('ff')
  ) {
    return true
  }
  return normalized.startsWith('fc') || normalized.startsWith('fd')
}

export function validateSandboxFetchUrl(input: RequestInfo | URL): URL {
  const url = new URL(input instanceof Request ? input.url : input)
  if (url.protocol !== 'https:') {
    throw new Error('Sandbox fetch only permits HTTPS URLs')
  }
  if (url.username || url.password) {
    throw new Error('Sandbox fetch does not permit credentials in URLs')
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error(`Sandbox fetch blocks private or local target: ${url.hostname}`)
  }
  return url
}

export function createMediatedFetch(options: {
  authorize: FetchAuthorization
  fetch?: typeof fetch
  maxResponseBytes?: number
  signal?: AbortSignal
  timeoutMs?: number
}) {
  const hostFetch = options.fetch ?? globalThis.fetch
  const maxResponseBytes = options.maxResponseBytes ?? 16 * 1024 * 1024
  const timeoutMs = options.timeoutMs ?? 30_000
  const authorizationByCapability = new Map<string, Promise<boolean>>()

  const mediatedFetch: typeof fetch = async (input, init = {}) => {
    const url = validateSandboxFetchUrl(input)
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const access = method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? 'read' : 'write'
    const capabilityKey = `${access}:${url.origin}`
    const authorization =
      authorizationByCapability.get(capabilityKey) ??
      options.authorize({ action: 'fetch', origin: url.origin, access })
    authorizationByCapability.set(capabilityKey, authorization)
    if (!(await authorization)) {
      throw new Error(`Sandbox fetch was not authorized for ${url.origin}`)
    }

    const signals = [
      options.signal,
      input instanceof Request ? input.signal : undefined,
      init.signal,
      AbortSignal.timeout(timeoutMs),
    ].filter((signal): signal is AbortSignal => signal instanceof AbortSignal)
    const signal = AbortSignal.any(signals)
    const response = await hostFetch(url, {
      ...init,
      credentials: 'omit',
      redirect: 'manual',
      signal,
    })
    const contentLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
      await response.body?.cancel('Response exceeds sandbox fetch limit')
      throw new Error(`Sandbox fetch response exceeds ${maxResponseBytes} bytes`)
    }
    if (!response.body) return response

    const chunks: Uint8Array[] = []
    const reader = response.body.getReader()
    let receivedBytes = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > maxResponseBytes) {
        await reader.cancel('Response exceeds sandbox fetch limit')
        throw new Error(`Sandbox fetch response exceeds ${maxResponseBytes} bytes`)
      }
      chunks.push(value)
    }
    const body = new Uint8Array(receivedBytes)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }

  return mediatedFetch
}
