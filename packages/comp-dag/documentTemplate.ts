import z from 'zod'
import { canonicalHash, type DagStorageBackend, type Hash } from './caching'
import { createNode } from './dagCore'
import { evaluateQueryAxisValue } from './queryPipeline'

const documentColumnSchema = z
  .object({
    path: z.string().min(1).max(256),
    op: z.enum(['identity', 'sum', 'mean', 'min', 'max', 'index']).default('identity'),
    index: z.number().int().min(0).optional(),
  })
  .strict()

export const documentViewSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
    source: z
      .object({
        invocation: z.string().min(1),
        offset: z.number().int().min(0).default(0),
        maxRows: z.number().int().min(1).max(1000).default(100),
        columns: z
          .record(z.string().min(1), documentColumnSchema)
          .refine(
            (columns) => Object.keys(columns).length > 0 && Object.keys(columns).length <= 20,
            'A view requires between 1 and 20 columns',
          ),
      })
      .strict(),
    presentation: z.discriminatedUnion('renderer', [
      z.object({ renderer: z.literal('table') }).strict(),
      z
        .object({
          renderer: z.literal('scalar'),
          decimals: z.number().int().min(0).max(12).optional(),
        })
        .strict(),
      z
        .object({ renderer: z.literal('vega-lite'), spec: z.record(z.string(), z.unknown()) })
        .strict(),
      z
        .object({
          renderer: z.literal('maplibre'),
          style: z.record(z.string(), z.unknown()),
          attribution: z.string().min(1),
        })
        .strict(),
    ]),
  })
  .strict()

export type DocumentView = z.infer<typeof documentViewSchema>
export type DocumentProjection = {
  rows: Record<string, string | number | boolean | null>[]
  complete: boolean
}

/** Views are literal fenced JSON, not dynamically computed Jinja expressions. */
export const parseDocumentTemplate = (template: string) => {
  if (new TextEncoder().encode(template).byteLength > 512_000)
    throw new Error('Document templates are limited to 512 KB.')
  const views: DocumentView[] = []
  const body = template.replace(
    /^```document-view[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm,
    (_, json: string) => {
      const view = documentViewSchema.parse(JSON.parse(json))
      if (views.some(({ id }) => id === view.id)) throw new Error(`Duplicate view: ${view.id}`)
      if (views.length >= 50) throw new Error('Documents are limited to 50 views.')
      views.push(view)
      return `{{ views.${view.id} }}`
    },
  )
  if (/^```document-view/m.test(body)) throw new Error('Unterminated document view declaration.')
  return { template: body, views }
}

const markdownCell = (value: string | number | boolean | null) =>
  String(value ?? '—')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replace(/\r?\n/g, '<br>')

const renderTabularView = (
  presentation: Extract<DocumentView['presentation'], { renderer: 'scalar' | 'table' }>,
  rows: DocumentProjection['rows'],
) => {
  if (rows.length === 0) return '> No rows in this selection.'
  const columns = Object.keys(rows[0]!)
  if (presentation.renderer === 'scalar') {
    if (rows.length !== 1 || columns.length !== 1)
      throw new Error('A scalar view requires exactly one row and one column.')
    const value = rows[0]![columns[0]!] ?? null
    return typeof value === 'number' && presentation.decimals !== undefined
      ? value.toFixed(presentation.decimals)
      : markdownCell(value)
  }
  return [
    columns.map(markdownCell),
    columns.map(() => '---'),
    ...rows.map((row) => columns.map((column) => markdownCell(row[column] ?? null))),
  ]
    .map((row) => `| ${row.join(' | ')} |`)
    .join('\n')
}

export type DocumentGraphicsRenderer = {
  /** Exact implementation/assets identity, never a mutable provider label. */
  id: Hash
  render: (
    presentation: Extract<DocumentView['presentation'], { renderer: 'vega-lite' | 'maplibre' }>,
    rows: DocumentProjection['rows'],
  ) => Promise<string>
}

export const renderDocumentView = async (
  view: DocumentView,
  projection: DocumentProjection,
  backend: DagStorageBackend,
  graphics?: DocumentGraphicsRenderer,
) => {
  const { rows } = projection
  if (
    rows.length > view.source.maxRows ||
    new TextEncoder().encode(JSON.stringify(rows)).byteLength > 512_000
  )
    throw new Error(`View ${view.id} exceeds its bounded projection.`)
  const columns = Object.keys(view.source.columns)
  if (
    rows.some(
      (row) => Object.keys(row).length !== columns.length || columns.some((key) => !(key in row)),
    )
  )
    throw new Error(`View ${view.id} projection does not match its declared columns.`)
  let calculated = false
  const node = createNode({
    name: 'documentView',
    version: 1,
    contentHash: canonicalHash({
      operation: 'documentView.v1',
      table: renderTabularView.toString(),
      cell: markdownCell.toString(),
      graphics:
        view.presentation.renderer === 'table' || view.presentation.renderer === 'scalar'
          ? null
          : (graphics?.id ?? null),
    }),
    localParams: {
      type: 'object',
      properties: { input: { type: 'string' } },
      required: ['input'],
      additionalProperties: false,
    } as const,
    outputSchema: { type: 'string' } as const,
    run: async () => {
      calculated = true
      const presentation = view.presentation
      if (presentation.renderer === 'table' || presentation.renderer === 'scalar')
        return renderTabularView(presentation, rows)
      if (!graphics) throw new Error(`${presentation.renderer} document rendering is unavailable.`)
      return await graphics.render(presentation, rows)
    },
  })
  const result = await node
    .call({ input: JSON.stringify({ presentation: view.presentation, rows }) })
    .run(
      { nowUtcMs: 0, log: () => undefined },
      { storageBackend: backend, execution: { mode: 'local' } },
    )
  return { markdown: result.value, artifactHash: result.artifactHash, cached: !calculated }
}

/** Resolve only declared values from an already bounded row, using the shared plot reducers. */
export const projectDocumentRow = (row: unknown, columns: DocumentView['source']['columns']) =>
  Object.fromEntries(
    Object.entries(columns).map(([name, spec]) => {
      let value: unknown = row
      for (const part of spec.path.split('.')) {
        if (value === null || typeof value !== 'object' || !Object.hasOwn(value, part)) {
          value = null
          break
        }
        value = Reflect.get(value, part)
      }
      if (spec.op !== 'identity')
        value = evaluateQueryAxisValue(value, {
          path: spec.path,
          op: spec.op,
          ...(spec.index === undefined ? {} : { index: spec.index }),
        })
      if (typeof value === 'number' && !Number.isFinite(value)) value = null
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      )
        throw new Error(`Column ${name} must select a scalar or declare a simple aggregation.`)
      if (typeof value === 'string' && value.length > 4096)
        throw new Error(`Column ${name} exceeds 4096 characters.`)
      return [name, value]
    }),
  )
