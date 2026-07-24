import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import process from 'node:process'
import type { Taskyon } from '../../taskyon/src/core/init'
import type { ProviderEndpointConfig } from '../../taskyon/src/types/chatCompletion'
import {
  type ProviderOauthConfig,
  getProviderOauthConfig,
  getProviderOauthCredentialsSecretName,
  resolveProviderAccessToken,
} from '../../taskyon/src/utils/providerAuth'
import {
  OAuthCredentials,
  refreshAccessToken,
  useRefreshTokenIfExpired,
} from '../../taskyon/src/utils/oauth'

const CLI_OAUTH_SECRET_ID = 'taskyon-cli:oauth'
const CLI_AUTH_DIR = join(homedir(), '.taskyon-cli', 'auth')
const CODEX_LOOPBACK_PORT = 1455
const CODEX_LOOPBACK_REDIRECT_URI = `http://localhost:${CODEX_LOOPBACK_PORT}/auth/callback`
const CODEX_DEFAULT_ORIGINATOR = 'codex_cli'

const base64Url = (data: Buffer): string =>
  data.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const createPkce = () => {
  const verifier = base64Url(randomBytes(64))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

const parseCallbackUrl = (rawUrl: string) => {
  const url = new URL(rawUrl, 'http://127.0.0.1')
  const error = url.searchParams.get('error')
  const errorDescription = url.searchParams.get('error_description')
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  return { error, errorDescription, code, state }
}

const formatUnknownError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
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

const getOpenAiAuthClaims = (idToken: string): Record<string, unknown> => {
  const payload = parseJwtPayload(idToken)
  if (!payload) return {}
  const claims = payload['https://api.openai.com/auth']
  if (!claims || typeof claims !== 'object') return {}
  return claims as Record<string, unknown>
}

type WorkspaceCandidate = {
  id: string
  label: string
  metadata: string[]
}

type PersistedAuthState = {
  credentials?: unknown
  accountId?: string
  preferredWorkspaceId?: string
}

const workspacePreferenceSecretName = (providerName: string) =>
  `oauth:workspace:preference:${providerName}`
const accountIdSecretName = (providerName: string) => `oauth:account-id:${providerName}`
const providerAuthFilePath = (providerName: string): string => {
  const safeProviderName = providerName.replace(/[^a-zA-Z0-9._-]/g, '_')
  return join(CLI_AUTH_DIR, `${safeProviderName}.json`)
}

const readPersistedAuthState = async (providerName: string): Promise<PersistedAuthState> => {
  try {
    const raw = await readFile(providerAuthFilePath(providerName), 'utf8')
    const parsed = JSON.parse(raw) as PersistedAuthState
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const writePersistedAuthState = async (
  providerName: string,
  patch: Partial<PersistedAuthState>,
) => {
  const currentState = await readPersistedAuthState(providerName)
  const nextState: PersistedAuthState = { ...currentState, ...patch }
  try {
    await mkdir(CLI_AUTH_DIR, { recursive: true })
    await writeFile(providerAuthFilePath(providerName), JSON.stringify(nextState, null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    })
  } catch {
    // The Taskyon secret store is the real runtime source of truth. The sidecar
    // file cache is only a convenience layer and should never block CLI flows.
  }
}

const isMissingOrganizationContextError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    (message.includes('invalid_subject_token') && message.includes('organization_id')) ||
    message.includes('missing organization_id')
  )
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

const readPreferredWorkspaceId = async (
  taskyon: Taskyon,
  providerName: string,
): Promise<string | undefined> => {
  const raw = await taskyon.getSecret(
    CLI_OAUTH_SECRET_ID,
    workspacePreferenceSecretName(providerName),
    false,
    false,
  )
  const secretValue = raw?.trim()
  if (secretValue) return secretValue

  const persistedState = await readPersistedAuthState(providerName)
  const fileValue = persistedState.preferredWorkspaceId?.trim()
  return fileValue || undefined
}

const writePreferredWorkspaceId = async (
  taskyon: Taskyon,
  providerName: string,
  workspaceId: string,
) => {
  await taskyon.setSecret(
    CLI_OAUTH_SECRET_ID,
    workspacePreferenceSecretName(providerName),
    workspaceId,
  )
  await writePersistedAuthState(providerName, { preferredWorkspaceId: workspaceId })
}

const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const getOpenAiAccountIdFromClaims = (claims: Record<string, unknown>): string | undefined => {
  const nested = claims['https://api.openai.com/auth']
  const nestedClaims =
    nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : undefined
  const organizations = claims.organizations

  if (asNonEmptyString(claims.chatgpt_account_id))
    return asNonEmptyString(claims.chatgpt_account_id)
  if (nestedClaims && asNonEmptyString(nestedClaims.chatgpt_account_id)) {
    return asNonEmptyString(nestedClaims.chatgpt_account_id)
  }
  if (Array.isArray(organizations)) {
    for (const entry of organizations) {
      if (typeof entry === 'string' && entry.trim()) return entry.trim()
      if (!entry || typeof entry !== 'object') continue
      const record = entry as Record<string, unknown>
      const organizationId =
        asNonEmptyString(record.id) ??
        asNonEmptyString(record.organization_id) ??
        asNonEmptyString(record.workspace_id) ??
        asNonEmptyString(record.chatgpt_account_id)
      if (organizationId) return organizationId
    }
  }
  return undefined
}

const getOpenAiAccountIdFromCredentials = (
  credentials: ReturnType<typeof OAuthCredentials.parse>,
): string | undefined => {
  if (credentials.id_token) {
    const idTokenClaims = getOpenAiAuthClaims(credentials.id_token)
    const accountId = getOpenAiAccountIdFromClaims(idTokenClaims)
    if (accountId) return accountId
  }
  if (credentials.access_token) {
    const accessTokenClaims = parseJwtPayload(credentials.access_token) ?? {}
    const accountId = getOpenAiAccountIdFromClaims(accessTokenClaims)
    if (accountId) return accountId
  }
  return undefined
}

export const readProviderOauthAccountId = async (
  taskyon: Taskyon,
  providerName: string,
): Promise<string | undefined> => {
  const raw = await taskyon.getSecret(
    CLI_OAUTH_SECRET_ID,
    accountIdSecretName(providerName),
    false,
    false,
  )
  const secretValue = raw?.trim()
  if (secretValue) return secretValue

  const persistedState = await readPersistedAuthState(providerName)
  const fileValue = persistedState.accountId?.trim()
  return fileValue || undefined
}

const writeProviderOauthAccountId = async (
  taskyon: Taskyon,
  providerName: string,
  accountId: string,
) => {
  await taskyon.setSecret(CLI_OAUTH_SECRET_ID, accountIdSecretName(providerName), accountId)
  await writePersistedAuthState(providerName, { accountId })
}

const getWorkspaceCandidatesFromClaims = (
  claims: Record<string, unknown>,
): WorkspaceCandidate[] => {
  const out: WorkspaceCandidate[] = []
  const add = (idRaw: unknown, record?: Record<string, unknown>) => {
    const id = asNonEmptyString(idRaw)
    if (!id) return

    const name =
      asNonEmptyString(record?.name) ??
      asNonEmptyString(record?.display_name) ??
      asNonEmptyString(record?.title)
    const slug = asNonEmptyString(record?.slug)
    const role = asNonEmptyString(record?.role)
    const isOwner = record?.is_org_owner === true
    const type =
      asNonEmptyString(record?.type) ??
      (id.startsWith('org-') ? 'organization' : id.includes('-') ? 'workspace' : undefined)

    const metadata = [
      type ? `type:${type}` : '',
      slug ? `slug:${slug}` : '',
      role ? `role:${role}` : '',
      isOwner ? 'owner' : '',
    ].filter(Boolean)

    const labelBase = name ?? id
    const label = labelBase === id ? `${id}` : `${labelBase} (${id})`

    const existing = out.find((entry) => entry.id === id)
    if (existing) {
      const mergedMetadata = new Set([...existing.metadata, ...metadata])
      existing.metadata = [...mergedMetadata]
      if (existing.label === existing.id && label !== id) existing.label = label
      return
    }
    out.push({ id, label, metadata })
  }

  add(claims.organization_id, claims)
  const organizations = claims.organizations
  if (Array.isArray(organizations)) {
    for (const entry of organizations) {
      if (typeof entry === 'string') {
        add(entry, { type: 'organization' })
        continue
      }
      if (!entry || typeof entry !== 'object') continue
      const rec = entry as Record<string, unknown>
      add(rec.organization_id ?? rec.id ?? rec.workspace_id ?? rec.chatgpt_account_id, rec)
    }
  }
  add(claims.chatgpt_account_id, {
    name: claims.chatgpt_account_name,
    type: 'workspace',
  })
  const score = (candidate: WorkspaceCandidate): number => {
    const typeTag = candidate.metadata.find((item) => item.startsWith('type:'))
    if (typeTag === 'type:workspace') return 0
    if (typeTag === 'type:organization') return 1
    return 2
  }
  return [...out].sort((a, b) => score(a) - score(b) || a.label.localeCompare(b.label))
}

const chooseWorkspaceInteractive = async (
  candidates: WorkspaceCandidate[],
): Promise<string | undefined> => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]?.id

  process.stdout.write('Select ChatGPT workspace for Codex login:\n')
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    if (!candidate) continue
    const metadata = candidate.metadata.length > 0 ? ` [${candidate.metadata.join(', ')}]` : ''
    process.stdout.write(`  ${index + 1}. ${candidate.label}${metadata}\n`)
  }
  process.stdout.write('  0. cancel\n')

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const workspaceCandidateIds = candidates
      .filter((candidate) => candidate.metadata.includes('type:workspace'))
      .map((candidate) => candidate.id)
    while (true) {
      const answer = (await rl.question('Workspace number: ')).trim()
      if (answer === '0') return undefined
      const selected = Number.parseInt(answer, 10)
      if (!Number.isInteger(selected) || selected < 1 || selected > candidates.length) {
        process.stdout.write('Invalid selection. Please enter a listed number.\n')
        continue
      }
      const selectedCandidate = candidates[selected - 1]
      if (!selectedCandidate) continue
      if (
        selectedCandidate.metadata.includes('type:organization') &&
        workspaceCandidateIds.length === 1 &&
        workspaceCandidateIds[0]
      ) {
        process.stdout.write(
          `Organization selected; using workspace ${workspaceCandidateIds[0]} for OAuth.\n`,
        )
        return workspaceCandidateIds[0]
      }
      return selectedCandidate.id
    }
  } finally {
    rl.close()
  }
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

    server.listen(CODEX_LOOPBACK_PORT, 'localhost')
  })
}

