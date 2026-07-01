import './node-shims'

import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { resolveConfigDirectoryPath } from './cli/config'

const GITHUB_API = 'https://api.github.com'
const GITHUB_DEVICE_CODE_URL = 'https://github.com/login/device/code'
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token'
const DEFAULT_SCOPE = 'repo read:user'
const DEFAULT_GITHUB_CLIENT_ID = 'dde1b4f838875dba5671'

export type GithubAuthState = {
  accessToken: string
  tokenType?: string
  scope?: string
  createdAt: string
}

export type ParsedArgs = {
  command: string
  positionals: string[]
  flags: Record<string, string[]>
}

type GithubIssueDraft = {
  title: string
  body?: string
  labels?: string[]
}

const usage = `Usage:
  yarn tycli:github login [--client-id <id>] [--scope <scope>] [--force]
  yarn tycli:github auth-status
  yarn tycli:github repos [--query <text>]
  yarn tycli:github issues <owner/repo> [--state open|closed|all]
  yarn tycli:github create-issues <owner/repo> --title <title> [--title <title>...] [--file <path>] [--label <label>] [--dry-run]

Environment:
  TASKYON_GITHUB_CLIENT_ID or GITHUB_CLIENT_ID can override Taskyon's default
  public GitHub OAuth app client id.

Issue file format:
  One issue per non-empty line. Use "Title :: body text" to add a body.`

const parseArgs = (argv: string[]): ParsedArgs => {
  const [command = 'help', ...rest] = argv
  const flags: Record<string, string[]> = {}
  const positionals: string[] = []

  for (let index = 0; index < rest.length; index += 1) {
    const item = rest[index]
    if (!item?.startsWith('--')) {
      if (item) positionals.push(item)
      continue
    }

    const flag = item.slice(2)
    const next = rest[index + 1]
    if (!next || next.startsWith('--')) {
      flags[flag] = [...(flags[flag] ?? []), 'true']
      continue
    }
    flags[flag] = [...(flags[flag] ?? []), next]
    index += 1
  }

  return { command, positionals, flags }
}

const firstFlag = (args: ParsedArgs, name: string): string | undefined =>
  args.flags[name]?.find((value) => value.trim().length > 0)?.trim()

const hasFlag = (args: ParsedArgs, name: string): boolean =>
  args.flags[name]?.includes('true') ?? false

const readTextFile = async (path: string): Promise<string> => await readFile(path, 'utf8')

const authFilePath = async () => join(await resolveConfigDirectoryPath(), 'github-auth.json')

export const readAuthState = async (): Promise<GithubAuthState | null> => {
  try {
    const raw = await readFile(await authFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<GithubAuthState>
    if (typeof parsed.accessToken !== 'string' || parsed.accessToken.trim().length === 0) {
      return null
    }
    return {
      accessToken: parsed.accessToken,
      ...(typeof parsed.tokenType === 'string' ? { tokenType: parsed.tokenType } : {}),
      ...(typeof parsed.scope === 'string' ? { scope: parsed.scope } : {}),
      createdAt:
        typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString(),
    }
  } catch {
    return null
  }
}

const writeAuthState = async (state: GithubAuthState) => {
  const filePath = await authFilePath()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
}

const clientIdFromArgs = (args: ParsedArgs): string => {
  const clientId =
    firstFlag(args, 'client-id') ??
    process.env.TASKYON_GITHUB_CLIENT_ID?.trim() ??
    process.env.GITHUB_CLIENT_ID?.trim() ??
    DEFAULT_GITHUB_CLIENT_ID
  return clientId
}

const openBrowser = (url: string) => {
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

const parseDeviceCodeResponse = (data: unknown) => {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const deviceCode = record.device_code
  const userCode = record.user_code
  const verificationUri = record.verification_uri
  const expiresIn = record.expires_in
  const interval = record.interval
  if (
    typeof deviceCode !== 'string' ||
    typeof userCode !== 'string' ||
    typeof verificationUri !== 'string' ||
    typeof expiresIn !== 'number'
  ) {
    throw new Error(`Unexpected GitHub device-code response: ${JSON.stringify(data)}`)
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresIn,
    interval: typeof interval === 'number' && interval > 0 ? interval : 5,
  }
}

const parseAccessTokenResponse = (data: unknown) => {
  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const error = record.error
  if (typeof error === 'string') {
    return {
      ok: false as const,
      error,
      description:
        typeof record.error_description === 'string' ? record.error_description : undefined,
    }
  }
  if (typeof record.access_token !== 'string' || record.access_token.trim().length === 0) {
    throw new Error(`Unexpected GitHub token response: ${JSON.stringify(data)}`)
  }
  return {
    ok: true as const,
    accessToken: record.access_token.trim(),
    tokenType: typeof record.token_type === 'string' ? record.token_type : undefined,
    scope: typeof record.scope === 'string' ? record.scope : undefined,
  }
}

const postGithubForm = async (url: string, body: URLSearchParams): Promise<unknown> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`GitHub OAuth request failed (${response.status}): ${JSON.stringify(data)}`)
  }
  return data
}

