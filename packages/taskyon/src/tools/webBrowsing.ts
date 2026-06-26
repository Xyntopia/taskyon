import { createTool } from '../types/toolApi'
import { openedWindows } from './webAppDev'

export const openThirdPartyUrlTool = createTool({
  name: 'thirdPartyUrlOpener',
  description: 'Opens a third-party URL in a new window and tracks it.',
  longDescription: `Opens a third-party website URL in a new browser window.
Windows can be given IDs for later reference with the windowManager tool.`,
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL of the third-party website to open.',
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
    required: ['url'],
  } as const,
  function: ({ url, windowId = '', windowFeatures = '' }, ctx) => {
    try {
      console.log(`Opening third-party URL: ${url}`)

      // Validate URL format
      let targetUrl
      try {
        targetUrl = new URL(url)
        // Ensure the URL has a protocol
        if (
          !targetUrl.protocol ||
          (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:')
        ) {
          throw new Error('URL must have http:// or https:// protocol')
        }
      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`Invalid URL format: ${error.message}`)
        } else {
          throw new Error('Invalid URL format: Unknown error')
        }
      }

      // Open the window with the provided features
      const newWindow = window.open(url, '_blank', windowFeatures)

      if (!newWindow) {
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
          if (oldWindow.window) {
            try {
              oldWindow.window.close()
            } catch (e) {
              console.error('Error closing previous window:', e)
            }
          }
        }

        openedWindows.set(windowId, {
          window: newWindow,
          isThirdParty: true,
          url: url,
          createdAt: new Date(),
        })
      }

      // Set up cleanup when the window is closed
      newWindow.addEventListener('beforeunload', () => {
        if (windowId) {
          openedWindows.delete(windowId)
        }
      })

      return ctx.createSubtasksResult([
        [
          {
            role: 'system',
            content: {
              type: 'toolresult',
              data: `Third-party URL ${url} opened successfully${windowId ? ` with ID: ${windowId}` : ''}.`,
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
            content: { type: 'toolresult', data: `Error opening URL: ${errorMessage}` },
          },
        ],
      ])
    }
  },
})

// Add this tool to your appDevTools array
// export const appDevTools = [createNewWindowTool, windowManagerTool, openThirdPartyUrlTool];
export const webBrowsingTools = [openThirdPartyUrlTool]
