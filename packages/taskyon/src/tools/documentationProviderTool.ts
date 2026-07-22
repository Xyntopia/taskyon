import type { JSONSchema7 } from 'json-schema'
import z from 'zod'
import type { ClientTool } from '../types/toolApi'
import { createClientTool } from '../types/toolApi'
import {
  loadDocumentationManifestFiles,
  type DocumentationManifest,
  type ResourceFilesLoader,
} from '@taskyon/common/modules/resourceFiles'
import { createOpenApiDocumentationSections } from '@taskyon/common/modules/openApiDocumentation'
import {
  searchDocumentation,
  createDocumentationDocument,
  titleFromDocumentationPath,
} from '@taskyon/common/modules/documentation'
import type { createDocumentationBaseStore } from '@taskyon/common/modules/documentationBases'
import { parseDocumentationManifest } from '@taskyon/common/modules/resourceFiles'
import { convertFileToText } from '../utils/loadFiles'
import { sha256HashBytes } from '@taskyon/common/modules/canonicalHash'
import { createResourceFetchNode } from '@taskyon/comp-dag/resourceFetchNode'
import type { EngineConfig } from '@taskyon/comp-dag'
import { taskyonDocumentationManifest } from '../documentationManifest'

export const taskyonDocsProviderToolName = 'getTaskyonDocumentationDocuments'
export const documentationIndexToolName = 'documentationIndex'

const DocumentationIndexArgs = z.discriminatedUnion('action', [
  z.object({ action: z.literal('list') }),
  z.object({ action: z.literal('register'), manifest: z.unknown() }),
  z.object({
    action: z.literal('search'),
    baseId: z.string().min(1),
    query: z.string().min(1),
    mode: z.enum(['literal', 'regex']).default('literal'),
    limit: z.number().int().positive().max(50).default(5),
  }),
  z.object({
    action: z.literal('getDocument'),
    baseId: z.string().min(1),
    documentId: z.string().min(1),
  }),
  z.object({ action: z.literal('refresh'), baseId: z.string().min(1) }),
  z.object({ action: z.literal('remove'), baseId: z.string().min(1) }),
])

export type DocumentationDocument = {
  id: string
  path: string
  title?: string
  url?: string
  content: string
  aliases: string[]
  chapters: string[]
  metadata?: Record<string, unknown>
}

export type DocumentationProviderLoader = () => Promise<{
  documents: DocumentationDocument[]
  errors?: Array<{ source: string; message: string }>
}>

