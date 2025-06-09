import type { JSONSchema7 } from 'json-schema'
import { createTool, makeTaskResult } from '../taskyon/tools'

declare global {
  interface Window {
    [key: string]: unknown
  }
}

const makeOauthLogin = ({
  serviceName,
  clientId,
  scope,
}: {
  serviceName: string
  clientId: string
  scope: string
}) => {
  const redirectUri = `${window.location.origin}/oauth/return/${serviceName}` as const

  const html = `
<div>
  <button id="oauth-btn">Login with ${serviceName}</button>
</div>
<script>
  (async () => {
    const btn = document.getElementById('oauth-btn');
    btn.addEventListener('click', async () => {
      // generate PKCE verifier + challenge
      const array = new Uint8Array(64);
      crypto.getRandomValues(array);
      const verifier = btoa(String.fromCharCode(...array))
        .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');

      // stash PKCE & config
      sessionStorage.setItem('oauth_pkce_verifier_${serviceName}', verifier);
      sessionStorage.setItem('oauth_config_${serviceName}', JSON.stringify({ clientId: '${clientId}' }));

      // redirect to GitLab
      const url = [
        'https://gitlab.com/oauth/authorize',
        '?client_id=' + encodeURIComponent('${clientId}'),
        '&redirect_uri=' + encodeURIComponent('${redirectUri}'),
        '&response_type=code',
        '&scope=' + encodeURIComponent('${scope}'),
        '&code_challenge=' + encodeURIComponent(challenge),
        '&code_challenge_method=S256',
      ].join('');
      window.open(url, 'gitlab_oauth', 'width=500,height=700');
    });

    // listen for the OAuth callback message
    window.addEventListener('message', (event) => {
      if (event.origin !== window.location.origin) return;
      const { type, service, token } = event.data || {};
      if (type === 'oauth-success' && service === '${serviceName}' && typeof token === 'string') {
        localStorage.setItem('${serviceName}_access_token', token);
        // you could dispatch a CustomEvent here if you need to notify parent code
      }
    });
  })();
</script>
  `
  return makeTaskResult([
    [
      {
        role: 'assistant',
        content: { type: 'message', data: html },
      },
    ],
  ])
}

export const gitlabLogin = createTool({
  name: 'gitlabLogin',
  description: 'Displays a GitLab OAuth login button via makeOauthLogin',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  function: () => {
    // reuse your PKCE + iframe-ready login snippet
    return makeOauthLogin({
      serviceName: 'gitlab',
      clientId: '56a06d49cd5ed412d47ced662b9e6ae297aecadf25cae9f0e036ca0ef299444b',
      scope: 'read_user',
    })
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
    },
    required: ['issuelist'],
  } as const satisfies JSONSchema7,
  function: async ({ issuelist }, ctx) => {
    const GITLAB_PROJECT_ID = await ctx.getSecret('YOUR_GITLAB_PROJECT_ID') // Replace with actual project ID
    const GITLAB_API_URL = await ctx.getSecret(
      `https://gitlab.com/api/v4/projects/${encodeURIComponent(GITLAB_PROJECT_ID || '')}/issues`,
    )
    const GITLAB_ACCESS_TOKEN = await ctx.getSecret('GITLAB_ACCESS_TOKEN') // Replace with actual project ID

    const oauthHtml = makeOauthLogin({
      serviceName: 'gitlab',
      clientId: '56a06d49cd5ed412d47ced662b9e6ae297aecadf25cae9f0e036ca0ef299444b',
      scope: 'read_user',
    })
    console.log(oauthHtml)

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

export const devTools = [gitlabLogin, issueListGenerator, gitReader]
