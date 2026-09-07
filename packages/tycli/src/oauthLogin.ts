import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import type { Taskyon } from '../../taskyon/src/core/init'
import type { ProviderEndpointConfig } from '../../taskyon/src/types/chatCompletion'
import {
  type ProviderOauthConfig,
  getProviderOauthConfig,
  getProviderOauthCredentialsSecretName,
} from '../../taskyon/src/utils/providerAuth'
import {
  OAuthCredentials,
  refreshAccessToken,
  useRefreshTokenIfExpired,
  generatePKCE,
  exchangeOauthCode,
  createOauthAuthorizationUrl,
} from '../../taskyon/src/utils/oauth'

export type CliOauthStorage = {
  authDir: string
  secretId: string
}
const CLI_OAUTH_LOOPBACK_PORT = 1455
const CLI_OAUTH_REDIRECT_URI = `http://localhost:${CLI_OAUTH_LOOPBACK_PORT}/auth/callback`

const parseCallbackUrl = (rawUrl: string) => {
  const url = new URL(rawUrl, 'http://127.0.0.1')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  return { error, errorDescription, code, state }
}

const parseJwtPayload = (jwt: string): Record<string, unknown> | null => {
  const parts = jwt.split('.')
  if (parts.length < 2) return null
  const payload = parts[1]
  if (!payload) return null
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4)
    const decoded = Buffer.from(padded, 'base64').toString('utf8')
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

type PersistedAuthState = {
  credentials?: unknown
  [key: string]: unknown
}
const providerAuthFilePath = (storage: CliOauthStorage, providerName: string): string => {
  const safeProviderName = providerName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(storage.authDir, `${safeProviderName}.json`)
}

export const readPersistedAuthState = async (
  storage: CliOauthStorage,
  providerName: string,
): Promise<PersistedAuthState> => {
  try {
    const raw = await readFile(providerAuthFilePath(storage, providerName), 'utf8')
    const parsed = JSON.parse(raw) as PersistedAuthState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export const writePersistedAuthState = async (
  storage: CliOauthStorage,
  providerName: string,
  patch: Record<string, unknown>,
) => {
  const currentState = await readPersistedAuthState(storage, providerName)
  const nextState: PersistedAuthState = { ...currentState, ...patch }
  try {
    await mkdir(storage.authDir, { recursive: true })
    await writeFile(
      providerAuthFilePath(storage, providerName),
      JSON.stringify(nextState, null, 2),
      {
        encoding: 'utf8',
        mode: 0o600,
      },
    )
  } catch {
    // The Taskyon secret store is the real runtime source of truth. The sidecar
    // file cache is only a convenience layer and should never block CLI flows.
  }
}

const getJwtExpiryMs = (jwt: string): number | undefined => {
  const payload = parseJwtPayload(jwt)
  const exp = payload?.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return undefined
  return exp * 1000
}

const isIdTokenExpired = (
  credentials: ReturnType<typeof OAuthCredentials.parse>,
  bufferMs = 60_000,
): boolean => {
  if (!credentials.id_token) return true
  const expiryMs = getJwtExpiryMs(credentials.id_token)
  if (!expiryMs) return false
  return Date.now() + bufferMs >= expiryMs
}

const waitForAuthCode = async (
  expectedState: string,
  timeoutMs: number,
  redirectUri: string,
): Promise<{ code: string; redirectUri: string }> => {
  return await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const data = parseCallbackUrl(req.url ?? '/')
      const isStateValid = data.state === expectedState
      const status = data.error || !data.code || !isStateValid ? 400 : 200
      const title = status === 200 ? 'Authentication complete' : 'Authentication failed'
      const message =
        status === 200 ? 'You can return to the terminal.' : 'You can close this window.'
      res.statusCode = status
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(`<html><body><h3>${title}</h3><p>${message}</p></body></html>`)

      clearTimeout(timer)
      server.close()

      if (data.error) {
        reject(
          new Error(
            `OAuth provider returned error: ${data.error}${data.errorDescription ? ` - ${data.errorDescription}` : ''}`,
          ),
        )
        return
      }
      if (!isStateValid) {
        reject(new Error('OAuth state validation failed.'))
        return
      }
      if (!data.code) {
        reject(new Error('OAuth provider did not return an authorization code.'))
        return
      }
      resolve({ code: data.code, redirectUri })
    })

    const timer = setTimeout(() => {
      server.close()
      reject(new Error(`OAuth login timed out after ${timeoutMs}ms.`))
    }, timeoutMs)

    server.listen(CLI_OAUTH_LOOPBACK_PORT, 'localhost')
  })
}

export const getCachedProviderOauthCredentials = async (
  taskyon: Pick<Taskyon, 'getSecret' | 'setSecret'>,
  storage: CliOauthStorage,
  providerName: string,
): Promise<null | ReturnType<typeof OAuthCredentials.parse>> => {
  const secretName = getProviderOauthCredentialsSecretName(providerName)
  const raw = await taskyon.getSecret(storage.secretId, secretName, false, false)
  if (raw) {
    try {
      return OAuthCredentials.parse(JSON.parse(raw))
    } catch {
      // keep going and try file-based cache
    }
  }

  const persistedState = await readPersistedAuthState(storage, providerName)
  if (!persistedState.credentials) return null
  try {
    return OAuthCredentials.parse(persistedState.credentials)
  } catch {
    return null
  }
}

