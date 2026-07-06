export type RumocaTemplateRenderApi = {
  render_template?: ((daeJson: string, templateSource: string) => unknown) | undefined
  render_target?:
    | ((
        daeJson: string,
        modelName: string,
        targetName: string,
        manifestSource: string,
        templatesJson: string,
      ) => unknown)
    | undefined
}

type RenderRumocaTemplateParams = {
  wasm: RumocaTemplateRenderApi
  daeJson: string
  templateSource: string
  modelName: string
  templatePath?: string
  outputPath?: string
  targetName?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function escapeManifestString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function buildManifestSource(params: {
  outputPath: string
  targetName: string
  templatePath: string
}): string {
  return [
    'version = 1',
    'ir = "dae"',
    `name = "${escapeManifestString(params.targetName)}"`,
    '',
    '[[files]]',
    `path = "${escapeManifestString(params.outputPath)}"`,
    `template = "${escapeManifestString(params.templatePath)}"`,
    '',
  ].join('\n')
}

function readRenderTargetContent(rendered: unknown): string | null {
  if (typeof rendered === 'string') return rendered
  const renderedRecord = asRecord(rendered)
  const files = Array.isArray(renderedRecord?.files) ? renderedRecord.files : []
  for (const file of files) {
    const fileRecord = asRecord(file)
    if (typeof fileRecord?.content === 'string') return fileRecord.content
  }
  return null
}

export function hasRumocaTemplateRenderer(wasm: RumocaTemplateRenderApi): boolean {
  return typeof wasm.render_template === 'function' || typeof wasm.render_target === 'function'
}

export function renderRumocaTemplate(params: RenderRumocaTemplateParams): string {
  if (typeof params.wasm.render_template === 'function') {
    const rendered = params.wasm.render_template(params.daeJson, params.templateSource)
    if (typeof rendered === 'string') return rendered
    if (rendered == null) return ''
    throw new Error(
      `render_template returned unexpected payload: ${JSON.stringify(rendered).slice(0, 500)}`,
    )
  }

  if (typeof params.wasm.render_target === 'function') {
    const templatePath = params.templatePath ?? 'template.jinja'
    const outputPath = params.outputPath ?? 'rendered.txt'
    const targetName = params.targetName ?? 'template'
    const manifestSource = buildManifestSource({ outputPath, targetName, templatePath })
    const templatesJson = JSON.stringify({ [templatePath]: params.templateSource })
    const rendered = params.wasm.render_target(
      params.daeJson,
      params.modelName,
      targetName,
      manifestSource,
      templatesJson,
    )
    const content = readRenderTargetContent(rendered)
    if (content !== null) return content
    throw new Error(
      `render_target returned unexpected payload: ${JSON.stringify(rendered).slice(0, 500)}`,
    )
  }

  throw new Error('WASM module is missing render_template / render_target exports')
}
