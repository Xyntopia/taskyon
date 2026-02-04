import { buildHttpRequest, parseHttpResponse } from './http-client'
import { openTlsConnection } from './tls-websocket'

export interface SecureFetchOptions {
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
  tunnelUrl?: string
  tunnelToken?: string
}

export interface SecureFetchResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  arrayBuffer(): ArrayBufferLike
  text(): string
  json<T = unknown>(): T
}

export async function secureFetch(
  urlStr: string,
  options: SecureFetchOptions = {},
): Promise<SecureFetchResponse> {
  const method = options.method || 'GET'
  const headers = options.headers || {}
  // Default tunnel URL - uses wsproxy protocol with query params for host/port
  const tunnelUrl = options.tunnelUrl
  if (!tunnelUrl) throw new Error('tunnelUrl is required in SecureFetchOptions')

  const url = new URL(urlStr)
  const host = url.hostname
  const port = parseInt(url.port || '443', 10)

  if (url.protocol !== 'https:') {
    throw new Error('secureFetch only supports https:// URLs')
  }

  let tls
  try {
    tls = await openTlsConnection(tunnelUrl, host, port, options.tunnelToken || '')
  } catch (err: unknown) {
    // Improve diagnostics around common dev scenarios, especially wss + self-signed certs
    const isBrowser = typeof window !== 'undefined'
    const usingWss = typeof tunnelUrl === 'string' && tunnelUrl.startsWith('wss:')

    let hint = ''

    if (isBrowser && usingWss) {
      hint =
        ' This often happens on dev servers using self-signed TLS certificates. ' +
        'Open the dev server URL in your browser first and accept the certificate, ' +
        'then retry the operation.'
    }

    const originalMessage =
      err && (err as Error).message ? String((err as Error).message) : String(err)

    throw new Error(
      `Failed to establish secure tunnel via WebSocket (${tunnelUrl}) to ${host}:${port}. ` +
        `Underlying error: ${originalMessage}.` +
        (hint ? ` ${hint}` : ''),
    )
  }

  try {
    const reqBytes = buildHttpRequest(method, urlStr, headers, options.body)
    await tls.write(reqBytes)
    const res = await parseHttpResponse(() => tls.read())
    tls.close()

    const textBody = new TextDecoder().decode(res.body)

    return {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
      body: textBody,
      arrayBuffer: () => res.body.buffer,
      text: () => textBody,
      json: <T>() => JSON.parse(textBody) as T,
    }
  } catch (err) {
    tls.close()
    throw err
  }
}
