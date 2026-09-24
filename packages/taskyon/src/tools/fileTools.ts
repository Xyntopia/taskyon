import type { JSONSchema7 } from 'json-schema'
import type { TaskyonStorageClient } from '../api/storageProtocol'
import { createTool, type toolContext } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import { convertFileToText } from '../utils/loadFiles'
import {
  parseHttpUrl,
  parsePoliteHttpPolicy,
  politeHttpPolicySchema,
  waitForPoliteHttpTurn,
} from '../utils/politeHttp'

const looksLikePdfBytes = (bytes: Uint8Array) =>
  bytes.length >= 5 &&
  bytes[0] === 0x25 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x44 &&
  bytes[3] === 0x46 &&
  bytes[4] === 0x2d

const bytesFromBase64 = (content: string) => {
  const binary = atob(content)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

const shouldValidatePdf = (args: {
  expectedFileType?: string | undefined
  id?: string | undefined
  url?: string | undefined
}) =>
  args.expectedFileType === 'pdf' ||
  args.id?.toLowerCase().endsWith('.pdf') === true ||
  args.url?.toLowerCase().split(/[?#]/, 1)[0]?.endsWith('.pdf') === true

const objectIdFromUrl = (url: string) => {
  try {
    const pathName = new URL(url).pathname
    const name = decodeURIComponent(pathName.split('/').filter(Boolean).at(-1) ?? '')
    return name.replace(/[^A-Za-z0-9._~-]/g, '_').slice(0, 180) || 'download'
  } catch {
    return 'download'
  }
}

export const resolveStorageDownloadResultUrl = (taskChain: readonly TaskNode[]) =>
  [...taskChain]
    .reverse()
    .map((task) => (task.content.type === 'toolresult' ? task.content.data : undefined))
    .find(
      (data): data is { url: string } =>
        typeof data === 'object' && data !== null && 'url' in data && typeof data.url === 'string',
    )?.url

const assertArtifactNamespace = (namespace: string, artifactRoot?: string) => {
  const root = artifactRoot?.trim().replace(/^\/+|\/+$/g, '')
  if (!root) return
  if (root.includes('..')) throw new Error('artifactRoot must be a relative storage namespace.')
  if (namespace !== root && !namespace.startsWith(`${root}/`)) {
    throw new Error(`Storage namespace must be inside artifactRoot ${root}/.`)
  }
}

const resolveStorageNamespace = (namespace: string, artifactRoot?: string) => {
  const root = artifactRoot?.trim().replace(/^\/+|\/+$/g, '')
  return namespace === 'tool-files' && root ? root : namespace
}

export const createStorageTool = (
  storageClient: TaskyonStorageClient,
  download: typeof fetch = globalThis.fetch,
) =>
  createTool({
    name: 'storage',
    renderOptions: { hideVector: true, hideToolSearch: false },
    description: 'Save, download, read, list, delete, or check persistent binary Taskyon objects.',
    longDescription: `Store persistent binary objects through Taskyon's location-transparent storage service.
Objects are addressed by a namespace and an opaque object ID. The same tool works with local,
worker, remote, object-store, and future peer-backed storage providers.`,
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['save', 'download', 'read', 'list', 'delete', 'exists'],
          description:
            'The storage operation to perform. Use download for a URL; use save only when the file bytes are already supplied as base64 content.',
        },
        namespace: {
          type: 'string',
          description: 'The logical storage namespace',
          default: 'tool-files',
        },
        id: {
          type: 'string',
          description: 'Opaque object ID within the namespace',
        },
        url: {
          type: 'string',
          description:
            'Source URL to fetch and save for the download action. Do not use save with a URL.',
        },
        content: {
          type: 'string',
          description:
            'Base64 file content for the save action. Do not use placeholders, an empty string, or a URL here; use download when the source is a URL.',
        },
        mimeType: {
          type: 'string',
          description: 'MIME type for saved content',
          default: 'application/octet-stream',
        },
        expectedFileType: {
          type: 'string',
          enum: ['pdf'],
          description: 'Optional expected type; PDF downloads are validated by magic bytes',
        },
        artifactRoot: {
          type: 'string',
          description: 'Optional namespace prefix that constrains this request',
        },
        httpPolicy: politeHttpPolicySchema,
      },
      required: ['action'],
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: async (
      {
        action,
        namespace = 'tool-files',
        id,
        url,
        content,
        mimeType = 'application/octet-stream',
        expectedFileType,
        artifactRoot,
        httpPolicy,
      },
      context?: toolContext,
    ) => {
      let executionTaskChain: TaskNode[] = []
      if (context) {
        try {
          executionTaskChain = await context.getExecutionTaskChain()
        } catch {
          // External storage clients do not expose task-tree traversal. Explicit arguments remain authoritative.
        }
      }
      const storageNamespace = resolveStorageNamespace(namespace, artifactRoot)
      const storageObjectId = id
      assertArtifactNamespace(storageNamespace, artifactRoot)
      let result: unknown

      switch (action) {
        case 'save': {
          if (!storageObjectId) throw new Error('Object id is required for save action')
          if (!content) throw new Error('Content is required for save action')
          const metadata = await storageClient.setBlob({
            namespace: storageNamespace,
            id: storageObjectId,
            data: bytesFromBase64(content),
            contentType: mimeType,
          })
          result = { success: true, namespace: storageNamespace, id: storageObjectId, metadata }
          break
        }
        case 'download': {
          if (!url) throw new Error('Url is required for download action')
          const parsedUrl = parseHttpUrl(url)
          await waitForPoliteHttpTurn(parsedUrl, parsePoliteHttpPolicy(httpPolicy))
          const response = await download(parsedUrl)
          if (!response.ok) {
            throw new Error(`Download failed with HTTP ${response.status}: ${response.statusText}`)
          }
          const data = new Uint8Array(await response.arrayBuffer())
          const contentType = response.headers.get('content-type') ?? mimeType
          const objectId = storageObjectId || objectIdFromUrl(url)
          if (
            shouldValidatePdf({ expectedFileType, id: objectId, url }) &&
            !looksLikePdfBytes(data)
          ) {
            throw new Error(`Download did not return PDF bytes. Content-Type was ${contentType}`)
          }
          const metadata = await storageClient.setBlob({
            namespace: storageNamespace,
            id: objectId,
            data,
            contentType,
          })
          result = {
            success: true,
            namespace: storageNamespace,
            id: objectId,
            url,
            metadata,
          }
          break
        }
        case 'read': {
          if (!storageObjectId) throw new Error('Object id is required for read action')
          const stored = await storageClient.getBlob({
            namespace: storageNamespace,
            id: storageObjectId,
          })
          if (!stored) {
            throw new Error(`Stored object not found: ${storageNamespace}/${storageObjectId}`)
          }
          const file = new File([stored.data], storageObjectId, {
            type: stored.metadata.contentType ?? mimeType,
          })
          const sourceUrl = resolveStorageDownloadResultUrl(executionTaskChain)
          result = {
            success: true,
            namespace: storageNamespace,
            id: storageObjectId,
            fileText: await convertFileToText(file),
            metadata: stored.metadata,
            ...(sourceUrl ? { sourceUrl } : {}),
          }
          break
        }
        case 'list':
          result = {
            success: true,
            namespace: storageNamespace,
            objects: (await storageClient.listBlobs({ namespace: storageNamespace })).blobs,
          }
          break
        case 'delete':
          if (!storageObjectId) throw new Error('Object id is required for delete action')
          await storageClient.deleteBlob({ namespace: storageNamespace, id: storageObjectId })
          result = { success: true, namespace: storageNamespace, id: storageObjectId }
          break
        case 'exists':
          if (!storageObjectId) throw new Error('Object id is required for exists action')
          result = {
            success: true,
            namespace: storageNamespace,
            id: storageObjectId,
            exists:
              (await storageClient.statBlob({
                namespace: storageNamespace,
                id: storageObjectId,
              })) !== null,
          }
          break
        default:
          throw new Error(`Unknown storage action: ${String(action)}`)
      }

      return result
    },
  })
