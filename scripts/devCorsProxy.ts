import { randomBytes } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import {
  createServer,
  request as requestHttp,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { request as requestHttps } from 'node:https'
import {
  isBlockedSandboxFetchHostname,
  TASKYON_DEV_CORS_PROXY_PATH,
} from '../packages/common/modules/webFetching/index'

export { TASKYON_DEV_CORS_PROXY_PATH }
export const TASKYON_DEV_CORS_PROXY_SECRET_HEADER = 'x-taskyon-dev-proxy-secret'

type ResolvedAddress = { address: string; family: number }
type ResolveHost = (hostname: string) => Promise<ResolvedAddress[]>

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

export const isTaskyonDevCorsProxyRequestAllowed = (headers: IncomingHttpHeaders) =>
  headers['x-requested-with'] === 'Taskyon' && headers['sec-fetch-site'] !== 'cross-site'

export const withoutHttp2HopByHopHeaders = (headers: IncomingHttpHeaders) =>
  Object.fromEntries(
    Object.entries(headers).filter(([name]) => !HOP_BY_HOP_HEADERS.has(name.toLowerCase())),
  )

export const rewriteTaskyonDevCorsProxyLocation = (location: string) => {
  const redirect = new URL(location)
  if (!/^\/https?:\/\//.test(redirect.pathname)) return location
  const target = `${redirect.pathname.slice(1)}${redirect.search}${redirect.hash}`
  return new URL(`${TASKYON_DEV_CORS_PROXY_PATH}${target}`, redirect.origin).href
}

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': '*',
}

const reject = (response: ServerResponse, status: number, message: string) => {
  response.writeHead(status, { 'content-type': 'text/plain', ...corsHeaders })
  response.end(message)
}

const targetFrom = (request: IncomingMessage) => {
  try {
    const target = new URL((request.url ?? '/').slice(1))
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return
    if (target.username || target.password || isBlockedSandboxFetchHostname(target.hostname)) return
    return target
  } catch {
    return
  }
}

const resolvePublicAddress = async (target: URL, resolveHost: ResolveHost) => {
  const addresses = await resolveHost(target.hostname)
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedSandboxFetchHostname(address))
  ) {
    throw new Error('The development proxy blocks this private or local address.')
  }
  return addresses[0]!
}

const forwardedRequestHeaders = (request: IncomingMessage, target: URL) => {
  const headers = withoutHttp2HopByHopHeaders(request.headers)
  delete headers.cookie
  delete headers.cookie2
  delete headers['x-requested-with']
  delete headers[TASKYON_DEV_CORS_PROXY_SECRET_HEADER]
  delete headers['x-forwarded-proto']
  return { ...headers, host: target.host, connection: 'close' }
}

const proxyResponseHeaders = (
  headers: IncomingHttpHeaders,
  request: IncomingMessage,
  target: URL,
) => {
  const safeHeaders = withoutHttp2HopByHopHeaders(headers)
  delete safeHeaders['set-cookie']
  delete safeHeaders['set-cookie2']
  const locationHeader = safeHeaders.location
  const location = Array.isArray(locationHeader) ? locationHeader[0] : locationHeader
  if (location && request.headers.host) {
    const protocol = request.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
    const redirect = new URL(location, target).href
    safeHeaders.location = `${protocol}://${request.headers.host}/${redirect}`
  }
  return { ...safeHeaders, 'x-final-url': target.href, ...corsHeaders }
}

const forward = async (
  request: IncomingMessage,
  response: ServerResponse,
  target: URL,
  resolveHost: ResolveHost,
) => {
  const resolved = await resolvePublicAddress(target, resolveHost)
  const requestTarget = target.protocol === 'https:' ? requestHttps : requestHttp
  const upstream = requestTarget({
    hostname: resolved.address,
    family: resolved.family,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    method: request.method,
    headers: forwardedRequestHeaders(request, target),
    ...(target.protocol === 'https:' ? { servername: target.hostname } : {}),
  })
  upstream.once('response', (upstreamResponse) => {
    response.writeHead(
      upstreamResponse.statusCode ?? 502,
      upstreamResponse.statusMessage,
      proxyResponseHeaders(upstreamResponse.headers, request, target),
    )
    upstreamResponse.pipe(response)
  })
  upstream.once('error', () => {
    if (response.headersSent) response.destroy()
    else reject(response, 502, 'The development proxy request failed.')
  })
  request.once('aborted', () => upstream.destroy())
  request.pipe(upstream)
}

const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  secret: string,
  resolveHost: ResolveHost,
) => {
  if (request.headers[TASKYON_DEV_CORS_PROXY_SECRET_HEADER] !== secret) {
    reject(
      response,
      403,
      'This proxy only accepts requests from the authorized Taskyon development server.',
    )
    return
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(200, {
      ...corsHeaders,
      'access-control-allow-headers': request.headers['access-control-request-headers'] ?? '*',
      'access-control-allow-methods': request.headers['access-control-request-method'] ?? '*',
    })
    response.end()
    return
  }
  if (request.url === '/iscorsneeded') {
    response.writeHead(200, { 'content-type': 'text/plain', ...corsHeaders })
    response.end('no')
    return
  }
  const target = targetFrom(request)
  if (!target) {
    reject(response, 403, 'The development proxy blocks this private or local target.')
    return
  }
  await forward(request, response, target, resolveHost).catch((error: unknown) => {
    reject(response, 403, error instanceof Error ? error.message : 'The proxy request was blocked.')
  })
}

export function createTaskyonDevCorsProxy(options: {
  port: number
  secret?: string
  resolveHost?: ResolveHost
}) {
  const secret = options.secret ?? randomBytes(32).toString('base64url')
  const resolveHost = options.resolveHost ?? ((hostname) => lookup(hostname, { all: true }))
  const server = createServer((request, response) => {
    void handleRequest(request, response, secret, resolveHost)
  })

  return {
    secret,
    start: async () => {
      await new Promise<void>((resolve, rejectStart) => {
        server.once('error', rejectStart)
        server.listen(options.port, '127.0.0.1', () => {
          server.off('error', rejectStart)
          resolve()
        })
      })
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Taskyon development CORS proxy did not bind to a TCP port.')
      }
      return `http://127.0.0.1:${address.port}`
    },
    close: async () => {
      if (!server.listening) return
      await new Promise<void>((resolve, rejectClose) =>
        server.close((error) => (error ? rejectClose(error) : resolve())),
      )
    },
  }
}
