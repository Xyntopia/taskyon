import { fileURLToPath } from 'node:url'
import { taskyonProtocol } from '../../../../taskyon/src/api/taskyonProtocol'
import { createTaskyonApiDescription } from '../../../../taskyon/src/api/taskyonOpenApi'
import { createNodeTaskyonDocumentationProviderTool } from '../../../../taskyon/src/tools/nodeTaskyonDocumentationProvider'
import { createSubtasksResult } from '../../../../taskyon/src/types/toolApi'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testNodeDocumentationProviderLoadsManifestSources = async () => {
  const provider = createNodeTaskyonDocumentationProviderTool({
    docsRoot: fileURLToPath(new URL('../../../../../public/docs', import.meta.url)),
    describeApi: () => Promise.resolve(createTaskyonApiDescription(taskyonProtocol, {})),
  })
  const result = await provider.function?.(
    {},
    {
      getExecutionTaskChain: () => Promise.resolve([]),
      createSubtasksResult,
      stopSignal: new AbortController().signal,
    },
  )

  assert(result && typeof result === 'object', 'Expected documentation provider result.')
  if (!result || typeof result !== 'object' || !('documents' in result)) {
    throw new Error('Expected documentation provider documents.')
  }
  const documents = result.documents
  assert(Array.isArray(documents) && documents.length > 0, 'Expected manifest documentation.')
  if (!Array.isArray(documents)) throw new Error('Expected a document array.')

  const authoredDocuments = documents.filter(
    (document) =>
      document &&
      typeof document === 'object' &&
      'path' in document &&
      typeof document.path === 'string' &&
      (document.path.startsWith('user/') || document.path.startsWith('developer/')),
  )
  assert(authoredDocuments.length > 0, 'Expected authored user and developer documentation.')
  assert(
    documents.some(
      (document) =>
        document &&
        typeof document === 'object' &&
        'path' in document &&
        typeof document.path === 'string' &&
        document.path.startsWith('openapi/'),
    ),
    'Expected the runtime OpenAPI description.',
  )
  assert(
    documents.every(
      (document) =>
        document &&
        typeof document === 'object' &&
        'content' in document &&
        typeof document.content === 'string' &&
        !document.content.startsWith('---'),
    ),
    'Expected provider content without YAML frontmatter.',
  )

  return { success: true, documentCount: documents.length }
}

testNodeDocumentationProviderLoadsManifestSources.description =
  'Loads authored files and runtime OpenAPI from the Taskyon documentation manifest.'
