//https://console.cloud.google.com/auth/clients/14927198496-jaadcashh91s9gue7uicf3datk79tohc.apps.googleusercontent.com?project=xyntopia-gdrive
import {
  generatePKCE,
  isTokenExpired,
  OAuthCredentials,
  OAuthError,
  useRefreshTokenIfExpired,
} from './oauth'

const redirectUri = `${window.location.origin}/oauth/return`

// Configurable timeout for OAuth operations
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const POPUP_CHECK_INTERVAL_MS = 1000 // Check if popup is closed every second

export interface AuthenticationOptions {
  /** Force the user to re-authenticate, even if they have an active session */
  forceReauth?: boolean
  /** Prompt the user to select an account, even if they only have one */
  forceAccountSelection?: boolean
}

export async function authenticateWithPopup(
  params: {
    oauthURL: string
    clientId: string
    scope: string
    tokenUrl?: string
    authorizeQuery?: Record<string, string>
    redirectUri?: string
  },
  signal?: AbortSignal,
  timeoutMs: number = OAUTH_TIMEOUT_MS,
  options: AuthenticationOptions = {},
): Promise<OAuthCredentials> {
  const { oauthURL, clientId, scope, tokenUrl, authorizeQuery, redirectUri: customRedirectUri } = params
  const { forceReauth = false, forceAccountSelection = false } = options
  const effectiveRedirectUri = customRedirectUri || redirectUri

  // Check if already aborted
  if (signal?.aborted) {
    throw new OAuthError('Operation was aborted', 'ABORTED')
  }

  try {
    // 1) Generate PKCE
    const { challenge, verifier } = await generatePKCE()

    const urlParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: effectiveRedirectUri,
      scope: scope,
      ...(tokenUrl
        ? { code_challenge: challenge, code_challenge_method: 'S256', response_type: 'code' }
        : { response_type: 'token' }),
    })

    // Add Google-specific parameters for forcing reconnection
    if (oauthURL.includes('accounts.google.com')) {
      const promptValues: string[] = []

      if (forceReauth) {
        // Forces the user to re-authenticate, ignoring any existing sessions
        promptValues.push('consent')
      }

      if (forceAccountSelection) {
        // Forces account selection screen, even with single account
        promptValues.push('select_account')
      }

      if (promptValues.length > 0) {
        // Combine multiple prompt values with space separation as per OAuth2 spec
        urlParams.set('prompt', promptValues.join(' '))
      }

      // Request offline access to get refresh token
      if (tokenUrl) {
        urlParams.set('access_type', 'offline')
      }
    }

    // Add provider-specific query params (Codex-style or any custom provider flags).
    if (authorizeQuery) {
      for (const [key, value] of Object.entries(authorizeQuery)) {
        urlParams.set(key, value)
      }
    }

    const popup = window.open(
      `${oauthURL}?${urlParams.toString()}`,
      `oauth:${oauthURL}`,
      `width=500,height=700,scrollbars=yes,resizable=yes`,
    )

    if (!popup) {
      throw new OAuthError('Failed to open OAuth popup - popup may be blocked', 'POPUP_BLOCKED')
    }

    const msg = await waitForPopupReturn(popup, signal, timeoutMs)
    console.log('oauth: received return query', msg)

    // Handle error responses first
    if (msg.error) {
      throw new OAuthError(
        `OAuth error: ${msg.error}${msg.error_description ? ` - ${msg.error_description}` : ''}`,
        'INVALID_RESPONSE',
      )
    }

    // check if msg contains an access_token
    // this is used for the google implicit workflow...
    if (msg.hash) {
      const iparams = Object.fromEntries(new URLSearchParams(msg.hash.slice(1)))
      if (typeof iparams.access_token === 'string') {
        return {
          type: 'oauth-credentials',
          access_token: iparams.access_token,
          service: oauthURL,
          ...(iparams.expires_in ? { expires_in: parseInt(iparams.expires_in) } : {}),
          created_at: Date.now(),
          ...(iparams.token_type ? { token_type: iparams.token_type } : { token_type: 'implicit' }),
        }
      }
    }

    if (!tokenUrl) {
      throw new OAuthError('No token URL provided for authorization code flow', 'INVALID_RESPONSE')
    }

    if (!msg.query) {
      throw new OAuthError('No query parameters received from OAuth provider', 'INVALID_RESPONSE')
    }

    const qparams = Object.fromEntries(new URLSearchParams(msg.query.slice(1)))
    if (!qparams.code || typeof qparams.code !== 'string') {
      throw new OAuthError('No authorization code received from OAuth provider', 'INVALID_RESPONSE')
    }

    const creds = await getAccessTokenFromCode({
      verifier,
      clientId,
      code: qparams.code,
      tokenUrl,
      redirectUri: effectiveRedirectUri,
    })
    console.log('received credentials', creds)
    return creds
  } catch (error) {
    // Re-throw OAuthError as-is, wrap other errors
    if (error instanceof OAuthError) {
      throw error
    }
    throw new OAuthError(
      `OAuth authentication failed: ${error instanceof Error ? error.message : String(error)}`,
      'NETWORK_ERROR',
    )
  }
}

