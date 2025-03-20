import { createTool, makeTaskResult } from '../taskyon/tools'

export const createNewWindowTool = createTool({
  name: 'newWindowOpener',
  description: 'Opens a new window with the provided HTML code.',
  longDescription: `This tool accepts an HTML string and opens a new browser window displaying the generated HTML.
It creates a blob from the HTML and then opens a new window with the blob URL.`,
  parameters: {
    type: 'object',
    properties: {
      html: {
        type: 'string',
        description: 'The HTML code to be rendered in the new window.',
      },
    },
    required: ['html'],
  } as const,
  function: ({ html }) => {
    console.log('Opening new window with HTML content via blob URL.')
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const newWindow = window.open(url, '_blank')
    if (!newWindow) {
      throw new Error('Failed to open a new window. It might have been blocked by a popup blocker.')
    }
    return makeTaskResult([
      [
        {
          role: 'system',
          content: { type: 'toolresult', data: 'New window opened successfully using blob URL.' },
        },
      ],
    ])
  },
})

export const appDevTools = [createNewWindowTool]
