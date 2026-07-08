import type { JSONSchema7 } from 'json-schema'
import type { ClientTool } from '../types/toolApi'
import { createClientTool } from '../types/toolApi'

export const taskyonDocsProviderToolName = 'getTaskyonDocumentationDocuments'

export type DocumentationDocument = {
  id: string
  path: string
  title?: string
  url?: string
  content: string
  metadata?: Record<string, unknown>
}

export type DocumentationProviderLoader = () => Promise<{
  documents: DocumentationDocument[]
}>

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

export const createTaskyonDocumentationProviderTool = (
  loadDocuments: DocumentationProviderLoader,
): ClientTool =>
  createDocumentationProviderTool({
    name: taskyonDocsProviderToolName,
    loadDocuments,
    description: 'Load the bundled Taskyon markdown documentation for local indexing.',
    longDescription:
      'Browser-side provider for the Taskyon documentation workflow. It discovers app-served public/docs markdown files and returns their current content so core documentation tools can index them locally.',
  })
