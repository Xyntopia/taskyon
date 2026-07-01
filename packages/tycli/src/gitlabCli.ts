import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { OAUTH_PROVIDERS } from '../../taskyon/src/utils/oauth'
import { resolveConfigDirectoryPath } from './cli/config'

const DEFAULT_GITLAB_BASE_URL = 'https://gitlab.com'
const DEFAULT_SCOPE = 'api'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

export type GitlabAuthState = {
  accessToken: string
  baseUrl: string
  clientId: string
  createdAt: string
  tokenType?: string
  scope?: string
  expiresAt?: string
  refreshToken?: string
}

export type GitlabLoginOptions = {
  baseUrl?: string
  clientId?: string
  scope?: string
  force?: boolean
  fetchFn?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  openBrowser?: (url: string) => void
  writeOutput?: (text: string) => void
}

type GitlabDeviceAuthorization = {
  deviceCode: string
  userCode: string
  verificationUri: string
  verificationUriComplete?: string
  expiresIn: number
  interval: number
}

type GitlabAccessTokenResult =
  | {
      ok: true
      accessToken: string
      tokenType?: string
      scope?: string
      expiresIn?: number
      createdAt?: number
      refreshToken?: string
    }
  | {
      ok: false
      error: string
      description?: string
    }

const normalizeBaseUrl = (baseUrl?: string): string => {
  const raw = baseUrl?.trim() || DEFAULT_GITLAB_BASE_URL
  return raw.replace(/\/+$/, '')
}

const gitlabHostKey = (baseUrl: string): string => {
  try {
    const url = new URL(baseUrl)
    return `${url.host}${url.pathname}`.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  } catch {
    return baseUrl.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '')
  }
}

const authFilePath = async (baseUrl: string) =>
  join(await resolveConfigDirectoryPath(), `gitlab-auth-${gitlabHostKey(baseUrl)}.json`)

const gitlabClientId = (clientId?: string): string =>
  clientId?.trim() ||
  process.env.TASKYON_GITLAB_CLIENT_ID?.trim() ||
  process.env.GITLAB_CLIENT_ID?.trim() ||
  OAUTH_PROVIDERS.gitlab.clientId

const sleepDefault = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const openBrowserDefault = (url: string) => {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  })
  child.on('error', () => {
    // The terminal output already includes the URL and code; browser opening is best-effort.
  })
  child.unref()
}

