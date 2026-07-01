import { gitlabTool } from '../../tools/gitlabTool'
import { loginGitlab, readGitlabAuthState } from '../../gitlabCli'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

type MockRequest = {
  url: string
  method: string
  body?: string
}

type MockResponse = {
  status?: number
  body?: unknown
}

const createJsonResponse = (response: MockResponse) =>
  new Response(JSON.stringify(response.body ?? null), {
    status: response.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  })

const createFetchSequence = (responses: MockResponse[]) => {
  const requests: MockRequest[] = []
  const fetchFn: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requests.push({
      url,
      method: init?.method ?? 'GET',
      ...(typeof init?.body === 'string' ? { body: init.body } : {}),
    })
    const response = responses.shift()
    if (!response) throw new Error(`Unexpected fetch call: ${url}`)
    return Promise.resolve(createJsonResponse(response))
  }
  return { fetchFn, requests }
}

const withMockedFetch = async <T>(fetchFn: typeof fetch, run: () => Promise<T>): Promise<T> => {
  const originalFetch = globalThis.fetch
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: fetchFn,
  })
  try {
    return await run()
  } finally {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: originalFetch,
    })
  }
}

const uniqueBaseUrl = () => `https://gitlab-diagnostics-${Date.now()}.example`

export const testGitlabDeviceOAuthPollsAndCachesToken = async () => {
  const baseUrl = uniqueBaseUrl()
  const { fetchFn, requests } = createFetchSequence([
    {
      body: {
        device_code: 'device-1',
        user_code: 'USER-CODE',
        verification_uri: `${baseUrl}/oauth/device`,
        verification_uri_complete: `${baseUrl}/oauth/device?user_code=USER-CODE`,
        expires_in: 300,
        interval: 1,
      },
    },
    {
      status: 400,
      body: {
        error: 'authorization_pending',
      },
    },
    {
      body: {
        access_token: 'gitlab-token',
        token_type: 'Bearer',
        scope: 'api',
        expires_in: 7200,
        created_at: Math.floor(Date.now() / 1000),
      },
    },
  ])

  const auth = await loginGitlab({
    baseUrl,
    clientId: 'client-1',
    force: true,
    fetchFn,
    sleep: async () => {},
    openBrowser: () => {},
    writeOutput: () => {},
  })
  const cached = await readGitlabAuthState(baseUrl)

  assert(auth.accessToken === 'gitlab-token', 'Expected login to return the GitLab access token')
  assert(cached?.accessToken === 'gitlab-token', 'Expected login to cache the GitLab token')
  assert(
    requests[0]?.url === `${baseUrl}/oauth/authorize_device`,
    `Expected device authorization request, got ${requests[0]?.url ?? '(none)'}`,
  )
  assert(
    requests.some((request) =>
      request.body?.includes('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code'),
    ),
    'Expected token polling request to use the device_code grant type',
  )

  return { success: true }
}

export const testGitlabToolListsProjectsAndIssues = async () => {
  const baseUrl = uniqueBaseUrl()
  const loginFetch = createFetchSequence([
    {
      body: {
        device_code: 'device-2',
        user_code: 'USER-CODE',
        verification_uri: `${baseUrl}/oauth/device`,
        expires_in: 300,
        interval: 1,
      },
    },
    {
      body: {
        access_token: 'gitlab-token',
        token_type: 'Bearer',
        scope: 'api',
        expires_in: 7200,
        created_at: Math.floor(Date.now() / 1000),
      },
    },
  ])
  await loginGitlab({
    baseUrl,
    clientId: 'client-2',
    force: true,
    fetchFn: loginFetch.fetchFn,
    sleep: async () => {},
    openBrowser: () => {},
    writeOutput: () => {},
  })

  const apiFetch = createFetchSequence([
    {
      body: [
        {
          id: 5,
          path_with_namespace: 'xyntopia/componardogui',
          name_with_namespace: 'Xyntopia / Taskyon',
          web_url: `${baseUrl}/xyntopia/componardogui`,
          open_issues_count: 2,
        },
      ],
    },
    {
      body: [
        {
          iid: 12,
          title: 'Obsolete task',
          state: 'opened',
          web_url: `${baseUrl}/xyntopia/componardogui/-/issues/12`,
          labels: ['cleanup'],
        },
      ],
    },
  ])

  await withMockedFetch(apiFetch.fetchFn, async () => {
    const projects = await gitlabTool.function?.({
      action: 'listProjects',
      baseUrl,
      clientId: 'client-2',
      query: 'taskyon',
      maxPages: 1,
    })
    const issues = await gitlabTool.function?.({
      action: 'listIssues',
      baseUrl,
      clientId: 'client-2',
      project: 'xyntopia/componardogui',
      state: 'opened',
      maxPages: 1,
    })

    assert(
      projects &&
        typeof projects === 'object' &&
        'projects' in projects &&
        Array.isArray(projects.projects) &&
        projects.projects[0]?.path === 'xyntopia/componardogui',
      'Expected gitlab listProjects to return normalized project data',
    )
    assert(
      issues &&
        typeof issues === 'object' &&
        'issues' in issues &&
        Array.isArray(issues.issues) &&
        issues.issues[0]?.iid === 12,
      'Expected gitlab listIssues to return normalized issue data',
    )
  })

  assert(
    apiFetch.requests[0]?.url.includes('/api/v4/projects?'),
    'Expected listProjects to call the GitLab projects API',
  )
  assert(
    apiFetch.requests[1]?.url.includes('/api/v4/projects/xyntopia%2Fcomponardogui/issues?'),
    'Expected listIssues to URL-encode project paths',
  )

  return { success: true }
}

