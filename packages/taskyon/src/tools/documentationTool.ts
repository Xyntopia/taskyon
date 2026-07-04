import type { JSONSchema7 } from 'json-schema'
import z from 'zod'
import { createTool, toolCall } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import type { FunctionArguments } from '../types/tools'
import { createPgLiteCrudWrapper, createVectorStore } from '../utils/crudWrapper'
import { sha256UrlSafeHash } from '../utils/encoding'
import type { TyPGDB } from '../utils/pglite.api'

const taskyonDocsCorpusId = 'taskyon-docs'
const taskyonDocsProviderToolName = 'getTaskyonDocumentationDocuments'

const DocumentationDocument = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  title: z.string().optional(),
  url: z.string().optional(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
export type DocumentationDocument = z.infer<typeof DocumentationDocument>

const DocumentationChunk = z.object({
  id: z.string(),
  corpusId: z.string(),
  documentId: z.string(),
  path: z.string(),
  title: z.string().optional(),
  url: z.string().optional(),
  heading: z.string().optional(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
type DocumentationChunk = z.infer<typeof DocumentationChunk>

const DocumentationActionArgs = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('status'),
    corpusId: z.string().default(taskyonDocsCorpusId),
  }),
  z.object({
    action: z.literal('index'),
    corpusId: z.string().default(taskyonDocsCorpusId),
    documents: z.array(DocumentationDocument),
    forceRefresh: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('search'),
    corpusId: z.string().default(taskyonDocsCorpusId),
    query: z.string().min(1),
    k: z.number().int().positive().max(25).default(5),
  }),
  z.object({
    action: z.literal('getDocument'),
    corpusId: z.string().default(taskyonDocsCorpusId),
    documentId: z.string().min(1),
  }),
  z.object({
    action: z.literal('clear'),
    corpusId: z.string().default(taskyonDocsCorpusId),
  }),
])

const TaskyonDocumentationArgs = z.object({
  query: z.string().min(1),
  k: z.number().int().positive().max(12).default(5),
  allowIndex: z.boolean().optional(),
  forceRefresh: z.boolean().optional(),
  phase: z.enum(['awaitConsent', 'indexProviderResult']).optional(),
})

type DocumentationSearchHit = DocumentationChunk & {
  distance?: number
  lexicalScore?: number
}

const chunkTableName = 'documentationChunks'
const documentTableName = 'documentationDocuments'
const maxChunkLength = 2400
const chunkOverlap = 250

const headingRegex = /^(#{1,6})\s+(.+)$/gm

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const normalizeTitle = (doc: DocumentationDocument) =>
  doc.title ?? doc.path.split('/').pop()?.replace(/\.md$/, '') ?? doc.id

const splitLongSection = (content: string): string[] => {
  if (content.length <= maxChunkLength) return [content]
  const chunks: string[] = []
  let start = 0
  while (start < content.length) {
    const end = Math.min(content.length, start + maxChunkLength)
    chunks.push(content.slice(start, end).trim())
    if (end === content.length) break
    start = Math.max(0, end - chunkOverlap)
  }
  return chunks.filter((chunk) => chunk.length > 0)
}

const chunkMarkdownDocument = async (doc: DocumentationDocument): Promise<DocumentationChunk[]> => {
  const matches = Array.from(doc.content.matchAll(headingRegex))
  const sections =
    matches.length === 0
      ? [{ heading: normalizeTitle(doc), start: 0, end: doc.content.length }]
      : matches.map((match, index) => ({
          heading: match[2]?.trim() || normalizeTitle(doc),
          start: match.index ?? 0,
          end: matches[index + 1]?.index ?? doc.content.length,
        }))

  const chunks: DocumentationChunk[] = []
  for (const [sectionIndex, section] of sections.entries()) {
    const sectionText = doc.content.slice(section.start, section.end).trim()
    const sectionChunks = splitLongSection(sectionText)
    for (const [chunkIndex, content] of sectionChunks.entries()) {
      const id = await sha256UrlSafeHash({
        documentId: doc.id,
        path: doc.path,
        sectionIndex,
        chunkIndex,
        content,
      })
      chunks.push({
        id,
        corpusId: '',
        documentId: doc.id,
        path: doc.path,
        title: normalizeTitle(doc),
        ...(doc.url ? { url: doc.url } : {}),
        heading: section.heading,
        content,
        ...(doc.metadata ? { metadata: doc.metadata } : {}),
      })
    }
  }
  return chunks
}

const scoreLexicalHit = (chunk: DocumentationChunk, terms: string[]) => {
  const haystack = `${chunk.title ?? ''} ${chunk.path} ${chunk.heading ?? ''} ${chunk.content}`
    .toLowerCase()
    .replace(/\s+/g, ' ')
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0)
}

