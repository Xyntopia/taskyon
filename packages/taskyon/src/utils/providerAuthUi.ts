import type { ProviderEndpointConfig } from '../types/chatCompletion'
import type { CryptoSession } from './cryptoSession'
import { withSecretStore } from './crudWrapper'
import { EncryptedDataRow } from './encrypt'
import { createProtocolStorageCrudWrapper, type TaskyonStorageClient } from '../api/storageProtocol'
import type { AuthenticationOptions, TokenGetter } from './oauthUi'
import { usePersistentOauth } from './oauthUi'
import { getProviderOauthConfig, getProviderOauthCredentialsKey } from './providerAuth'
export { OAUTH_CREDENTIALS_SECRET_PREFIX } from './providerAuth'

export type OauthSecretStore = {
  getSecret(secretName: string): Promise<string | null>
  setSecret(secretName: string, secretData: string): Promise<void>
}

export const createEncryptedOauthSecretStore = (
  storage: TaskyonStorageClient,
  cryptoSession: CryptoSession,
  namespace = 'provider-auth/v1',
) => {
  const secretStore = withSecretStore(
    createProtocolStorageCrudWrapper(storage, namespace, EncryptedDataRow),
    undefined,
    () => cryptoSession.getSessionKey(),
  )
  const id = 'oauth-credentials'

  return {
    getSecret: (secretName: string) => secretStore.getSecret(id, secretName, false, false),
    setSecret: (secretName: string, secretData: string) =>
      secretStore.setSecret(id, secretName, secretData),
    deleteSecret: (secretName: string) => secretStore.deleteSecret(id, secretName),
  }
}

export const createPersistentOauthTokenGetter = (secretStore: OauthSecretStore): TokenGetter =>
  usePersistentOauth(secretStore)

export async function loginWithProviderOauth(
  providerName: string,
  api: ProviderEndpointConfig,
  getToken: TokenGetter,
  options?: AuthenticationOptions,
) {
  const cfg = getProviderOauthConfig(api)
  if (!cfg) {
    throw new Error(
      `OAuth is not configured for "${providerName}". Define auth.oauth.authorizationUrl and auth.oauth.clientId in that provider's chatCompletion profile.`,
    )
  }
  return await getToken(getProviderOauthCredentialsKey(providerName), cfg, undefined, options)
}
