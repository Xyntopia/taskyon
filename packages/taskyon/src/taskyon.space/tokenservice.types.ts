// tokenservice.types.ts
import z from 'zod'
import type { JsonObject } from 'type-fest'

export const ConfirmationSchema = z
  .object({
    jwk: z
      .object({
        kty: z.literal('OKP'),
        crv: z.literal('Ed25519'),
        x: z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/),
      })
      .strict(),
  })
  .strict()
export type TokenConfirmation = z.infer<typeof ConfirmationSchema>

export const SETTLEMENT_JWT_TYPE = 'taskyon-settlement+jwt'
export const SettlementBodySchema = z
  .object({
    token: z.string().min(1).max(32768),
    credits_spent_increase: z.number().finite().nonnegative(),
    reference_data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
export const SignedSettlementSchema = z
  .object({ settlementJwt: z.string().min(1).max(65536) })
  .strict()

export const MAX_TOKEN_MINT_BATCH_SIZE = 10

export type ServiceRequestDefinition = {
  service: string
  claims: JsonObject
}
export type TokenRequestDefinition = ServiceRequestDefinition & {
  cnf?: TokenConfirmation
}

// ==============================
// 1. JWT payload
// ==============================

/**
 * Payload of the short-lived service JWT used for delegated operations.
 *
 * NOTE:
 * - `oms` is the "operation max duration in seconds".
 * - `jti` is bound to the api_usage_log.id of the "take_out_security_deposit" call.
 * - `uid` should be the user id this token belongs to (your createJWT implementation does this).
 */

export const ServiceTokenPayloadSchema = z
  .object({
    cnf: ConfirmationSchema.optional(),
    iss: z.literal('taskyon.space'),
    principal_type: z.enum(['user', 'api_key']),
    allowed_models: z.array(z.string()).min(1),
    max_costs: z.number().positive(),
    services: z.array(z.string()).min(1),
    oms: z.number().positive(), // seconds
    jti: z.string().min(1).describe('JWT ID bound to api_usage_log.id'),
    auid: z.string().min(1).describe('The anonymous user id that owns this token'),
    aud: z.union([z.string(), z.array(z.string())]).optional(),
    request: z
      .object({
        service: z.string().min(1),
        claims: z.record(z.string(), z.unknown()),
      })
      .optional(),

    exp: z.number().optional().describe('Expiration time (epoch seconds)'),
    iat: z.number().optional().describe('Issued at (epoch seconds)'),
  })
  .passthrough()

export type ServiceTokenPayload = z.infer<typeof ServiceTokenPayloadSchema>

// ==============================
// 2. /tokenservice/mint
// ==============================

// Request body for POST /tokenservice/mint
export type MintTokenRequest =
  | null
  | { cnf: TokenConfirmation }
  | { requests: TokenRequestDefinition[] }

// Response body for POST /tokenservice/mint
export interface MintTokenResponse {
  token: string // The minted JWT
}

export interface MintTokensResponse {
  tokens: string[]
}

// ==============================
// 3. /tokenservice/return
// ==============================

/**
 * Request body for POST /tokenservice/return
 *
 * This is what your edge function currently expects:
 *
 *  {
 *    token: string;
 *    return_amount: number;
 *    credits_spent_increase: number;
 *    reference_data?: Json;
 *  }
 */
export interface ReturnTokenRequest {
  token: string // The JWT previously minted by /mint
  credits_spent_increase: number // How much to increase credits_spent by
  // Arbitrary structured context to store in logs (Postgres JSONB)
  // Match this to your Database["public"]["Tables"]["api_usage_log"]["Row"]["reference_data"] type if you like.
  reference_data?: unknown
}

/**
 * Response body for POST /tokenservice/return
 *
 * On success, your edge function returns:
 *  {
 *    success: true,
 *    data: <rpc-return from return_security_deposit>
 *  }
 *
 * On error, it returns:
 *  {
 *    error: string;
 *  }
 *
 * To keep the contract precise yet flexible, we type it as a union.
 */
export type ReturnTokenSuccessResponse = {
  success: true
  // 'data' is whatever Supabase RPC returns; in your case it's UUID of the api_usage_log row.
  data: string | null
}

export type ReturnTokenErrorResponse = {
  success?: false
  error: string
}

export type ReturnTokenResponse = ReturnTokenSuccessResponse | ReturnTokenErrorResponse

// ==============================
// 4. Helper: Endpoint paths
// ==============================

/**
 * Base prefix used by the Edge Function router.
 * Use this when constructing client URLs to avoid diverging paths.
 */
export {
  TASKYON_MODEL_CATALOG_URL,
  TASKYON_WSS_PROXY_URL,
  TOKEN_SERVICE_BASE_URL,
} from './endpoints'
export const TOKEN_SERVICE_PREFIX = '/tokenservice' as const

export const TOKEN_SERVICE_ROUTES = {
  root: `${TOKEN_SERVICE_PREFIX}/`,
  echo: `${TOKEN_SERVICE_PREFIX}/echo`,
  mint: `${TOKEN_SERVICE_PREFIX}/mint`,
  pkey: `${TOKEN_SERVICE_PREFIX}/public-key`,
  return: `${TOKEN_SERVICE_PREFIX}/return`,
} as const
