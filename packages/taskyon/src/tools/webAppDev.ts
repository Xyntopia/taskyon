import type { JSONSchema7 } from 'json-schema'
import { createTool } from '../types/toolApi'

// Global store for all opened windows
export const openedWindows = new Map<
  string,
  { window: Window; blobUrl?: string; url?: string; createdAt: Date }
>()

function createPopupShell(html: string) {
  const sandboxedHtml = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; object-src 'none'; frame-src 'none'; form-action 'none'; navigate-to 'none'">${html}`
  const escapedHtml = sandboxedHtml.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src 'self'; style-src 'unsafe-inline'">
<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style>
<iframe sandbox="allow-scripts allow-forms allow-modals" srcdoc="${escapedHtml}"></iframe>`
}

export const createNewWindowTool = createTool({
  name: 'newWindowOpener',
  description: 'Open approved custom HTML or an HTTPS URL in a separate browser window.',
  longDescription: `Popup creation requires host authorization. Custom HTML is wrapped in a restricted
sandbox, external navigation is limited to HTTPS, and an optional ID lets later window-management
calls reference the opened window.`,
  parameters: {
    type: 'object',
    properties: {
      html: {
        type: 'string',
        description: 'The HTML code to be rendered in the new window.',
      },
      url: {
        type: 'string',
        description: 'An HTTPS URL to open instead of custom HTML.',
      },
      windowId: {
        type: 'string',
        description: 'Optional identifier for the window to reference later.',
      },
      windowFeatures: {
        type: 'string',
        description: 'Optional window features (e.g., "width=800,height=600").',
      },
    },
    additionalProperties: false,
  } as const satisfies JSONSchema7,
  function: async ({ html, url: externalUrl, windowId = '', windowFeatures = '' }, ctx) => {
    try {
      if ((typeof html === 'string') === (typeof externalUrl === 'string')) {
        throw new Error('Provide exactly one of html or url')
      }
      const target = externalUrl
        ? (`origin:${new URL(externalUrl).origin}` as const)
        : ('custom-html' as const)
      if (!(await ctx.requestPopup?.({ target }))) {
        throw new Error(`Popup capability was not authorized for ${target}`)
      }
      const blobUrl = html
        ? URL.createObjectURL(new Blob([createPopupShell(html)], { type: 'text/html' }))
        : undefined
      const url = externalUrl ? new URL(externalUrl) : new URL(blobUrl!)
      if (externalUrl && url.protocol !== 'https:') {
        throw new Error('External popups only permit HTTPS URLs')
      }

      // Open the window with the provided features
      const newWindow = window.open('', '_blank', windowFeatures)

      if (!newWindow) {
        if (blobUrl) URL.revokeObjectURL(blobUrl)
        throw new Error(
          'Failed to open a new window. It might have been blocked by a popup blocker.',
        )
      }
      newWindow.opener = null
      newWindow.location.replace(url.href)

      // Store the window reference if an ID is provided
      if (windowId) {
        // If reusing an existing ID, clean up the old reference first
        if (openedWindows.has(windowId)) {
          const oldWindow = openedWindows.get(windowId)!
          if (oldWindow.blobUrl) {
            URL.revokeObjectURL(oldWindow.blobUrl)
          }
        }

        openedWindows.set(windowId, {
          window: newWindow,
          ...(blobUrl ? { blobUrl } : {}),
          createdAt: new Date(),
        })
      }

      // Set up cleanup when the window is closed
      newWindow.addEventListener('beforeunload', () => {
        if (windowId) {
          openedWindows.delete(windowId)
        }
        if (blobUrl) URL.revokeObjectURL(blobUrl)
      })

      return ctx.createSubtasksResult([
        [
          {
            role: 'system',
            content: {
              type: 'toolresult',
              data: `New window opened successfully${windowId ? ` with ID: ${windowId}` : ''}.`,
            },
          },
        ],
      ])
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      return ctx.createSubtasksResult([
        [
          {
            role: 'system',
            content: { type: 'toolresult', data: `Error opening window: ${errorMessage}` },
          },
        ],
      ])
    }
  },
})

// Window manager tool for handling previously opened windows
export const windowManagerTool = createTool({
  name: 'windowManager',
  description: 'List, focus, or close windows previously opened with a Taskyon window ID.',
  longDescription:
    'This tool only manages windows tracked by the current Taskyon browser session; it cannot enumerate or control arbitrary browser windows.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'Action to perform: "list", "focus", "close", or "closeAll".',
        enum: ['list', 'focus', 'close', 'closeAll'],
      },
      windowId: {
        type: 'string',
        description: 'ID of the window to operate on (for focus and close actions).',
      },
    },
    required: ['action'],
  } as const satisfies JSONSchema7,
  function: ({ action = 'list', windowId }, ctx) => {
    switch (action) {
      case 'list': {
        const windowIds = Array.from(openedWindows.keys())
        return ctx.createSubtasksResult([
          [
            {
              role: 'system',
              content: {
                type: 'toolresult',
                data: `Open windows: ${windowIds.length ? windowIds.join(', ') : 'None'}`,
              },
            },
          ],
        ])
      }
      case 'focus': {
        if (!windowId || !openedWindows.has(windowId)) {
          return ctx.createSubtasksResult([
            [
              {
                role: 'system',
                content: { type: 'toolresult', data: `Window '${windowId || 'none'}' not found.` },
              },
            ],
          ])
        }

        const openedWindow = openedWindows.get(windowId)
        if (!openedWindow) throw new Error(`Window '${windowId}' not found`)
        try {
          openedWindow.window.focus()
          return ctx.createSubtasksResult([
            [
              {
                role: 'system',
                content: { type: 'toolresult', data: `Focused window '${windowId}'.` },
              },
            ],
          ])
        } catch {
          openedWindows.delete(windowId)
          return ctx.createSubtasksResult([
            [
              {
                role: 'system',
                content: {
                  type: 'toolresult',
                  data: `Failed to focus window '${windowId}'. Window reference removed.`,
                },
              },
            ],
          ])
        }
      }

      case 'close': {
        if (!windowId || !openedWindows.has(windowId)) {
          return ctx.createSubtasksResult([
            [
              {
                role: 'system',
                content: { type: 'toolresult', data: `Window '${windowId || 'none'}' not found.` },
              },
            ],
          ])
        }

        const windowToClose = openedWindows.get(windowId)
        if (!windowToClose) throw new Error(`Window '${windowId}' not found`)
        try {
          if (windowToClose.blobUrl) {
            URL.revokeObjectURL(windowToClose.blobUrl)
          }
          windowToClose.window.close()
          openedWindows.delete(windowId)

          return ctx.createSubtasksResult([
            [
              {
                role: 'system',
                content: { type: 'toolresult', data: `Closed window '${windowId}'.` },
              },
            ],
          ])
        } catch {
          openedWindows.delete(windowId)
          return ctx.createSubtasksResult([
            [
              {
                role: 'system',
                content: {
                  type: 'toolresult',
                  data: `Error closing window '${windowId}'. Window reference removed.`,
                },
              },
            ],
          ])
        }
      }

      case 'closeAll': {
        let closedCount = 0

        for (const [id, windowData] of Array.from(openedWindows.entries())) {
          try {
            if (windowData.blobUrl) {
              URL.revokeObjectURL(windowData.blobUrl)
            }
            windowData.window.close()
            closedCount++
          } catch {
            // Ignore errors
          } finally {
            openedWindows.delete(id)
          }
        }

        return ctx.createSubtasksResult([
          [
            {
              role: 'system',
              content: { type: 'toolresult', data: `Closed ${closedCount} windows.` },
            },
          ],
        ])
      }
      default:
        return ctx.createSubtasksResult([
          [
            {
              role: 'system',
              content: {
                type: 'toolresult',
                // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                data: `Unknown action '${action}'. Valid actions: list, focus, close, closeAll.`,
              },
            },
          ],
        ])
    }
  },
})

export const createWaitForMessageTool = createTool({
  name: 'waitForPostMessage',
  description:
    'Wait for a matching message from a Taskyon-managed popup and return its structured payload.',
  longDescription:
    'The listener accepts only the tracked source window and matching message ID, remains cancellable through the task stop signal, and exposes the received event data as a visible structured result.',
  parameters: {
    type: 'object',
    properties: {
      messageId: { type: 'string', description: 'ID to listen for in event.data.messageId' },
      windowId: { type: 'string', description: 'ID of the Taskyon-managed source window' },
    },
    required: ['messageId', 'windowId'],
    additionalProperties: false,
  } as const satisfies JSONSchema7,
  async function({ messageId, windowId }, ctx) {
    const sourceWindow = openedWindows.get(windowId)?.window
    if (!sourceWindow) throw new Error(`Managed popup '${windowId}' was not found`)
    // pause here until the matching postMessage arrives
    const data = await new Promise((resolve, reject) => {
      const listener = (event: MessageEvent) => {
        if (event.source === sourceWindow && event.data?.messageId === messageId) {
          window.removeEventListener('message', listener)
          ctx.stopSignal.removeEventListener('abort', abort)
          resolve(event.data)
        }
      }
      const abort = () => {
        window.removeEventListener('message', listener)
        reject(new Error('Message wait interrupted', { cause: ctx.stopSignal.reason }))
      }
      window.addEventListener('message', listener)
      ctx.stopSignal.addEventListener('abort', abort, { once: true })
    })

    // once we have it, return it as a TaskResult
    return ctx.createSubtasksResult([
      [
        {
          role: 'assistant',
          content: { type: 'structured', data },
        },
      ],
    ])
  },
})

export const appDevTools = [createNewWindowTool, windowManagerTool, createWaitForMessageTool]
