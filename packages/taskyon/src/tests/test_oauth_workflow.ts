import z from 'zod'
import { createSubtasksResult, taskResult } from '../types/toolApi'
import { getGitlabInfo } from '../tools/devTools'
import { executeToolInWorkerSandbox } from '../utils/executeToolInWorkerSandbox'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function runGitlabInfo(
  params: Record<string, unknown>,
  options: { secret: string | null; fetch?: typeof fetch },
) {
  assert(getGitlabInfo.code, 'Expected the GitLab tool to use standard sandbox code')
  const stopController = new AbortController()
  return await executeToolInWorkerSandbox(
    getGitlabInfo.code,
    {
      params,
      context: {
        getExecutionTaskChain: () => Promise.resolve([]),
        createSubtasksResult,
        getSecret: () => Promise.resolve(options.secret),
        setSecret: () => Promise.resolve(),
        stopSignal: stopController.signal,
        toolId: 'test:getGitlabInfo',
        ...(options.fetch ? { fetch: options.fetch } : {}),
      },
    },
    'getGitlabInfo.test.js',
    stopController.signal,
  )
}

export async function oauth_workflowPreservesCallerArgumentsAfterLogin() {
  assert(!('function' in getGitlabInfo), 'The GitLab tool must not execute as a trusted function')
  const result = await runGitlabInfo(
    {
      forceLogin: true,
      includeProfile: false,
      includeProjects: true,
      includeGroups: true,
      includeIssues: true,
      projectPath: 'xyntopia/taskyon',
      issueLimit: 10,
      issueState: 'all',
    },
    { secret: null },
  )
  const parsed = taskResult.parse(result)
  const continuation = parsed.taskChainList[0]?.[1]

  assert(continuation?.content.type === 'functioncall', 'Expected a GitLab continuation task')
  assert(continuation.content.data.name === 'getGitlabInfo', 'Expected the GitLab tool to resume')
  assert(
    continuation.content.data.arguments.forceLogin === false &&
      continuation.content.data.arguments.includeProfile === false &&
      continuation.content.data.arguments.includeProjects === true &&
      continuation.content.data.arguments.includeGroups === true &&
      continuation.content.data.arguments.includeIssues === true &&
      continuation.content.data.arguments.projectPath === 'xyntopia/taskyon' &&
      continuation.content.data.arguments.issueLimit === 10 &&
      continuation.content.data.arguments.issueState === 'all',
    'The continuation must preserve the requested data while disabling forced re-login',
  )
}

oauth_workflowPreservesCallerArgumentsAfterLogin.description =
  'The GitLab OAuth continuation preserves the original request instead of retrying with defaults.'

export async function oauth_workflowFetchesGitlabIssuesThroughSandbox() {
  let requestedUrl = ''
  let authorization = ''
  const secret = JSON.stringify({
    type: 'oauth-credentials',
    access_token: 'test-token',
    service: 'https://gitlab.com/oauth/token',
    created_at: Date.now(),
  })
  const result = await runGitlabInfo(
    {
      includeProfile: false,
      includeProjects: false,
      includeGroups: false,
      includeIssues: true,
      projectPath: 'xyntopia/taskyon',
      issueLimit: 10,
      issueState: 'all',
    },
    {
      secret,
      fetch: (input, init) => {
        requestedUrl = input instanceof Request ? input.url : String(input)
        authorization = new Headers(init?.headers).get('authorization') ?? ''
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                iid: 42,
                title: 'Sandbox GitLab issue',
                state: 'opened',
                web_url: 'https://gitlab.com/xyntopia/taskyon/-/issues/42',
                created_at: '2026-08-05T00:00:00Z',
                updated_at: '2026-08-05T01:00:00Z',
                author: { username: 'taskyon-user', name: 'Taskyon User' },
              },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        )
      },
    },
  )

  assert(
    requestedUrl ===
      'https://gitlab.com/api/v4/projects/xyntopia%2Ftaskyon/issues?per_page=10&order_by=created_at&sort=desc&state=all',
    `Unexpected GitLab issues URL: ${requestedUrl}`,
  )
  assert(authorization === 'Bearer test-token', 'Expected the OAuth bearer token')
  const data = z
    .object({
      issues: z.array(
        z.object({
          iid: z.number(),
          title: z.string(),
          author: z.object({ username: z.string(), name: z.string() }),
        }),
      ),
    })
    .parse(result)
  assert(data.issues[0]?.iid === 42, 'Expected the requested GitLab issue')
}

oauth_workflowFetchesGitlabIssuesThroughSandbox.description =
  'The GitLab reader runs as standard sandbox code and routes global fetch through Taskyon RPC.'

export async function oauth_workflowReportsGitlabHttpErrors() {
  const secret = JSON.stringify({
    type: 'oauth-credentials',
    access_token: 'test-token',
    service: 'https://gitlab.com/oauth/token',
    created_at: Date.now(),
  })
  await runGitlabInfo(
    { includeProfile: true },
    {
      secret,
      fetch: () =>
        Promise.resolve(
          new Response('upstream unavailable', { status: 503, statusText: 'Unavailable' }),
        ),
    },
  ).then(
    () => {
      throw new Error('A failed GitLab response unexpectedly completed')
    },
    (error: unknown) => {
      assert(error instanceof Error, 'Expected a GitLab request error')
      assert(error.message.includes('503 Unavailable'), 'Expected the GitLab HTTP status')
    },
  )
}

oauth_workflowReportsGitlabHttpErrors.description =
  'The GitLab reader turns non-successful HTTP responses into visible tool errors.'
