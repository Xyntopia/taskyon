import type { JSONSchema7 } from 'json-schema'
import { createClientTool, toolCall } from '../types/toolApi'
import { authenticateWithPopup } from '../utils/oauthUi'

declare global {
  interface Window {
    [key: string]: unknown
  }
}

export function createLoginButton({ nonce }: { nonce: string }) {
  // return your existing tool, but swap out the iframe HTML:
  const html = `
<div>
  <button id="oauth-btn">Continue OAuth login</button>
</div>
<script>
  document.getElementById('oauth-btn')
    .addEventListener('click', () => {
      window.parent.postMessage(
        {
          type: 'oauth-init',
          nonce: '${nonce}'
        },
        '*'
      )
    })
</script>
  `
  return html
}

function withAbort<T>(signal: AbortSignal, p: Promise<T>) {
  return Promise.race([
    p,
    new Promise<never>((_res, rej) =>
      signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')), {
        once: true,
      }),
    ),
  ])
}

// Enhance createOAuthTool to wait for button press before opening popup
export const createOAuthTool = (
  setSecret: (id: string | number, secretName: string, secretData: string) => Promise<void>,
) => {
  return createClientTool({
    name: 'ensureOauthLogin',
    description: `Ensure, that we have an oauth token for the calling tool.`,
    longDescription: `Checks if we have an OAuth token available for specified service. Otherwise
display a login button in order to get an access token. Currently tested services are:

working:
- gitlab

not working:
- github
`,
    renderOptions: { hideChat: true, hideInput: true },
    parameters: {
      type: 'object',
      properties: {
        oauthURL: {
          type: 'string',
          description: 'The OAuth authorization URL',
        },
        tokenUrl: {
          type: 'string',
          description: 'The OAuth authorization URL',
        },
        clientId: {
          type: 'string',
          description: 'The OAuth client ID.',
        },
        scope: {
          type: 'string',
          description: 'The OAuth scope requested',
          default: '',
        },
        nonce: {
          type: 'string',
          description: 'Taskyon-generated nonce used only while resuming the login UI.',
        },
      },
      required: ['oauthURL', 'clientId', 'tokenUrl'],
      additionalProperties: false,
    } as const satisfies JSONSchema7,

    function: async (
      { oauthURL, clientId, scope = '', tokenUrl, nonce },
      { createSubtasksResult, getExecutionTaskChain, getCallingToolId, requestPopup, stopSignal },
    ) => {
      // we need the 3rd last task, -1 is the current task and -2 is the button message UI
      const taskChain = await getExecutionTaskChain()
      const prev = taskChain.at(-3)
      const isReentry =
        prev?.content.type === 'functioncall' && prev.content.data.name === 'ensureOauthLogin'

      if (!isReentry) {
        // FIRST CALL: render login button & requeue self
        const nonce = crypto.randomUUID()
        const html = createLoginButton({ nonce })
        return createSubtasksResult([
          [
            { role: 'assistant', content: { type: 'message', data: html } },
            toolCall({
              name: 'ensureOauthLogin',
              arguments: { oauthURL, clientId, scope, tokenUrl, nonce },
            }),
          ],
        ])
      }

      // SECOND CALL: wait for button press message (oauth-init) then open popup
      await withAbort(
        stopSignal,
        new Promise<void>((resolve) => {
          function handleInit(event: MessageEvent) {
            const { type, nonce: returnedNonce } = event.data || {}
            if (type === 'oauth-init' && returnedNonce === nonce) {
              window.removeEventListener('message', handleInit, { capture: true })
              resolve()
            }
          }
          window.addEventListener('message', handleInit, { capture: true })
        }),
      )

      // Now open the OAuth popup
      const oauthOrigin = new URL(oauthURL)
      if (oauthOrigin.protocol !== 'https:') {
        throw new Error('OAuth authorization URLs must use HTTPS')
      }
      if (!(await requestPopup?.({ target: `origin:${oauthOrigin.origin}` }))) {
        throw new Error(`OAuth popup was not authorized for ${oauthOrigin.origin}`)
      }
      const creds = await authenticateWithPopup({ oauthURL, clientId, scope, tokenUrl }, stopSignal)

      // store secret and confirm
      const callingToolId = await getCallingToolId?.()
      if (!callingToolId) throw new Error('OAuth login must be initiated by a registered tool')
      await setSecret(callingToolId, 'oauth-creds', JSON.stringify(creds))

      return createSubtasksResult([
        [{ role: 'assistant', content: { type: 'return', data: '🎉 Logged in successfully.' } }],
      ])
    },
  })
}
