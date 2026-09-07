import Ajv, { type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import { compile, version as liteVersion, type TopLevelSpec } from 'vega-lite'
import liteSchema from 'vega-lite/vega-lite-schema.json' with { type: 'json' }
import { View, parse, textMetrics, version as vegaVersion, type Loader } from 'vega'
import { expressionInterpreter } from 'vega-interpreter'
import { canonicalHash } from './caching'
import type { DocumentGraphicsRenderer, DocumentProjection } from './documentTemplate'

// Vega exports this public scenegraph API but omits it from vega-typings.
declare module 'vega' {
  export const textMetrics: { canvas(enabled: boolean): void }
}

/** Keep authored charts declarative, bounded and independent of external observations. */
const checkDocumentPlot = (value: unknown, depth = 0): void => {
  if (depth > 20) throw new Error('Plot definitions cannot exceed 20 levels.')
  if (typeof value === 'string' && /url\s*\(/i.test(value))
    throw new Error('Document plots cannot reference CSS image resources.')
  if (Array.isArray(value)) {
    if (value.length > 1000) throw new Error('Plot arrays are limited to 1000 entries.')
    value.forEach((entry) => checkDocumentPlot(entry, depth + 1))
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (
        [
          'data',
          'datasets',
          'transform',
          'params',
          'selection',
          'expr',
          'signal',
          'url',
          'href',
          'repeat',
          'facet',
          'concat',
          'hconcat',
          'vconcat',
          'layer',
          'test',
          'timeUnit',
        ].includes(key) ||
        key.endsWith('Expr')
      )
        throw new Error(`Document plots do not support ${key}; use the view source or a DAG node.`)
      if (key === 'type' && (entry === 'temporal' || entry === 'image'))
        throw new Error(`Document plots do not yet support ${entry}.`)
      if (key === 'mark' && entry === 'image')
        throw new Error('External image marks are unavailable.')
      if (
        key === 'aggregate' &&
        !['sum', 'mean', 'min', 'max', 'count', 'median'].includes(String(entry))
      )
        throw new Error('Use a deterministic simple aggregation or calculate it in a DAG node.')
      if (
        ['width', 'height'].includes(key) &&
        (typeof entry !== 'number' || entry < 1 || entry > 2048)
      )
        throw new Error('Document plot dimensions must be numbers between 1 and 2048.')
      checkDocumentPlot(entry, depth + 1)
    }
  }
}

const plotMarkdown = (svg: string) => {
  if (new TextEncoder().encode(svg).byteLength > 2_000_000)
    throw new Error('Rendered plot exceeds 2 MB.')
  const root = svg.slice(0, svg.indexOf('>'))
  for (const dimension of ['width', 'height']) {
    const value = Number(new RegExp(`\\b${dimension}="([^"]+)"`).exec(root)?.[1])
    if (!Number.isFinite(value) || value < 1 || value > 4096)
      throw new Error('Rendered plot dimensions exceed 4096 pixels.')
  }
  // Vega's process-global IDs must not change identical images across render calls.
  const ids = new Map(
    Array.from(svg.matchAll(/\bid="([^"]+)"/g), ([, id], index) => [id!, `plot-${index}`]),
  )
  const normalized = svg.replace(
    /\bid="([^"]+)"|url\(#([^)]+)\)/g,
    (match, id: string | undefined, ref: string | undefined) =>
      id ? `id="${ids.get(id)}"` : ref && ids.has(ref) ? `url(#${ids.get(ref)})` : match,
  )
  const bytes = new TextEncoder().encode(normalized)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `![Plot](data:image/svg+xml;base64,${btoa(binary)})`
}

/** Construct lazily: schema compilation and Vega loading are needed only for plot documents. */
export const createVegaDocumentRenderer = (): DocumentGraphicsRenderer => {
  let validate: ValidateFunction<TopLevelSpec> | undefined
  const denyResource = () =>
    Promise.reject(new Error('Document plots cannot load external resources.'))
  const loader: Loader = {
    load: denyResource,
    sanitize: denyResource,
    http: denyResource,
    file: denyResource,
  }
  const render = async (spec: Record<string, unknown>, rows: DocumentProjection['rows']) => {
    if (JSON.stringify(spec).length > 128_000 || rows.length > 1000)
      throw new Error('Document plot input exceeds its limit.')
    checkDocumentPlot(spec)
    if (!validate) {
      const ajv = addFormats(new Ajv({ strict: false }))
      ajv.addFormat('color-hex', /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i)
      validate = ajv.compile<TopLevelSpec>(liteSchema)
    }
    const input = { width: 480, height: 280, ...spec, data: { values: rows } }
    if (!validate(input)) throw new Error('Invalid Vega-Lite document plot specification.')
    // Fixed estimates avoid machine-dependent canvas/font measurements. This is Vega's
    // library-wide switch; every document render sets the same policy before evaluation.
    textMetrics.canvas(false)
    const compiled = compile(input).spec
    const view = new View(parse(compiled, undefined, { ast: true }), {
      renderer: 'none',
      loader,
      expr: expressionInterpreter,
    })
    try {
      return plotMarkdown(await view.toSVG())
    } finally {
      view.finalize()
    }
  }
  return {
    id: canonicalHash({
      profile: 'document-vega-svg.v1',
      vegaVersion,
      liteVersion,
      interpreter: expressionInterpreter.encode.toString(),
      check: checkDocumentPlot.toString(),
      render: render.toString(),
      image: plotMarkdown.toString(),
    }),
    render: (presentation, rows) => {
      if (presentation.renderer !== 'vega-lite')
        return Promise.reject(new Error('MapLibre document rendering is unavailable.'))
      return render(presentation.spec, rows)
    },
  }
}