const withTimeoutFallback = async <T>(promise: Promise<T>, timeoutMs: number, fallback: T) =>
  await new Promise<T>((resolve) => {
    const timeout = setTimeout(() => resolve(fallback), timeoutMs)
    promise
      .then((value) => {
        clearTimeout(timeout)
        resolve(value)
      })
      .catch(() => {
        clearTimeout(timeout)
        resolve(fallback)
      })
  })

async function createDocumentationIndex(db: TyPGDB) {
  const documents = await createPgLiteCrudWrapper<DocumentationDocument>(db, {
    tableName: documentTableName,
  })
  const chunks = await createVectorStore<DocumentationChunk>(db, chunkTableName)

  const getCorpusChunks = async (corpusId: string) =>
    Object.entries(await chunks.find({ corpusId })).map(([id, chunk]) => ({ ...chunk, id }))

  const clearCorpus = async (corpusId: string) => {
    await db.query(`DELETE FROM ${chunkTableName} WHERE data @> $1`, [JSON.stringify({ corpusId })])
    await db.query(`DELETE FROM ${documentTableName} WHERE data @> $1`, [
      JSON.stringify({ metadata: { corpusId } }),
    ])
  }

  const status = async (corpusId: string) => {
    const corpusChunks = await getCorpusChunks(corpusId)
    const documentIds = new Set(corpusChunks.map((chunk) => chunk.documentId))
    return {
      corpusId,
      indexed: corpusChunks.length > 0,
      documentCount: documentIds.size,
      chunkCount: corpusChunks.length,
    }
  }

  const index = async (
    corpusId: string,
    docs: DocumentationDocument[],
    options?: { forceRefresh?: boolean },
  ) => {
    if (options?.forceRefresh) await clearCorpus(corpusId)

    let chunkCount = 0
    for (const doc of docs) {
      const savedDoc: DocumentationDocument = {
        ...doc,
        title: normalizeTitle(doc),
        metadata: {
          ...(doc.metadata ?? {}),
          corpusId,
        },
      }
      await documents.set(doc.id, savedDoc)
      const docChunks = await chunkMarkdownDocument(savedDoc)
      for (const chunk of docChunks) {
        const savedChunk = { ...chunk, corpusId }
        await chunks.upsert(savedChunk.id, savedChunk.content, savedChunk)
        chunkCount += 1
      }
    }

    return {
      corpusId,
      documentCount: docs.length,
      chunkCount,
    }
  }

  const search = async (corpusId: string, query: string, k: number) => {
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3)
    const lexicalHits = (await getCorpusChunks(corpusId))
      .map((chunk) => ({ ...chunk, lexicalScore: scoreLexicalHit(chunk, terms) }))
      .filter((chunk) => chunk.lexicalScore > 0)
      .sort((a, b) => (b.lexicalScore ?? 0) - (a.lexicalScore ?? 0))
      .slice(0, k)

    if (lexicalHits.length >= k) return lexicalHits

    const vectorHits = await withTimeoutFallback(
      chunks.search(query, k, undefined, { corpusId }),
      5000,
      [],
    )
    const hydratedVectorHits: DocumentationSearchHit[] = []
    for (const hit of vectorHits) {
      const chunk = await chunks.get(hit.id)
      if (chunk) hydratedVectorHits.push({ ...chunk, distance: hit.distance })
    }

    const merged = new Map<string, DocumentationSearchHit>()
    for (const hit of hydratedVectorHits) merged.set(hit.id, hit)
    for (const hit of lexicalHits) merged.set(hit.id, { ...merged.get(hit.id), ...hit })

    return Array.from(merged.values())
      .sort((a, b) => {
        const lexicalDelta = (b.lexicalScore ?? 0) - (a.lexicalScore ?? 0)
        if (lexicalDelta !== 0) return lexicalDelta
        return (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY)
      })
      .slice(0, k)
  }

  const getDocument = async (corpusId: string, documentId: string) => {
    const doc = await documents.get(documentId)
    if (doc?.metadata?.corpusId === corpusId) return doc
    return null
  }

  return {
    clearCorpus,
    getDocument,
    index,
    search,
    status,
  }
}

const formatSearchContext = (query: string, hits: DocumentationSearchHit[]) =>
  [
    `Documentation search results for: ${query}`,
    ...hits.map(
      (hit, index) => `Source ${index + 1}: ${hit.title ?? hit.path}
Path: ${hit.path}${hit.url ? `\nURL: ${hit.url}` : ''}
Heading: ${hit.heading ?? 'n/a'}
Score: ${hit.lexicalScore ?? 'semantic'}${hit.distance !== undefined ? `, distance ${hit.distance}` : ''}

${hit.content}`,
    ),
  ].join('\n\n---\n\n')

