import type { JSONSchema7 } from 'json-schema'
import { createTool, makeTaskResult } from '../taskyon/tools'

declare global {
  interface Window {
    [key: string]: unknown
  }
}

// Ensure we only ever wire up one listener:
let listenerInstalled = false
function ensureOauthListener() {
  if (listenerInstalled) return
  listenerInstalled = true

  window.addEventListener('message', (event) => {
    const { type, oauthURL, clientId, scope } = event.data || {}
    if (type !== 'oauth-init') return

    // open our own “auth-start” page, which will do PKCE→redirect for us:
    const startUrl = new URL(`${window.location.origin}/oauth/start`)
    startUrl.searchParams.set('svcUrl', oauthURL)
    startUrl.searchParams.set('cid', clientId)
    startUrl.searchParams.set('scope', scope)
    window.open(startUrl.toString(), `oauth:${oauthURL}`, `width=500,height=700`)
  })
}

export function createLoginButton({
  oauthURL,
  clientId,
  scope,
}: {
  oauthURL: string
  clientId: string
  scope: string
}) {
  // stash config for the listener
  ensureOauthListener()

  // return your existing tool, but swap out the iframe HTML:
  const html = `
<div>
  <button id="oauth-btn">Login with ${oauthURL}</button>
</div>
<script>
  document.getElementById('oauth-btn')
    .addEventListener('click', () => {
      window.parent.postMessage(
        {
          type: 'oauth-init',
          oauthURL: '${oauthURL}',
          clientId: '${clientId}',
          scope: '${scope}'
        },
        '*'
      )
    })
</script>
  `
  return html
}

export const createOAuthTool = () => {
  ensureOauthListener()

  return createTool({
    name: 'gitlabLogin',
    description: `Start Oauth login for various services (currently only gitlab.com)`,
    longDescription: `Displays an OAuth login button in order to get an access token from the
specified service. Currently tested sevices are:

working:
- gitlab

not working:
- github
`,
    parameters: {
      type: 'object',
      properties: {
        oauthURL: {
          type: 'string',
          description: 'The OAuth authorization URL',
          default: 'https://gitlab.com/oauth/authorize',
        },
        clientId: {
          type: 'string',
          description: 'The OAuth client ID.',
          default: '56a06d49cd5ed412d47ced662b9e6ae297aecadf25cae9f0e036ca0ef299444b',
        },
        scope: {
          type: 'string',
          description: 'The OAuth scope requested',
          default: 'read_,user',
        },
      },
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: ({ oauthURL, clientId, scope }) => {
      // reuse your PKCE + iframe-ready login snippet
      const buttonhtml = createLoginButton({ oauthURL, clientId, scope })

      return makeTaskResult([
        [
          {
            role: 'assistant',
            content: { type: 'message', data: buttonhtml },
          },
        ],
      ])
    },
  })
}