const exchangeCodeForCredentials = async ({
  tokenUrl,
  clientId,
  code,
  verifier,
  redirectUri,
}: {
  tokenUrl: string
  clientId: string
  code: string
  verifier: string
  redirectUri: string
}) => {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })

  let response: Response
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch (error) {
    const details =
      error instanceof Error
        ? `${error.message}${error.cause ? ` (cause: ${formatUnknownError(error.cause)})` : ''}`
        : formatUnknownError(error)
    throw new Error(`OAuth token request failed before receiving a response: ${details}`)
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `OAuth token exchange failed (${response.status} ${response.statusText})${text ? `: ${text}` : ''}`,
    )
  }

  const data = await response.json()
  if (data?.error) {
    throw new Error(
      `OAuth token exchange error: ${String(data.error)}${data.error_description ? ` - ${String(data.error_description)}` : ''}`,
    )
  }

  try {
    return OAuthCredentials.parse({
      ...data,
      type: 'oauth-credentials',
      service: tokenUrl,
      created_at: Date.now(),
    })
  } catch (error) {
    throw new Error(
      `OAuth credentials parsing failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const getCachedCredentials = async (
  taskyon: Taskyon,
  providerName: string,
): Promise<null | ReturnType<typeof OAuthCredentials.parse>> => {
  const secretName = getProviderOauthCredentialsSecretName(providerName)
  const raw = await taskyon.getSecret(CLI_OAUTH_SECRET_ID, secretName, false, false)
  if (raw) {
    try {
      return OAuthCredentials.parse(JSON.parse(raw))
    } catch {
      // keep going and try file-based cache
    }
  }

  const persistedState = await readPersistedAuthState(providerName)
  if (!persistedState.credentials) return null
  try {
    return OAuthCredentials.parse(persistedState.credentials)
  } catch {
    return null
  }
}

const setCachedCredentials = async (
  taskyon: Taskyon,
  providerName: string,
  credentials: ReturnType<typeof OAuthCredentials.parse>,
) => {
  const secretName = getProviderOauthCredentialsSecretName(providerName)
  await taskyon.setSecret(CLI_OAUTH_SECRET_ID, secretName, JSON.stringify(credentials))
  await writePersistedAuthState(providerName, { credentials })
}

export async function resolveCachedProviderOauthSession({
  providerName,
  api,
  taskyon,
}: {
  providerName: string
  api: ProviderEndpointConfig
  taskyon: Taskyon
}): Promise<null | { accessToken: string; accountId?: string }> {
  const oauth = getProviderOauthConfig(api)
  if (!oauth?.tokenUrl) return null

  const cached = await getCachedCredentials(taskyon, providerName)
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
      await setCachedCredentials(taskyon, providerName, refreshedForIdToken)
    } catch {
      return null
    }
  }

  const refreshed = await useRefreshTokenIfExpired(validCredentials, {
    tokenUrl: oauth.tokenUrl,
    clientId: oauth.clientId,
  })
  validCredentials = refreshed ?? validCredentials
  if (refreshed) await setCachedCredentials(taskyon, providerName, refreshed)

  if (providerName === 'chatgpt-codex') {
    const accountId =
      getOpenAiAccountIdFromCredentials(validCredentials) ??
      (await readProviderOauthAccountId(taskyon, providerName))
    if (accountId) await writeProviderOauthAccountId(taskyon, providerName, accountId)
    return { accessToken: validCredentials.access_token, ...(accountId ? { accountId } : {}) }
  }

  try {
    const accessToken = await resolveProviderAccessToken(validCredentials, api)
    return { accessToken }
  } catch {
    return null
  }
}

const hasOrganizationIdClaim = (claims: Record<string, unknown>): boolean =>
  typeof claims.organization_id === 'string' && claims.organization_id.trim().length > 0

const runAuthorizationCodeFlow = async ({
  oauth,
  timeoutMs,
  forcedWorkspaceId,
}: {
  oauth: ProviderOauthConfig
  timeoutMs: number
  forcedWorkspaceId?: string
}) => {
  const { verifier, challenge } = createPkce()
  const state = base64Url(randomBytes(24))
  const redirectUri = CODEX_LOOPBACK_REDIRECT_URI
  const serverWait = waitForAuthCode(state, timeoutMs, redirectUri)

  const query = new URLSearchParams({
    client_id: oauth.clientId,
    redirect_uri: redirectUri,
    scope: oauth.scope,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  })
  if (oauth.authorizeQuery) {
    for (const [key, value] of Object.entries(oauth.authorizeQuery)) query.set(key, value)
  }
  if (!query.has('originator')) query.set('originator', CODEX_DEFAULT_ORIGINATOR)
  if (forcedWorkspaceId && !query.has('allowed_workspace_id')) {
    query.set('allowed_workspace_id', forcedWorkspaceId)
  }

  const authorizeUrl = `${oauth.oauthURL}?${query.toString()}`
  process.stdout.write(
    [
      'Open this URL in your browser to continue login:',
      authorizeUrl,
      '',
      `After sign-in, OpenAI should redirect back to ${redirectUri}.`,
      'Keep this terminal open while the callback completes.',
      '',
    ].join('\n'),
  )

  const { code } = await serverWait
  return await exchangeCodeForCredentials({
    tokenUrl: oauth.tokenUrl!,
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
  forceReauth = false,
  timeoutMs = 5 * 60 * 1000,
}: {
  providerName: string
  api: ProviderEndpointConfig
  taskyon: Taskyon
  forceReauth?: boolean
  timeoutMs?: number
}): Promise<{ accessToken: string; accountId?: string }> {
  const oauth = getProviderOauthConfig(api)
  if (!oauth) {
    throw new Error(
      `OAuth is not configured for provider profile "${providerName}". Add auth.oauth settings to its chatCompletion configuration.`,
    )
  }
  if (!oauth.tokenUrl) {
    throw new Error(`Provider "${providerName}" is missing auth.oauth.tokenUrl.`)
  }
  const isChatgptCodex = providerName === 'chatgpt-codex'
  const envWorkspaceId = process.env.TASKYON_CHATGPT_WORKSPACE_ID
  const preferredWorkspaceId = await readPreferredWorkspaceId(taskyon, providerName)
  const initialWorkspaceId = envWorkspaceId || preferredWorkspaceId

  if (!forceReauth) {
    const cachedSession = await resolveCachedProviderOauthSession({
      providerName,
      api,
      taskyon,
    })
    if (cachedSession) return cachedSession
  }

  if (isChatgptCodex) {
    const credentials = await runAuthorizationCodeFlow({
      oauth,
      timeoutMs,
    })
    await setCachedCredentials(taskyon, providerName, credentials)
    const accountId = getOpenAiAccountIdFromCredentials(credentials)
    if (accountId) await writeProviderOauthAccountId(taskyon, providerName, accountId)
    return { accessToken: credentials.access_token, ...(accountId ? { accountId } : {}) }
  }

  if (initialWorkspaceId && !envWorkspaceId) {
    process.stdout.write(`Using saved workspace preference: ${initialWorkspaceId}\n`)
  }
  const credentials = await runAuthorizationCodeFlow(
    initialWorkspaceId
      ? {
          oauth,
          timeoutMs,
          forcedWorkspaceId: initialWorkspaceId,
        }
      : {
          oauth,
          timeoutMs,
        },
  )
  // Persist intermediate credentials immediately so subsequent attempts can reuse
  // the freshly acquired token even if workspace selection/retry is interrupted.
  await setCachedCredentials(taskyon, providerName, credentials)
  const claims = getOpenAiAuthClaims(credentials.id_token ?? '')

  if (typeof claims['chatgpt_account_id'] === 'string' && claims['chatgpt_account_id'].trim()) {
    await writePreferredWorkspaceId(taskyon, providerName, claims['chatgpt_account_id'].trim())
  }
  if (!hasOrganizationIdClaim(claims) && !initialWorkspaceId) {
    const workspaceCandidates = getWorkspaceCandidatesFromClaims(claims)
    const selectedWorkspace = await chooseWorkspaceInteractive(workspaceCandidates)
    if (selectedWorkspace) {
      await writePreferredWorkspaceId(taskyon, providerName, selectedWorkspace)
      process.stdout.write(`Saved workspace preference: ${selectedWorkspace}\n`)
    }
  }
  await setCachedCredentials(taskyon, providerName, credentials)
  try {
    const accessToken = await resolveProviderAccessToken(credentials, api)
    return { accessToken }
  } catch (error) {
    if (!isMissingOrganizationContextError(error)) throw error
    process.stdout.write(
      `Token exchange failed due to organization context; reusing OAuth access token from login.\n`,
    )
    return { accessToken: credentials.access_token }
  }
}
