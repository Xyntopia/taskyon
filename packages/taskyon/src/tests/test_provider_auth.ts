import type { ProviderEndpointConfig } from '../types/chatCompletion'
import { getCodexAccountIdFromCredentials } from '../utils/codexAuth'
import {
  OAuthCredentials,
  OAuthError,
  exchangeOauthCode,
  createOauthAuthorizationUrl,
} from '../utils/oauth'
import { getProviderOauthConfig } from '../utils/providerAuth'
import { authenticateWithDeviceCode, usePersistentOauth } from '../utils/oauthUi'

export const testOauthExpiredSessionRequiresNewAuthentication = async () => {
  const expired = OAuthCredentials.parse({
    type: 'oauth-credentials',
    access_token: 'synthetic-expired',
    service: 'https://provider.example/token',
    created_at: 1,
    expires_in: 1,
  })
  let logins = 0
  let saved: string | undefined
  const getToken = usePersistentOauth(
    {
      getSecret: () => Promise.resolve(JSON.stringify(expired)),
      setSecret: (_name, value) => {
        saved = value
        return Promise.resolve()
      },
    },
    () => {
      logins += 1
      return Promise.resolve({
        ...expired,
        access_token: 'synthetic-new',
        created_at: Date.now(),
        expires_in: 3600,
      })
    },
  )
  const result = await getToken('llm:chatgpt-codex', {
    oauthURL: 'https://provider.example/authorize',
    clientId: 'synthetic',
    scope: '',
    tokenUrl: expired.service,
  })
  assert(
    logins === 1 && result.access_token === 'synthetic-new' && !!saved,
    'Expired credentials must not survive a failed or unavailable refresh',
  )
}

export const testOauthRefreshUsesHostSelectedFetch = async () => {
  const expired = OAuthCredentials.parse({
    type: 'oauth-credentials',
    access_token: 'synthetic-expired',
    refresh_token: 'synthetic-refresh',
    service: 'https://provider.example/token',
    created_at: 1,
    expires_in: 1,
  })
  const requestedUrls: string[] = []
  const getToken = usePersistentOauth({
    getSecret: () => Promise.resolve(JSON.stringify(expired)),
    setSecret: () => Promise.resolve(),
  })
  const credentials = await getToken(
    'llm:chatgpt-codex',
    {
      oauthURL: 'https://provider.example/oauth/authorize',
      clientId: 'synthetic-client',
      scope: 'openid',
      tokenUrl: 'https://provider.example/token',
    },
    undefined,
    {
      fetch: (input) => {
        requestedUrls.push(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        )
        return Promise.resolve(
          Response.json({
            access_token: 'synthetic-refreshed',
            refresh_token: 'synthetic-refresh',
            expires_in: 3600,
          }),
        )
      },
    },
  )
  assert(
    requestedUrls[0] === 'https://provider.example/token',
    'OAuth refresh must use the host-selected fetch transport',
  )
  assert(credentials.access_token === 'synthetic-refreshed', 'Expected refreshed credentials')
}

testOauthRefreshUsesHostSelectedFetch.description =
  'Routes cached OAuth token refreshes through the host-selected fetch transport.'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const encodeBase64Url = (value: unknown): string =>
  globalThis.btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

export const testCodexAccountSelectionIgnoresOrganizationMembership = () => {
  const token = (claims: Record<string, unknown>) =>
    `${encodeBase64Url({ alg: 'none' })}.${encodeBase64Url(claims)}.signature`
  const credentials = OAuthCredentials.parse({
    type: 'oauth-credentials',
    access_token: token({
      'https://api.openai.com/auth': { chatgpt_account_id: 'selected-workspace' },
    }),
    id_token: token({ organizations: [{ id: 'org-unselected' }] }),
    service: 'https://provider.example/token',
    created_at: Date.now(),
  })
  assert(
    getCodexAccountIdFromCredentials(credentials) === 'selected-workspace',
    'An organization membership must not override the workspace selected during OAuth',
  )
  assert(
    getCodexAccountIdFromCredentials({ ...credentials, access_token: 'opaque' }) === undefined,
    'Organization membership alone does not identify a selected ChatGPT workspace',
  )
  assert(
    getCodexAccountIdFromCredentials({
      ...credentials,
      id_token: token({ chatgpt_account_id: 'older-workspace' }),
    }) === 'selected-workspace',
    'The active access token must take precedence over an older ID token',
  )
}

export const testCodexAccountIdUsesOpenAiAuthClaims = () => {
  const idToken = [
    encodeBase64Url({ alg: 'none', typ: 'JWT' }),
    encodeBase64Url({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct-codex-test',
      },
    }),
    'signature',
  ].join('.')
  const credentials = OAuthCredentials.parse({
    type: 'oauth-credentials',
    access_token: 'access-token',
    id_token: idToken,
    service: 'https://auth.openai.com/oauth/token',
    created_at: Date.now(),
  })

  assert(
    getCodexAccountIdFromCredentials(credentials) === 'acct-codex-test',
    'Expected Codex account ID to be read from the OpenAI auth claim',
  )
}

testCodexAccountIdUsesOpenAiAuthClaims.description =
  'Extracts the ChatGPT account ID needed by Codex requests from OAuth credentials.'

export const testGenericOauthDoesNotAssumeCodexTokenExchange = () => {
  const provider = {
    name: 'Generic OAuth provider',
    baseURL: 'https://provider.example',
    streamSupport: false,
    auth: {
      type: 'oauth',
      oauth: {
        authorizationUrl: 'https://provider.example/oauth/authorize',
        tokenUrl: 'https://provider.example/oauth/token',
        clientId: 'generic-client',
      },
    },
    routes: {
      chatCompletion: '/chat',
      models: '/models',
    },
  } satisfies ProviderEndpointConfig

  const oauth = getProviderOauthConfig(provider)
  assert(oauth?.tokenExchange === undefined, 'Generic OAuth must not assume Codex token exchange')
}

