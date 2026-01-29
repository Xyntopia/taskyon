// Make sure axios is available (via <script> or bundler import)
// <script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
// or: import axios from "axios";

import axios from 'axios'
import type {
  MintTokenResponse,
  ReturnTokenRequest,
  ReturnTokenResponse,
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

export const testTokenMinting = async (ctx: { tyauth: string }) => {
  const baseUrl = 'https://sicynrpldixtrddgqnpm.supabase.co/functions/v1/tokenservice'
  const token = await mintToken(baseUrl, ctx.tyauth)
  console.log('Minted token:', token)

  // Optional: inspect payload in the browser (to see user_id, expiration, max_costs, services)
  const [headerB64, payloadB64] = token.split('.').slice(0, 2)
  const payloadJson = JSON.parse(atob(payloadB64!.replace(/-/g, '+').replace(/_/g, '/')))
  // should contain:
  // - user_id
  // - expiration
  // - max_costs (0.20)
  // - services: ['proxy', 'chat_completion']

  const credits_spent_increase = 0.0111
  const returnres = returnToken(baseUrl, token, ctx.tyauth, credits_spent_increase)

  return { payloadJson, headerB64, token, returnres }
}
