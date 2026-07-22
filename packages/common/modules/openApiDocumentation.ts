import { load as parseYaml } from 'js-yaml'
import { z } from 'zod'

export type OpenApiDocumentationDocument = {
  id: string
  path: string
  title: string
  url: string
  content: string
  metadata: Record<string, unknown>
}

const documentBoundary = z.looseObject({
  openapi: z.string().regex(/^3\./),
  info: z.looseObject({
    title: z.string(),
    version: z.string(),
    description: z.string().optional(),
  }),
  paths: z.record(z.string(), z.unknown()).default({}),
})

const slug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'api'

export const createOpenApiDocumentationDocument = (
  content: string,
  sourceUrl: string,
): OpenApiDocumentationDocument => {
  const document = documentBoundary.parse(parseYaml(content))
  const path = `openapi/${slug(document.info.title)}`
  return {
    id: path,
    path,
    title: document.info.title,
    url: sourceUrl,
    content: JSON.stringify(document, null, 2),
    metadata: {
      format: 'openapi',
      source: sourceUrl,
    },
  }
}