export const login = async (args: ParsedArgs): Promise<GithubAuthState> => {
  const cached = await readAuthState()
  if (cached && !hasFlag(args, 'force')) return cached

  const clientId = clientIdFromArgs(args)
  const scope = firstFlag(args, 'scope') ?? DEFAULT_SCOPE
  const device = parseDeviceCodeResponse(
    await postGithubForm(
      GITHUB_DEVICE_CODE_URL,
      new URLSearchParams({
        client_id: clientId,
        scope,
      }),
    ),
  )

  process.stdout.write(
    [
      'GitHub login required.',
      `Open: ${device.verificationUri}`,
      `Enter code: ${device.userCode}`,
      '',
    ].join('\n'),
  )
  try {
    openBrowser(device.verificationUri)
  } catch (error) {
    process.stdout.write(
      `Could not open browser automatically: ${error instanceof Error ? error.message : String(error)}\n`,
    )
  }

  const deadline = Date.now() + device.expiresIn * 1000
  let intervalMs = device.interval * 1000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
    const token = parseAccessTokenResponse(
      await postGithubForm(
        GITHUB_TOKEN_URL,
        new URLSearchParams({
          client_id: clientId,
          device_code: device.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      ),
    )
    if (token.ok) {
      const state: GithubAuthState = {
        accessToken: token.accessToken,
        ...(token.tokenType ? { tokenType: token.tokenType } : {}),
        ...(token.scope ? { scope: token.scope } : {}),
        createdAt: new Date().toISOString(),
      }
      await writeAuthState(state)
      return state
    }
    if (token.error === 'authorization_pending') continue
    if (token.error === 'slow_down') {
      intervalMs += 5_000
      continue
    }
    throw new Error(
      `GitHub OAuth failed: ${token.error}${token.description ? ` - ${token.description}` : ''}`,
    )
  }
  throw new Error('GitHub OAuth device code expired before login completed.')
}

const authHeaders = (auth: GithubAuthState) => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${auth.accessToken}`,
  'X-GitHub-Api-Version': '2022-11-28',
})

const githubJson = async <T>(
  auth: GithubAuthState,
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      ...authHeaders(auth),
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`GitHub API failed (${response.status}): ${text || response.statusText}`)
  }
  return data as T
}

const requireAuth = async () => {
  const auth = await readAuthState()
  if (!auth) throw new Error('Not logged in. Run: yarn tycli:github login')
  return auth
}

const listRepos = async (args: ParsedArgs) => {
  const auth = await requireAuth()
  const repos = await githubJson<
    Array<{ full_name?: string; private?: boolean; html_url?: string; open_issues_count?: number }>
  >(
    auth,
    '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
  )
  const query = firstFlag(args, 'query')?.toLowerCase()
  const filtered = query
    ? repos.filter((repo) => repo.full_name?.toLowerCase().includes(query))
    : repos
  for (const repo of filtered) {
    process.stdout.write(
      `${repo.full_name ?? '(unknown)'}${repo.private ? ' private' : ''} open_issues=${repo.open_issues_count ?? 0} ${repo.html_url ?? ''}\n`,
    )
  }
}

const repoPath = (repo: string) => {
  const [owner, name] = repo.split('/')
  if (!owner || !name || repo.split('/').length !== 2) {
    throw new Error('Repository must be in owner/repo format.')
  }
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}

const listIssues = async (args: ParsedArgs) => {
  const repo = args.positionals[0]
  if (!repo) throw new Error('Missing repository. Use owner/repo.')
  const state = firstFlag(args, 'state') ?? 'open'
  if (!['open', 'closed', 'all'].includes(state)) {
    throw new Error('--state must be one of: open, closed, all')
  }
  const auth = await requireAuth()
  const issues = await githubJson<
    Array<{
      number?: number
      title?: string
      state?: string
      html_url?: string
      pull_request?: unknown
    }>
  >(auth, `/repos/${repoPath(repo)}/issues?state=${encodeURIComponent(state)}&per_page=100`)
  for (const issue of issues.filter((item) => item.pull_request === undefined)) {
    process.stdout.write(
      `#${issue.number ?? '?'} ${issue.state ?? 'unknown'} ${issue.title ?? '(untitled)'} ${issue.html_url ?? ''}\n`,
    )
  }
}

