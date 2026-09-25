export type FetchCapability = {
  action: 'fetch'
  origin: string
  access: 'read' | 'write'
  preferProxy?: boolean
  privateTarget?: boolean
}

export type FetchAuthorization = (capability: FetchCapability) => Promise<boolean>

export type SandboxFetchPolicy = 'default' | 'direct' | 'proxy'

export const SANDBOX_FETCH_TRANSPORTS = ['wss', 'custom-proxy', 'direct'] as const
export type SandboxFetchTransport = (typeof SANDBOX_FETCH_TRANSPORTS)[number]
export const DEFAULT_SANDBOX_FETCH_TRANSPORT: SandboxFetchTransport = 'wss'
export const SANDBOX_FETCH_TRANSPORT_OPTIONS = [
  { label: 'Secure WSS tunnel (recommended)', value: 'wss' },
  { label: 'Custom proxy', value: 'custom-proxy' },
  { label: 'Direct host fetch', value: 'direct' },
] as const satisfies ReadonlyArray<{ label: string; value: SandboxFetchTransport }>

export function resolveSandboxFetchTransport(
  configured: SandboxFetchTransport,
  policy: SandboxFetchPolicy,
): SandboxFetchTransport {
  return policy === 'direct' ? 'direct' : configured
}

export type SandboxProxyFetchOptions = {
  cacheBust?: boolean | undefined
  stripHeaders?: boolean | undefined
}

export type SandboxFetchOptions = {
  policy?: SandboxFetchPolicy | undefined
  proxy?: SandboxProxyFetchOptions | undefined
  preferProxy?: boolean | undefined
}

export type FetchWithPolicy = (
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: SandboxFetchOptions,
) => Promise<Response>

export function mergeSandboxFetchOptions(
  defaults: SandboxFetchOptions | undefined,
  requested: SandboxFetchOptions | undefined,
): SandboxFetchOptions {
  const requestedPolicy = requested?.policy ?? 'default'
  const policy = requestedPolicy === 'default' ? (defaults?.policy ?? 'default') : requestedPolicy
  const proxy = { ...defaults?.proxy, ...requested?.proxy }
  return {
    policy,
    ...(requested?.preferProxy !== undefined
      ? { preferProxy: requested.preferProxy }
      : defaults?.preferProxy !== undefined
        ? { preferProxy: defaults.preferProxy }
        : {}),
    ...(defaults?.proxy || requested?.proxy ? { proxy } : {}),
  }
}

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

export function isPrivateSandboxFetchUrl(input: RequestInfo | URL): boolean {
  const url = new URL(input instanceof Request ? input.url : input)
  return isBlockedHostname(url.hostname)
}

export function validateSandboxFetchUrl(
  input: RequestInfo | URL,
  allowPrivateTargets = false,
): URL {
  const url = new URL(input instanceof Request ? input.url : input)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Sandbox fetch only permits HTTP and HTTPS URLs')
  }
  if (url.username || url.password) {
    throw new Error('Sandbox fetch does not permit credentials in URLs')
  }
  if (isBlockedHostname(url.hostname) && !allowPrivateTargets) {
    throw new Error(`Sandbox fetch blocks private or local target: ${url.hostname}`)
  }
  return url
}

export function createMediatedFetch(options: {
  authorize: FetchAuthorization
  fetch?: typeof fetch
  fetchWithPolicy?: FetchWithPolicy
  fetchPolicy?: SandboxFetchOptions
  maxResponseBytes?: number
  signal?: AbortSignal
  timeoutMs?: number
  allowPrivateTargets?: boolean
}) {
  const hostFetch = options.fetch ?? globalThis.fetch
  const maxResponseBytes = options.maxResponseBytes ?? 16 * 1024 * 1024
  const timeoutMs = options.timeoutMs ?? 30_000

  const mediatedFetch: FetchWithPolicy = async (input, init = {}, requestedOptions) => {
    const url = validateSandboxFetchUrl(input, options.allowPrivateTargets)
    const fetchOptions = mergeSandboxFetchOptions(options.fetchPolicy, requestedOptions)
    const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const access = method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? 'read' : 'write'
    const authorized = await options.authorize({
      action: 'fetch',
      origin: url.origin,
      access,
      ...(fetchOptions.preferProxy ? { preferProxy: true } : {}),
      ...(isPrivateSandboxFetchUrl(url) ? { privateTarget: true } : {}),
    })
    if (!authorized) {
      throw new Error(`Sandbox fetch was not authorized for ${url.origin}`)
    }

    const signals = [
      options.signal,
      input instanceof Request ? input.signal : undefined,
      init.signal,
      AbortSignal.timeout(timeoutMs),
    ].filter((signal): signal is AbortSignal => signal instanceof AbortSignal)
    const signal = AbortSignal.any(signals)
    const requestInit = {
      ...init,
      credentials: 'omit',
      redirect: 'manual',
      signal,
    } satisfies RequestInit
    const response = options.fetchWithPolicy
      ? await options.fetchWithPolicy(url, requestInit, fetchOptions)
      : await hostFetch(url, requestInit)
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
