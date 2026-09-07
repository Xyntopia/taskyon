import z from 'zod'

export const createOauthAuthorizationUrl = (params: {
  oauthURL: string
  clientId: string
  scope: string
  redirectUri: string
  state: string
  challenge?: string
  authorizeQuery?: Record<string, string>
}) => {
  const url = new URL(params.oauthURL)
  if (url.protocol !== 'https:')
    throw new OAuthError('OAuth authorization requires HTTPS', 'INVALID_RESPONSE')
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    scope: params.scope,
    state: params.state,
    ...(params.challenge
      ? { response_type: 'code', code_challenge: params.challenge, code_challenge_method: 'S256' }
      : { response_type: 'token' }),
  })
  for (const [key, value] of Object.entries(params.authorizeQuery ?? {})) {
    if (
      [
        'client_id',
        'redirect_uri',
        'scope',
        'state',
        'response_type',
        'code_challenge',
        'code_challenge_method',
      ].includes(key)
    )
      throw new OAuthError(`Provider options cannot override OAuth ${key}`, 'INVALID_RESPONSE')
    query.set(key, value)
  }
  url.search = query.toString()
  return url.href
}

export const exchangeOauthCode = async (params: {
  tokenUrl: string
  clientId: string
  code: string
  verifier: string
  redirectUri: string
  fetch?: typeof fetch
}): Promise<OAuthCredentials> => {
  if (new URL(params.tokenUrl).protocol !== 'https:')
    throw new OAuthError('OAuth token exchange requires HTTPS', 'INVALID_RESPONSE')
  const body = new URLSearchParams({
    client_id: params.clientId,
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.verifier,
  })
  let response: Response
  try {
    response = await (params.fetch ?? fetch)(params.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch {
    throw new OAuthError('OAuth token exchange could not reach the provider', 'NETWORK_ERROR')
  }
  // Provider error bodies can contain credentials or authorization codes. Never log or forward them.
  if (!response.ok)
    throw new OAuthError(`OAuth token exchange failed (HTTP ${response.status})`, 'NETWORK_ERROR')
  const responseSchema = OAuthCredentials.omit({
    type: true,
    service: true,
    created_at: true,
  }).extend({ access_token: z.string().min(1) })
  const data = responseSchema.safeParse(await response.json().catch(() => null))
  if (!data.success)
    throw new OAuthError('OAuth token exchange returned invalid credentials', 'INVALID_RESPONSE')
  return {
    ...data.data,
    type: 'oauth-credentials',
    service: params.tokenUrl,
    created_at: Date.now(),
  }
}

//oauth.ts
export const OAuthCredentials = z.object({
  type: z.enum(['oauth-credentials']),
  access_token: z.string(),
  refresh_token: z.string().optional(),
  id_token: z.string().optional(),
  service: z.string(), // or z.string().url() if you want URL validation
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
  created_at: z.number(), // or z.date().transform(d => d.getTime()) if you parse a Date
})

export type OAuthCredentials = z.infer<typeof OAuthCredentials> /**
 * Attempts to refresh the token if expired, otherwise returns the cached credentials.
 * Returns null if refresh fails or no refresh token is available.
 */

export async function useRefreshTokenIfExpired(
  cached: OAuthCredentials,
  params: { tokenUrl: string; clientId: string; fetch?: typeof fetch },
): Promise<OAuthCredentials | null> {
  if (isTokenExpired(cached)) {
    if (cached.refresh_token) {
      try {
        console.log('Token expired, attempting refresh...')
        const refreshed = await refreshAccessToken(
          cached,
          params.tokenUrl,
          params.clientId,
          params.fetch,
        )
        return refreshed
      } catch (error) {
        console.warn('Token refresh failed, will re-authenticate:', error)
      }
    } else {
      console.log('Token expired but no refresh token available, re-authenticating')
    }
  } else return cached
  return null
} // TODO: register app as adesktop or SPA

export const OAUTH_PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: '14927198496-jaadcashh91s9gue7uicf3datk79tohc.apps.googleusercontent.com',
    //clientSecret: 'YOUR_GOOGLE_CLIENT_SECRET',
    scope: 'https://www.googleapis.com/auth/drive.file',
    pkce: false, //  Google has *not* enable client-side pkce flows without a secret yet.
    // check here for more information:
    // https://www.reddit.com/r/googlecloud/comments/1korxxp/question_about_google_oauth_guide_for_desktop_apps/?utm_source=chatgpt.com
    // https://discuss.google.dev/t/authorization-code-flow-without-client-secret/168113/7
  },
  // desktop-app version of our secret...
  /*google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: '14927198496-s1277o6rppoo553grsra95p8nt9922at.apps.googleusercontent.com',
    //clientSecret: 'YOUR_GOOGLE_CLIENT_SECRET',
    scope: 'https://www.googleapis.com/auth/drive.file',
  },*/
  gitlab: {
    TokenUrl: 'https://gitlab.com/oauth/token',
    // move these into our oauth file...
    clientId: '56a06d49cd5ed412d47ced662b9e6ae297aecadf25cae9f0e036ca0ef299444b',
    authUrl: 'https://gitlab.com/oauth/authorize',
  },
} as const /**
 * Refreshes an access token using a refresh token
 */

