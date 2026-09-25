import {
  createSecureFetch,
  SecureFetchError,
  type SecureFetchFailurePhase,
  type TunnelTokenProvider,
} from '@taskyon/secure-tunnel'
import {
  createBoundServiceTokenProvider,
  createTunnelTokenProvider,
} from '@taskyon/taskyon/taskyon-space-api'

export type TaskyonBrowserProviderTransport = {
  kind: 'secure-wss'
  tunnelUrl: string
  tokenServiceBaseUrl: string
  authToken: string
}

type TaskyonProviderTransportTarget = Omit<TaskyonBrowserProviderTransport, 'authToken'>
type TaskyonProviderAuthTokenGetter = () => string | Promise<string>

export type TaskyonDirectFallbackRequest = {
  origin: string
  requestKind: 'chat-completion' | 'model-discovery' | 'oauth' | 'sandbox-fetch'
  failurePhase: SecureFetchFailurePhase
}

export type TaskyonProviderFetchOptions = {
  requestKind?: TaskyonDirectFallbackRequest['requestKind']
  approveDirectFallback?: (request: TaskyonDirectFallbackRequest) => Promise<boolean>
  directFetch?: typeof fetch
}

const BROWSER_CONTEXT_HEADERS = [
  'origin',
  'referer',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'sec-fetch-user',
] as const

export const sanitizeProviderRequestHeaders = (headers: HeadersInit): Headers => {
  const sanitized = new Headers(headers)
  BROWSER_CONTEXT_HEADERS.forEach((name) => sanitized.delete(name))
  return sanitized
}

export const isHostedBrowserProviderRuntime = (input: {
  hostname: string
  isTauri: boolean
}): boolean => {
  const hostname = input.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return (
    !input.isTauri &&
    hostname !== 'localhost' &&
    hostname !== '127.0.0.1' &&
    hostname !== '::1' &&
    !hostname.endsWith('.localhost')
  )
}

const createProviderFetch = (
  transport: TaskyonProviderTransportTarget,
  getTunnelToken: TunnelTokenProvider,
  options: TaskyonProviderFetchOptions = {},
): typeof fetch => {
  const secureProviderFetch = createSecureFetch({
    tunnelUrl: transport.tunnelUrl,
    getTunnelToken,
  })

  return async (input, init) => {
    const request =
      input instanceof Request && init === undefined ? input : new Request(input, init)
    const directRequest = request.clone()
    const method = request.method.toUpperCase()
    const body =
      method === 'GET' || method === 'HEAD'
        ? undefined
        : new Uint8Array(await request.arrayBuffer())

    try {
      return await secureProviderFetch(request.url, {
        method,
        headers: sanitizeProviderRequestHeaders(request.headers),
        redirect: request.redirect,
        signal: request.signal,
        ...(body ? { body } : {}),
      })
    } catch (error) {
      if (
        !(error instanceof SecureFetchError) ||
        error.requestSent ||
        !options.approveDirectFallback
      ) {
        throw error
      }
      const approved = await options.approveDirectFallback({
        origin: new URL(request.url).origin,
        requestKind: options.requestKind ?? 'chat-completion',
        failurePhase: error.phase,
      })
      if (!approved) throw error
      return await (options.directFetch ?? globalThis.fetch)(directRequest)
    }
  }
}

export const createTaskyonProviderFetch = (
  transport: TaskyonBrowserProviderTransport,
  options?: TaskyonProviderFetchOptions,
): typeof fetch =>
  createProviderFetch(
    transport,
    createTunnelTokenProvider(
      transport.tunnelUrl,
      transport.tokenServiceBaseUrl,
      transport.authToken,
    ),
    options,
  )

export const createTaskyonProviderFetchWithTokenGetter = (
  transport: TaskyonProviderTransportTarget,
  getAuthToken: TaskyonProviderAuthTokenGetter,
  options?: TaskyonProviderFetchOptions,
): typeof fetch =>
  createProviderFetch(
    transport,
    createBoundServiceTokenProvider(
      transport.tunnelUrl,
      transport.tokenServiceBaseUrl,
      'web_tunnel',
      getAuthToken,
      'proxy',
    ),
    options,
  )