testGenericOauthDoesNotAssumeCodexTokenExchange.description =
  'Keeps provider OAuth login generic unless token exchange is explicitly configured.'

export const testOauthSharedAuthorizationAndExchange = async () => {
  const url = new URL(
    createOauthAuthorizationUrl({
      oauthURL: 'https://provider.example/authorize',
      clientId: 'synthetic-client',
      scope: 'openid',
      redirectUri: 'http://localhost:1455/auth/callback',
      state: 'synthetic-state',
      challenge: 'synthetic-challenge',
      authorizeQuery: { originator: 'codex_cli' },
    }),
  )
  assert(url.searchParams.get('code_challenge_method') === 'S256', 'All clients must use PKCE S256')
  assert(
    url.searchParams.get('originator') === 'codex_cli',
    'Provider options must survive adapter boundaries',
  )
  let overrideRejected = false
  try {
    createOauthAuthorizationUrl({
      oauthURL: 'https://provider.example/authorize',
      clientId: 'test',
      scope: '',
      redirectUri: 'https://app.example/oauth/return',
      state: 'expected',
      challenge: 'challenge',
      authorizeQuery: { state: 'override' },
    })
  } catch {
    overrideRejected = true
  }
  assert(overrideRejected, 'Provider flags must not replace CSRF state or PKCE parameters')
  const credentials = await exchangeOauthCode({
    tokenUrl: 'https://provider.example/token',
    clientId: 'synthetic-client',
    code: 'synthetic-code',
    verifier: 'synthetic-verifier',
    redirectUri: 'http://localhost:1455/auth/callback',
    fetch: (_url, init) => {
      if (typeof init?.body !== 'string') throw new Error('Expected a form-encoded request body')
      const body = new URLSearchParams(init.body)
      assert(
        body.get('code_verifier') === 'synthetic-verifier',
        'Must exchange the original verifier',
      )
      assert(
        body.get('redirect_uri') === 'http://localhost:1455/auth/callback',
        'Must use the exact callback',
      )
      return Promise.resolve(
        Response.json({
          access_token: 'synthetic-access',
          refresh_token: 'synthetic-refresh',
          expires_in: 3600,
        }),
      )
    },
  })
  assert(credentials.access_token === 'synthetic-access', 'Expected canonical OAuth credentials')
  assert(
    credentials.service === 'https://provider.example/token',
    'Expected token service identity',
  )
}

export const testOauthExchangeDoesNotExposeProviderBodies = async () => {
  for (const status of [200, 401]) {
    let message = ''
    try {
      await exchangeOauthCode({
        tokenUrl: 'https://provider.example/token',
        clientId: 'synthetic',
        code: 'synthetic-code',
        verifier: 'synthetic-verifier',
        redirectUri: 'https://app.example/oauth/return',
        fetch: () => Promise.resolve(new Response('SYNTHETIC_SENSITIVE_RESPONSE', { status })),
      })
    } catch (error) {
      assert(error instanceof OAuthError, 'Exchange failures must use sanitized OAuth errors')
      message = error.message
    }
    assert(
      message.length > 0 && !message.includes('SYNTHETIC_SENSITIVE_RESPONSE'),
      'Neither failed exchanges nor malformed success bodies may expose provider response content',
    )
  }
}

export const testCodexDeviceCodeFlow = async () => {
  let pollCount = 0
  let prompt: { verificationUrl: string; userCode: string } | undefined
  const credentials = await authenticateWithDeviceCode(
    {
      oauthURL: 'https://auth.example/oauth/authorize',
      clientId: 'synthetic-client',
      scope: 'openid profile offline_access',
      tokenUrl: 'https://auth.example/oauth/token',
    },
    undefined,
    1_000,
    {
      onDeviceCode: (value) => {
        prompt = value
      },
    },
    async (url, init) => {
      const requestUrl = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
      if (requestUrl.endsWith('/api/accounts/deviceauth/usercode')) {
        return Response.json({
          device_auth_id: 'device-id',
          user_code: 'ABCD-EFGH',
          interval: '0.001',
        })
      }
      if (requestUrl.endsWith('/api/accounts/deviceauth/token')) {
        pollCount += 1
        if (pollCount === 1) return new Response('', { status: 403 })
        return Response.json({
          authorization_code: 'authorization-code',
          code_verifier: 'verifier',
        })
      }
      if (requestUrl.endsWith('/oauth/token')) {
        if (typeof init?.body !== 'string') throw new Error('Expected a form-encoded token request')
        const body = new URLSearchParams(init.body)
        assert(
          body.get('redirect_uri') === 'https://auth.example/deviceauth/callback',
          'Device flow must use the provider callback URI for token exchange',
        )
        return Response.json({
          access_token: 'synthetic-access',
          refresh_token: 'synthetic-refresh',
          expires_in: 3600,
        })
      }
      throw new Error(`Unexpected device OAuth request: ${requestUrl}`)
    },
  )
  assert(
    prompt?.verificationUrl === 'https://auth.example/codex/device' &&
      prompt.userCode === 'ABCD-EFGH',
    'Device flow must expose the provider URL and one-time code to the host UI',
  )
  assert(pollCount === 2, 'Device flow must poll until authorization completes')
  assert(credentials.access_token === 'synthetic-access', 'Expected device OAuth credentials')
}
