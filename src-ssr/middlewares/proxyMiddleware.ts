import { defineSsrMiddleware } from '#q-app/wrappers'
import type { Request, Response } from 'express'
import axios from 'axios'
import { z } from 'zod'
import { jwtVerify, importSPKI } from 'jose'

/* ============================================================
 *  ZOD: ServiceTokenPayload
 * ============================================================ */

const ServiceTokenPayloadSchema = z
  .object({
    max_costs: z.number().positive(),
    services: z.array(z.string()).min(1),
    oms: z.number().positive(), // seconds
    jti: z.string().min(1),
    uid: z.string().min(1),

    exp: z.number().optional(),
    iat: z.number().optional(),
    nbf: z.number().optional(),
  })
  .passthrough()

type ServiceTokenPayload = z.infer<typeof ServiceTokenPayloadSchema>

/* ============================================================
 *  JWT VERIFICATION
 * ============================================================ */

async function verifyServiceToken(
  publicKeyPromise: Promise<CryptoKey>,
  jwt: string,
): Promise<ServiceTokenPayload> {
  const publicKey = await publicKeyPromise

  const { payload } = await jwtVerify(jwt, publicKey, {
    algorithms: ['EdDSA'],
  })

  const parsed = ServiceTokenPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Invalid service token payload')
  }

  return parsed.data
}

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

const handleProxy =
  (publicKeyPromise: Promise<CryptoKey>) => async (req: Request, res: Response) => {
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

      const path = req.params[0] ?? ''
      const qs = req.url.includes('?') ? '?' + req.url.split('?')[1] : ''
      const targetUrl = service.baseUrl + '/' + path + qs

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

export default defineSsrMiddleware(({ app }) => {
  /* ============================================================
   *  ENV / KEYS
   * ============================================================ */

  const { PROXY_JWT_PUBLIC_KEY } = process.env

  if (!PROXY_JWT_PUBLIC_KEY) {
    console.error('Missing PROXY_JWT_PUBLIC_KEY env var, no proxy routes will be available')
    return
  }

  const publicKeyPromise = importSPKI(PROXY_JWT_PUBLIC_KEY, 'EdDSA')
  app.all('/proxy/:service/*', (req, res) => void handleProxy(publicKeyPromise)(req, res))
})
