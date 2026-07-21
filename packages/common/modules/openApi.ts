import type { FrpProtocolDefinition } from './frpBus'
import { z } from 'zod'

export type OpenApiJsonSchema = z.core.JSONSchema.BaseSchema

export type OpenApiOperation = {
  operationId: string
  summary?: string
  requestBody: {
    required: true
    content: {
      'application/json': {
        schema: { $ref: string }
      }
    }
  }
  responses: Record<
    string,
    {
      description: string
      content?: {
        'application/json': {
          schema: { $ref: string }
        }
      }
    }
  >
  'x-taskyon-command': string
  'x-taskyon-transport': 'frp'
}

export type TaskyonOpenApiDocument = {
  openapi: '3.1.0'
  info: {
    title: string
    version: string
    description?: string
  }
  paths: Record<string, { post: OpenApiOperation }>
  components: {
    schemas: Record<string, OpenApiJsonSchema>
  }
  'x-taskyon-protocol': {
    id: string
    version: string
  }
  'x-taskyon-streams': Record<string, Record<string, OpenApiJsonSchema>>
  'x-taskyon-tools'?: Record<
    string,
    {
      description: string
      longDescription?: string
      parameters: OpenApiJsonSchema
      result: OpenApiJsonSchema
    }
  >
}

export type OpenApiOperationDocumentation = {
  operationId: string
  method: 'POST'
  path: string
  summary?: string
  request: {
    required: boolean
    contentType: 'application/json'
    schema: OpenApiJsonSchema
  }
  responses: Array<{
    status: string
    description: string
    contentType?: 'application/json'
    schema?: OpenApiJsonSchema
  }>
}

const openApiDocumentBoundary = z.looseObject({
  openapi: z.literal('3.1.0'),
  info: z.looseObject({
    title: z.string(),
    version: z.string(),
    description: z.string().optional(),
  }),
  paths: z.record(z.string(), z.unknown()),
  components: z.looseObject({
    schemas: z.record(z.string(), z.unknown()),
  }),
  'x-taskyon-protocol': z.looseObject({
    id: z.string(),
    version: z.string(),
  }),
  'x-taskyon-streams': z.record(z.string(), z.unknown()),
  'x-taskyon-tools': z.record(z.string(), z.unknown()).optional(),
})

export const TaskyonOpenApiDocumentSchema = z.custom<TaskyonOpenApiDocument>(
  (value) => openApiDocumentBoundary.safeParse(value).success,
  'Invalid Taskyon OpenAPI document.',
)

const openApiObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const localSchemaName = (reference: string) => {
  const prefix = '#/components/schemas/'
  if (!reference.startsWith(prefix)) return undefined
  return reference.slice(prefix.length).replaceAll('~1', '/').replaceAll('~0', '~')
}

export const resolveOpenApiReferences = (
  document: TaskyonOpenApiDocument,
  value: unknown,
): unknown => {
  const resolve = (current: unknown, resolving: ReadonlySet<string>): unknown => {
    if (Array.isArray(current)) return current.map((entry) => resolve(entry, resolving))
    const object = openApiObject(current)
    if (!object) return current

    const reference = typeof object.$ref === 'string' ? object.$ref : undefined
    const schemaName = reference ? localSchemaName(reference) : undefined
    const referencedSchema = schemaName ? document.components.schemas[schemaName] : undefined
    if (reference && referencedSchema && !resolving.has(reference)) {
      const nextResolving = new Set(resolving).add(reference)
      const resolvedSchema = openApiObject(resolve(referencedSchema, nextResolving)) ?? {}
      const siblings = Object.fromEntries(
        Object.entries(object)
          .filter(([key]) => key !== '$ref')
          .map(([key, entry]) => [key, resolve(entry, resolving)]),
      )
      return { ...resolvedSchema, ...siblings }
    }

    return Object.fromEntries(
      Object.entries(object).map(([key, entry]) => [key, resolve(entry, resolving)]),
    )
  }

  return resolve(value, new Set())
}

const resolveOpenApiSchema = (
  document: TaskyonOpenApiDocument,
  schema: OpenApiJsonSchema | { $ref: string },
): OpenApiJsonSchema => resolveOpenApiReferences(document, schema) as OpenApiJsonSchema

