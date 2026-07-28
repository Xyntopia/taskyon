import { createDocumentationSearchTool } from './documentationSearchTool'

export {
  createDocumentationSearchTool,
  documentationIndexToolName,
  type DocumentationSearchToolOptions,
} from './documentationSearchTool'

export const taskyonDocsCorpusId = 'taskyon'

export const taskyonDocumentationTool = createDocumentationSearchTool({
  name: 'taskyonDocumentation',
  baseId: taskyonDocsCorpusId,
  productName: 'Taskyon',
})
