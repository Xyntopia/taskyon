// tokenservice.types.ts

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
export interface ServiceTokenPayload {
  max_costs: number // Maximum allowed total cost (e.g., credits or $)
  services: string[] // Allowed service identifiers, e.g. ["proxy", "chat_completion"]
  oms: number // Operation max duration in seconds
  jti: string // Unique token ID == api_usage_log.id (for take_out)
  uid: string // User ID encoded by createJWT/verifyJWT helpers

  // Standard-ish JWT fields (if your createJWT/verifyJWT expose them in payload)
  exp?: number // Expiration time (seconds since epoch)
  iat?: number // Issued-at time  (seconds since epoch)
  nbf?: number // Not-before time (seconds since epoch)

  // Allow future extension without breaking clients:
  [key: string]: unknown
}

// ==============================
// 2. /tokenservice/mint
// ==============================

// Request body for POST /tokenservice/mint
// Currently you don't send any body, it's fully derived
// from the authenticated user and server-side config.
// But we define it anyway for forward-compatibility.
// deno-lint-ignore no-empty-interface
export type MintTokenRequest = unknown
// If in future you want to pass things like custom max_costs, services, etc.,
// you can add optional fields here.
// For now it can be empty or omitted.

// Response body for POST /tokenservice/mint
export interface MintTokenResponse {
  token: string // The minted JWT
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
export const TOKEN_SERVICE_PREFIX = '/tokenservice' as const

export const TOKEN_SERVICE_ROUTES = {
  root: `${TOKEN_SERVICE_PREFIX}/`,
  echo: `${TOKEN_SERVICE_PREFIX}/echo`,
  mint: `${TOKEN_SERVICE_PREFIX}/mint`,
  return: `${TOKEN_SERVICE_PREFIX}/return`,
} as const
