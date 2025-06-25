import type { JSONSchema7 } from 'json-schema'
import { createTool, makeTaskResult } from '../taskyon/tools'

// Global store for all opened windows
export const openedWindows = new Map()

export const createNewWindowTool = createTool({
  name: 'newWindowOpener',
  description: 'Opens a new window with the provided HTML code.',
  longDescription: `Opens a new browser window with the provided HTML content.
Windows can be given IDs for later reference with the windowManager tool.`,
  parameters: {
    type: 'object',
    properties: {
      html: {
        type: 'string',
        description: 'The HTML code to be rendered in the new window.',
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
    required: ['html'],
  } as const satisfies JSONSchema7,
  function: ({ html, windowId = '', windowFeatures = '' }) => {
    try {
      console.log('Opening new window with HTML content via blob URL.')
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)

      // Open the window with the provided features
      const newWindow = window.open(url, '_blank', windowFeatures)

      if (!newWindow) {
        URL.revokeObjectURL(url)
        throw new Error(
          'Failed to open a new window. It might have been blocked by a popup blocker.',
        )
      }

      // Add a reference to the parent window
      newWindow.opener = window

      // Store the window reference if an ID is provided
      if (windowId) {
        // If reusing an existing ID, clean up the old reference first
        if (openedWindows.has(windowId)) {
          const oldWindow = openedWindows.get(windowId)
          if (oldWindow.blobUrl) {
            URL.revokeObjectURL(oldWindow.blobUrl)
          }
        }

        openedWindows.set(windowId, {
          window: newWindow,
          blobUrl: url,
          createdAt: new Date(),
        })
      }

      // Set up cleanup when the window is closed
      newWindow.addEventListener('beforeunload', () => {
        if (windowId) {
          openedWindows.delete(windowId)
        }
        URL.revokeObjectURL(url)
      })

      return makeTaskResult([
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
      return makeTaskResult([
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
  description: 'Manages previously opened windows.',
  longDescription: 'Lists, focuses, and closes windows created by the newWindowOpener tool.',
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
  function: ({ action = 'list', windowId }) => {
    switch (action) {
      case 'list': {
        const windowIds = Array.from(openedWindows.keys())
        return makeTaskResult([
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
      case 'focus':
        if (!windowId || !openedWindows.has(windowId)) {
          return makeTaskResult([
            [
              {
                role: 'system',
                content: { type: 'toolresult', data: `Window '${windowId || 'none'}' not found.` },
              },
            ],
          ])
        }

        try {
          openedWindows.get(windowId).window.focus()
          return makeTaskResult([
            [
              {
                role: 'system',
                content: { type: 'toolresult', data: `Focused window '${windowId}'.` },
              },
            ],
          ])
        } catch {
          openedWindows.delete(windowId)
          return makeTaskResult([
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

      case 'close':
        if (!windowId || !openedWindows.has(windowId)) {
          return makeTaskResult([
            [
              {
                role: 'system',
                content: { type: 'toolresult', data: `Window '${windowId || 'none'}' not found.` },
              },
            ],
          ])
        }

        try {
          const windowToClose = openedWindows.get(windowId)
          if (windowToClose.blobUrl) {
            URL.revokeObjectURL(windowToClose.blobUrl)
          }
          windowToClose.window.close()
          openedWindows.delete(windowId)

          return makeTaskResult([
            [
              {
                role: 'system',
                content: { type: 'toolresult', data: `Closed window '${windowId}'.` },
              },
            ],
          ])
        } catch {
          openedWindows.delete(windowId)
          return makeTaskResult([
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

      case 'closeAll': {
        let closedCount = 0

        for (const [id, windowData] of openedWindows.entries()) {
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

        return makeTaskResult([
          [
            {
              role: 'system',
              content: { type: 'toolresult', data: `Closed ${closedCount} windows.` },
            },
          ],
        ])
      }
      default:
        return makeTaskResult([
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
    'Waits for and converts a specific window.postMessage event into structured data before continuing.',
  parameters: {
    type: 'object',
    properties: {
      messageId: { type: 'string', description: 'ID to listen for in event.data.messageId' },
    },
    required: ['messageId'],
    additionalProperties: false,
  } as const satisfies JSONSchema7,
  async function({ messageId }) {
    // pause here until the matching postMessage arrives
    const data = await new Promise((resolve) => {
      const listener = (event: MessageEvent) => {
        if (event.data?.messageId === messageId) {
          window.removeEventListener('message', listener)
          resolve(event.data)
        }
      }
      window.addEventListener('message', listener)
    })

    // once we have it, return it as a TaskResult
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

export const appDevTools = [createNewWindowTool, windowManagerTool, createWaitForMessageTool]
