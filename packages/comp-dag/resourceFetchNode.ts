import type { ResourceFilesLoader } from '@taskyon/common/modules/resourceFiles'
import { createNode } from './dagCore'

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export const createResourceFetchNode = (loadFiles: ResourceFilesLoader) =>
  createNode({
    name: 'resourceFetch',
    version: 1,
    localParams: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        revision: { type: 'string' },
        cache: { type: 'string', enum: ['internal', 'external'] },
        maxInlineBytes: { type: 'number', minimum: 0, default: 1_000_000 },
      },
      required: ['source', 'revision', 'cache'],
      additionalProperties: false,
    } as const,
    outputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string' },
        name: { type: 'string' },
        mediaType: { type: 'string' },
        size: { type: 'number' },
        lastModified: { type: 'number' },
        revision: { type: 'string' },
        contentBase64: { type: 'string' },
      },
      required: ['url', 'name', 'mediaType', 'size'],
      additionalProperties: false,
    } as const,
    run: async ({ source, revision, cache, maxInlineBytes }) => {
      const loaded = []
      for await (const resource of loadFiles(source)) loaded.push(resource)
      if (loaded.length !== 1) {
        throw new Error(
          `Resource fetch expected one file for "${source}" but received ${loaded.length}.`,
        )
      }

      const resource = loaded[0]!
      const base = {
        url: resource.url,
        name: resource.file.name,
        mediaType: resource.file.type || 'application/octet-stream',
        size: resource.file.size,
        ...(resource.file.lastModified > 0 ? { lastModified: resource.file.lastModified } : {}),
      }
      if (cache === 'external' || resource.file.size > maxInlineBytes) return base

      const bytes = new Uint8Array(await resource.file.arrayBuffer())
      return {
        ...base,
        revision,
        contentBase64: bytesToBase64(bytes),
      }
    },
  })
