// Make sure axios is available (via <script> or bundler import)
// <script src="https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js"></script>
// or: import axios from "axios";

import axios from 'axios'

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
export async function mintTestToken(baseUrl: string, authToken: string) {
  const url = `${baseUrl}/mint`

  const response = await axios.post(
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

export const testTokenMinting = async (ctx: { tyauth: string }) => {
  const token = await mintTestToken(
    'https://sicynrpldixtrddgqnpm.supabase.co/functions/v1/tokenservice',
    ctx.tyauth,
  )
  console.log('Minted token:', token)

  // Optional: inspect payload in the browser (to see user_id, expiration, max_costs, services)
  const [headerB64, payloadB64] = token.split('.').slice(0, 2)
  const payloadJson = JSON.parse(atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/')))
  console.log('Token payload:')
  // should contain:
  // - user_id
  // - expiration
  // - max_costs (0.20)
  // - services: ['proxy', 'chat_completion']

  return { payloadJson, headerB64 }
}
