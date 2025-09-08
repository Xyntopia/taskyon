import type { JSONSchema7 } from 'json-schema'
import { createTool, makeTaskResult, toolCall } from '@taskyon/taskyon'
import { OAUTH_PROVIDERS, useRefreshTokenIfExpired } from '../oauth'
import type { OAuthCredentials } from '../taskyon/types'

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
    const credsString = await ctx.getSecret('oauth-creds', false)
    let TOKEN = null
    if (credsString) {
      const oldCreds = JSON.parse(credsString) as OAuthCredentials
      const refreshedCreds = await useRefreshTokenIfExpired(oldCreds, {
        clientId: OAUTH_PROVIDERS.gitlab.clientId,
        tokenUrl: OAUTH_PROVIDERS.gitlab.TokenUrl,
      })
      TOKEN = refreshedCreds?.access_token
    }

    if (!TOKEN || forceLogin) {
      return makeTaskResult([
        [
          toolCall({
            name: 'ensureOauthLogin',
            arguments: {
              oauthURL: OAUTH_PROVIDERS.gitlab.authUrl,
              clientId: OAUTH_PROVIDERS.gitlab.clientId,
              tokenUrl: OAUTH_PROVIDERS.gitlab.TokenUrl,
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
 * ------------------------------------------------------------------
 * First call :  ↳ (a) ensure we have an access‑token
 *                    – if not, schedule ensureOauthLogin, then re‑run
 *                ↳ (b) fetch projects and render checklist UI
 * Second call:  waits for postMessage → summarises the chosen issues
 */
export const issueListGenerator = createTool({
  name: 'issueListGenerator',
  // ── SHORT DESCRIPTION ─────────────────────────────────────────
  description:
    'Generate a checklist UI from candidate issue titles, let the user pick the target GitLab project, then create the issues on GitLab.',

  // ── LONG DESCRIPTION ──────────────────────────────────────────
  longDescription: `Workflow
1. Ensures the user is logged in with “api” scope (read + write).
2. Retrieves all projects the user is a member of and embeds an iframe UI
    (dropdown for project, checkbox list for issues, “Submit” button).
3. Waits for a postMessage containing { selectedProjectId, selectedProjectName, selectedIssues }.
4. Creates each selected issue via POST /v4/projects/:id/issues, recording success
    or the exact HTTP / network error for every title.
5. Responds with a markdown summary that:
   - shows ✓ or ❌ per issue together with any error text
   - links to the project's complete issue list
   - links directly to the newly created issues.

The tool never stores content server-side; everything runs client-side in the Taskyon iframe.`,

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
    const GITLAB_BASE = 'https://gitlab.com/api/v4'
    const credsString = await ctx.getSecret('oauth-creds', false)
    let TOKEN: string | undefined = undefined
    if (credsString) {
      const oldCreds = JSON.parse(credsString) as OAuthCredentials
      const refreshedCreds = await useRefreshTokenIfExpired(oldCreds, {
        clientId: OAUTH_PROVIDERS.gitlab.clientId,
        tokenUrl: OAUTH_PROVIDERS.gitlab.TokenUrl,
      })
      TOKEN = refreshedCreds?.access_token
    }

    /*───────────────────────────────────────────────────────────
      PHASE 1 — auth & UI
    ───────────────────────────────────────────────────────────*/
    if (!TOKEN) {
      return makeTaskResult([
        [
          toolCall({
            name: 'ensureOauthLogin',
            arguments: {
              oauthURL: OAUTH_PROVIDERS.gitlab.authUrl,
              clientId: OAUTH_PROVIDERS.gitlab.clientId,
              tokenUrl: OAUTH_PROVIDERS.gitlab.TokenUrl,
              scope: 'api',
              toolId: ctx.toolId,
            },
          }),
          toolCall({ name: 'issueListGenerator', arguments: { issuelist, project } }),
        ],
      ])
    }

    /*───────────────────────────────────────────────────────────
      PHASE 2 — called from the iframe postMessage
    ───────────────────────────────────────────────────────────*/
    const prev = ctx.taskChain.at(-3)
    const thisMsg = ctx.taskChain.at(-1)
    if (
      prev?.content.type === 'functioncall' &&
      prev.content.data.name === 'issueListGenerator' &&
      Array.isArray(prev?.content.data.arguments.issuelist) &&
      prev?.content.data.arguments.issuelist.length === issuelist.length &&
      thisMsg?.parentID === prev.id
    ) {
      const res = await new Promise<
        | {
            projectId: string
            projectName: string
            issues: string[]
          }
        | 'cancelled'
      >((resolve) => {
        ;(ctx.messagePort as MessagePort).onmessage = (ev) => {
          if (ev.data.payload === 'cancelled') {
            resolve('cancelled')
          }
          if (ev.data.payload?.selectedIssues) {
            resolve({
              projectId: ev.data.payload.selectedProjectId,
              projectName: ev.data.payload.selectedProjectName,
              issues: ev.data.payload.selectedIssues,
            })
          }
        }
      })

      if (res === 'cancelled')
        return makeTaskResult([
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
            const res = await fetch(base, {
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

      return makeTaskResult([[{ role: 'assistant', content: { type: 'message', data: summary } }]])
    }

    /*───────────────────────────────────────────────────────────
      PHASE 1b — fetch projects & render UI
    ───────────────────────────────────────────────────────────*/
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }
    const projRes = await fetch(`${GITLAB_BASE}/projects?membership=true&per_page=100`, { headers })
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

    return makeTaskResult([
      [
        { role: 'assistant', content: { type: 'message', data: uiHtml } },
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
