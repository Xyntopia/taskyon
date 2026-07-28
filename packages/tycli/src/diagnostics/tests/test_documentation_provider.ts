import { fileURLToPath } from 'node:url'
import { taskyonProtocol } from '../../../../taskyon/src/api/taskyonProtocol'
import { createTaskyonApiDescription } from '../../../../taskyon/src/api/taskyonOpenApi'
import { taskyonDocumentationManifest } from '../../../../taskyon/src/documentationManifest'
import { loadDocumentationDocumentsFromManifest } from '../../../../taskyon/src/tools/documentationProviderTool'
import { createNodeResourceFilesLoader } from '../../../../taskyon/src/tools/nodeTaskyonDocumentationProvider'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testNodeDocumentationLoaderLoadsManifestSources = async () => {
  const loadFiles = createNodeResourceFilesLoader(
    fileURLToPath(new URL('../../../../../public/docs', import.meta.url)),
    () => Promise.resolve(createTaskyonApiDescription(taskyonProtocol, {})),
  )
  const { documents } = await loadDocumentationDocumentsFromManifest(
    taskyonDocumentationManifest,
    loadFiles,
  )
  assert(documents.length > 0, 'Expected manifest documentation.')

  const authoredDocuments = documents.filter(
    (document) => document.path.startsWith('user/') || document.path.startsWith('developer/'),
  )
  assert(authoredDocuments.length > 0, 'Expected authored user and developer documentation.')
  const openApiDocuments = documents.filter((document) => document.metadata?.format === 'openapi')
  assert(openApiDocuments.length === 1, 'Expected one runtime OpenAPI document.')
  assert(
    openApiDocuments[0]?.path === 'openapi/taskyon-peer-api',
    'Expected a stable route for the complete OpenAPI document.',
  )
  assert(
    JSON.parse(openApiDocuments[0]?.content ?? '{}').openapi === '3.1.0',
    'Expected the tool-visible document content to remain raw OpenAPI JSON.',
  )
  assert(
    documents.every((document) => !document.content.startsWith('---')),
    'Expected document content without YAML frontmatter.',
  )

  return { success: true, documentCount: documents.length }
}

testNodeDocumentationLoaderLoadsManifestSources.description =
  'Loads authored files and runtime OpenAPI from the Taskyon documentation manifest.'

export const testNodeDocumentationLoaderAcceptsHostApiOptions = async () => {
  const loadFiles = createNodeResourceFilesLoader(
    '/unused',
    () => Promise.resolve(createTaskyonApiDescription(taskyonProtocol, {})),
    {
      apiSource: '/resources/peers/local/host-api',
      apiFileName: 'host.openapi.json',
    },
  )
  const files: File[] = []
  for await (const loaded of loadFiles('/resources/peers/local/host-api')) {
    files.push(loaded.file)
  }

  assert(files.length === 1, 'Expected one host API document.')
  assert(files[0]?.name === 'host.openapi.json', 'Expected the configured OpenAPI filename.')
  return { success: true }
}

testNodeDocumentationLoaderAcceptsHostApiOptions.description =
  'Loads a host API from a configured source using the host-specific OpenAPI filename.'