export async function refreshAccessToken(
  credentials: OAuthCredentials,
  tokenUrl: string,
  clientId: string,
  fetcher: typeof fetch = fetch,
): Promise<OAuthCredentials> {
  if (!credentials.refresh_token) {
    throw new OAuthError('No refresh token available', 'REFRESH_FAILED')
  }

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: credentials.refresh_token,
  })

  try {
    const res = await fetcher(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!res.ok) {
      let errorDetail = `${res.status} ${res.statusText}`
      try {
        const errorBody = await res.text()
        if (errorBody) {
          errorDetail += ` - ${errorBody}`
        }
      } catch {
        // Ignore error parsing response body
      }
      throw new OAuthError(`Token refresh failed: ${errorDetail}`, 'REFRESH_FAILED')
    }

    const data = await res.json()

    // Check for OAuth error in response
    if (data.error) {
      throw new OAuthError(
        `Token refresh error: ${data.error}${data.error_description ? ` - ${data.error_description}` : ''}`,
        'REFRESH_FAILED',
      )
    }

    // Create new credentials, preserving refresh_token if not provided in response
    const refreshedCreds = OAuthCredentials.parse({
      ...data,
      service: credentials.service,
      type: 'oauth-credentials',
      created_at: Date.now(),
      // Keep the original refresh token if the response doesn't include a new one
      refresh_token: data.refresh_token || credentials.refresh_token,
    })

    return refreshedCreds
  } catch (error) {
    if (error instanceof OAuthError) {
      throw error
    }
    throw new OAuthError(
      `Failed to refresh access token: ${error instanceof Error ? error.message : String(error)}`,
      'REFRESH_FAILED',
    )
  }
} /**
 * Checks if credentials are expired or will expire within the buffer time
 */

export function isTokenExpired(
  credentials: OAuthCredentials,
  bufferSeconds: number = 300,
): boolean {
  if (!credentials.created_at || !credentials.expires_in) {
    return false // Assume valid if no expiration info
  }

  const expiresAt = credentials.created_at + (credentials.expires_in - bufferSeconds) * 1000
  return Date.now() >= expiresAt
}
export async function generatePKCE() {
  const array = crypto.getRandomValues(new Uint8Array(64))
  const verifier = btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

  return { challenge, verifier }
}
export class OAuthError extends Error {
  code:
    | 'POPUP_BLOCKED'
    | 'USER_CANCELLED'
    | 'TIMEOUT'
    | 'NETWORK_ERROR'
    | 'INVALID_RESPONSE'
    | 'POPUP_CLOSED'
    | 'ABORTED'
    | 'REFRESH_FAILED'

  constructor(
    message: string,
    code:
      | 'POPUP_BLOCKED'
      | 'USER_CANCELLED'
      | 'TIMEOUT'
      | 'NETWORK_ERROR'
      | 'INVALID_RESPONSE'
      | 'POPUP_CLOSED'
      | 'ABORTED'
      | 'REFRESH_FAILED',
  ) {
    super(message)
    this.name = 'OAuthError'
    this.code = code
  }
}
