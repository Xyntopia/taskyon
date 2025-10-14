import type { JSONSchema7 } from 'json-schema'
import { convertFileToText } from '../utils/loadFiles'
import { createTool, makeTaskResult } from '../types/toolApi'
import { createChatCompletionTask } from '../api'

/**
 * Tool that provides Origin Private File System (OPFS) integration for local file storage
 * and retrieval within the browser's secure storage.
 */
export const opfsStorageTool = createTool({
  name: 'opfsStorage',
  description: 'Save and load files using local Origin Private File System (OPFS) storage',
  longDescription: `This tool enables secure local file operations using the browser's Origin Private File System (OPFS):
- Save files to local opfs storage
- Read files by converting them into txt (including pdf, word and more...).
- List files in directories
- Delete files
- Check if files exist

OPFS provides persistent storage that's isolated to your origin, offering reliable
local storage without requiring network access. Files stored remain available
between browser sessions but are private to this application.`,
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['save', 'read', 'list', 'delete', 'exists'],
        description: 'The action to perform on local OPFS storage',
      },
      directory: {
        type: 'string',
        description: 'The directory path in OPFS where the file should be saved or loaded from',
        default: '/',
      },
      filename: {
        type: 'string',
        description: 'Only the name of the file without any paths to save, load, or check',
      },
      content: {
        type: 'string',
        description: 'File content as base64 string (required for save action)',
      },
      mimeType: {
        type: 'string',
        description: 'The MIME type of the file (used for save action)',
        default: 'application/octet-stream',
      },
    },
    required: ['action'],
  } as const satisfies JSONSchema7,
  function: async ({
    action,
    directory = '/',
    filename,
    content,
    mimeType = 'application/octet-stream',
  }) => {
    // Get access to the OPFS root
    const root = await navigator.storage.getDirectory()
    let dirHandle = root

    // Create or navigate to directory (handling nested paths)
    if (directory !== '/') {
      const dirs = directory.split('/').filter(Boolean)
      for (const dir of dirs) {
        dirHandle = await dirHandle.getDirectoryHandle(dir, { create: true })
      }
    }

    let result

    switch (action) {
      case 'save': {
        if (!filename) {
          throw new Error('Filename is required for save action')
        }
        if (!content) {
          throw new Error('Content is required for save action')
        }

        // Convert base64 to Blob
        const binaryString = atob(content)
        const len = binaryString.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        const blob = new Blob([bytes], { type: mimeType })

        // Create a file in the directory
        const fileHandle = await dirHandle.getFileHandle(filename, { create: true })

        // Create a writable stream and write the blob
        const writable = await fileHandle.createWritable()
        await writable.write(blob)
        await writable.close()

        result = {
          success: true,
          message: `File saved to ${directory}/${filename}`,
          fileInfo: {
            name: filename,
            path: `${directory}/${filename}`,
            size: blob.size,
            type: mimeType,
          },
        }
        break
      }

      case 'read': {
        if (!filename) {
          throw new Error('Filename is required for load action')
        }

        // Get the file handle
        const fileHandle = await dirHandle.getFileHandle(filename)

        // Get the file
        const file = await fileHandle.getFile()

        const fileText = await convertFileToText(file)

        result = {
          success: true,
          message: `File loaded from ${directory}/${filename}`,
          fileText,
          mimeType: file.type || mimeType,
          size: file.size,
        }
        break
      }

      case 'list': {
        const files = []

        // Iterate through all entries in the directory
        for await (const [name, handle] of dirHandle.entries()) {
          if (handle.kind === 'file') {
            const file = await handle.getFile()
            files.push({
              name,
              size: file.size,
              type: file.type || 'application/octet-stream',
              lastModified: new Date(file.lastModified).toISOString(),
            })
          } else if (handle.kind === 'directory') {
            files.push({
              name,
              type: 'directory',
              isDirectory: true,
            })
          }
        }

        result = {
          success: true,
          message: `Files in ${directory}`,
          directory,
          files,
        }
        break
      }

      case 'delete': {
        if (!filename) {
          throw new Error('Filename is required for delete action')
        }

        // Remove the file
        await dirHandle.removeEntry(filename)

        result = {
          success: true,
          message: `File ${directory}/${filename} deleted`,
        }
        break
      }

      case 'exists': {
        if (!filename) {
          throw new Error('Filename is required for exists action')
        }

        let exists = false
        try {
          // Try to get the file handle without creating it
          await dirHandle.getFileHandle(filename)
          exists = true
        } catch {
          // File doesn't exist
          exists = false
        }

        result = {
          success: true,
          exists,
          path: `${directory}/${filename}`,
        }
        break
      }

      default:
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Unknown action: ${action}`)
    }

    return makeTaskResult([
      [
        {
          role: 'system',
          content: { type: 'toolresult', data: result },
        },
        createChatCompletionTask({ goal: 'SimpleCompletion' }),
      ],
    ])
  },
})

export const fileTools = [opfsStorageTool]
