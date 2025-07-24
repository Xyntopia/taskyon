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

const issueListGenerator = createTool({
  name: 'issueListGenerator',
  description:
    'Converts a text message into a list of issues and then generates a UI for review and GitLab submission.',
  longDescription: `This tool takes a text input and extracts a structured list of issues,
    formatted similarly to user stories. It then generates a simple HTML-based UI for reviewing
    the issues, allowing users to check off items and submit them to GitLab. The UI
    includes a checklist of extracted issues and a submission button. This tool is useful for
    developers looking to streamline the process of converting brainstorming discussions or chat
    messages into actionable development tasks.`,
  parameters: {
    type: 'object',
    properties: {
      issuelist: {
        type: 'array',
        items: {
          type: 'string',
        },
        description: `Extract a list of issues from the text which we could use
in gitlab. They should roughly follow the style of a "user story".`,
      },
      project: {
        type: 'string',
        description: 'The name of the GitLab project where issues will be submitted.',
      },
    },
    required: ['issuelist'],
  } as const satisfies JSONSchema7,
  function: async ({ issuelist, project }, ctx) => {
    const GITLAB_API_URL = await ctx.getSecret(
      `https://gitlab.com/api/v4/projects/${encodeURIComponent(project || '')}/issues`,
      true,
    )
    const GITLAB_ACCESS_TOKEN = await ctx.getSecret('oauth-acces-token', false) // Replace with actual project ID

    if (!GITLAB_ACCESS_TOKEN) {
      // information needed to register with gitlab
      return makeTaskResult([
        [
          toolCall({
            name: 'ensureOauthLogin',
            arguments: {
              oauthURL: OAUTH_URL,
              clientId: CLIENT_ID,
              scope: 'read_user',
              toolId: ctx.toolId,
            },
          }),
          /*toolCall({
            name: 'issueListGenerator',
            arguments: { issuelist, project },
          }),*/
        ],
      ])
    }

    const uiHtml = `<div>
    <ul id="issueList">
      ${issuelist
        .map(
          (issue, index) =>
            `<li>
          <input type="checkbox" id="issue-${index}" value="${issue}" />
          <label for="issue-${index}">${issue}</label>
        </li>`,
        )
        .join('\n')}
    </ul>
    <button onclick="uploadIssues()">Submit</button>
  </div>
  <script>
    function uploadIssues() {
      const selectedIssues = [];
      document.querySelectorAll('#issueList input:checked').forEach(el => {
        selectedIssues.push(el.value);
      });

      if (selectedIssues.length === 0) {
        alert('No issues selected!');
        return;
      }

      console.log('Submitting issues:', selectedIssues);

      const GITLAB_ACCESS_TOKEN = 'YOUR_GITLAB_ACCESS_TOKEN'; // Replace with actual token
      const GITLAB_API_URL = '${GITLAB_API_URL}';

      selectedIssues.forEach(issue => {
        fetch(GITLAB_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + ${GITLAB_ACCESS_TOKEN}
          },
          body: JSON.stringify({
            title: issue,
            description: 'Auto-generated issue from AI chat tool',
          })
        })
        .then(response => response.json())
        .then(data => console.log('Issue created:', data))
        .catch(error => console.error('Error submitting issue:', error));
      });

      alert('Issues submitted to GitLab!');
    }
  </script>`
    return makeTaskResult([
      [
        {
          role: 'assistant',
          content: {
            type: 'message',
            data: `Check each issue you think is legitimate and want to upload!` + uiHtml,
          },
        },
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

const testSecretStore = createTool({
  name: 'testSecretStore',
  description: 'Sets then gets a secret in the SecretStore to verify it works.',
  parameters: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'The secret key to test',
        default: 'test-secret-key',
      },
      value: {
        type: 'string',
        description: 'The value to store under that key',
        default: 'test-secret-value',
      },
    },
    required: ['key', 'value'],
    additionalProperties: false,
  } as const satisfies JSONSchema7,
  function: async ({ key, value }, ctx) => {
    const TOKEN = await ctx.getSecret('oauth-access-token', false)
    console.log('testSecretStore oauth-access-token', TOKEN)

    // read it back (force unencrypted fetch)
    const seeifitsthere = await ctx.getSecret(key, false)
    console.log('seeifitsthere', seeifitsthere)

    // store the secret
    console.log('setting secret', key, value)
    await ctx.setSecret(key, value)

    console.log('retrieving secret', key, value)
    // read it back (force unencrypted fetch)
    const retrieved = await ctx.getSecret(key, false)

    console.log('retrieved secret', retrieved)
    return makeTaskResult([
      [
        {
          role: 'assistant',
          content: {
            type: 'structured',
            data: { key, setValue: value, retrievedValue: retrieved },
          },
        },
      ],
    ])
  },
})

/**
 * postMessageTester
 * -----------------
 * A minimal tool that:
 *  1. Renders an HTML button.
 *  2. When the button is clicked, the UI posts a message through a MessageChannel.
 *  3. On its next invocation, the tool receives that message via `ctx.port`
 *     and shows an alert.
 */
export const postMessageTester = createTool({
  name: 'postMessageTester',
  description:
    'Demo tool for the Taskyon MessageChannel feature: shows a button, waits for a postMessage, then alerts.',
  parameters: {
    type: 'object',
    additionalProperties: false,
  } as const satisfies JSONSchema7,
  code: `async (_, ctx) => {
    const previousCall = ctx.taskChain.at(-3)
    const thisMessage = ctx.taskChain.at(-1)
    // ────────────────────────────────────────────────────────────────────────────
    // SECOND CALL ─ the MessagePort is available in ctx.port
    // ────────────────────────────────────────────────────────────────────────────
    if (
      previousCall?.content.type === 'functioncall' &&
      previousCall.content.data.name === 'postMessageTester' &&
      thisMessage?.parentID === previousCall.id
    ) {
      console.log('waiting for message from UI...')
      const msg = await new Promise((resolve) => {
        const port = ctx.messagePort
        port.onmessage = (ev) => {
          if (ev.data.payload.text === 'Button pressed!') resolve(JSON.stringify(ev.data))
          else console.log('Received message, still waiting for button press...:', ev.data)
        }
      })
      return makeTaskResult([
        [
          {
            role: 'assistant',
            content: {
              type: 'message',
              data: \`Received message from UI: \${msg}\`,
            },
          },
        ],
      ])
    }

    // ────────────────────────────────────────────────────────────────────────────
    // FIRST CALL ─ render UI and schedule follow-up
    // ────────────────────────────────────────────────────────────────────────────
    const uiHtml = /* html */ \`
  <div>
    <button id="demo-btn">Click to send message</button>
  </div>

  <script type="module">
    // When the user clicks the button, post a message to the parent window (assuming this is an iframe).
    document.getElementById('demo-btn').addEventListener('click', () => {
    window.parent.postMessage({ clickedAt: Date.now(), text: 'Button pressed!' }, '*');
    });
  </script>
  \`

    console.log('Rendering UI for postMessageTester...')
    // Return the UI now, and queue up a second call to this same tool.
    return makeTaskResult([
      [
        {
          role: 'assistant',
          content: { type: 'message', data: uiHtml },
        },
        toolCall({ name: 'postMessageTester', arguments: {} }),
      ],
    ])
  }`,
})

export const testingTools = [postMessageTester, testSecretStore]

export const devTools = [issueListGenerator, getGitlabInfo, gitReader]
