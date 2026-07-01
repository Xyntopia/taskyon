import { createTool } from '@taskyon/taskyon/api'
import { login, readAuthState, type GithubAuthState } from '../githubCli'

type GithubIssuesArgs = {
  action?: 'authStatus' | 'listRepos' | 'listIssues' | 'createIssues'
  repository?: string
  state?: 'open' | 'closed' | 'all'
  query?: string
  issues?: Array<{
    title?: string
    body?: string
    labels?: string[]
  }>
  dryRun?: boolean
  forceLogin?: boolean
  clientId?: string
  scope?: string
}

const GITHUB_API = 'https://api.github.com'

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

const requireAuth = async (args: GithubIssuesArgs) => {
  const cached = await readAuthState()
  if (cached && args.forceLogin !== true) return cached

  return await login({
    command: 'login',
    positionals: [],
    flags: {
      ...(args.clientId ? { 'client-id': [args.clientId] } : {}),
      ...(args.scope ? { scope: [args.scope] } : {}),
      ...(args.forceLogin ? { force: ['true'] } : {}),
    },
  })
}

const repoPath = (repo: string) => {
  const [owner, name] = repo.split('/')
  if (!owner || !name || repo.split('/').length !== 2) {
    throw new Error('Repository must be in owner/repo format.')
  }
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
}

const listRepos = async (auth: GithubAuthState, query?: string) => {
  const repos = await githubJson<
    Array<{ full_name?: string; private?: boolean; html_url?: string; open_issues_count?: number }>
  >(
    auth,
    '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
  )
  const normalizedQuery = query?.trim().toLowerCase()
  return (
    normalizedQuery
      ? repos.filter((repo) => repo.full_name?.toLowerCase().includes(normalizedQuery))
      : repos
  ).map((repo) => ({
    fullName: repo.full_name,
    private: repo.private === true,
    url: repo.html_url,
    openIssues: repo.open_issues_count,
  }))
}

const listIssues = async (auth: GithubAuthState, repository: string, state: string) => {
  const issues = await githubJson<
    Array<{
      number?: number
      title?: string
      state?: string
      html_url?: string
      pull_request?: unknown
    }>
  >(auth, `/repos/${repoPath(repository)}/issues?state=${encodeURIComponent(state)}&per_page=100`)
  return issues
    .filter((item) => item.pull_request === undefined)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      state: issue.state,
      url: issue.html_url,
    }))
}

const normalizeIssueDrafts = (issues: GithubIssuesArgs['issues']) =>
  (issues ?? [])
    .map((issue) => ({
      title: issue.title?.trim() ?? '',
      ...(issue.body?.trim() ? { body: issue.body.trim() } : {}),
      ...(issue.labels?.length
        ? { labels: issue.labels.map((label) => label.trim()).filter(Boolean) }
        : {}),
    }))
    .filter((issue) => issue.title.length > 0)

const createIssues = async (auth: GithubAuthState, repository: string, args: GithubIssuesArgs) => {
  const issues = normalizeIssueDrafts(args.issues)
  if (issues.length === 0) throw new Error('createIssues requires at least one issue title.')
  if (args.dryRun === true) return { dryRun: true, repository, issues }

  const created = []
  for (const issue of issues) {
    const result = await githubJson<{ number?: number; html_url?: string }>(
      auth,
      `/repos/${repoPath(repository)}/issues`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(issue),
      },
    )
    created.push({
      title: issue.title,
      number: result.number,
      url: result.html_url,
    })
  }
  return { repository, created }
}

export const githubIssuesTool = createTool({
  name: 'githubIssues',
  description:
    'Manage GitHub issue lists from tycli using local GitHub OAuth. List repositories, list issues, and create issues.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: ['authStatus', 'listRepos', 'listIssues', 'createIssues'],
        description: 'GitHub issue-management action to run.',
      },
      repository: {
        type: 'string',
        description: 'Repository in owner/repo format. Required for listIssues and createIssues.',
      },
      state: {
        type: 'string',
        enum: ['open', 'closed', 'all'],
        default: 'open',
        description: 'Issue state for listIssues.',
      },
      query: {
        type: 'string',
        description: 'Optional case-insensitive repository-name filter for listRepos.',
      },
      issues: {
        type: 'array',
        description: 'Issues to create. Required for createIssues.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title'],
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            labels: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      dryRun: {
        type: 'boolean',
        default: false,
        description: 'For createIssues, preview issues without writing to GitHub.',
      },
      forceLogin: {
        type: 'boolean',
        default: false,
        description: 'Ignore cached GitHub OAuth credentials and login again.',
      },
      clientId: {
        type: 'string',
        description:
          'Optional GitHub OAuth app client id. Defaults to Taskyon`s public GitHub OAuth app id.',
      },
      scope: {
        type: 'string',
        description: 'Optional OAuth scope override. Defaults to repo read:user.',
      },
    },
  } as const,
  function: async (args: GithubIssuesArgs) => {
    if (args.action === 'authStatus') {
      const auth = await readAuthState()
      return auth
        ? { ok: true, authenticated: true, createdAt: auth.createdAt, scope: auth.scope }
        : { ok: true, authenticated: false }
    }

    const auth = await requireAuth(args)
    if ('error' in auth) return { ok: false, error: auth.error }

    switch (args.action) {
      case 'listRepos':
        return { ok: true, repositories: await listRepos(auth, args.query) }
      case 'listIssues': {
        if (!args.repository) throw new Error('listIssues requires repository.')
        return {
          ok: true,
          repository: args.repository,
          issues: await listIssues(auth, args.repository, args.state ?? 'open'),
        }
      }
      case 'createIssues': {
        if (!args.repository) throw new Error('createIssues requires repository.')
        return { ok: true, ...(await createIssues(auth, args.repository, args)) }
      }
      default:
        throw new Error(`Unsupported githubIssues action: ${String(args.action)}`)
    }
  },
})
