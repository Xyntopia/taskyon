import { defineSsrMiddleware } from '#q-app/wrappers'
import { getTyJwtPublicKey, verifyServiceToken, type ServiceTokenPayload } from '@taskyon/taskyon'
import axios from 'axios'
import type { Request, Response } from 'express'

function extractBearerToken(req: Request): string {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) {
    throw new Error('Missing Authorization header')
  }
  return h.slice(7)
}

/* ============================================================
 *  SERVICE REGISTRY
 * ============================================================ */

type ProxyService = {
  id: string
  baseUrl: string
  /**
   * Optional allow-list pattern for relative proxy paths.
   * Pattern is checked against the normalized path prefixed with "/".
   */
  pathAllowPattern?: RegExp
  reportCost?: (ctx: { req: Request; res: Response; token: ServiceTokenPayload }) => Promise<void>
}

const SERVICES: Record<string, ProxyService> = {
  gdrive: {
    id: 'gdrive',
    baseUrl: 'https://www.googleapis.com',
    reportCost: async () => {
      // TODO: billing / usage tracking
    },
  },
}

/* ============================================================
 *  PROXY HANDLER
 * ============================================================ */

const DEFAULT_PATH_ALLOW_PATTERN = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/

function sanitizeProxyPath(rawPath: string | undefined, service: ProxyService): string {
  const input = String(rawPath ?? '')
  const hasControlChars = Array.from(input).some((ch) => {
    const code = ch.charCodeAt(0)
    return code <= 31 || code === 127
  })

  // Reject control chars and backslashes to avoid parser and path confusion.
  if (hasControlChars || input.includes('\\')) {
    throw new Error('Invalid proxy path')
  }

  // Reject protocol-relative and absolute forms.
  if (input.startsWith('//') || /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(input)) {
    throw new Error('Invalid proxy path')
  }

  const normalized = new URL(input.startsWith('/') ? input : `/${input}`, 'http://proxy.invalid')
  const path = normalized.pathname

  // Prevent traversal attempts.
  if (path.includes('..')) {
    throw new Error('Invalid proxy path')
  }

  const allowPattern = service.pathAllowPattern ?? DEFAULT_PATH_ALLOW_PATTERN
  if (!allowPattern.test(path)) {
    throw new Error('Proxy path not allowed')
  }

  // Force relative path for string concatenation below.
  return path.replace(/^\/+/, '')
}

const handleProxy = (publicKeyPromise: CryptoKey) => async (req: Request, res: Response) => {
  try {
    const jwt = extractBearerToken(req)
    const token = await verifyServiceToken(publicKeyPromise, jwt)

    const serviceId = req.params.service
    if (!serviceId)
      return res
        .status(403)
        .json({ error: 'no service url spcified (require "/proxy/:service/*")' })

    const service = SERVICES[serviceId]

    if (!service || !token.services.includes(serviceId)) {
      return res.status(403).json({ error: 'service not allowed' })
    }

    let path: string
    try {
      path = sanitizeProxyPath(req.params[0], service)
    } catch (err) {
      console.warn('proxy path rejected:', err)
      return res.status(400).json({ error: 'invalid proxy path' })
    }

    const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : ''
    const targetUrl = service.baseUrl.replace(/\/+$/, '') + '/' + path + qs

    const upstream = await axios.request({
      url: targetUrl,
      method: req.method,
      headers: {
        ...req.headers,
        host: undefined, // VERY IMPORTANT
        authorization: undefined, // never forward JWT
      },
      data: req,
      responseType: 'stream',
      timeout: token.oms * 1000,
      validateStatus: () => true,
    })

    res.status(upstream.status)

    for (const [k, v] of Object.entries(upstream.headers)) {
      if (v !== undefined) {
        res.setHeader(k, v)
      }
    }

    upstream.data.pipe(res)

    // fire & forget (billing, usage, one-time token invalidation later)
    void service.reportCost?.({ req, res, token })
  } catch (err) {
    console.error('proxy error:', err)
    res.status(401).json({ error: 'unauthorized' })
  }
}

/* ============================================================
 *  SSR MIDDLEWARE EXPORT
 * ============================================================ */

export default defineSsrMiddleware(async ({ app }) => {
  /* ============================================================
   *  ENV / KEYS
   * ============================================================ */

  const publicKeyPromise = await getTyJwtPublicKey()

  if (!publicKeyPromise) {
    console.error('[proxyMiddleware] Missing public key, proxy middleware disabled')
    return
  }

  app.all('/proxy/:service/*', (req, res) => void handleProxy(publicKeyPromise)(req, res))
})
