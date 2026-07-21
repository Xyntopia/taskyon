import { load as parseYaml } from 'js-yaml'
import { z } from 'zod'

export type OpenApiDocumentationSection = {
  id: string
  path: string
  title: string
  url: string
  content: string
  aliases: string[]
  metadata: Record<string, unknown>
}

const operation = z.looseObject({
  operationId: z.string().optional(),
  summary: z.string().optional(),
  description: z.string().optional(),
  requestBody: z.unknown().optional(),
  responses: z.unknown().optional(),
})

const documentBoundary = z.looseObject({
  openapi: z.string().regex(/^3\./),
  info: z.looseObject({
    title: z.string(),
    version: z.string(),
    description: z.string().optional(),
  }),
  paths: z.record(z.string(), z.unknown()).default({}),
  components: z
    .looseObject({
      schemas: z.record(z.string(), z.unknown()).default({}),
    })
    .default({ schemas: {} }),
  'x-taskyon-streams': z.record(z.string(), z.unknown()).optional(),
  'x-taskyon-tools': z.record(z.string(), z.unknown()).optional(),
})

const taskyonTool = z.looseObject({
  description: z.string(),
  longDescription: z.string().optional(),
  parameters: z.unknown(),
  result: z.unknown(),
})

const httpMethods = ['get', 'put', 'post', 'delete', 'patch', 'options', 'head', 'trace'] as const

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'resource'

const codeBlock = (label: string, value: unknown) =>
  [`## ${label}`, '```json', JSON.stringify(value, null, 2), '```'].join('\n')

const section = (
  category: string,
  title: string,
  sourceUrl: string,
  content: string,
): OpenApiDocumentationSection => {
  const anchor = `${category}-${slug(title)}`
  const path = `openapi/${category}/${slug(title)}.md`
  return {
    id: path,
    path,
    title,
    url: `${sourceUrl}#${anchor}`,
    content,
    aliases: [],
    metadata: {
      format: 'openapi',
      category,
      source: sourceUrl,
    },
  }
}

const operationSections = (
  paths: Record<string, unknown>,
  sourceUrl: string,
): OpenApiDocumentationSection[] =>
  Object.entries(paths)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([route, pathValue]) => {
      const pathItem = z.record(z.string(), z.unknown()).safeParse(pathValue)
      if (!pathItem.success) return []
      return httpMethods.flatMap((method) => {
        const parsed = operation.safeParse(pathItem.data[method])
        if (!parsed.success) return []
        const title = parsed.data.operationId ?? `${method.toUpperCase()} ${route}`
        const content = [
          `# ${title}`,
          parsed.data.summary,
          parsed.data.description,
          `Transport path: \`${method.toUpperCase()} ${route}\``,
          codeBlock('Request', parsed.data.requestBody ?? {}),
          codeBlock('Responses', parsed.data.responses ?? {}),
        ]
          .filter((value): value is string => Boolean(value))
          .join('\n\n')
        return [section('operation', title, sourceUrl, content)]
      })
    })

const streamSections = (
  streams: Record<string, unknown> | undefined,
  sourceUrl: string,
): OpenApiDocumentationSection[] =>
  Object.entries(streams ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([stream, messages]) => {
      const parsed = z.record(z.string(), z.unknown()).safeParse(messages)
      if (!parsed.success) return []
      return Object.entries(parsed.data)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([message, schema]) => {
          const title = `${stream}.${message}`
          return section(
            'stream',
            title,
            sourceUrl,
            [`# ${title}`, codeBlock('Message schema', schema)].join('\n\n'),
          )
        })
    })

const toolSections = (
  tools: Record<string, unknown> | undefined,
  sourceUrl: string,
): OpenApiDocumentationSection[] =>
  Object.entries(tools ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([name, value]) => {
      const parsed = taskyonTool.safeParse(value)
      if (!parsed.success) return []
      return [
        section(
          'tool',
          name,
          sourceUrl,
          [
            `# ${name}`,
            parsed.data.description,
            parsed.data.longDescription,
            codeBlock('Parameters', parsed.data.parameters),
            codeBlock('Result', parsed.data.result),
          ]
            .filter((entry): entry is string => Boolean(entry))
            .join('\n\n'),
        ),
      ]
    })

const schemaSections = (
  schemas: Record<string, unknown>,
  sourceUrl: string,
): OpenApiDocumentationSection[] =>
  Object.entries(schemas)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, schema]) =>
      section(
        'schema',
        name,
        sourceUrl,
        [`# ${name}`, codeBlock('JSON Schema', schema)].join('\n\n'),
      ),
    )

export const createOpenApiDocumentationSections = (
  content: string,
  sourceUrl: string,
): OpenApiDocumentationSection[] => {
  const document = documentBoundary.parse(parseYaml(content))
  const overview = section(
    'overview',
    document.info.title,
    sourceUrl,
    [
      `# ${document.info.title}`,
      document.info.description,
      `OpenAPI ${document.openapi}, version ${document.info.version}.`,
    ]
      .filter((value): value is string => Boolean(value))
      .join('\n\n'),
  )

  return [
    overview,
    ...operationSections(document.paths, sourceUrl),
    ...streamSections(document['x-taskyon-streams'], sourceUrl),
    ...toolSections(document['x-taskyon-tools'], sourceUrl),
    ...schemaSections(document.components.schemas, sourceUrl),
  ]
}
