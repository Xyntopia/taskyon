import { defineFrpServiceProtocol } from './frpBus'
import {
  createOpenApiOperationDocumentation,
  createProtocolOpenApiDocument,
  resolveOpenApiReferences,
} from './openApi'
import { createOpenApiDocumentationSections } from './openApiDocumentation'
import { z } from 'zod'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testFrpProtocolGeneratesDeterministicOpenApi = () => {
  const protocol = defineFrpServiceProtocol({
    service: 'catalog',
    version: '2',
    commands: {
      get: {
        request: z.object({ id: z.string().describe('Catalog item id.') }),
        response: z.object({ title: z.string() }),
      },
    },
    streams: {
      updates: {
        changed: z.object({ id: z.string() }),
      },
    },
  })

  const first = createProtocolOpenApiDocument(protocol, {
    title: 'Catalog peer',
  })
  const second = createProtocolOpenApiDocument(protocol, {
    title: 'Catalog peer',
  })

  assert(JSON.stringify(first) === JSON.stringify(second), 'Expected deterministic OpenAPI output.')
  assert(first.openapi === '3.1.0', 'Expected OpenAPI 3.1.')
  assert(
    first.paths['/frp/catalog.get']?.post?.['x-taskyon-command'] === 'catalog.get',
    'Expected the FRP command binding.',
  )
  assert(
    first['x-taskyon-streams']['catalog.updates']?.changed !== undefined,
    'Expected stream schemas in the Taskyon extension.',
  )

  return { success: true }
}

export const testOpenApiProducesSearchableDocumentationSections = () => {
  const protocol = defineFrpServiceProtocol({
    service: 'catalog',
    version: '1',
    commands: {
      list: {
        request: z.object({}),
        response: z.array(z.string()),
      },
    },
  })
  const document = createProtocolOpenApiDocument(protocol)
  const sections = createOpenApiDocumentationSections(
    JSON.stringify(document),
    '/resources/peers/local/api',
  )

  assert(
    sections.some(
      (section) =>
        section.title === 'catalog.list' &&
        section.url === '/resources/peers/local/api#operation-catalog-list',
    ),
    'Expected an independently searchable operation with a viewer anchor.',
  )

  return { success: true }
}

export const testOpenApiResolvesLocalSchemaReferencesForDisplay = () => {
  const protocol = defineFrpServiceProtocol({
    service: 'catalog',
    version: '1',
    commands: {
      get: {
        request: z.object({ id: z.string().describe('Catalog item id.') }),
        response: z.object({ title: z.string().describe('Catalog item title.') }),
      },
    },
  })
  const document = createProtocolOpenApiDocument(protocol)
  const operation = document.paths['/frp/catalog.get']?.post
  if (!operation) throw new Error('Expected catalog.get operation.')

  const resolved = resolveOpenApiReferences(document, operation)
  const text = JSON.stringify(resolved)
  assert(text.includes('Catalog item id.'), 'Expected the referenced request schema inline.')
  assert(text.includes('Catalog item title.'), 'Expected the referenced response schema inline.')
  assert(!text.includes('#/components/schemas/'), 'Expected local references to be resolved.')
  assert(
    JSON.stringify(operation).includes('#/components/schemas/'),
    'Expected reference resolution not to mutate the OpenAPI document.',
  )
  return { success: true }
}

export const testOpenApiCreatesOperationDocumentationModels = () => {
  const protocol = defineFrpServiceProtocol({
    service: 'catalog',
    version: '1',
    commands: {
      update: {
        request: z
          .object({
            id: z.string().describe('Catalog item id.'),
            note: z.string().optional().describe('Optional catalog note.'),
          })
          .describe('Update a catalog item.'),
      },
    },
  })
  const document = createProtocolOpenApiDocument(protocol)
  const operation = createOpenApiOperationDocumentation(document, '/frp/catalog.update')

  assert(operation !== undefined, 'Expected operation documentation for the requested path.')
  assert(operation?.method === 'POST', 'Expected the transport method in the documentation model.')
  assert(operation?.request?.schema.type === 'object', 'Expected a resolved request object schema.')
  assert(
    operation?.request?.schema.properties?.id !== undefined,
    'Expected request fields without OpenAPI reference nesting.',
  )
  assert(
    operation?.responses[0]?.status === '204' && operation.responses[0].schema === undefined,
    'Expected commands without a result to document a no-content response.',
  )

  return { success: true }
}

testFrpProtocolGeneratesDeterministicOpenApi.description =
  'Generates stable OpenAPI 3.1 documentation from FRP command and stream schemas.'
testOpenApiProducesSearchableDocumentationSections.description =
  'Converts OpenAPI operations into independently searchable documentation sections.'
testOpenApiResolvesLocalSchemaReferencesForDisplay.description =
  'Resolves local component references into complete request and response schemas for display.'
testOpenApiCreatesOperationDocumentationModels.description =
  'Converts OpenAPI operations into semantic request and response documentation models.'
