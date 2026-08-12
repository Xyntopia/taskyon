import type { JSONSchema7 } from 'json-schema'
import { createTool, toolCall } from '../types/toolApi'
import type { OAuthCredentials } from '../utils/oauth'
import { OAUTH_PROVIDERS, useRefreshTokenIfExpired } from '../utils/oauth'

type IssueSelectionInteraction = {
  projectId: string
  projectName: string
  issues: string[]
}

function parseIssueSelectionInteraction(payload: unknown): IssueSelectionInteraction | 'cancelled' {
  if (payload === 'cancelled') return payload
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Issue selection returned an invalid interaction payload.')
  }
  const selection = payload as {
    selectedProjectId?: unknown
    selectedProjectName?: unknown
    selectedIssues?: unknown
  }
  if (
    typeof selection.selectedProjectId !== 'string' ||
    typeof selection.selectedProjectName !== 'string' ||
    !Array.isArray(selection.selectedIssues) ||
    !selection.selectedIssues.every((issue) => typeof issue === 'string')
  ) {
    throw new Error('Issue selection returned invalid project or issue values.')
  }
  return {
    projectId: selection.selectedProjectId,
    projectName: selection.selectedProjectName,
    issues: selection.selectedIssues,
  }
}

export const getGitlabInfo = createTool({
  name: 'getGitlabInfo',
  description: 'Read GitLab profile, projects, groups, or recent issues from a specific project.',
  longDescription:
    'This read-only GitLab workflow obtains OAuth credentials through Taskyon, calls the GitLab API through mediated fetch, and returns only the requested account or project sections. Authentication can be deliberately refreshed without changing GitLab data.',
  parameters: {
    type: 'object',
    properties: {
      forceLogin: {
        type: 'boolean',
        description: 'If true, drop existing token and re-login',
      },
      includeProfile: {
        type: 'boolean',
        description: 'Whether to fetch your user profile',
        default: true,
      },
      includeProjects: {
        type: 'boolean',
        description: 'Whether to fetch your projects',
        default: false,
      },
      includeGroups: {
        type: 'boolean',
        description: 'Whether to fetch your groups',
        default: false,
      },
      includeIssues: {
        type: 'boolean',
        description: 'Whether to fetch recent issues for projectPath',
        default: false,
      },
      projectPath: {
        type: 'string',
        description: 'GitLab namespace/project path used when includeIssues is true',
      },
      issueLimit: {
        type: 'integer',
        minimum: 1,
        maximum: 100,
        description: 'Maximum number of recent issues to return',
        default: 10,
      },
      issueState: {
        type: 'string',
        enum: ['opened', 'closed', 'all'],
        description: 'Issue state to return',
        default: 'all',
      },
    },
    additionalProperties: false,
  } as const satisfies JSONSchema7,
  code: `async ({
    forceLogin = false,
    includeProfile = true,
    includeProjects = false,
    includeGroups = false,
    includeIssues = false,
    projectPath,
    issueLimit = 10,
    issueState = 'all',
  }, ctx) => {
    const gitlabBase = 'https://gitlab.com/api/v4'
    const credsString = await ctx.getSecret('oauth-creds', false)
    const credentials = credsString ? JSON.parse(credsString) : null
    const token = typeof credentials?.access_token === 'string' ? credentials.access_token : null
    const expiresAt =
      Number.isFinite(credentials?.created_at) && Number.isFinite(credentials?.expires_in)
        ? credentials.created_at + Math.max(0, credentials.expires_in - 300) * 1000
        : null
    const tokenExpired = expiresAt !== null && Date.now() >= expiresAt
    const continuationArguments = {
      forceLogin: false,
      includeProfile,
      includeProjects,
      includeGroups,
      includeIssues,
      ...(projectPath ? { projectPath } : {}),
      issueLimit,
      issueState,
    }
    const loginContinuation = [[
      toolCall({
        name: 'ensureOauthLogin',
        arguments: {
          oauthURL: '${OAUTH_PROVIDERS.gitlab.authUrl}',
          clientId: '${OAUTH_PROVIDERS.gitlab.clientId}',
          tokenUrl: '${OAUTH_PROVIDERS.gitlab.TokenUrl}',
          scope: 'read_user read_api',
        },
      }),
      toolCall({ name: 'getGitlabInfo', arguments: continuationArguments }),
    ]]

    if (!token || tokenExpired || forceLogin) {
      return ctx.createSubtasksResult(loginContinuation)
    }
    if (includeIssues && !projectPath) {
      throw new Error('projectPath is required when includeIssues is true')
    }

    const requests = []
    if (includeProfile) requests.push({ key: 'profile', path: '/user' })
    if (includeProjects) {
      requests.push({ key: 'projects', path: '/projects?membership=true&per_page=100' })
    }
    if (includeGroups) requests.push({ key: 'groups', path: '/groups?per_page=100' })
    if (includeIssues) {
      const query =
        'per_page=' + issueLimit + '&order_by=created_at&sort=desc&state=' + issueState
      requests.push({
        key: 'issues',
        path: '/projects/' + encodeURIComponent(projectPath) + '/issues?' + query,
      })
    }

    const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token }
    const data = {}
    for (const request of requests) {
      const response = await fetch(gitlabBase + request.path, { headers })
      if (response.status === 401) {
        return ctx.createSubtasksResult(loginContinuation)
      }
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 1000)
        throw new Error(
          'GitLab request failed (' + response.status + ' ' + response.statusText + ')' +
            (detail ? ': ' + detail : ''),
        )
      }
      const result = await response.json()
      if (request.key === 'projects') {
        data.projects = result.map((project) => ({
          id: project.id,
          name: project.name,
          description: project.description,
          web_url: project.web_url,
          star_count: project.star_count,
        }))
      } else if (request.key === 'issues') {
        data.issues = result.map((issue) => ({
          iid: issue.iid,
          title: issue.title,
          state: issue.state,
          web_url: issue.web_url,
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          author: issue.author
            ? { username: issue.author.username, name: issue.author.name }
            : null,
        }))
      } else {
        data[request.key] = result
      }
    }

    return data
  }`,
})

