import type { Taskyon } from '../../taskyon/src/core/init'
import type { ProviderEndpointConfig } from '../../taskyon/src/types/chatCompletion'
import {
  CODEX_PROVIDER_NAME,
  resolveCodexOauthSession,
  type CodexOauthSession,
} from '../../taskyon/src/utils/codexAuth'
import {
  loginWithProviderOauthCli,
  resolveCachedProviderOauthCredentials,
  type CliOauthStorage,
} from './oauthLogin'

export const resolveCachedCodexOauthSession = async ({
  api,
  taskyon,
  storage,
}: {
  api: ProviderEndpointConfig
  taskyon: Pick<Taskyon, 'getSecret' | 'setSecret'>
  storage: CliOauthStorage
}): Promise<CodexOauthSession | null> => {
  const credentials = await resolveCachedProviderOauthCredentials({
    providerName: CODEX_PROVIDER_NAME,
    api,
    taskyon,
    storage,
  })
  return credentials ? resolveCodexOauthSession(credentials) : null
}

export const loginWithCodexOauthCli = async ({
  api,
  taskyon,
  storage,
  forceReauth = false,
  timeoutMs = 5 * 60 * 1000,
  workspaceId,
}: {
  api: ProviderEndpointConfig
  taskyon: Pick<Taskyon, 'getSecret' | 'setSecret'>
  storage: CliOauthStorage
  forceReauth?: boolean
  timeoutMs?: number
  /** Explicit host constraint, never a remembered selection from a previous login. */
  workspaceId?: string
}): Promise<CodexOauthSession> => {
  const credentials = await loginWithProviderOauthCli({
    providerName: CODEX_PROVIDER_NAME,
    api,
    taskyon,
    storage,
    forceReauth,
    timeoutMs,
    authorizeQuery: {
      originator: 'codex_cli',
      ...(workspaceId ? { allowed_workspace_id: workspaceId } : {}),
    },
  })
  // OAuth already selected the account. Do not open another terminal reader or
  // pair these credentials with an independently persisted account/preference.
  return resolveCodexOauthSession(credentials)
}
