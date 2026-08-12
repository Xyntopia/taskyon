import type { JSONSchema7 } from 'json-schema'
import { createChatCompletionTask } from '../api'
import type { TaskyonStorageClient } from '../api/storageProtocol'
import { createTool } from '../types/toolApi'
import { convertFileToText } from '../utils/loadFiles'
import { parsePoliteHttpPolicy, politeFetch, politeHttpPolicySchema } from '../utils/politeHttp'

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

const objectIdFromUrl = (url: string) => {
  try {
    const pathName = new URL(url).pathname
    const name = decodeURIComponent(pathName.split('/').filter(Boolean).at(-1) ?? '')
    return name.replace(/[^A-Za-z0-9._~-]/g, '_').slice(0, 180) || 'download'
  } catch {
    return 'download'
  }
}

const assertArtifactNamespace = (namespace: string, artifactRoot?: string) => {
  const root = artifactRoot?.trim().replace(/^\/+|\/+$/g, '')
  if (!root) return
  if (root.includes('..')) throw new Error('artifactRoot must be a relative storage namespace.')
  if (namespace !== root && !namespace.startsWith(`${root}/`)) {
    throw new Error(`Storage namespace must be inside artifactRoot ${root}/.`)
  }
}

export const createStorageTool = (storageClient: TaskyonStorageClient) =>
  createTool({
    name: 'storage',
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
          description: 'The storage operation to perform',
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
          description: 'Source URL to fetch and save for the download action',
        },
        content: {
          type: 'string',
          description: 'Base64 file content for the save action',
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
      ctx,
    ) => {
      assertArtifactNamespace(namespace, artifactRoot)
      let result: unknown

      switch (action) {
        case 'save': {
          if (!id) throw new Error('Object id is required for save action')
          if (!content) throw new Error('Content is required for save action')
          const metadata = await storageClient.setBlob({
            namespace,
            id,
            data: bytesFromBase64(content),
            contentType: mimeType,
          })
          result = { success: true, namespace, id, metadata }
          break
        }
        case 'download': {
          if (!url) throw new Error('Url is required for download action')
          const response = await politeFetch(url, undefined, parsePoliteHttpPolicy(httpPolicy))
          if (!response.ok) {
            throw new Error(`Download failed with HTTP ${response.status}: ${response.statusText}`)
          }
          const data = new Uint8Array(await response.arrayBuffer())
          const contentType = response.headers.get('content-type') ?? mimeType
          if (expectedFileType === 'pdf' && !looksLikePdfBytes(data)) {
            throw new Error(`Download did not return PDF bytes. Content-Type was ${contentType}`)
          }
          const objectId = id || objectIdFromUrl(url)
          const metadata = await storageClient.setBlob({
            namespace,
            id: objectId,
            data,
            contentType,
          })
          result = { success: true, namespace, id: objectId, metadata }
          break
        }
        case 'read': {
          if (!id) throw new Error('Object id is required for read action')
          const stored = await storageClient.getBlob({ namespace, id })
          if (!stored) throw new Error(`Stored object not found: ${namespace}/${id}`)
          const file = new File([stored.data], id, {
            type: stored.metadata.contentType ?? mimeType,
          })
          result = {
            success: true,
            namespace,
            id,
            fileText: await convertFileToText(file),
            metadata: stored.metadata,
          }
          break
        }
        case 'list':
          result = {
            success: true,
            namespace,
            objects: (await storageClient.listBlobs({ namespace })).blobs,
          }
          break
        case 'delete':
          if (!id) throw new Error('Object id is required for delete action')
          await storageClient.deleteBlob({ namespace, id })
          result = { success: true, namespace, id }
          break
        case 'exists':
          if (!id) throw new Error('Object id is required for exists action')
          result = {
            success: true,
            namespace,
            id,
            exists: (await storageClient.statBlob({ namespace, id })) !== null,
          }
          break
        default:
          throw new Error(`Unknown storage action: ${String(action)}`)
      }

      return ctx.createSubtasksResult([
        [
          { role: 'system', content: { type: 'toolresult', data: result } },
          createChatCompletionTask({}),
        ],
      ])
    },
  })