const createConsentHtml = (query: string) => `<div style="font-family:sans-serif;max-width:460px">
  <p><strong>Index Taskyon documentation?</strong></p>
  <p>Taskyon can build a local browser index for the documentation before answering:</p>
  <p style="font-style:italic">${escapeHtml(query)}</p>
  <div style="display:flex;gap:.5rem;margin-top:.75rem">
    <button id="taskyon-docs-index-confirm">Index docs</button>
    <button id="taskyon-docs-index-cancel" style="background:#eee;color:#444">Cancel</button>
  </div>
</div>
<script>
  document.getElementById('taskyon-docs-index-confirm').addEventListener('click', () => {
    window.parent.postMessage({ action: 'taskyon-docs-index-confirm' }, '*');
  });
  document.getElementById('taskyon-docs-index-cancel').addEventListener('click', () => {
    window.parent.postMessage({ action: 'taskyon-docs-index-cancel' }, '*');
  });
</script>`

const readProviderDocumentsFromTaskChain = (taskChain: TaskNode[]) => {
  for (let index = taskChain.length - 1; index >= 0; index -= 1) {
    const task = taskChain[index]
    if (task?.content.type !== 'toolresult' || !task.parentID) continue
    const parent = taskChain.find((candidate) => candidate.id === task.parentID)
    if (
      parent?.content.type === 'functioncall' &&
      parent.content.data.name === taskyonDocsProviderToolName
    ) {
      const parsed = z
        .object({ documents: z.array(DocumentationDocument) })
        .safeParse(task.content.data)
      if (parsed.success) return parsed.data.documents
    }
  }
  return undefined
}

export const createDocumentationIndexTool = (db: TyPGDB) =>
  createTool({
    name: 'documentationIndex',
    description: 'Index, search, retrieve, and clear markdown documentation corpora.',
    longDescription:
      'Generic local documentation index backed by PGlite vector search plus lexical fallback. Use this for project documentation corpora when documents are supplied directly by a caller or provider tool.',
    renderOptions: { hideChat: true, hideLlm: false, hideVector: true },
    parameters: {
      type: 'object',
      required: ['action'],
      additionalProperties: false,
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'index', 'search', 'getDocument', 'clear'],
          description: 'Index operation to perform.',
        },
        corpusId: {
          type: 'string',
          description: 'Logical documentation corpus to index or search.',
          default: taskyonDocsCorpusId,
        },
        documents: {
          type: 'array',
          description: 'Documents to index when action is index.',
          items: {
            type: 'object',
            required: ['id', 'path', 'content'],
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              path: { type: 'string' },
              title: { type: 'string' },
              url: { type: 'string' },
              content: { type: 'string' },
              metadata: { type: 'object', additionalProperties: true },
            },
          },
        },
        query: {
          type: 'string',
          description: 'Natural language or exact text query for search.',
        },
        k: {
          type: 'number',
          description: 'Maximum number of results to return.',
          default: 5,
        },
        documentId: {
          type: 'string',
          description: 'Document id to retrieve.',
        },
        forceRefresh: {
          type: 'boolean',
          description: 'When indexing, clear existing chunks for the corpus before writing.',
          default: false,
        },
      },
    } as const satisfies JSONSchema7,
    function: async (rawArgs) => {
      const args = DocumentationActionArgs.parse(rawArgs)
      const index = await createDocumentationIndex(db)
      if (args.action === 'status') return await index.status(args.corpusId)
      if (args.action === 'index') {
        return await index.index(
          args.corpusId,
          args.documents,
          args.forceRefresh === undefined ? undefined : { forceRefresh: args.forceRefresh },
        )
      }
      if (args.action === 'search') return await index.search(args.corpusId, args.query, args.k)
      if (args.action === 'getDocument') {
        return await index.getDocument(args.corpusId, args.documentId)
      }
      await index.clearCorpus(args.corpusId)
      return { corpusId: args.corpusId, cleared: true }
    },
  })

