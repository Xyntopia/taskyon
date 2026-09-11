import { buildHttpRequest, parseHttpResponseStream } from './http-client'
import { WsProxyCloseCode, WsProxyCloseError } from '@taskyon/common/modules/wsProxyClose'
import {
  openTlsConnection,
  openWebSocketConnection,
  type WebSocketConstructor,
  type TlsMetadata,
} from './tls-websocket'
import type { RustlsClientFactory } from '@taskyon/https-tunnel-wasm'

export type TunnelDestination = { host: string; port: 80 | 443 }
export type TunnelTokenProvider = (
  destination: TunnelDestination,
  refreshInstanceKey?: boolean,
) => Promise<string>

export interface SecureFetchOptions extends Omit<RequestInit, 'body' | 'headers'> {
  headers?: HeadersInit
  body?: string | Uint8Array
  tunnelUrl?: string
  tunnelToken?: string
  getTunnelToken?: TunnelTokenProvider
  webSocket?: WebSocketConstructor
  tlsClientFactory?: RustlsClientFactory
  onTlsHandshake?: (metadata: TlsMetadata) => void
}

export type SecureFetchResponse = Response

const FORBIDDEN_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'proxy-authorization',
  'sec-websocket-protocol',
  'transfer-encoding',
])

const requestHeaders = (headers: HeadersInit | undefined) => {
  const normalized: Record<string, string> = {}
  new Headers(headers).forEach((value, name) => {
    if (FORBIDDEN_HEADERS.has(name)) throw new Error(`secureFetch controls the ${name} header`)
    normalized[name] = value
  })
  return normalized
}

const destinationFrom = (url: URL): TunnelDestination => {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('secureFetch only supports http:// and https:// URLs')
  }
  if (url.username || url.password) throw new Error('secureFetch does not allow URL credentials')
  const port = Number(url.port || (url.protocol === 'http:' ? 80 : 443))
  if (port !== 80 && port !== 443) throw new Error('secureFetch only supports ports 80 and 443')
  return {
    host: url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, ''),
    port,
  }
}

const fetchOnce = async (url: URL, options: SecureFetchOptions, token: string) => {
  options.signal?.throwIfAborted()
  const tunnelUrl = options.tunnelUrl
  if (!tunnelUrl) throw new Error('tunnelUrl is required in SecureFetchOptions')
  const destination = destinationFrom(url)
  const connection =
    url.protocol === 'https:'
      ? await openTlsConnection(
          tunnelUrl,
          destination.host,
          destination.port,
          token,
          options.webSocket,
          options.onTlsHandshake,
          options.tlsClientFactory,
        )
      : await openWebSocketConnection(
          tunnelUrl,
          destination.host,
          destination.port,
          token,
          options.webSocket,
        )
  const close = () => connection.close()
  options.signal?.addEventListener('abort', close, { once: true })
  let handedOff = false
  const finish = () => {
    options.signal?.removeEventListener('abort', close)
    connection.close()
  }
  try {
    options.signal?.throwIfAborted()
    await connection.write(
      buildHttpRequest(
        options.method ?? 'GET',
        url.href,
        requestHeaders(options.headers),
        options.body,
      ),
    )
    const response = await parseHttpResponseStream(connection.read, finish)
    const hasBody =
      options.method?.toUpperCase() !== 'HEAD' && ![204, 205, 304].includes(response.status)
    if (!hasBody) await response.body.cancel()
    else handedOff = true
    return new Response(hasBody ? response.body : null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } finally {
    if (!handedOff) finish()
  }
}

export async function secureFetch(
  input: string | URL,
  options: SecureFetchOptions = {},
): Promise<SecureFetchResponse> {
  let url = new URL(input)
  const redirect = options.redirect ?? 'follow'
  let requestOptions = options
  for (let count = 0; count <= 10; count++) {
    options.signal?.throwIfAborted()
    const destination = destinationFrom(url)
    const token = options.getTunnelToken
      ? await options.getTunnelToken(destination)
      : options.tunnelToken
    if (!token) throw new Error('tunnelToken or getTunnelToken is required')
    const response = await fetchOnce(url, { ...requestOptions, redirect: 'manual' }, token).catch(
      async (error: unknown) => {
        // This rejection happens before the proxy opens any target socket.
        if (
          !(error instanceof WsProxyCloseError) ||
          error.code !== WsProxyCloseCode.AuthFailed ||
          error.reason !== 'instance_key_mismatch' ||
          !options.getTunnelToken
        )
          throw error
        const refreshed = await options.getTunnelToken(destination, true)
        return fetchOnce(url, { ...requestOptions, redirect: 'manual' }, refreshed)
      },
    )
    if (![301, 302, 303, 307, 308].includes(response.status)) return response
    if (redirect === 'manual') return response
    if (redirect === 'error') throw new Error(`Redirect received from ${url.href}`)
    const location = response.headers.get('location')
    if (!location) return response
    if (!options.getTunnelToken) {
      throw new Error('Following redirects requires getTunnelToken for a new one-time token')
    }
    await response.body?.cancel()
    const nextUrl = new URL(location, url)
    const method = (requestOptions.method ?? 'GET').toUpperCase()
    const becomesGet =
      (response.status === 303 && method !== 'HEAD') ||
      ((response.status === 301 || response.status === 302) && method === 'POST')
    const headers = new Headers(requestOptions.headers)
    if (nextUrl.origin !== url.origin) {
      headers.delete('authorization')
      headers.delete('cookie')
      headers.delete('proxy-authorization')
    }
    if (becomesGet) {
      headers.delete('content-length')
      headers.delete('content-type')
      const { body: _body, ...withoutBody } = requestOptions
      requestOptions = { ...withoutBody, method: 'GET', headers }
    } else requestOptions = { ...requestOptions, headers }
    url = nextUrl
  }
  throw new Error('secureFetch exceeded 10 redirects')
}

export const createSecureFetch =
  (defaults: {
    tunnelUrl: string
    getTunnelToken: TunnelTokenProvider
    webSocket?: WebSocketConstructor
    tlsClientFactory?: RustlsClientFactory
  }) =>
  async (
    input: string | URL,
    options: Omit<
      SecureFetchOptions,
      'tunnelUrl' | 'getTunnelToken' | 'webSocket' | 'tlsClientFactory'
    > = {},
  ) =>
    await secureFetch(input, { ...options, ...defaults })