const readOptionalString = (record: Record<string, unknown>, key: string): string | undefined => {
  const value = record[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

const readOptionalNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const parseDeviceAuthorization = (data: unknown): GitlabDeviceAuthorization => {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const deviceCode = readOptionalString(record, 'device_code')
  const userCode = readOptionalString(record, 'user_code')
  const verificationUri = readOptionalString(record, 'verification_uri')
  const verificationUriComplete = readOptionalString(record, 'verification_uri_complete')
  const expiresIn = readOptionalNumber(record, 'expires_in')
  const interval = readOptionalNumber(record, 'interval')
  if (!deviceCode || !userCode || !verificationUri || !expiresIn) {
    throw new Error(`Unexpected GitLab device authorization response: ${JSON.stringify(data)}`)
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    ...(verificationUriComplete ? { verificationUriComplete } : {}),
    expiresIn,
    interval: interval && interval > 0 ? interval : 5,
  }
}

const parseAccessToken = (data: unknown): GitlabAccessTokenResult => {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const error = readOptionalString(record, 'error')
  if (error) {
    const description = readOptionalString(record, 'error_description')
    return {
      ok: false,
      error,
      ...(description ? { description } : {}),
    }
  }
  const accessToken = readOptionalString(record, 'access_token')
  if (!accessToken) {
    throw new Error(`Unexpected GitLab token response: ${JSON.stringify(data)}`)
  }
  const tokenType = readOptionalString(record, 'token_type')
  const scope = readOptionalString(record, 'scope')
  const expiresIn = readOptionalNumber(record, 'expires_in')
  const createdAt = readOptionalNumber(record, 'created_at')
  const refreshToken = readOptionalString(record, 'refresh_token')
  return {
    ok: true,
    accessToken,
    ...(tokenType ? { tokenType } : {}),
    ...(scope ? { scope } : {}),
    ...(expiresIn ? { expiresIn } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(refreshToken ? { refreshToken } : {}),
  }
}

const postGitlabForm = async (
  fetchFn: typeof fetch,
  url: string,
  body: URLSearchParams,
): Promise<unknown> => {
  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  const data = await response.json().catch(() => null)
  if (
    !response.ok &&
    !(
      data &&
      typeof data === 'object' &&
      typeof (data as Record<string, unknown>).error === 'string'
    )
  ) {
    throw new Error(`GitLab OAuth request failed (${response.status}): ${JSON.stringify(data)}`)
  }
  return data
}

const tokenExpiry = (token: Extract<GitlabAccessTokenResult, { ok: true }>): string | undefined => {
  if (!token.expiresIn) return undefined
  const createdAtMs = token.createdAt ? token.createdAt * 1000 : Date.now()
  return new Date(createdAtMs + token.expiresIn * 1000).toISOString()
}

const isAuthExpired = (state: GitlabAuthState, bufferMs = 60_000): boolean => {
  if (!state.expiresAt) return false
  return Date.now() + bufferMs >= new Date(state.expiresAt).getTime()
}

export const readGitlabAuthState = async (
  baseUrl = DEFAULT_GITLAB_BASE_URL,
): Promise<GitlabAuthState | null> => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  try {
    const raw = await readFile(await authFilePath(normalizedBaseUrl), 'utf8')
    const parsed = JSON.parse(raw) as Partial<GitlabAuthState>
    if (typeof parsed.accessToken !== 'string' || parsed.accessToken.trim().length === 0) {
      return null
    }
    return {
      accessToken: parsed.accessToken,
      baseUrl:
        typeof parsed.baseUrl === 'string' ? normalizeBaseUrl(parsed.baseUrl) : normalizedBaseUrl,
      clientId: typeof parsed.clientId === 'string' ? parsed.clientId : '',
      createdAt:
        typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString(),
      ...(typeof parsed.tokenType === 'string' ? { tokenType: parsed.tokenType } : {}),
      ...(typeof parsed.scope === 'string' ? { scope: parsed.scope } : {}),
      ...(typeof parsed.expiresAt === 'string' ? { expiresAt: parsed.expiresAt } : {}),
      ...(typeof parsed.refreshToken === 'string' ? { refreshToken: parsed.refreshToken } : {}),
    }
  } catch {
    return null
  }
}

const writeGitlabAuthState = async (state: GitlabAuthState) => {
  const filePath = await authFilePath(state.baseUrl)
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

const refreshGitlabAuthState = async (
  state: GitlabAuthState,
  fetchFn: typeof fetch,
): Promise<GitlabAuthState | null> => {
  if (!state.refreshToken) return null
  const token = parseAccessToken(
    await postGitlabForm(
      fetchFn,
      `${state.baseUrl}/oauth/token`,
      new URLSearchParams({
        client_id: state.clientId,
        refresh_token: state.refreshToken,
        grant_type: 'refresh_token',
      }),
    ),
  )
  if (!token.ok) return null
  const expiresAt = tokenExpiry(token)
  const nextState: GitlabAuthState = {
    accessToken: token.accessToken,
    baseUrl: state.baseUrl,
    clientId: state.clientId,
    createdAt: new Date().toISOString(),
    ...(token.tokenType ? { tokenType: token.tokenType } : {}),
    ...(token.scope ? { scope: token.scope } : state.scope ? { scope: state.scope } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(token.refreshToken
      ? { refreshToken: token.refreshToken }
      : state.refreshToken
        ? { refreshToken: state.refreshToken }
        : {}),
  }
  await writeGitlabAuthState(nextState)
  return nextState
}

export const loginGitlab = async (options: GitlabLoginOptions = {}): Promise<GitlabAuthState> => {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const clientId = gitlabClientId(options.clientId)
  const fetchFn = options.fetchFn ?? fetch
  const sleep = options.sleep ?? sleepDefault
  const openBrowser = options.openBrowser ?? openBrowserDefault
  const writeOutput = options.writeOutput ?? ((text: string) => process.stdout.write(text))

  const cached = await readGitlabAuthState(baseUrl)
  if (cached && cached.clientId === clientId && options.force !== true) {
    if (!isAuthExpired(cached)) return cached
    const refreshed = await refreshGitlabAuthState(cached, fetchFn).catch(() => null)
    if (refreshed) return refreshed
  }

  const scope = options.scope?.trim() || DEFAULT_SCOPE
  const device = parseDeviceAuthorization(
    await postGitlabForm(
      fetchFn,
      `${baseUrl}/oauth/authorize_device`,
      new URLSearchParams({
        client_id: clientId,
        scope,
      }),
    ),
  )
  const loginUrl = device.verificationUriComplete ?? device.verificationUri
  writeOutput(
    ['GitLab login required.', `Open: ${loginUrl}`, `Enter code: ${device.userCode}`, ''].join(
      '\n',
    ),
  )
  try {
    openBrowser(loginUrl)
  } catch (error) {
    writeOutput(
      `Could not open browser automatically: ${error instanceof Error ? error.message : String(error)}\n`,
    )
  }

  const deadline = Date.now() + device.expiresIn * 1000
  let intervalMs = device.interval * 1000
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    const token = parseAccessToken(
      await postGitlabForm(
        fetchFn,
        `${baseUrl}/oauth/token`,
        new URLSearchParams({
          client_id: clientId,
          device_code: device.deviceCode,
          grant_type: DEVICE_GRANT,
        }),
      ),
    )
    if (token.ok) {
      const expiresAt = tokenExpiry(token)
      const state: GitlabAuthState = {
        accessToken: token.accessToken,
        baseUrl,
        clientId,
        createdAt: new Date().toISOString(),
        ...(token.tokenType ? { tokenType: token.tokenType } : {}),
        ...(token.scope ? { scope: token.scope } : { scope }),
        ...(expiresAt ? { expiresAt } : {}),
        ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
      }
      await writeGitlabAuthState(state)
      return state
    }
    if (token.error === 'authorization_pending') continue
    if (token.error === 'slow_down') {
      intervalMs += 5_000
      continue
    }
    throw new Error(
      `GitLab OAuth failed: ${token.error}${token.description ? ` - ${token.description}` : ''}`,
    )
  }
  throw new Error('GitLab OAuth device code expired before login completed.')
}

export const requireGitlabAuth = async (
  options: GitlabLoginOptions = {},
): Promise<GitlabAuthState> => {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const clientId = gitlabClientId(options.clientId)
  const cached = await readGitlabAuthState(baseUrl)
  if (cached && cached.clientId === clientId && options.force !== true && !isAuthExpired(cached)) {
    return cached
  }
  return await loginGitlab(options)
}
