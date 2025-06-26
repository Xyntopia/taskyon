import type { JSONSchema7 } from 'json-schema'
import { createTool, createToolTask, makeTaskResult } from '../taskyon/tools'

const CLIENT_ID = '56a06d49cd5ed412d47ced662b9e6ae297aecadf25cae9f0e036ca0ef299444b'
const OAUTH_URL = 'https://gitlab.com/oauth/authorize'

const getGitlabInfo = createTool({
  name: 'getGitlabInfo',
  description: 'Read-only fetch of your GitLab profile, projects, and groups.',
  longDescription: `Calls the GitLab REST API with a read-only token to retrieve:
  1) Your user profile (username, name, avatar_url, email, bio)
  2) A list of your projects (id, name, web_url, visibility)
  3) A list of your groups (id, name, web_url, access_level)`,
  parameters: {
    type: 'object',
    properties: {
      // No required inputs for profile/projects/groups
    },
    additionalProperties: false,
  },
  function: async (_args, ctx) => {
    const GITLAB_BASE = 'https://gitlab.com/api/v4'
    console.log('getGitlabInfo called', GITLAB_BASE)
    const TOKEN = await ctx.getSecret('oauth-acces-token', false)
    console.log('getGitlabInfo oauth-access-token', TOKEN)
    if (!TOKEN) {
      return makeTaskResult([
        [
          createToolTask({
            name: 'ensureOauthLogin',
            arguments: {
              oauthURL: OAUTH_URL,
              clientId: CLIENT_ID,
              scope: 'read_user',
              toolId: ctx.toolId,
            },
          }),
          //createToolTask({ name: 'getGitlabInfo', arguments: {} }),
        ],
      ])
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    }

    // 1) Profile
    const profileRes = await fetch(`${GITLAB_BASE}/user`, { headers })
    const profile = await profileRes.json()
    console.log('getGitlabInfo profile', profile)
    /*
    // 2) Projects you’re a member of
    const projectsRes = await fetch(`${GITLAB_BASE}/projects?membership=true&per_page=100`, {
      headers,
    })
    const projects = await projectsRes.json()

    // 3) Groups you belong to
    const groupsRes = await fetch(`${GITLAB_BASE}/groups?per_page=100`, { headers })
    const groups = await groupsRes.json()

    return makeTaskResult([
      [
        {
          role: 'assistant',
          content: {
            type: 'structured',
            data: { profile, projects, groups },
          },
        },
      ],
    ])*/
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
          createToolTask({
            name: 'ensureOauthLogin',
            arguments: {
              oauthURL: OAUTH_URL,
              clientId: CLIENT_ID,
              scope: 'read_user',
              toolId: ctx.toolId,
            },
          }),
          /*createToolTask({
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

export const devTools = [issueListGenerator, getGitlabInfo, gitReader, testSecretStore]
