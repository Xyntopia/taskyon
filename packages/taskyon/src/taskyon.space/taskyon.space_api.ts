// Make sure axios is available (via <script> or bundler import)
// <script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
// or: import axios from "axios";

import axios from 'axios'
import type {
  MintTokenResponse,
  ReturnTokenRequest,
  ReturnTokenResponse,
} from './tokenservice.types'
import { sleep } from '../utils/asyncUtils'

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

  await sleep(10000)

  // TODO: check if credits are decreased by depost amount!

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

  return { payloadJson, headerB64, token, returnres }
}
