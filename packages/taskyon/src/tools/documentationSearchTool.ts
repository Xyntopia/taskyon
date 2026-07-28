import type { JSONSchema7 } from 'json-schema'
import z from 'zod'
import { createTool, toolCall } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import type { FunctionArguments } from '../types/tools'

export const documentationIndexToolName = 'documentationIndex'

const DocumentationSearchArgs = z.object({
  query: z.string().min(1),
  k: z.number().int().positive().max(12).default(5),
  phase: z.literal('searchResult').optional(),
})

const DocumentationSearchHit = z.object({
  documentId: z.string(),
  path: z.string(),
  title: z.string(),
  url: z.string(),
  heading: z.string(),
  content: z.string(),
  score: z.number(),
})
type DocumentationSearchHit = z.infer<typeof DocumentationSearchHit>

const readDocumentationSearchResult = (taskChain: TaskNode[]) => {
  for (let index = taskChain.length - 1; index >= 0; index -= 1) {
    const task = taskChain[index]
    if (task?.content.type !== 'toolresult' || !task.parentID) continue
    const parent = taskChain.find((candidate) => candidate.id === task.parentID)
    if (
      parent?.content.type !== 'functioncall' ||
      parent.content.data.name !== documentationIndexToolName
    ) {
      continue
    }
    const parsed = z.object({ hits: z.array(DocumentationSearchHit) }).safeParse(task.content.data)
    if (parsed.success) return parsed.data.hits
  }
  return undefined
}

const formatSearchContext = (query: string, hits: DocumentationSearchHit[]) =>
  [
    `Documentation search results for: ${query}`,
    ...hits.map(
      (hit, index) => `Source ${index + 1}: ${hit.title}
Path: ${hit.path}
URL: ${hit.url}
Heading: ${hit.heading}
Score: ${hit.score}

${hit.content}`,
    ),
  ].join('\n\n---\n\n')

export type DocumentationSearchToolOptions = {
  name: string
  baseId: string
  productName: string
}

export const createDocumentationSearchTool = (options: DocumentationSearchToolOptions) =>
  createTool({
    name: options.name,
    description: `Search and answer questions from the ${options.productName} documentation.`,
    longDescription:
      `Thin wrapper around the generic documentationIndex tool for the ${options.productName} documentation base. ` +
      'It retrieves plain-text matches and answers with links to the corresponding documentation pages.',
    renderOptions: { hideChat: false, hideLlm: false, hideVector: true },
    parameters: {
      type: 'object',
      required: ['query'],
      additionalProperties: false,
      properties: {
        query: {
          type: 'string',
          description: `Question to answer from ${options.productName} documentation.`,
        },
        k: { type: 'number', description: 'Maximum matching sections.', default: 5 },
        phase: {
          type: 'string',
          enum: ['searchResult'],
          description: 'Internal workflow phase used by Taskyon re-entry calls.',
        },
      },
    } as const satisfies JSONSchema7,
    function: async (rawArgs: FunctionArguments, ctx) => {
      const args = DocumentationSearchArgs.parse(rawArgs)
      if (!args.phase) {
        return ctx.createSubtasksResult([
          [
            {
              role: 'assistant',
              content: {
                type: 'message',
                data: `Searching ${options.productName} documentation...`,
              },
            },
            toolCall({
              name: documentationIndexToolName,
              arguments: {
                action: 'search',
                baseId: options.baseId,
                query: args.query,
                mode: 'literal',
                limit: args.k,
              },
            }),
            toolCall({
              name: options.name,
              arguments: { query: args.query, k: args.k, phase: 'searchResult' },
            }),
          ],
        ])
      }

      const hits = readDocumentationSearchResult(await ctx.getExecutionTaskChain())
      if (!hits) throw new Error('documentationIndex did not return documentation search results.')
      if (hits.length === 0) {
        return ctx.createSubtasksResult([
          [
            {
              role: 'assistant',
              content: {
                type: 'message',
                data: `I did not find matching ${options.productName} documentation for "${args.query}".`,
              },
            },
          ],
        ])
      }

      return ctx.createSubtasksResult([
        [
          {
            role: 'system',
            content: { type: 'message', data: formatSearchContext(args.query, hits) },
          },
          toolCall({
            name: 'chatCompletion',
            arguments: {
              appendSystemPrompts: [
                `Answer the user's ${options.productName} documentation question using only the documentation search results above. Cite the documentation URL for every important claim. Question: ${args.query}`,
              ],
            },
          }),
        ],
      ])
    },
  })
