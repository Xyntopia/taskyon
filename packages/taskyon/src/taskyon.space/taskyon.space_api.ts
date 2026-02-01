// Make sure axios is available (via <script> or bundler import)
// <script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
// or: import axios from "axios";

import axios from 'axios'
import { importSPKI, jwtVerify } from 'jose'
import { sleep } from '../utils/asyncUtils'
import {
  ServiceTokenPayloadSchema,
  TOKEN_SERVICE_BASE_URL,
  TOKEN_SERVICE_PREFIX,
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

  const response = await axios.post<MintTokenResponse>(
    url,
    // no body
    null,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    },
  )

  // Expecting response.data like:
  // { token, user_id, expiration, max_costs, services }
  return response.data.token
}

export async function returnToken(
  baseUrl: string,
  token: string,
  authToken: string,
  credits_spent_increase: number,
) {
  const url = `${baseUrl}/return`

  const response = await axios.post<ReturnTokenResponse>(
    url,
    {
      token,
      credits_spent_increase,
      reference_data: {
        'spending reason':
          'the token was returned with costs of 0.0111 during testing of the tokenservice api.',
      },
    } as ReturnTokenRequest,
    {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    },
  )

  return response.data
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

  const PROXY_JWT_PUBLIC_KEY =
    (
      await axios.get(
        'https://sicynrpldixtrddgqnpm.supabase.co/functions/v1/tokenservice/public-key',
      )
    ).data ?? process.env

  console.log('[getTyJwtPublicKey] Retrieved public key:', PROXY_JWT_PUBLIC_KEY)

  if (!PROXY_JWT_PUBLIC_KEY) {
    console.error('[attachWsProxy] Missing PROXY_JWT_PUBLIC_KEY env var, WS proxy disabled')
    return
  }

  const publicKeyPromise = await importSPKI(PROXY_JWT_PUBLIC_KEY, 'EdDSA')

  return publicKeyPromise
}

export const testTokenMinting = async (ctx: { tyauth: string }) => {
  const baseUrl = TOKEN_SERVICE_BASE_URL + TOKEN_SERVICE_PREFIX
  //const { data, error } = await supabase.rpc('get_available_credits')

  const token = await mintToken(baseUrl, ctx.tyauth)
  console.log('Minted token:', token)

  const publicKeyPromise = await getTyJwtPublicKey()

  const svcTokenData = await verifyServiceToken(publicKeyPromise!, token)

  // Optional: inspect payload in the browser (to see user_id, expiration, max_costs, services)
  const [headerB64, payloadB64] = token.split('.').slice(0, 2)
  const payloadJson = JSON.parse(atob(payloadB64!.replace(/-/g, '+').replace(/_/g, '/')))
  // should contain:
  // - user_id
  // - expiration
  // - max_costs (0.20)
  // - services: ['proxy', 'chat_completion']

  await sleep(10000)

  //const { data, error } = await supabase.rpc('get_available_credits')

  const credits_spent_increase = 0.0111
  const returnres = await returnToken(baseUrl, token, ctx.tyauth, credits_spent_increase)

  // TODO: check here if credits are increased by deposit amount - spent amount

  /*
   TODO:

   - check for double spending
   - check for wrong jwt tokens
   - check for unverifiable jwt tokens
  - check for tokens with missing claims
    - check for unauthorized users trying to return tokens
    - check for free taskyon key users trying to return tokens
    - check for negative credits_spent_increase
    - check for negative depositos
    - check for late deposits (after token expiration)
  */

  return { payloadJson, svcTokenData, headerB64, token, returnres }
}

/**
 * Close codes shared between server and client.
 *
 * NOTE: Keep this enum in sync with the client-side version.
 */
export enum WsProxyCloseCode {
  // 40xx – protocol / auth / validation issues
  MissingSecWebSocketProtocol = 4000,
  MissingBearerToken = 4001,
  InvalidSubprotocol = 4002,
  AuthFailed = 4003,

  MissingHost = 4100,
  InvalidPort = 4101,

  ServiceNotAllowed = 4200,
  PortNotAllowed = 4201,

  InvalidHostFormat = 4300,
  PrivateIpForbidden = 4301,
  DnsResolutionFailed = 4302,

  // 45xx – runtime / network issues after connection
  TcpConnectionFailed = 4500,

  // 48xx – generic server-side issues
  InternalError = 4800,
}

export class WsProxyCloseError extends Error {
  readonly code: number
  readonly reason: string

  constructor(code: number, reason: string) {
    super(`WebSocket tunnel closed: code=${code} reason=${reason || 'no reason provided'}`)
    this.name = 'WsProxyCloseError'
    this.code = code
    this.reason = reason
  }

  isKnownProxyCode(): this is { code: WsProxyCloseCode } {
    return this.code in WsProxyCloseCode
  }
}
