import type { JSONSchema7 } from 'json-schema'
import { createTool, createToolTask, makeTaskResult } from '../taskyon/tools'
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
export const createOAuthTool = (secretStore: SecretStore) => {
  const openPopups = new Map<WindowProxy, string>()
  const loginResolvers = new Map<string, (token: string) => void>()

  function openAuthPopup(params: {
    oauthURL: string
    clientId: string
    scope: string
    toolId: string
  }) {
    const { oauthURL, clientId, scope, toolId } = params
    const startUrl = new URL(`${window.location.origin}/oauth/start`)
    startUrl.searchParams.set('svcUrl', oauthURL)
    startUrl.searchParams.set('cid', clientId)
    startUrl.searchParams.set('scope', scope)

    const popup = window.open(startUrl.toString(), `oauth:${oauthURL}`, `width=500,height=700`)
    if (popup) openPopups.set(popup, toolId)
  }

  function oauthPopupListener(event: MessageEvent) {
    if (event.origin !== window.location.origin) return
    const { type, accessToken } = event.data || {}
    if (type !== 'oauth-access-token' || !accessToken) return

    const toolId = openPopups.get(event.source as WindowProxy)
    if (!toolId) return

    // prevent duplicate handling
    event.stopImmediatePropagation()
    event.stopPropagation()

    const resolver = loginResolvers.get(toolId)
    if (resolver) {
      resolver(accessToken)
      loginResolvers.delete(toolId)
    }

    try {
      ;(event.source as WindowProxy).close()
    } catch {
      // Ignore errors when trying to close the popup
      console.warn('Failed to close OAuth popup:', event.source)
    }
    openPopups.delete(event.source as WindowProxy)
  }

  window.addEventListener('message', oauthPopupListener, { capture: true })

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
      required: ['oauthURL', 'clientId', 'toolId'],
      additionalProperties: false,
    } as const satisfies JSONSchema7,

    function: async ({ oauthURL, clientId, scope, toolId }, { taskChain, stopSignal }) => {
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
            createToolTask({
              name: 'ensureOauthLogin',
              arguments: { oauthURL, clientId, scope, toolId },
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
      openAuthPopup({ oauthURL, clientId, scope, toolId })

      // await token
      const token = await withAbort(
        stopSignal,
        new Promise<string>((resolve) => {
          // install resolver; cleanup on abort happens in withAbort
          loginResolvers.set(toolId, (tok) => {
            stopSignal.removeEventListener('abort', () => {}) // no-op, since withAbort cleans this up
            resolve(tok)
          })
        }),
      )

      // store secret and confirm
      await secretStore.setSecret(toolId, 'oauth-access-token', token)

      return makeTaskResult([
        [{ role: 'assistant', content: { type: 'message', data: '🎉 Logged in successfully.' } }],
      ])
    },
  })
}
