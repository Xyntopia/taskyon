import { createTool, makeTaskResult } from '../taskyon/tools'

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
  } as const,
  function: async ({ issuelist }, ctx) => {
    const GITLAB_PROJECT_ID = await ctx.getSecret('YOUR_GITLAB_PROJECT_ID') // Replace with actual project ID
    const GITLAB_API_URL = await ctx.getSecret(
      `https://gitlab.com/api/v4/projects/${encodeURIComponent(GITLAB_PROJECT_ID || '')}/issues`,
    )
    const GITLAB_ACCESS_TOKEN = await ctx.getSecret('GITLAB_ACCESS_TOKEN') // Replace with actual project ID

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
  description: 'Extracts files from a Git repository using isomorphic-git in the browser.',
  longDescription:
    'This tool clones or fetches a Git repository and extracts the contents of a specified file or directory using isomorphic-git, adapted for browser environments without using Node.js-style imports.',
  name: 'gitReader',
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
      http: {
        type: 'object',
        description:
          'A custom HTTP client to use for network requests. If omitted, defaults to isomorphic-git’s built-in client.',
      },
      corsProxy: {
        type: 'string',
        description:
          'The URL of a CORS proxy to use for the repository fetch. Defaults to "https://cors.isomorphic-git.org".',
        default: 'https://cors.isomorphic-git.org',
      },
    },
  },
  code: `async ({ repoUrl, filePath, ref = "HEAD", http, corsProxy = "https://cors.isomorphic-git.org" }) => {
  // Helper to load a script dynamically
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = url
      script.async = true
      script.onload = () => {
        console.log(\`Script loaded: \${url}\`);
        resolve();
      }
      script.onerror = () => {
        const error = new Error(\`Failed to load \${url}\`);
        console.error(error);
        reject(error);
      }
      document.head.appendChild(script)
    })
  }

  // Load libraries if they're not already available
  const promises = []
  if (!window.git) {
    promises.push(loadScript('https://unpkg.com/isomorphic-git'))
  }
  if (!window.memfs) {
    promises.push(loadScript('https://unpkg.com/memfs/dist/memfs.umd.js'))
  }
  try {
    await Promise.all(promises)
  } catch (error) {
    console.error('Failed to load one or more scripts:', error);
    return { success: false, error: error.message };
  }

  try {
    // Use memfs instead of LightningFS
    if (!window.memfs) {
      console.error('memfs is not available on the window object.');
      return { success: false, error: 'memfs is not available.' };
    }
    const fs = memfs.fs
    const dir = '/repo'
    // Determine the HTTP client: use provided http parameter if available, otherwise fallback
    const httpClient = http || (git.http || window.http)
    await git.clone({
      fs,
      http: httpClient,
      dir,
      url: repoUrl,
      singleBranch: true,
      depth: 1,
      ref,
      corsProxy,
    })
    const fileContent = await fs.promises.readFile(\`\${dir}/\${filePath}\`, { encoding: 'utf8' })
    return { success: true, content: fileContent }
  } catch (error) {
    return { success: false, error: error.message }
  }
}`,
})

export const devTools = [issueListGenerator, gitReader]
