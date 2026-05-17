import type { apiConfig } from '../types/chatCompletion'
import type { AuthenticationOptions, TokenGetter } from './oauthUi'
import { usePersistentOauth } from './oauthUi'
import { getProviderOauthConfig, getProviderOauthCredentialsKey } from './providerAuth'
export { OAUTH_CREDENTIALS_SECRET_PREFIX } from './providerAuth'

export type OauthSecretStore = {
  getSecret(secretName: string): Promise<string | null>
  setSecret(secretName: string, secretData: string): Promise<void>
}

export const createPersistentOauthTokenGetter = (secretStore: OauthSecretStore): TokenGetter =>
  usePersistentOauth(secretStore)

export async function loginWithProviderOauth(
  providerName: string,
  api: apiConfig,
  getToken: TokenGetter,
  options?: AuthenticationOptions,
) {
  const cfg = getProviderOauthConfig(api)
  if (!cfg) {
    throw new Error(
      `OAuth is not configured for "${providerName}". Please define llmApis.${providerName}.auth.oauth.authorizationUrl and llmApis.${providerName}.auth.oauth.clientId.`,
    )
  }
  return await getToken(getProviderOauthCredentialsKey(providerName), cfg, undefined, options)
}
