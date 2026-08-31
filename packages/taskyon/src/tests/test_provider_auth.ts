import type { ProviderEndpointConfig } from '../types/chatCompletion'
import { getCodexAccountIdFromCredentials } from '../utils/codexAuth'
import { OAuthCredentials } from '../utils/oauth'
import { getProviderOauthConfig } from '../utils/providerAuth'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const encodeBase64Url = (value: unknown): string =>
  globalThis.btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

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
