import type { JSONSchema7 } from 'json-schema'
import { createTool, makeTaskResult } from '../taskyon/tools'
import type { SecretStore } from '../crudWrapper'

declare global {
  interface Window {
    [key: string]: unknown
  }
}

export function createLoginButton({
  oauthURL,
  clientId,
  scope,
  toolId,
}: {
  oauthURL: string
  clientId: string
  scope: string
  toolId: string
}) {
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
          scope: '${scope}',
          toolId: '${toolId}'
        },
        '*'
      )
    })
</script>
  `
  return html
}

export const createOAuthTool = (secretStore: SecretStore) => {
  // Map to track open popups and their toolIds
  const openPopups = new Map<WindowProxy, string>()

  // Function to open the OAuth popup and track it
  function openAuthPopup({
    oauthURL,
    clientId,
    scope,
    toolId,
  }: {
    oauthURL: string
    clientId: string
    scope: string
    toolId: string
  }) {
    const startUrl = new URL(`${window.location.origin}/oauth/start`)
    startUrl.searchParams.set('svcUrl', oauthURL)
    startUrl.searchParams.set('cid', clientId)
    startUrl.searchParams.set('scope', scope)

    const popup = window.open(startUrl.toString(), `oauth:${oauthURL}`, `width=500,height=700`)
    if (popup) {
      openPopups.set(popup, toolId)
    }
  }

  // Listener for messages from popups
  function oauthPopupListener(event: MessageEvent) {
    // Always check origin!
    if (event.origin !== window.location.origin) return

    const { type, accessToken } = event.data || {}
    if (type !== 'oauth-access-token') return

    // Find the toolId for this popup
    const toolId = openPopups.get(event.source as WindowProxy)
    if (!toolId) return // Unknown popup

    // Handle the access token for this toolId
    console.log(`🎉 Got token for tool: ${toolId}`, accessToken)

    // Clean up: close popup and remove from map
    try {
      ;(event.source as WindowProxy).close()
    } catch {
      // Ignore errors when closing the popup
    }
    openPopups.delete(event.source as WindowProxy)

    void secretStore.setSecret(toolId, 'oauth-acces-token', accessToken)
  }

  // Install the listener once
  window.addEventListener('message', oauthPopupListener)

  // --- Listener for button clicks from the iframe ---
  function oauthButtonListener(event: MessageEvent) {
    // The iframe's origin is likely "null", so we can't check origin here.
    // If you want, you can check event.data for a known structure.
    const { type, oauthURL, clientId, scope, toolId } = event.data || {}
    if (type !== 'oauth-init') return
    if (!oauthURL || !clientId || !toolId) return

    openAuthPopup({ oauthURL, clientId, scope, toolId })
  }

  // Install the button listener once
  window.addEventListener('message', oauthButtonListener)

  return createTool({
    name: 'ensureOauthLogin',
    description: `Ensure, that we have an oauth token for the calling tool.`,
    longDescription: `Checks if we have an OAuth token available for spcified service. Otherwise
display a login button in order to get an access token. Currently tested sevices are:

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
          default: 'read_user',
        },
        toolId: {
          type: 'string',
          description: 'This is a unique ID that every tool has',
        },
      },
      required: ['oauthURL', 'clientId', 'toolId'],
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: ({ oauthURL, clientId, scope, toolId }) => {
      // reuse your PKCE + iframe-ready login snippet
      const buttonhtml = createLoginButton({ oauthURL, clientId, scope, toolId })

      // TODO: return a siple "return" message, if the login was already succesful, otherwise
      //       create the login button...
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
