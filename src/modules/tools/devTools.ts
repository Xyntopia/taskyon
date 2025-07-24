import type { JSONSchema7 } from 'json-schema'
import { createTool, toolCall, makeTaskResult } from '../taskyon/tools'

const CLIENT_ID = '56a06d49cd5ed412d47ced662b9e6ae297aecadf25cae9f0e036ca0ef299444b'
const OAUTH_URL = 'https://gitlab.com/oauth/authorize'
const GITLAB_TOKEN_URL = 'https://gitlab.com/oauth/token'

async function refreshGitlabToken(refreshToken: string) {
  if (!refreshToken || !CLIENT_ID) {
    throw new Error('Missing refresh token or client ID in secret store')
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: CLIENT_ID,
  })

  const res = await fetch(GITLAB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Token refresh failed (${res.status}): ${body}`)
  }

  const {
    access_token: accessToken,
    refresh_token: refreshToken2,
    expires_in,
    created_at,
  } = (await res.json()) as {
    access_token: string
    refresh_token: string
    expires_in: number
    created_at: number
  }

  // optional: track expiry
  // await ctx.setSecret('oauth-expires-at', String(Date.now() + expires_in * 1000))

  return { accessToken, refreshToken: refreshToken2, expiresAt: created_at + expires_in }
}

const getGitlabInfo = createTool({
  name: 'getGitlabInfo',
  description: 'Fetch selected parts of your GitLab data (profile, projects, groups).',
  longDescription: `Use boolean flags to choose which pieces to retrieve. If none are set, only your profile is returned.

  Flags:
  - includeProfile (default: true)
  - includeProjects (default: false)
  - includeGroups (default: false)

  You can still pass { forceLogin: true } to drop the old token and re-authenticate.`,
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
    },
    additionalProperties: false,
  },
  function: async (
    { forceLogin = false, includeProfile = true, includeProjects = false, includeGroups = false },
    ctx,
  ) => {
    // 1) handle auth
    const GITLAB_BASE = 'https://gitlab.com/api/v4'
    const EXPIRES = await ctx.getSecret('oauth-expires-at', false)
    let TOKEN: string | undefined
    if (EXPIRES) {
      const EXPIRESINT = parseInt(EXPIRES, 10)
      if (isNaN(EXPIRESINT) || EXPIRESINT < Date.now()) {
        console.warn('GitLab token expired, refreshing...')
        try {
          const refreshTOKEN = await ctx.getSecret('oauth-refresh-token', false)
          if (!refreshTOKEN) {
            throw new Error('No refresh token available in secret store')
          }
          const { accessToken, refreshToken, expiresAt } = await refreshGitlabToken(refreshTOKEN)
          await ctx.setSecret('oauth-access-token', accessToken)
          await ctx.setSecret('oauth-refresh-token', refreshToken)
          await ctx.setSecret('oauth-expires-at', String(expiresAt))
          TOKEN = accessToken
        } catch (e) {
          console.error('Failed to refresh GitLab token:', e)
          TOKEN = undefined // force re-login
        }
      } else {
        TOKEN = await ctx.getSecret('oauth-access-token', false)
      }
    }

    if (!TOKEN || forceLogin) {
      return makeTaskResult([
        [
          toolCall({
            name: 'ensureOauthLogin',
            arguments: {
              oauthURL: OAUTH_URL,
              clientId: CLIENT_ID,
              scope: 'read_user read_api',
              toolId: ctx.toolId,
            },
          }),
          toolCall({ name: 'getGitlabInfo', arguments: {} }),
        ],
      ])
    }

    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }
    const data: Record<string, unknown> = {}

    // 2) conditional fetches
    if (includeProfile) {
      const res = await fetch(`${GITLAB_BASE}/user`, { headers })
      data.profile = await res.json()
    }
    if (includeProjects) {
      const res = await fetch(`${GITLAB_BASE}/projects?membership=true&per_page=100`, { headers })
      const projInfo = (await res.json()) as Record<string, unknown>[]
      data.projects = projInfo.map((proj) =>
        Object.fromEntries(
          ['id', 'name', 'description', 'web_url', 'star_count'].map((k) => [k, proj[k]]),
        ),
      )
    }
    if (includeGroups) {
      const res = await fetch(`${GITLAB_BASE}/groups?per_page=100`, { headers })
      data.groups = await res.json()
    }

    return makeTaskResult([
      [
        {
          role: 'assistant',
          content: { type: 'structured', data },
        },
      ],
    ])
  },
})

/**
 * issueListGenerator (revamped)
 * ---------------------------------
 * First call: renders a checklist UI in an iframe. When the user clicks
 * "Submit", the iframe posts a MessagePort message containing the selected
 * issues.
 * Second call: receives that message via `ctx.messagePort`, parses the
 * payload, and returns a human‑readable summary of the issues that would be
 * created in GitLab (publishing is commented‑out for now).
 */
export const issueListGenerator = createTool({
  name: 'issueListGenerator',
  description:
    'Converts a text message into a list of issues, shows a checklist UI, then waits for user confirmation via postMessage.',
  longDescription: `Extract issues from chat, let the user confirm which ones should become GitLab issues, and (in a future revision) create them. This version only returns a summary string of the selected issues.`,
  parameters: {
    type: 'object',
    properties: {
      issuelist: {
        type: 'array',
        items: { type: 'string' },
        description: 'The candidate issues (already extracted from text).',
      },
      project: {
        type: 'string',
        description: 'GitLab project identifier (namespace/name).',
      },
    },
    required: ['issuelist'],
    additionalProperties: false,
  } as const satisfies JSONSchema7,
  function: async ({ issuelist, project }, ctx) => {
    /* ─────────────────────────────────────────────────────────────────────┐
       SECOND CALL – handle MessagePort payload
       ─────────────────────────────────────────────────────────────────────┘*/
    const previousCall = ctx.taskChain.at(-3)
    const thisMessage = ctx.taskChain.at(-1)

    if (
      previousCall?.content.type === 'functioncall' &&
      previousCall.content.data.name === 'issueListGenerator' &&
      thisMessage?.parentID === previousCall.id
    ) {
      // Wait for the postMessage from the UI
      const selectedIssues = await new Promise<string[]>((resolve) => {
        const port = ctx.messagePort as MessagePort
        port.onmessage = (ev) => {
          if (ev.data.payload.selectedIssues) resolve(ev.data.payload.selectedIssues)
        }
      })

      const summary = [
        `📋 Ready to create ${selectedIssues.length} issue(s)` +
          (project ? ` in “${project}”:\n\n` : ''),
        ...selectedIssues.map((i) => `- ${i}`),
      ].join('\n')

      // TODO: actually POST to GitLab – code commented‑out for now
      /*
      const GITLAB_API_URL = `https://gitlab.com/api/v4/projects/${encodeURIComponent(project)}/issues`
      const TOKEN = await ctx.getSecret('oauth-access-token', false)
      if (TOKEN) {
        for (const issue of selectedIssues) {
          await fetch(GITLAB_API_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${TOKEN}`,
            },
            body: JSON.stringify({ title: issue, description: 'Auto‑generated from Taskyon' }),
          })
        }
      }
      */

      return makeTaskResult([
        [
          {
            role: 'assistant',
            content: { type: 'message', data: summary },
          },
        ],
      ])
    }

    /* ─────────────────────────────────────────────────────────────────────┐
       FIRST CALL – render checklist UI & schedule follow‑up invocation
       ─────────────────────────────────────────────────────────────────────┘*/
    const uiHtml = /* html */ `
      <div style="font-family: sans-serif; max-width: 400px;">
        <h3>Select issues to submit${project ? ` to <em>${project}</em>` : ''}</h3>
        <ul id="issueList" style="list-style: none; padding-left: 0;">
          ${issuelist
            .map(
              (issue) =>
                `<li><label><input type="checkbox" value="${issue.replace(/"/g, '&quot;')}"> ${issue}</label></li>`,
            )
            .join('\n')}
        </ul>
        <button id="submit-issues" style="margin-top: 0.5rem;">Submit</button>
      </div>
      <script>
        document.getElementById('submit-issues').addEventListener('click', () => {
          const selected = Array.from(document.querySelectorAll('#issueList input:checked')).map(el => el.value);
          window.parent.postMessage({ selectedIssues: selected }, '*');
        });
      </script>
    `

    return makeTaskResult([
      [
        {
          role: 'assistant',
          content: { type: 'message', data: uiHtml },
        },
        toolCall({ name: 'issueListGenerator', arguments: { issuelist, project } }),
      ],
    ])
  },
})

const gitReader = createTool({
  name: 'gitReader',
  description:
    'Extracts files from a Git repository using isomorphic-git with memfs and a dynamically imported HTTP client.',
  longDescription:
    "This tool clones or fetches a Git repository and extracts the contents of a specified file or directory using isomorphic-git. It dynamically imports memfs from jspm.dev to simulate a virtual filesystem in the browser and loads the HTTP client from isomorphic-git's web module (from unpkg) if none is provided. This setup enables browser-based Git operations without additional bundling.",
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