export const testGitlabToolBulkCloseCommentsBeforeClosing = async () => {
  const baseUrl = uniqueBaseUrl()
  const loginFetch = createFetchSequence([
    {
      body: {
        device_code: 'device-3',
        user_code: 'USER-CODE',
        verification_uri: `${baseUrl}/oauth/device`,
        expires_in: 300,
        interval: 1,
      },
    },
    {
      body: {
        access_token: 'gitlab-token',
        token_type: 'Bearer',
        scope: 'api',
        expires_in: 7200,
        created_at: Math.floor(Date.now() / 1000),
      },
    },
  ])
  await loginGitlab({
    baseUrl,
    clientId: 'client-3',
    force: true,
    fetchFn: loginFetch.fetchFn,
    sleep: async () => {},
    openBrowser: () => {},
    writeOutput: () => {},
  })

  const apiFetch = createFetchSequence([
    { body: { id: 99, body: 'closing as obsolete' } },
    {
      body: {
        iid: 12,
        state: 'closed',
        web_url: `${baseUrl}/xyntopia/componardogui/-/issues/12`,
      },
    },
  ])

  await withMockedFetch(apiFetch.fetchFn, async () => {
    const result = await gitlabTool.function?.({
      action: 'bulkCloseIssues',
      baseUrl,
      clientId: 'client-3',
      project: 'xyntopia/componardogui',
      comment: 'closing as obsolete',
      issues: [{ issueIid: 12 }],
    })
    assert(
      result &&
        typeof result === 'object' &&
        'results' in result &&
        Array.isArray(result.results) &&
        result.results[0]?.ok === true,
      'Expected bulkCloseIssues to report a successful close',
    )
  })

  assert(
    apiFetch.requests[0]?.method === 'POST' && apiFetch.requests[0]?.url.includes('/notes'),
    'Expected bulkCloseIssues to post a note first',
  )
  assert(
    apiFetch.requests[1]?.method === 'PUT' &&
      apiFetch.requests[1]?.body?.includes('"state_event":"close"'),
    'Expected bulkCloseIssues to close the issue after commenting',
  )

  return { success: true }
}

export const testGitlabToolRejectsCloseWithoutComment = async () => {
  const baseUrl = uniqueBaseUrl()
  let message = ''
  try {
    await gitlabTool.function?.({
      action: 'closeIssue',
      baseUrl,
      project: 'xyntopia/componardogui',
      issueIid: 12,
    })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }

  assert(
    message.includes('non-empty comment'),
    `Expected missing-comment validation error, got ${message || '(none)'}`,
  )

  return { success: true }
}

testGitlabDeviceOAuthPollsAndCachesToken.description =
  'GitLab device OAuth polls until authorization succeeds and caches the resulting access token.'
testGitlabToolListsProjectsAndIssues.description =
  'The tycli GitLab tool lists projects and project issues through GitLab API primitives.'
testGitlabToolBulkCloseCommentsBeforeClosing.description =
  'The tycli GitLab tool posts a comment before closing issues in bulk.'
testGitlabToolRejectsCloseWithoutComment.description =
  'The tycli GitLab tool rejects issue-closing actions without an explanatory comment.'