const issueDraftsFromFile = async (path: string): Promise<GithubIssueDraft[]> => {
  const content = await readTextFile(path)
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [title = '', ...bodyParts] = line.split('::')
      const body = bodyParts.join('::').trim()
      return {
        title: title.trim(),
        ...(body ? { body } : {}),
      }
    })
    .filter((issue) => issue.title.length > 0)
}

const createIssueDrafts = async (args: ParsedArgs): Promise<GithubIssueDraft[]> => {
  const fromTitles = (args.flags.title ?? []).map((title) => ({ title: title.trim() }))
  const fromFiles = await Promise.all((args.flags.file ?? []).map(issueDraftsFromFile))
  const labels = args.flags.label?.map((label) => label.trim()).filter(Boolean)
  return [...fromTitles, ...fromFiles.flat()]
    .filter((issue) => issue.title.length > 0)
    .map((issue) => ({ ...issue, ...(labels?.length ? { labels } : {}) }))
}

const createIssues = async (args: ParsedArgs) => {
  const repo = args.positionals[0]
  if (!repo) throw new Error('Missing repository. Use owner/repo.')
  const drafts = await createIssueDrafts(args)
  if (drafts.length === 0) throw new Error('No issues provided. Use --title or --file.')

  if (hasFlag(args, 'dry-run')) {
    process.stdout.write(`Would create ${drafts.length} issue(s) in ${repo}:\n`)
    for (const draft of drafts) process.stdout.write(`- ${draft.title}\n`)
    return
  }

  const auth = await requireAuth()
  for (const draft of drafts) {
    const created = await githubJson<{ number?: number; html_url?: string }>(
      auth,
      `/repos/${repoPath(repo)}/issues`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      },
    )
    process.stdout.write(`#${created.number ?? '?'} ${draft.title} ${created.html_url ?? ''}\n`)
  }
}

const printAuthStatus = async () => {
  const auth = await readAuthState()
  if (!auth) {
    process.stdout.write('GitHub OAuth: not logged in\n')
    return
  }
  process.stdout.write(
    `GitHub OAuth: logged in since ${auth.createdAt}${auth.scope ? ` scope=${auth.scope}` : ''}\n`,
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.command === 'help' || hasFlag(args, 'help')) {
    process.stdout.write(`${usage}\n`)
    return
  }
  if (args.command === 'login') {
    await login(args)
    process.stdout.write('GitHub OAuth login complete.\n')
    return
  }
  if (args.command === 'auth-status') {
    await printAuthStatus()
    return
  }
  if (args.command === 'repos') {
    await listRepos(args)
    return
  }
  if (args.command === 'issues') {
    await listIssues(args)
    return
  }
  if (args.command === 'create-issues') {
    await createIssues(args)
    return
  }
  throw new Error(`Unknown github command: ${args.command}\n\n${usage}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