/**
 * issueListGenerator (revamped)
 * ------------------------------------------------------------------
 * First call :  ↳ (a) ensure we have an access‑token
 *                    – if not, schedule ensureOauthLogin, then re‑run
 *                ↳ (b) fetch projects and render checklist UI
 * Second call:  waits for postMessage → summarizes the chosen issues
 */
export const issueListGenerator = createTool({
  name: 'issueListGenerator',
  // ── SHORT DESCRIPTION ─────────────────────────────────────────
  description:
    'Generate a checklist UI from candidate issue titles, let the user pick the target GitLab project, then create the issues on GitLab.',

  // ── LONG DESCRIPTION ──────────────────────────────────────────
  longDescription: `This is an interactive, write-capable GitLab workflow. It authenticates with API scope, loads the user's projects, presents an embedded project-and-issue checklist, waits for the user's selection, and creates only the selected issues. Each write is reported independently with its resulting link or error; selection state remains client-side.`,

  // ── PARAMETERS ────────────────────────────────────────────────
  parameters: {
    type: 'object',
    properties: {
      issuelist: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Array of *candidate issue titles*.  **Titles should be concise, precise and rich in keywords** so they are easy to find via GitLab`s issue search. The model may (and should) freely re-phrase raw user text to achieve this without losing information. It is also OK to split large issues into smaller ones (only if this is better).',
      },
      project: {
        type: 'string',
        description: 'Optional GitLab project identifier to pre‑select.',
      },
    },
    required: ['issuelist'],
    additionalProperties: false,
  } as const satisfies JSONSchema7,
  function: async ({ issuelist, project }, ctx) => {
    if (!ctx.fetch) throw new Error('GitLab access requires the mediated fetch capability.')
    const GITLAB_BASE = 'https://gitlab.com/api/v4'
    const credsString = await ctx.getSecret('oauth-creds', false)
    let TOKEN: string | undefined = undefined
    if (credsString) {
      const oldCreds = JSON.parse(credsString) as OAuthCredentials
      const refreshedCreds = await useRefreshTokenIfExpired(oldCreds, {
        clientId: OAUTH_PROVIDERS.gitlab.clientId,
        tokenUrl: OAUTH_PROVIDERS.gitlab.TokenUrl,
        fetch: ctx.fetch,
      })
      TOKEN = refreshedCreds?.access_token
    }

    /*───────────────────────────────────────────────────────────
      PHASE 1 — auth & UI
    ───────────────────────────────────────────────────────────*/
    if (!TOKEN) {
      return ctx.createSubtasksResult([
        [
          toolCall({
            name: 'ensureOauthLogin',
            arguments: {
              oauthURL: OAUTH_PROVIDERS.gitlab.authUrl,
              clientId: OAUTH_PROVIDERS.gitlab.clientId,
              tokenUrl: OAUTH_PROVIDERS.gitlab.TokenUrl,
              scope: 'api',
            },
          }),
          toolCall({ name: 'issueListGenerator', arguments: { issuelist, project } }),
        ],
      ])
    }

    /*───────────────────────────────────────────────────────────
      PHASE 2 — called from the iframe postMessage
    ───────────────────────────────────────────────────────────*/
    const taskChain = await ctx.getExecutionTaskChain()
    const prev = taskChain.at(-3)
    const thisMsg = taskChain.at(-1)
    if (
      prev?.content.type === 'functioncall' &&
      prev.content.data.name === 'issueListGenerator' &&
      Array.isArray(prev?.content.data.arguments.issuelist) &&
      prev?.content.data.arguments.issuelist.length === issuelist.length &&
      thisMsg?.parentID === prev.id
    ) {
      if (!ctx.waitForInteraction) {
        throw new Error('Issue selection interaction is unavailable.')
      }
      const payload = await ctx.waitForInteraction()
      const res = parseIssueSelectionInteraction(payload)

      if (res === 'cancelled')
        return ctx.createSubtasksResult([
          [
            {
              role: 'assistant',
              content: {
                type: 'message',
                data: 'You cancelled the send dialog. Would you like to change anything?',
              },
            },
          ],
        ])

      const { projectId, projectName, issues } = res
      const createdUrls: string[] = []
      const results: { title: string; ok: boolean; error?: string }[] = []

      if (TOKEN && projectId) {
        const headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKEN}`,
        }
        const base = `${GITLAB_BASE}/projects/${encodeURIComponent(projectId)}/issues`

        for (const title of issues) {
          if (!issuelist.includes(title)) continue
          try {
            const res = await ctx.fetch(base, {
              method: 'POST',
              headers,
              body: JSON.stringify({ title, description: 'Auto‑generated from Taskyon' }),
            })
            if (res.ok) {
              const json = await res.json()
              createdUrls.push(json.web_url as string)
              results.push({ title, ok: true })
            } else {
              const text = await res.text()
              results.push({ title, ok: false, error: `HTTP ${res.status}: ${text}` })
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err)
            results.push({ title, ok: false, error: errorMsg })
          }
        }
      } else {
        for (const title of issues) {
          results.push({ title, ok: false, error: 'No token / project ID' })
        }
      }

      const allIssuesUrl = `https://gitlab.com/${projectName}/-/issues`
      const newIssuesLinks = createdUrls.join(', ')

      const summary =
        `📋 Attempted ${issues.length} issue(s)` +
        (projectName ? ` in “${projectName}”:\n\n` : ':\n\n') +
        results.map((r) => `- ${r.title} ${r.ok ? '✓' : `❌ ${r.error}`}`).join('\n') +
        `\n\n🔗 All issues: ${allIssuesUrl}` +
        (createdUrls.length ? `\n🔗 Newly created: ${newIssuesLinks}` : '')

      return ctx.createSubtasksResult([
        [{ role: 'assistant', content: { type: 'message', data: summary } }],
      ])
    }

    /*───────────────────────────────────────────────────────────
      PHASE 1b — fetch projects & render UI
    ───────────────────────────────────────────────────────────*/
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }
    const projRes = await ctx.fetch(`${GITLAB_BASE}/projects?membership=true&per_page=100`, {
      headers,
    })
    type GitlabProject = { id: number; path_with_namespace: string }
    const projects = ((await projRes.json()) as GitlabProject[])
      .map((p) => ({
        id: p.id,
        path: p.path_with_namespace,
      }))
      .sort((a, b) => a.path.localeCompare(b.path))
    const projOptions = projects
      .map(
        (p) =>
          `<option value="${p.id}"${
            project && (project === p.path || project === String(p.id)) ? ' selected' : ''
          }>${p.path}</option>`,
      )
      .join('\n')

    // html without indentation to make markdown render it correctly
    const uiHtml = `<div style="font-family:sans-serif;max-width:420px">
  <h3>Pick target project & issues</h3>
  <label style="display:block;margin-bottom:.5rem">
    Project:
    <select id="project-select" style="margin-left:.5rem">
      ${projOptions}
    </select>
  </label>
  <ul id="issueList" style="list-style:none;padding-left:0">
    ${issuelist
      .map(
        (issue) =>
          `<li><label><input type="checkbox" value="${String(issue).replace(/"/g, '&quot;')}"> ${issue}</label></li>`,
      )
      .join('\n')}
  </ul>
  <div style="margin-top:.75rem;display:flex;gap:0.5rem">
    <button id="submit-issues">Submit</button>
    <button id="cancel-issues" style="background:#eee;color:#444">Cancel</button>
  </div>
