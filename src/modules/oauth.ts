const OAUTH_PROVIDERS = {
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

async function getOAuthAccessToken(provider: keyof typeof OAUTH_PROVIDERS, authCode: string) {
  const config = OAUTH_PROVIDERS[provider]

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
    },
    body: new URLSearchParams({
      code: authCode,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!response.ok) throw new Error(`OAuth failed for ${provider}`)

  return response.json() // Contains access_token, refresh_token, etc.
}