export const createOpenApiOperationDocumentation = (
  document: TaskyonOpenApiDocument,
  path: string,
): OpenApiOperationDocumentation | undefined => {
  const operation = document.paths[path]?.post
  if (!operation) return undefined

  const requestSchema = operation.requestBody.content['application/json'].schema
  const responses = Object.entries(operation.responses)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .map(([status, response]) => {
      const responseSchema = response.content?.['application/json'].schema
      return {
        status,
        description: response.description,
        ...(responseSchema
          ? {
              contentType: 'application/json' as const,
              schema: resolveOpenApiSchema(document, responseSchema),
            }
          : {}),
      }
    })

  return {
    operationId: operation.operationId,
    method: 'POST',
    path,
    ...(operation.summary ? { summary: operation.summary } : {}),
    request: {
      required: operation.requestBody.required,
      contentType: 'application/json',
      schema: resolveOpenApiSchema(document, requestSchema),
    },
    responses,
  }
}

type RuntimeProtocol = FrpProtocolDefinition<
  Record<
    string,
    {
      request: z.ZodType
      response: z.ZodType
    }
  >,
  Record<string, Record<string, z.ZodType>>,
  z.ZodType | undefined
>

const schemaName = (value: string) =>
  value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('')

const jsonSchema = (schema: z.ZodType): OpenApiJsonSchema =>
  z.toJSONSchema(schema, { unrepresentable: 'any' })

const commandRequestSchema = (schema: z.ZodType): OpenApiJsonSchema => {
  const converted = jsonSchema(schema)
  const properties = { ...(converted.properties ?? {}) }
  delete properties.type
  delete properties.requestId
  const required = converted.required?.filter((field) => field !== 'type' && field !== 'requestId')
  return {
    ...converted,
    properties,
    ...(required && required.length > 0 ? { required } : {}),
  }
}

const commandResultSchema = (converted: OpenApiJsonSchema): OpenApiJsonSchema => {
  const result = converted.properties?.result
  if (result === true) return {}
  if (result === false) return { not: {} }
  return result ?? {}
}

export const createProtocolOpenApiDocument = (
  protocol: RuntimeProtocol,
  options: {
    title?: string
    description?: string
  } = {},
): TaskyonOpenApiDocument => {
  const schemas: Record<string, OpenApiJsonSchema> = {}
  const paths: TaskyonOpenApiDocument['paths'] = {}

  for (const [command, definition] of Object.entries(protocol.commands).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const baseName = schemaName(command)
    const requestName = `${baseName}Request`
    const resultName = `${baseName}Result`
    schemas[requestName] = commandRequestSchema(definition.request)
    const responseSchema = jsonSchema(definition.response)
    const hasResult = responseSchema.properties?.result !== undefined
    if (hasResult) schemas[resultName] = commandResultSchema(responseSchema)
    const description = definition.request.description?.trim()
    paths[`/frp/${command}`] = {
      post: {
        operationId: command,
        ...(description ? { summary: description } : {}),
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${requestName}` },
            },
          },
        },
        responses: hasResult
          ? {
              '200': {
                description: definition.response.description || 'Command result.',
                content: {
                  'application/json': {
                    schema: { $ref: `#/components/schemas/${resultName}` },
                  },
                },
              },
            }
          : {
              '204': {
                description: 'Command completed successfully without response content.',
              },
            },
        'x-taskyon-command': command,
        'x-taskyon-transport': 'frp',
      },
    }
  }

  const streams = Object.fromEntries(
    Object.entries(protocol.streams)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([stream, messages]) => [
        stream,
        Object.fromEntries(
          Object.entries(messages)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([name, schema]) => [name, jsonSchema(schema)]),
        ),
      ]),
  )

  return {
    openapi: '3.1.0',
    info: {
      title: options.title ?? protocol.id,
      version: protocol.version,
      ...(options.description ? { description: options.description } : {}),
    },
    paths,
    components: { schemas },
    'x-taskyon-protocol': {
      id: protocol.id,
      version: protocol.version,
    },
    'x-taskyon-streams': streams,
  }
}
