import type { ProviderEndpointConfig } from '../types/chatCompletion'
import type { OAuthCredentials } from './oauth'

export type ProviderOauthConfig = {
  oauthURL: string
  clientId: string
  scope: string
  tokenUrl?: string
  authorizeQuery?: Record<string, string>
  tokenExchange?: {
    tokenUrl: string
    requestedToken: string
    subjectTokenType: string
  }
}

export const OAUTH_CREDENTIALS_SECRET_PREFIX = 'oauth:credentials:'

const readConfigValue = (
  headers: Record<string, string> | undefined,
  keys: readonly string[],
): string | undefined => {
  for (const key of keys) {
    const value = headers?.[key]
    if (value) return value
  }
  return undefined
}

export const getProviderOauthConfig = (
  api: ProviderEndpointConfig,
): ProviderOauthConfig | undefined => {
  const oauthURL =
    api.auth?.oauth?.authorizationUrl ||
    readConfigValue(api.defaultHeaders, [
      'oauthAuthorizationUrl',
      'oauth_authorization_url',
      'oauthURL',
      'oauth_url',
    ])
  const clientId =
    api.auth?.oauth?.clientId ||
    readConfigValue(api.defaultHeaders, ['oauthClientId', 'oauth_client_id'])
  if (!oauthURL || !clientId) return undefined

  const scope =
    api.auth?.oauth?.scope ||
    readConfigValue(api.defaultHeaders, ['oauthScope', 'oauth_scope']) ||
    ''
  const tokenUrl =
    api.auth?.oauth?.tokenUrl ||
    readConfigValue(api.defaultHeaders, ['oauthTokenUrl', 'oauth_token_url'])
  const tokenExchangeUrl = api.auth?.oauth?.tokenExchange?.tokenUrl || tokenUrl
  return {
    oauthURL,
    clientId,
    scope,
    ...(api.auth?.oauth?.authorizeQuery ? { authorizeQuery: api.auth.oauth.authorizeQuery } : {}),
    ...(tokenUrl ? { tokenUrl } : {}),
    ...(tokenExchangeUrl
      ? {
          tokenExchange: {
            tokenUrl: tokenExchangeUrl,
            requestedToken: api.auth?.oauth?.tokenExchange?.requestedToken || 'openai-api-key',
            subjectTokenType:
              api.auth?.oauth?.tokenExchange?.subjectTokenType ||
              'urn:ietf:params:oauth:token-type:id_token',
          },
        }
      : {}),
  }
}

export const hasProviderOauthConfig = (api: ProviderEndpointConfig): boolean => {
  return !!getProviderOauthConfig(api)
}

export const getProviderOauthCredentialsKey = (providerName: string) => `llm:${providerName}`

export const getProviderOauthCredentialsSecretName = (providerName: string) =>
  `${OAUTH_CREDENTIALS_SECRET_PREFIX}${getProviderOauthCredentialsKey(providerName)}`

export async function resolveProviderAccessToken(
  creds: OAuthCredentials,
  api: ProviderEndpointConfig,
): Promise<string> {
  const cfg = getProviderOauthConfig(api)
  if (!cfg?.tokenExchange) return creds.access_token
  if (!creds.id_token) {
    throw new Error('OAuth token exchange requires id_token, but provider did not return one.')
  }

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: cfg.clientId,
    requested_token: cfg.tokenExchange.requestedToken,
    subject_token: creds.id_token,
    subject_token_type: cfg.tokenExchange.subjectTokenType,
  })

  const res = await fetch(cfg.tokenExchange.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(
      `Provider token exchange failed (${res.status} ${res.statusText})${errBody ? `: ${errBody}` : ''}`,
    )
  }

  const data = (await res.json()) as { access_token?: unknown }
  if (typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('Provider token exchange did not return access_token.')
  }
  return data.access_token
}