export type authReturn = {
  status: 'return'
  query: string
  hash: string
  error?: string
  error_description?: string
}

async function waitForPopupReturn(
  popup: Window,
  signal?: AbortSignal,
  timeoutMs: number = OAUTH_TIMEOUT_MS,
): Promise<authReturn> {
  return new Promise<authReturn>((resolve, reject) => {
    let resolved = false

    const cleanup = (timeoutId?: number, popupCheckInterval?: number) => {
      if (resolved) return
      resolved = true

      window.removeEventListener('message', messageListener, { capture: true })
      signal?.removeEventListener('abort', abortListener)

      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      if (popupCheckInterval !== undefined) {
        clearInterval(popupCheckInterval)
      }

      try {
        if (!popup.closed) {
          popup.close()
        }
      } catch (error) {
        console.warn('Failed to close OAuth popup:', error)
      }
    }

    const messageListener = (event: MessageEvent) => {
      console.log('received event', event)

      // Basic security check - ensure message is from our popup
      if (event.source !== popup) return

      // Handle different message formats
      if (event.data && (event.data.status === 'return' || event.data.error)) {
        console.log('received event from oauth popup...', event)

        try {
          // prevent duplicate handling
          event.stopImmediatePropagation()
          event.stopPropagation()

          cleanup(timeoutId, popupCheckInterval)
          resolve(event.data)
        } catch (error) {
          cleanup(timeoutId, popupCheckInterval)
          reject(
            new OAuthError(
              `Error processing OAuth response: ${error instanceof Error ? error.message : String(error)}`,
              'INVALID_RESPONSE',
            ),
          )
        }
      }
    }

    const abortListener = () => {
      cleanup(timeoutId, popupCheckInterval)
      reject(new OAuthError('OAuth operation was aborted', 'ABORTED'))
    }

    const timeoutListener = () => {
      cleanup(timeoutId, popupCheckInterval)
      reject(new OAuthError(`OAuth operation timed out after ${timeoutMs}ms`, 'TIMEOUT'))
    }

    const checkPopupClosed = () => {
      try {
        if (popup.closed) {
          cleanup(timeoutId, popupCheckInterval)
          reject(new OAuthError('OAuth popup was closed by user', 'USER_CANCELLED'))
        }
      } catch {
        // Popup may be from different origin, can't check closed status reliably
        // This is normal and expected in many cases
      }
    }

    console.log('starting oauth listener')
    window.addEventListener('message', messageListener, { capture: true })
    signal?.addEventListener('abort', abortListener)

    // Set up timeout
    const timeoutId = window.setTimeout(timeoutListener, timeoutMs)

    // Periodically check if popup was closed
    const popupCheckInterval = window.setInterval(checkPopupClosed, POPUP_CHECK_INTERVAL_MS)
  })
}

