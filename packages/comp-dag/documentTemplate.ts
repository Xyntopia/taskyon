import z from 'zod'
import { canonicalHash, type DagStorageBackend, type Hash } from './caching'
import { createNode } from './dagCore'
import { evaluateQueryAxisValue } from './queryPipeline'
import type { DesignGraphRepository } from './designGraphRepository'
import { iterateInvocationRowRange, type InvocationRowStorageClient } from './storageInvocationRows'
import {
  createJinjaTemplateRenderer,
  jinjaSandboxSource,
} from '@taskyon/common/modules/sandbox/jinjaTemplate'
import { jinjaArtifact } from '@taskyon/common/modules/sandbox/jinjaArtifact'

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
  if (template.includes('\0')) throw new Error('Document templates cannot contain null characters.')
  if (new TextEncoder().encode(template).byteLength > 512_000)
    throw new Error('Document templates are limited to 512 KB.')
  const views: DocumentView[] = []
  const literals: string[] = []
  const literal = (text: string) => {
    literals.push(text)
    return `\0!${literals.length - 1}\0`
  }
  const placements: Record<string, 'inline' | 'block'> = {}
  const declare = (json: string, placement: 'inline' | 'block') => {
    const view = documentViewSchema.parse(JSON.parse(json))
    if (views.some(({ id }) => id === view.id)) throw new Error(`Duplicate view: ${view.id}`)
    if (views.length >= 50) throw new Error('Documents are limited to 50 views.')
    if (placement === 'inline' && view.presentation.renderer !== 'scalar')
      throw new Error('Inline document views require scalar presentation.')
    views.push(view)
    placements[view.id] = placement
    return `\0${view.id}\0`
  }
  const lines = template.split('\n')
  const output: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    const fence = /^ {0,3}(`{3,}|~{3,})([^\r]*)\r?$/.exec(line)
    if (fence) {
      const marker = fence[1]!
      const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*\\r?$`)
      let end = index + 1
      while (end < lines.length && !closing.test(lines[end]!)) end += 1
      if (fence[2]!.trim() === 'document-view') {
        if (end === lines.length) throw new Error('Unterminated document view declaration.')
        output.push(declare(lines.slice(index + 1, end).join('\n'), 'block'))
      } else output.push(literal(lines.slice(index, Math.min(end + 1, lines.length)).join('\n')))
      index = end
    } else {
      // Indented code and ordinary code spans are literal, including longer backtick delimiters.
      output.push(
        /^( {4}|\t)/.test(line)
          ? literal(line)
          : line.replace(/(`+)([^`]*?)\1(?!`)/g, (span, _ticks: string, content: string) =>
              content.startsWith('document-view ')
                ? declare(content.slice('document-view '.length), 'inline')
                : literal(span),
            ),
      )
    }
  }
  const segments = output
    .join('\n')
    .split(/\0([a-zA-Z][a-zA-Z0-9_]*|![0-9]+)\0/)
    .map((text, index) =>
      index % 2 === 0
        ? { text }
        : text.startsWith('!')
          ? { literalIndex: Number(text.slice(1)) }
          : { viewId: text },
    )
  return {
    template: segments
      .map((segment) =>
        'viewId' in segment
          ? `{{ views.${segment.viewId} }}`
          : 'literalIndex' in segment
            ? literals[segment.literalIndex!]
            : segment.text,
      )
      .join(''),
    jinjaTemplate: segments
      .map((segment) =>
        'viewId' in segment
          ? `{{ views.${segment.viewId} }}`
          : 'literalIndex' in segment
            ? `{{ literals[${segment.literalIndex}] }}`
            : segment.text,
      )
      .join(''),
    literals,
    views,
    placements,
    segments,
  }
}

const markdownCell = (value: string | number | boolean | null) =>
  String(value ?? '—')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('|', '&#124;')
    .replace(/[\\`*_\[\]{}!]/g, (character) => `&#${character.charCodeAt(0)};`)
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
          throw new Error(`Column ${name} references unavailable field ${spec.path}.`)
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

export const renderedDocumentSchema = z
  .object({
    rendererId: z.custom<Hash>(
      (value) => typeof value === 'string' && /^sha256:[A-Za-z0-9_-]{43}$/.test(value),
    ),
    template: z.string(),
    markdown: z.string(),
    views: z.array(
      z
        .object({
          id: z.string(),
          invocation: z.string(),
          placement: z.enum(['inline', 'block']),
          status: z.enum(['available', 'partial', 'missing', 'error']),
          markdown: z.string(),
          reason: z.string().optional(),
          artifactHash: z
            .custom<Hash>(
              (value) => typeof value === 'string' && /^sha256:[A-Za-z0-9_-]{43}$/.test(value),
            )
            .optional(),
          cached: z.boolean().optional(),
        })
        .strict(),
    ),
  })
  .strict()
export type RenderedDocumentView = z.infer<typeof renderedDocumentSchema>['views'][number]

/** Pins the internal assembly implementation without adding an editable graph node. */
export const documentRendererIdentity = (graphicsId?: Hash) =>
  canonicalHash({
    operation: 'documentTemplate.v1',
    schema: z.toJSONSchema(documentViewSchema),
    parse: parseDocumentTemplate.toString(),
    assemble: renderDocumentTemplate.toString(),
    view: renderDocumentView.toString(),
    table: renderTabularView.toString(),
    cell: markdownCell.toString(),
    graphics: graphicsId ?? null,
    jinja: { artifact: jinjaArtifact.id, source: jinjaSandboxSource },
  })

/** Physical row storage stays behind Taskyon's bounded reader, never in authored templates. */
export const resolveInvocationDocumentView = async (
  repository: DesignGraphRepository,
  storage: InvocationRowStorageClient,
  invocationId: Hash,
  view: DocumentView,
): Promise<DocumentProjection | { reason: string }> => {
  const runs = (await repository.listRuns(invocationId)).sort(
    (a, b) =>
      Number(b.status === 'completed') - Number(a.status === 'completed') ||
      b.completedAtMs - a.completedAtMs,
  )
  let unavailable = 'Study has not produced row artifacts.'
  for (const run of runs) {
    if (!run.artifacts.rows || !run.artifacts.rowIndex) continue
    const rows: DocumentProjection['rows'] = []
    try {
      for await (const row of iterateInvocationRowRange({
        storage,
        rows: run.artifacts.rows,
        rowIndex: run.artifacts.rowIndex,
        startRow: view.source.offset,
        limit: view.source.maxRows,
      })) {
        rows.push(projectDocumentRow(row, view.source.columns))
      }
      return { rows, complete: run.status === 'completed' }
    } catch (error) {
      unavailable = error instanceof Error ? error.message : String(error)
    }
  }
  return { reason: unavailable }
}

/** Resolution is read-only. Missing data never implicitly starts an invocation. */
export const renderDocumentTemplate = async (
  template: string,
  resolve: (view: DocumentView) => Promise<DocumentProjection | { reason: string }>,
  backend: DagStorageBackend,
  graphics?: DocumentGraphicsRenderer,
) => {
  const plan = parseDocumentTemplate(template)
  const usesGraphics = plan.views.some(
    ({ presentation }) =>
      presentation.renderer === 'vega-lite' || presentation.renderer === 'maplibre',
  )
  const rendererId = documentRendererIdentity(usesGraphics ? graphics?.id : undefined)
  const views: RenderedDocumentView[] = []
  for (const view of plan.views) {
    const base = {
      id: view.id,
      invocation: view.source.invocation,
      placement: plan.placements[view.id]!,
    }
    try {
      const projection = await resolve(view)
      if ('reason' in projection) {
        views.push({
          ...base,
          status: 'missing',
          reason: projection.reason,
          markdown: `[Missing: ${view.id}](#document-view-${view.id})`,
        })
      } else {
        const rendered = await renderDocumentView(view, projection, backend, graphics)
        views.push({
          ...base,
          ...rendered,
          markdown: projection.complete
            ? rendered.markdown
            : `${rendered.markdown}${base.placement === 'inline' ? ' ' : '\n\n'}[Partial: ${view.id}](#document-view-${view.id})`,
          status: projection.complete ? 'available' : 'partial',
          ...(!projection.complete ? { reason: 'The source invocation has partial results.' } : {}),
        })
      }
    } catch (error) {
      views.push({
        ...base,
        status: 'error',
        reason: error instanceof Error ? error.message : String(error),
        markdown: `[Unavailable: ${view.id}](#document-view-${view.id})`,
      })
    }
  }
  const markdown = await createJinjaTemplateRenderer()(
    plan.jinjaTemplate,
    {
      views: Object.fromEntries(views.map((view) => [view.id, view.markdown])),
      view_status: Object.fromEntries(views.map((view) => [view.id, view.status])),
      literals: plan.literals,
    },
    { profile: 'document' },
  )
  // Artifacts contain semantic output, not whether this particular lookup hit the cache.
  const artifactHash = await backend.writeArtifact({
    rendererId,
    template,
    markdown,
    views: views.map(({ cached: _cached, ...view }) => view),
  })
  return { rendererId, template, markdown, views, artifactHash }
}