const documentationPathFromUrl = (url: string) =>
  url
    .replace(/^\/docs\//, '')
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/[?#].*$/, '')

const markdownDocument = async (
  url: string,
  file: File,
  path: string,
  aliases: string[],
  chapters: string[],
): Promise<DocumentationDocument[]> => {
  return [
    createDocumentationDocument({
      path,
      url,
      aliases,
      chapters,
      content: await file.text(),
    }),
  ]
}

const resourceFileDocuments = async (
  url: string,
  file: File,
  resourcePath: string | undefined,
  aliases: string[],
  chapters: string[],
): Promise<DocumentationDocument[]> => {
  const name = file.name.toLowerCase()
  const isOpenApiCandidate =
    file.type === 'application/vnd.oai.openapi+json' ||
    name.endsWith('.openapi.json') ||
    name.endsWith('.openapi.yaml') ||
    name.endsWith('.openapi.yml')
  if (isOpenApiCandidate) {
    return createOpenApiDocumentationSections(await file.text(), url).map((document) => ({
      ...document,
      chapters,
    }))
  }
  if (file.type === 'text/markdown' || name.endsWith('.md') || name.endsWith('.mdx')) {
    return await markdownDocument(
      url,
      file,
      resourcePath ?? documentationPathFromUrl(url),
      aliases,
      chapters,
    )
  }

  const path = resourcePath ?? documentationPathFromUrl(url)
  return [
    {
      id: path,
      path,
      title: titleFromDocumentationPath(path),
      url,
      content: await convertFileToText(file, { htmlMode: 'raw' }),
      aliases,
      chapters,
      metadata: {
        format: file.type || 'application/octet-stream',
        source: url,
      },
    },
  ]
}

export const loadDocumentationDocumentsFromManifest = async (
  manifest: DocumentationManifest,
  loadFiles: ResourceFilesLoader,
  engineConfig?: EngineConfig,
): ReturnType<DocumentationProviderLoader> => {
  const loaded = await loadDocumentationManifestFiles(manifest, loadFiles)
  const documents = (
    await Promise.all(
      loaded.files.map(async ({ url, path, file, cache, source, aliases, chapters }) => {
        const revision =
          cache === 'internal'
            ? sha256HashBytes(new Uint8Array(await file.arrayBuffer()))
            : `source:${url}`
        const resourceFetch = createResourceFetchNode(async function* (requestedSource) {
          await Promise.resolve()
          if (requestedSource !== url) {
            throw new Error(
              `Expected materialized resource "${url}", received "${requestedSource}".`,
            )
          }
          yield { url, file, ...(path ? { path } : {}) }
        })
        const materialized = await resourceFetch
          .call({
            source: url,
            revision,
            cache,
            maxInlineBytes: 1_000_000,
          })
          .run(undefined, engineConfig)
        const materializedFile =
          'contentBase64' in materialized.value
            ? new File(
                [
                  Uint8Array.from(atob(materialized.value.contentBase64), (character) =>
                    character.charCodeAt(0),
                  ),
                ],
                materialized.value.name,
                {
                  type: materialized.value.mediaType,
                  ...(materialized.value.lastModified
                    ? { lastModified: materialized.value.lastModified }
                    : {}),
                },
              )
            : file
        return (await resourceFileDocuments(url, materializedFile, path, aliases, chapters)).map(
          (document) => ({
            ...document,
            chapters:
              document.metadata?.format === 'openapi' &&
              typeof document.metadata.category === 'string'
                ? [...chapters, titleFromDocumentationPath(document.metadata.category)]
                : document.chapters,
            metadata: {
              ...(document.metadata ?? {}),
              cache,
              manifestSource: source,
              revision,
            },
          }),
        )
      }),
    )
  ).flat()
  return {
    documents,
    ...(loaded.errors.length > 0 ? { errors: loaded.errors } : {}),
  }
}

export const createDocumentationProviderTool = (input: {
  name: string
  description: string
  longDescription: string
  loadDocuments: DocumentationProviderLoader
}): ClientTool =>
  createClientTool({
    function: input.loadDocuments,
    description: input.description,
    longDescription: input.longDescription,
    name: input.name,
    renderOptions: { hideChat: true, hideLlm: true, hideVector: true },
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    } as const satisfies JSONSchema7,
  })

export const createDocumentationIndexClientTool = (
  bases: ReturnType<typeof createDocumentationBaseStore>,
): ClientTool =>
  createClientTool({
    name: documentationIndexToolName,
    description: 'Register, list, retrieve, and search manifest-based documentation.',
    longDescription:
      'Generic documentation-base tool using runtime manifests and plain-text or regular-expression search. Registration returns the Taskyon URL where the resulting documentation can be viewed.',
    renderOptions: { hideChat: false, hideLlm: false, hideVector: true },
    parameters: {
      type: 'object',
      required: ['action'],
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'register', 'search', 'getDocument', 'refresh', 'remove'],
        },
        manifest: { type: 'object', description: 'Documentation manifest to register.' },
        baseId: { type: 'string', description: 'Documentation base route identifier.' },
        documentId: { type: 'string', description: 'Document identifier to retrieve.' },
        query: { type: 'string', description: 'Literal text or regular expression.' },
        mode: { type: 'string', enum: ['literal', 'regex'], default: 'literal' },
        limit: { type: 'number', default: 5, maximum: 50 },
      },
    } as const satisfies JSONSchema7,
    function: async (rawArgs) => {
      const args = DocumentationIndexArgs.parse(rawArgs)
      if (args.action === 'list') {
        return {
          bases: (await bases.list()).map((base) => ({
            id: base.id,
            url: `/docs/${base.id}`,
          })),
        }
      }
      if (args.action === 'register') {
        return await bases.register(parseDocumentationManifest(args.manifest))
      }
      if (args.action === 'remove') {
        await bases.remove(args.baseId)
        return { removed: true, baseId: args.baseId }
      }

      const documents = await bases.load(args.baseId)
      if (args.action === 'refresh') {
        return { baseId: args.baseId, documentCount: documents.length, url: `/docs/${args.baseId}` }
      }
      if (args.action === 'getDocument') {
        return documents.find((document) => document.id === args.documentId) ?? null
      }
      const hits = searchDocumentation(documents, {
        query: args.query,
        mode: args.mode,
        limit: args.limit,
      }).map((hit) => ({
        ...hit,
        sourceUrl: hit.url,
        url: `/docs/${args.baseId}/${hit.documentId.replace(/\.md$/, '')}`,
      }))
      return { baseId: args.baseId, url: `/docs/${args.baseId}`, hits }
    },
  })

export const createTaskyonDocumentationProviderTool = (
  loadFiles: ResourceFilesLoader,
  engineConfig?: EngineConfig,
): ClientTool =>
  createDocumentationProviderTool({
    name: taskyonDocsProviderToolName,
    loadDocuments: () =>
      loadDocumentationDocumentsFromManifest(taskyonDocumentationManifest, loadFiles, engineConfig),
    description: 'Load the bundled Taskyon markdown documentation for local indexing.',
    longDescription:
      'Runtime provider for the Taskyon documentation workflow. It expands the Taskyon documentation manifest, including the current peer OpenAPI description, and returns searchable documents for local indexing.',
  })
