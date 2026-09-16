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

export type SecureFetchFailurePhase = 'token' | 'connect' | 'send' | 'response'

export class SecureFetchError extends Error {
  readonly phase: SecureFetchFailurePhase
  readonly requestSent: boolean

  constructor(
    phase: SecureFetchFailurePhase,
    requestSent: boolean,
    message: string,
    cause: unknown,
  ) {
    super(message, { cause })
    this.name = 'SecureFetchError'
    this.phase = phase
    this.requestSent = requestSent
  }
}

const secureFetchError = (phase: SecureFetchFailurePhase, requestSent: boolean, error: unknown) =>
  error instanceof SecureFetchError
    ? error
    : new SecureFetchError(
        phase,
        requestSent,
        error instanceof Error ? error.message : String(error),
        error,
      )

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
  const connection = await (
    url.protocol === 'https:'
      ? openTlsConnection(
          tunnelUrl,
          destination.host,
          destination.port,
          token,
          options.webSocket,
          options.onTlsHandshake,
          options.tlsClientFactory,
        )
      : openWebSocketConnection(
          tunnelUrl,
          destination.host,
          destination.port,
          token,
          options.webSocket,
        )
  ).catch((error: unknown) => {
    throw secureFetchError('connect', false, error)
  })
  const close = () => connection.close()
  options.signal?.addEventListener('abort', close, { once: true })
  let handedOff = false
  let requestSent = false
  let requestWriteCompleted = false
  const finish = () => {
    options.signal?.removeEventListener('abort', close)
    connection.close()
  }
  try {
    options.signal?.throwIfAborted()
    requestSent = true
    await connection.write(
      buildHttpRequest(
        options.method ?? 'GET',
        url.href,
        requestHeaders(options.headers),
        options.body,
      ),
    )
    requestWriteCompleted = true
    const response = await parseHttpResponseStream(() => connection.read(), finish)
    const hasBody =
      options.method?.toUpperCase() !== 'HEAD' && ![204, 205, 304].includes(response.status)
    if (!hasBody) await response.body.cancel()
    else handedOff = true
    return new Response(hasBody ? response.body : null, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } catch (error) {
    throw secureFetchError(requestWriteCompleted ? 'response' : 'send', requestSent, error)
  } finally {
    if (!handedOff) finish()
  }
}

export async function secureFetch(
  input: string | URL,
  options: SecureFetchOptions = {},
): Promise<SecureFetchResponse> {
  let url = new URL(input)
  let sentAnyRequest = false
  const redirect = options.redirect ?? 'follow'
  let requestOptions = options
  for (let count = 0; count <= 10; count++) {
    options.signal?.throwIfAborted()
    const destination = destinationFrom(url)
    const token = await (
      options.getTunnelToken
        ? options.getTunnelToken(destination)
        : Promise.resolve(options.tunnelToken)
    ).catch((error: unknown) => {
      throw secureFetchError('token', sentAnyRequest, error)
    })
    if (!token) {
      throw new SecureFetchError(
        'token',
        sentAnyRequest,
        'tunnelToken or getTunnelToken is required',
        undefined,
      )
    }
    const response = await fetchOnce(url, { ...requestOptions, redirect: 'manual' }, token).catch(
      async (error: unknown) => {
        // This rejection happens before the proxy opens any target socket.
        const cause = error instanceof SecureFetchError ? error.cause : error
        if (
          !(cause instanceof WsProxyCloseError) ||
          cause.code !== WsProxyCloseCode.AuthFailed ||
          cause.reason !== 'instance_key_mismatch' ||
          !options.getTunnelToken
        ) {
          if (sentAnyRequest && error instanceof SecureFetchError && !error.requestSent) {
            throw new SecureFetchError(error.phase, true, error.message, error)
          }
          throw error
        }
        const refreshed = await options
          .getTunnelToken(destination, true)
          .catch((refreshError: unknown) => {
            throw secureFetchError('token', sentAnyRequest, refreshError)
          })
        return await fetchOnce(url, { ...requestOptions, redirect: 'manual' }, refreshed)
      },
    )
    sentAnyRequest = true
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
      const withoutBody = { ...requestOptions }
      delete withoutBody.body
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
