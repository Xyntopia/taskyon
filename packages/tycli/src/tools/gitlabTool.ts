import { createTool } from '@taskyon/taskyon/api'
import { readGitlabAuthState, requireGitlabAuth, type GitlabAuthState } from '../gitlabCli'

type GitlabToolArgs = {
  action?:
    | 'authStatus'
    | 'listProjects'
    | 'listIssues'
    | 'getIssue'
    | 'commentIssue'
    | 'closeIssue'
    | 'bulkCloseIssues'
  baseUrl?: string
  project?: string
  query?: string
  state?: 'opened' | 'closed' | 'all'
  maxPages?: number
  perPage?: number
  issueIid?: number
  comment?: string
  issues?: Array<{
    issueIid?: number
    comment?: string
  }>
  forceLogin?: boolean
  clientId?: string
  scope?: string
}

type GitlabPageOptions = {
  maxPages?: number
  perPage?: number
}

const DEFAULT_GITLAB_BASE_URL = 'https://gitlab.com'

const normalizeBaseUrl = (baseUrl?: string): string =>
  (baseUrl?.trim() || DEFAULT_GITLAB_BASE_URL).replace(/\/+$/, '')

const projectPath = (project: string) => encodeURIComponent(project.trim())

const requireProject = (project?: string): string => {
  const value = project?.trim()
  if (!value) throw new Error('This GitLab action requires a project id or path.')
  return value
}

const requireIssueIid = (issueIid?: number): number => {
  if (!Number.isInteger(issueIid) || !issueIid || issueIid <= 0) {
    throw new Error('This GitLab action requires a positive issueIid.')
  }
  return issueIid
}

const requireComment = (comment?: string): string => {
  const value = comment?.trim()
  if (!value)
    throw new Error('Closing or commenting on a GitLab issue requires a non-empty comment.')
  return value
}

const authHeaders = (auth: GitlabAuthState) => ({
  Accept: 'application/json',
  Authorization: `Bearer ${auth.accessToken}`,
})

const parseJson = (text: string): unknown => (text.trim() ? JSON.parse(text) : null)

const gitlabJson = async <T>(
  auth: GitlabAuthState,
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const response = await fetch(`${auth.baseUrl}/api/v4${path}`, {
    ...init,
    headers: {
      ...authHeaders(auth),
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`GitLab API failed (${response.status}): ${text || response.statusText}`)
  }
  return parseJson(text) as T
}

const gitlabJsonPages = async <T>(
  auth: GitlabAuthState,
  path: string,
  options: GitlabPageOptions,
): Promise<T[]> => {
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 5, 20))
  const perPage = Math.max(1, Math.min(options.perPage ?? 100, 100))
  const results: T[] = []
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const pageItems = await gitlabJson<T[]>(
      auth,
      `${path}${separator}per_page=${perPage}&page=${page}`,
    )
    results.push(...pageItems)
    if (pageItems.length < perPage) break
  }
  return results
}

const requireAuth = async (args: GitlabToolArgs) =>
  await requireGitlabAuth({
    ...(args.baseUrl ? { baseUrl: args.baseUrl } : {}),
    ...(args.clientId ? { clientId: args.clientId } : {}),
    ...(args.scope ? { scope: args.scope } : {}),
    ...(args.forceLogin !== undefined ? { force: args.forceLogin } : {}),
  })

const listProjects = async (auth: GitlabAuthState, args: GitlabToolArgs) => {
  const query = args.query?.trim()
  const params = new URLSearchParams({
    membership: 'true',
    simple: 'true',
    order_by: 'last_activity_at',
    sort: 'desc',
  })
  if (query) params.set('search', query)
  const projects = await gitlabJsonPages<{
    id?: number
    path_with_namespace?: string
    name_with_namespace?: string
    web_url?: string
    open_issues_count?: number
  }>(auth, `/projects?${params.toString()}`, args)
  return projects.map((project) => ({
    id: project.id,
    path: project.path_with_namespace,
    name: project.name_with_namespace,
    url: project.web_url,
    openIssues: project.open_issues_count,
  }))
}

const listIssues = async (auth: GitlabAuthState, args: GitlabToolArgs) => {
  const project = requireProject(args.project)
  const params = new URLSearchParams({
    state: args.state ?? 'opened',
    scope: 'all',
  })
  if (args.query?.trim()) params.set('search', args.query.trim())
  const issues = await gitlabJsonPages<{
    iid?: number
    title?: string
    state?: string
    web_url?: string
    updated_at?: string
    created_at?: string
    labels?: string[]
    description?: string
  }>(auth, `/projects/${projectPath(project)}/issues?${params.toString()}`, args)
  return issues.map((issue) => ({
    iid: issue.iid,
    title: issue.title,
    state: issue.state,
    url: issue.web_url,
    updatedAt: issue.updated_at,
    createdAt: issue.created_at,
    labels: issue.labels,
    description: issue.description,
  }))
}

const getIssue = async (auth: GitlabAuthState, args: GitlabToolArgs) => {
  const project = requireProject(args.project)
  const issueIid = requireIssueIid(args.issueIid)
  return await gitlabJson(auth, `/projects/${projectPath(project)}/issues/${issueIid}`)
}

const commentIssue = async (
  auth: GitlabAuthState,
  project: string,
  issueIid: number,
  comment: string,
) =>
  await gitlabJson<{ id?: number; body?: string; web_url?: string }>(
    auth,
    `/projects/${projectPath(project)}/issues/${issueIid}/notes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: comment }),
    },
  )

const closeIssue = async (
  auth: GitlabAuthState,
  project: string,
  issueIid: number,
  comment: string,
) => {
  const note = await commentIssue(auth, project, issueIid, comment)
  const issue = await gitlabJson<{
    iid?: number
    state?: string
    web_url?: string
    title?: string
  }>(auth, `/projects/${projectPath(project)}/issues/${issueIid}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state_event: 'close' }),
  })
  return { issueIid, note, issue }
}

