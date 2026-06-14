import {
  buildModelAbiValidationSandboxCode,
  buildWorkerSandboxCode,
  getPreparedDaeDiagnostics,
  getPreparedDaeStatus,
  loadWasm,
  selectDaeForTemplate,
  shouldValidateModelAbiForRenderedOutput,
  validateModelAbiValidationResultV1,
} from './modelica'
import { hasRumocaTemplateRenderer, renderRumocaTemplate } from './rumocaTemplateRender'
import { strFromU8, unzipSync } from 'fflate'
import { execFile } from 'node:child_process'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeInWorkerSandbox } from '../modules/sandbox/workerSandbox'
import { validateJavaScriptInSandbox } from '../modules/sandbox/checkJsSyntax'
import { serializeObject } from '../modules/serializeObject'
import { createGraphController } from '../modules/graph'
import baseDaeTemplate from './base_dae.jinja?raw'
import javascriptTemplate from './javascript.jinja?raw'
import standaloneHtmlTemplate from './standalone_html.jinja?raw'
import {
  mapDiagramToGraph,
  type DiagramEdgeData,
  type DiagramNodeData,
} from './diagram/mapDiagramToGraph'
import type { ModelicaDiagramDto } from './diagram/types'
import { ModelicaWorkerClient } from './modelicaWorkerClient'

const templateChecks = [
  {
    name: 'javascript.jinja',
    source: javascriptTemplate,
    requiredSnippets: ['function Model()', 'const meta = {'],
    executableAsJs: true,
  },
  {
    name: 'standalone_html.jinja',
    source: standaloneHtmlTemplate,
    requiredSnippets: ['<html lang="en">', 'function Model()'],
    executableAsJs: false,
  },
  {
    name: 'base_dae.jinja',
    source: baseDaeTemplate,
    requiredSnippets: ['Model:', 'Differential equations'],
    executableAsJs: false,
  },
] as const

const MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS = {
  format: 'json' as const,
  maxDepth: 6,
  maxArrayLength: 10,
  maxObjectKeys: 35,
  maxStringLength: 1200,
  indent: 2,
}

const MODELICA_DIAGNOSTICS_EXTENDED_SERIALIZE_OPTIONS = {
  format: 'json' as const,
  maxDepth: 8,
  maxArrayLength: 2000,
  maxObjectKeys: 250,
  maxStringLength: 200000,
  indent: 2,
}

const execFileAsync = (file: string, args: string[]): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              [
                error.message,
                stdout ? `stdout:\n${stdout}` : '',
                stderr ? `stderr:\n${stderr}` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            ),
          )
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })

const MODELICA_DIAGRAM_SMOKE_SOURCE = `
model DiagramSmoke
  connector Pin
    Real v;
    flow Real i;
  end Pin;

  model SourceBlock
    Pin p annotation(Placement(transformation(extent={{90,-10},{110,10}})));
  equation
    p.v = 1;
    p.i = 0;
  end SourceBlock;

  model SinkBlock
    Pin p annotation(Placement(transformation(extent={{-110,-10},{-90,10}})));
  equation
    p.v = 0;
    p.i = 0;
  end SinkBlock;

  SourceBlock src annotation(Placement(transformation(extent={{-80,-20},{-40,20}})));
  SinkBlock dst annotation(Placement(transformation(extent={{40,-20},{80,20}})));
equation
  connect(src.p, dst.p) annotation(Line(points={{-40,0},{40,0}}, color={0,0,255}));
end DiagramSmoke;
`.trim()

const MODELICA_BOOLEAN_NETWORK_SHIM_SOURCE = `
model BooleanNetworkShimSmoke
  import Sources = Modelica.Blocks.Sources;
  import MathBoolean = Modelica.Blocks.MathBoolean;
  import MathInteger = Modelica.Blocks.MathInteger;
  parameter Real arr[3] = {1, 2, 3};
  parameter Integer n = size(arr, 1);
  MathBoolean.And and1(nu = 3);
  Sources.BooleanPulse booleanPulse1(width = 20, period = 1);
  Sources.BooleanPulse booleanPulse2(period = 1, width = 80);
  Sources.BooleanStep booleanStep(startTime = 1.5);
  MathBoolean.Or or1(nu = 2);
  MathBoolean.Xor xor1(nu = 2);
  MathBoolean.Nand nand1(nu = 2);
  MathBoolean.Nor nor1(nu = 2);
  MathBoolean.Not not1;
  MathBoolean.OnDelay onDelay(delayTime = 1);
  MathBoolean.RisingEdge rising;
  MathBoolean.FallingEdge falling;
  MathBoolean.ChangingEdge changing;
  MathBoolean.MultiSwitch set1(nu = 2, expr = {false, true});
  Sources.BooleanTable booleanTable(table = {2, 4, 6, 6.5, 7, 9, 11});
  MathInteger.TriggeredAdd triggeredAdd;
  Sources.IntegerConstant integerConstant(k = 2);
  Modelica.Blocks.Logical.RSFlipFlop rsFlipFlop;
  Sources.SampleTrigger sampleTriggerSet(period = 0.5, startTime = 0);
  Sources.SampleTrigger sampleTriggerReset(period = 0.5, startTime = 0.3);
equation
  connect(booleanPulse1.y, and1.u[1]);
  connect(booleanStep.y, and1.u[2]);
  connect(booleanPulse2.y, and1.u[3]);
  connect(and1.y, or1.u[1]);
  connect(booleanPulse2.y, or1.u[2]);
  connect(or1.y, xor1.u[1]);
  connect(booleanPulse2.y, xor1.u[2]);
  connect(xor1.y, nand1.u[1]);
  connect(booleanPulse2.y, nand1.u[2]);
  connect(nand1.y, nor1.u[1]);
  connect(booleanPulse2.y, nor1.u[2]);
  connect(nor1.y, not1.u);
  connect(booleanPulse2.y, rising.u);
  connect(rising.y, set1.u[1]);
  connect(booleanPulse2.y, falling.u);
  connect(falling.y, set1.u[2]);
  connect(booleanPulse2.y, changing.u);
  connect(integerConstant.y, triggeredAdd.u);
  connect(changing.y, triggeredAdd.trigger);
  connect(booleanTable.y, onDelay.u);
  connect(sampleTriggerSet.y, rsFlipFlop.S);
  connect(sampleTriggerReset.y, rsFlipFlop.R);
end BooleanNetworkShimSmoke;
`.trim()

function getTemplateModelName(dae: Record<string, unknown>, fallback = 'Model'): string {
  const raw = dae.model_name
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : fallback
}

function assertTemplateRendererAvailable(wasm: DiagnosticsWasm): void {
  if (!hasRumocaTemplateRenderer(wasm)) {
    throw new Error('Rumoca wasm export missing: render_template / render_target')
  }
}

function renderDiagnosticsTemplate(
  wasm: DiagnosticsWasm,
  dae: Record<string, unknown>,
  templateSource: string,
  templatePath: string,
  outputPath: string,
): string {
  const rendered = renderRumocaTemplate({
    wasm,
    daeJson: JSON.stringify(dae),
    templateSource,
    modelName: getTemplateModelName(dae),
    templatePath,
    outputPath,
    targetName: 'template',
  })
  if (!rendered.length) {
    throw new Error(`Rumoca template render returned empty output for ${templatePath}`)
  }
  return rendered
}

const MODELICA_BOOLEAN_SIGNAL_GENERATOR_SOURCE = `
model BooleanSignalGenerator
  Modelica.Blocks.Sources.BooleanPulse booleanPulse(period = 0.2, width = 50);
  Modelica.Blocks.Math.BooleanToReal booleanToReal;
equation
  connect(booleanPulse.y, booleanToReal.u);
end BooleanSignalGenerator;
`.trim()

function ensureDiagramDto(value: unknown): ModelicaDiagramDto {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('extract_diagram returned invalid payload: expected object')
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.components)) {
    throw new Error('extract_diagram payload missing components array')
  }
  if (!Array.isArray(record.connections)) {
    throw new Error('extract_diagram payload missing connections array')
  }
  return {
    className: typeof record.className === 'string' ? record.className : 'Model',
    components: record.components as ModelicaDiagramDto['components'],
    connections: record.connections as ModelicaDiagramDto['connections'],
  }
}

function createOffscreenGraphHost(): HTMLDivElement {
  if (typeof document === 'undefined' || !document.body) {
    throw new Error('Diagram diagnostics requires a browser DOM (document.body missing)')
  }
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-20000px'
  host.style.top = '-20000px'
  host.style.width = '1200px'
  host.style.height = '800px'
  host.style.pointerEvents = 'none'
  document.body.appendChild(host)
  return host
}

function summarizeDiagram(diagram: ModelicaDiagramDto) {
  const iconComponentCount = diagram.components.filter(
    (component) => (component.icon?.graphics?.length ?? 0) > 0,
  ).length
  const iconGraphicCount = diagram.components.reduce(
    (sum, component) => sum + (component.icon?.graphics?.length ?? 0),
    0,
  )
  const portCount = diagram.components.reduce(
    (sum, component) => sum + (component.ports?.length ?? 0),
    0,
  )
  return {
    className: diagram.className,
    components: diagram.components.length,
    connections: diagram.connections.length,
    componentsWithIcons: iconComponentCount,
    iconGraphics: iconGraphicCount,
    ports: portCount,
  }
}

function extractModelicaRefsFromText(text: string, limit = 80): string[] {
  return Array.from(new Set(text.match(/\bModelica\.[A-Za-z0-9_.]+\b/g) ?? [])).slice(0, limit)
}

