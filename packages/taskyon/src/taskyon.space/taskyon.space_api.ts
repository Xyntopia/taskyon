// Make sure axios is available (via <script> or bundler import)
// <script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
// or: import axios from "axios";

import axios from 'axios'
import { importSPKI, jwtVerify } from 'jose'
import type { JsonObject } from 'type-fest'
import { sleep } from '../utils/asyncUtils'
export { WsProxyCloseCode, WsProxyCloseError } from '@taskyon/common/modules/wsProxyClose'
import {
  ServiceTokenPayloadSchema,
  TOKEN_SERVICE_BASE_URL,
  TOKEN_SERVICE_ROUTES,
  type MintTokenRequest,
  type MintTokenResponse,
  type ReturnTokenRequest,
  type ReturnTokenResponse,
  type ServiceTokenPayload,
} from './tokenservice.types'

/**
 * Very simple client-side helper to call the minting service using axios.
 *
 * - POST /svc-jwt/mint
 * - No request body
 * - Returns the minted token string
 *
 * @param {string} baseUrl   Base URL of your Edge function/API
 *                           e.g. "https://YOUR_PROJECT.supabase.co/functions/v1"
 * @param {string} authToken A JWT or API key used as Bearer auth
 * @returns {Promise<string>} The minted token
 */
export async function mintToken(baseUrl: string, authToken: string) {
  const url = `${baseUrl}/mint`

  const response = await axios.post<MintTokenResponse>(url, null as MintTokenRequest, {
    headers: {
      Authorization: `Bearer ${authToken}`,
    },
  })

  // Expecting response.data like:
  // { token, user_id, expiration, max_costs, services }
  return response.data.token
}

export async function returnToken(
  baseUrl: string,
  token: string,
  credits_spent_increase: number,
  reference_data: JsonObject,
) {
  const url = `${baseUrl}/return`

  console.log('[returnToken] Returning token with data:', {
    token,
    credits_spent_increase,
    reference_data,
  })

  const response = await axios.post<ReturnTokenResponse>(url, {
    token,
    credits_spent_increase,
    reference_data: reference_data,
  } as ReturnTokenRequest)

  return response.data
}

export async function getTaskyonCosts(
  providerHeaders: Readonly<Record<string, string>> | undefined,
  anonymousTaskyonKey: string,
  apiKey: string,
  completionId: string | undefined,
  tokenJti: string,
  taskid: string,
) {
  const baseUrl = new URL(TOKEN_SERVICE_BASE_URL).origin
  console.log('get generation info from ', baseUrl)

  const url = new URL(`${baseUrl}/rest/v1/api_usage_log`)
  const search = url.searchParams
  search.set('select', 'used_credits,call_time,info')
  search.set('order', 'call_time.desc')
  search.set('limit', '1')

  const tenMinutesAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  search.set('reference_data->>jti', `eq.${tokenJti}`)
  search.set('info', 'eq.return security deposit and api call')
  search.set('call_time', `gte.${tenMinutesAgoIso}`)

  const maxAttempts = tokenJti ? 20 : 1
  const initialDelayMs = tokenJti ? 6000 : 0
  const maxDelayMs = 30000
  const backoffMultiplier = 1.5
  let delayMs = initialDelayMs
  const attributionHeaders = {
    ...(providerHeaders?.['HTTP-Referer']
      ? { 'HTTP-Referer': providerHeaders['HTTP-Referer'] }
      : {}),
    ...(providerHeaders?.['X-Title'] ? { 'X-Title': providerHeaders['X-Title'] } : {}),
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (delayMs > 0) {
      await sleep(delayMs)
    }

    const response = await fetch(url.toString(), {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        apiKey: anonymousTaskyonKey,
        ...attributionHeaders,
      },
    })
    if (!response.ok) {
      console.warn(`Could not find generation information for task ${taskid}`, {
        attempt,
        maxAttempts,
        status: response.status,
        statusText: response.statusText,
        url: url.toString(),
      })
      return undefined
    }
    const data = await (response.json() as Promise<{ used_credits: number }[]>)
    const cost = data[0]?.used_credits
    if (typeof cost === 'number') return cost

    delayMs = Math.min(Math.round(delayMs * backoffMultiplier), maxDelayMs)
  }
  console.warn(`No taskyon cost row found within retry window for task ${taskid}`, {
    tokenJti,
    completionId,
    url: url.toString(),
  })
  return undefined
}

/* ============================================================
 *  JWT VERIFICATION
 * ============================================================ */

export async function verifyServiceToken(
  publicKeyPromise: CryptoKey,
  jwt: string,
): Promise<ServiceTokenPayload> {
  const publicKey = publicKeyPromise

  const { payload } = await jwtVerify(jwt, publicKey, {
    algorithms: ['EdDSA'],
  })

  const parsed = ServiceTokenPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Invalid service token payload')
  }

  return parsed.data
}

/**
 * Retrieve the public key for verifying Ty JWTs from env var. or the web
 */
export const getTyJwtPublicKey = async () => {
  console.log('[getTyJwtPublicKey] Fetching public key for JWT verification')

  const pkeyUrl = `${TOKEN_SERVICE_BASE_URL}${TOKEN_SERVICE_ROUTES.pkey}`
  const PROXY_JWT_PUBLIC_KEY = (await axios.get(pkeyUrl)).data ?? process.env

  console.log('[getTyJwtPublicKey] Retrieved public key:', PROXY_JWT_PUBLIC_KEY)

  if (!PROXY_JWT_PUBLIC_KEY) {
    console.error('[attachWsProxy] Missing PROXY_JWT_PUBLIC_KEY env var, WS proxy disabled')
    return
  }

  const publicKeyPromise = await importSPKI(PROXY_JWT_PUBLIC_KEY, 'EdDSA')

  return publicKeyPromise
}
