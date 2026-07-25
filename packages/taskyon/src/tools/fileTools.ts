import type { JSONSchema7 } from 'json-schema'
import { convertFileToText } from '../utils/loadFiles'
import { createTool } from '../types/toolApi'
import { createChatCompletionTask } from '../api'
import { parsePoliteHttpPolicy, politeFetch, politeHttpPolicySchema } from '../utils/politeHttp'

const looksLikePdfBytes = (bytes: Uint8Array) =>
  bytes.length >= 5 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46 &&
  bytes[4] === 0x2d

const blobFromBase64 = (content: string, mimeType: string) => {
  const binaryString = atob(content)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

const sanitizeOpfsFilename = (value: string) => value.replace(/[\\/:]/g, '_').trim()

const normalizeOpfsDirectory = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')

const assertOpfsDirectoryInsideArtifactRoot = (directory: string, artifactRoot?: string) => {
  const root = artifactRoot?.trim()
  if (!root) return

  if (root.startsWith('/') || root.includes('..')) {
    throw new Error('artifactRoot must be a relative OPFS directory.')
  }

  const normalizedRoot = normalizeOpfsDirectory(root)
  const normalizedDirectory = normalizeOpfsDirectory(directory).replace(/^\/+/, '')
  const rootPrefix = `${normalizedRoot}/`
  if (normalizedDirectory !== normalizedRoot && !normalizedDirectory.startsWith(rootPrefix)) {
    throw new Error(`OPFS directory must be inside artifactRoot ${rootPrefix}.`)
  }
}

const filenameFromUrl = (url: string) => {
  try {
    const pathName = new URL(url).pathname
    const rawFilename = decodeURIComponent(pathName.split('/').filter(Boolean).at(-1) ?? '')
    return sanitizeOpfsFilename(rawFilename) || 'download'
  } catch {
    return 'download'
  }
}

const saveBlobToOpfs = async (
  dirHandle: FileSystemDirectoryHandle,
  directory: string,
  filename: string,
  blob: Blob,
) => {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()

  return {
    success: true,
    message: `File saved to ${directory}/${filename}`,
    fileInfo: {
      name: filename,
      path: `${directory}/${filename}`,
      size: blob.size,
      type: blob.type || 'application/octet-stream',
    },
  }
}

const getOpfsRoot = async () => {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== 'function'
  ) {
    throw new Error('opfsStorage is only available in browser runtimes with OPFS support.')
  }

  return await navigator.storage.getDirectory()
}

/**
 * Tool that provides Origin Private File System (OPFS) integration for local file storage
 * and retrieval within the browser's secure storage.
 */
export const opfsStorageTool = createTool({
  name: 'opfsStorage',
  description: 'Save and load files using local Origin Private File System (OPFS) storage',
  longDescription: `This tool enables secure local file operations using the browser's Origin Private File System (OPFS):
- Save files to local opfs storage
- Download accessible URLs directly into OPFS
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
        enum: ['save', 'download', 'read', 'list', 'delete', 'exists'],
        description: 'The action to perform on local OPFS storage',
      },
      url: {
        type: 'string',
        description: 'Source URL to fetch and save for the download action',
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
      expectedFileType: {
        type: 'string',
        enum: ['pdf'],
        description:
          'Optional expected file type. When set to pdf, download rejects HTML/error pages and only saves real PDF bytes.',
      },
      artifactRoot: {
        type: 'string',
        description:
          'Optional relative OPFS directory that all research artifacts for this request must stay under, for example research/solar-cell-spec-sheets/.',
      },
      httpPolicy: politeHttpPolicySchema,
    },
    required: ['action'],
  } as const satisfies JSONSchema7,
  function: async (
    {
      action,
      url,
      directory = '/',
      filename,
      content,
      mimeType = 'application/octet-stream',
      expectedFileType,
      artifactRoot,
      httpPolicy,
    },
    ctx,
  ) => {
    // Get access to the OPFS root
    const root = await getOpfsRoot()
    let dirHandle = root
    assertOpfsDirectoryInsideArtifactRoot(directory, artifactRoot)

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

        result = await saveBlobToOpfs(
          dirHandle,
          directory,
          filename,
          blobFromBase64(content, mimeType),
        )
        break
      }

      case 'download': {
        if (!url) {
          throw new Error('Url is required for download action')
        }

        const response = await politeFetch(url, undefined, parsePoliteHttpPolicy(httpPolicy))
        if (!response.ok) {
          throw new Error(`Download failed with HTTP ${response.status}: ${response.statusText}`)
        }

        const responseMimeType = response.headers.get('content-type') ?? mimeType
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (expectedFileType === 'pdf' && !looksLikePdfBytes(bytes)) {
          throw new Error(`Download did not return PDF bytes. Content-Type was ${responseMimeType}`)
        }
        const blob = new Blob([bytes], { type: responseMimeType })
        const saveName = sanitizeOpfsFilename(filename ?? '') || filenameFromUrl(url)
        result = await saveBlobToOpfs(dirHandle, directory, saveName, blob)
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
            const fileHandle = await dirHandle.getFileHandle(name)
            const file = await fileHandle.getFile()
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

    return ctx.createSubtasksResult([
      [
        {
          role: 'system',
          content: { type: 'toolresult', data: result },
        },
        createChatCompletionTask({}),
      ],
    ])
  },
})

export const fileTools = [opfsStorageTool]
