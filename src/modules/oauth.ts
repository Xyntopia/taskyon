import { OAuthCredentials } from './taskyon/types'

export const OAUTH_PROVIDERS = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    clientId: 'YOUR_GOOGLE_CLIENT_ID',
    clientSecret: 'YOUR_GOOGLE_CLIENT_SECRET',
    redirectUri: 'YOUR_REDIRECT_URI',
    scope: 'openid email profile',
  },
  reddit: {
    authUrl: 'https://www.reddit.com/api/v1/authorize',
    tokenUrl: 'https://www.reddit.com/api/v1/access_token',
    clientId: 'YOUR_REDDIT_CLIENT_ID',
    clientSecret: 'YOUR_REDDIT_CLIENT_SECRET',
    redirectUri: 'YOUR_REDIRECT_URI',
    scope: 'identity',
  },
} as const

export async function authenticateWithPopup(
  params: {
    oauthURL: string
    clientId: string
    scope: string
  },
  signal?: AbortSignal,
): Promise<OAuthCredentials> {
  const { oauthURL, clientId, scope } = params

  // Check if already aborted
  if (signal?.aborted) {
    throw new DOMException('Operation was aborted', 'AbortError')
  }

  const startUrl = new URL(`${window.location.origin}/oauth/start`)
  startUrl.searchParams.set('svcUrl', oauthURL)
  startUrl.searchParams.set('cid', clientId)
  startUrl.searchParams.set('scope', scope)

  const popup = window.open(startUrl.toString(), `oauth:${oauthURL}`, `width=500,height=700`)

  if (!popup) {
    throw new Error('Failed to open OAuth popup')
  }

  return new Promise<OAuthCredentials>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', messageListener, { capture: true })
      signal?.removeEventListener('abort', abortListener)
      try {
        popup.close()
      } catch {
        console.warn('Failed to close OAuth popup:', popup)
      }
    }

    const messageListener = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (event.source !== popup) return

      try {
        const creds = OAuthCredentials.parse(event.data)

        // prevent duplicate handling
        event.stopImmediatePropagation()
        event.stopPropagation()

        cleanup()
        resolve(creds)
      } catch (error) {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }

    const abortListener = () => {
      cleanup()
      reject(new DOMException('Operation was aborted', 'AbortError'))
    }

    window.addEventListener('message', messageListener, { capture: true })
    signal?.addEventListener('abort', abortListener)
  })
}