export const setCachedProviderOauthCredentials = async (
  taskyon: Pick<Taskyon, 'getSecret' | 'setSecret'>,
  storage: CliOauthStorage,
  providerName: string,
  credentials: ReturnType<typeof OAuthCredentials.parse>,
) => {
  const secretName = getProviderOauthCredentialsSecretName(providerName)
  await taskyon.setSecret(storage.secretId, secretName, JSON.stringify(credentials))
  await writePersistedAuthState(storage, providerName, { credentials })
}

export async function resolveCachedProviderOauthCredentials({
  providerName,
  api,
  taskyon,
  storage,
}: {
  providerName: string
  api: ProviderEndpointConfig
  taskyon: Pick<Taskyon, 'getSecret' | 'setSecret'>
  storage: CliOauthStorage
}): Promise<null | ReturnType<typeof OAuthCredentials.parse>> {
  const oauth = getProviderOauthConfig(api)
  if (!oauth?.tokenUrl) return null

  const cached = await getCachedProviderOauthCredentials(taskyon, storage, providerName)
  if (!cached) return null

  let validCredentials = cached

  if (isIdTokenExpired(validCredentials) && validCredentials.refresh_token) {
    try {
      const refreshedForIdToken = await refreshAccessToken(
        validCredentials,
        oauth.tokenUrl,
        oauth.clientId,
      )
      validCredentials = refreshedForIdToken
      await setCachedProviderOauthCredentials(taskyon, storage, providerName, refreshedForIdToken)
    } catch {
      return null
    }
  }

  const refreshed = await useRefreshTokenIfExpired(validCredentials, {
    tokenUrl: oauth.tokenUrl,
    clientId: oauth.clientId,
  })
  if (!refreshed) return null
  validCredentials = refreshed
  if (refreshed) await setCachedProviderOauthCredentials(taskyon, storage, providerName, refreshed)
  return validCredentials
}

export const runAuthorizationCodeFlow = async ({
  oauth,
  timeoutMs,
  authorizeQuery,
}: {
  oauth: ProviderOauthConfig
  timeoutMs: number
  authorizeQuery?: Record<string, string>
}) => {
  if (!oauth.tokenUrl) {
    throw new Error('OAuth authorization code flow requires a token URL.')
  }
  const { verifier, challenge } = await generatePKCE()
  const state = crypto.randomUUID()
  const redirectUri = CLI_OAUTH_REDIRECT_URI
  const authorizeUrl = createOauthAuthorizationUrl({
    ...oauth,
    redirectUri,
    state,
    challenge,
    authorizeQuery: { ...oauth.authorizeQuery, ...authorizeQuery },
  })
  const serverWait = waitForAuthCode(state, timeoutMs, redirectUri)
  process.stdout.write(
    [
      'Open this URL in your browser to continue login:',
      authorizeUrl,
      '',
      `After sign-in, the provider should redirect back to ${redirectUri}.`,
      'Keep this terminal open while the callback completes.',
      '',
    ].join('\n'),
  )

  const { code } = await serverWait
  return await exchangeOauthCode({
    tokenUrl: oauth.tokenUrl,
    clientId: oauth.clientId,
    code,
    verifier,
    redirectUri,
  })
}

export async function loginWithProviderOauthCli({
  providerName,
  api,
  taskyon,
  storage,
  forceReauth = false,
  timeoutMs = 5 * 60 * 1000,
  authorizeQuery,
}: {
  providerName: string
  api: ProviderEndpointConfig
  taskyon: Pick<Taskyon, 'getSecret' | 'setSecret'>
  storage: CliOauthStorage
  forceReauth?: boolean
  timeoutMs?: number
  authorizeQuery?: Record<string, string>
}): Promise<ReturnType<typeof OAuthCredentials.parse>> {
  const oauth = getProviderOauthConfig(api)
  if (!oauth) {
    throw new Error(
      `OAuth is not configured for provider profile "${providerName}". Add auth.oauth settings to its chatCompletion configuration.`,
    )
  }
  if (!oauth.tokenUrl) {
    throw new Error(`Provider "${providerName}" is missing auth.oauth.tokenUrl.`)
  }
  if (!forceReauth) {
    const cachedCredentials = await resolveCachedProviderOauthCredentials({
      providerName,
      api,
      taskyon,
      storage,
    })
    if (cachedCredentials) return cachedCredentials
  }

  const credentials = await runAuthorizationCodeFlow({
    oauth,
    timeoutMs,
    ...(authorizeQuery ? { authorizeQuery } : {}),
  })
  await setCachedProviderOauthCredentials(taskyon, storage, providerName, credentials)
  return credentials
}
