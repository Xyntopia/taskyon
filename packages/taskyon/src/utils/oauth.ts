import z from 'zod'

//oauth.ts
export const OAuthCredentials = z.object({
  type: z.enum(['oauth-credentials']),
  access_token: z.string(),
  refresh_token: z.string().optional(),
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
  params: { tokenUrl: string; clientId: string },
): Promise<OAuthCredentials | null> {
  if (isTokenExpired(cached)) {
    if (cached.refresh_token) {
      try {
        console.log('Token expired, attempting refresh...')
        const refreshed = await refreshAccessToken(cached, params.tokenUrl, params.clientId)
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
    const res = await fetch(tokenUrl, {
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
  constructor(
    message: string,
    public code:
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
  }
}