async function getAccessTokenFromCode({
  verifier,
  clientId,
  code,
  tokenUrl,
  redirectUri,
}: {
  verifier: string
  clientId: string
  code: string
  tokenUrl: string
  redirectUri: string
}): Promise<OAuthCredentials> {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
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
      throw new OAuthError(`Token request failed: ${errorDetail}`, 'NETWORK_ERROR')
    }

    const data = await res.json()

    // Check for OAuth error in response
    if (data.error) {
      throw new OAuthError(
        `Token exchange error: ${data.error}${data.error_description ? ` - ${data.error_description}` : ''}`,
        'INVALID_RESPONSE',
      )
    }

    const creds = OAuthCredentials.parse({
      ...data,
      service: tokenUrl,
      type: 'oauth-credentials',
      created_at: Date.now(),
    })
    return creds
  } catch (error) {
    if (error instanceof OAuthError) {
      throw error
    }
    throw new OAuthError(
      `Failed to exchange authorization code for token: ${error instanceof Error ? error.message : String(error)}`,
      'NETWORK_ERROR',
    )
  }
}

export type TokenGetter = (
  provider: string,
  params: {
    oauthURL: string
    clientId: string
    scope: string
    tokenUrl?: string
    authorizeQuery?: Record<string, string>
    redirectUri?: string
  },
  signal?: AbortSignal,
  options?: AuthenticationOptions,
) => Promise<OAuthCredentials>

export const usePersistentOauth = (secretStore: {
  getSecret(secretName: string): Promise<string | null>
  setSecret(secretName: string, secretData: string): Promise<void>
}): TokenGetter => {
  async function loadCredentials(provider: string): Promise<OAuthCredentials | null> {
    try {
      const sec = await secretStore.getSecret(provider)
      if (sec) {
        const cached = JSON.parse(sec) as OAuthCredentials
        if (cached) {
          return cached
        }
      }
    } catch (error) {
      console.warn(`Failed to load cached credentials for ${provider}:`, error)
    }
    return null
  }

  async function saveCredentials(provider: string, credentials: OAuthCredentials): Promise<void> {
    try {
      await secretStore.setSecret(provider, JSON.stringify(credentials))
    } catch (error) {
      console.warn(`Failed to cache credentials for ${provider}:`, error)
    }
  }

  return async (
    provider: string,
    params: { oauthURL: string; clientId: string; scope: string; tokenUrl?: string },
    signal?: AbortSignal,
    options: AuthenticationOptions = {},
  ): Promise<OAuthCredentials> => {
    try {
      // Skip loading cached credentials if forcing re-authentication
      let cached = options.forceReauth ? null : await loadCredentials(provider)

      // If we have cached credentials, check if they need refreshing
      if (cached && !options.forceReauth) {
        // For implicit flow (no tokenUrl), we can't refresh, so check expiration
        if (!params.tokenUrl) {
          if (isTokenExpired(cached)) {
            cached = null // Force new authentication
          }
        } else {
          // For authorization code flow, try to refresh if expired
          const refreshed = await useRefreshTokenIfExpired(cached, {
            clientId: params.clientId,
            tokenUrl: params.tokenUrl,
          })
          if (refreshed) await saveCredentials(provider, refreshed)
        }
      }

      // Return valid cached credentials
      if (cached) return cached

      // Need to authenticate
      const creds = await authenticateWithPopup(params, signal, OAUTH_TIMEOUT_MS, options)
      await saveCredentials(provider, creds)
      return creds
    } catch (error) {
      if (error instanceof OAuthError) {
        throw error
      }
      throw new OAuthError(
        `OAuth authentication failed for provider ${provider}: ${error instanceof Error ? error.message : String(error)}`,
        'NETWORK_ERROR',
      )
    }
  }
}
