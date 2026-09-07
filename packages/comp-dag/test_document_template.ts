import {
  parseDocumentTemplate,
  renderDocumentView,
  renderDocumentTemplate,
  projectDocumentRow,
} from './documentTemplate'
import { createStorageDagBackend } from './storageDagBackend'
import { ingestTextFile, readPinnedTextFile } from './builtIn/textFileSource'
import { canonicalHash } from './caching'
import { createDocumentInvocation } from './documentBuild'

export const testDocumentTemplateVegaPlot = async () => {
  const { createVegaDocumentRenderer } = await import('./documentGraphics')
  const renderer = createVegaDocumentRenderer()
  const presentation = {
    renderer: 'vega-lite' as const,
    spec: {
      mark: 'bar',
      encoding: {
        x: { field: 'Scenario', type: 'nominal' },
        y: { field: 'MW', type: 'quantitative' },
      },
    },
  }
  const rows = [
    { Scenario: 'A', MW: 10 },
    { Scenario: 'B', MW: 20 },
  ]
  const first = await renderer.render(presentation, rows)
  const second = await renderer.render(presentation, rows)
  if (!first.startsWith('![Plot](data:image/svg+xml;base64,') || first !== second)
    throw new Error('Vega plots must produce repeatable, self-contained SVG images.')
  if (canonicalHash(first) !== 'sha256:ZTEolSSntPXGH2vUBdTOB4miDMLg8Ztf-aez8feb8_M')
    throw new Error('The fixed plot fixture must have identical bytes in browser and CLI.')
  for (const spec of [
    { ...presentation.spec, data: { url: 'https://example.invalid/private' } },
    { ...presentation.spec, transform: [{ calculate: 'random()', as: 'MW' }] },
    { ...presentation.spec, width: 100000 },
    { ...presentation.spec, mark: 'image' },
    { ...presentation.spec, mark: { type: 'bar', fill: 'url(https://example.invalid/image)' } },
    { mark: 'not-a-mark' },
  ]) {
    let rejected = false
    try {
      await renderer.render({ renderer: 'vega-lite', spec }, rows)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Unsupported or unbounded plot definitions must be rejected.')
  }
  return { success: true, svgHash: canonicalHash(first) }
}

export const testDocumentTemplateGraphicsRendererIdentity = async () => {
  const records = new Map<string, unknown>()
  const backend = createStorageDagBackend({
    get: (namespace, id) => Promise.resolve(records.get(`${namespace}/${id}`)),
    set: (namespace, id, value) => {
      records.set(`${namespace}/${id}`, value)
      return Promise.resolve()
    },
  })
  const template =
    '```document-view\n' +
    JSON.stringify({
      id: 'power',
      source: { invocation: 'dispatch', columns: { MW: { path: 'outputs.power' } } },
      presentation: { renderer: 'vega-lite', spec: { mark: 'bar' } },
    }) +
    '\n```'
  let calls = 0
  const renderer = {
    id: canonicalHash('synthetic graphics implementation v1'),
    render: () => {
      calls += 1
      return Promise.resolve('Synthetic plot')
    },
  }
  const resolve = () => Promise.resolve({ rows: [{ MW: 10 }], complete: true })
  const first = await renderDocumentTemplate(template, resolve, backend, renderer)
  const second = await renderDocumentTemplate(
    '# Edited prose\n' + template,
    resolve,
    backend,
    renderer,
  )
  if (first.views[0]?.status !== 'available' || !first.markdown.includes('Synthetic plot'))
    throw new Error('Document assembly must invoke the supplied graphics capability.')
  if (calls !== 1 || !second.views[0]?.cached)
    throw new Error('Unchanged plots must reuse the independently cached graphics artifact.')
  const changed = await renderDocumentTemplate(template, resolve, backend, {
    ...renderer,
    id: canonicalHash('synthetic graphics implementation v2'),
  })
  if (changed.views[0]?.cached || first.rendererId === changed.rendererId)
    throw new Error('Changing the graphics implementation must invalidate rendering identity.')
  const source = canonicalHash('synthetic template')
  if (
    createDocumentInvocation(source, {}, first.rendererId).id ===
    createDocumentInvocation(source, {}, changed.rendererId).id
  )
    throw new Error('Build invocations must pin the renderer used by the rendered document.')
  const text = '# Text only'
  const textFirst = await renderDocumentTemplate(text, resolve, backend, renderer)
  const textSecond = await renderDocumentTemplate(text, resolve, backend)
  if (textFirst.rendererId !== textSecond.rendererId)
    throw new Error('Unused graphics capabilities must not affect text-only document identity.')
  return { success: true }
}

export const testDocumentTemplateFileSourcePinsBytes = async () => {
  const records = new Map<string, unknown>()
  const storage = {
    get: (namespace: string, id: string) => Promise.resolve(records.get(`${namespace}/${id}`)),
    set: (namespace: string, id: string, value: unknown) => {
      records.set(`${namespace}/${id}`, value)
      return Promise.resolve()
    },
  }
  const pinned = await ingestTextFile('deliverables/project.md.jinja', '# Original', storage, 100)
  await ingestTextFile('deliverables/project.md.jinja', '# Edited', storage, 200)
  const original = await readPinnedTextFile(pinned, storage)
  if (original !== '# Original' || !pinned.sourceSnapshotId)
    throw new Error('A template invocation must replay pinned bytes after its file changes.')
  return { success: true }
}

export const testDocumentTemplateInlineViews = async () => {
  const view = {
    id: 'capacity',
    source: { invocation: 'bess', maxRows: 1, columns: { value: { path: 'params.batteryMw' } } },
    presentation: { renderer: 'scalar', decimals: 1 },
  }
  const inline = '`document-view ' + JSON.stringify(view) + '`'
  const example = '```text\n' + inline + '\n```'
  const parsed = parseDocumentTemplate('Capacity: ' + inline + ' MW.\n\n' + example)
  if (
    parsed.views.length !== 1 ||
    !parsed.template.startsWith('Capacity: {{ views.capacity }} MW.')
  )
    throw new Error('Inline scalar views must preserve surrounding prose.')
  if (!parsed.template.includes(example)) throw new Error('Code examples must remain literal.')
  for (const template of [
    inline + '\n' + inline,
    inline.replace('"scalar"', '"table"'),
    '`document-view {broken}`',
  ]) {
    let rejected = false
    try {
      parseDocumentTemplate(template)
    } catch {
      rejected = true
    }
    if (!rejected) throw new Error('Invalid or duplicate inline views must be rejected.')
  }
  return { success: true }
}

export const testDocumentTemplateMissingFieldIsNotAResult = () => {
  let rejected = false
  try {
    projectDocumentRow({ outputs: {} }, { value: { path: 'outputs.cost', op: 'identity' } })
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('An absent field must not silently become a rendered result.')
  const nullable = projectDocumentRow(
    { outputs: { irr: null } },
    { value: { path: 'outputs.irr', op: 'identity' } },
  )
  if (nullable.value !== null) throw new Error('An explicitly nullable result remains valid.')
  return { success: true }
}

export const testDocumentTemplateMixedAvailability = async () => {
  const records = new Map<string, unknown>()
  const backend = createStorageDagBackend({
    get: (namespace, id) => Promise.resolve(records.get(`${namespace}/${id}`)),
    set: (namespace, id, value) => {
      records.set(`${namespace}/${id}`, value)
      return Promise.resolve()
    },
  })
  const declarations = ['available', 'missing'].map(
    (id) =>
      '`document-view ' +
      JSON.stringify({
        id,
        source: { invocation: id, maxRows: 1, columns: { text: { path: 'outputs.text' } } },
        presentation: { renderer: 'scalar' },
      }) +
      '`',
  )
  const template = declarations.join(' and ')
  const result = await renderDocumentTemplate(
    template,
    async (view) =>
      view.id === 'missing'
        ? { reason: 'Study has not been calculated.' }
        : { rows: [{ text: '[unsafe](https://example.invalid)' }], complete: true },
    backend,
  )
  if (result.views[0]?.status !== 'available' || result.views[1]?.status !== 'missing')
    throw new Error('Each view must retain independent availability.')
  if (!result.markdown.includes('#document-view-missing') || result.markdown.includes('[unsafe]('))
    throw new Error(
      'Missing views need individual links and scalar values must remain literal text.',
    )
  const replay = await renderDocumentTemplate(
    template,
    async () => ({ rows: [{ text: 'updated' }], complete: true }),
    backend,
  )
  if (
    replay.markdown === result.markdown ||
    replay.views.some((view) => view.status !== 'available')
  )
    throw new Error('Materialized views must replace placeholders on regeneration.')
  const jinja = await renderDocumentTemplate(
    '{% if view_status.available == "available" %}Ready: {{ views.available }}{% endif %}\n' +
      template,
    async () => ({ rows: [{ text: 'literal {{ 7 * 7 }}' }], complete: true }),
    backend,
  )
  if (!jinja.markdown.startsWith('Ready: literal') || jinja.markdown.includes('{% if'))
    throw new Error('Jinja must assemble rendered views and expose their availability.')
  if (jinja.markdown.includes('49'))
    throw new Error('Study values must never become template code.')
  for (const expression of [
    '{{ strftime_now("%Y") }}',
    '{{ views.typo }}',
    '{{ range(1001) }}',
    '{{ "x" * 100000 }}',
    '{% for a in range(1000) %}{% for b in range(1000) %}{{ b }}{% endfor %}{% endfor %}',
  ]) {
    let rejected = false
    try {
      await renderDocumentTemplate(
        expression + '\n' + template,
        async () => ({ reason: 'Not calculated' }),
        backend,
      )
    } catch {
      rejected = true
    }
    if (!rejected)
      throw new Error('Nondeterministic calls and undefined values must fail explicitly.')
  }
  const literalExample = '```jinja\n{{ views.not_a_dependency }}\n```'
  const examples = await renderDocumentTemplate(
    literalExample + '\n`{{ not_a_variable }}`',
    async () => ({ reason: 'No studies' }),
    backend,
  )
  if (
    !examples.markdown.includes(literalExample) ||
    !examples.markdown.includes('`{{ not_a_variable }}`')
  )
    throw new Error('Code examples must remain literal during Jinja assembly.')
  const loop = await renderDocumentTemplate(
    '{% for n in range(3) %}{{ n }}{% endfor %}',
    async () => ({ reason: 'No studies' }),
    backend,
  )
  if (loop.markdown !== '012') throw new Error('Bounded Jinja loops must render.')
  return { success: true }
}

export const testDocumentTemplateBoundedViewsAndIndependentCache = async () => {
  const declaration = {
    id: 'power',
    source: { invocation: 'dispatch', maxRows: 2, columns: { MW: { path: 'outputs.power' } } },
    presentation: { renderer: 'table' },
  }
  const template = '# Project\n\n```document-view\n' + JSON.stringify(declaration) + '\n```\n'
  const plan = parseDocumentTemplate(template)
  const edited = parseDocumentTemplate(template.replace('# Project', '# Project revision'))
  if (plan.views.length !== 1 || edited.views[0]?.id !== 'power')
    throw new Error('Inline views must be discoverable independently of prose.')
  const records = new Map<string, unknown>()
  const backend = createStorageDagBackend({
    get: (namespace, id) => Promise.resolve(records.get(`${namespace}/${id}`)),
    set: (namespace, id, value) => {
      records.set(`${namespace}/${id}`, value)
      return Promise.resolve()
    },
  })
  const projection = { rows: [{ MW: 10 }, { MW: 20 }], complete: false }
  const first = await renderDocumentView(plan.views[0]!, projection, backend)
  const second = await renderDocumentView(edited.views[0]!, projection, backend)
  if (
    !second.cached ||
    first.artifactHash !== second.artifactHash ||
    !first.markdown.includes('10')
  )
    throw new Error('Prose-only changes must reuse the exact rendered view artifact.')
  const renamed = {
    ...declaration,
    id: 'renamed',
    source: { ...declaration.source, invocation: 'alias' },
  }
  const renamedView = parseDocumentTemplate(
    '```document-view\n' + JSON.stringify(renamed) + '\n```',
  ).views[0]!
  const third = await renderDocumentView(renamedView, projection, backend)
  if (!third.cached || third.artifactHash !== first.artifactHash)
    throw new Error('Invocation aliases and view IDs must not invalidate identical presentation.')
  let rejected = false
  try {
    await renderDocumentView(
      plan.views[0]!,
      { rows: [...projection.rows, { MW: 30 }], complete: true },
      backend,
    )
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('View bounds must be enforced, not silently exceeded.')
  return { success: true }
}
