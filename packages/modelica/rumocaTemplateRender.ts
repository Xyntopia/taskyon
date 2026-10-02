import { createNativeTableRuntime } from './nativeTableRuntime.ts'
import { z } from 'zod'

export type RumocaCompiledModelApi = {
  representation_json: (representation: 'dae' | 'solve') => string
  compile_response_json: () => string
  solve_error: () => string | undefined
  render_target: (target: string, manifest: string, templates: string) => string
  free: () => void
}

export type RumocaTemplateRenderApi = {
  compile_with_options?: (
    source: string,
    modelName: string,
    optionsJson: string,
  ) => RumocaCompiledModelApi
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
  compiledModel?: RumocaCompiledModelApi
  solveJson?: string | undefined
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function escapeManifestString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

/** Inspect canonical node tags only; never reserialize parsed source identities. */
function needsSolveScalarFallback(solveJson: string): boolean {
  const scalarBlock = z.object({
    nodes: z.array(z.object({ ScalarPrograms: z.object({}) }).strict()),
  })
  const scalarOnlyModel = z.object({
    schema_version: z.literal(5),
    problem: z.object({
      schema_version: z.literal(89),
      continuous: z.object({
        derivative_rhs: scalarBlock,
        implicit_rhs: scalarBlock,
        residual: scalarBlock,
        manifold_residual: scalarBlock,
      }),
      initialization: z.object({ residual: scalarBlock }),
      discrete: z.object({ structured_rhs: scalarBlock }),
    }),
  })
  // Compact or unfamiliar nodes keep Rumoca's checked scalar-fallback gate.
  return !scalarOnlyModel.safeParse(JSON.parse(solveJson)).success
}

function buildManifestSource(params: {
  outputPath: string
  targetName: string
  templatePath: string
  ir: 'dae' | 'solve'
  scalarFallback: boolean
  nativeLinearOps: boolean
}): string {
  return [
    'version = 1',
    `ir = "${params.ir}"`,
    `name = "${escapeManifestString(params.targetName)}"`,
    '',
    '[capabilities]',
    'continuous_states = true',
    'residual_equations = true',
    ...(params.ir === 'dae' ? ['structured_equation_families = true'] : []),
    'events = true',
    'clocks = true',
    'initialization = true',
    ...(params.ir === 'solve'
      ? [
          `scalar_fallback = ${params.scalarFallback}`,
          '',
          '[capabilities.tensor]',
          `matmul = "${params.scalarFallback ? 'scalar' : 'unsupported'}"`,
          `linsolve = "${params.nativeLinearOps ? 'native' : 'scalar'}"`,
          'layout = "row-major"',
        ]
      : []),
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

type CompiledDaePayload = {
  dae?: unknown
  dae_native?: unknown
  dae_prepared?: unknown
  pretty?: unknown
}

const asDaeRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

/**
 * Returns the exact DAE JSON text for template rendering.
 *
 * The compiled DAE contains 64-bit source identities that JavaScript numbers
 * cannot represent, so re-serializing a parsed payload corrupts them. Prefer
 * the compiler-provided `pretty` text, which is byte-exact.
 */
export function daeJsonForTemplate(
  compiled: CompiledDaePayload,
  options?: {
    usePreparedDae?: boolean
  },
): string {
  if (Boolean(options?.usePreparedDae)) {
    const preparedDae = asDaeRecord(compiled.dae_prepared)
    if (preparedDae) return JSON.stringify(preparedDae)
  }
  if (typeof compiled.pretty === 'string' && compiled.pretty.trim().length > 0) {
    return compiled.pretty
  }
  const dae = asDaeRecord(compiled.dae)
  if (!dae) throw new Error('Compilation did not return a usable DAE payload')
  return JSON.stringify(dae)
}

export function renderRumocaTemplate(params: RenderRumocaTemplateParams): string {
  const ir = params.templateSource.startsWith('{# rumoca-ir: solve #}') ? 'solve' : 'dae'
  // Embed the same compiled, self-contained implementation in standalone output.
  const templateSource = params.templateSource.replaceAll(
    '__RUMOCA_NATIVE_TABLE_RUNTIME__',
    `(${createNativeTableRuntime.toString()})`,
  )
  if (ir === 'solve' && !params.compiledModel && typeof params.wasm.render_target !== 'function') {
    throw new Error('Solve templates require render_target from a simulation-enabled Rumoca build')
  }
  if (!params.compiledModel && ir === 'dae' && typeof params.wasm.render_template === 'function') {
    const rendered = params.wasm.render_template(params.daeJson, templateSource)
    if (typeof rendered === 'string') return rendered
    if (rendered == null) return ''
    throw new Error(
      `render_template returned unexpected payload: ${JSON.stringify(rendered).slice(0, 500)}`,
    )
  }

  if (params.compiledModel || typeof params.wasm.render_target === 'function') {
    const templatePath = params.templatePath ?? 'template.jinja'
    const outputPath = params.outputPath ?? 'rendered.txt'
    const targetName = params.targetName ?? 'template'
    const nativeLinearOps = params.templateSource.startsWith(
      '{# rumoca-ir: solve #}\n{# rumoca-linear-ops: native #}',
    )
    const solveJson = nativeLinearOps
      ? (params.solveJson ?? params.compiledModel?.representation_json('solve'))
      : undefined
    const scalarFallback = !nativeLinearOps || !solveJson || needsSolveScalarFallback(solveJson)
    const manifestSource = buildManifestSource({
      outputPath,
      targetName,
      templatePath,
      ir,
      scalarFallback,
      nativeLinearOps,
    })
    const templatesJson = JSON.stringify({ [templatePath]: templateSource })
    const rendered: unknown = params.compiledModel
      ? JSON.parse(params.compiledModel.render_target(targetName, manifestSource, templatesJson))
      : params.wasm.render_target?.(
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

/** Compile once, render multiple views, and release WASM ownership on every exit path. */
export function compileRumocaTemplates(params: {
  wasm: RumocaTemplateRenderApi
  source: string
  modelName: string
  templates: { source: string; path: string; outputPath?: string }[]
}) {
  const compile = params.wasm.compile_with_options
  if (!compile) throw new Error('Rumoca build does not provide retained compilation results')
  const needsSolve = params.templates.some((template) =>
    template.source.startsWith('{# rumoca-ir: solve #}'),
  )
  const compiledModel = compile(
    params.source,
    params.modelName,
    JSON.stringify({
      representations: needsSolve ? ['dae', 'solve'] : ['dae'],
    }),
  )
  try {
    const compileResponse = compiledModel.compile_response_json()
    const daeJson = compiledModel.representation_json('dae')
    const solveError = compiledModel.solve_error()
    const solveJson =
      needsSolve && !solveError ? compiledModel.representation_json('solve') : undefined
    const rendered = params.templates.map((template) => {
      try {
        const content = renderRumocaTemplate({
          wasm: params.wasm,
          compiledModel,
          solveJson,
          daeJson,
          modelName: params.modelName,
          templateSource: template.source,
          templatePath: template.path,
          outputPath: template.outputPath ?? 'rendered.txt',
        })
        return { ok: true as const, content }
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })
    return {
      compileResponse,
      daeJson,
      solveJson,
      solveError,
      rendered,
    }
  } finally {
    compiledModel.free()
  }
}