</div>
<script>
  document.getElementById('submit-issues').addEventListener('click', () => {
    const selectedIssues = Array.from(document.querySelectorAll('#issueList input:checked'))
      .map(el => el.value);
    const select = document.getElementById('project-select');
    const selectedProjectId = select.value;
    const selectedProjectName = select.options[select.selectedIndex].textContent;
    window.parent.postMessage(
      { selectedIssues, selectedProjectId, selectedProjectName },
      '*'
    );
  });
  document.getElementById('cancel-issues').addEventListener('click', () => {
    window.parent.postMessage("cancelled", '*');
  });
</script>`

    return ctx.createSubtasksResult([
      [
        { role: 'assistant', content: { type: 'message', data: uiHtml } },
        toolCall({ name: 'issueListGenerator', arguments: { issuelist, project } }),
      ],
    ])
  },
})

const gitReader = createTool({
  name: 'gitReader',
  description: 'Read a file or directory from a remote Git repository at a chosen revision.',
  longDescription:
    'The repository is fetched into an in-memory browser filesystem using isomorphic-git, so it does not modify the local workspace. Browser execution may require the configured CORS proxy and dynamically loaded Git runtime assets.',
  renderOptions: {
    hideChat: false,
    hideLlm: false,
  },
  parameters: {
    type: 'object',
    required: ['repoUrl', 'filePath'],
    properties: {
      repoUrl: {
        type: 'string',
        description: 'The URL of the Git repository to clone or fetch.',
      },
      filePath: {
        type: 'string',
        description: 'The path to the file or directory to extract from the repository.',
      },
      ref: {
        type: 'string',
        description: 'The branch, tag, or commit to checkout. Defaults to HEAD.',
        default: 'HEAD',
      },
      corsProxy: {
        type: 'string',
        description:
          'The URL of a CORS proxy to use for the repository fetch. Defaults to "https://cors.isomorphic-git.org".',
        default: 'https://cors.isomorphic-git.org',
      },
    },
  } as const satisfies JSONSchema7,
  code: `async ({ repoUrl, filePath, ref = "HEAD", corsProxy = "https://cors.isomorphic-git.org" }) => {
  try {
    // Ensure isomorphic-git is loaded on the window
    if (!window.git) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/isomorphic-git';
        script.async = true;
        script.onload = () => {
          console.log('isomorphic-git loaded.');
          resolve();
        };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    // Dynamically import memfs (ESM version) from jspm.dev
    const { fs } = await import('https://jspm.dev/memfs');

    const httpModule = await import('https://unpkg.com/isomorphic-git/http/web/index.js');
    http = httpModule.default || httpModule;

    const dir = '/repo';
    await git.clone({
      fs,
      http,
      dir,
      url: repoUrl,
      singleBranch: true,
      depth: 1,
      ref,
      corsProxy,
    });

    const fileContent = await fs.promises.readFile(\`\${dir}/\${filePath}\`, { encoding: 'utf8' });
    return { success: true, content: fileContent };
  } catch (error) {
    return { success: false, error: error.message };
  }
}`,
})

export const devTools = [issueListGenerator, getGitlabInfo, gitReader]