export const createTaskyonDocumentationTool = (db: TyPGDB) =>
  createTool({
    name: 'taskyonDocumentation',
    description: 'Search and answer questions from the Taskyon documentation.',
    longDescription:
      'Searches the local Taskyon documentation index. On first browser use, it asks for consent inside the chat, loads the bundled Taskyon markdown docs through the UI provider, indexes them locally, and then answers with cited documentation snippets.',
    renderOptions: { hideChat: false, hideLlm: false, hideVector: true },
    parameters: {
      type: 'object',
      required: ['query'],
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: 'Question to answer from the Taskyon documentation.',
        },
        k: {
          type: 'number',
          description: 'Maximum number of documentation chunks to retrieve.',
          default: 5,
        },
        allowIndex: {
          type: 'boolean',
          description: 'Allow indexing without showing the in-chat confirmation UI.',
          default: false,
        },
        forceRefresh: {
          type: 'boolean',
          description: 'Rebuild the Taskyon docs index even if it already exists.',
          default: false,
        },
        phase: {
          type: 'string',
          enum: ['awaitConsent', 'indexProviderResult'],
          description: 'Internal workflow phase used by Taskyon re-entry calls.',
        },
      },
    } as const satisfies JSONSchema7,
    function: async (rawArgs: FunctionArguments, ctx) => {
      const args = TaskyonDocumentationArgs.parse(rawArgs)
      const index = await createDocumentationIndex(db)

      if (args.phase === 'awaitConsent') {
        const payload = await new Promise<'confirm' | 'cancel'>((resolve) => {
          const port = ctx.messagePort
          if (!port) {
            resolve('confirm')
            return
          }
          port.onmessage = (event) => {
            const parsed = z
              .object({ payload: z.object({ action: z.string() }).optional() })
              .safeParse(event.data)
            const action = parsed.success ? parsed.data.payload?.action : undefined
            if (action === 'taskyon-docs-index-confirm') resolve('confirm')
            if (action === 'taskyon-docs-index-cancel') resolve('cancel')
          }
        })

        if (payload === 'cancel') {
          return ctx.createSubtasksResult([
            [
              {
                role: 'assistant',
                content: {
                  type: 'message',
                  data: 'Documentation indexing was cancelled. I need a local docs index before I can answer from Taskyon docs.',
                },
              },
            ],
          ])
        }

        return ctx.createSubtasksResult([
          [
            {
              role: 'assistant',
              content: {
                type: 'message',
                data: 'Indexing Taskyon documentation before answering...',
              },
            },
            toolCall({ name: taskyonDocsProviderToolName, arguments: {} }),
            toolCall({
              name: 'taskyonDocumentation',
              arguments: {
                query: args.query,
                k: args.k,
                forceRefresh: args.forceRefresh,
                phase: 'indexProviderResult',
              },
            }),
          ],
        ])
      }

      const indexedProviderResult = args.phase === 'indexProviderResult'
      if (indexedProviderResult) {
        const taskChain = await ctx.getExecutionTaskChain()
        const documents = readProviderDocumentsFromTaskChain(taskChain)
        if (!documents) {
          return ctx.createSubtasksResult([
            [
              {
                role: 'assistant',
                content: {
                  type: 'error',
                  data: `Taskyon documentation provider "${taskyonDocsProviderToolName}" did not return documents.`,
                },
              },
            ],
          ])
        }
        await index.index(taskyonDocsCorpusId, documents, {
          forceRefresh: args.forceRefresh !== false,
        })
      }

      const status = await index.status(taskyonDocsCorpusId)
      if (!status.indexed || (args.forceRefresh && !indexedProviderResult)) {
        if (args.allowIndex) {
          return ctx.createSubtasksResult([
            [
              {
                role: 'assistant',
                content: {
                  type: 'message',
                  data: 'Indexing Taskyon documentation before answering...',
                },
              },
              toolCall({ name: taskyonDocsProviderToolName, arguments: {} }),
              toolCall({
                name: 'taskyonDocumentation',
                arguments: {
                  query: args.query,
                  k: args.k,
                  forceRefresh: args.forceRefresh,
                  phase: 'indexProviderResult',
                },
              }),
            ],
          ])
        }

        return ctx.createSubtasksResult([
          [
            {
              role: 'assistant',
              content: {
                type: 'message',
                data: createConsentHtml(args.query),
              },
            },
            toolCall({
              name: 'taskyonDocumentation',
              arguments: {
                query: args.query,
                k: args.k,
                forceRefresh: args.forceRefresh,
                phase: 'awaitConsent',
              },
            }),
          ],
        ])
      }

      const hits = await index.search(taskyonDocsCorpusId, args.query, args.k)
      if (hits.length === 0) {
        return ctx.createSubtasksResult([
          [
            {
              role: 'assistant',
              content: {
                type: 'message',
                data: `I did not find matching Taskyon documentation for "${args.query}".`,
              },
            },
          ],
        ])
      }

      return ctx.createSubtasksResult([
        [
          {
            role: 'system',
            content: {
              type: 'message',
              data: formatSearchContext(args.query, hits),
            },
          },
          toolCall({
            name: 'chatCompletion',
            arguments: {
              appendSystemPrompts: [
                `Answer the user's Taskyon documentation question using only the documentation search results above. Cite the source path for every important claim. Question: ${args.query}`,
              ],
            },
          }),
        ],
      ])
    },
  })
