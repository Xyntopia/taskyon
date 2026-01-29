import type { JSONSchema7 } from 'json-schema'
import { createTool, makeTaskResult, toolCall } from '../types/toolApi'
import { authenticateWithPopup } from '../utils/oauthUi'

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
        toolId: {
          type: 'string',
          description: 'This is a unique ID that every tool has',
        },
      },
      required: ['oauthURL', 'clientId', 'toolId', 'tokenUrl'],
      additionalProperties: false,
    } as const satisfies JSONSchema7,

    function: async (
      { oauthURL, clientId, scope = '', toolId, tokenUrl },
      { taskChain, stopSignal },
    ) => {
      // we need the 3rd last task, -1 is the current task and -2 is the button message UI
      const prev = taskChain.at(-3)
      const isReentry =
        prev?.content.type === 'functioncall' && prev.content.data.name === 'ensureOauthLogin'

      if (!isReentry) {
        // FIRST CALL: render login button & requeue self
        const html = createLoginButton({ oauthURL, clientId, scope, toolId })
        return makeTaskResult([
          [
            { role: 'assistant', content: { type: 'message', data: html } },
            toolCall({
              name: 'ensureOauthLogin',
              arguments: { oauthURL, clientId, scope, tokenUrl, toolId },
            }),
          ],
        ])
      }

      // SECOND CALL: wait for button press message (oauth-init) then open popup
      await withAbort(
        stopSignal,
        new Promise<void>((resolve) => {
          function handleInit(event: MessageEvent) {
            const { type, oauthURL, clientId, toolId: tid } = event.data || {}
            if (type === 'oauth-init' && oauthURL && clientId && tid === toolId) {
              window.removeEventListener('message', handleInit, { capture: true })
              resolve()
            }
          }
          window.addEventListener('message', handleInit, { capture: true })
        }),
      )

      // Now open the OAuth popup
      const creds = await authenticateWithPopup({ oauthURL, clientId, scope, tokenUrl }, stopSignal)

      // store secret and confirm
      await setSecret(toolId, 'oauth-creds', JSON.stringify(creds))

      return makeTaskResult([
        [{ role: 'assistant', content: { type: 'return', data: '🎉 Logged in successfully.' } }],
      ])
    },
  })
}