const bulkCloseIssues = async (auth: GitlabAuthState, args: GitlabToolArgs) => {
  const project = requireProject(args.project)
  const issues = args.issues ?? []
  if (issues.length === 0) throw new Error('bulkCloseIssues requires at least one issue.')
  const results = []
  for (const issue of issues) {
    const issueIid = requireIssueIid(issue.issueIid)
    const comment = requireComment(issue.comment ?? args.comment)
    try {
      results.push({
        issueIid,
        ok: true,
        result: await closeIssue(auth, project, issueIid, comment),
      })
    } catch (error) {
      results.push({
        issueIid,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { project, results }
}

const validateBeforeAuth = (args: GitlabToolArgs) => {
  switch (args.action) {
    case 'listIssues':
      requireProject(args.project)
      break
    case 'getIssue':
      requireProject(args.project)
      requireIssueIid(args.issueIid)
      break
    case 'commentIssue':
    case 'closeIssue':
      requireProject(args.project)
      requireIssueIid(args.issueIid)
      requireComment(args.comment)
      break
    case 'bulkCloseIssues': {
      requireProject(args.project)
      const issues = args.issues ?? []
      if (issues.length === 0) throw new Error('bulkCloseIssues requires at least one issue.')
      for (const issue of issues) {
        requireIssueIid(issue.issueIid)
        requireComment(issue.comment ?? args.comment)
      }
      break
    }
  }
}

export const gitlabTool = createTool({
  name: 'gitlab',
  description:
    'Use GitLab from tycli with OAuth. List projects/issues, inspect issues, comment on issues, and close issues with comments.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['action'],
    properties: {
      action: {
        type: 'string',
        enum: [
          'authStatus',
          'listProjects',
          'listIssues',
          'getIssue',
          'commentIssue',
          'closeIssue',
          'bulkCloseIssues',
        ],
        description: 'GitLab API action to run.',
      },
      baseUrl: {
        type: 'string',
        default: DEFAULT_GITLAB_BASE_URL,
        description: 'GitLab instance base URL. Defaults to https://gitlab.com.',
      },
      project: {
        type: 'string',
        description: 'GitLab project id or path, for example xyntopia/componardogui.',
      },
      query: {
        type: 'string',
        description: 'Search query for projects or issues.',
      },
      state: {
        type: 'string',
        enum: ['opened', 'closed', 'all'],
        default: 'opened',
        description: 'Issue state for listIssues.',
      },
      maxPages: {
        type: 'number',
        default: 5,
        description: 'Maximum result pages to fetch for list actions. Hard-capped at 20.',
      },
      perPage: {
        type: 'number',
        default: 100,
        description: 'Items per GitLab page. Hard-capped at 100.',
      },
      issueIid: {
        type: 'number',
        description: 'Project-local issue IID for getIssue, commentIssue, or closeIssue.',
      },
      comment: {
        type: 'string',
        description: 'Comment body. Required for commentIssue, closeIssue, and bulkCloseIssues.',
      },
      issues: {
        type: 'array',
        description:
          'Issues for bulkCloseIssues. Each item needs issueIid and may override comment.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['issueIid'],
          properties: {
            issueIid: { type: 'number' },
            comment: { type: 'string' },
          },
        },
      },
      forceLogin: {
        type: 'boolean',
        default: false,
        description: 'Ignore cached GitLab OAuth credentials and login again.',
      },
      clientId: {
        type: 'string',
        description:
          'Optional GitLab OAuth app client id. Defaults to Taskyon`s public GitLab OAuth app id or env override.',
      },
      scope: {
        type: 'string',
        description: 'Optional OAuth scope override. Defaults to api.',
      },
    },
  } as const,
  function: async (args: GitlabToolArgs) => {
    if (args.action === 'authStatus') {
      const baseUrl = normalizeBaseUrl(args.baseUrl)
      const auth = await readGitlabAuthState(baseUrl)
      if (!auth) return { ok: true, authenticated: false, baseUrl }
      return {
        ok: true,
        authenticated: true,
        baseUrl: auth.baseUrl,
        createdAt: auth.createdAt,
        expiresAt: auth.expiresAt,
        scope: auth.scope,
      }
    }

    validateBeforeAuth(args)
    const auth = await requireAuth(args)
    switch (args.action) {
      case 'listProjects':
        return { ok: true, projects: await listProjects(auth, args) }
      case 'listIssues':
        return {
          ok: true,
          project: requireProject(args.project),
          issues: await listIssues(auth, args),
        }
      case 'getIssue':
        return { ok: true, issue: await getIssue(auth, args) }
      case 'commentIssue': {
        const project = requireProject(args.project)
        const issueIid = requireIssueIid(args.issueIid)
        return {
          ok: true,
          project,
          issueIid,
          note: await commentIssue(auth, project, issueIid, requireComment(args.comment)),
        }
      }
      case 'closeIssue': {
        const project = requireProject(args.project)
        const issueIid = requireIssueIid(args.issueIid)
        return {
          ok: true,
          project,
          ...(await closeIssue(auth, project, issueIid, requireComment(args.comment))),
        }
      }
      case 'bulkCloseIssues':
        return { ok: true, ...(await bulkCloseIssues(auth, args)) }
      default:
        throw new Error(`Unsupported gitlab action: ${String(args.action)}`)
    }
  },
})
