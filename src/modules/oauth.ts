//oauth.ts
import { OAuthCredentials } from './taskyon/types'

//https://console.cloud.google.com/auth/clients/14927198496-jaadcashh91s9gue7uicf3datk79tohc.apps.googleusercontent.com?project=xyntopia-gdrive
// TODO: register app as adesktop or SPA
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
  },
} as const

const redirectUri = `${window.location.origin}/oauth/return`

export async function authenticateWithPopup(
  params: {
    oauthURL: string
    clientId: string
    scope: string
    tokenUrl?: string
  },
  signal?: AbortSignal,
): Promise<OAuthCredentials> {
  const { oauthURL, clientId, scope, tokenUrl } = params

  // Check if already aborted
  if (signal?.aborted) {
    throw new DOMException('Operation was aborted', 'AbortError')
  }

  /*const startUrl = new URL(`${window.location.origin}/oauth/start`)
  startUrl.searchParams.set('svcUrl', oauthURL)
  startUrl.searchParams.set('cid', clientId)
  startUrl.searchParams.set('scope', scope)*/

  // 1) Generate PKCE
  const { challenge, verifier } = await generatePKCE()

  const urlParams = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scope,
    ...(tokenUrl
      ? { code_challenge: challenge, code_challenge_method: 'S256', response_type: 'code' }
      : { response_type: 'token' }),
  })

  const popup = window.open(
    `${oauthURL}?${urlParams.toString()}`,
    `oauth:${oauthURL}`,
    `width=500,height=700`,
  )

  if (!popup) {
    throw new Error('Failed to open OAuth popup')
  }

  const returnQuery = await waitForCode(popup, signal)
  console.log('oauth: received return query', returnQuery)

  if (typeof returnQuery.access_token === 'string') {
    return {
      access_token: returnQuery.access_token,
      service: oauthURL,
      created_at: Date.now(),
      type: 'implicit',
    }
  }
  if (!tokenUrl) {
    throw new Error('no token URL to get access token!')
  }
  if (!('code' in returnQuery) || typeof returnQuery.code !== 'string')
    throw new Error('no return code!')
  const creds = await getAccessTokenFromCode({
    verifier,
    clientId,
    code: returnQuery.code,
    tokenUrl,
  })
  console.log('recevied credentials', creds)
  return creds
}

async function generatePKCE() {
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

async function waitForCode(popup: Window, signal?: AbortSignal) {
  return new Promise<Record<string, unknown> & { code: string }>((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener('message', messageListener, { capture: true })
      signal?.removeEventListener('abort', abortListener)
      try {
        //popup.close()
      } catch {
        console.warn('Failed to close OAuth popup:', popup)
      }
    }

    const messageListener = (event: MessageEvent) => {
      console.log('received event', event)
      //if (event.origin !== window.location.origin) return
      if (event.source !== popup) return

      console.log('received event from oauth popup...', event)

      try {
        // the returned query should contain a "code"
        const returnQuery = event.data

        // prevent duplicate handling
        event.stopImmediatePropagation()
        event.stopPropagation()

        cleanup()
        resolve(returnQuery)
      } catch (error) {
        cleanup()
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }

    const abortListener = () => {
      cleanup()
      reject(new DOMException('Operation was aborted', 'AbortError'))
    }

    console.log('starting oauth listener')
    window.addEventListener('message', messageListener, { capture: true })
    signal?.addEventListener('abort', abortListener)
  })
}

async function getAccessTokenFromCode({
  verifier,
  clientId,
  code,
  tokenUrl,
}: {
  verifier: string
  clientId: string
  code: string
  tokenUrl: string
}) {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  if (!res.ok) {
    throw new Error(`Token request failed (${res.status})`)
  }

  const data = await res.json()
  const creds = OAuthCredentials.parse(data)
  return creds
}