async function runTemplateCoverage(source: string, modelName: string) {
  const wasm = await getDiagnosticsWasm()

  if (typeof wasm.compile_to_json !== 'function') {
    throw new Error('Rumoca wasm export missing: compile_to_json')
  }
  assertTemplateRendererAvailable(wasm)

  const compiled = wasm.compile_to_json(source, modelName)
  const parsed = JSON.parse(compiled) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
    dae_prepared_status?: unknown
    dae_prepared_diagnostics?: unknown
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) {
    throw new Error('Rumoca compile_to_json returned no DAE payload')
  }
  const preparedStatus = getPreparedDaeStatus(dae)
  const preparedDiagnostics = getPreparedDaeDiagnostics(dae)
  const preparedPayload =
    parsed.dae_prepared &&
    typeof parsed.dae_prepared === 'object' &&
    !Array.isArray(parsed.dae_prepared)
  if (preparedPayload && !preparedStatus) {
    throw new Error('Selected DAE is missing __rumoca_prepared_status metadata')
  }

  const rendered = renderDiagnosticsTemplate(
    wasm,
    dae,
    '{{ dae.model_name | default("unknown") }}',
    'template-check.jinja',
    'template-check.txt',
  )

  const templateResults: Record<
    string,
    { ok: boolean; preview: string; jsExecutable: boolean; expectedJs: boolean; abiOk?: boolean }
  > = {}
  for (const check of templateChecks) {
    const out = renderDiagnosticsTemplate(wasm, dae, check.source, check.name, check.name)
    for (const snippet of check.requiredSnippets) {
      if (!out.includes(snippet)) {
        throw new Error(`Template ${check.name} missing expected snippet: ${snippet}`)
      }
    }
    let jsExecutable = false
    let abiOk: boolean | undefined
    if (check.executableAsJs) {
      const code = buildModelAbiValidationSandboxCode(out)
      const id = `modelica-template-abi-check-${check.name.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}`
      const abort = new AbortController()
      try {
        const rawAbiResult = await executeInWorkerSandbox(
          {
            id,
            code,
            sourceURL: `${id}.js`,
            stopSignal: abort.signal,
          },
          {},
          {
            source: 'ModelicaDiagnostics',
            enforceModelAbi: true,
            __rumocaRunId: id,
          },
        )
        const abiResult = validateModelAbiValidationResultV1(rawAbiResult)
        if (abiResult.ok !== true) {
          throw new Error(abiResult.errorMessage || 'ABI validation failed in sandbox')
        }
        jsExecutable = true
        abiOk = true
      } catch (err) {
        throw new Error(
          `Template ${check.name} failed sandbox JS validation: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
      } finally {
        abort.abort()
      }
    }

    const result: {
      ok: boolean
      preview: string
      jsExecutable: boolean
      expectedJs: boolean
      abiOk?: boolean
    } = {
      ok: true,
      preview: out.slice(0, 120),
      jsExecutable,
      expectedJs: check.executableAsJs,
    }
    if (abiOk !== undefined) {
      result.abiOk = abiOk
    }
    templateResults[check.name] = result
  }

  return {
    ok: true,
    preparedStatus,
    preparedDiagnostics,
    exports: {
      compile_to_json: true,
      render_template: typeof wasm.render_template === 'function',
      render_target: typeof wasm.render_target === 'function',
    },
    renderedPreview: rendered.slice(0, 80),
    templates: templateResults,
  }
}

export async function testModelicaWasmLoadAndCompile() {
  const source = `
model Test
  Real x(start=0);
equation
  der(x) = 1;
end Test;
`.trim()

  return runTemplateCoverage(source, 'Test')
}

export async function testModelicaDiagramSvgRenderSmoke() {
  if (typeof Worker === 'undefined' || typeof document === 'undefined') {
    return {
      ok: true,
      skipped: 'diagram-render-smoke requires browser Worker + DOM',
    }
  }

  const debug: Record<string, unknown> = {
    phase: 'init',
    sourceLength: MODELICA_DIAGRAM_SMOKE_SOURCE.length,
  }
  const worker = new ModelicaWorkerClient()
  let host: HTMLDivElement | null = null
  let controller: ReturnType<
    typeof createGraphController<DiagramNodeData, DiagramEdgeData>
  > | null = null

  try {
    debug.phase = 'worker-init'
    await worker.init(0)

    debug.phase = 'extract-diagram'
    const rawDiagram = await worker.extractDiagram({
      source: MODELICA_DIAGRAM_SMOKE_SOURCE,
      qualifiedName: 'DiagramSmoke',
      fileName: 'DiagramSmoke.mo',
    })
    const diagram = ensureDiagramDto(rawDiagram)
    const diagramSummary = summarizeDiagram(diagram)
    debug.diagram = diagramSummary

    if (diagram.components.length === 0) {
      throw new Error('extract_diagram produced zero components')
    }

    debug.phase = 'map-graph'
    const mapped = mapDiagramToGraph(diagram, 'authored')
    debug.graph = {
      nodes: mapped.graph.nodes.length,
      edges: mapped.graph.edges.length,
      hasFixedNodeRects:
        typeof mapped.options.fixedNodeRects === 'object' && mapped.options.fixedNodeRects != null,
    }

    debug.phase = 'render-svg'
    host = createOffscreenGraphHost()
    const localController = createGraphController<DiagramNodeData, DiagramEdgeData>(
      host,
      mapped.graph,
      mapped.options,
    )
    controller = localController
    const svg = localController.exportSvgString({
      cropToContent: true,
      cropPadding: 18,
      backgroundColor: 'rgb(229, 231, 235)',
    })

    const hasSvgTag = svg.includes('<svg')
    const hasNodeMarker = svg.includes('data-graph-node="1"')
    const hasInvalidTokens = /\b(?:NaN|undefined)\b/.test(svg)
    const pathCount = (svg.match(/<path\b/g) ?? []).length
    const rectCount = (svg.match(/<rect\b/g) ?? []).length
    const svgSummary = {
      length: svg.length,
      hasSvgTag,
      hasNodeMarker,
      hasInvalidTokens,
      pathCount,
      rectCount,
      preview: svg.slice(0, 600),
    }
    debug.svg = svgSummary

    if (!hasSvgTag) throw new Error('Rendered output does not contain an <svg> root')
    if (!hasNodeMarker) throw new Error('Rendered SVG does not contain any graph nodes')
    if (hasInvalidTokens) throw new Error('Rendered SVG contains NaN/undefined tokens')
    if (svg.length < 400) throw new Error(`Rendered SVG unexpectedly short (${svg.length} chars)`)

    return {
      ok: true,
      diagramSerialized: serializeObject(diagramSummary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
      graphSerialized: serializeObject(debug.graph, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
      svgSerialized: serializeObject(svgSummary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
    }
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_EXTENDED_SERIALIZE_OPTIONS)
    throw new Error([baseMessage, `Diagram SVG render smoke debug:\n${debugDump}`].join('\n'))
  } finally {
    controller?.destroy()
    if (host && host.parentNode) host.parentNode.removeChild(host)
    worker.terminate()
  }
}

export async function testModelicaPreparedMetadataContract() {
  const wasm = await getDiagnosticsWasm()
  const source = `
model TestPreparedMeta
  Real x(start=1);
equation
  der(x) = -x;
end TestPreparedMeta;
`.trim()
  if (typeof wasm.compile_to_json !== 'function') {
    throw new Error('Rumoca wasm export missing: compile_to_json')
  }

  const compiled = wasm.compile_to_json(source, 'TestPreparedMeta')
  const parsed = JSON.parse(compiled) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
    dae_prepared_status?: unknown
    dae_prepared_diagnostics?: unknown
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: false })
  if (!dae || typeof dae !== 'object' || Array.isArray(dae)) {
    throw new Error('compile_to_json returned no native DAE payload')
  }

  if (parsed.dae_prepared !== undefined) {
    throw new Error('compile_to_json should not expose dae_prepared in native-only API')
  }
  if (parsed.dae_prepared_status !== undefined) {
    throw new Error('compile_to_json should not expose dae_prepared_status in native-only API')
  }
  if (parsed.dae_prepared_diagnostics !== undefined) {
    throw new Error('compile_to_json should not expose dae_prepared_diagnostics in native-only API')
  }

  const build = dae.__rumoca_build
  if (!build || typeof build !== 'object' || Array.isArray(build)) {
    throw new Error('Native DAE is missing __rumoca_build metadata')
  }
  const buildRecord = build as Record<string, unknown>
  const version = buildRecord.version
  const gitCommit = buildRecord.git_commit
  const buildTimeUtc = buildRecord.build_time_utc
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error('Native DAE __rumoca_build.version must be a non-empty string')
  }
  if (typeof gitCommit !== 'string' || gitCommit.trim().length === 0) {
    throw new Error('Native DAE __rumoca_build.git_commit must be a non-empty string')
  }
  if (typeof buildTimeUtc !== 'string' || buildTimeUtc.trim().length === 0) {
    throw new Error('Native DAE __rumoca_build.build_time_utc must be a non-empty string')
  }

  return {
    ok: true,
    apiShape: 'native-only',
    hasBuildMetadata: true,
    buildVersion: version,
    buildGitCommit: gitCommit,
    buildTimeUtc,
  }
}

export async function testModelicaBouncingBallTemplateCoverage() {
  const source = `
model BouncingBall             "The bouncing ball model"
  constant Real g = 9.81 "Gravitational acceleration";
  parameter Real c = 0.9 "Elasticity constant of ball";
  parameter Real radius = 0.1 "Radius of the ball";
  Real h(start = 1,fixed=true) "height above ground of ball center";
  Real v(start = 0,fixed=true) "Velocity of the ball";
  Real E "Mechanical energy";
 equation
  der(h) = v;
  der(v) = -g;
  E = g*h + 0.5*v*v;
  when h <= radius then
    reinit(v, -c*pre(v));
  end when;
 end BouncingBall;
`.trim()

  return runTemplateCoverage(source, 'BouncingBall')
}

export async function testModelicaBooleanNetworkShimRuntime() {
  const wasm = await getDiagnosticsWasm()
  if (typeof wasm.compile_to_json !== 'function') {
    throw new Error('Rumoca wasm export missing: compile_to_json')
  }
  assertTemplateRendererAvailable(wasm)

  const compiled = wasm.compile_to_json(
    MODELICA_BOOLEAN_NETWORK_SHIM_SOURCE,
    'BooleanNetworkShimSmoke',
  )
  const parsed = JSON.parse(compiled) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) {
    throw new Error('Rumoca compile_to_json returned no DAE payload')
  }

  const rendered = renderDiagnosticsTemplate(
    wasm,
    dae,
    javascriptTemplate,
    'javascript.jinja',
    'model.js',
  )
  if (typeof rendered !== 'string' || !rendered.trim()) {
    throw new Error('Rendered JS is empty')
  }
  if (!rendered.includes('__rumocaResolveExternalSymbol')) {
    throw new Error('Generated JS is missing external symbol resolver helper')
  }
  if (rendered.includes('__RUMOCA_SYMBOL_OVERRIDES__')) {
    throw new Error('Generated JS still contains hardcoded symbol overrides')
  }

  const runId = 'modelica-boolean-network-shim-runtime'
  const abort = new AbortController()
  try {
    const runCode = await buildWorkerSandboxCodeChecked(rendered, runId)
    const result = await executeInWorkerSandbox<{
      meta?: { stopReason?: unknown; stopError?: unknown }
      data?: { t?: unknown[] }
    }>(
      {
        id: runId,
        code: runCode,
        sourceURL: `${runId}.js`,
        stopSignal: abort.signal,
      },
      {
        sim: {
          t0: 0,
          tf: 2,
          dt: 0.1,
          solverOptions: {
            timeIntegrator: 'sdirk2',
            initializeConsistently: false,
            adaptiveSubsteps: true,
            fallbackIntegrators: ['rk4'],
            captureFailureState: true,
          },
        },
      },
      {
        source: 'ModelicaDiagnostics',
        __rumocaRunId: runId,
      },
    )

    const stopReason = typeof result?.meta?.stopReason === 'string' ? result.meta.stopReason : ''
    if (stopReason) {
      const stopError = typeof result?.meta?.stopError === 'string' ? result.meta.stopError : ''
      throw new Error(
        `Boolean network runtime failed: stopReason=${stopReason}, stopError=${stopError || 'n/a'}`,
      )
    }

    const sampleCount = Array.isArray(result?.data?.t) ? result.data.t.length : 0
    if (sampleCount < 2) {
      throw new Error(`Boolean network runtime produced too few samples: ${sampleCount}`)
    }

    return {
      ok: true,
      sampleCount,
      renderedPreview: rendered.slice(0, 220),
    }
  } finally {
    abort.abort()
  }
}

export async function testModelicaBooleanSignalGeneratorWaveformRegression() {
  const wasm = await getDiagnosticsWasm()
  assertTemplateRendererAvailable(wasm)

  const debug: Record<string, unknown> = {
    phase: 'compile',
    model: 'BooleanSignalGenerator',
  }
  const compiled = await compileToJsonWithAutoMsl(
    wasm,
    MODELICA_BOOLEAN_SIGNAL_GENERATOR_SOURCE,
    'BooleanSignalGenerator',
    debug,
  )
  const parsed = JSON.parse(compiled) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) {
    throw new Error('Rumoca compile_to_json returned no DAE payload')
  }

  const rendered = renderDiagnosticsTemplate(
    wasm,
    dae,
    javascriptTemplate,
    'javascript.jinja',
    'model.js',
  )
  if (typeof rendered !== 'string' || !rendered.trim()) {
    throw new Error('Rendered JS is empty')
  }

  const runId = 'modelica-boolean-signal-generator-waveform-regression'
  const abort = new AbortController()
  try {
    const runCode = await buildWorkerSandboxCodeChecked(rendered, runId)
    const result = await executeInWorkerSandbox<{
      meta?: { stopReason?: unknown; stopError?: unknown }
      data?: { t?: unknown[]; y?: Record<string, unknown> }
    }>(
      {
        id: runId,
        code: runCode,
        sourceURL: `${runId}.js`,
        stopSignal: abort.signal,
      },
      {
        sim: {
          t0: 0,
          tf: 1,
          dt: 0.001,
          solverOptions: {
            timeIntegrator: 'sdirk2',
            initializeConsistently: false,
            adaptiveSubsteps: true,
            fallbackIntegrators: ['rk4'],
            captureFailureState: true,
          },
        },
      },
      {
        source: 'ModelicaDiagnostics',
        __rumocaRunId: runId,
      },
    )

    const stopReason = typeof result?.meta?.stopReason === 'string' ? result.meta.stopReason : ''
    if (stopReason) {
      const stopError = typeof result?.meta?.stopError === 'string' ? result.meta.stopError : ''
      throw new Error(
        `Boolean signal generator runtime failed: stopReason=${stopReason}, stopError=${stopError || 'n/a'}`,
      )
    }

    const pulse = result?.data?.y?.['booleanPulse.y']
    const real = result?.data?.y?.['booleanToReal.y']
    if (!Array.isArray(pulse) || !Array.isArray(real)) {
      throw new Error(
        'Expected y["booleanPulse.y"] and y["booleanToReal.y"] arrays in simulation output',
      )
    }
    if (pulse.length !== real.length || pulse.length < 200) {
      throw new Error(
        `Unexpected waveform sample lengths: pulse=${pulse.length}, real=${real.length}`,
      )
    }
    if (pulse.length !== real.length || pulse.length < 200) {
      throw new Error(
        `Unexpected waveform sample lengths: pulse=${pulse.length}, real=${real.length}`,
      )
    }

    const toBit = (v: unknown): 0 | 1 | null => {
      if (v === 0 || v === false) return 0
      if (v === 1 || v === true) return 1
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (Math.abs(v) < 1e-9) return 0
        if (Math.abs(v - 1) < 1e-9) return 1
      }
      return null
    }

    const pulseBits = pulse.map(toBit)
    const realBits = real.map(toBit)
    if (pulseBits.some((v) => v === null) || realBits.some((v) => v === null)) {
      throw new Error('Waveform contains non-binary values; expected only 0/1 samples')
    }

    const pulseOnes = pulseBits.filter((v) => v === 1).length
    const pulseZeros = pulseBits.filter((v) => v === 0).length
    const realOnes = realBits.filter((v) => v === 1).length
    const realZeros = realBits.filter((v) => v === 0).length

    if (pulseOnes < 100 || pulseZeros < 100) {
      throw new Error(
        `booleanPulse.y does not toggle as expected (ones=${pulseOnes}, zeros=${pulseZeros})`,
      )
    }
    if (realOnes < 100 || realZeros < 100) {
      throw new Error(
        `booleanToReal.y does not toggle as expected (ones=${realOnes}, zeros=${realZeros})`,
      )
    }

    const transitions = pulseBits.reduce<number>(
      (count, bit, idx) => (idx > 0 && bit !== pulseBits[idx - 1] ? count + 1 : count),
      0,
    )
    const mismatches = pulseBits.reduce<number>(
      (count, bit, idx) => (realBits[idx] !== bit ? count + 1 : count),
      0,
    )
    const maxAllowedMismatches = Math.max(2, transitions + 2)
    if (mismatches > maxAllowedMismatches) {
      throw new Error(
        `booleanToReal.y diverges too much from booleanPulse.y (mismatches=${mismatches}, transitions=${transitions}, allowed=${maxAllowedMismatches})`,
      )
    }

    return {
      ok: true,
      samples: pulseBits.length,
      pulseOnes,
      pulseZeros,
      realOnes,
      realZeros,
      transitions,
      mismatches,
    }
  } finally {
    abort.abort()
  }
}

export async function testModelicaBooleanNetwork1RuntimeRegression() {
  const wasm = await getDiagnosticsWasm()
  if (
    typeof wasm.compile_with_source_roots !== 'function' &&
    typeof wasm.compile_with_libraries !== 'function'
  ) {
    throw new Error(
      'Rumoca wasm export missing: compile_with_source_roots / compile_with_libraries',
    )
  }
  assertTemplateRendererAvailable(wasm)

  const debug: Record<string, unknown> = {
    phase: 'init',
    model: 'Modelica.Blocks.Examples.BooleanNetwork1',
  }
  await ensureDiagnosticsMslLoaded(wasm, debug)
  const target = await getMslClassCompileTarget(wasm, 'Modelica.Blocks.Examples.BooleanNetwork1')
  debug.phase = 'source-loaded'
  debug.sourcePath = target.sourcePath
  const sourcePath = target.sourcePath

  const compiled = compileWithDiagnosticsMsl(wasm, '', target.modelName)
  const parsed = JSON.parse(compiled) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) {
    throw new Error('Rumoca compile_to_json returned no DAE payload')
  }

  const rendered = renderDiagnosticsTemplate(
    wasm,
    dae,
    javascriptTemplate,
    'javascript.jinja',
    'model.js',
  )
  if (typeof rendered !== 'string' || !rendered.trim()) {
    throw new Error('Rendered JS is empty')
  }

  const runId = 'modelica-boolean-network1-runtime-regression'
  const abort = new AbortController()
  const timeoutMs = 10_000
  type BooleanNetworkRunResult = {
    meta?: {
      stopReason?: unknown
      stopError?: unknown
      executionMode?: unknown
      solverStats?: Record<string, unknown>
    }
    data?: { t?: unknown[]; y?: Record<string, unknown> }
  }
  const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> =>
    await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        abort.abort()
        reject(new Error(`BooleanNetwork1 runtime timed out after ${ms}ms`))
      }, ms)
      promise.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error instanceof Error ? error : new Error(String(error)))
        },
      )
    })
  try {
    const runCode = await buildWorkerSandboxCodeChecked(rendered, runId)
    const result: BooleanNetworkRunResult = await withTimeout(
      executeInWorkerSandbox<BooleanNetworkRunResult>(
        {
          id: runId,
          code: runCode,
          sourceURL: `${runId}.js`,
          stopSignal: abort.signal,
        },
        {
          sim: {
            t0: 0,
            tf: 10,
            dt: 0.01,
            solverOptions: {
              timeIntegrator: 'sdirk2',
              adaptiveSubsteps: true,
              fallbackIntegrators: ['rk4'],
              captureFailureState: true,
            },
          },
        },
        {
          source: 'ModelicaDiagnostics',
          __rumocaRunId: runId,
        },
      ),
      timeoutMs,
    )

    const stopReason = typeof result?.meta?.stopReason === 'string' ? result.meta.stopReason : ''
    if (stopReason) {
      const stopError = typeof result?.meta?.stopError === 'string' ? result.meta.stopError : ''
      throw new Error(
        `BooleanNetwork1 runtime failed: stopReason=${stopReason}, stopError=${stopError || 'n/a'}, sourcePath=${sourcePath}`,
      )
    }

    const samples = Array.isArray(result?.data?.t) ? result.data.t.length : 0
    if (samples < 100) {
      throw new Error(`BooleanNetwork1 produced too few samples: ${samples}`)
    }
    if (result?.meta?.executionMode !== 'algebraic_discrete') {
      throw new Error(
        `BooleanNetwork1 expected algebraic_discrete execution mode, got ${String(result?.meta?.executionMode)}`,
      )
    }

    const yChannels: Record<string, unknown> =
      result?.data?.y && typeof result.data.y === 'object' ? result.data.y : {}
    const channelKeys = Object.keys(yChannels)
    const requiredChannels = [
      'booleanPulse1.y',
      'booleanPulse2.y',
      'booleanStep.y',
      'triggeredAdd.y',
    ]
    for (const key of requiredChannels) {
      if (!channelKeys.includes(key)) {
        throw new Error(`BooleanNetwork1 output missing required channel: ${key}`)
      }
      const values = yChannels[key]
      if (!Array.isArray(values) || values.length !== samples) {
        throw new Error(`BooleanNetwork1 channel ${key} has unexpected shape`)
      }
    }

    const countBit = (key: string, bit: 0 | 1) => {
      const values = yChannels[key]
      if (!Array.isArray(values)) return 0
      return values.filter((value) => value === bit || value === Boolean(bit)).length
    }
    const pulse1Ones = countBit('booleanPulse1.y', 1)
    const pulse1Zeros = countBit('booleanPulse1.y', 0)
    const pulse2Ones = countBit('booleanPulse2.y', 1)
    const pulse2Zeros = countBit('booleanPulse2.y', 0)
    const stepOnes = countBit('booleanStep.y', 1)
    const stepZeros = countBit('booleanStep.y', 0)
    if (pulse1Ones < 50 || pulse1Zeros < 50) {
      throw new Error(`booleanPulse1.y does not toggle (ones=${pulse1Ones}, zeros=${pulse1Zeros})`)
    }
    if (pulse2Ones < 50 || pulse2Zeros < 50) {
      throw new Error(`booleanPulse2.y does not toggle (ones=${pulse2Ones}, zeros=${pulse2Zeros})`)
    }
    if (stepOnes < 50 || stepZeros < 50) {
      throw new Error(`booleanStep.y does not step (ones=${stepOnes}, zeros=${stepZeros})`)
    }
    const solverStats = result?.meta?.solverStats ?? {}
    if (
      Number(solverStats.initAttempts ?? 0) !== 0 ||
      Number(solverStats.flowStepCalls ?? 0) !== 0
    ) {
      throw new Error(
        `BooleanNetwork1 should not use init/flow solves in algebraic_discrete mode (initAttempts=${String(solverStats.initAttempts)}, flowStepCalls=${String(solverStats.flowStepCalls)})`,
      )
    }

    return {
      ok: true,
      model: 'Modelica.Blocks.Examples.BooleanNetwork1',
      sourcePath: target.sourcePath,
      executionMode: result.meta.executionMode,
      samples,
      channelCount: channelKeys.length,
      pulse1Ones,
      pulse1Zeros,
      pulse2Ones,
      pulse2Zeros,
      stepOnes,
      stepZeros,
      channelsPreview: channelKeys.slice(0, 20),
    }
  } finally {
    abort.abort()
  }
}
testModelicaBooleanNetwork1RuntimeRegression.setup = async () => {
  const wasm = await getDiagnosticsWasm()
  const debug: Record<string, unknown> = {}
  await ensureDiagnosticsMslLoaded(wasm, debug)
}

export async function testModelicaStaticModelExecutionModeRegression() {
  const source = `
function Model() {
  return {
    name: 'StaticOnly',
    meta: {
      name: 'StaticOnly',
      parameters: [{ name: 'p', start: 2 }],
      constants: [{ name: 'c', value: 3 }],
      states: [],
      algebraics: [],
      inputs: [],
      conditions: [],
      solverAlgebraics: [],
      summary: { nx: 0, ny: 0, nc: 0, neqs: 0 },
    },
    x0: [],
    y0: [],
    c0: [],
  }
}
`.trim()
  const runId = 'modelica-static-model-execution-mode-regression'
  const abort = new AbortController()
  try {
    const result = await executeInWorkerSandbox<{
      meta?: {
        executionMode?: unknown
        warnings?: unknown
        stopReason?: unknown
      }
      data?: { t?: unknown[]; p?: Record<string, unknown>; constants?: Record<string, unknown> }
    }>(
      {
        id: runId,
        code: buildWorkerSandboxCode(source),
        sourceURL: `${runId}.js`,
        stopSignal: abort.signal,
      },
      {
        sim: {
          t0: 0,
          tf: 1,
          dt: 0.25,
          solverOptions: {},
        },
      },
      {
        source: 'ModelicaDiagnostics',
        __rumocaRunId: runId,
      },
    )

    const stopReason =
      typeof result?.meta?.stopReason === 'string'
        ? result.meta.stopReason
        : result?.meta?.stopReason
          ? serializeObject(result.meta.stopReason, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
          : ''
    if (stopReason) {
      throw new Error(`Static model stopped unexpectedly: ${stopReason}`)
    }
    if (result?.meta?.executionMode !== 'static_model') {
      throw new Error(
        `Expected static_model execution mode, got ${String(result?.meta?.executionMode)}`,
      )
    }
    const times = Array.isArray(result?.data?.t) ? result.data.t : []
    const p = result?.data?.p?.p
    const c = result?.data?.constants?.c
    if (times.length !== 5 || !Array.isArray(p) || !Array.isArray(c)) {
      throw new Error(`Unexpected static output shape (t=${times.length})`)
    }
    if (p.some((value) => value !== 2) || c.some((value) => value !== 3)) {
      throw new Error('Static parameter/constant series is not constant')
    }

    return {
      ok: true,
      executionMode: result.meta.executionMode,
      samples: times.length,
      warnings: result.meta.warnings,
    }
  } finally {
    abort.abort()
  }
}

export async function testModelicaBouncingBallEventLocalizationRegression() {
  const source = `
model BouncingBall             "The bouncing ball model"
  constant Real g = 9.81 "Gravitational acceleration";
  parameter Real c = 0.9 "Elasticity constant of ball";
  parameter Real radius = 0.1 "Radius of the ball";
  Real h(start = 1,fixed=true) "height above ground of ball center";
  Real v(start = 0,fixed=true) "Velocity of the ball";
  Real E "Mechanical energy";
 equation
  der(h) = v;
  der(v) = -g;
  E = g*h + 0.5*v*v;
  when h <= radius then
    reinit(v, -c*pre(v));
  end when;
 end BouncingBall;
`.trim()

  const wasm = await getDiagnosticsWasm()
  if (typeof wasm.compile_to_json !== 'function') {
    throw new Error('Rumoca wasm export missing: compile_to_json')
  }
  assertTemplateRendererAvailable(wasm)

  const compiled = wasm.compile_to_json(source, 'BouncingBall')
  const parsed = JSON.parse(compiled) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) {
    throw new Error('Rumoca compile_to_json returned no DAE payload for BouncingBall')
  }

  const summarizeDaeEventShape = (daeObj: unknown) => {
    const asObj =
      daeObj && typeof daeObj === 'object' && !Array.isArray(daeObj)
        ? (daeObj as Record<string, unknown>)
        : null
    const len = (key: string) => {
      if (!asObj) return 0
      const value = asObj[key]
      return Array.isArray(value) ? value.length : 0
    }
    const mapLen = (key: string) => {
      if (!asObj) return 0
      const value = asObj[key]
      if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
      return Object.keys(value as Record<string, unknown>).length
    }
    const xCount = mapLen('x')
    const yCount = mapLen('y')
    const zCount = mapLen('z')
    const mCount = mapLen('m')
    const wCount = mapLen('w')
    const fxCount = len('f_x')
    const solverNyCurrentTemplate = yCount + zCount + mCount + wCount
    const dynamicUnknownsCurrentTemplate = xCount + solverNyCurrentTemplate
    const dynamicUnknownsNoM = xCount + yCount + zCount + wCount
    return {
      f_x: fxCount,
      f_c: len('f_c'),
      relation: len('relation'),
      synthetic_root_conditions: len('synthetic_root_conditions'),
      when_clauses: len('when_clauses'),
      f_z: len('f_z'),
      f_m: len('f_m'),
      variableCounts: {
        x: xCount,
        y: yCount,
        z: zCount,
        m: mCount,
        w: wCount,
      },
      dynamicBalance: {
        solverNyCurrentTemplate,
        dynamicUnknownsCurrentTemplate,
        dynamicUnknownsNoM,
        fxMinusDynamicUnknownsCurrentTemplate: fxCount - dynamicUnknownsCurrentTemplate,
        fxMinusDynamicUnknownsNoM: fxCount - dynamicUnknownsNoM,
      },
      prepared_status: getPreparedDaeStatus(asObj),
      prepared_diagnostics: getPreparedDaeDiagnostics(asObj),
    }
  }

  const selectedDaeSummary = summarizeDaeEventShape(dae)
  const nativeDaeSummary = summarizeDaeEventShape(parsed.dae_native ?? parsed.dae)
  const preparedDaeSummary = summarizeDaeEventShape(parsed.dae_prepared)

  const rendered = renderDiagnosticsTemplate(
    wasm,
    dae,
    javascriptTemplate,
    'javascript.jinja',
    'model.js',
  )
  if (!rendered || typeof rendered !== 'string') {
    throw new Error('Rendering javascript.jinja failed for BouncingBall')
  }
  if (
    rendered.includes('const capabilities = { events: false }') ||
    rendered.includes('const capabilities = {events: false}')
  ) {
    throw new Error(
      [
        'BouncingBall regression: generated model reports events=false, event resets cannot be trusted.',
        'selectedDaeSummary:',
        serializeObject(selectedDaeSummary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
        'nativeDaeSummary:',
        serializeObject(nativeDaeSummary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
        'preparedDaeSummary:',
        serializeObject(preparedDaeSummary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
        'generatedCode:',
        serializeObject(
          {
            length: rendered.length,
            head: rendered.slice(0, 2400),
            tail: rendered.slice(Math.max(0, rendered.length - 1800)),
          },
          MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS,
        ),
      ].join('\n\n'),
    )
  }

  const runId = 'modelica-bouncing-ball-event-localization'
  const runCode = await buildWorkerSandboxCodeChecked(rendered, runId)
  const runAbort = new AbortController()

  type SimResult = {
    meta?: {
      events?: unknown[]
      solverStats?: Record<string, unknown>
      stopReason?: string
      stopError?: string
      stopDetails?: unknown
      model?: {
        stateNames?: string[]
        conditionNames?: string[]
      }
    }
    data?: {
      t?: unknown[]
      x?: Record<string, unknown>
      c?: Record<string, unknown>
      cBoolean?: Record<string, unknown>
      z?: Record<string, unknown>
      eventTimes?: unknown[]
    }
  }
  let runResult: SimResult | null = null
  try {
    runResult = await executeInWorkerSandbox(
      {
        id: runId,
        code: runCode,
        sourceURL: `${runId}.js`,
        stopSignal: runAbort.signal,
      },
      {
        sim: {
          t0: 0,
          tf: 5,
          dt: 0.3,
          solverOptions: {
            timeIntegrator: 'sdirk2',
            captureFailureState: true,
            enableEventLocalization: true,
            eventTolTime: 1e-6,
            maxEventBisectionIter: 64,
            eventIterationMaxIter: 16,
            maxEventsPerMacroStep: 64,
            adaptiveSubsteps: true,
          },
        },
      },
      {
        source: 'ModelicaDiagnostics',
        __rumocaRunId: runId,
      },
    )
  } finally {
    runAbort.abort()
  }

  const asFiniteSeries = (value: unknown): number[] =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
      : []
  const getSeriesByName = (
    bag: Record<string, unknown> | undefined,
    name: string,
    fallbackIdx = 0,
  ): number[] => {
    if (!bag || typeof bag !== 'object') return []
    const byName = asFiniteSeries(bag[name])
    if (byName.length > 0) return byName
    const alt = asFiniteSeries(bag[name.replaceAll('.', '__')])
    if (alt.length > 0) return alt
    const keys = Object.keys(bag)
    const fallbackKey = keys[fallbackIdx]
    return fallbackKey ? asFiniteSeries(bag[fallbackKey]) : []
  }
  const countSignFlips = (arr: number[], eps = 1e-7): number => {
    let flips = 0
    let prevSign = 0
    for (const value of arr) {
      if (!Number.isFinite(value)) continue
      const sign = Math.abs(value) <= eps ? 0 : value > 0 ? 1 : -1
      if (sign === 0) continue
      if (prevSign !== 0 && sign !== prevSign) flips += 1
      prevSign = sign
    }
    return flips
  }
  const getFiniteMin = (arr: number[]): number | null => {
    const finite = arr.filter((v) => Number.isFinite(v))
    return finite.length > 0 ? Math.min(...finite) : null
  }
  const getFiniteMax = (arr: number[]): number | null => {
    const finite = arr.filter((v) => Number.isFinite(v))
    return finite.length > 0 ? Math.max(...finite) : null
  }
  const asBooleanSeries = (value: unknown): Array<boolean | null> =>
    Array.isArray(value)
      ? value.map((v) => {
          if (typeof v === 'boolean') return v
          if (typeof v === 'number' && Number.isFinite(v)) return v !== 0
          return null
        })
      : []

  const events = Array.isArray(runResult?.meta?.events) ? runResult.meta.events : []
  const solverStats =
    runResult?.meta?.solverStats && typeof runResult.meta.solverStats === 'object'
      ? runResult.meta.solverStats
      : {}
  const eventCountFromStatsRaw = Number(solverStats.eventCount ?? events.length)
  const eventCountFromStats = Number.isFinite(eventCountFromStatsRaw)
    ? eventCountFromStatsRaw
    : events.length
  const eventSampleCountRaw = Number(solverStats.eventSampleCount ?? 0)
  const eventSampleCount = Number.isFinite(eventSampleCountRaw) ? eventSampleCountRaw : 0
  const tSeries = asFiniteSeries(runResult?.data?.t)
  const xBag = runResult?.data?.x
  const cIndicatorBag = runResult?.data?.c
  const cBoolBag = runResult?.data?.cBoolean
  const hSeries = getSeriesByName(xBag, 'h', 0)
  const vSeries = getSeriesByName(xBag, 'v', 1)
  const cBooleanEntries = cBoolBag
    ? Object.entries(cBoolBag).map(([name, values]) => [name, asBooleanSeries(values)] as const)
    : []
  const cIndicatorEntries = cIndicatorBag
    ? Object.entries(cIndicatorBag).map(([name, values]) => [name, asFiniteSeries(values)] as const)
    : []
  const c0Series = cBooleanEntries.length > 0 ? cBooleanEntries[0]?.[1] || [] : []
  const c0IndicatorSeries = cIndicatorEntries.length > 0 ? cIndicatorEntries[0]?.[1] || [] : []
  const c0TrueCount = c0Series.filter((v) => v === true).length
  const c0Transitions = c0Series.reduce((acc, v, idx) => {
    if (idx === 0) return acc
    const prev = c0Series[idx - 1]
    if (v == null || prev == null) return acc
    return v === prev ? acc : acc + 1
  }, 0)
  const c0IndicatorSignFlips = countSignFlips(c0IndicatorSeries)
  const velocitySignFlips = countSignFlips(vSeries)
  const eventTimesFromData = asFiniteSeries(runResult?.data?.eventTimes)

  const summary = {
    nSamples: tSeries.length,
    fixedGridSamples: Math.floor((5 - 0) / 0.3) + 1,
    tStart: tSeries.length > 0 ? tSeries[0] : null,
    tEnd: tSeries.length > 0 ? tSeries[tSeries.length - 1] : null,
    stopReason: runResult?.meta?.stopReason ?? null,
    stopError: runResult?.meta?.stopError ?? null,
    solverStats,
    eventsDetected: eventCountFromStats,
    eventSamplesInserted: eventSampleCount,
    eventTimesFromData,
    stateNames: Array.isArray(runResult?.meta?.model?.stateNames)
      ? runResult.meta.model.stateNames
      : [],
    conditionNames: Array.isArray(runResult?.meta?.model?.conditionNames)
      ? runResult.meta.model.conditionNames
      : [],
    h: {
      len: hSeries.length,
      min: getFiniteMin(hSeries),
      max: getFiniteMax(hSeries),
      first: hSeries.slice(0, 12),
      last: hSeries.slice(-12),
    },
    v: {
      len: vSeries.length,
      min: getFiniteMin(vSeries),
      max: getFiniteMax(vSeries),
      signFlips: velocitySignFlips,
      first: vSeries.slice(0, 12),
      last: vSeries.slice(-12),
    },
    c: {
      names: cIndicatorEntries.map(([name]) => name),
      firstConditionIndicatorMin: getFiniteMin(c0IndicatorSeries),
      firstConditionIndicatorMax: getFiniteMax(c0IndicatorSeries),
      firstConditionIndicatorSignFlips: c0IndicatorSignFlips,
      firstConditionIndicatorFirst: c0IndicatorSeries.slice(0, 20),
      firstConditionIndicatorLast: c0IndicatorSeries.slice(-20),
      firstConditionTrueCount: c0TrueCount,
      firstConditionTransitions: c0Transitions,
      firstConditionFirst: c0Series.slice(0, 20),
      firstConditionLast: c0Series.slice(-20),
    },
    stopDetails: runResult?.meta?.stopDetails ?? null,
  }
  const serializedSummary = serializeObject(summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
  const serializedRunResult = serializeObject(runResult, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)

  if (eventCountFromStats <= 1) {
    throw new Error(
      [
        'BouncingBall regression: expected multiple events in 5s run, but too few were detected.',
        `summary:\n${serializedSummary}`,
        `runResult:\n${serializedRunResult}`,
        `generatedCode:\n${serializeObject(rendered, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
      ].join('\n\n'),
    )
  }
  if (eventCountFromStats > 0 && eventSampleCount <= 0) {
    throw new Error(
      [
        'BouncingBall regression: events were localized but no event samples were inserted into output.',
        `summary:\n${serializedSummary}`,
        `runResult:\n${serializedRunResult}`,
        `generatedCode:\n${serializeObject(rendered, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
      ].join('\n\n'),
    )
  }
  if (eventCountFromStats > 0 && tSeries.length <= Math.floor((5 - 0) / 0.3) + 1) {
    throw new Error(
      [
        'BouncingBall regression: output series length did not grow beyond fixed grid despite localized events.',
        `summary:\n${serializedSummary}`,
        `runResult:\n${serializedRunResult}`,
        `generatedCode:\n${serializeObject(rendered, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
      ].join('\n\n'),
    )
  }
  if (velocitySignFlips <= 0) {
    throw new Error(
      [
        'BouncingBall regression: velocity never flips sign after expected impact.',
        `summary:\n${serializedSummary}`,
        `runResult:\n${serializedRunResult}`,
        `generatedCode:\n${serializeObject(rendered, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
      ].join('\n\n'),
    )
  }

  return {
    ok: true,
    summarySerialized: serializedSummary,
    runResultSerialized: serializedRunResult,
    generatedCodeSerialized: serializeObject(rendered, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
    generatedCodePreview: rendered.slice(0, 500),
  }
}

export async function testModelicaBouncingBallStandardSettingsBounce() {
  const source = `
model BouncingBall             "The bouncing ball model"
  constant Real g = 9.81 "Gravitational acceleration";
  parameter Real c = 0.9 "Elasticity constant of ball";
  parameter Real radius = 0.1 "Radius of the ball";
  Real h(start = 1,fixed=true) "height above ground of ball center";
  Real v(start = 0,fixed=true) "Velocity of the ball";
  Real E "Mechanical energy";
 equation
  der(h) = v;
  der(v) = -g;
  E = g*h + 0.5*v*v;
  when h <= radius then
    reinit(v, -c*pre(v));
  end when;
 end BouncingBall;
`.trim()

  const wasm = await getDiagnosticsWasm()
  if (typeof wasm.compile_to_json !== 'function') {
    throw new Error('Rumoca wasm export missing: compile_to_json')
  }
  assertTemplateRendererAvailable(wasm)

  const compiled = wasm.compile_to_json(source, 'BouncingBall')
  const parsed = JSON.parse(compiled) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) {
    throw new Error('Rumoca compile_to_json returned no DAE payload for BouncingBall')
  }

  const rendered = renderDiagnosticsTemplate(
    wasm,
    dae,
    javascriptTemplate,
    'javascript.jinja',
    'model.js',
  )
  if (!rendered || typeof rendered !== 'string') {
    throw new Error('Rendering javascript.jinja failed for BouncingBall')
  }

  const runId = 'modelica-bouncing-ball-standard-settings'
  const runCode = await buildWorkerSandboxCodeChecked(rendered, runId)
  const runAbort = new AbortController()
  type SimResult = {
    meta?: {
      events?: unknown[]
      solverStats?: Record<string, unknown>
      stopReason?: string
      stopError?: string
      model?: {
        stateNames?: string[]
      }
    }
    data?: {
      t?: unknown[]
      x?: Record<string, unknown>
    }
  }
  let runResult: SimResult | null = null
  try {
    runResult = await executeInWorkerSandbox(
      {
        id: runId,
        code: runCode,
        sourceURL: `${runId}.js`,
        stopSignal: runAbort.signal,
      },
      {
        sim: {
          t0: 0,
          tf: 2,
          dt: 0.1,
        },
      },
      {
        source: 'ModelicaDiagnostics',
        __rumocaRunId: runId,
      },
    )
  } finally {
    runAbort.abort()
  }

  const asFiniteSeries = (value: unknown): number[] =>
    Array.isArray(value)
      ? value.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
      : []
  const getSeriesByName = (bag: Record<string, unknown> | undefined, name: string): number[] => {
    if (!bag || typeof bag !== 'object') return []
    const byName = asFiniteSeries(bag[name])
    if (byName.length > 0) return byName
    const alt = asFiniteSeries(bag[name.replaceAll('.', '__')])
    if (alt.length > 0) return alt
    return []
  }
  const countSignFlips = (arr: number[], eps = 1e-7): number => {
    let flips = 0
    let prevSign = 0
    for (const value of arr) {
      if (!Number.isFinite(value)) continue
      const sign = Math.abs(value) <= eps ? 0 : value > 0 ? 1 : -1
      if (sign === 0) continue
      if (prevSign !== 0 && sign !== prevSign) flips += 1
      prevSign = sign
    }
    return flips
  }

  const tSeries = asFiniteSeries(runResult?.data?.t)
  const hSeries = getSeriesByName(runResult?.data?.x, 'h')
  const vSeries = getSeriesByName(runResult?.data?.x, 'v')
  const minH = hSeries
    .filter(Number.isFinite)
    .reduce((m, v) => Math.min(m, v), Number.POSITIVE_INFINITY)
  const maxH = hSeries
    .filter(Number.isFinite)
    .reduce((m, v) => Math.max(m, v), Number.NEGATIVE_INFINITY)
  const vSignFlips = countSignFlips(vSeries)
  const events = Array.isArray(runResult?.meta?.events) ? runResult?.meta?.events : []
  const eventCountFromStats = Number(runResult?.meta?.solverStats?.eventCount ?? events.length)

  const summary = {
    nSamples: tSeries.length,
    expectedGridSamples: Math.floor((2 - 0) / 0.1) + 1,
    tStart: tSeries.length > 0 ? tSeries[0] : null,
    tEnd: tSeries.length > 0 ? tSeries[tSeries.length - 1] : null,
    minH: Number.isFinite(minH) ? minH : null,
    maxH: Number.isFinite(maxH) ? maxH : null,
    velocitySignFlips: vSignFlips,
    eventCountFromStats: Number.isFinite(eventCountFromStats) ? eventCountFromStats : events.length,
    stopReason: runResult?.meta?.stopReason ?? null,
    stopError: runResult?.meta?.stopError ?? null,
    stateNames: Array.isArray(runResult?.meta?.model?.stateNames)
      ? runResult.meta.model.stateNames
      : [],
  }

  if (runResult?.meta?.stopReason) {
    throw new Error(
      [
        `BouncingBall standard-settings run stopped early: ${runResult.meta.stopReason}`,
        `stopError=${String(runResult.meta.stopError ?? '')}`,
        `summary=${serializeObject(summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
      ].join('\n'),
    )
  }
  if (tSeries.length < 20 || tSeries.length > 25) {
    throw new Error(
      [
        `Unexpected sample count for dt=0.1, tf=2 (expected about 21, got ${tSeries.length})`,
        `summary=${serializeObject(summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
      ].join('\n'),
    )
  }
  if (hSeries.length !== tSeries.length || vSeries.length !== tSeries.length) {
    throw new Error(
      [
        `State series length mismatch: t=${tSeries.length}, h=${hSeries.length}, v=${vSeries.length}`,
        `summary=${serializeObject(summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
      ].join('\n'),
    )
  }
  if (!Number.isFinite(minH) || minH > 0.11) {
    throw new Error(
      [
        `BouncingBall did not reach ground contact (min h=${String(minH)})`,
        `summary=${serializeObject(summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
      ].join('\n'),
    )
  }
  const eventCount = Number.isFinite(eventCountFromStats) ? eventCountFromStats : events.length
  if (eventCount <= 0) {
    throw new Error(
      [
        'BouncingBall produced no events, but the model should definitely bounce and trigger events',
        `summary=${serializeObject(summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
      ].join('\n'),
    )
  }
  if (vSignFlips <= 0) {
    throw new Error(
      [
        'BouncingBall produced events but no velocity sign flip was observed',
        `summary=${serializeObject(summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
      ].join('\n'),
    )
  }

  return {
    ok: true,
    summarySerialized: serializeObject(summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
    generatedCodePreview: rendered.slice(0, 500),
  }
}

export async function testModelicaAbiValidationRoutingRegression() {
  const wasm = await getDiagnosticsWasm()

  const source = `
model Test
  Real x(start=0);
equation
  der(x) = 1;
end Test;
`.trim()

  const compiled = wasm.compile_to_json(source, 'Test')
  const parsed = JSON.parse(compiled) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) {
    throw new Error('Rumoca compile_to_json returned no DAE payload')
  }
  const daeJson = JSON.stringify(dae)

  const cases = [
    {
      name: 'javascript.jinja',
      template: javascriptTemplate,
      shouldValidate: true,
    },
    {
      name: 'standalone_html.jinja',
      template: standaloneHtmlTemplate,
      shouldValidate: false,
    },
    {
      name: 'base_dae.jinja',
      template: baseDaeTemplate,
      shouldValidate: false,
    },
  ] as const

  const summarizeRenderedPreview = (rendered: string) => {
    const head = rendered.slice(0, 1200)
    const tail = rendered.length > 1200 ? rendered.slice(-1200) : ''
    return {
      length: rendered.length,
      hasLegacyDotSymbols:
        rendered.includes('_dot - (') || rendered.includes('x_dot') || rendered.includes('v_dot'),
      head,
      tail,
    }
  }

  const results: Record<
    string,
    {
      shouldValidate: boolean
      guardDecision: boolean
      guardReason: string
      abiSandboxExecuted: boolean
      abiValidationOk?: boolean
    }
  > = {}

  for (const c of cases) {
    const rendered = renderRumocaTemplate({
      wasm,
      daeJson,
      templateSource: c.template,
      modelName: getTemplateModelName(dae),
      templatePath: c.name,
      outputPath: c.name,
      targetName: 'template',
    })
    const decision = shouldValidateModelAbiForRenderedOutput(rendered)
    const renderedSummary = summarizeRenderedPreview(rendered)
    if (decision.shouldValidate !== c.shouldValidate) {
      throw new Error(
        [
          `Guard decision mismatch for ${c.name}: expected ${String(c.shouldValidate)} got ${String(decision.shouldValidate)}`,
          `guardReason=${decision.reason}`,
          `renderedSummary=${serializeObject(renderedSummary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
        ].join('\n'),
      )
    }

    let abiValidationOk: boolean | undefined
    let abiSandboxExecuted = false
    if (decision.shouldValidate) {
      const code = buildModelAbiValidationSandboxCode(rendered)
      const id = `modelica-abi-routing-${c.name.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}`
      const abort = new AbortController()
      abiSandboxExecuted = true
      try {
        const rawAbiResult = await executeInWorkerSandbox(
          {
            id,
            code,
            sourceURL: `${id}.js`,
            stopSignal: abort.signal,
          },
          {},
          {
            source: 'ModelicaDiagnostics',
            enforceModelAbi: true,
            __rumocaRunId: id,
          },
        )
        const abiResult = validateModelAbiValidationResultV1(rawAbiResult)
        if (abiResult.ok !== true) {
          throw new Error(
            [
              abiResult.errorMessage || `ABI validation failed for ${c.name}`,
              `template=${c.name}`,
              `guardReason=${decision.reason}`,
              `renderedSummary=${serializeObject(renderedSummary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
              `rawAbiResult=${serializeObject(rawAbiResult, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
            ].join('\n'),
          )
        }
        abiValidationOk = true
      } catch (error) {
        throw new Error(
          [
            `ABI routing regression failed for template=${c.name}`,
            `guardDecision=${String(decision.shouldValidate)} expected=${String(c.shouldValidate)} reason=${decision.reason}`,
            `error=${error instanceof Error ? error.message : String(error)}`,
            `renderedSummary=${serializeObject(renderedSummary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
            `partialResults=${serializeObject(results, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
          ].join('\n'),
        )
      } finally {
        abort.abort()
      }
    }

    results[c.name] = {
      shouldValidate: c.shouldValidate,
      guardDecision: decision.shouldValidate,
      guardReason: decision.reason,
      abiSandboxExecuted,
      ...(abiValidationOk !== undefined ? { abiValidationOk } : {}),
    }
  }

  return {
    ok: true,
    resultsSerialized: serializeObject(results, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
  }
}

// Backward-compat alias so existing diagnostics button names still work.
export async function testModelicaForcedAbiValidationFailureModes() {
  return testModelicaAbiValidationRoutingRegression()
}

const MSL_LOCAL_ZIP_PATH = '/modelica-libraries/ModelicaStandardLibrary-4.1.0.zip'
const MSL_LOCAL_ZIP_FILE_CANDIDATES = [
  new URL('../../../public/modelica-libraries/ModelicaStandardLibrary-4.1.0.zip', import.meta.url),
  new URL('../../../packages/rumoca/target/msl/ModelicaStandardLibrary-4.1.0.zip', import.meta.url),
]

async function resolveDiagnosticsMslZipFilePath(): Promise<string> {
  for (const candidate of MSL_LOCAL_ZIP_FILE_CANDIDATES) {
    try {
      await access(candidate)
      return candidate.pathname
    } catch {
      continue
    }
  }
  throw new Error(
    `Could not locate ModelicaStandardLibrary-4.1.0.zip for CLI diagnostics. Checked: ${MSL_LOCAL_ZIP_FILE_CANDIDATES.map((candidate) => candidate.pathname).join(', ')}`,
  )
}

type DiagnosticsWasm = Awaited<ReturnType<typeof loadWasm>>
type MslLoadParsed = {
  parsed_count?: number
  skipped_files?: string[]
  conflicts?: string[]
  error_count?: number
  library_names?: string[]
}
type MslLoadResult = {
  libraryFileCount: number
  loadParsed: MslLoadParsed
}
type SharedMslLoadResult = MslLoadResult & {
  zipBytes: number
}
type DiagnosticsMslApi = {
  compile_to_json?: (source: string, modelName: string) => string
  compile_with_source_roots?: (source: string, modelName: string, sourceRootsJson: string) => string
  compile_with_libraries?: (source: string, modelName: string, librariesJson: string) => string
  simulate_model?: (
    source: string,
    modelName: string,
    tEnd: number,
    dt: number,
    solver: string,
  ) => string
  load_source_roots?: (sourceRootsJson: string) => string
  load_libraries?: (librariesJson: string) => string
  list_classes?: () => string
  get_class_info?: (qualifiedName: string) => string
  parse_source_root_file?: (source: string, filename: string) => string
  wasm_init?: (numThreads: number) => unknown
  lsp_diagnostics?: (source: string) => string
  lsp_completion_with_timing?: (source: string, line: number, character: number) => string
}

let sharedDiagnosticsWasmPromise: Promise<DiagnosticsWasm> | null = null
let sharedDiagnosticsMslLoadPromise: Promise<SharedMslLoadResult> | null = null

async function assertGeneratedJsSyntaxOrThrow(rendered: string, context: string): Promise<void> {
  const check = await validateJavaScriptInSandbox(rendered)
  if (check.valid) return
  const details = [
    `Generated JavaScript syntax check failed (${context})`,
    `phase=${String(check.phase || 'unknown')}`,
    `errorName=${String(check.errorName || 'unknown')}`,
    `message=${String(check.message || 'unknown')}`,
    `line=${String(check.line ?? 'n/a')}`,
    `column=${String(check.column ?? 'n/a')}`,
    check.snippet ? `snippet:\n${check.snippet}` : '',
    check.rawError ? `rawError:\n${check.rawError}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  throw new Error(details)
}

async function buildWorkerSandboxCodeChecked(
  rendered: string,
  context: string,
  solverSource?: string,
): Promise<string> {
  await assertGeneratedJsSyntaxOrThrow(rendered, context)
  return buildWorkerSandboxCode(rendered, solverSource)
}

async function getDiagnosticsWasm(): Promise<DiagnosticsWasm> {
  if (!sharedDiagnosticsWasmPromise) {
    sharedDiagnosticsWasmPromise = loadWasm().catch((err) => {
      sharedDiagnosticsWasmPromise = null
      throw err
    })
  }
  return sharedDiagnosticsWasmPromise
}

async function ensureDiagnosticsMslLoaded(
  wasm: DiagnosticsMslApi,
  debug: Record<string, unknown>,
): Promise<MslLoadResult> {
  if (!sharedDiagnosticsMslLoadPromise) {
    const loadDebug: Record<string, unknown> = {}
    sharedDiagnosticsMslLoadPromise = loadLocalMslLibraries(wasm, loadDebug)
      .then(({ libraryFileCount, loadParsed }) => ({
        libraryFileCount,
        loadParsed,
        zipBytes:
          typeof loadDebug.zipBytes === 'number' && Number.isFinite(loadDebug.zipBytes)
            ? loadDebug.zipBytes
            : 0,
      }))
      .catch((err) => {
        sharedDiagnosticsMslLoadPromise = null
        throw err
      })
  }

  const loaded = await sharedDiagnosticsMslLoadPromise
  debug.zipBytes = loaded.zipBytes
  debug.libraryFileCount = loaded.libraryFileCount
  debug.loadParsed = loaded.loadParsed
  return {
    libraryFileCount: loaded.libraryFileCount,
    loadParsed: loaded.loadParsed,
  }
}

function buildModelConstructionProbeSandboxCode(compiledJs: string): string {
  return `
(params, context) => {
  try {
    ${compiledJs}
  } catch (e) {
    return {
      ok: false,
      stage: 'evaluate-generated-js',
      error: {
        message: (e && e.message) || String(e),
        name: (e && e.name) || undefined,
        stack: (e && e.stack) || undefined,
      },
    };
  }

  if (typeof Model !== 'function') {
    return {
      ok: false,
      stage: 'missing-model-factory',
      modelType: typeof Model,
    };
  }

  try {
    const model = Model();
    const keys = model && typeof model === 'object'
      ? Object.keys(model).slice(0, 50)
      : [];

    return {
      ok: true,
      stage: 'model-constructed',
      modelType: typeof model,
      keys,
      abi: model && model.abi ? { id: model.abi.id, version: model.abi.version } : undefined,
      description:
        model && model.description
          ? {
              modelName: model.description.modelName,
              nx: model.description.nx,
              ny: model.description.ny,
              nu: model.description.nu,
              nz: model.description.nz,
            }
          : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      stage: 'construct-model',
      error: {
        message: (e && e.message) || String(e),
        name: (e && e.name) || undefined,
        stack: (e && e.stack) || undefined,
      },
      modelFnPreview: String(Model).slice(0, 500),
    };
  }
}
`
}

function normalizeLibraryEntryPath(path: string): string {
  const parts = String(path || '')
    .split('/')
    .filter(Boolean)
  if (parts.length > 1 && /(?:Standard)?Library|^MSL/i.test(parts[0] ?? '')) {
    return parts.slice(1).join('/')
  }
  if (parts.length > 0) {
    parts[0] = parts[0]!.replace(/[\s-][\d.]+$/, '')
  }
  return parts.join('/')
}

async function loadLocalMslLibraries(
  wasm: DiagnosticsMslApi,
  debug: Record<string, unknown>,
): Promise<MslLoadResult> {
  const canLoadSourceRoots = typeof wasm.load_source_roots === 'function'
  const canLoadLibraries = typeof wasm.load_libraries === 'function'
  if (!canLoadSourceRoots && !canLoadLibraries) {
    throw new Error('Rumoca wasm export missing: load_source_roots / load_libraries')
  }

  const zipResponse = await fetch(MSL_LOCAL_ZIP_PATH)
  if (!zipResponse.ok) {
    throw new Error(
      `Failed to fetch local MSL archive at ${MSL_LOCAL_ZIP_PATH}: HTTP ${zipResponse.status}`,
    )
  }

  const zipBytes = new Uint8Array(await zipResponse.arrayBuffer())
  if (zipBytes.length <= 1024) {
    throw new Error('Local MSL archive appears to be invalid (too small)')
  }
  debug.zipBytes = zipBytes.length

  const archive = unzipSync(zipBytes)
  const libraries: Record<string, string> = {}
  for (const [rawPath, content] of Object.entries(archive)) {
    const lowerPath = rawPath.toLowerCase()
    if (!lowerPath.endsWith('.mo')) continue
    if (rawPath.includes('Test') || rawPath.includes('Obsolete')) continue
    const normalizedPath = normalizeLibraryEntryPath(rawPath)
    libraries[normalizedPath] = strFromU8(content)
  }

  const libraryFileCount = Object.keys(libraries).length
  if (libraryFileCount === 0) {
    throw new Error('No usable .mo files found in local MSL archive')
  }
  debug.libraryFileCount = libraryFileCount

  const loadFn = canLoadSourceRoots ? wasm.load_source_roots : wasm.load_libraries
  if (typeof loadFn !== 'function') {
    throw new Error('Rumoca wasm export missing: load_source_roots / load_libraries')
  }
  const loadRaw = loadFn(JSON.stringify(libraries))
  const loadParsed = JSON.parse(String(loadRaw)) as MslLoadParsed
  debug.loadParsed = loadParsed

  return {
    libraryFileCount,
    loadParsed,
  }
}

function compileWithDiagnosticsMsl(
  wasm: DiagnosticsMslApi,
  source: string,
  modelName: string,
): string {
  if (typeof wasm.compile_with_source_roots === 'function') {
    return wasm.compile_with_source_roots(source, modelName, '{}')
  }
  if (typeof wasm.compile_with_libraries === 'function') {
    return wasm.compile_with_libraries(source, modelName, '{}')
  }
  throw new Error('Rumoca wasm export missing: compile_with_source_roots / compile_with_libraries')
}

function sourceNeedsMsl(source: string): boolean {
  return String(source || '').includes('Modelica.')
}

async function compileToJsonWithAutoMsl(
  wasm: DiagnosticsMslApi,
  source: string,
  modelName: string,
  debug: Record<string, unknown>,
): Promise<string> {
  if (typeof wasm.compile_to_json !== 'function') {
    throw new Error('Rumoca wasm export missing: compile_to_json')
  }

  if (sourceNeedsMsl(source)) {
    await ensureDiagnosticsMslLoaded(wasm, debug)
    if (
      typeof wasm.compile_with_source_roots === 'function' ||
      typeof wasm.compile_with_libraries === 'function'
    ) {
      return compileWithDiagnosticsMsl(wasm, source, modelName)
    }
  }

  return wasm.compile_to_json(source, modelName)
}

function parseSourceRootAstOrError(
  wasm: DiagnosticsMslApi,
  source: string,
  fileName: string,
): { ok: true; ast: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof wasm.parse_source_root_file !== 'function') {
    return { ok: false, error: 'Rumoca wasm export missing: parse_source_root_file' }
  }
  try {
    const raw = wasm.parse_source_root_file(source, fileName)
    const ast = JSON.parse(String(raw))
    if (!ast || typeof ast !== 'object' || Array.isArray(ast)) {
      return { ok: false, error: 'parse_source_root_file returned non-object AST payload' }
    }
    return { ok: true, ast: ast as Record<string, unknown> }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function asStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractClassSourceFromFile(fileSource: string, className: string): string {
  const escapedClassName = escapeRegExp(className)
  const startRegex = new RegExp(
    `(?:^|\\n)\\s*(?:model|block|record|type|package|connector|function)\\s+${escapedClassName}\\b`,
    'm',
  )
  const startMatch = startRegex.exec(fileSource)
  if (!startMatch || startMatch.index < 0) {
    throw new Error(`Could not locate class declaration for ${className} in source file`)
  }
  const startIndex = startMatch.index + (startMatch[0].startsWith('\n') ? 1 : 0)
  const endRegex = new RegExp(`(?:^|\\n)\\s*end\\s+${escapedClassName}\\s*;`, 'm')
  const endMatch = endRegex.exec(fileSource.slice(startIndex))
  if (!endMatch || endMatch.index < 0) {
    throw new Error(`Could not locate class end for ${className} in source file`)
  }
  const endIndex = startIndex + endMatch.index + endMatch[0].length
  return fileSource.slice(startIndex, endIndex).trim()
}

function hasClassDeclarationInFile(fileSource: string, className: string): boolean {
  try {
    extractClassSourceFromFile(fileSource, className)
    return true
  } catch {
    return false
  }
}

function findMslSourceContainerPath(
  archiveEntries: Record<string, string>,
  qualifiedName: string,
): string | null {
  const parts = qualifiedName.split('.').filter(Boolean)
  const className = parts.at(-1) || ''
  if (!className) return null

  const packageCandidates = parts
    .slice(0, -1)
    .map(
      (_, index, allParts) => `${allParts.slice(0, allParts.length - index).join('/')}/package.mo`,
    )

  for (const candidate of packageCandidates) {
    const normalizedCandidate = normalizeLibraryEntryPath(candidate)
    const fileSource = archiveEntries[normalizedCandidate]
    if (typeof fileSource !== 'string') continue
    if (hasClassDeclarationInFile(fileSource, className)) {
      return normalizedCandidate
    }
  }

  for (const [path, fileSource] of Object.entries(archiveEntries)) {
    if (!path.endsWith('/package.mo')) continue
    if (hasClassDeclarationInFile(fileSource, className)) {
      return path
    }
  }

  return null
}

async function getMslClassCompileTarget(
  wasm: DiagnosticsMslApi,
  qualifiedName: string,
): Promise<{ sourcePath: string; modelName: string }> {
  if (typeof wasm.get_class_info !== 'function') {
    throw new Error('Rumoca wasm export missing: get_class_info')
  }
  const info = JSON.parse(String(wasm.get_class_info(qualifiedName))) as Record<string, unknown>
  const sourceFile = asStringOrEmpty(info.source_file).trim()

  if (sourceFile) {
    return {
      sourcePath: sourceFile,
      modelName: qualifiedName,
    }
  }

  const mslFiles = await loadMslSourcesFromZip()
  const resolvedSourcePath = findMslSourceContainerPath(mslFiles, qualifiedName)
  const fallbackPath = `${qualifiedName.replaceAll('.', '/')}.mo`
  const sourceFileEntry = readMslSourceFromZipByPath(
    mslFiles,
    resolvedSourcePath || sourceFile || fallbackPath,
  )
  if (!sourceFileEntry) {
    throw new Error(`Could not locate source file in MSL zip for ${qualifiedName}`)
  }
  return {
    sourcePath: sourceFileEntry.path,
    modelName: qualifiedName,
  }
}

function readMslSourceFromZipByPath(
  archiveEntries: Record<string, string>,
  requestedPath: string,
): { path: string; source: string } | null {
  const trimmedRequestedPath = requestedPath.trim()
  if (!trimmedRequestedPath) return null
  const normalized = normalizeLibraryEntryPath(trimmedRequestedPath)
  const exactMatch = normalized ? archiveEntries[normalized] : undefined
  if (normalized && typeof exactMatch === 'string') {
    return { path: normalized, source: exactMatch }
  }
  const wantedSuffix = normalized || trimmedRequestedPath
  const fallbackPath = Object.keys(archiveEntries).find((entry) => entry.endsWith(wantedSuffix))
  if (!fallbackPath) return null
  const source = archiveEntries[fallbackPath]
  return source ? { path: fallbackPath, source } : null
}

async function loadMslSourcesFromZip(): Promise<Record<string, string>> {
  const zipResponse = await fetch(MSL_LOCAL_ZIP_PATH)
  if (!zipResponse.ok) {
    throw new Error(
      `Failed to fetch local MSL archive at ${MSL_LOCAL_ZIP_PATH}: HTTP ${zipResponse.status}`,
    )
  }
  const zipBytes = new Uint8Array(await zipResponse.arrayBuffer())
  const archive = unzipSync(zipBytes)
  const files: Record<string, string> = {}
  for (const [rawPath, content] of Object.entries(archive)) {
    if (!rawPath.toLowerCase().endsWith('.mo')) continue
    files[normalizeLibraryEntryPath(rawPath)] = strFromU8(content)
  }
  return files
}

function findResistorSineVoltageType(info: Record<string, unknown>): string {
  const components = info.components
  if (!components || typeof components !== 'object' || Array.isArray(components)) {
    return 'Modelica.Electrical.Analog.Sources.SineVoltage'
  }
  const componentMap = components as Record<string, unknown>
  const sineByName = componentMap.SineVoltage1
  if (sineByName && typeof sineByName === 'object' && !Array.isArray(sineByName)) {
    const typeName = asStringOrEmpty((sineByName as Record<string, unknown>).type_name)
    if (typeName) return typeName
  }
  for (const value of Object.values(componentMap)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const typeName = asStringOrEmpty((value as Record<string, unknown>).type_name)
    if (typeName.endsWith('.SineVoltage') || typeName === 'SineVoltage') return typeName
  }
  return 'Modelica.Electrical.Analog.Sources.SineVoltage'
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function collectQualifiedClassNames(
  nodes: Array<{ qualified_name?: unknown; children?: unknown }>,
  out: string[],
): void {
  for (const node of nodes) {
    if (typeof node.qualified_name === 'string' && node.qualified_name.length > 0) {
      out.push(node.qualified_name)
    }
    if (!Array.isArray(node.children)) continue
    collectQualifiedClassNames(
      node.children as Array<{ qualified_name?: unknown; children?: unknown }>,
      out,
    )
  }
}

export async function testModelicaOptionalRayonInitialization() {
  const wasm = await getDiagnosticsWasm()
  const hasInit = typeof wasm.wasm_init === 'function'
  if (!hasInit) {
    return { ok: true, hasWasmInit: false, enabled: false, reason: 'wasm_init export missing' }
  }

  const hardwareThreads = asNumberOrNull(globalThis.navigator?.hardwareConcurrency) ?? 2
  const requestedThreads = Math.max(1, Math.min(hardwareThreads, 4))
  const crossOriginIsolated = globalThis.crossOriginIsolated === true

  try {
    const zeroThreadResult: unknown = await Promise.resolve(wasm.wasm_init?.(0))
    const initResult: unknown = await Promise.resolve(wasm.wasm_init?.(requestedThreads))
    const enabled = initResult === true
    return {
      ok: true,
      hasWasmInit: true,
      requestedThreads,
      crossOriginIsolated,
      zeroThreadResult: zeroThreadResult ?? null,
      initResult: initResult ?? null,
      enabled,
    }
  } catch (error) {
    if (!crossOriginIsolated) {
      return {
        ok: true,
        hasWasmInit: true,
        requestedThreads,
        crossOriginIsolated,
        enabled: false,
        reason: 'Threaded wasm requires crossOriginIsolated runtime',
        error: error instanceof Error ? error.message : String(error),
      }
    }
    throw error
  }
}

export async function testModelicaLspSmokeWithMsl() {
  const debug: Record<string, unknown> = { phase: 'init' }
  const wasm = await getDiagnosticsWasm()
  const hasDiagnostics = typeof wasm.lsp_diagnostics === 'function'
  const hasCompletion = typeof wasm.lsp_completion_with_timing === 'function'
  if (!hasDiagnostics || !hasCompletion) {
    throw new Error('Rumoca wasm export missing: lsp_diagnostics / lsp_completion_with_timing')
  }

  const { libraryFileCount } = await ensureDiagnosticsMslLoaded(wasm, debug)
  debug.phase = 'msl-loaded'

  const source = `
model LspSmoke
  Real y;
equation
  y = Modelica.Constants.pi;
end LspSmoke;
`.trim()
  const completionLine = 3
  const completionCharacter = '  y = Modelica.'.length

  const diagnosticsRaw = wasm.lsp_diagnostics(source)
  const diagnostics = JSON.parse(String(diagnosticsRaw)) as unknown
  if (!Array.isArray(diagnostics)) {
    throw new Error('lsp_diagnostics did not return a JSON array')
  }

  const completionRaw = wasm.lsp_completion_with_timing(source, completionLine, completionCharacter)
  const completion = JSON.parse(String(completionRaw)) as {
    items?: unknown
    timing?: { total_ms?: unknown; completion_handler_ms?: unknown }
  }
  if (!Array.isArray(completion.items)) {
    throw new Error('lsp_completion_with_timing.items is not an array')
  }
  if (typeof completion.timing !== 'object' || completion.timing == null) {
    throw new Error('lsp_completion_with_timing.timing is missing')
  }

  return {
    ok: true,
    libraryFileCount,
    diagnosticsCount: diagnostics.length,
    completionItems: completion.items.length,
    timing: {
      totalMs: asNumberOrNull(completion.timing.total_ms),
      handlerMs: asNumberOrNull(completion.timing.completion_handler_ms),
    },
  }
}

export async function testModelicaMslTreeViewData() {
  const debug: Record<string, unknown> = { phase: 'init' }
  const wasm = await getDiagnosticsWasm()
  if (typeof wasm.list_classes !== 'function') {
    throw new Error('Rumoca wasm export missing: list_classes')
  }

  const { libraryFileCount } = await ensureDiagnosticsMslLoaded(wasm, debug)
  debug.phase = 'msl-loaded'

  const rawTree = wasm.list_classes()
  const tree = JSON.parse(String(rawTree)) as {
    total_classes?: unknown
    classes?: Array<{ name?: unknown; qualified_name?: unknown; children?: unknown }>
  }
  const classNodes = Array.isArray(tree.classes) ? tree.classes : []
  const allQualifiedNames: string[] = []
  collectQualifiedClassNames(classNodes, allQualifiedNames)
  const totalClasses = asNumberOrNull(tree.total_classes) ?? allQualifiedNames.length
  const hasModelicaRoot = allQualifiedNames.includes('Modelica')
  const hasKnownPackage =
    allQualifiedNames.includes('Modelica.Constants') ||
    allQualifiedNames.includes('Modelica.Blocks')

  if (!hasModelicaRoot || !hasKnownPackage || totalClasses <= 0) {
    throw new Error(
      `Unexpected class tree payload: total=${totalClasses}, hasModelica=${hasModelicaRoot}, hasKnownPackage=${hasKnownPackage}`,
    )
  }

  return {
    ok: true,
    libraryFileCount,
    totalClasses,
    hasModelicaRoot,
    hasKnownPackage,
    classPreview: allQualifiedNames.slice(0, 20),
  }
}

export async function testModelicaMslCompileAndRunSmoke() {
  const debug: Record<string, unknown> = {
    mslZipPath: MSL_LOCAL_ZIP_PATH,
    phase: 'init',
  }
  let fullGeneratedCode = ''

  try {
    const wasm = await getDiagnosticsWasm()
    debug.phase = 'wasm-loaded'

    if (
      typeof wasm.compile_with_source_roots !== 'function' &&
      typeof wasm.compile_with_libraries !== 'function'
    ) {
      throw new Error(
        'Rumoca wasm export missing: compile_with_source_roots / compile_with_libraries',
      )
    }
    assertTemplateRendererAvailable(wasm)

    const { libraryFileCount, loadParsed } = await ensureDiagnosticsMslLoaded(wasm, debug)

    const source = `
model MslConstRamp
  parameter Real gain = Modelica.Constants.pi;
  Real x(start = 0);
equation
  der(x) = gain;
end MslConstRamp;
`.trim()

    const compiledRaw = compileWithDiagnosticsMsl(wasm, source, 'MslConstRamp')
    debug.phase = 'compiled-with-libraries'
    const compiled = JSON.parse(String(compiledRaw)) as {
      dae?: unknown
      dae_native?: unknown
      dae_prepared?: unknown
      pretty?: string
    }
    const dae = selectDaeForTemplate(compiled, { usePreparedDae: true })
    if (!dae) {
      throw new Error('MSL compile returned no DAE payload')
    }

    const rendered = renderDiagnosticsTemplate(
      wasm,
      dae,
      javascriptTemplate,
      'javascript.jinja',
      'model.js',
    )
    if (!rendered || typeof rendered !== 'string') {
      throw new Error('Rendering javascript.jinja failed for MSL smoke model')
    }
    fullGeneratedCode = rendered
    debug.renderedPreview = rendered.slice(0, 220)
    debug.generatedCodeLength = rendered.length

    const abiDecision = shouldValidateModelAbiForRenderedOutput(rendered)
    if (!abiDecision.shouldValidate) {
      throw new Error(`MSL smoke template not treated as JS model output: ${abiDecision.reason}`)
    }
    debug.abiDecision = abiDecision

    const modelProbeCode = buildModelConstructionProbeSandboxCode(rendered)
    const modelProbeRunId = 'modelica-msl-smoke-model-probe'
    const modelProbeAbort = new AbortController()
    let modelProbeResult: unknown
    try {
      modelProbeResult = await executeInWorkerSandbox(
        {
          id: modelProbeRunId,
          code: modelProbeCode,
          sourceURL: 'modelica-msl-smoke-model-probe.js',
          stopSignal: modelProbeAbort.signal,
        },
        {},
        {
          source: 'ModelicaDiagnostics',
          __rumocaRunId: modelProbeRunId,
        },
      )
    } finally {
      modelProbeAbort.abort()
    }
    debug.modelProbeResult = modelProbeResult
    if (
      !modelProbeResult ||
      typeof modelProbeResult !== 'object' ||
      (modelProbeResult as { ok?: boolean }).ok !== true
    ) {
      throw new Error('Model construction probe failed')
    }

    const abiCode = buildModelAbiValidationSandboxCode(rendered)
    const abiRunId = 'modelica-msl-smoke-abi'
    const abiAbort = new AbortController()
    try {
      const rawAbiResult = await executeInWorkerSandbox(
        {
          id: abiRunId,
          code: abiCode,
          sourceURL: 'modelica-msl-smoke-abi.js',
          stopSignal: abiAbort.signal,
        },
        {},
        {
          source: 'ModelicaDiagnostics',
          enforceModelAbi: true,
          __rumocaRunId: abiRunId,
        },
      )
      const abiResult = validateModelAbiValidationResultV1(rawAbiResult)
      if (abiResult.ok !== true) {
        throw new Error(abiResult.errorMessage || 'MSL smoke ABI validation failed')
      }
      debug.abiResult = {
        ok: abiResult.ok,
        skipped: abiResult.skipped,
        description: abiResult.description,
        abi: abiResult.abi,
      }
    } finally {
      abiAbort.abort()
    }

    const runId = 'modelica-msl-smoke-run'
    const runCode = await buildWorkerSandboxCodeChecked(rendered, runId)
    const runAbort = new AbortController()
    const getSeriesSampleLength = (seriesData: unknown): number => {
      if (Array.isArray(seriesData)) return seriesData.length
      if (seriesData && typeof seriesData === 'object') {
        const first = Object.values(seriesData as Record<string, unknown>)[0]
        return Array.isArray(first) ? first.length : 0
      }
      return 0
    }
    type SimResult = {
      meta?: { nSteps?: number }
      data?: { t?: unknown[]; x?: unknown[] | Record<string, unknown> }
    }
    let runResult: SimResult
    let serializedRunResult = ''
    try {
      runResult = await executeInWorkerSandbox(
        {
          id: runId,
          code: runCode,
          sourceURL: 'modelica-msl-smoke-run.js',
          stopSignal: runAbort.signal,
        },
        {
          sim: {
            t0: 0,
            tf: 0.2,
            dt: 0.01,
          },
        },
        {
          source: 'ModelicaDiagnostics',
          __rumocaRunId: runId,
        },
      )
      debug.runResultPreview = {
        meta: runResult?.meta,
        tLen: Array.isArray(runResult?.data?.t) ? runResult.data.t.length : 0,
        xLen: getSeriesSampleLength(runResult?.data?.x),
      }
      serializedRunResult = serializeObject(runResult, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
      debug.runResultSerialized = serializedRunResult
    } finally {
      runAbort.abort()
    }

    const nSteps = Number(runResult?.meta?.nSteps ?? 0)
    const tLen = Array.isArray(runResult?.data?.t) ? runResult.data.t.length : 0
    const xLen = getSeriesSampleLength(runResult?.data?.x)
    if (nSteps <= 0 || tLen <= 1 || xLen <= 1) {
      throw new Error(
        `MSL smoke run returned invalid simulation payload (nSteps=${nSteps}, tLen=${tLen}, xLen=${xLen})`,
      )
    }

    return {
      ok: true,
      mslZipPath: MSL_LOCAL_ZIP_PATH,
      mslLibraryFiles: libraryFileCount,
      parsedCount: Number(loadParsed.parsed_count ?? 0),
      skippedCount: Array.isArray(loadParsed.skipped_files) ? loadParsed.skipped_files.length : 0,
      conflictCount: Array.isArray(loadParsed.conflicts) ? loadParsed.conflicts.length : 0,
      simulation: {
        nSteps,
        tLen,
        xLen,
        serializedResult: serializedRunResult,
      },
      generatedCodeSerialized: serializeObject(rendered, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
      renderedPreview: rendered.slice(0, 120),
      prettyPreview: String(compiled.pretty ?? '').slice(0, 120),
    }
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    throw new Error([baseMessage, `MSL smoke debug:\n${debugDump}`].join('\n'), {
      cause: {
        generatedCodeSerialized: serializeObject(
          fullGeneratedCode || '[generated code unavailable]',
          MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS,
        ),
      },
    })
  }
}

export async function testModelicaCliMslFirstOrderRumocaSimulation() {
  const resolvedMslZipPath = await resolveDiagnosticsMslZipFilePath()
  const debug: Record<string, unknown> = {
    phase: 'init',
    mslZipPath: resolvedMslZipPath,
  }
  const tempDir = await mkdtemp(join(tmpdir(), 'taskyon-modelica-cli-'))
  const sourcePath = join(tempDir, 'MslFirstOrderCliSmoke.mo')

  try {
    const source = `
model MslFirstOrderCliSmoke
  Modelica.Blocks.Sources.Step step(height = 1, startTime = 0.1);
  Modelica.Blocks.Continuous.FirstOrder firstOrder(T = 0.5, k = 1);
equation
  connect(step.y, firstOrder.u);
end MslFirstOrderCliSmoke;
`.trim()
    await writeFile(sourcePath, `${source}\n`, 'utf8')
    debug.sourcePath = sourcePath
    debug.phase = 'exec-cli'

    const cliUrl = new URL('./modelica_cli.mjs', import.meta.url)
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      cliUrl.pathname,
      'simulate-model',
      '--msl-zip',
      resolvedMslZipPath,
      '--model',
      'MslFirstOrderCliSmoke',
      '--source-file',
      sourcePath,
      '--use-source-roots',
      '--t-end',
      '1',
      '--dt',
      '0.02',
      '--solver',
      'auto',
      '--json',
    ])
    debug.stderr = stderr

    const parsed = JSON.parse(stdout) as {
      simulation?: {
        simulation?: {
          payload?: {
            names?: string[]
            allData?: number[][]
            nStates?: number
          }
        }
      }
    }
    const payload = parsed.simulation?.simulation?.payload
    const names = Array.isArray(payload?.names) ? payload.names : []
    const allData = Array.isArray(payload?.allData) ? payload.allData : []
    const times = Array.isArray(allData[0]) ? allData[0] : []
    const firstOrderIndex = names.indexOf('firstOrder.y')
    const firstOrderSeries: number[] =
      firstOrderIndex >= 0 && Array.isArray(allData[firstOrderIndex + 1])
        ? (allData[firstOrderIndex + 1] as number[])
        : []

    debug.payloadPreview = {
      names: names.slice(0, 12),
      nStates: payload?.nStates,
      timeSamples: times.length,
      firstOrderSamples: firstOrderSeries.slice(0, 8),
    }

    if (times.length < 10) {
      throw new Error(`CLI simulation returned too few time samples: ${times.length}`)
    }
    if (firstOrderIndex < 0) {
      throw new Error(`CLI simulation payload missing firstOrder.y series: ${names.join(', ')}`)
    }
    if (firstOrderSeries.length !== times.length) {
      throw new Error(
        `CLI simulation firstOrder.y length mismatch: series=${firstOrderSeries.length}, times=${times.length}`,
      )
    }
    const finiteValues = firstOrderSeries.filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    )
    if (finiteValues.length !== firstOrderSeries.length) {
      throw new Error('CLI simulation firstOrder.y contains non-finite values')
    }
    const start = firstOrderSeries[0] ?? Number.NaN
    const finish = firstOrderSeries[firstOrderSeries.length - 1] ?? Number.NaN
    if (!(finish > start + 0.2)) {
      throw new Error(
        `CLI simulation firstOrder.y did not respond to the step input as expected (start=${start}, end=${finish})`,
      )
    }

    return {
      ok: true,
      model: 'MslFirstOrderCliSmoke',
      sourcePath,
      timeSamples: times.length,
      firstOrderStart: start,
      firstOrderEnd: finish,
      payloadPreview: debug.payloadPreview,
    }
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    throw new Error([baseMessage, `MSL CLI simulation debug:\n${debugDump}`].join('\n'))
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}
testModelicaCliMslFirstOrderRumocaSimulation.timeoutMs = 120_000

export async function testModelicaMslResistorManualFlattenAndBaseDae() {
  const debug: Record<string, unknown> = {
    phase: 'init',
    mslZipPath: MSL_LOCAL_ZIP_PATH,
  }

  const extendsResistorSource = `
model MslResistorFromExtends
  extends Modelica.Electrical.Analog.Examples.Resistor;
end MslResistorFromExtends;
`.trim()

  // Manual transcription of the resistor network to compare against the extends variant.
  const manualResistorSource = `
model MslResistorManualFlattened
  Modelica.Electrical.Analog.Basic.Resistor resistor(
    R = 100,
    T_ref = 293.15,
    alpha = 0.001,
    useHeatPort = true
  );
  Modelica.Electrical.Analog.Sources.SineVoltage SineVoltage1(V = 220, f = 1);
  Modelica.Electrical.Analog.Basic.Ground G;
  Modelica.Thermal.HeatTransfer.Components.ThermalConductor thermalConductor(G = 50);
  Modelica.Thermal.HeatTransfer.Sources.FixedTemperature fixedTemperature(T = 20);
equation
  connect(SineVoltage1.p, resistor.p);
  connect(SineVoltage1.n, G.p);
  connect(resistor.n, G.p);
  connect(resistor.heatPort, thermalConductor.port_a);
  connect(thermalConductor.port_b, fixedTemperature.port);
end MslResistorManualFlattened;
`.trim()

  try {
    const wasm = await getDiagnosticsWasm()
    debug.phase = 'wasm-loaded'

    if (
      typeof wasm.compile_with_source_roots !== 'function' &&
      typeof wasm.compile_with_libraries !== 'function'
    ) {
      throw new Error(
        'Rumoca wasm export missing: compile_with_source_roots / compile_with_libraries',
      )
    }
    assertTemplateRendererAvailable(wasm)

    const { libraryFileCount, loadParsed } = await ensureDiagnosticsMslLoaded(wasm, debug)
    debug.mslLibraryFiles = libraryFileCount
    debug.mslParsedCount = Number(loadParsed.parsed_count ?? 0)

    const compileAndSummarize = (source: string, modelName: string) => {
      const compiledRaw = compileWithDiagnosticsMsl(wasm, source, modelName)
      const compiled = JSON.parse(String(compiledRaw)) as {
        dae?: unknown
        dae_native?: unknown
        dae_prepared?: unknown
        pretty?: string
      }
      const dae = selectDaeForTemplate(compiled, { usePreparedDae: true })
      if (!dae) {
        throw new Error(`MSL compile returned no DAE payload for ${modelName}`)
      }

      const daeJson = JSON.stringify(dae)
      const prettyText = String(compiled.pretty ?? '')
      const prettyParsed = (() => {
        try {
          return JSON.parse(prettyText) as Record<string, unknown>
        } catch {
          return null
        }
      })()

      const mapKeys = (obj: unknown): string[] =>
        obj && typeof obj === 'object' ? Object.keys(obj as Record<string, unknown>) : []
      const xNames = mapKeys(prettyParsed?.x)
      const yNames = mapKeys(prettyParsed?.y)
      const eqs = Array.isArray(prettyParsed?.f_x)
        ? (prettyParsed?.f_x as unknown[])
        : Array.isArray(prettyParsed?.fx)
          ? (prettyParsed?.fx as unknown[])
          : []
      const condEqs = Array.isArray(prettyParsed?.f_c) ? (prettyParsed?.f_c as unknown[]) : []
      const whenClauses = Array.isArray(prettyParsed?.when_clauses)
        ? (prettyParsed?.when_clauses as unknown[])
        : []
      const collectVarRefs = (node: unknown): string[] => {
        const refs = new Set<string>()
        const walk = (value: unknown) => {
          if (!value || typeof value !== 'object') return
          if (Array.isArray(value)) {
            value.forEach(walk)
            return
          }
          const obj = value as Record<string, unknown>
          const varRef = obj.VarRef as Record<string, unknown> | undefined
          if (varRef && typeof varRef.name === 'string') {
            refs.add(varRef.name)
          }
          for (const child of Object.values(obj)) walk(child)
        }
        walk(node)
        return [...refs]
      }
      const getLhsName = (eq: unknown): string => {
        if (!eq || typeof eq !== 'object') return '0'
        const lhs = (eq as Record<string, unknown>).lhs
        if (!lhs || typeof lhs !== 'object') return '0'
        const lhsVarRef = (lhs as Record<string, unknown>).VarRef as
          | Record<string, unknown>
          | undefined
        if (lhsVarRef && typeof lhsVarRef.name === 'string') return lhsVarRef.name
        return '0'
      }
      const hasDerivative = (eq: unknown): boolean => {
        const text = serializeObject(eq, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
        return /"function"\s*:\s*"Der"|der\(/.test(text)
      }
      const equationSummaries = eqs.slice(0, 40).map((eq, idx) => {
        const eqObj = eq as Record<string, unknown>
        const lhs = getLhsName(eq)
        const rhs = eqObj.rhs
        const refs = collectVarRefs(rhs).slice(0, 12)
        const origin = typeof eqObj.origin === 'string' ? eqObj.origin : ''
        return `${idx + 1}. ${lhs} = <expr>; refs=[${refs.join(', ')}]${hasDerivative(eq) ? '; der=true' : ''}${origin ? `; origin=${origin}` : ''}`
      })

      let baseDaeRendered = ''
      let baseDaeRenderError = ''
      try {
        baseDaeRendered = renderRumocaTemplate({
          wasm,
          daeJson,
          templateSource: baseDaeTemplate,
          modelName: getTemplateModelName(dae),
          templatePath: 'base_dae.jinja',
          outputPath: 'base_dae.txt',
          targetName: 'template',
        })
      } catch (err) {
        baseDaeRenderError = err instanceof Error ? err.message : String(err)
      }
      const stateMatches = Array.from(
        new Set(
          baseDaeRendered
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => /^[A-Za-z_][A-Za-z0-9_.]*'\s*=/.test(line))
            .map((line) => line.split('=')[0]?.trim() ?? ''),
        ),
      ).filter(Boolean)
      const derMatches = Array.from(new Set(baseDaeRendered.match(/der\([^)]+\)/g) ?? []))
      const modelicaRefs = extractModelicaRefsFromText(baseDaeRendered)
      return {
        modelName,
        sourceLength: source.length,
        pretty: {
          length: prettyText.length,
          isJson: prettyParsed !== null,
          counts: {
            p: mapKeys(prettyParsed?.p).length,
            cp: mapKeys(prettyParsed?.cp ?? prettyParsed?.constants).length,
            x: xNames.length,
            y: yNames.length,
            z: mapKeys(prettyParsed?.z).length,
            f_x: eqs.length,
            f_c: condEqs.length,
            when_clauses: whenClauses.length,
          },
          xNames,
          yNames,
          equationSummaries,
          modelicaRefsCount: modelicaRefs.length,
          modelicaRefs: modelicaRefs.slice(0, 80),
        },
        baseDae: {
          renderError: baseDaeRenderError || null,
          renderedLength: baseDaeRendered.length,
          rendered: baseDaeRendered,
          hasModelHeader: baseDaeRendered.includes('Model:'),
          hasDiffEqHeader: baseDaeRendered.includes('Differential equations'),
          stateEquationCount: stateMatches.length,
          derCallCount: derMatches.length,
          stateEquationPreview: stateMatches.slice(0, 40),
          derCallPreview: derMatches.slice(0, 40),
        },
      }
    }

    debug.phase = 'compile-and-summarize'
    const extendsSummary = compileAndSummarize(extendsResistorSource, 'MslResistorFromExtends')
    const manualSummary = compileAndSummarize(manualResistorSource, 'MslResistorManualFlattened')

    const extendsX = new Set(extendsSummary.pretty.xNames)
    const manualX = new Set(manualSummary.pretty.xNames)
    const extendsY = new Set(extendsSummary.pretty.yNames)
    const manualY = new Set(manualSummary.pretty.yNames)
    const missingFromManualX = [...extendsX].filter((name) => !manualX.has(name)).slice(0, 60)
    const extraInManualX = [...manualX].filter((name) => !extendsX.has(name)).slice(0, 60)
    const missingFromManualY = [...extendsY].filter((name) => !manualY.has(name)).slice(0, 60)
    const extraInManualY = [...manualY].filter((name) => !extendsY.has(name)).slice(0, 60)

    return {
      ok: true,
      sourcesSerialized: serializeObject(
        {
          extendsSource: extendsResistorSource,
          manualSource: manualResistorSource,
        },
        MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS,
      ),
      rumoca: {
        extendsSummarySerialized: serializeObject(
          extendsSummary,
          MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS,
        ),
        manualSummarySerialized: serializeObject(
          manualSummary,
          MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS,
        ),
      },
      comparison: {
        counts: {
          extends: extendsSummary.pretty.counts,
          manual: manualSummary.pretty.counts,
        },
        delta: {
          x: manualSummary.pretty.counts.x - extendsSummary.pretty.counts.x,
          y: manualSummary.pretty.counts.y - extendsSummary.pretty.counts.y,
          f_x: manualSummary.pretty.counts.f_x - extendsSummary.pretty.counts.f_x,
          stateEq:
            manualSummary.baseDae.stateEquationCount - extendsSummary.baseDae.stateEquationCount,
          derCalls: manualSummary.baseDae.derCallCount - extendsSummary.baseDae.derCallCount,
        },
        missingFromManual: {
          x: missingFromManualX,
          y: missingFromManualY,
        },
        extraInManual: {
          x: extraInManualX,
          y: extraInManualY,
        },
      },
    }
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_EXTENDED_SERIALIZE_OPTIONS)
    throw new Error([baseMessage, `MSL manual resistor flatten debug:\n${debugDump}`].join('\n'))
  }
}

export async function testModelicaMslResistorExampleSimulation() {
  const debug: Record<string, unknown> = {
    phase: 'init',
    mslZipPath: MSL_LOCAL_ZIP_PATH,
  }
  let fullGeneratedCode = ''

  try {
    const wasm = await getDiagnosticsWasm()
    debug.phase = 'wasm-loaded'

    if (
      typeof wasm.compile_with_source_roots !== 'function' &&
      typeof wasm.compile_with_libraries !== 'function'
    ) {
      throw new Error(
        'Rumoca wasm export missing: compile_with_source_roots / compile_with_libraries',
      )
    }
    assertTemplateRendererAvailable(wasm)

    const { libraryFileCount, loadParsed } = await ensureDiagnosticsMslLoaded(wasm, debug)
    debug.mslLibraryFiles = libraryFileCount
    debug.mslParsedCount = Number(loadParsed.parsed_count ?? 0)

    // Flattened transcription of:
    // Modelica.Electrical.Analog.Examples.Resistor
    const source = `
model MslResistorExample
  extends Modelica.Electrical.Analog.Examples.Resistor;
end MslResistorExample;
`.trim()

    debug.phase = 'compile-with-libraries'
    const compiledRaw = compileWithDiagnosticsMsl(wasm, source, 'MslResistorExample')
    debug.phase = 'compiled'
    const compiled = JSON.parse(String(compiledRaw)) as {
      dae?: unknown
      dae_native?: unknown
      dae_prepared?: unknown
      pretty?: string
    }
    const dae = selectDaeForTemplate(compiled, { usePreparedDae: true })
    if (!dae) {
      throw new Error('compile_to_json returned no DAE payload for MSL resistor example')
    }
    const daeJson = JSON.stringify(dae)

    const prettyText = String(compiled.pretty ?? '')
    debug.compiledPrettyLength = prettyText.length
    debug.compiledPrettyPreview = prettyText.slice(0, 1200)

    const derivativeRefsFromPretty = Array.from(new Set(prettyText.match(/der\([^)]+\)/g) ?? []))
    let derivativeRefs = derivativeRefsFromPretty
    try {
      const baseDaeRendered = renderRumocaTemplate({
        wasm,
        daeJson,
        templateSource: baseDaeTemplate,
        modelName: getTemplateModelName(dae),
        templatePath: 'base_dae.jinja',
        outputPath: 'base_dae.txt',
        targetName: 'template',
      })
      const derivativeRefsFromTemplate: string[] = Array.from(
        new Set(String(baseDaeRendered).match(/der\([^)]+\)/g) ?? []),
      )
      if (derivativeRefsFromTemplate.length > 0) {
        derivativeRefs = derivativeRefsFromTemplate
      }
      debug.baseDaeDiagnostics = {
        renderedLength: baseDaeRendered.length,
        derivativeRefCount: derivativeRefsFromTemplate.length,
        derivativeRefsPreview: derivativeRefsFromTemplate.slice(0, 40),
        preview: baseDaeRendered.slice(0, 1200),
      }
    } catch (baseDaeErr) {
      debug.baseDaeDiagnostics = {
        rendered: false,
        renderError: baseDaeErr instanceof Error ? baseDaeErr.message : String(baseDaeErr),
        derivativeRefCountFromPretty: derivativeRefsFromPretty.length,
        derivativeRefsPreviewFromPretty: derivativeRefsFromPretty.slice(0, 40),
      }
    }

    debug.phase = 'render-javascript-template'
    const rendered = renderRumocaTemplate({
      wasm,
      daeJson,
      templateSource: javascriptTemplate,
      modelName: getTemplateModelName(dae),
      templatePath: 'javascript.jinja',
      outputPath: 'model.js',
      targetName: 'template',
    })
    if (!rendered || typeof rendered !== 'string') {
      throw new Error('Rendering javascript.jinja failed for MSL resistor example')
    }
    fullGeneratedCode = rendered
    debug.renderedPreview = rendered.slice(0, 220)
    debug.generatedCodeLength = rendered.length
    const unitAttrMatchesInPretty = Array.from(
      new Set(String(prettyText).match(/\bunit\s*=\s*"[^"]*"/g) ?? []),
    )
    const displayUnitMatchesInPretty = Array.from(
      new Set(String(prettyText).match(/\bdisplayUnit\s*=\s*"[^"]*"/g) ?? []),
    )
    const generatedUnitPropertyMatches = Array.from(
      new Set(String(rendered).match(/\bunit:\s*"[^"]*"/g) ?? []),
    )
    const generatedUnitAccessMarkers = [
      "meta.states.map((v) => ({ name: v.name, kind: 'state', start: v.start, unit: v.unit }))",
      "meta.algebraics.map((v) => ({ name: v.name, kind: 'algebraic', start: v.start, unit: v.unit }))",
      "meta.inputs.map((v) => ({ name: v.name, kind: 'input', unit: v.unit }))",
    ]
    debug.unitDiagnostics = {
      compile: {
        prettyUnitAttrCount: unitAttrMatchesInPretty.length,
        prettyDisplayUnitAttrCount: displayUnitMatchesInPretty.length,
        prettyUnitAttrPreview: unitAttrMatchesInPretty.slice(0, 30),
        prettyDisplayUnitAttrPreview: displayUnitMatchesInPretty.slice(0, 30),
      },
      template: {
        generatedUnitPropertyCount: generatedUnitPropertyMatches.length,
        generatedUnitPropertyPreview: generatedUnitPropertyMatches.slice(0, 40),
        hasGeneratedUnitAccessMarkers: generatedUnitAccessMarkers.every((marker) =>
          rendered.includes(marker),
        ),
      },
    }

    debug.phase = 'build-worker-sandbox-code'
    const runId = 'modelica-msl-resistor-example-run'
    const runCode = await buildWorkerSandboxCodeChecked(rendered, runId)
    const runAbort = new AbortController()
    type SimResult = {
      meta?: {
        nSteps?: number
        stopReason?: string
        stopError?: string
        stopStack?: string
        stopDetails?: unknown
        model?: {
          stateNames?: string[]
          algebraicNames?: string[]
          inputNames?: string[]
          conditionNames?: string[]
          stateVariables?: Array<{ name?: string; unit?: string }>
          algebraicVariables?: Array<{ name?: string; unit?: string }>
          inputVariables?: Array<{ name?: string; unit?: string }>
          conditionVariables?: Array<{ name?: string; unit?: string }>
        }
      }
      data?: {
        t?: unknown[]
        x?: unknown[] | Record<string, unknown>
        y?: unknown[] | Record<string, unknown>
      }
    }
    const getSeriesSampleLength = (seriesData: unknown): number => {
      if (Array.isArray(seriesData)) {
        if (seriesData.length === 0) return 0
        if (Array.isArray(seriesData[0])) return (seriesData[0] as unknown[]).length
        return seriesData.length
      }
      if (seriesData && typeof seriesData === 'object') {
        const first = Object.values(seriesData as Record<string, unknown>)[0]
        if (Array.isArray(first)) return first.length
      }
      return 0
    }
    const getSeriesArrays = (seriesData: unknown): number[][] => {
      const finiteArray = (arr: unknown[]): number[] =>
        arr.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
      if (Array.isArray(seriesData)) {
        if (seriesData.length > 0 && Array.isArray(seriesData[0])) {
          return (seriesData as unknown[][]).map((row) => finiteArray(row))
        }
        return [finiteArray(seriesData)]
      }
      if (seriesData && typeof seriesData === 'object') {
        return Object.values(seriesData as Record<string, unknown>).flatMap((v) =>
          Array.isArray(v) ? [finiteArray(v)] : [],
        )
      }
      return []
    }
    const mapSeriesByNames = (
      seriesData: unknown,
      names: string[],
      fallbackPrefix: string,
    ): Record<string, number[]> => {
      const out: Record<string, number[]> = {}
      const finiteArray = (arr: unknown[]): number[] =>
        arr.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))

      if (Array.isArray(seriesData)) {
        if (seriesData.length > 0 && Array.isArray(seriesData[0])) {
          const rows = seriesData as unknown[][]
          for (let i = 0; i < rows.length; i++) {
            const key = names[i] ?? `${fallbackPrefix}[${i}]`
            out[key] = finiteArray(rows[i] ?? [])
          }
        } else {
          const key = names[0] ?? `${fallbackPrefix}[0]`
          out[key] = finiteArray(seriesData)
        }
        return out
      }

      if (seriesData && typeof seriesData === 'object') {
        const obj = seriesData as Record<string, unknown>
        const availableKeys = Object.keys(obj)
        for (const name of names) {
          const alt = name.replaceAll('.', '__')
          const value = obj[name] ?? obj[alt]
          if (Array.isArray(value)) {
            out[name] = finiteArray(value)
          }
        }
        for (const key of availableKeys) {
          const value = obj[key]
          if (Array.isArray(value) && !(key in out)) {
            out[key] = finiteArray(value)
          }
        }
      }
      return out
    }
    const getSeriesAmplitude = (seriesData: unknown, skipLeadingSamples = 0): number => {
      const collect = (arr: unknown[]): number[] =>
        arr.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      let flat: number[] = []
      if (Array.isArray(seriesData)) {
        if (seriesData.length > 0 && Array.isArray(seriesData[0])) {
          flat = (seriesData as unknown[][]).flatMap((row) =>
            collect(row.slice(skipLeadingSamples)),
          )
        } else {
          flat = collect(seriesData.slice(skipLeadingSamples))
        }
      } else if (seriesData && typeof seriesData === 'object') {
        flat = Object.values(seriesData as Record<string, unknown>).flatMap((v) =>
          Array.isArray(v) ? collect(v.slice(skipLeadingSamples)) : [],
        )
      }
      if (flat.length < 2) return 0
      return Math.max(...flat) - Math.min(...flat)
    }
    const getMaxTemporalDelta = (seriesData: unknown, startIndex = 1): number => {
      const arrays = getSeriesArrays(seriesData)
      let maxDelta = 0
      for (const arr of arrays) {
        for (let i = Math.max(1, startIndex); i < arr.length; i++) {
          const prev = arr[i - 1]
          const cur = arr[i]
          if (typeof prev !== 'number' || !Number.isFinite(prev)) continue
          if (typeof cur !== 'number' || !Number.isFinite(cur)) continue
          maxDelta = Math.max(maxDelta, Math.abs(cur - prev))
        }
      }
      return maxDelta
    }
    const countActiveSeries = (seriesData: unknown, deltaThreshold = 1e-8): number => {
      const arrays = getSeriesArrays(seriesData)
      let activeCount = 0
      for (const arr of arrays) {
        let active = false
        for (let i = 2; i < arr.length; i++) {
          const prev = arr[i - 1]
          const cur = arr[i]
          if (typeof prev !== 'number' || !Number.isFinite(prev)) continue
          if (typeof cur !== 'number' || !Number.isFinite(cur)) continue
          if (Math.abs(cur - prev) > deltaThreshold) {
            active = true
            break
          }
        }
        if (active) activeCount++
      }
      return activeCount
    }
    const summarizeSeries = (
      seriesMap: Record<string, number[]>,
      maxSeries = 12,
    ): Record<
      string,
      {
        len: number
        min: number | null
        max: number | null
        first: number[]
        last: number[]
        maxDelta: number
      }
    > => {
      const summary: Record<
        string,
        {
          len: number
          min: number | null
          max: number | null
          first: number[]
          last: number[]
          maxDelta: number
        }
      > = {}
      for (const [idx, [name, arr]] of Object.entries(seriesMap).entries()) {
        if (idx >= maxSeries) break
        const finite = arr.filter((v) => typeof v === 'number' && Number.isFinite(v))
        summary[name] = {
          len: arr.length,
          min: finite.length > 0 ? Math.min(...finite) : null,
          max: finite.length > 0 ? Math.max(...finite) : null,
          first: arr.slice(0, 8),
          last: arr.slice(-8),
          maxDelta: getMaxTemporalDelta(arr, 2),
        }
      }
      return summary
    }
    const rankTemporalSeries = (seriesMap: Record<string, number[]>, maxSeries = 12) =>
      Object.entries(seriesMap)
        .map(([name, arr]) => ({
          name,
          amplitude: getSeriesAmplitude(arr, 1),
          maxDelta: getMaxTemporalDelta(arr, 2),
          first: arr.length > 0 ? arr[0] : null,
          last: arr.length > 0 ? arr[arr.length - 1] : null,
          len: arr.length,
        }))
        .sort((a, b) => b.maxDelta - a.maxDelta)
        .slice(0, maxSeries)

    let runResult: SimResult
    let serializedRunResult = ''
    try {
      debug.phase = 'execute-generated-js'
      runResult = await executeInWorkerSandbox(
        {
          id: runId,
          code: runCode,
          sourceURL: 'modelica-msl-resistor-example-run.js',
          stopSignal: runAbort.signal,
        },
        {
          sim: {
            t0: 0,
            tf: 0.25,
            dt: 0.001,
          },
        },
        {
          source: 'ModelicaDiagnostics',
          __rumocaRunId: runId,
        },
      )
      debug.runResultPreview = {
        meta: runResult?.meta,
        tLen: Array.isArray(runResult?.data?.t) ? runResult.data.t.length : 0,
        xLen: getSeriesSampleLength(runResult?.data?.x),
        yLen: getSeriesSampleLength(runResult?.data?.y),
      }
      serializedRunResult = serializeObject(runResult, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    } finally {
      runAbort.abort()
    }

    debug.phase = 'validate-simulation-payload'
    const nSteps = Number(runResult?.meta?.nSteps ?? 0)
    const tLen = Array.isArray(runResult?.data?.t) ? runResult.data.t.length : 0
    const xLen = getSeriesSampleLength(runResult?.data?.x)
    const yLen = getSeriesSampleLength(runResult?.data?.y)
    if (nSteps <= 0 || tLen <= 1 || (xLen <= 1 && yLen <= 1)) {
      const stopReason = String(runResult?.meta?.stopReason ?? '')
      const stopError = String(runResult?.meta?.stopError ?? '')
      const stopDetails = runResult?.meta?.stopDetails
      throw new Error(
        [
          `MSL resistor example run returned invalid simulation payload (nSteps=${nSteps}, tLen=${tLen}, xLen=${xLen}, yLen=${yLen})`,
          stopReason ? `simulation.stopReason=${stopReason}` : '',
          stopError ? `simulation.stopError=${stopError}` : '',
          stopDetails
            ? `simulation.stopDetails=${serializeObject(stopDetails, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      )
    }

    const stateNames = Array.isArray(runResult?.meta?.model?.stateNames)
      ? runResult.meta.model.stateNames
      : []
    const algebraicNames = Array.isArray(runResult?.meta?.model?.algebraicNames)
      ? runResult.meta.model.algebraicNames
      : []
    const inputNames = Array.isArray(runResult?.meta?.model?.inputNames)
      ? runResult.meta.model.inputNames
      : []
    const conditionNames = Array.isArray(runResult?.meta?.model?.conditionNames)
      ? runResult.meta.model.conditionNames
      : []
    const stateCount = stateNames.length
    const algebraicCount = algebraicNames.length

    const mapUnits = (
      vars: unknown,
      expectedNames: string[],
    ): { unitByName: Record<string, string>; withUnitCount: number; totalCount: number } => {
      const out: Record<string, string> = {}
      const list = Array.isArray(vars) ? vars : []
      for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue
        const item = entry as Record<string, unknown>
        const name = typeof item.name === 'string' ? item.name.trim() : ''
        const unit = typeof item.unit === 'string' ? item.unit.trim() : ''
        const u = unit.toLowerCase()
        if (!name || !unit || u === 'none' || u === 'null') continue
        out[name] = unit
      }
      const withUnitCount = expectedNames.filter((name) => typeof out[name] === 'string').length
      return {
        unitByName: out,
        withUnitCount,
        totalCount: expectedNames.length,
      }
    }

    const stateUnitInfo = mapUnits(runResult?.meta?.model?.stateVariables, stateNames)
    const algebraicUnitInfo = mapUnits(runResult?.meta?.model?.algebraicVariables, algebraicNames)
    const inputUnitInfo = mapUnits(runResult?.meta?.model?.inputVariables, inputNames)
    const conditionUnitInfo = mapUnits(runResult?.meta?.model?.conditionVariables, conditionNames)
    const totalPhysicalUnitCount =
      stateUnitInfo.withUnitCount +
      algebraicUnitInfo.withUnitCount +
      inputUnitInfo.withUnitCount +
      conditionUnitInfo.withUnitCount
    const plotPathUnitsPreview = {
      t: 's',
      ...Object.fromEntries(
        Object.entries(stateUnitInfo.unitByName)
          .slice(0, 20)
          .map(([name, unit]) => [`x.${name}`, unit]),
      ),
      ...Object.fromEntries(
        Object.entries(algebraicUnitInfo.unitByName)
          .slice(0, 20)
          .map(([name, unit]) => [`y.${name}`, unit]),
      ),
      ...Object.fromEntries(
        Object.entries(inputUnitInfo.unitByName)
          .slice(0, 20)
          .map(([name, unit]) => [`u.${name}`, unit]),
      ),
      ...Object.fromEntries(
        Object.entries(conditionUnitInfo.unitByName)
          .slice(0, 20)
          .map(([name, unit]) => [`z.${name}`, unit]),
      ),
    }

    debug.unitDiagnostics = {
      ...(debug.unitDiagnostics && typeof debug.unitDiagnostics === 'object'
        ? (debug.unitDiagnostics as Record<string, unknown>)
        : {}),
      runtime: {
        stateUnits: {
          withUnitCount: stateUnitInfo.withUnitCount,
          totalCount: stateUnitInfo.totalCount,
          preview: Object.fromEntries(Object.entries(stateUnitInfo.unitByName).slice(0, 25)),
        },
        algebraicUnits: {
          withUnitCount: algebraicUnitInfo.withUnitCount,
          totalCount: algebraicUnitInfo.totalCount,
          preview: Object.fromEntries(Object.entries(algebraicUnitInfo.unitByName).slice(0, 25)),
        },
        inputUnits: {
          withUnitCount: inputUnitInfo.withUnitCount,
          totalCount: inputUnitInfo.totalCount,
          preview: Object.fromEntries(Object.entries(inputUnitInfo.unitByName).slice(0, 25)),
        },
        conditionUnits: {
          withUnitCount: conditionUnitInfo.withUnitCount,
          totalCount: conditionUnitInfo.totalCount,
          preview: Object.fromEntries(Object.entries(conditionUnitInfo.unitByName).slice(0, 25)),
        },
        plotPathUnitsPreview,
        totalPhysicalUnitCount,
      },
    }

    const compileUnitAttrCount =
      ((debug.unitDiagnostics as { compile?: { prettyUnitAttrCount?: number } })?.compile
        ?.prettyUnitAttrCount ??
        0) ||
      0
    const templateUnitPropCount =
      ((debug.unitDiagnostics as { template?: { generatedUnitPropertyCount?: number } })?.template
        ?.generatedUnitPropertyCount ??
        0) ||
      0
    if (totalPhysicalUnitCount <= 0) {
      throw new Error(
        [
          'MSL resistor example has no physical units in runtime metadata',
          `totalPhysicalUnitCount=${totalPhysicalUnitCount}`,
          `compile.prettyUnitAttrCount=${compileUnitAttrCount}`,
          `template.generatedUnitPropertyCount=${templateUnitPropCount}`,
        ].join('\n'),
      )
    }

    const xSeriesByName = mapSeriesByNames(runResult?.data?.x, stateNames, 'x')
    const ySeriesByName = mapSeriesByNames(runResult?.data?.y, algebraicNames, 'y')
    const topTemporalStates = rankTemporalSeries(xSeriesByName, 12)
    const topTemporalAlgebraics = rankTemporalSeries(ySeriesByName, 12)
    debug.seriesDiagnostics = {
      stateCount,
      algebraicCount,
      stateNames,
      algebraicNamesPreview: algebraicNames.slice(0, 40),
      stateSeriesSummary: summarizeSeries(xSeriesByName, 20),
      algebraicSeriesSummary: summarizeSeries(ySeriesByName, 20),
      topTemporalStates,
      topTemporalAlgebraics,
      stateSeriesValues: xSeriesByName,
    }

    const xAmp = getSeriesAmplitude(runResult?.data?.x, 1)
    const yAmp = getSeriesAmplitude(runResult?.data?.y, 1)
    const xTemporal = getMaxTemporalDelta(runResult?.data?.x, 2)
    const yTemporal = getMaxTemporalDelta(runResult?.data?.y, 2)
    const xActive = countActiveSeries(runResult?.data?.x)
    const yActive = countActiveSeries(runResult?.data?.y)
    debug.runSignalStats = { xAmp, yAmp, xTemporal, yTemporal, xActive, yActive }

    if (stateCount === 0) {
      const algebraicDynamicsDetected =
        yLen > 1 && yActive > 0 && Math.max(yAmp, yTemporal) > 1.0e-6
      if (!algebraicDynamicsDetected) {
        throw new Error(
          [
            'MSL resistor example produced zero states and no convincing algebraic dynamics',
            `stateCount=${stateCount}`,
            `algebraicCount=${algebraicCount}`,
            `xLen=${xLen}`,
            `yLen=${yLen}`,
            `xAmp=${xAmp}`,
            `yAmp=${yAmp}`,
            `xTemporal=${xTemporal}`,
            `yTemporal=${yTemporal}`,
            `xActive=${xActive}`,
            `yActive=${yActive}`,
            `baseDae.derivativeRefCount=${derivativeRefs.length}`,
            `baseDae.derivativeRefsPreview=${serializeObject(derivativeRefs.slice(0, 20), MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
          ].join('\n'),
        )
      }
    }

    if (Math.max(xAmp, yAmp) <= 1.0e-6) {
      throw new Error(
        [
          'MSL resistor example run has near-zero signal amplitude',
          `xAmp=${xAmp}`,
          `yAmp=${yAmp}`,
          `xTemporal=${xTemporal}`,
          `yTemporal=${yTemporal}`,
          `xActive=${xActive}`,
          `yActive=${yActive}`,
        ].join(', '),
      )
    }

    if (stateCount > 0 && Math.max(xTemporal, yTemporal) <= 1.0e-10) {
      throw new Error(
        [
          'MSL resistor example appears static after initialization; expected dynamic evolution for stateful model',
          `stateCount=${stateCount}`,
          `algebraicCount=${algebraicCount}`,
          `xAmp=${xAmp}`,
          `yAmp=${yAmp}`,
          `xTemporal=${xTemporal}`,
          `yTemporal=${yTemporal}`,
          `xActive=${xActive}`,
          `yActive=${yActive}`,
        ].join(', '),
      )
    }

    return {
      ok: true,
      simulation: {
        nSteps,
        tLen,
        xLen,
        yLen,
        stateCount,
        algebraicCount,
        stateNames,
        algebraicNames,
        stateSeriesValuesSerialized: serializeObject(
          xSeriesByName,
          MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS,
        ),
        xAmplitude: xAmp,
        yAmplitude: yAmp,
        unitsAvailable: totalPhysicalUnitCount > 0,
        unitDiagnosticsSerialized: serializeObject(
          debug.unitDiagnostics,
          MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS,
        ),
        serializedResult: serializedRunResult,
      },
      generatedCode: rendered,
      generatedCodeSerialized: serializeObject(rendered, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
      prettyPreview: String(compiled.pretty ?? '').slice(0, 120),
    }
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    const phaseValue = debug.phase
    const phaseLabel =
      typeof phaseValue === 'string' ||
      typeof phaseValue === 'number' ||
      typeof phaseValue === 'boolean'
        ? String(phaseValue)
        : phaseValue == null
          ? 'unknown'
          : JSON.stringify(phaseValue)
    throw new Error(
      [
        `Modelica diagnostic failed at phase="${phaseLabel}"`,
        baseMessage,
        `MSL resistor example debug (compact):\n${debugDump}`,
      ].join('\n'),
      {
        cause: {
          generatedCode: fullGeneratedCode || '[generated code unavailable]',
          debugSerialized: serializeObject(debug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
        },
      },
    )
  }
}

const ORBIT_MODEL_SOURCE = `
model SatelliteOrbit2D
  parameter Real mu = 398600.4418;
  parameter Real r0 = 7000;
  parameter Real v0 = sqrt(mu / r0);
  Real rx(start = r0, fixed = true);
  Real ry(start = 0, fixed = true);
  Real vx(start = 0, fixed = true);
  Real vy(start = v0, fixed = true);
  Real inv_r;
  Real inv_v2;
  Real inv_h;
  Real inv_energy;
  Real inv_a;
  Real inv_rv;
  Real inv_ex;
  Real inv_ey;
  Real inv_ecc;
equation
  der(rx) = vx;
  der(ry) = vy;
  inv_r = sqrt(rx * rx + ry * ry);
  inv_v2 = vx * vx + vy * vy;
  inv_h = rx * vy - ry * vx;
  inv_energy = 0.5 * inv_v2 - mu / inv_r;
  inv_a = 1 / (2 / inv_r - inv_v2 / mu);
  inv_rv = rx * vx + ry * vy;
  inv_ex = ((inv_v2 - mu / inv_r) * rx - inv_rv * vx) / mu;
  inv_ey = ((inv_v2 - mu / inv_r) * ry - inv_rv * vy) / mu;
  inv_ecc = sqrt(inv_ex * inv_ex + inv_ey * inv_ey);
  der(vx) = -mu * rx / (inv_r ^ 3);
  der(vy) = -mu * ry / (inv_r ^ 3);
end SatelliteOrbit2D;
`.trim()

type OrbitSolverRun = {
  meta?: {
    stopReason?: string
    stopError?: string
    stopDetails?: unknown
    model?: {
      stateNames?: string[]
      algebraicNames?: string[]
    }
  }
  data?: {
    t?: unknown[]
    x?: Record<string, unknown> | unknown[]
    y?: Record<string, unknown> | unknown[]
  }
}

type OrbitSamples = {
  t: number[]
  rx: number[]
  ry: number[]
  vx: number[]
  vy: number[]
  r: number[]
  semiMajorAxis: number[]
  eccentricity: number[]
  specificEnergy: number[]
  angularMomentum: number[]
}

type OrbitExtractionDebug = {
  label: string
  timeLength: number
  stateLengths: Record<string, number>
  yLengths: Record<string, number>
  yFiniteCounts: Record<string, number>
  yFirstFiniteValues: Record<string, number[]>
  modelAlgebraicNames: string[]
}

type OrbitTestMode = 'compare' | 'sdirk-only'

function orbitSeriesStats(values: number[]) {
  let finiteCount = 0
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (!Number.isFinite(value)) continue
    finiteCount += 1
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  return {
    finiteCount,
    min: finiteCount > 0 ? min : null,
    max: finiteCount > 0 ? max : null,
    firstValues: values
      .filter((v) => Number.isFinite(v))
      .slice(0, 6)
      .map((v) => Number(v.toPrecision(8))),
    lastValues: values
      .filter((v) => Number.isFinite(v))
      .slice(-6)
      .map((v) => Number(v.toPrecision(8))),
  }
}

function summarizeGeneratedCodeForDebug(rendered: string) {
  const maxSnippetChars = 1200
  const lineCount = rendered.split('\n').length
  const head = rendered.slice(0, maxSnippetChars)
  const tail = rendered.length > maxSnippetChars ? rendered.slice(-maxSnippetChars) : ''
  let checksum = 0
  for (let i = 0; i < rendered.length; i++) {
    checksum = (checksum + rendered.charCodeAt(i) * (i + 1)) % 1000000007
  }
  return {
    length: rendered.length,
    lineCount,
    checksum,
    head,
    tail,
  }
}

function summarizeDaeForOrbitDebug(dae: unknown) {
  const daeRecord = dae && typeof dae === 'object' ? (dae as Record<string, unknown>) : {}
  const fxRaw = daeRecord.f_x
  const fx = Array.isArray(fxRaw) ? fxRaw : []
  const eqPreview = fx.slice(0, 6).map((entry, index) => {
    const row = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {}
    const rhsValue = row.rhs
    const rhsPreview =
      typeof rhsValue === 'string'
        ? rhsValue.slice(0, 220)
        : serializeObject(rhsValue, {
            format: 'json',
            maxDepth: 3,
            maxArrayLength: 8,
            maxObjectKeys: 8,
            maxStringLength: 220,
            indent: 0,
          })
    return {
      index,
      origin: row.origin ?? null,
      lhs: row.lhs ?? null,
      rhsPreview,
    }
  })
  const stateBag =
    (daeRecord.states as Record<string, unknown> | undefined) ??
    (daeRecord.x as Record<string, unknown> | undefined) ??
    {}
  const algebraicBag =
    (daeRecord.algebraics as Record<string, unknown> | undefined) ??
    (daeRecord.y as Record<string, unknown> | undefined) ??
    {}
  const stateKeys = Object.keys(stateBag || {})
  const algebraicKeys = Object.keys(algebraicBag || {})
  return {
    stateCount: stateKeys.length,
    algebraicCount: algebraicKeys.length,
    equationCount: fx.length,
    stateNamesPreview: stateKeys.slice(0, 12),
    algebraicNamesPreview: algebraicKeys.slice(0, 20),
    equationPreview: eqPreview,
  }
}

function makeOrbitFailure(
  headline: string,
  debugSummary: Record<string, unknown>,
  generatedCodeDebug: Record<string, unknown>,
  fullGeneratedCode: string,
): Error {
  return new Error(
    [
      headline,
      `Orbit debug summary:\n${serializeObject(debugSummary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
      `Generated code (compact):\n${serializeObject(generatedCodeDebug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
      `Generated code (full):\n${serializeObject(fullGeneratedCode, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
    ].join('\n\n'),
  )
}

async function runModelicaOrbitInvariantTest(mode: OrbitTestMode) {
  const source = ORBIT_MODEL_SOURCE

  const wasm = await getDiagnosticsWasm()
  if (typeof wasm.compile_to_json !== 'function') {
    throw new Error('Rumoca wasm export missing: compile_to_json')
  }
  assertTemplateRendererAvailable(wasm)

  const compiled = wasm.compile_to_json(source, 'SatelliteOrbit2D')
  const parsed = JSON.parse(compiled) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) {
    throw new Error('Rumoca compile_to_json returned no DAE payload for SatelliteOrbit2D')
  }

  const rendered = renderDiagnosticsTemplate(
    wasm,
    dae,
    javascriptTemplate,
    'javascript.jinja',
    'model.js',
  )
  if (!rendered || typeof rendered !== 'string') {
    throw new Error('Rendering javascript.jinja failed for SatelliteOrbit2D')
  }
  const generatedCodeDebug = summarizeGeneratedCodeForDebug(rendered)

  const runCode = await buildWorkerSandboxCodeChecked(
    rendered,
    'modelica-satellite-orbit-2d-runtime',
  )
  const mu = 398600.4418
  const r0 = 7000
  const v0 = Math.sqrt(mu / r0)
  const expectedX0 = [r0, 0, 0, v0]
  const orbitalPeriod = 2 * Math.PI * Math.sqrt((7000 * 7000 * 7000) / mu)
  const simParams = {
    t0: 0,
    tf: orbitalPeriod,
    dt: 20,
    x0: expectedX0,
  }
  const countVarMapEntries = (daeObj: unknown, key: string): number => {
    if (!daeObj || typeof daeObj !== 'object' || Array.isArray(daeObj)) return 0
    const map = (daeObj as Record<string, unknown>)[key]
    if (!map || typeof map !== 'object' || Array.isArray(map)) return 0
    return Object.keys(map as Record<string, unknown>).length
  }
  const countObservables = (daeObj: unknown): number => {
    if (!daeObj || typeof daeObj !== 'object' || Array.isArray(daeObj)) return 0
    const obj = daeObj as Record<string, unknown>
    const list = obj.__rumoca_observables
    return Array.isArray(list) ? list.length : 0
  }
  const nativeDae = parsed.dae_native ?? parsed.dae
  const preparedDae = parsed.dae_prepared
  const selectionInfo = {
    selected: dae === preparedDae ? 'prepared' : dae === nativeDae ? 'native' : 'unknown',
    native: {
      xCount: countVarMapEntries(nativeDae, 'x'),
      yCount: countVarMapEntries(nativeDae, 'y'),
      fxCount: Array.isArray((nativeDae as Record<string, unknown> | undefined)?.f_x)
        ? (((nativeDae as Record<string, unknown>).f_x as unknown[])?.length ?? 0)
        : 0,
      observablesCount: countObservables(nativeDae),
    },
    prepared: {
      xCount: countVarMapEntries(preparedDae, 'x'),
      yCount: countVarMapEntries(preparedDae, 'y'),
      fxCount: Array.isArray((preparedDae as Record<string, unknown> | undefined)?.f_x)
        ? (((preparedDae as Record<string, unknown>).f_x as unknown[])?.length ?? 0)
        : 0,
      observablesCount: countObservables(preparedDae),
    },
  }
  const daeDebug = summarizeDaeForOrbitDebug(dae)

  const runSimulation = async (
    runId: string,
    solverOptions?: Record<string, unknown>,
  ): Promise<OrbitSolverRun> => {
    const abort = new AbortController()
    try {
      return await executeInWorkerSandbox(
        {
          id: runId,
          code: runCode,
          sourceURL: `${runId}.js`,
          stopSignal: abort.signal,
        },
        {
          sim: {
            ...simParams,
            solverOptions: {
              captureFailureState: true,
              ...(solverOptions || {}),
            },
          },
        },
        {
          source: 'ModelicaDiagnostics',
          __rumocaRunId: runId,
        },
      )
    } finally {
      abort.abort()
    }
  }

  const getSeries = (run: OrbitSolverRun, name: string): number[] => {
    const x = run?.data?.x
    if (!x || typeof x !== 'object' || Array.isArray(x)) return []
    const byName = x[name]
    if (Array.isArray(byName)) {
      return byName.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
    }
    const alt = name.replaceAll('.', '__')
    const byAlt = x[alt]
    if (Array.isArray(byAlt)) {
      return byAlt.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
    }
    return []
  }

  const getYSeries = (run: OrbitSolverRun, name: string): number[] => {
    const y = run?.data?.y
    if (!y || typeof y !== 'object' || Array.isArray(y)) return []
    const byName = y[name]
    if (Array.isArray(byName)) {
      return byName.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
    }
    const alt = name.replaceAll('.', '__')
    const byAlt = y[alt]
    if (Array.isArray(byAlt)) {
      return byAlt.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
    }
    return []
  }

  const getTime = (run: OrbitSolverRun): number[] => {
    const tRaw = run?.data?.t
    if (!Array.isArray(tRaw)) return []
    return tRaw.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
  }

  const summarizeFiniteSeries = (values: number[]) => {
    const finite = values.filter((v) => Number.isFinite(v))
    return {
      finiteCount: finite.length,
      firstFiniteValues: finite.slice(0, 6).map((v) => Number(v.toPrecision(8))),
    }
  }

  const collectOrbitExtractionDebug = (
    label: string,
    run: OrbitSolverRun,
  ): OrbitExtractionDebug => {
    const invR = getYSeries(run, 'inv_r')
    const invA = getYSeries(run, 'inv_a')
    const invE = getYSeries(run, 'inv_ecc')
    const invEnergy = getYSeries(run, 'inv_energy')
    const invH = getYSeries(run, 'inv_h')
    const algebraicNames =
      run?.meta?.model?.algebraicNames && Array.isArray(run.meta.model.algebraicNames)
        ? run.meta.model.algebraicNames.filter((n): n is string => typeof n === 'string')
        : []
    return {
      label,
      timeLength: getTime(run).length,
      stateLengths: {
        rx: getSeries(run, 'rx').length,
        ry: getSeries(run, 'ry').length,
        vx: getSeries(run, 'vx').length,
        vy: getSeries(run, 'vy').length,
      },
      yLengths: {
        inv_r: invR.length,
        inv_a: invA.length,
        inv_ecc: invE.length,
        inv_energy: invEnergy.length,
        inv_h: invH.length,
      },
      yFiniteCounts: {
        inv_r: summarizeFiniteSeries(invR).finiteCount,
        inv_a: summarizeFiniteSeries(invA).finiteCount,
        inv_ecc: summarizeFiniteSeries(invE).finiteCount,
        inv_energy: summarizeFiniteSeries(invEnergy).finiteCount,
        inv_h: summarizeFiniteSeries(invH).finiteCount,
      },
      yFirstFiniteValues: {
        inv_r: summarizeFiniteSeries(invR).firstFiniteValues,
        inv_a: summarizeFiniteSeries(invA).firstFiniteValues,
        inv_ecc: summarizeFiniteSeries(invE).firstFiniteValues,
        inv_energy: summarizeFiniteSeries(invEnergy).firstFiniteValues,
        inv_h: summarizeFiniteSeries(invH).firstFiniteValues,
      },
      modelAlgebraicNames: algebraicNames,
    }
  }

  const collectOrbitSamples = (run: OrbitSolverRun): OrbitSamples => {
    const t = getTime(run)
    const rx = getSeries(run, 'rx')
    const ry = getSeries(run, 'ry')
    const vx = getSeries(run, 'vx')
    const vy = getSeries(run, 'vy')
    const invRModel = getYSeries(run, 'inv_r')
    const invAModel = getYSeries(run, 'inv_a')
    const invEModel = getYSeries(run, 'inv_ecc')
    const invEnergyModel = getYSeries(run, 'inv_energy')
    const invHModel = getYSeries(run, 'inv_h')
    const n = Math.min(
      t.length,
      rx.length,
      ry.length,
      vx.length,
      vy.length,
      invRModel.length,
      invAModel.length,
      invEModel.length,
      invEnergyModel.length,
      invHModel.length,
    )

    const tt: number[] = []
    const rr: number[] = []
    const rrx: number[] = []
    const rry: number[] = []
    const vvx: number[] = []
    const vvy: number[] = []
    const semiMajorAxis: number[] = []
    const eccentricity: number[] = []
    const specificEnergy: number[] = []
    const angularMomentum: number[] = []

    for (let i = 0; i < n; i++) {
      const x = rx[i] ?? Number.NaN
      const y = ry[i] ?? Number.NaN
      const vxi = vx[i] ?? Number.NaN
      const vyi = vy[i] ?? Number.NaN
      const ti = t[i] ?? Number.NaN
      const rModel = invRModel[i] ?? Number.NaN
      const aModel = invAModel[i] ?? Number.NaN
      const eModel = invEModel[i] ?? Number.NaN
      const enModel = invEnergyModel[i] ?? Number.NaN
      const hModel = invHModel[i] ?? Number.NaN
      if (![ti, x, y, vxi, vyi, rModel, aModel, eModel, enModel, hModel].every(Number.isFinite)) {
        continue
      }

      tt.push(ti)
      rrx.push(x)
      rry.push(y)
      vvx.push(vxi)
      vvy.push(vyi)
      rr.push(rModel)
      semiMajorAxis.push(aModel)
      eccentricity.push(eModel)
      specificEnergy.push(enModel)
      angularMomentum.push(hModel)
    }

    return {
      t: tt,
      rx: rrx,
      ry: rry,
      vx: vvx,
      vy: vvy,
      r: rr,
      semiMajorAxis,
      eccentricity,
      specificEnergy,
      angularMomentum,
    }
  }

  const collectInvariants = (samples: OrbitSamples) => {
    if (
      samples.semiMajorAxis.length < 4 ||
      samples.eccentricity.length < 4 ||
      samples.specificEnergy.length < 4 ||
      samples.angularMomentum.length < 4
    ) {
      throw new Error('Orbit invariants contain too few finite values')
    }

    const summarizeDrift = (values: number[]) => {
      const ref = values[0] ?? 0
      let maxAbsSeries = 0
      for (const v of values) maxAbsSeries = Math.max(maxAbsSeries, Math.abs(v))
      const baselineFloor = 1e-12
      const relativeScale =
        Math.abs(ref) > baselineFloor ? Math.abs(ref) : Math.max(1e-9, maxAbsSeries)
      let maxAbsDrift = 0
      for (const v of values) {
        maxAbsDrift = Math.max(maxAbsDrift, Math.abs(v - ref))
      }
      return {
        maxAbsoluteDrift: maxAbsDrift,
        maxNormalizedDrift: maxAbsDrift / relativeScale,
      }
    }

    const aDrift = summarizeDrift(samples.semiMajorAxis)
    const eDrift = summarizeDrift(samples.eccentricity)
    const enDrift = summarizeDrift(samples.specificEnergy)
    const hDrift = summarizeDrift(samples.angularMomentum)

    return {
      sampleCount: samples.semiMajorAxis.length,
      semiMajorAxis: {
        first: samples.semiMajorAxis[0],
        last: samples.semiMajorAxis[samples.semiMajorAxis.length - 1],
        maxRelativeDrift: aDrift.maxNormalizedDrift,
        maxAbsoluteDrift: aDrift.maxAbsoluteDrift,
      },
      eccentricity: {
        first: samples.eccentricity[0],
        last: samples.eccentricity[samples.eccentricity.length - 1],
        maxRelativeDrift: eDrift.maxNormalizedDrift,
        maxAbsoluteDrift: eDrift.maxAbsoluteDrift,
      },
      specificEnergy: {
        first: samples.specificEnergy[0],
        last: samples.specificEnergy[samples.specificEnergy.length - 1],
        maxRelativeDrift: enDrift.maxNormalizedDrift,
        maxAbsoluteDrift: enDrift.maxAbsoluteDrift,
      },
      angularMomentum: {
        first: samples.angularMomentum[0],
        last: samples.angularMomentum[samples.angularMomentum.length - 1],
        maxRelativeDrift: hDrift.maxNormalizedDrift,
        maxAbsoluteDrift: hDrift.maxAbsoluteDrift,
      },
    }
  }

  const safeLast = (arr: number[]) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      const v = arr[i]
      if (typeof v === 'number' && Number.isFinite(v)) return v
    }
    return null
  }

  const getRawFirstStateValues = (run: OrbitSolverRun, names: string[]) => {
    const out: Record<string, number | null> = {}
    for (const n of names) {
      const s = getSeries(run, n)
      const first = s.length > 0 ? (s[0] ?? Number.NaN) : Number.NaN
      out[n] = Number.isFinite(first) ? first : null
    }
    return out
  }

  const runSummary = (label: string, run: OrbitSolverRun, samples: OrbitSamples) => {
    const rMin = samples.r.length > 0 ? Math.min(...samples.r) : null
    const rMax = samples.r.length > 0 ? Math.max(...samples.r) : null
    const stateNames = run?.meta?.model?.stateNames ?? []
    return {
      label,
      stopReason: run?.meta?.stopReason ?? null,
      stopError: run?.meta?.stopError ?? null,
      stopDetails: run?.meta?.stopDetails ?? null,
      sampleCount: samples.t.length,
      tLast: safeLast(samples.t),
      rxLast: safeLast(samples.rx),
      ryLast: safeLast(samples.ry),
      vxLast: safeLast(samples.vx),
      vyLast: safeLast(samples.vy),
      rMin,
      rMax,
      stateNames,
      firstStateValues: getRawFirstStateValues(run, stateNames),
    }
  }

  const runNumericDiagnostics = (label: string, run: OrbitSolverRun, samples: OrbitSamples) => {
    const t = getTime(run)
    let firstNonFiniteTimeIndex: number | null = null
    for (let i = 0; i < t.length; i++) {
      if (!Number.isFinite(t[i] ?? Number.NaN)) {
        firstNonFiniteTimeIndex = i
        break
      }
    }
    return {
      label,
      tStats: orbitSeriesStats(samples.t),
      rxStats: orbitSeriesStats(samples.rx),
      ryStats: orbitSeriesStats(samples.ry),
      vxStats: orbitSeriesStats(samples.vx),
      vyStats: orbitSeriesStats(samples.vy),
      rStats: orbitSeriesStats(samples.r),
      firstNonFiniteTimeIndex,
      stopReason: run?.meta?.stopReason ?? null,
      stopError: run?.meta?.stopError ?? null,
    }
  }

  const renderDebugCanvas = (
    current: OrbitSamples,
    irk4: OrbitSamples,
    debugSummary: Record<string, unknown>,
  ) => {
    if (typeof document === 'undefined') return

    const old = document.getElementById('modelica-orbit-debug-panel')
    if (old && old.parentNode) old.parentNode.removeChild(old)

    const panel = document.createElement('div')
    panel.id = 'modelica-orbit-debug-panel'
    panel.style.marginTop = '16px'
    panel.style.padding = '12px'
    panel.style.border = '1px solid #bbb'
    panel.style.background = '#fff'

    const title = document.createElement('div')
    title.textContent = 'Modelica Orbit Debug Plot'
    title.style.fontWeight = '700'
    title.style.marginBottom = '8px'
    panel.appendChild(title)

    const canvas = document.createElement('canvas')
    canvas.width = 1100
    canvas.height = 560
    canvas.style.width = '100%'
    canvas.style.maxWidth = '1100px'
    canvas.style.border = '1px solid #ddd'
    panel.appendChild(canvas)

    const pre = document.createElement('pre')
    pre.style.marginTop = '8px'
    pre.style.whiteSpace = 'pre-wrap'
    pre.textContent = serializeObject(debugSummary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    panel.appendChild(pre)

    const host = document.querySelector('.q-page') || document.body
    host.appendChild(panel)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const drawSeries = (
      left: number,
      top: number,
      width: number,
      height: number,
      xVals: number[],
      yValsA: number[],
      yValsB: number[],
      titleText: string,
      colorA: string,
      colorB: string,
    ) => {
      const n = Math.min(xVals.length, yValsA.length, yValsB.length)
      if (n < 1) {
        ctx.strokeStyle = '#999'
        ctx.strokeRect(left, top, width, height)
        ctx.fillStyle = '#444'
        ctx.fillText(`${titleText} (not enough data)`, left + 8, top + 16)
        return
      }
      let xMin = Infinity
      let xMax = -Infinity
      let yMin = Infinity
      let yMax = -Infinity
      for (let i = 0; i < n; i++) {
        const xv = xVals[i] ?? Number.NaN
        const ya = yValsA[i] ?? Number.NaN
        const yb = yValsB[i] ?? Number.NaN
        if (!Number.isFinite(xv) || !Number.isFinite(ya) || !Number.isFinite(yb)) continue
        xMin = Math.min(xMin, xv)
        xMax = Math.max(xMax, xv)
        yMin = Math.min(yMin, ya, yb)
        yMax = Math.max(yMax, ya, yb)
      }
      if (
        !Number.isFinite(xMin) ||
        !Number.isFinite(xMax) ||
        !Number.isFinite(yMin) ||
        !Number.isFinite(yMax)
      ) {
        return
      }
      if (Math.abs(xMax - xMin) < 1e-12) xMax = xMin + 1
      if (Math.abs(yMax - yMin) < 1e-12) yMax = yMin + 1

      ctx.strokeStyle = '#999'
      ctx.strokeRect(left, top, width, height)
      ctx.fillStyle = '#222'
      ctx.font = '12px sans-serif'
      ctx.fillText(titleText, left + 8, top + 16)

      const plot = (yy: number[], color: string) => {
        ctx.beginPath()
        let started = false
        for (let i = 0; i < n; i++) {
          const xv = xVals[i] ?? Number.NaN
          const yv = yy[i] ?? Number.NaN
          if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue
          const px = left + ((xv - xMin) / (xMax - xMin)) * (width - 20) + 10
          const py = top + height - (((yv - yMin) / (yMax - yMin)) * (height - 26) + 10)
          if (!started) {
            ctx.moveTo(px, py)
            started = true
          } else {
            ctx.lineTo(px, py)
          }
        }
        ctx.strokeStyle = color
        ctx.lineWidth = 1.4
        ctx.stroke()
      }
      plot(yValsA, colorA)
      plot(yValsB, colorB)
    }

    const drawOrbit = (
      left: number,
      top: number,
      width: number,
      height: number,
      a: OrbitSamples,
      b: OrbitSamples,
    ) => {
      const n = Math.min(a.rx.length, a.ry.length, b.rx.length, b.ry.length)
      ctx.strokeStyle = '#999'
      ctx.strokeRect(left, top, width, height)
      ctx.fillStyle = '#222'
      ctx.font = '12px sans-serif'
      ctx.fillText('Orbit in x-y plane', left + 8, top + 16)
      if (n < 1) return

      let xMin = Infinity
      let xMax = -Infinity
      let yMin = Infinity
      let yMax = -Infinity
      for (let i = 0; i < n; i++) {
        const xs = [a.rx[i], b.rx[i]]
        const ys = [a.ry[i], b.ry[i]]
        for (const xv of xs) {
          if (typeof xv === 'number' && Number.isFinite(xv)) {
            xMin = Math.min(xMin, xv)
            xMax = Math.max(xMax, xv)
          }
        }
        for (const yv of ys) {
          if (typeof yv === 'number' && Number.isFinite(yv)) {
            yMin = Math.min(yMin, yv)
            yMax = Math.max(yMax, yv)
          }
        }
      }
      if (
        !Number.isFinite(xMin) ||
        !Number.isFinite(xMax) ||
        !Number.isFinite(yMin) ||
        !Number.isFinite(yMax)
      ) {
        return
      }
      const span = Math.max(Math.abs(xMax - xMin), Math.abs(yMax - yMin), 1)
      const cx = 0.5 * (xMin + xMax)
      const cy = 0.5 * (yMin + yMax)
      xMin = cx - span / 2
      xMax = cx + span / 2
      yMin = cy - span / 2
      yMax = cy + span / 2

      const plotXY = (xs: number[], ys: number[], color: string) => {
        ctx.beginPath()
        let started = false
        for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
          const xv = xs[i] ?? Number.NaN
          const yv = ys[i] ?? Number.NaN
          if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue
          const px = left + ((xv - xMin) / (xMax - xMin)) * (width - 20) + 10
          const py = top + height - (((yv - yMin) / (yMax - yMin)) * (height - 26) + 10)
          if (!started) {
            ctx.moveTo(px, py)
            started = true
          } else {
            ctx.lineTo(px, py)
          }
        }
        ctx.strokeStyle = color
        ctx.lineWidth = 1.4
        ctx.stroke()
      }

      plotXY(a.rx, a.ry, '#1f77b4')
      plotXY(b.rx, b.ry, '#d62728')
    }

    const pad = 18
    const w = (canvas.width - pad * 3) / 2
    const h = (canvas.height - pad * 3) / 2

    drawOrbit(pad, pad, w, h, current, irk4)
    drawSeries(
      pad * 2 + w,
      pad,
      w,
      h,
      current.t,
      current.r,
      irk4.r,
      'Radius r(t): current vs irk4',
      '#1f77b4',
      '#d62728',
    )
    drawSeries(
      pad,
      pad * 2 + h,
      w,
      h,
      current.t,
      current.specificEnergy,
      irk4.specificEnergy,
      'Specific energy: current vs irk4',
      '#1f77b4',
      '#d62728',
    )
    drawSeries(
      pad * 2 + w,
      pad * 2 + h,
      w,
      h,
      current.t,
      current.eccentricity,
      irk4.eccentricity,
      'Eccentricity: current vs irk4',
      '#1f77b4',
      '#d62728',
    )
  }

  let currentRun: OrbitSolverRun
  try {
    currentRun = await runSimulation('modelica-orbit-current-sdirk2')
  } catch (error) {
    const bootDebug = {
      mode,
      phase: 'run-current',
      simParams,
      daeDebug,
      generatedCode: {
        length: generatedCodeDebug.length,
        lineCount: generatedCodeDebug.lineCount,
        checksum: generatedCodeDebug.checksum,
      },
      errorMessage: error instanceof Error ? error.message : String(error),
    }
    throw makeOrbitFailure(
      `Orbit current run failed before producing results: ${error instanceof Error ? error.message : String(error)}`,
      bootDebug,
      generatedCodeDebug,
      rendered,
    )
  }
  let irk4Run: OrbitSolverRun | null = null
  if (mode === 'compare') {
    try {
      irk4Run = await runSimulation('modelica-orbit-irk4', { timeIntegrator: 'irk4' })
    } catch (error) {
      const bootDebug = {
        mode,
        phase: 'run-irk4',
        simParams,
        daeDebug,
        generatedCode: {
          length: generatedCodeDebug.length,
          lineCount: generatedCodeDebug.lineCount,
          checksum: generatedCodeDebug.checksum,
        },
        errorMessage: error instanceof Error ? error.message : String(error),
      }
      throw makeOrbitFailure(
        `Orbit irk4 run failed before producing results: ${error instanceof Error ? error.message : String(error)}`,
        bootDebug,
        generatedCodeDebug,
        rendered,
      )
    }
  }
  const currentSamples = collectOrbitSamples(currentRun)
  const irk4Samples = irk4Run ? collectOrbitSamples(irk4Run) : null
  const extractionDiagnostics = {
    current: collectOrbitExtractionDebug('current', currentRun),
    irk4: irk4Run ? collectOrbitExtractionDebug('irk4', irk4Run) : null,
  }

  const debugSummary = {
    mode,
    simParams,
    compileSelection: selectionInfo,
    daeDebug,
    generatedCode: {
      length: generatedCodeDebug.length,
      lineCount: generatedCodeDebug.lineCount,
      checksum: generatedCodeDebug.checksum,
    },
    current: runSummary('current', currentRun, currentSamples),
    irk4: irk4Run && irk4Samples ? runSummary('irk4', irk4Run, irk4Samples) : null,
    diagnostics: {
      current: runNumericDiagnostics('current', currentRun, currentSamples),
      irk4: irk4Run && irk4Samples ? runNumericDiagnostics('irk4', irk4Run, irk4Samples) : null,
    },
    extractionDiagnostics,
  }
  if (irk4Samples) {
    renderDebugCanvas(currentSamples, irk4Samples, debugSummary)
  }

  const stopReasonCurrent = currentRun?.meta?.stopReason ?? ''
  const stopReasonIrk4 = irk4Run?.meta?.stopReason ?? ''
  if (stopReasonCurrent) {
    throw makeOrbitFailure(
      `Current solver orbit run stopped early: ${stopReasonCurrent} (${currentRun?.meta?.stopError ?? ''})`,
      debugSummary,
      generatedCodeDebug,
      rendered,
    )
  }
  if (irk4Run && stopReasonIrk4) {
    throw makeOrbitFailure(
      `IRK4 solver orbit run stopped early: ${stopReasonIrk4} (${irk4Run?.meta?.stopError ?? ''})`,
      debugSummary,
      generatedCodeDebug,
      rendered,
    )
  }

  let currentInv: ReturnType<typeof collectInvariants>
  let irk4Inv: ReturnType<typeof collectInvariants> | null
  try {
    currentInv = collectInvariants(currentSamples)
    irk4Inv = irk4Samples ? collectInvariants(irk4Samples) : null
  } catch (error) {
    throw makeOrbitFailure(
      `Invariant extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      debugSummary,
      generatedCodeDebug,
      rendered,
    )
  }

  const currentMaxDrift = Math.max(
    currentInv.semiMajorAxis.maxRelativeDrift,
    currentInv.specificEnergy.maxRelativeDrift,
    currentInv.angularMomentum.maxRelativeDrift,
    currentInv.eccentricity.maxAbsoluteDrift,
  )
  const irk4MaxDrift = irk4Inv
    ? Math.max(
        irk4Inv.semiMajorAxis.maxRelativeDrift,
        irk4Inv.specificEnergy.maxRelativeDrift,
        irk4Inv.angularMomentum.maxRelativeDrift,
        irk4Inv.eccentricity.maxAbsoluteDrift,
      )
    : null

  if (
    !Number.isFinite(currentMaxDrift) ||
    (irk4MaxDrift !== null && !Number.isFinite(irk4MaxDrift))
  ) {
    throw makeOrbitFailure(
      `Orbit invariants contain non-finite drift metrics; current=${currentMaxDrift}, irk4=${String(irk4MaxDrift)}`,
      debugSummary,
      generatedCodeDebug,
      rendered,
    )
  }
  if (irk4MaxDrift !== null && irk4MaxDrift > currentMaxDrift * 1.25 + 1e-12) {
    throw makeOrbitFailure(
      `IRK4 should be at least comparable on invariants drift; current=${currentMaxDrift}, irk4=${irk4MaxDrift}`,
      debugSummary,
      generatedCodeDebug,
      rendered,
    )
  }

  return {
    ok: true,
    model: 'SatelliteOrbit2D',
    sim: simParams,
    debugSummarySerialized: serializeObject(debugSummary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
    currentSolver: {
      id: 'sdirk2',
      invariants: currentInv,
      maxRelativeDrift: currentMaxDrift,
    },
    newSolver:
      irk4Inv && irk4MaxDrift !== null
        ? {
            id: 'irk4',
            invariants: irk4Inv,
            maxRelativeDrift: irk4MaxDrift,
          }
        : null,
    generatedCode: {
      length: generatedCodeDebug.length,
      lineCount: generatedCodeDebug.lineCount,
      checksum: generatedCodeDebug.checksum,
    },
  }
}

export async function testModelicaOrbitInvariantsCompareSolvers() {
  return runModelicaOrbitInvariantTest('compare')
}
testModelicaOrbitInvariantsCompareSolvers.timeoutMs = 180_000

export async function testModelicaOrbitInvariantsSdirkOnly() {
  return runModelicaOrbitInvariantTest('sdirk-only')
}
testModelicaOrbitInvariantsSdirkOnly.timeoutMs = 180_000

export async function testModelicaMslResistorSineVoltageIconSourceResolution() {
  const debug: Record<string, unknown> = {
    phase: 'init',
    mslZipPath: MSL_LOCAL_ZIP_PATH,
  }
  try {
    const wasm = await getDiagnosticsWasm()
    debug.phase = 'wasm-loaded'
    if (typeof wasm.get_class_info !== 'function') {
      throw new Error('Rumoca wasm export missing: get_class_info')
    }
    if (typeof wasm.parse_source_root_file !== 'function') {
      throw new Error('Rumoca wasm export missing: parse_source_root_file')
    }

    await ensureDiagnosticsMslLoaded(wasm, debug)
    debug.phase = 'msl-loaded'

    const resistorInfo = JSON.parse(
      String(wasm.get_class_info('Modelica.Electrical.Analog.Examples.Resistor')),
    ) as Record<string, unknown>
    const sineVoltageType = findResistorSineVoltageType(resistorInfo)
    const sineVoltageQualified = sineVoltageType.includes('.')
      ? sineVoltageType
      : `Modelica.Electrical.Analog.Sources.${sineVoltageType}`

    const sineInfo = JSON.parse(String(wasm.get_class_info(sineVoltageQualified))) as Record<
      string,
      unknown
    >
    const sourceModelica = asStringOrEmpty(sineInfo.source_modelica)
    const sourceFile = asStringOrEmpty(sineInfo.source_file)
    const fallbackSourceFile = `${sineVoltageQualified.replaceAll('.', '/')}.mo`
    const resolvedSourceFile = sourceFile.trim() || fallbackSourceFile
    const sourceModelicaFileName = `${sineVoltageQualified.replaceAll('.', '/')}.mo`

    const sourceModelicaParse = parseSourceRootAstOrError(
      wasm,
      sourceModelica,
      sourceModelicaFileName,
    )
    const mslFiles = await loadMslSourcesFromZip()
    const sourceFileEntry = readMslSourceFromZipByPath(mslFiles, resolvedSourceFile)
    if (!sourceFileEntry) {
      throw new Error(`Could not locate SineVoltage source file in MSL zip: ${resolvedSourceFile}`)
    }
    const sourceFileParse = parseSourceRootAstOrError(
      wasm,
      sourceFileEntry.source,
      sourceFileEntry.path,
    )
    if (!sourceFileParse.ok) {
      throw new Error(
        [
          `Failed to parse SineVoltage source file from MSL archive (${sourceFileEntry.path})`,
          sourceFileParse.error,
        ].join(': '),
      )
    }

    const iconHintInClassInfoSource = /annotation\s*\(\s*Icon\b|Icon\s*\(/.test(sourceModelica)
    const iconHintInSourceFile = /annotation\s*\(\s*Icon\b|Icon\s*\(/.test(sourceFileEntry.source)
    if (!iconHintInClassInfoSource && !iconHintInSourceFile) {
      throw new Error('No Icon annotation hint found for SineVoltage in class info or source file')
    }
    if (!sourceModelicaParse.ok && !sourceFileParse.ok) {
      throw new Error('Unable to parse SineVoltage from class_info source or source-root file')
    }

    return {
      ok: true,
      sineVoltageQualified,
      sourceFile,
      resolvedSourceFile,
      sourceModelicaLength: sourceModelica.length,
      classInfoRoundtripParseable: sourceModelicaParse.ok,
      sourceRootFileParseable: sourceFileParse.ok,
      classInfoParseError: sourceModelicaParse.ok ? null : sourceModelicaParse.error,
      iconHintInClassInfoSource,
      iconHintInSourceFile,
      note: sourceModelicaParse.ok
        ? 'class_info source is round-trippable'
        : 'class_info source parse failed; source-root fallback remains valid',
    }
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    throw new Error([baseMessage, `MSL SineVoltage icon source debug:\n${debugDump}`].join('\n'))
  }
}

export async function testModelicaMslResistorSineVoltageClassInfoRoundtripStrict() {
  const debug: Record<string, unknown> = {
    phase: 'init',
    mslZipPath: MSL_LOCAL_ZIP_PATH,
  }
  try {
    const wasm = await getDiagnosticsWasm()
    debug.phase = 'wasm-loaded'
    if (typeof wasm.get_class_info !== 'function') {
      throw new Error('Rumoca wasm export missing: get_class_info')
    }
    if (typeof wasm.parse_source_root_file !== 'function') {
      throw new Error('Rumoca wasm export missing: parse_source_root_file')
    }
    if (
      typeof wasm.compile_with_source_roots !== 'function' &&
      typeof wasm.compile_with_libraries !== 'function'
    ) {
      throw new Error(
        'Rumoca wasm export missing: compile_with_source_roots / compile_with_libraries',
      )
    }

    await ensureDiagnosticsMslLoaded(wasm, debug)
    debug.phase = 'msl-loaded'

    const source = `
model MslResistorStrictIconProbe
  extends Modelica.Electrical.Analog.Examples.Resistor;
end MslResistorStrictIconProbe;
`.trim()
    const compiledRaw = compileWithDiagnosticsMsl(wasm, source, 'MslResistorStrictIconProbe')
    const compiled = JSON.parse(String(compiledRaw)) as {
      dae?: unknown
      dae_native?: unknown
      dae_prepared?: unknown
    }
    const dae = selectDaeForTemplate(compiled, { usePreparedDae: true })
    if (!dae || typeof dae !== 'object' || Array.isArray(dae)) {
      throw new Error('Top-level resistor compile did not return a DAE object')
    }
    debug.phase = 'compiled-top-level-resistor'

    const resistorInfo = JSON.parse(
      String(wasm.get_class_info('Modelica.Electrical.Analog.Examples.Resistor')),
    ) as Record<string, unknown>
    const sineVoltageType = findResistorSineVoltageType(resistorInfo)
    const sineVoltageQualified = sineVoltageType.includes('.')
      ? sineVoltageType
      : `Modelica.Electrical.Analog.Sources.${sineVoltageType}`
    debug.sineVoltageQualified = sineVoltageQualified

    const sineInfo = JSON.parse(String(wasm.get_class_info(sineVoltageQualified))) as Record<
      string,
      unknown
    >
    const sourceModelica = asStringOrEmpty(sineInfo.source_modelica)
    if (!sourceModelica.trim()) {
      throw new Error(`Class info source_modelica is empty for ${sineVoltageQualified}`)
    }

    const classInfoFileName = `${sineVoltageQualified.replaceAll('.', '/')}.mo`
    const sourceModelicaParse = parseSourceRootAstOrError(wasm, sourceModelica, classInfoFileName)
    if (!sourceModelicaParse.ok) {
      throw new Error(
        [
          `Class info source_modelica is not round-trippable for ${sineVoltageQualified}`,
          sourceModelicaParse.error,
        ].join(': '),
      )
    }

    const iconHintInClassInfoSource = /annotation\s*\(\s*Icon\b|Icon\s*\(/.test(sourceModelica)
    if (!iconHintInClassInfoSource) {
      throw new Error(
        `Class info source_modelica has no Icon annotation hint for ${sineVoltageQualified}`,
      )
    }

    return {
      ok: true,
      sineVoltageQualified,
      sourceModelicaLength: sourceModelica.length,
      classInfoRoundtripParseable: true,
      iconHintInClassInfoSource: true,
      note: 'Strict rumoca class_info-only roundtrip check passed',
    }
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    throw new Error(
      [baseMessage, `MSL SineVoltage strict class_info roundtrip debug:\n${debugDump}`].join('\n'),
    )
  }
}
