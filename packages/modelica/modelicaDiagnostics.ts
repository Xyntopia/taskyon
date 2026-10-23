import { decodeClassMetadata } from './modelicaClassMetadata'
import {
  collectModelicaDiagnosticTests,
  type ModelicaGenerator,
} from './modelicaDiagnosticVariants'
import {
  runDiagnosticsTests,
  type DiagnosticsTestContext,
} from '@taskyon/common/modules/diagnosticsRunner'
import { exampleModels } from './modelicaExamples'
import {
  buildModelAbiValidationSandboxCode,
  buildWorkerSandboxCode,
  getPreparedDaeDiagnostics,
  getPreparedDaeStatus,
  DEFAULT_MSL_ZIP_URL,
  loadWasm,
  selectDaeForTemplate,
  shouldValidateModelAbiForRenderedOutput,
  validateModelAbiValidationResultV1,
} from './modelica'
import {
  daeJsonForTemplate,
  compileRumocaTemplates,
  hasRumocaTemplateRenderer,
  renderRumocaTemplate,
} from './rumocaTemplateRender'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import {
  executeInWorkerSandbox,
  type ExecuteInWorkerSandboxOptions,
} from '@taskyon/common/modules/sandbox/workerSandbox'
import { validateJavaScriptInSandbox } from '@taskyon/common/modules/sandbox/checkJsSyntax'
import { serializeObject } from '@taskyon/common/modules/serializeObject'
import { createGraphController } from '@taskyon/common/modules/graph'
import type { TaskyonStorageClient } from '@taskyon/taskyon/api'
import baseDaeTemplate from './base_dae.jinja?raw'
import javascriptTemplate from './javascript.jinja?raw'
import solveJavascriptTemplate from './javascript_solve.jinja?raw'
import defaultSolverSource from './simulateModel?raw'
import checkedSolveFixtures from './fixtures/checked_solve_programs.json'
import {
  mapDiagramToGraph,
  type DiagramEdgeData,
  type DiagramNodeData,
} from './diagram/mapDiagramToGraph'
import type { DiagramPort, ModelicaDiagramDto } from './diagram/types'
import { ModelicaWorkerClient } from './modelicaWorkerClient'
import {
  buildLazyModelicaLibraryByteArchive,
  normalizeModelicaLibraryEntryPath,
} from './lazyModelicaLibraryIndex'
import modelicaLibrariesManifest from './modelica_libraries.json' with { type: 'json' }

const executeModelicaDiagnosticInSandbox = <R = unknown>(
  options: ExecuteInWorkerSandboxOptions,
  ...args: unknown[]
) => executeInWorkerSandbox<R>({ ...options, reuse: { mode: 'disposable' } }, ...args)

const templateChecks = [
  {
    name: 'javascript.jinja',
    source: javascriptTemplate,
    requiredSnippets: ['function Model()', 'const meta = {'],
    executableAsJs: true,
  },
  {
    name: 'base_dae.jinja',
    source: baseDaeTemplate,
    requiredSnippets: ['Model:', 'Differential equations'],
    executableAsJs: false,
  },
] as const

const MODELICA_CONTEXT_INSPECT_TEMPLATE = `
schema={{ dae.schema.name }}|{{ dae.schema.version }}
{% for v in dae.variables -%}
var|{{ v.role }}|{{ v.name }}|{{ v.scalar_names | join(",") }}|{{ v.scalar_count }}
{% endfor -%}
{% for owner in dae.systems.continuous.owners -%}
owner|continuous|{{ owner.kind }}|{{ owner.scalar_rows if owner.scalar_rows is defined else 0 }}|{{ owner.residual if owner.residual is defined else -1 }}|{{ owner.domain if owner.domain is defined else -1 }}
{% endfor -%}
{% for owner in dae.systems.initialization.owners -%}
owner|initialization|{{ owner.kind }}|{{ owner.scalar_rows if owner.scalar_rows is defined else 0 }}|{{ owner.residual if owner.residual is defined else -1 }}|{{ owner.domain if owner.domain is defined else -1 }}
{% endfor -%}
{% for res in dae.systems.discrete_real.residuals -%}
discrete_real|{{ res.activation.kind }}
{% endfor -%}
{% for owner in dae.systems.discrete_values.owners -%}
{% for branch in owner.branches -%}
discrete_value|{{ branch.activation.kind }}
{% endfor -%}
{% endfor -%}
{% for cond in dae.systems.conditions.conditions -%}
condition|{{ cond.operation.kind }}
{% endfor -%}
{% for action in dae.systems.events.actions -%}
event_action|{{ action.operation.kind }}
{% endfor -%}
`.trim()

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

function assertTemplateRendererAvailable(wasm: DiagnosticsWasm): void {
  if (!hasRumocaTemplateRenderer(wasm)) {
    throw new Error('Rumoca wasm export missing: render_template / render_target')
  }
}

function compileDiagnosticJavaScript(
  wasm: DiagnosticsWasm,
  source: string,
  modelName: string,
  generator: ModelicaGenerator,
) {
  const template =
    generator === 'dae'
      ? { source: javascriptTemplate, path: 'javascript.jinja' }
      : { source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }
  const compilation = compileRumocaTemplates({ wasm, source, modelName, templates: [template] })
  const generated = compilation.rendered[0]
  if (!generated?.ok)
    throw new Error(
      `${modelName} [${generator}] rendering failed: ${generated?.error ?? 'Missing generated model'}`,
    )
  return { ...compilation, rendered: generated.content }
}

function renderDiagnosticsTemplate(
  wasm: DiagnosticsWasm,
  daeJson: string,
  templateSource: string,
  templatePath: string,
  outputPath: string,
  modelName: string,
): string {
  const rendered = renderRumocaTemplate({
    wasm,
    daeJson,
    templateSource,
    modelName,
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

function componentPortNames(diagram: ModelicaDiagramDto, componentId: string): string[] {
  const component = diagram.components.find((entry) => entry.id === componentId)
  if (!component) {
    throw new Error(`Diagram is missing component ${componentId}`)
  }
  return (component.ports ?? []).map((port) => port.name)
}

function diagramPortSignature(diagram: ModelicaDiagramDto): string {
  return diagram.components
    .map(
      (component) =>
        `${component.id}:${(component.ports ?? [])
          .map((port) => port.name)
          .sort()
          .join('|')}`,
    )
    .sort()
    .join(';')
}

function assertComponentHasPort(
  diagram: ModelicaDiagramDto,
  componentId: string,
  portName: string,
  context: string,
): void {
  if (!componentPortNames(diagram, componentId).includes(portName)) {
    throw new Error(`${context}: component ${componentId} is missing inherited port ${portName}`)
  }
}

const FUNCTION_ICON_ELLIPSE_FILL = '255,215,136'
const WHITE_FILL = '255,255,255'

function graphicFillColor(graphic: unknown): string {
  if (!graphic || typeof graphic !== 'object') return ''
  const fillColor = (graphic as { fillColor?: unknown }).fillColor
  return Array.isArray(fillColor) ? fillColor.join(',') : ''
}

function countFunctionStyleEllipses(
  icon: ModelicaDiagramDto['components'][number]['icon'],
): number {
  return (icon?.graphics ?? []).filter(
    (graphic) =>
      (graphic as { kind?: string }).kind === 'Ellipse' &&
      graphicFillColor(graphic) === FUNCTION_ICON_ELLIPSE_FILL,
  ).length
}

function hasWhiteFilledShape(icon: ModelicaDiagramDto['components'][number]['icon']): boolean {
  return (icon?.graphics ?? []).some((graphic) => {
    const kind = (graphic as { kind?: string }).kind
    return (kind === 'Rectangle' || kind === 'Polygon') && graphicFillColor(graphic) === WHITE_FILL
  })
}

function iconGraphicsCount(icon: ModelicaDiagramDto['components'][number]['icon']): number {
  return icon?.graphics.length ?? 0
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
  const daeJson = daeJsonForTemplate(parsed, { usePreparedDae: true })
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
    daeJson,
    '{{ dae.model_name | default("unknown") }}',
    'template-check.jinja',
    'template-check.txt',
    modelName,
  )

  const templateResults: Record<
    string,
    { ok: boolean; preview: string; jsExecutable: boolean; expectedJs: boolean; abiOk?: boolean }
  > = {}
  for (const check of templateChecks) {
    const out = renderDiagnosticsTemplate(
      wasm,
      daeJson,
      check.source,
      check.name,
      check.name,
      modelName,
    )
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
        const rawAbiResult = await executeModelicaDiagnosticInSandbox(
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

type DiagnosticsModelicaLibraryManifestEntry = {
  name?: unknown
  file_name?: unknown
  mirror_url?: unknown
  download_url?: unknown
}

const diagnosticsModelicaLibraries =
  (modelicaLibrariesManifest as { libraries?: DiagnosticsModelicaLibraryManifestEntry[] })
    .libraries ?? []

const diagnosticsLibraryByName = (
  name: string,
): DiagnosticsModelicaLibraryManifestEntry | undefined =>
  diagnosticsModelicaLibraries.find((entry) => entry.name === name)

const diagnosticsStandardMsl = (): DiagnosticsModelicaLibraryManifestEntry | undefined =>
  diagnosticsModelicaLibraries.find(
    (entry) => typeof entry.name === 'string' && entry.name.startsWith('ModelicaStandardLibrary-'),
  )

const diagnosticsLibraryUrl = (
  entry: DiagnosticsModelicaLibraryManifestEntry | undefined,
): string =>
  typeof entry?.mirror_url === 'string'
    ? entry.mirror_url
    : typeof entry?.download_url === 'string'
      ? entry.download_url
      : ''
export function testModelicaDiagramOffEdgePortPlacement() {
  const makeComponent = (
    id: string,
    ports: DiagramPort[],
  ): ModelicaDiagramDto['components'][number] => ({
    id,
    name: id,
    typeName: 'Probe.Child',
    icon: {
      coordinateExtent: [
        [-100, -100],
        [100, 100],
      ],
      graphics: [
        {
          kind: 'Rectangle',
          extent: [
            [-100, -100],
            [100, 100],
          ],
        },
      ],
    },
    placement: {
      extent: [
        [0, 0],
        [20, 20],
      ],
    },
    ports,
  })
  const diagram: ModelicaDiagramDto = {
    className: 'OffEdgePortProbe',
    components: [
      makeComponent('child', [
        {
          name: 'left',
          typeName: 'In',
          placement: {
            extent: [
              [-130, -20],
              [-90, 20],
            ],
          },
        },
        {
          name: 'right',
          typeName: 'Out',
          placement: {
            extent: [
              [90, -10],
              [110, 10],
            ],
          },
        },
        {
          name: 'farRight',
          typeName: 'Out',
          placement: {
            extent: [
              [100, -10],
              [120, 10],
            ],
          },
        },
        {
          name: 'runaway',
          typeName: 'Out',
          placement: {
            extent: [
              [1000, -10],
              [1200, 10],
            ],
          },
        },
        {
          name: 'runawayLeft',
          typeName: 'In',
          placement: {
            extent: [
              [-1200, -10],
              [-1000, 10],
            ],
          },
        },
      ]),
    ],
    connections: [],
  }
  const mapped = mapDiagramToGraph(diagram, 'authored')
  const node = mapped.graph.nodes.find((entry) => entry.id === 'child')
  if (!node) throw new Error('Off-edge port probe did not map the child node')
  const ratios = new Map((node.data?.ports ?? []).map((port) => [port.name, port]))
  const expectRatio = (name: string, predicate: (value: number) => boolean) => {
    const port = ratios.get(name)
    if (!port) throw new Error(`Off-edge port probe is missing port ${name}`)
    if (!predicate(port.xRatio)) {
      throw new Error(`Off-edge port ${name} has unexpected xRatio ${port.xRatio}`)
    }
  }
  expectRatio('left', (value) => value < 0 && value >= -0.25)
  expectRatio('right', (value) => value === 1)
  expectRatio('farRight', (value) => value > 1 && value <= 1.25)
  expectRatio('runaway', (value) => value === 1.25)
  expectRatio('runawayLeft', (value) => value === -0.25)
  return {
    ok: true,
    ratios: Object.fromEntries(Array.from(ratios, ([name, port]) => [name, port.xRatio])),
  }
}

export async function testModelicaPowerSystemsDiagramRendering() {
  if (typeof Worker === 'undefined' || typeof document === 'undefined') {
    return {
      ok: true,
      skipped: 'PowerSystems diagram rendering requires browser Worker + DOM',
    }
  }

  const standardMsl = diagnosticsStandardMsl()
  const powerSystems = diagnosticsLibraryByName('PowerSystems')
  const standardMslUrl = diagnosticsLibraryUrl(standardMsl)
  const powerSystemsUrl = diagnosticsLibraryUrl(powerSystems)
  if (!standardMslUrl) throw new Error('Standard MSL archive URL is missing from Modelica manifest')
  if (!powerSystemsUrl)
    throw new Error('PowerSystems archive URL is missing from Modelica manifest')

  const debug: Record<string, unknown> = {
    phase: 'fetch-libraries',
    standardMslUrl,
    powerSystemsUrl,
  }
  const worker = new ModelicaWorkerClient()
  const rendered: Record<string, unknown> = {}

  try {
    const [standardResponse, powerSystemsResponse] = await Promise.all([
      fetch(standardMslUrl),
      fetch(powerSystemsUrl),
    ])
    if (!standardResponse.ok) {
      throw new Error(`Failed to fetch standard MSL archive: HTTP ${standardResponse.status}`)
    }
    if (!powerSystemsResponse.ok) {
      throw new Error(`Failed to fetch PowerSystems archive: HTTP ${powerSystemsResponse.status}`)
    }
    const [standardArchive, powerSystemsArchive] = await Promise.all([
      standardResponse.arrayBuffer(),
      powerSystemsResponse.arrayBuffer(),
    ])

    debug.phase = 'worker-init'
    await worker.init(0)
    debug.phase = 'load-standard-msl'
    await worker.loadMslZip(
      typeof standardMsl?.file_name === 'string'
        ? standardMsl.file_name
        : 'ModelicaStandardLibrary.zip',
      standardArchive,
    )
    debug.phase = 'merge-powersystems'
    await worker.mergeMslZip(
      typeof powerSystems?.file_name === 'string' ? powerSystems.file_name : 'PowerSystems.zip',
      powerSystemsArchive,
    )

    const cases = [
      'PowerSystems.Examples.PowerWorld.Components.PowerPlant',
      'PowerSystems.Examples.PowerWorld.PowerWorld',
      'PowerSystems.Examples.PowerWorld.Components.WindFarm',
    ] as const
    const caseRequests: Record<
      string,
      { source: string; qualifiedName: string; fileName: string }
    > = {}
    const caseExtractMs: Record<string, number> = {}
    const casePortSignatures: Record<string, string> = {}

    for (const qualifiedName of cases) {
      debug.phase = `class-info:${qualifiedName}`
      const info = await worker.getClassInfo(qualifiedName)
      const serializedSource = typeof info.source_modelica === 'string' ? info.source_modelica : ''
      const originalSource =
        typeof info.source_modelica_original === 'string' ? info.source_modelica_original : ''
      if (qualifiedName.endsWith('.PowerPlant') && !originalSource.trim()) {
        throw new Error(`${qualifiedName} did not recover original source-root class text`)
      }
      const preferredSource = originalSource.trim() ? originalSource : serializedSource
      if (!preferredSource.trim()) {
        throw new Error(`${qualifiedName} did not expose usable Modelica source`)
      }

      const parts = qualifiedName.split('.')
      const parent = parts.slice(0, -1).join('.')
      const source = `within ${parent};\n\n${preferredSource}`
      debug.phase = `extract:${qualifiedName}`
      const request = {
        source,
        qualifiedName,
        fileName: `${parts.at(-1) || 'Model'}.mo`,
      }
      const extractStartedAt = performance.now()
      const diagram = ensureDiagramDto(await worker.extractDiagram(request))
      const extractMs = performance.now() - extractStartedAt
      caseRequests[qualifiedName] = request
      caseExtractMs[qualifiedName] = extractMs
      casePortSignatures[qualifiedName] = diagramPortSignature(diagram)
      if (diagram.components.length === 0) {
        throw new Error(`${qualifiedName} produced zero diagram components`)
      }

      if (qualifiedName.endsWith('.PowerWorld')) {
        const powerPlant = diagram.components.find((component) => component.id === 'powerPlant')
        if (!powerPlant?.icon || powerPlant.icon.graphics.length === 0) {
          throw new Error('PowerWorld powerPlant component did not resolve its nested class icon')
        }
        for (const componentId of ['powerPlant', 'windFarm', 'hydroPlant', 'city']) {
          assertComponentHasPort(diagram, componentId, 'terminal', qualifiedName)
        }
      }

      if (qualifiedName.endsWith('.PowerPlant')) {
        for (const portName of ['flange_a', 'flange_b']) {
          assertComponentHasPort(diagram, 'rotor', portName, qualifiedName)
        }
      }

      const distributed = mapDiagramToGraph(diagram, 'distributed')
      const distributedRects = distributed.options.fixedNodeRects ?? {}
      if (Object.keys(distributedRects).length !== diagram.components.length) {
        throw new Error(
          `${qualifiedName} distributed layout placed ${Object.keys(distributedRects).length}/${diagram.components.length} components`,
        )
      }
      const distributedEntries = Object.entries(distributedRects)
      for (let i = 0; i < distributedEntries.length; i += 1) {
        const [leftId, left] = distributedEntries[i]!
        for (let j = i + 1; j < distributedEntries.length; j += 1) {
          const [rightId, right] = distributedEntries[j]!
          const overlaps =
            left.x < right.x + (right.width ?? 0) &&
            left.x + (left.width ?? 0) > right.x &&
            left.y < right.y + (right.height ?? 0) &&
            left.y + (left.height ?? 0) > right.y
          if (overlaps) {
            throw new Error(`${qualifiedName} distributed layout overlaps ${leftId} and ${rightId}`)
          }
        }
      }

      debug.phase = `render:${qualifiedName}`
      const mapped = mapDiagramToGraph(diagram, 'auto')
      if (mapped.options.direction !== 'LR') {
        throw new Error(`${qualifiedName} auto layout is not left-to-right`)
      }
      const host = createOffscreenGraphHost()
      const controller = createGraphController<DiagramNodeData, DiagramEdgeData>(
        host,
        mapped.graph,
        mapped.options,
      )
      try {
        const svg = controller.exportSvgString({
          cropToContent: true,
          cropPadding: 18,
          backgroundColor: 'rgb(229, 231, 235)',
        })
        if (!svg.includes('<svg') || /\b(?:NaN|undefined)\b/.test(svg)) {
          throw new Error(`${qualifiedName} produced invalid SVG output`)
        }
        const missingIconComponents = diagram.components
          .filter((component) => !component.icon || component.icon.graphics.length === 0)
          .map((component) => component.id)
        if (missingIconComponents.length > 0) {
          throw new Error(
            `${qualifiedName} has unresolved component icons: ${missingIconComponents.join(', ')}`,
          )
        }
        rendered[qualifiedName] = {
          components: diagram.components.length,
          connections: diagram.connections.length,
          svgLength: svg.length,
          iconComponents: diagram.components.length - missingIconComponents.length,
          missingIconComponents,
          extractMs: Math.round(extractMs),
        }
      } finally {
        controller.destroy()
        host.remove()
      }
    }

    const cacheProbeName = cases[0]
    const cacheProbeRequest = caseRequests[cacheProbeName]
    const firstRendered = rendered[cacheProbeName] as
      | { components: number; connections: number; iconComponents: number }
      | undefined
    if (!cacheProbeRequest || !firstRendered) {
      throw new Error(`${cacheProbeName} did not record a first render for the cache probe`)
    }
    debug.phase = `cache-probe:${cacheProbeName}`
    const repeatStartedAt = performance.now()
    const repeatedDiagram = ensureDiagramDto(await worker.extractDiagram(cacheProbeRequest))
    const repeatMs = performance.now() - repeatStartedAt
    if (
      repeatedDiagram.components.length !== firstRendered.components ||
      repeatedDiagram.connections.length !== firstRendered.connections
    ) {
      throw new Error(`${cacheProbeName} repeat render changed the diagram shape`)
    }
    const repeatedMissingIcons = repeatedDiagram.components.filter(
      (component) => !component.icon || component.icon.graphics.length === 0,
    ).length
    if (repeatedMissingIcons !== firstRendered.components - firstRendered.iconComponents) {
      throw new Error(`${cacheProbeName} repeat render resolved a different number of icons`)
    }
    if (diagramPortSignature(repeatedDiagram) !== casePortSignatures[cacheProbeName]) {
      throw new Error(`${cacheProbeName} repeat render resolved different inherited ports`)
    }
    const firstMs = caseExtractMs[cacheProbeName] ?? 0
    if (!(repeatMs < 2000)) {
      throw new Error(
        `${cacheProbeName} repeat render did not use the diagram cache: first=${Math.round(firstMs)}ms repeat=${Math.round(repeatMs)}ms`,
      )
    }
    const cacheProbe = {
      qualifiedName: cacheProbeName,
      firstExtractMs: Math.round(firstMs),
      repeatExtractMs: Math.round(repeatMs),
    }

    debug.phase = 'icon-inheritance-probe'
    const iconProbeSource = `within PowerSystems;
model IconInheritanceProbe
  PowerSystems.Interfaces.Terminal terminal annotation(Placement(transformation(extent = {{-80, 40}, {-60, 60}})));
  PowerSystems.Generic.Ports.Terminal_n terminalN annotation(Placement(transformation(extent = {{-40, 40}, {-20, 60}})));
  PowerSystems.Generic.PrescribedPowerSource source annotation(Placement(transformation(extent = {{0, 40}, {20, 60}})));
end IconInheritanceProbe;
`
    const iconProbe = ensureDiagramDto(
      await worker.extractDiagram({
        source: iconProbeSource,
        qualifiedName: 'PowerSystems.IconInheritanceProbe',
        fileName: 'IconInheritanceProbe.mo',
      }),
    )
    const iconProbeComponent = (id: string) => {
      const component = iconProbe.components.find((entry) => entry.id === id)
      if (!component) throw new Error(`Icon inheritance probe is missing component ${id}`)
      return component
    }
    const terminalIcon = iconProbeComponent('terminal').icon
    if (iconGraphicsCount(terminalIcon) !== 0) {
      throw new Error(
        `PowerSystems.Interfaces.Terminal must not resolve icon graphics, got ${iconGraphicsCount(terminalIcon)}`,
      )
    }
    const terminalNIcon = iconProbeComponent('terminalN').icon
    if (countFunctionStyleEllipses(terminalNIcon) !== 0) {
      throw new Error('Terminal_n inherited unrelated Modelica.Icons.Function graphics')
    }
    if (!hasWhiteFilledShape(terminalNIcon)) {
      throw new Error('Terminal_n lost its own white rectangle icon')
    }
    const sourceIcon = iconProbeComponent('source').icon
    if (countFunctionStyleEllipses(sourceIcon) !== 0) {
      throw new Error('PrescribedPowerSource inherited unrelated Modelica.Icons.Function graphics')
    }
    const iconProbeResult = {
      terminalGraphics: iconGraphicsCount(terminalIcon),
      terminalNGraphics: iconGraphicsCount(terminalNIcon),
      sourceGraphics: iconGraphicsCount(sourceIcon),
    }

    return { ok: true, rendered, cacheProbe, iconProbe: iconProbeResult }
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_EXTENDED_SERIALIZE_OPTIONS)
    throw new Error([baseMessage, `PowerSystems diagram debug:\n${debugDump}`].join('\n'))
  } finally {
    worker.terminate()
  }
}
testModelicaPowerSystemsDiagramRendering.timeoutMs = 120_000

const libraryArchiveBytes = (files: Record<string, string>): ArrayBuffer => {
  const archive = zipSync(
    Object.fromEntries(Object.entries(files).map(([path, source]) => [path, strToU8(source)])),
  )
  const bytes = new Uint8Array(archive.byteLength)
  bytes.set(archive)
  return bytes.buffer
}

const diagramComponentFills = (diagram: ModelicaDiagramDto, componentId: string): string[] => {
  const component = diagram.components.find((entry) => entry.id === componentId)
  return (component?.icon?.graphics ?? []).flatMap((graphic) => {
    if (graphic.kind !== 'Rectangle' && graphic.kind !== 'Ellipse') return []
    return graphic.fillColor ? [graphic.fillColor.join(',')] : []
  })
}

export async function testModelicaLibraryMergeReplacement() {
  if (typeof Worker === 'undefined' || typeof document === 'undefined') {
    return { ok: true, skipped: 'Library merge replacement requires browser Worker + DOM' }
  }

  const packageSource = 'package MergeProbe\nend MergeProbe;\n'
  const fooSource = (fillColor: string) => `within MergeProbe;
model Foo
  annotation(Icon(graphics = {Rectangle(extent = {{-100, -100}, {100, 100}}, fillColor = ${fillColor}, fillPattern = FillPattern.Solid)}));
end Foo;
`
  const barSource = `within MergeProbe;
model Bar
  Foo foo annotation(Placement(transformation(extent = {{-10, -10}, {10, 10}})));
end Bar;
`
  const versionFiles = (fooFill: string) => ({
    'MergeProbe/package.mo': packageSource,
    'MergeProbe/Foo.mo': fooSource(fooFill),
    'MergeProbe/Bar.mo': barSource,
  })
  const request = {
    source: barSource,
    qualifiedName: 'MergeProbe.Bar',
    fileName: 'Bar.mo',
  }

  const debug: Record<string, unknown> = { phase: 'worker-init' }
  const worker = new ModelicaWorkerClient()
  try {
    await worker.init(0)
    debug.phase = 'load-v1'
    await worker.loadMslZip('MergeProbe-v1.zip', libraryArchiveBytes(versionFiles('{0, 0, 255}')))
    const firstInfo = await worker.getClassInfo('MergeProbe.Foo')
    const firstDiagram = ensureDiagramDto(await worker.extractDiagram(request))
    const firstFills = diagramComponentFills(firstDiagram, 'foo')
    if (!firstFills.includes('0,0,255')) {
      throw new Error(
        `first render did not resolve the authored icon fill: ${firstFills.join(';')}`,
      )
    }

    debug.phase = 'merge-v2'
    await worker.mergeMslZip('MergeProbe-v2.zip', libraryArchiveBytes(versionFiles('{255, 0, 0}')))
    const secondInfo = await worker.getClassInfo('MergeProbe.Foo')
    const firstSource =
      typeof firstInfo.source_modelica === 'string' ? firstInfo.source_modelica : ''
    const secondSource =
      typeof secondInfo.source_modelica === 'string' ? secondInfo.source_modelica : ''
    if (!secondSource.trim() || secondSource === firstSource) {
      throw new Error('merged archive did not replace the previously materialized class source')
    }
    const secondDiagram = ensureDiagramDto(await worker.extractDiagram(request))
    const secondFills = diagramComponentFills(secondDiagram, 'foo')
    if (!secondFills.includes('255,0,0')) {
      throw new Error(`replaced source did not update the resolved icon: ${secondFills.join(';')}`)
    }

    return { ok: true, firstFills, secondFills }
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_EXTENDED_SERIALIZE_OPTIONS)
    throw new Error([baseMessage, `Library merge replacement debug:\n${debugDump}`].join('\n'))
  } finally {
    worker.terminate()
  }
}
testModelicaLibraryMergeReplacement.timeoutMs = 60_000

export async function testModelicaOpenIpslDiagramRendering() {
  if (typeof Worker === 'undefined' || typeof document === 'undefined') {
    return { ok: true, skipped: 'OpenIPSL diagram rendering requires browser Worker + DOM' }
  }

  const standardMsl = diagnosticsStandardMsl()
  const openIpsl = diagnosticsLibraryByName('OpenIPSL')
  const standardMslUrl = diagnosticsLibraryUrl(standardMsl)
  const openIpslUrl = diagnosticsLibraryUrl(openIpsl)
  if (!standardMslUrl) throw new Error('Standard MSL archive URL is missing from Modelica manifest')
  if (!openIpslUrl) throw new Error('OpenIPSL archive URL is missing from Modelica manifest')

  const qualifiedName = 'OpenIPSL.Examples.DAEMode.SMIB_Examples.Example_1.Network1'
  const debug: Record<string, unknown> = {
    phase: 'fetch-libraries',
    qualifiedName,
    standardMslUrl,
    openIpslUrl,
  }
  const worker = new ModelicaWorkerClient()
  let host: HTMLDivElement | null = null
  let controller: ReturnType<
    typeof createGraphController<DiagramNodeData, DiagramEdgeData>
  > | null = null

  try {
    const [standardResponse, openIpslResponse] = await Promise.all([
      fetch(standardMslUrl),
      fetch(openIpslUrl),
    ])
    if (!standardResponse.ok) {
      throw new Error(`Failed to fetch standard MSL archive: HTTP ${standardResponse.status}`)
    }
    if (!openIpslResponse.ok) {
      throw new Error(`Failed to fetch OpenIPSL archive: HTTP ${openIpslResponse.status}`)
    }
    const [standardArchive, openIpslArchive] = await Promise.all([
      standardResponse.arrayBuffer(),
      openIpslResponse.arrayBuffer(),
    ])

    debug.phase = 'worker-init'
    await worker.init(0)
    debug.phase = 'load-standard-msl'
    await worker.loadMslZip(
      typeof standardMsl?.file_name === 'string'
        ? standardMsl.file_name
        : 'ModelicaStandardLibrary.zip',
      standardArchive,
    )
    debug.phase = 'merge-openipsl'
    await worker.mergeMslZip(
      typeof openIpsl?.file_name === 'string' ? openIpsl.file_name : 'OpenIPSL.zip',
      openIpslArchive,
    )

    debug.phase = 'class-info'
    const info = await worker.getClassInfo(qualifiedName)
    const serializedSource = typeof info.source_modelica === 'string' ? info.source_modelica : ''
    const originalSource =
      typeof info.source_modelica_original === 'string' ? info.source_modelica_original : ''
    const preferredSource = originalSource.trim() ? originalSource : serializedSource
    if (!preferredSource.trim()) throw new Error(`${qualifiedName} did not expose usable source`)

    const parts = qualifiedName.split('.')
    const source = `within ${parts.slice(0, -1).join('.')};\n\n${preferredSource}`
    debug.phase = 'extract-diagram'
    const diagram = ensureDiagramDto(
      await worker.extractDiagram({
        source,
        qualifiedName,
        fileName: `${parts.at(-1) || 'Model'}.mo`,
      }),
    )
    if (diagram.components.length === 0)
      throw new Error(`${qualifiedName} produced zero components`)
    if (diagram.connections.length === 0)
      throw new Error(`${qualifiedName} produced zero connections`)

    const missingIconComponents = diagram.components
      .filter((component) => !component.icon)
      .map((component) => component.id)
    const distributed = mapDiagramToGraph(diagram, 'distributed')
    if (
      Object.keys(distributed.options.fixedNodeRects ?? {}).length !== diagram.components.length
    ) {
      throw new Error(`${qualifiedName} distributed layout did not place every component`)
    }
    const auto = mapDiagramToGraph(diagram, 'auto')
    if (auto.options.direction !== 'LR') throw new Error(`${qualifiedName} auto layout is not LR`)

    debug.phase = 'render-svg'
    host = createOffscreenGraphHost()
    controller = createGraphController<DiagramNodeData, DiagramEdgeData>(
      host,
      distributed.graph,
      distributed.options,
    )
    const svg = controller.exportSvgString({
      cropToContent: true,
      cropPadding: 18,
      backgroundColor: 'rgb(229, 231, 235)',
    })
    if (!svg.includes('<svg') || /\b(?:NaN|undefined)\b/.test(svg)) {
      throw new Error(`${qualifiedName} produced invalid SVG output`)
    }

    return {
      ok: true,
      qualifiedName,
      components: diagram.components.length,
      connections: diagram.connections.length,
      iconComponents: diagram.components.length - missingIconComponents.length,
      missingIconComponents,
      svgLength: svg.length,
    }
  } catch (error) {
    const baseMessage = error instanceof Error ? error.message : String(error)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_EXTENDED_SERIALIZE_OPTIONS)
    throw new Error([baseMessage, `OpenIPSL diagram debug:\n${debugDump}`].join('\n'))
  } finally {
    controller?.destroy()
    if (host?.parentNode) host.parentNode.removeChild(host)
    worker.terminate()
  }
}
testModelicaOpenIpslDiagramRendering.timeoutMs = 120_000

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
    __rumoca_build?: unknown
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

  // Rumoca keeps the canonical DAE wire free of compile metadata (`DaeWire`
  // denies unknown fields), so provenance lives on the compile-response root.
  if (dae.__rumoca_build !== undefined) {
    throw new Error('Compile metadata must not be embedded in the native DAE payload')
  }
  const build = parsed.__rumoca_build
  if (!build || typeof build !== 'object' || Array.isArray(build)) {
    throw new Error('Compile response is missing __rumoca_build metadata')
  }
  const buildRecord = build as Record<string, unknown>
  const version = buildRecord.version
  const gitCommit = buildRecord.git_commit
  const buildTimeUtc = buildRecord.build_time_utc
  if (typeof version !== 'string' || version.trim().length === 0) {
    throw new Error('Compile response __rumoca_build.version must be a non-empty string')
  }
  if (typeof gitCommit !== 'string' || gitCommit.trim().length === 0) {
    throw new Error('Compile response __rumoca_build.git_commit must be a non-empty string')
  }
  if (typeof buildTimeUtc !== 'string' || buildTimeUtc.trim().length === 0) {
    throw new Error('Compile response __rumoca_build.build_time_utc must be a non-empty string')
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

export async function testModelicaBooleanNetworkShimRuntime(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  const wasm = await getDiagnosticsWasm()
  assertTemplateRendererAvailable(wasm)

  const compilation = compileDiagnosticJavaScript(
    wasm,
    MODELICA_BOOLEAN_NETWORK_SHIM_SOURCE,
    'BooleanNetworkShimSmoke',
    generator,
  )
  const compiled = compilation.compileResponse
  const parsed = JSON.parse(compiled) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) {
    throw new Error('Rumoca compile_to_json returned no DAE payload')
  }

  const rendered = compilation.rendered
  if (typeof rendered !== 'string' || !rendered.trim()) {
    throw new Error('Rendered JS is empty')
  }
  const runId = 'modelica-boolean-network-shim-runtime'
  const abort = new AbortController()
  try {
    const runCode = await buildWorkerSandboxCodeChecked(rendered, runId)
    const result = await executeModelicaDiagnosticInSandbox<{
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
testModelicaBooleanNetworkShimRuntime.modelicaGenerators = ['dae', 'solve'] as const

export async function testModelicaBooleanSignalGeneratorWaveformRegression(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  const wasm = await getDiagnosticsWasm()
  assertTemplateRendererAvailable(wasm)

  const debug: Record<string, unknown> = {
    phase: 'compile',
    model: 'BooleanSignalGenerator',
  }
  await ensureDiagnosticsMslLoaded(wasm, debug)
  const compilation = compileDiagnosticJavaScript(
    wasm,
    MODELICA_BOOLEAN_SIGNAL_GENERATOR_SOURCE,
    'BooleanSignalGenerator',
    generator,
  )
  const compiled = compilation.compileResponse
  const parsed = JSON.parse(compiled) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) {
    throw new Error('Rumoca compile_to_json returned no DAE payload')
  }

  const rendered = compilation.rendered
  if (typeof rendered !== 'string' || !rendered.trim()) {
    throw new Error('Rendered JS is empty')
  }

  const runId = 'modelica-boolean-signal-generator-waveform-regression'
  const abort = new AbortController()
  try {
    const runCode = await buildWorkerSandboxCodeChecked(rendered, runId)
    const result = await executeModelicaDiagnosticInSandbox<{
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
testModelicaBooleanSignalGeneratorWaveformRegression.modelicaGenerators = ['dae', 'solve'] as const

export async function testModelicaBooleanNetwork1RuntimeRegression(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'solve',
) {
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

  const { rendered } = compileDiagnosticJavaScript(wasm, '', target.modelName, generator)

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
      executeModelicaDiagnosticInSandbox<BooleanNetworkRunResult>(
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
testModelicaBooleanNetwork1RuntimeRegression.modelicaGenerators = ['dae', 'solve'] as const
testModelicaBooleanNetwork1RuntimeRegression.setup = async () => {
  const wasm = await getDiagnosticsWasm()
  const debug: Record<string, unknown> = {}
  await ensureDiagnosticsMslLoaded(wasm, debug)
}
testModelicaBooleanNetwork1RuntimeRegression.timeoutMs = 120_000

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
  return runStaticModelExecutionModeRegression(source)
}

async function runStaticModelExecutionModeRegression(source: string) {
  const runId = 'modelica-static-model-execution-mode-regression'
  const abort = new AbortController()
  try {
    const result = await executeModelicaDiagnosticInSandbox<{
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

export async function testModelicaBouncingBallEventLocalizationRegression(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
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
  assertTemplateRendererAvailable(wasm)

  const compilation = compileDiagnosticJavaScript(wasm, source, 'BouncingBall', generator)
  const compiled = compilation.compileResponse
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

  const rendered = compilation.rendered
  if (!rendered || typeof rendered !== 'string') {
    throw new Error('Rendering javascript.jinja failed for BouncingBall')
  }
  if (
    generator === 'dae' &&
    (rendered.includes('const capabilities = { events: false }') ||
      rendered.includes('const capabilities = {events: false}'))
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
    runResult = await executeModelicaDiagnosticInSandbox(
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
testModelicaBouncingBallEventLocalizationRegression.modelicaGenerators = ['dae', 'solve'] as const

export async function testModelicaBouncingBallStandardSettingsBounce(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
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
  assertTemplateRendererAvailable(wasm)

  const compilation = compileDiagnosticJavaScript(wasm, source, 'BouncingBall', generator)
  const compiled = compilation.compileResponse
  const parsed = JSON.parse(compiled) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) {
    throw new Error('Rumoca compile_to_json returned no DAE payload for BouncingBall')
  }

  const rendered = compilation.rendered
  if (!rendered || typeof rendered !== 'string') {
    throw new Error('Rendering javascript.jinja failed for BouncingBall')
  }

  const runId = 'modelica-bouncing-ball-standard-settings'
  const runCode = await buildWorkerSandboxCodeChecked(rendered, runId)
  const runAbort = new AbortController()
  let runResult: DiagnosticsSimulationResult | null = null
  try {
    runResult = await executeModelicaDiagnosticInSandbox(
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
  const summarizeBounceRun = (label: string, result: DiagnosticsSimulationResult) => {
    const tSeries = asFiniteSeries(result?.data?.t)
    const hSeries = getSeriesByName(result?.data?.x, 'h')
    const vSeries = getSeriesByName(result?.data?.x, 'v')
    const minH = hSeries
      .filter(Number.isFinite)
      .reduce((m, v) => Math.min(m, v), Number.POSITIVE_INFINITY)
    const maxH = hSeries
      .filter(Number.isFinite)
      .reduce((m, v) => Math.max(m, v), Number.NEGATIVE_INFINITY)
    const velocitySignFlips = countSignFlips(vSeries)
    const events = Array.isArray(result?.meta?.events) ? result.meta.events : []
    const rawEventCount = result?.meta?.solverStats?.eventCount
    const hasEventCountMetadata =
      typeof rawEventCount === 'number' || typeof rawEventCount === 'string' || events.length > 0
    const eventCountFromStats = hasEventCountMetadata
      ? Number(rawEventCount ?? events.length)
      : null
    const summary = {
      runtime: label,
      executionMode: result?.meta?.executionMode ?? null,
      requestedSolver: result?.meta?.requestedSolver ?? null,
      nSamples: tSeries.length,
      expectedGridSamples: Math.floor((2 - 0) / 0.1) + 1,
      tStart: tSeries.length > 0 ? tSeries[0] : null,
      tEnd: tSeries.length > 0 ? tSeries[tSeries.length - 1] : null,
      minH: Number.isFinite(minH) ? minH : null,
      maxH: Number.isFinite(maxH) ? maxH : null,
      velocitySignFlips,
      eventCountFromStats,
      hasEventCountMetadata,
      stopReason: result?.meta?.stopReason ?? null,
      stopError: result?.meta?.stopError ?? null,
      stateNames: Array.isArray(result?.meta?.model?.stateNames)
        ? result.meta.model.stateNames
        : [],
    }
    return {
      tSeries,
      hSeries,
      vSeries,
      minH,
      velocitySignFlips,
      eventCountFromStats,
      hasEventCountMetadata,
      summary,
    }
  }
  const assertBounceRun = (
    label: string,
    result: DiagnosticsSimulationResult,
    details: ReturnType<typeof summarizeBounceRun>,
  ) => {
    if (result?.meta?.stopReason) {
      throw new Error(
        [
          `${label} stopped early: ${result.meta.stopReason}`,
          `stopError=${String(result.meta.stopError ?? '')}`,
          `summary=${serializeObject(details.summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
        ].join('\n'),
      )
    }
    const gridSamples = details.tSeries.filter((tSample) => {
      const stepIndex = Number(tSample) / 0.1
      return Math.abs(stepIndex - Math.round(stepIndex)) <= 1e-6
    }).length
    if (gridSamples < 20 || gridSamples > 25) {
      throw new Error(
        [
          `${label} returned unexpected grid sample count for dt=0.1, tf=2 (expected about 21, got ${gridSamples} grid samples of ${details.tSeries.length} total)`,
          `summary=${serializeObject(details.summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
        ].join('\n'),
      )
    }
    if (
      details.hSeries.length !== details.tSeries.length ||
      details.vSeries.length !== details.tSeries.length
    ) {
      throw new Error(
        [
          `${label} state series length mismatch: t=${details.tSeries.length}, h=${details.hSeries.length}, v=${details.vSeries.length}`,
          `summary=${serializeObject(details.summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
        ].join('\n'),
      )
    }
    if (!Number.isFinite(details.minH) || details.minH > 0.11) {
      throw new Error(
        [
          `${label} did not reach ground contact (min h=${String(details.minH)})`,
          `summary=${serializeObject(details.summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
        ].join('\n'),
      )
    }
    if (details.hasEventCountMetadata && (details.eventCountFromStats ?? 0) <= 0) {
      throw new Error(
        [
          `${label} produced no events, but the model should definitely bounce and trigger events`,
          `summary=${serializeObject(details.summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
        ].join('\n'),
      )
    }
    if (details.velocitySignFlips <= 0) {
      throw new Error(
        [
          `${label} produced events but no velocity sign flip was observed`,
          `summary=${serializeObject(details.summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
        ].join('\n'),
      )
    }
  }

  const jsSummary = summarizeBounceRun('generated-js sandbox run', runResult ?? {})
  assertBounceRun('BouncingBall generated-js sandbox run', runResult ?? {}, jsSummary)

  if (typeof wasm.simulate_model !== 'function') {
    throw new Error('Rumoca wasm export missing: simulate_model')
  }
  const nativeRaw = JSON.parse(
    String(wasm.simulate_model(source, 'BouncingBall', 2, 0.1, 'auto', '{}')),
  ) as Record<string, unknown>
  const nativeRunResult = normalizeRumocaNativeSimulationResult({
    ...nativeRaw,
    modelName: 'BouncingBall',
    solver: 'auto',
  })
  const nativeSummary = summarizeBounceRun('rumoca native run', nativeRunResult)
  assertBounceRun('BouncingBall rumoca native run', nativeRunResult, nativeSummary)

  return {
    ok: true,
    summarySerialized: serializeObject(jsSummary.summary, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
    rumocaNativeSummarySerialized: serializeObject(
      nativeSummary.summary,
      MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS,
    ),
    generatedCodePreview: rendered.slice(0, 500),
  }
}
testModelicaBouncingBallStandardSettingsBounce.modelicaGenerators = ['dae', 'solve'] as const

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
  const daeJson = daeJsonForTemplate(parsed, { usePreparedDae: true })

  const cases = [
    {
      name: 'javascript.jinja',
      template: javascriptTemplate,
      shouldValidate: true,
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
      modelName: 'Test',
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
        const rawAbiResult = await executeModelicaDiagnosticInSandbox(
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

const MSL_DIAGNOSTICS_ZIP_URL = DEFAULT_MSL_ZIP_URL

type DiagnosticsWasm = Awaited<ReturnType<typeof loadWasm>>
type DiagnosticsSimulationResult = {
  meta?: {
    nSteps?: number
    events?: unknown[]
    solverStats?: Record<string, unknown>
    stopReason?: string
    stopError?: string
    model?: {
      modelName?: string
      stateNames?: string[]
      algebraicNames?: string[]
      inputNames?: string[]
      conditionNames?: string[]
    }
    requestedSolver?: string
    executionMode?: string
    rumoca?: unknown
  }
  data?: {
    t?: unknown[]
    x?: Record<string, unknown>
    y?: Record<string, unknown>
    u?: Record<string, unknown>
    z?: Record<string, unknown>
    c?: Record<string, unknown>
  }
}
type MslLoadParsed = {
  parsed_count?: number
  file_count?: number
  class_count?: number
  load_mode?: 'index' | 'parsed'
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
    parameterOverridesJson: string,
  ) => string
  load_source_root_index?: (sourceRootsJson: string) => string
  load_source_roots?: (sourceRootsJson: string) => string
  load_libraries?: (librariesJson: string) => string
  clear_source_root_cache?: () => void
  list_classes?: () => string
  get_class_info?: (qualifiedName: string) => string
  parse?: (source: string) => unknown
  wasm_init?: (numThreads: number) => unknown
  lsp_diagnostics?: (source: string) => string
  lsp_completion_with_timing?: (source: string, line: number, character: number) => string
}

function normalizeRumocaNativeSimulationResult(
  raw: Record<string, unknown>,
): DiagnosticsSimulationResult {
  const payloadSource =
    raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : raw
  const names = Array.isArray(payloadSource.names)
    ? payloadSource.names.filter((entry): entry is string => typeof entry === 'string')
    : []
  const allData = Array.isArray(payloadSource.allData)
    ? payloadSource.allData.map((column) =>
        Array.isArray(column)
          ? column.map((value) =>
              typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN,
            )
          : [],
      )
    : []
  if (names.length === 0 || allData.length === 0) {
    throw new Error('Rumoca simulation returned no time-series payload')
  }

  const nStatesRaw = Number(payloadSource.nStates)
  const nStates = Number.isFinite(nStatesRaw) ? Math.max(0, Math.min(names.length, nStatesRaw)) : 0
  const times = allData[0] ?? []
  const stateNames = names.slice(0, nStates)
  const algebraicNames = names.slice(nStates)
  const stateSeries = stateNames.reduce<Record<string, number[]>>((acc, name, index) => {
    acc[name] = allData[index + 1] ?? []
    return acc
  }, {})
  const algebraicSeries = algebraicNames.reduce<Record<string, number[]>>((acc, name, index) => {
    acc[name] = allData[nStates + index + 1] ?? []
    return acc
  }, {})

  return {
    meta: {
      nSteps: times.length,
      executionMode: nStates > 0 ? 'dynamic_dae' : 'algebraic_discrete',
      model: {
        modelName:
          typeof raw.model === 'string'
            ? raw.model
            : typeof raw.modelName === 'string'
              ? raw.modelName
              : 'Model',
        stateNames,
        algebraicNames,
        inputNames: [],
        conditionNames: [],
      },
      requestedSolver: typeof raw.solver === 'string' ? raw.solver : 'auto',
      rumoca: raw,
    },
    data: {
      t: times,
      x: stateSeries,
      y: algebraicSeries,
      u: {},
      z: {},
      c: {},
    },
  }
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

function resetDiagnosticsMslLoadCache(): void {
  sharedDiagnosticsMslLoadPromise = null
}

function clearDiagnosticsMslSession(wasm: DiagnosticsMslApi): void {
  if (typeof wasm.clear_source_root_cache === 'function') {
    wasm.clear_source_root_cache()
  }
  resetDiagnosticsMslLoadCache()
}

async function ensureDiagnosticsMslLoaded(
  wasm: DiagnosticsMslApi,
  debug: Record<string, unknown>,
): Promise<MslLoadResult> {
  if (!sharedDiagnosticsMslLoadPromise) {
    const loadDebug: Record<string, unknown> = {}
    sharedDiagnosticsMslLoadPromise = loadLocalMslLibraries(wasm, loadDebug, 'parsed')
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
  return normalizeModelicaLibraryEntryPath(path)
}

async function loadLocalMslLibraries(
  wasm: DiagnosticsMslApi,
  debug: Record<string, unknown>,
  preferredMode: 'auto' | 'index' | 'parsed' = 'auto',
): Promise<MslLoadResult> {
  const canLoadSourceRootIndex = typeof wasm.load_source_root_index === 'function'
  const canLoadSourceRoots = typeof wasm.load_source_roots === 'function'
  const canLoadLibraries = typeof wasm.load_libraries === 'function'
  if (!canLoadSourceRootIndex && !canLoadSourceRoots && !canLoadLibraries) {
    throw new Error(
      'Rumoca wasm export missing: load_source_root_index / load_source_roots / load_libraries',
    )
  }

  const zipResponse = await fetch(MSL_DIAGNOSTICS_ZIP_URL)
  if (!zipResponse.ok) {
    throw new Error(
      `Failed to fetch MSL archive at ${MSL_DIAGNOSTICS_ZIP_URL}: HTTP ${zipResponse.status}`,
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

  const useIndexLoad = preferredMode !== 'parsed' && canLoadSourceRootIndex
  const loadFn = useIndexLoad
    ? wasm.load_source_root_index
    : canLoadSourceRoots
      ? wasm.load_source_roots
      : wasm.load_libraries
  if (typeof loadFn !== 'function') {
    throw new Error(
      'Rumoca wasm export missing: load_source_root_index / load_source_roots / load_libraries',
    )
  }
  const loadRaw = loadFn(JSON.stringify(libraries))
  const loadParsed = JSON.parse(String(loadRaw)) as MslLoadParsed
  loadParsed.load_mode = useIndexLoad ? 'index' : 'parsed'
  debug.loadParsed = loadParsed

  return {
    libraryFileCount,
    loadParsed,
  }
}

export async function testModelicaMslLoadBenchmark() {
  const debug: Record<string, unknown> = {
    phase: 'init',
    mslZipPath: MSL_DIAGNOSTICS_ZIP_URL,
  }

  try {
    const wasm = await getDiagnosticsWasm()
    debug.phase = 'wasm-loaded'

    const canIndex = typeof wasm.load_source_root_index === 'function'
    const canParse = typeof wasm.load_source_roots === 'function'
    if (!canIndex && !canParse) {
      throw new Error('Rumoca wasm export missing: load_source_root_index / load_source_roots')
    }

    const runLoad = async (mode: 'index' | 'parsed') => {
      clearDiagnosticsMslSession(wasm)
      const started = performance.now()
      const { libraryFileCount, loadParsed } = await loadLocalMslLibraries(wasm, debug, mode)
      const loadMs = Math.round((performance.now() - started) * 10) / 10
      const classTree =
        typeof wasm.list_classes === 'function'
          ? (JSON.parse(String(wasm.list_classes())) as {
              total_classes?: unknown
            })
          : null
      return {
        mode,
        libraryFileCount,
        loadMs,
        parsedCount: Number(loadParsed.parsed_count ?? 0),
        classCount: Number(loadParsed.class_count ?? 0),
        listedClassCount: Number(classTree?.total_classes ?? 0),
        documentCount:
          typeof wasm.get_source_root_document_count === 'function'
            ? Number(wasm.get_source_root_document_count()) || 0
            : 0,
      }
    }

    const indexed = canIndex ? await runLoad('index') : null
    const parsed = canParse ? await runLoad('parsed') : null
    clearDiagnosticsMslSession(wasm)

    return {
      ok: true,
      indexed,
      parsed,
      speedupVsParsed:
        indexed && parsed && indexed.loadMs > 0
          ? Math.round((parsed.loadMs / indexed.loadMs) * 100) / 100
          : null,
    }
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    throw new Error([baseMessage, `MSL load benchmark debug:\n${debugDump}`].join('\n'))
  }
}
testModelicaMslLoadBenchmark.timeoutMs = 120_000

export async function testModelicaTaskyonLazyMslIndexLoadsUnderTwoSeconds() {
  const debug: Record<string, unknown> = {
    phase: 'fetch',
    mslZipPath: MSL_DIAGNOSTICS_ZIP_URL,
  }

  try {
    const zipResponse = await fetch(MSL_DIAGNOSTICS_ZIP_URL)
    if (!zipResponse.ok) {
      throw new Error(
        `Failed to fetch MSL archive at ${MSL_DIAGNOSTICS_ZIP_URL}: HTTP ${zipResponse.status}`,
      )
    }
    const zipBytes = new Uint8Array(await zipResponse.arrayBuffer())
    if (zipBytes.length <= 1024) {
      throw new Error('MSL archive appears to be invalid (too small)')
    }
    debug.zipBytes = zipBytes.length
    debug.phase = 'lazy-index'

    const started = performance.now()
    const archive = unzipSync(zipBytes)
    const lazyArchive = buildLazyModelicaLibraryByteArchive(archive)
    const loadMs = Math.round((performance.now() - started) * 10) / 10
    const modelicaRoot = findQualifiedClassNode(lazyArchive.index.classes, 'Modelica')

    debug.loadMs = loadMs
    debug.fileCount = lazyArchive.index.fileCount
    debug.totalClasses = lazyArchive.index.totalClasses
    debug.sourceRootUriCount = lazyArchive.index.sourceRootUris.length
    debug.hasModelicaRoot = Boolean(modelicaRoot)

    if (lazyArchive.index.fileCount <= 0 || lazyArchive.index.totalClasses <= 0) {
      throw new Error('Taskyon lazy MSL index did not discover source files or classes')
    }
    if (!modelicaRoot) {
      throw new Error('Taskyon lazy MSL index did not discover the Modelica root package')
    }
    if (loadMs > 2000) {
      throw new Error(`Taskyon lazy MSL index exceeded 2000ms: ${loadMs}ms`)
    }

    return {
      ok: true,
      loadMs,
      fileCount: lazyArchive.index.fileCount,
      totalClasses: lazyArchive.index.totalClasses,
      sourceRootUriCount: lazyArchive.index.sourceRootUris.length,
      modelicaChildCount: Array.isArray(modelicaRoot.children) ? modelicaRoot.children.length : 0,
    }
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    throw new Error([baseMessage, `Taskyon lazy MSL index debug:\n${debugDump}`].join('\n'))
  }
}
testModelicaTaskyonLazyMslIndexLoadsUnderTwoSeconds.timeoutMs = 60_000

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

function parseSourceSyntaxOrError(
  wasm: DiagnosticsMslApi,
  source: string,
  fileName: string,
): { ok: true } | { ok: false; error: string } {
  if (typeof wasm.parse !== 'function')
    return { ok: false, error: 'Rumoca wasm export missing: parse' }
  try {
    const result: unknown = wasm.parse(source)
    if (result && typeof result === 'object' && 'success' in result && result.success === true) {
      return { ok: true }
    }
    return { ok: false, error: `Rumoca rejected source syntax: ${fileName}` }
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
  const zipResponse = await fetch(MSL_DIAGNOSTICS_ZIP_URL)
  if (!zipResponse.ok) {
    throw new Error(
      `Failed to fetch MSL archive at ${MSL_DIAGNOSTICS_ZIP_URL}: HTTP ${zipResponse.status}`,
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

type DiagnosticsClassTreeNode = {
  name?: unknown
  qualified_name?: unknown
  children?: unknown
}

function findQualifiedClassNode(
  nodes: DiagnosticsClassTreeNode[],
  qualifiedName: string,
): DiagnosticsClassTreeNode | null {
  for (const node of nodes) {
    if (node.qualified_name === qualifiedName) {
      return node
    }
    if (!Array.isArray(node.children)) continue
    const nested = findQualifiedClassNode(
      node.children as DiagnosticsClassTreeNode[],
      qualifiedName,
    )
    if (nested) return nested
  }
  return null
}

function directQualifiedChildNames(node: DiagnosticsClassTreeNode | null): string[] {
  if (!node || !Array.isArray(node.children)) return []
  return node.children
    .map((child) =>
      typeof (child as DiagnosticsClassTreeNode).qualified_name === 'string'
        ? ((child as DiagnosticsClassTreeNode).qualified_name as string)
        : '',
    )
    .filter((name) => name.length > 0)
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

  const { libraryFileCount, loadParsed } = await ensureDiagnosticsMslLoaded(wasm, debug)
  debug.phase = 'msl-loaded'

  const rawTree = wasm.list_classes()
  const tree = JSON.parse(String(rawTree)) as {
    total_classes?: unknown
    classes?: DiagnosticsClassTreeNode[]
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

  const complexNode = findQualifiedClassNode(classNodes, 'Complex')
  const complexChildNames = directQualifiedChildNames(complexNode)
  const expectedComplexMembers =
    loadParsed.load_mode === 'parsed'
      ? [
          "Complex.'constructor'",
          "Complex.'constructor'.fromReal",
          "Complex.'0'",
          "Complex.'-'.negate",
          "Complex.'-'.subtract",
          "Complex.'*'.multiply",
          "Complex.'*'.scalarProduct",
          "Complex.'+'",
          "Complex.'String'",
        ]
      : [
          'Complex.constructor',
          'Complex.constructor.fromReal',
          'Complex.0',
          'Complex.-.negate',
          'Complex.-.subtract',
          'Complex.*.multiply',
          'Complex.*.scalarProduct',
          'Complex.+',
          'Complex.String',
        ]
  const missingExpectedComplexMembers = expectedComplexMembers.filter(
    (qualifiedName) => !allQualifiedNames.includes(qualifiedName),
  )
  const leakedComplexMembers = [
    'Complex.fromReal',
    'Complex.negate',
    'Complex.subtract',
    'Complex.multiply',
    'Complex.scalarProduct',
    'Complex.function',
    'Complex.constructor.s',
    'Complex.constructor.fromReal.returns',
    'Complex.*.scalarProduct.returns',
    'Complex.*.s',
    'Complex.containing',
    'Complex.tests',
  ].filter((qualifiedName) => allQualifiedNames.includes(qualifiedName))

  debug.loadMode = loadParsed.load_mode
  debug.complexChildNames = complexChildNames
  debug.leakedComplexMembers = leakedComplexMembers
  debug.missingExpectedComplexMembers = missingExpectedComplexMembers

  if (!complexNode) {
    throw new Error('Expected Complex root node in MSL class tree')
  }
  if (leakedComplexMembers.length > 0 || missingExpectedComplexMembers.length > 0) {
    throw new Error(
      [
        'MSL class tree shape regression around Complex operator record.',
        `leaked=${leakedComplexMembers.join(',') || 'none'}`,
        `missing=${missingExpectedComplexMembers.join(',') || 'none'}`,
        `complex_children=${complexChildNames.join(',') || 'none'}`,
      ].join(' '),
    )
  }

  return {
    ok: true,
    libraryFileCount,
    totalClasses,
    hasModelicaRoot,
    hasKnownPackage,
    loadMode: loadParsed.load_mode,
    complexChildNames,
    classPreview: allQualifiedNames.slice(0, 20),
  }
}

export async function testModelicaMslCompileAndRunSmoke(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  const debug: Record<string, unknown> = {
    mslZipPath: MSL_DIAGNOSTICS_ZIP_URL,
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

    const compilation = compileDiagnosticJavaScript(wasm, source, 'MslConstRamp', generator)
    const compiledRaw = compilation.compileResponse
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

    const rendered = compilation.rendered
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
      modelProbeResult = await executeModelicaDiagnosticInSandbox(
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
      const rawAbiResult = await executeModelicaDiagnosticInSandbox(
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
      runResult = await executeModelicaDiagnosticInSandbox(
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
      mslZipPath: MSL_DIAGNOSTICS_ZIP_URL,
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
testModelicaMslCompileAndRunSmoke.modelicaGenerators = ['dae', 'solve'] as const

async function runModelicaMslFirstOrderJavaScriptSimulation(generator: ModelicaGenerator) {
  const debug: Record<string, unknown> = {
    phase: 'init',
    mslZipPath: MSL_DIAGNOSTICS_ZIP_URL,
    runtime: 'browser-sandbox',
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

    const source = `
model MslFirstOrderRuntimeSmoke
  Modelica.Blocks.Sources.Step step(height = 1, startTime = 0.1);
  Modelica.Blocks.Continuous.FirstOrder firstOrder(T = 0.5, k = 1);
equation
  connect(step.y, firstOrder.u);
end MslFirstOrderRuntimeSmoke;
`.trim()

    debug.phase = 'compile-with-libraries'
    const compilation = compileDiagnosticJavaScript(
      wasm,
      source,
      'MslFirstOrderRuntimeSmoke',
      generator,
    )
    const compiledRaw = compilation.compileResponse
    debug.phase = 'compiled'
    const compiled = JSON.parse(String(compiledRaw)) as {
      dae?: unknown
      dae_native?: unknown
      dae_prepared?: unknown
      pretty?: string
    }
    const dae = selectDaeForTemplate(compiled, { usePreparedDae: true })
    if (!dae) {
      throw new Error('compile_to_json returned no DAE payload for MSL first-order runtime smoke')
    }

    debug.phase = 'render-javascript-template'
    const rendered = compilation.rendered
    fullGeneratedCode = rendered
    debug.renderedPreview = rendered.slice(0, 220)
    debug.generatedCodeLength = rendered.length

    debug.phase = 'build-worker-sandbox-code'
    const runId = 'modelica-msl-first-order-runtime-smoke'
    const runCode = await buildWorkerSandboxCodeChecked(rendered, runId)
    const runAbort = new AbortController()
    type SimResult = {
      meta?: {
        nSteps?: number
        stopReason?: string
        stopError?: string
        model?: {
          stateNames?: string[]
          algebraicNames?: string[]
          inputNames?: string[]
        }
      }
      data?: {
        t?: unknown[]
        x?: unknown[] | Record<string, unknown>
        y?: unknown[] | Record<string, unknown>
      }
    }
    const asFiniteSeries = (value: unknown): number[] =>
      Array.isArray(value)
        ? value.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
        : []
    const getSeriesByName = (bag: unknown, name: string): number[] => {
      if (!bag || typeof bag !== 'object' || Array.isArray(bag)) return []
      const record = bag as Record<string, unknown>
      const direct = asFiniteSeries(record[name])
      if (direct.length > 0) return direct
      const alt = asFiniteSeries(record[name.replaceAll('.', '__')])
      if (alt.length > 0) return alt
      return []
    }
    const getSimulationSeriesByName = (
      result: SimResult | undefined,
      name: string,
      preferredBag: 'x' | 'y',
    ): number[] => {
      const preferredSeries = getSeriesByName(result?.data?.[preferredBag], name)
      if (preferredSeries.length > 0) return preferredSeries
      const fallbackBag = preferredBag === 'x' ? 'y' : 'x'
      return getSeriesByName(result?.data?.[fallbackBag], name)
    }
    const getBagKeys = (bag: unknown): string[] =>
      bag && typeof bag === 'object' && !Array.isArray(bag)
        ? Object.keys(bag as Record<string, unknown>)
        : []

    let runResult: SimResult
    try {
      debug.phase = 'execute-generated-js'
      runResult = await executeModelicaDiagnosticInSandbox(
        {
          id: runId,
          code: runCode,
          sourceURL: `${runId}.js`,
          stopSignal: runAbort.signal,
        },
        {
          sim: {
            t0: 0,
            tf: 1,
            dt: 0.02,
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

    debug.phase = 'validate-simulation-payload'
    const times = Array.isArray(runResult?.data?.t) ? runResult.data.t : []
    const firstOrderSeries = getSimulationSeriesByName(runResult, 'firstOrder.y', 'x')
    debug.runResultPreview = {
      meta: runResult?.meta,
      timeSamples: times.length,
      yKeys: getBagKeys(runResult?.data?.y).slice(0, 20),
      xKeys: getBagKeys(runResult?.data?.x).slice(0, 20),
      firstOrderSamples: firstOrderSeries.slice(0, 8),
    }

    if (runResult?.meta?.stopReason) {
      throw new Error(
        `MSL first-order runtime smoke stopped early: ${runResult.meta.stopReason} (${runResult.meta.stopError ?? 'n/a'})`,
      )
    }
    if (times.length < 10) {
      throw new Error(
        `MSL first-order runtime smoke returned too few time samples: ${times.length}`,
      )
    }
    if (firstOrderSeries.length !== times.length) {
      throw new Error(
        `MSL first-order runtime smoke missing or mismatched firstOrder.y series: series=${firstOrderSeries.length}, times=${times.length}`,
      )
    }
    if (firstOrderSeries.some((value) => !Number.isFinite(value))) {
      throw new Error('MSL first-order runtime smoke produced non-finite firstOrder.y values')
    }

    const start = firstOrderSeries[0] ?? Number.NaN
    const finish = firstOrderSeries[firstOrderSeries.length - 1] ?? Number.NaN
    if (!(finish > start + 0.2)) {
      throw new Error(
        `MSL first-order runtime smoke did not respond to the step input as expected (start=${start}, end=${finish})`,
      )
    }

    return {
      ok: true,
      runtime: 'browser-sandbox',
      model: 'MslFirstOrderRuntimeSmoke',
      timeSamples: times.length,
      firstOrderStart: start,
      firstOrderEnd: finish,
      mslLibraryFiles: libraryFileCount,
      parsedCount: Number(loadParsed.parsed_count ?? 0),
      skippedCount: Array.isArray(loadParsed.skipped_files) ? loadParsed.skipped_files.length : 0,
      conflictCount: Array.isArray(loadParsed.conflicts) ? loadParsed.conflicts.length : 0,
    }
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    throw new Error(
      [baseMessage, `MSL first-order runtime smoke debug:\n${debugDump}`].join('\n'),
      {
        cause: {
          generatedCodeSerialized: serializeObject(
            fullGeneratedCode || '[generated code unavailable]',
            MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS,
          ),
        },
      },
    )
  }
}

export async function testModelicaMslFirstOrderRumocaSimulation(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  return runModelicaMslFirstOrderJavaScriptSimulation(generator)
}
testModelicaMslFirstOrderRumocaSimulation.modelicaGenerators = ['dae', 'solve'] as const

export async function testModelicaMslFirstOrderNativeSimulation(
  storageClient?: TaskyonStorageClient,
) {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return {
      skipped: true,
      reason: 'Native Rumoca simulation requires the Node diagnostics runtime.',
    }
  }
  const nodeDiagnosticsModule = './modelicaDiagnosticsCliNode.ts'
  const { runModelicaCliMslFirstOrderRumocaSimulation } = (await import(
    /* @vite-ignore */ nodeDiagnosticsModule
  )) as {
    runModelicaCliMslFirstOrderRumocaSimulation: (
      storageClient: TaskyonStorageClient,
    ) => ReturnType<typeof runModelicaMslFirstOrderJavaScriptSimulation>
  }
  if (!storageClient) throw new Error('Node Modelica diagnostics require a StorageClient.')
  return runModelicaCliMslFirstOrderRumocaSimulation(storageClient)
}
testModelicaMslFirstOrderRumocaSimulation.timeoutMs = 120_000

export async function testModelicaMslResistorManualFlattenAndBaseDae() {
  const debug: Record<string, unknown> = {
    phase: 'init',
    mslZipPath: MSL_DIAGNOSTICS_ZIP_URL,
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

      const daeJson = daeJsonForTemplate(compiled, { usePreparedDae: true })
      const prettyText = String(compiled.pretty ?? '')
      const prettyParsed = (() => {
        try {
          return JSON.parse(prettyText) as Record<string, unknown>
        } catch {
          return null
        }
      })()

      const inspectText = renderRumocaTemplate({
        wasm,
        daeJson,
        templateSource: MODELICA_CONTEXT_INSPECT_TEMPLATE,
        modelName,
        templatePath: 'context-inspect.jinja',
        outputPath: `${modelName}.inspect.txt`,
        targetName: 'template',
      })
      const inspectRows = inspectText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => line.split('|'))
      const variables = inspectRows
        .filter((row) => row[0] === 'var')
        .map((row) => ({
          role: row[1] ?? '',
          name: row[2] ?? '',
          scalarNames: (row[3] ?? '').split(',').filter((name) => name.length > 0),
        }))
      const namesForRoles = (roles: string[]): string[] =>
        variables
          .filter((v) => roles.includes(v.role))
          .flatMap((v) => (v.scalarNames.length > 0 ? v.scalarNames : v.name ? [v.name] : []))
      const countRoles = (roles: string[]): number =>
        variables.filter((v) => roles.includes(v.role)).length
      const xNames = namesForRoles(['state'])
      const yNames = namesForRoles(['algebraic', 'output'])
      const continuousOwners = inspectRows.filter(
        (row) => row[0] === 'owner' && row[1] === 'continuous',
      )
      const eqs = continuousOwners.filter((row) => row[2] === 'residual')
      const condEqs = inspectRows.filter((row) => row[0] === 'condition')
      const whenClauses = inspectRows.filter(
        (row) => (row[0] === 'discrete_real' || row[0] === 'discrete_value') && row[1] === 'when',
      )
      const equationSummaries = continuousOwners
        .slice(0, 40)
        .map((row, idx) =>
          row[2] === 'structured'
            ? `${idx + 1}. structured family domain=${row[5] ?? '?'} rows=${row[3] ?? '?'}`
            : `${idx + 1}. residual#${row[4] ?? '?'} = <expr>`,
        )

      let baseDaeRendered = ''
      let baseDaeRenderError = ''
      try {
        baseDaeRendered = renderRumocaTemplate({
          wasm,
          daeJson,
          templateSource: baseDaeTemplate,
          modelName,
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
            p: countRoles(['parameter']),
            cp: countRoles(['constant']),
            x: xNames.length,
            y: yNames.length,
            z: countRoles(['discrete_real']),
            f_x:
              eqs.length +
              continuousOwners
                .filter((row) => row[2] === 'structured')
                .reduce((sum, row) => sum + Number(row[3] ?? 0), 0),
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

type ModelicaResistorSimResult = {
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

type ResistorRunPayload = {
  nSteps: number
  tLen: number
  xLen: number
  yLen: number
  stateCount: number
  algebraicCount: number
}

type ResistorModelNames = {
  stateNames: string[]
  algebraicNames: string[]
  inputNames: string[]
  conditionNames: string[]
}

type ResistorUnitInfo = {
  unitByName: Record<string, string>
  withUnitCount: number
  totalCount: number
}

type ResistorUnitState = {
  stateUnitInfo: ResistorUnitInfo
  algebraicUnitInfo: ResistorUnitInfo
  inputUnitInfo: ResistorUnitInfo
  conditionUnitInfo: ResistorUnitInfo
  totalPhysicalUnitCount: number
}

type ResistorSeriesState = {
  xSeriesByName: Record<string, number[]>
  xAmp: number
  yAmp: number
  xTemporal: number
  yTemporal: number
  xActive: number
  yActive: number
}

type ResistorSeriesSummaryEntry = {
  len: number
  min: number | null
  max: number | null
  first: number[]
  last: number[]
  maxDelta: number
}

function toFiniteNumberArray(values: unknown[]): number[] {
  return values.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
}

function getSeriesSampleLength(seriesData: unknown): number {
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

function getSeriesArrays(seriesData: unknown): number[][] {
  if (Array.isArray(seriesData)) {
    if (seriesData.length > 0 && Array.isArray(seriesData[0])) {
      return (seriesData as unknown[][]).map((row) => toFiniteNumberArray(row))
    }
    return [toFiniteNumberArray(seriesData)]
  }
  if (seriesData && typeof seriesData === 'object') {
    return Object.values(seriesData as Record<string, unknown>).flatMap((v) =>
      Array.isArray(v) ? [toFiniteNumberArray(v)] : [],
    )
  }
  return []
}

function mapSeriesByNames(
  seriesData: unknown,
  names: string[],
  fallbackPrefix: string,
): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  if (Array.isArray(seriesData)) {
    if (seriesData.length > 0 && Array.isArray(seriesData[0])) {
      const rows = seriesData as unknown[][]
      for (let i = 0; i < rows.length; i++) {
        const key = names[i] ?? `${fallbackPrefix}[${i}]`
        out[key] = toFiniteNumberArray(rows[i] ?? [])
      }
    } else {
      const key = names[0] ?? `${fallbackPrefix}[0]`
      out[key] = toFiniteNumberArray(seriesData)
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
        out[name] = toFiniteNumberArray(value)
      }
    }
    for (const key of availableKeys) {
      const value = obj[key]
      if (Array.isArray(value) && !(key in out)) {
        out[key] = toFiniteNumberArray(value)
      }
    }
  }
  return out
}

function getSeriesAmplitude(seriesData: unknown, skipLeadingSamples = 0): number {
  const collect = (arr: unknown[]): number[] =>
    arr.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  let flat: number[] = []
  if (Array.isArray(seriesData)) {
    if (seriesData.length > 0 && Array.isArray(seriesData[0])) {
      flat = (seriesData as unknown[][]).flatMap((row) => collect(row.slice(skipLeadingSamples)))
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

function getMaxTemporalDelta(seriesData: unknown, startIndex = 1): number {
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

function countActiveSeries(seriesData: unknown, deltaThreshold = 1e-8): number {
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

function summarizeSeries(
  seriesMap: Record<string, number[]>,
  maxSeries = 12,
): Record<string, ResistorSeriesSummaryEntry> {
  const summary: Record<string, ResistorSeriesSummaryEntry> = {}
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

function rankTemporalSeries(seriesMap: Record<string, number[]>, maxSeries = 12) {
  return Object.entries(seriesMap)
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
}

function mapResistorUnits(vars: unknown, expectedNames: string[]): ResistorUnitInfo {
  const unitByName: Record<string, string> = {}
  const list = Array.isArray(vars) ? vars : []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const name = typeof item.name === 'string' ? item.name.trim() : ''
    const unit = typeof item.unit === 'string' ? item.unit.trim() : ''
    const normalized = unit.toLowerCase()
    if (!name || !unit || normalized === 'none' || normalized === 'null') continue
    unitByName[name] = unit
  }
  const withUnitCount = expectedNames.filter((name) => typeof unitByName[name] === 'string').length
  return {
    unitByName,
    withUnitCount,
    totalCount: expectedNames.length,
  }
}

function buildPlotPathUnitsPreview(units: ResistorUnitState) {
  const prefixedUnits = (unitByName: Record<string, string>, prefix: string) =>
    Object.fromEntries(
      Object.entries(unitByName)
        .slice(0, 20)
        .map(([name, unit]) => [`${prefix}.${name}`, unit]),
    )
  return {
    t: 's',
    ...prefixedUnits(units.stateUnitInfo.unitByName, 'x'),
    ...prefixedUnits(units.algebraicUnitInfo.unitByName, 'y'),
    ...prefixedUnits(units.inputUnitInfo.unitByName, 'u'),
    ...prefixedUnits(units.conditionUnitInfo.unitByName, 'z'),
  }
}

async function loadResistorWasm(debug: Record<string, unknown>): Promise<DiagnosticsWasm> {
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
  return wasm
}

async function compileResistorExample(
  wasm: DiagnosticsWasm,
  debug: Record<string, unknown>,
  generator: ModelicaGenerator,
) {
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
  const compilation = compileDiagnosticJavaScript(wasm, source, 'MslResistorExample', generator)
  const compiledRaw = compilation.compileResponse
  debug.phase = 'compiled'
  const compiled = JSON.parse(String(compiledRaw)) as {
    dae?: unknown
    dae_native?: unknown
    dae_prepared?: unknown
    pretty?: string
  }
  const dae = selectDaeForTemplate(compiled, { usePreparedDae: true })
  const daeJson = daeJsonForTemplate(compiled, { usePreparedDae: true })
  if (!dae) {
    throw new Error('compile_to_json returned no DAE payload for MSL resistor example')
  }
  return {
    compiled,
    dae,
    daeJson,
    prettyText: String(compiled.pretty ?? ''),
    rendered: compilation.rendered,
  }
}

function renderResistorBaseDae(
  wasm: DiagnosticsWasm,
  daeJson: string,
  modelName: string,
): { rendered: string; derivativeRefs: string[] } {
  const rendered = renderRumocaTemplate({
    wasm,
    daeJson,
    templateSource: baseDaeTemplate,
    modelName,
    templatePath: 'base_dae.jinja',
    outputPath: 'base_dae.txt',
    targetName: 'template',
  })
  return {
    rendered,
    derivativeRefs: Array.from(new Set(String(rendered).match(/der\([^)]+\)/g) ?? [])),
  }
}

function collectResistorDerivativeRefs(
  wasm: DiagnosticsWasm,
  daeJson: string,
  prettyText: string,
  debug: Record<string, unknown>,
  modelName: string,
): string[] {
  debug.compiledPrettyLength = prettyText.length
  debug.compiledPrettyPreview = prettyText.slice(0, 1200)

  const derivativeRefsFromPretty = Array.from(new Set(prettyText.match(/der\([^)]+\)/g) ?? []))
  try {
    const baseDae = renderResistorBaseDae(wasm, daeJson, modelName)
    debug.baseDaeDiagnostics = {
      renderedLength: baseDae.rendered.length,
      derivativeRefCount: baseDae.derivativeRefs.length,
      derivativeRefsPreview: baseDae.derivativeRefs.slice(0, 40),
      preview: baseDae.rendered.slice(0, 1200),
    }
    return baseDae.derivativeRefs.length > 0 ? baseDae.derivativeRefs : derivativeRefsFromPretty
  } catch (baseDaeErr) {
    debug.baseDaeDiagnostics = {
      rendered: false,
      renderError: baseDaeErr instanceof Error ? baseDaeErr.message : String(baseDaeErr),
      derivativeRefCountFromPretty: derivativeRefsFromPretty.length,
      derivativeRefsPreviewFromPretty: derivativeRefsFromPretty.slice(0, 40),
    }
    return derivativeRefsFromPretty
  }
}

function collectResistorUnitDiagnostics(
  prettyText: string,
  rendered: string,
  debug: Record<string, unknown>,
): void {
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
}

async function runResistorSimulation(rendered: string, debug: Record<string, unknown>) {
  debug.phase = 'build-worker-sandbox-code'
  const runId = 'modelica-msl-resistor-example-run'
  const runCode = await buildWorkerSandboxCodeChecked(rendered, runId)
  const runAbort = new AbortController()
  try {
    debug.phase = 'execute-generated-js'
    const runResult = await executeModelicaDiagnosticInSandbox<ModelicaResistorSimResult>(
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
    return {
      runResult,
      serializedRunResult: serializeObject(runResult, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
    }
  } finally {
    runAbort.abort()
  }
}

function validateResistorRunPayload(
  runResult: ModelicaResistorSimResult,
  debug: Record<string, unknown>,
): ResistorRunPayload {
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
  const names = readResistorModelNames(runResult)
  return {
    nSteps,
    tLen,
    xLen,
    yLen,
    stateCount: names.stateNames.length,
    algebraicCount: names.algebraicNames.length,
  }
}

function readResistorModelNames(runResult: ModelicaResistorSimResult): ResistorModelNames {
  const model = runResult?.meta?.model
  return {
    stateNames: Array.isArray(model?.stateNames) ? model.stateNames : [],
    algebraicNames: Array.isArray(model?.algebraicNames) ? model.algebraicNames : [],
    inputNames: Array.isArray(model?.inputNames) ? model.inputNames : [],
    conditionNames: Array.isArray(model?.conditionNames) ? model.conditionNames : [],
  }
}

function collectResistorUnitState(
  runResult: ModelicaResistorSimResult,
  names: ResistorModelNames,
  debug: Record<string, unknown>,
): ResistorUnitState {
  const model = runResult?.meta?.model
  const units: ResistorUnitState = {
    stateUnitInfo: mapResistorUnits(model?.stateVariables, names.stateNames),
    algebraicUnitInfo: mapResistorUnits(model?.algebraicVariables, names.algebraicNames),
    inputUnitInfo: mapResistorUnits(model?.inputVariables, names.inputNames),
    conditionUnitInfo: mapResistorUnits(model?.conditionVariables, names.conditionNames),
    totalPhysicalUnitCount: 0,
  }
  units.totalPhysicalUnitCount =
    units.stateUnitInfo.withUnitCount +
    units.algebraicUnitInfo.withUnitCount +
    units.inputUnitInfo.withUnitCount +
    units.conditionUnitInfo.withUnitCount

  const existingUnitDiagnostics =
    debug.unitDiagnostics && typeof debug.unitDiagnostics === 'object'
      ? (debug.unitDiagnostics as Record<string, unknown>)
      : {}
  const runtimeSummary = (info: ResistorUnitInfo) => ({
    withUnitCount: info.withUnitCount,
    totalCount: info.totalCount,
    preview: Object.fromEntries(Object.entries(info.unitByName).slice(0, 25)),
  })
  debug.unitDiagnostics = {
    ...existingUnitDiagnostics,
    runtime: {
      stateUnits: runtimeSummary(units.stateUnitInfo),
      algebraicUnits: runtimeSummary(units.algebraicUnitInfo),
      inputUnits: runtimeSummary(units.inputUnitInfo),
      conditionUnits: runtimeSummary(units.conditionUnitInfo),
      plotPathUnitsPreview: buildPlotPathUnitsPreview(units),
      totalPhysicalUnitCount: units.totalPhysicalUnitCount,
    },
  }
  return units
}

function assertResistorUnitsPresent(
  totalPhysicalUnitCount: number,
  debug: Record<string, unknown>,
): void {
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
}

function collectResistorSeriesState(
  runResult: ModelicaResistorSimResult,
  names: ResistorModelNames,
  debug: Record<string, unknown>,
): ResistorSeriesState {
  const xSeriesByName = mapSeriesByNames(runResult?.data?.x, names.stateNames, 'x')
  const ySeriesByName = mapSeriesByNames(runResult?.data?.y, names.algebraicNames, 'y')
  debug.seriesDiagnostics = {
    stateCount: names.stateNames.length,
    algebraicCount: names.algebraicNames.length,
    stateNames: names.stateNames,
    algebraicNamesPreview: names.algebraicNames.slice(0, 40),
    stateSeriesSummary: summarizeSeries(xSeriesByName, 20),
    algebraicSeriesSummary: summarizeSeries(ySeriesByName, 20),
    topTemporalStates: rankTemporalSeries(xSeriesByName, 12),
    topTemporalAlgebraics: rankTemporalSeries(ySeriesByName, 12),
    stateSeriesValues: xSeriesByName,
  }

  const state: ResistorSeriesState = {
    xSeriesByName,
    xAmp: getSeriesAmplitude(runResult?.data?.x, 1),
    yAmp: getSeriesAmplitude(runResult?.data?.y, 1),
    xTemporal: getMaxTemporalDelta(runResult?.data?.x, 2),
    yTemporal: getMaxTemporalDelta(runResult?.data?.y, 2),
    xActive: countActiveSeries(runResult?.data?.x),
    yActive: countActiveSeries(runResult?.data?.y),
  }
  debug.runSignalStats = {
    xAmp: state.xAmp,
    yAmp: state.yAmp,
    xTemporal: state.xTemporal,
    yTemporal: state.yTemporal,
    xActive: state.xActive,
    yActive: state.yActive,
  }
  return state
}

function assertResistorAlgebraicDynamics(
  payload: ResistorRunPayload,
  series: ResistorSeriesState,
  derivativeRefs: string[],
): void {
  if (payload.stateCount !== 0) return
  const algebraicDynamicsDetected =
    payload.yLen > 1 && series.yActive > 0 && Math.max(series.yAmp, series.yTemporal) > 1.0e-6
  if (algebraicDynamicsDetected) return
  throw new Error(
    [
      'MSL resistor example produced zero states and no convincing algebraic dynamics',
      `stateCount=${payload.stateCount}`,
      `algebraicCount=${payload.algebraicCount}`,
      `xLen=${payload.xLen}`,
      `yLen=${payload.yLen}`,
      `xAmp=${series.xAmp}`,
      `yAmp=${series.yAmp}`,
      `xTemporal=${series.xTemporal}`,
      `yTemporal=${series.yTemporal}`,
      `xActive=${series.xActive}`,
      `yActive=${series.yActive}`,
      `baseDae.derivativeRefCount=${derivativeRefs.length}`,
      `baseDae.derivativeRefsPreview=${serializeObject(derivativeRefs.slice(0, 20), MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
    ].join('\n'),
  )
}

function assertResistorSignalAmplitude(series: ResistorSeriesState): void {
  if (Math.max(series.xAmp, series.yAmp) > 1.0e-6) return
  throw new Error(
    [
      'MSL resistor example run has near-zero signal amplitude',
      `xAmp=${series.xAmp}`,
      `yAmp=${series.yAmp}`,
      `xTemporal=${series.xTemporal}`,
      `yTemporal=${series.yTemporal}`,
      `xActive=${series.xActive}`,
      `yActive=${series.yActive}`,
    ].join(', '),
  )
}

function assertResistorTemporalEvolution(
  payload: ResistorRunPayload,
  series: ResistorSeriesState,
): void {
  if (payload.stateCount === 0 || Math.max(series.xTemporal, series.yTemporal) > 1.0e-10) return
  throw new Error(
    [
      'MSL resistor example appears static after initialization; expected dynamic evolution for stateful model',
      `stateCount=${payload.stateCount}`,
      `algebraicCount=${payload.algebraicCount}`,
      `xAmp=${series.xAmp}`,
      `yAmp=${series.yAmp}`,
      `xTemporal=${series.xTemporal}`,
      `yTemporal=${series.yTemporal}`,
      `xActive=${series.xActive}`,
      `yActive=${series.yActive}`,
    ].join(', '),
  )
}

function assertResistorSignalDynamics(
  payload: ResistorRunPayload,
  series: ResistorSeriesState,
  derivativeRefs: string[],
): void {
  assertResistorAlgebraicDynamics(payload, series, derivativeRefs)
  assertResistorSignalAmplitude(series)
  assertResistorTemporalEvolution(payload, series)
}

function assembleResistorDiagnosticResult(
  compiled: { pretty?: string },
  rendered: string,
  run: { serializedRunResult: string },
  payload: ResistorRunPayload,
  names: ResistorModelNames,
  units: ResistorUnitState,
  series: ResistorSeriesState,
  debug: Record<string, unknown>,
) {
  return {
    ok: true,
    simulation: {
      nSteps: payload.nSteps,
      tLen: payload.tLen,
      xLen: payload.xLen,
      yLen: payload.yLen,
      stateCount: payload.stateCount,
      algebraicCount: payload.algebraicCount,
      stateNames: names.stateNames,
      algebraicNames: names.algebraicNames,
      stateSeriesValuesSerialized: serializeObject(
        series.xSeriesByName,
        MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS,
      ),
      xAmplitude: series.xAmp,
      yAmplitude: series.yAmp,
      unitsAvailable: units.totalPhysicalUnitCount > 0,
      unitDiagnosticsSerialized: serializeObject(
        debug.unitDiagnostics,
        MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS,
      ),
      serializedResult: run.serializedRunResult,
    },
    generatedCode: rendered,
    generatedCodeSerialized: serializeObject(rendered, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS),
    prettyPreview: String(compiled.pretty ?? '').slice(0, 120),
  }
}

function buildResistorDiagnosticFailure(
  err: unknown,
  debug: Record<string, unknown>,
  fullGeneratedCode: string,
): Error {
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
  return new Error(
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

export async function testModelicaMslResistorExampleSimulation(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  const debug: Record<string, unknown> = {
    phase: 'init',
    mslZipPath: MSL_DIAGNOSTICS_ZIP_URL,
  }
  let fullGeneratedCode = ''

  try {
    const wasm = await loadResistorWasm(debug)
    const compiled = await compileResistorExample(wasm, debug, generator)
    const derivativeRefs = collectResistorDerivativeRefs(
      wasm,
      compiled.daeJson,
      compiled.prettyText,
      debug,
      'MslResistorExample',
    )
    const rendered = compiled.rendered
    fullGeneratedCode = rendered
    collectResistorUnitDiagnostics(compiled.prettyText, rendered, debug)

    const run = await runResistorSimulation(rendered, debug)
    const payload = validateResistorRunPayload(run.runResult, debug)
    const names = readResistorModelNames(run.runResult)
    const units = collectResistorUnitState(run.runResult, names, debug)
    assertResistorUnitsPresent(units.totalPhysicalUnitCount, debug)
    const series = collectResistorSeriesState(run.runResult, names, debug)
    assertResistorSignalDynamics(payload, series, derivativeRefs)
    return assembleResistorDiagnosticResult(
      compiled.compiled,
      rendered,
      run,
      payload,
      names,
      units,
      series,
      debug,
    )
  } catch (err) {
    throw buildResistorDiagnosticFailure(err, debug, fullGeneratedCode)
  }
}
testModelicaMslResistorExampleSimulation.modelicaGenerators = ['dae', 'solve'] as const
testModelicaMslResistorExampleSimulation.timeoutMs = 120_000

type OrbitSolverRun = {
  meta?: {
    stopReason?: string
    stopError?: string
    stopDetails?: unknown
    warnings?: string[]
    model?: {
      stateNames?: string[]
      algebraicNames?: string[]
      solverAlgebraicNames?: string[]
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

type OrbitCompiledPayload = {
  dae?: unknown
  dae_native?: unknown
  dae_prepared?: unknown
}

type OrbitSimulationParams = {
  t0: number
  tf: number
  dt: number
  x0?: number[]
}

type OrbitDiagnosticsPreparation = {
  mode: OrbitTestMode
  parsed: OrbitCompiledPayload
  dae: Record<string, unknown>
  rendered: string
  generatedCodeDebug: ReturnType<typeof summarizeGeneratedCodeForDebug>
  runCode: string
  simParams: OrbitSimulationParams
  selectionInfo: ReturnType<typeof describeOrbitDaeSelection>
  daeDebug: ReturnType<typeof summarizeDaeForOrbitDebug>
}

type OrbitRunBundle = {
  currentRun: OrbitSolverRun
  irk4Run: OrbitSolverRun | null
}

type OrbitCanvasFrame = {
  left: number
  top: number
  width: number
  height: number
}

type OrbitCanvasRange = {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
}

function countDaeEntries(daeObj: unknown, key: string): number {
  if (!daeObj || typeof daeObj !== 'object' || Array.isArray(daeObj)) return 0
  const map = (daeObj as Record<string, unknown>)[key]
  if (!map || typeof map !== 'object' || Array.isArray(map)) return 0
  return Object.keys(map as Record<string, unknown>).length
}

function countDaeEquations(daeObj: unknown): number {
  if (!daeObj || typeof daeObj !== 'object' || Array.isArray(daeObj)) return 0
  const fx = (daeObj as Record<string, unknown>).f_x
  return Array.isArray(fx) ? fx.length : 0
}

function countDaeObservables(daeObj: unknown): number {
  if (!daeObj || typeof daeObj !== 'object' || Array.isArray(daeObj)) return 0
  const list = (daeObj as Record<string, unknown>).__rumoca_observables
  return Array.isArray(list) ? list.length : 0
}

function describeOrbitDaeSelection(
  parsed: OrbitCompiledPayload,
  selectedDae: Record<string, unknown>,
) {
  const nativeDae = parsed.dae_native ?? parsed.dae
  const preparedDae = parsed.dae_prepared
  const describe = (dae: unknown) => ({
    xCount: countDaeEntries(dae, 'x'),
    yCount: countDaeEntries(dae, 'y'),
    fxCount: countDaeEquations(dae),
    observablesCount: countDaeObservables(dae),
  })
  return {
    selected:
      selectedDae === preparedDae ? 'prepared' : selectedDae === nativeDae ? 'native' : 'unknown',
    native: describe(nativeDae),
    prepared: describe(preparedDae),
  }
}

function buildOrbitSimulationParams(): OrbitSimulationParams {
  const mu = 398600.4418
  const r0 = 7000
  const v0 = Math.sqrt(mu / r0)
  const orbitalPeriod = 2 * Math.PI * Math.sqrt((r0 * r0 * r0) / mu)
  return { t0: 0, tf: orbitalPeriod, dt: 20, x0: [r0, 0, 0, v0] }
}

function readNumericSeries(container: unknown, name: string): number[] {
  if (!container || typeof container !== 'object' || Array.isArray(container)) return []
  const record = container as Record<string, unknown>
  for (const key of [name, name.replaceAll('.', '__')]) {
    const value = record[key]
    if (Array.isArray(value)) {
      return value.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
    }
  }
  return []
}

function getStateSeries(run: OrbitSolverRun, name: string): number[] {
  return readNumericSeries(run?.data?.x, name)
}

function getAlgebraicSeries(run: OrbitSolverRun, name: string): number[] {
  return readNumericSeries(run?.data?.y, name)
}

function getOrbitTime(run: OrbitSolverRun): number[] {
  const tRaw = run?.data?.t
  if (!Array.isArray(tRaw)) return []
  return tRaw.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
}

function summarizeFiniteSeries(values: number[]) {
  const finite = values.filter((v) => Number.isFinite(v))
  return {
    finiteCount: finite.length,
    firstFiniteValues: finite.slice(0, 6).map((v) => Number(v.toPrecision(8))),
  }
}

function summarizeSeriesMap(series: Record<string, number[]>) {
  const lengths: Record<string, number> = {}
  const finiteCounts: Record<string, number> = {}
  const firstFiniteValues: Record<string, number[]> = {}
  for (const [name, values] of Object.entries(series)) {
    const summary = summarizeFiniteSeries(values)
    lengths[name] = values.length
    finiteCounts[name] = summary.finiteCount
    firstFiniteValues[name] = summary.firstFiniteValues
  }
  return { lengths, finiteCounts, firstFiniteValues }
}

function collectOrbitExtractionDebug(label: string, run: OrbitSolverRun): OrbitExtractionDebug {
  const ySeries = {
    inv_r: getAlgebraicSeries(run, 'inv_r'),
    inv_a: getAlgebraicSeries(run, 'inv_a'),
    inv_ecc: getAlgebraicSeries(run, 'inv_ecc'),
    inv_energy: getAlgebraicSeries(run, 'inv_energy'),
    inv_h: getAlgebraicSeries(run, 'inv_h'),
  }
  const summary = summarizeSeriesMap(ySeries)
  const algebraicNames = run?.meta?.model?.algebraicNames
  return {
    label,
    timeLength: getOrbitTime(run).length,
    stateLengths: {
      rx: getStateSeries(run, 'rx').length,
      ry: getStateSeries(run, 'ry').length,
      vx: getStateSeries(run, 'vx').length,
      vy: getStateSeries(run, 'vy').length,
    },
    yLengths: summary.lengths,
    yFiniteCounts: summary.finiteCounts,
    yFirstFiniteValues: summary.firstFiniteValues,
    modelAlgebraicNames: Array.isArray(algebraicNames)
      ? algebraicNames.filter((name): name is string => typeof name === 'string')
      : [],
  }
}

function readOrbitSeries(run: OrbitSolverRun) {
  return {
    t: getOrbitTime(run),
    rx: getStateSeries(run, 'rx'),
    ry: getStateSeries(run, 'ry'),
    vx: getStateSeries(run, 'vx'),
    vy: getStateSeries(run, 'vy'),
    r: getAlgebraicSeries(run, 'inv_r'),
    semiMajorAxis: getAlgebraicSeries(run, 'inv_a'),
    eccentricity: getAlgebraicSeries(run, 'inv_ecc'),
    specificEnergy: getAlgebraicSeries(run, 'inv_energy'),
    angularMomentum: getAlgebraicSeries(run, 'inv_h'),
  }
}

function collectOrbitSamples(run: OrbitSolverRun): OrbitSamples {
  const raw = readOrbitSeries(run)
  const keys = Object.keys(raw) as Array<keyof OrbitSamples>
  const count = Math.min(...keys.map((key) => raw[key].length))
  const finiteIndices: number[] = []
  for (let i = 0; i < count; i++) {
    if (keys.every((key) => Number.isFinite(raw[key][i] ?? Number.NaN))) finiteIndices.push(i)
  }
  const pick = (values: number[]) => finiteIndices.map((i) => values[i] ?? Number.NaN)
  return {
    t: pick(raw.t),
    rx: pick(raw.rx),
    ry: pick(raw.ry),
    vx: pick(raw.vx),
    vy: pick(raw.vy),
    r: pick(raw.r),
    semiMajorAxis: pick(raw.semiMajorAxis),
    eccentricity: pick(raw.eccentricity),
    specificEnergy: pick(raw.specificEnergy),
    angularMomentum: pick(raw.angularMomentum),
  }
}

function summarizeOrbitDrift(values: number[]) {
  const ref = values[0] ?? 0
  let maxAbsSeries = 0
  for (const value of values) maxAbsSeries = Math.max(maxAbsSeries, Math.abs(value))
  const baselineFloor = 1e-12
  const relativeScale = Math.abs(ref) > baselineFloor ? Math.abs(ref) : Math.max(1e-9, maxAbsSeries)
  let maxAbsDrift = 0
  for (const value of values) maxAbsDrift = Math.max(maxAbsDrift, Math.abs(value - ref))
  return {
    maxAbsoluteDrift: maxAbsDrift,
    maxNormalizedDrift: maxAbsDrift / relativeScale,
  }
}

function describeOrbitInvariant(values: number[]) {
  const drift = summarizeOrbitDrift(values)
  return {
    first: values[0],
    last: values[values.length - 1],
    maxRelativeDrift: drift.maxNormalizedDrift,
    maxAbsoluteDrift: drift.maxAbsoluteDrift,
  }
}

function collectInvariants(samples: OrbitSamples) {
  if (
    samples.semiMajorAxis.length < 4 ||
    samples.eccentricity.length < 4 ||
    samples.specificEnergy.length < 4 ||
    samples.angularMomentum.length < 4
  ) {
    throw new Error('Orbit invariants contain too few finite values')
  }
  return {
    sampleCount: samples.semiMajorAxis.length,
    semiMajorAxis: describeOrbitInvariant(samples.semiMajorAxis),
    eccentricity: describeOrbitInvariant(samples.eccentricity),
    specificEnergy: describeOrbitInvariant(samples.specificEnergy),
    angularMomentum: describeOrbitInvariant(samples.angularMomentum),
  }
}

function maxOrbitInvariantDrift(invariant: ReturnType<typeof collectInvariants>): number {
  return Math.max(
    invariant.semiMajorAxis.maxRelativeDrift,
    invariant.specificEnergy.maxRelativeDrift,
    invariant.angularMomentum.maxRelativeDrift,
    invariant.eccentricity.maxAbsoluteDrift,
  )
}

function safeOrbitLast(values: number[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    const value = values[i]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

function getRawFirstStateValues(run: OrbitSolverRun, names: string[]) {
  const values: Record<string, number | null> = {}
  for (const name of names) {
    const series = getStateSeries(run, name)
    const first = series.length > 0 ? (series[0] ?? Number.NaN) : Number.NaN
    values[name] = Number.isFinite(first) ? first : null
  }
  return values
}

function summarizeOrbitRun(label: string, run: OrbitSolverRun, samples: OrbitSamples) {
  const stateNames = run?.meta?.model?.stateNames ?? []
  return {
    label,
    stopReason: run?.meta?.stopReason ?? null,
    stopError: run?.meta?.stopError ?? null,
    stopDetails: run?.meta?.stopDetails ?? null,
    sampleCount: samples.t.length,
    tLast: safeOrbitLast(samples.t),
    rxLast: safeOrbitLast(samples.rx),
    ryLast: safeOrbitLast(samples.ry),
    vxLast: safeOrbitLast(samples.vx),
    vyLast: safeOrbitLast(samples.vy),
    rMin: samples.r.length > 0 ? Math.min(...samples.r) : null,
    rMax: samples.r.length > 0 ? Math.max(...samples.r) : null,
    stateNames,
    firstStateValues: getRawFirstStateValues(run, stateNames),
  }
}

function runOrbitNumericDiagnostics(label: string, run: OrbitSolverRun, samples: OrbitSamples) {
  const times = getOrbitTime(run)
  let firstNonFiniteTimeIndex: number | null = null
  for (let i = 0; i < times.length; i++) {
    if (!Number.isFinite(times[i] ?? Number.NaN)) {
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

async function runOrbitSimulation(
  runCode: string,
  simParams: OrbitSimulationParams,
  runId: string,
  solverOptions?: Record<string, unknown>,
): Promise<OrbitSolverRun> {
  const abort = new AbortController()
  try {
    return await executeModelicaDiagnosticInSandbox(
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

function summarizeOrbitGeneratedCode(code: ReturnType<typeof summarizeGeneratedCodeForDebug>) {
  return { length: code.length, lineCount: code.lineCount, checksum: code.checksum }
}

async function prepareOrbitDiagnostics(
  mode: OrbitTestMode,
  templateSource: string,
): Promise<OrbitDiagnosticsPreparation> {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: exampleModels.orbit,
    modelName: 'SatelliteOrbit2D',
    templates: [{ source: templateSource, path: 'model.jinja' }],
  })
  const parsed = JSON.parse(compilation.compileResponse) as OrbitCompiledPayload
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) throw new Error('Rumoca returned no DAE payload for SatelliteOrbit2D')
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing generated Orbit model')
  const rendered = generated.content
  const runCode = await buildWorkerSandboxCodeChecked(
    rendered,
    'modelica-satellite-orbit-2d-runtime',
  )
  return {
    mode,
    parsed,
    dae,
    rendered,
    generatedCodeDebug: summarizeGeneratedCodeForDebug(rendered),
    runCode,
    simParams: buildOrbitSimulationParams(),
    selectionInfo: describeOrbitDaeSelection(parsed, dae),
    daeDebug: summarizeDaeForOrbitDebug(dae),
  }
}

function makeOrbitBootFailure(
  preparation: OrbitDiagnosticsPreparation,
  phase: string,
  label: string,
  error: unknown,
): Error {
  const errorMessage = error instanceof Error ? error.message : String(error)
  return makeOrbitFailure(
    `Orbit ${label} failed before producing results: ${errorMessage}`,
    {
      mode: preparation.mode,
      phase,
      simParams: preparation.simParams,
      daeDebug: preparation.daeDebug,
      generatedCode: summarizeOrbitGeneratedCode(preparation.generatedCodeDebug),
      errorMessage,
    },
    preparation.generatedCodeDebug,
    preparation.rendered,
  )
}

async function runOrbitSolverRuns(
  preparation: OrbitDiagnosticsPreparation,
): Promise<OrbitRunBundle> {
  let currentRun: OrbitSolverRun
  try {
    currentRun = await runOrbitSimulation(
      preparation.runCode,
      preparation.simParams,
      'modelica-orbit-current-sdirk2',
    )
  } catch (error) {
    throw makeOrbitBootFailure(preparation, 'run-current', 'current run', error)
  }
  if (preparation.mode !== 'compare') return { currentRun, irk4Run: null }
  try {
    const irk4Run = await runOrbitSimulation(
      preparation.runCode,
      preparation.simParams,
      'modelica-orbit-irk4',
      { timeIntegrator: 'irk4' },
    )
    return { currentRun, irk4Run }
  } catch (error) {
    throw makeOrbitBootFailure(preparation, 'run-irk4', 'irk4 run', error)
  }
}

function buildOrbitDebugSummary(
  preparation: OrbitDiagnosticsPreparation,
  runs: OrbitRunBundle,
  currentSamples: OrbitSamples,
  irk4Samples: OrbitSamples | null,
) {
  return {
    mode: preparation.mode,
    simParams: preparation.simParams,
    compileSelection: preparation.selectionInfo,
    daeDebug: preparation.daeDebug,
    generatedCode: summarizeOrbitGeneratedCode(preparation.generatedCodeDebug),
    current: summarizeOrbitRun('current', runs.currentRun, currentSamples),
    irk4: runs.irk4Run && irk4Samples ? summarizeOrbitRun('irk4', runs.irk4Run, irk4Samples) : null,
    diagnostics: {
      current: runOrbitNumericDiagnostics('current', runs.currentRun, currentSamples),
      irk4:
        runs.irk4Run && irk4Samples
          ? runOrbitNumericDiagnostics('irk4', runs.irk4Run, irk4Samples)
          : null,
    },
    extractionDiagnostics: {
      current: collectOrbitExtractionDebug('current', runs.currentRun),
      irk4: runs.irk4Run ? collectOrbitExtractionDebug('irk4', runs.irk4Run) : null,
    },
  }
}

function assertOrbitRunStability(
  preparation: OrbitDiagnosticsPreparation,
  runs: OrbitRunBundle,
  debugSummary: Record<string, unknown>,
) {
  const currentReason = runs.currentRun?.meta?.stopReason ?? ''
  if (currentReason) {
    throw makeOrbitFailure(
      `Current solver orbit run stopped early: ${currentReason} (${runs.currentRun?.meta?.stopError ?? ''})`,
      debugSummary,
      preparation.generatedCodeDebug,
      preparation.rendered,
    )
  }
  const irk4Reason = runs.irk4Run?.meta?.stopReason ?? ''
  if (runs.irk4Run && irk4Reason) {
    throw makeOrbitFailure(
      `IRK4 solver orbit run stopped early: ${irk4Reason} (${runs.irk4Run?.meta?.stopError ?? ''})`,
      debugSummary,
      preparation.generatedCodeDebug,
      preparation.rendered,
    )
  }
}

function collectOrbitInvariantSet(
  currentSamples: OrbitSamples,
  irk4Samples: OrbitSamples | null,
  preparation: OrbitDiagnosticsPreparation,
  debugSummary: Record<string, unknown>,
) {
  try {
    return {
      currentInv: collectInvariants(currentSamples),
      irk4Inv: irk4Samples ? collectInvariants(irk4Samples) : null,
    }
  } catch (error) {
    throw makeOrbitFailure(
      `Invariant extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      debugSummary,
      preparation.generatedCodeDebug,
      preparation.rendered,
    )
  }
}

function assertOrbitInvariantDrift(
  currentMaxDrift: number,
  irk4MaxDrift: number | null,
  debugSummary: Record<string, unknown>,
  preparation: OrbitDiagnosticsPreparation,
) {
  if (
    !Number.isFinite(currentMaxDrift) ||
    (irk4MaxDrift !== null && !Number.isFinite(irk4MaxDrift))
  ) {
    throw makeOrbitFailure(
      `Orbit invariants contain non-finite drift metrics; current=${currentMaxDrift}, irk4=${String(irk4MaxDrift)}`,
      debugSummary,
      preparation.generatedCodeDebug,
      preparation.rendered,
    )
  }
  if (irk4MaxDrift !== null && irk4MaxDrift > currentMaxDrift * 1.25 + 1e-12) {
    throw makeOrbitFailure(
      `IRK4 should be at least comparable on invariants drift; current=${currentMaxDrift}, irk4=${irk4MaxDrift}`,
      debugSummary,
      preparation.generatedCodeDebug,
      preparation.rendered,
    )
  }
}

function assembleOrbitDiagnosticResult(
  preparation: OrbitDiagnosticsPreparation,
  currentInv: ReturnType<typeof collectInvariants>,
  irk4Inv: ReturnType<typeof collectInvariants> | null,
  currentMaxDrift: number,
  irk4MaxDrift: number | null,
  debugSummary: Record<string, unknown>,
) {
  return {
    ok: true,
    model: 'SatelliteOrbit2D',
    sim: preparation.simParams,
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
    generatedCode: summarizeOrbitGeneratedCode(preparation.generatedCodeDebug),
  }
}

function plotCanvasPolyline(
  ctx: CanvasRenderingContext2D,
  frame: OrbitCanvasFrame,
  range: OrbitCanvasRange,
  xValues: number[],
  yValues: number[],
  color: string,
) {
  const count = Math.min(xValues.length, yValues.length)
  ctx.beginPath()
  let started = false
  for (let i = 0; i < count; i++) {
    const xv = xValues[i] ?? Number.NaN
    const yv = yValues[i] ?? Number.NaN
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue
    const px =
      frame.left + ((xv - range.xMin) / (range.xMax - range.xMin)) * (frame.width - 20) + 10
    const py =
      frame.top +
      frame.height -
      (((yv - range.yMin) / (range.yMax - range.yMin)) * (frame.height - 26) + 10)
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

function computeOrbitSeriesRange(
  xValues: number[],
  valuesA: number[],
  valuesB: number[],
): OrbitCanvasRange | null {
  const count = Math.min(xValues.length, valuesA.length, valuesB.length)
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (let i = 0; i < count; i++) {
    const xv = xValues[i] ?? Number.NaN
    const ya = valuesA[i] ?? Number.NaN
    const yb = valuesB[i] ?? Number.NaN
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
    return null
  }
  if (Math.abs(xMax - xMin) < 1e-12) xMax = xMin + 1
  if (Math.abs(yMax - yMin) < 1e-12) yMax = yMin + 1
  return { xMin, xMax, yMin, yMax }
}

function drawOrbitSeriesPanel(
  ctx: CanvasRenderingContext2D,
  frame: OrbitCanvasFrame,
  series: {
    xValues: number[]
    valuesA: number[]
    valuesB: number[]
    title: string
    colorA: string
    colorB: string
  },
) {
  const count = Math.min(series.xValues.length, series.valuesA.length, series.valuesB.length)
  if (count < 1) {
    ctx.strokeStyle = '#999'
    ctx.strokeRect(frame.left, frame.top, frame.width, frame.height)
    ctx.fillStyle = '#444'
    ctx.fillText(`${series.title} (not enough data)`, frame.left + 8, frame.top + 16)
    return
  }
  const range = computeOrbitSeriesRange(series.xValues, series.valuesA, series.valuesB)
  if (!range) return
  ctx.strokeStyle = '#999'
  ctx.strokeRect(frame.left, frame.top, frame.width, frame.height)
  ctx.fillStyle = '#222'
  ctx.font = '12px sans-serif'
  ctx.fillText(series.title, frame.left + 8, frame.top + 16)
  plotCanvasPolyline(ctx, frame, range, series.xValues, series.valuesA, series.colorA)
  plotCanvasPolyline(ctx, frame, range, series.xValues, series.valuesB, series.colorB)
}

function computeOrbitXYRange(
  a: OrbitSamples,
  b: OrbitSamples,
  count: number,
): OrbitCanvasRange | null {
  let xMin = Infinity
  let xMax = -Infinity
  let yMin = Infinity
  let yMax = -Infinity
  for (let i = 0; i < count; i++) {
    for (const xv of [a.rx[i], b.rx[i]]) {
      if (typeof xv === 'number' && Number.isFinite(xv)) {
        xMin = Math.min(xMin, xv)
        xMax = Math.max(xMax, xv)
      }
    }
    for (const yv of [a.ry[i], b.ry[i]]) {
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
    return null
  }
  const span = Math.max(Math.abs(xMax - xMin), Math.abs(yMax - yMin), 1)
  const cx = 0.5 * (xMin + xMax)
  const cy = 0.5 * (yMin + yMax)
  return { xMin: cx - span / 2, xMax: cx + span / 2, yMin: cy - span / 2, yMax: cy + span / 2 }
}

function drawOrbitXYPanel(
  ctx: CanvasRenderingContext2D,
  frame: OrbitCanvasFrame,
  a: OrbitSamples,
  b: OrbitSamples,
) {
  const count = Math.min(a.rx.length, a.ry.length, b.rx.length, b.ry.length)
  ctx.strokeStyle = '#999'
  ctx.strokeRect(frame.left, frame.top, frame.width, frame.height)
  ctx.fillStyle = '#222'
  ctx.font = '12px sans-serif'
  ctx.fillText('Orbit in x-y plane', frame.left + 8, frame.top + 16)
  if (count < 1) return
  const range = computeOrbitXYRange(a, b, count)
  if (!range) return
  plotCanvasPolyline(ctx, frame, range, a.rx, a.ry, '#1f77b4')
  plotCanvasPolyline(ctx, frame, range, b.rx, b.ry, '#d62728')
}

function createOrbitDebugPanel(debugSummary: Record<string, unknown>) {
  if (typeof document === 'undefined') return null

  const existing = document.getElementById('modelica-orbit-debug-panel')
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing)

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
  return canvas
}

function drawOrbitSeriesPanelForRun(
  ctx: CanvasRenderingContext2D,
  frame: OrbitCanvasFrame,
  current: OrbitSamples,
  irk4: OrbitSamples,
  valuesA: number[],
  valuesB: number[],
  title: string,
) {
  drawOrbitSeriesPanel(ctx, frame, {
    xValues: current.t,
    valuesA,
    valuesB,
    title,
    colorA: '#1f77b4',
    colorB: '#d62728',
  })
}

function drawOrbitDebugPanels(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  current: OrbitSamples,
  irk4: OrbitSamples,
) {
  const pad = 18
  const w = (canvas.width - pad * 3) / 2
  const h = (canvas.height - pad * 3) / 2
  drawOrbitXYPanel(ctx, { left: pad, top: pad, width: w, height: h }, current, irk4)
  drawOrbitSeriesPanelForRun(
    ctx,
    { left: pad * 2 + w, top: pad, width: w, height: h },
    current,
    irk4,
    current.r,
    irk4.r,
    'Radius r(t): current vs irk4',
  )
  drawOrbitSeriesPanelForRun(
    ctx,
    { left: pad, top: pad * 2 + h, width: w, height: h },
    current,
    irk4,
    current.specificEnergy,
    irk4.specificEnergy,
    'Specific energy: current vs irk4',
  )
  drawOrbitSeriesPanelForRun(
    ctx,
    { left: pad * 2 + w, top: pad * 2 + h, width: w, height: h },
    current,
    irk4,
    current.eccentricity,
    irk4.eccentricity,
    'Eccentricity: current vs irk4',
  )
}

function renderOrbitDebugCanvas(
  current: OrbitSamples,
  irk4: OrbitSamples,
  debugSummary: Record<string, unknown>,
) {
  const canvas = createOrbitDebugPanel(debugSummary)
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  drawOrbitDebugPanels(ctx, canvas, current, irk4)
}

async function runModelicaOrbitInvariantTest(mode: OrbitTestMode, templateSource: string) {
  const preparation = await prepareOrbitDiagnostics(mode, templateSource)
  const runs = await runOrbitSolverRuns(preparation)
  const currentSamples = collectOrbitSamples(runs.currentRun)
  const irk4Samples = runs.irk4Run ? collectOrbitSamples(runs.irk4Run) : null
  const debugSummary = buildOrbitDebugSummary(preparation, runs, currentSamples, irk4Samples)
  if (irk4Samples) renderOrbitDebugCanvas(currentSamples, irk4Samples, debugSummary)

  assertOrbitRunStability(preparation, runs, debugSummary)
  const { currentInv, irk4Inv } = collectOrbitInvariantSet(
    currentSamples,
    irk4Samples,
    preparation,
    debugSummary,
  )
  const currentMaxDrift = maxOrbitInvariantDrift(currentInv)
  const irk4MaxDrift = irk4Inv ? maxOrbitInvariantDrift(irk4Inv) : null
  assertOrbitInvariantDrift(currentMaxDrift, irk4MaxDrift, debugSummary, preparation)
  return assembleOrbitDiagnosticResult(
    preparation,
    currentInv,
    irk4Inv,
    currentMaxDrift,
    irk4MaxDrift,
    debugSummary,
  )
}

testModelicaMslResistorExampleSimulation.timeoutMs = 120_000

function assertAlgebraicPlanTrajectory(
  run: OrbitSolverRun,
  fixture: { name: string; implicitCount: number },
) {
  if (run.meta?.stopReason || run.meta?.stopError)
    throw new Error('Algebraic plan simulation failed')
  if (run.meta?.model?.solverAlgebraicNames?.length !== fixture.implicitCount) {
    throw new Error(`${fixture.name}: incorrect Newton algebraic unknown count`)
  }
  const xs = getStateSeries(run, 'x')
  const times = getOrbitTime(run)
  const a = getAlgebraicSeries(run, 'a')
  const b = getAlgebraicSeries(run, 'b')
  if (
    xs.length < 2 ||
    a.length !== xs.length ||
    b.length !== xs.length ||
    times.length !== xs.length
  ) {
    throw new Error('Missing algebraic samples')
  }
  if (fixture.implicitCount === 0) {
    const norms = getAlgebraicSeries(run, 'zeroNorm')
    if (
      norms.length !== xs.length ||
      norms.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e-12)
    ) {
      throw new Error('The zero-norm Modelica equation was not evaluated correctly')
    }
  }
  for (let i = 0; i < xs.length; i++) {
    if (Math.abs(xs[i]! - Math.exp(-times[i]!)) > 1e-4) {
      throw new Error(`${fixture.name}: the state equation was not integrated correctly`)
    }
    const residual =
      fixture.implicitCount === 0
        ? Math.max(Math.abs(a[i]! - xs[i]! ** 2), Math.abs(b[i]! - Math.sqrt(a[i]!)))
        : Math.max(Math.abs(a[i]! - Math.cos(b[i]!) - xs[i]!), Math.abs(b[i]! - Math.sin(a[i]!)))
    if (!Number.isFinite(residual) || residual > 1e-7)
      throw new Error(`${fixture.name}: algebraic equations were not satisfied`)
  }
}

export async function testModelicaAlgebraicSolvePlan(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  const wasm = await getDiagnosticsWasm()
  if (typeof wasm.compile_to_json !== 'function') throw new Error('Missing compile_to_json')
  const cases = [
    {
      name: 'AssignmentChain',
      source: `model AssignmentChain
        Real x(start=1, fixed=true); Real a; Real b; Real zeroNorm;
        equation der(x)=-x; a=x*x; b=sqrt(a); zeroNorm=sqrt((b-x)^2);
        end AssignmentChain;`,
      implicitCount: 0,
    },
    {
      name: 'AlgebraicLoop',
      source: `model AlgebraicLoop
        Real x(start=1, fixed=true); Real a; Real b;
        equation der(x)=-x; a=cos(b)+x; b=sin(a);
        end AlgebraicLoop;`,
      implicitCount: 2,
    },
  ]
  for (const fixture of cases) {
    const compilation = compileRumocaTemplates({
      wasm,
      source: fixture.source,
      modelName: fixture.name,
      templates: [
        generator === 'dae'
          ? { source: javascriptTemplate, path: 'javascript.jinja' }
          : { source: solveJavascriptTemplate, path: 'javascript_solve.jinja' },
      ],
    })
    for (const generated of compilation.rendered) {
      if (!generated.ok) throw new Error(generated.error)
      const code = await buildWorkerSandboxCodeChecked(generated.content, fixture.name)
      for (const timeIntegrator of ['sdirk2', 'irk4']) {
        const run = await runOrbitSimulation(
          code,
          { t0: 0, tf: 0.2, dt: 0.02, x0: [1] },
          `${fixture.name}-${timeIntegrator}`,
          { timeIntegrator, newtonTol: 1e-9 },
        )
        assertAlgebraicPlanTrajectory(run, fixture)
      }
    }
  }
  return { success: true }
}
testModelicaAlgebraicSolvePlan.modelicaGenerators = ['dae', 'solve'] as const

export async function testModelicaSolverStorageMapping(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  const wasm = await getDiagnosticsWasm()
  for (const coupled of [false, true]) {
    const source = `model StorageMapping
      Real z[2](start={0.1,-0.2},each fixed=true); Real alias; Real a; Real b;
      parameter Real gain=2; output Real out;
      equation der(z[1])=-gain*z[1]; der(z[2])=-gain*z[2]; alias=z[1];
      a=${coupled ? 'cos(b)+z[1]' : 'z[1]*z[1]'};
      b=${coupled ? 'sin(a)' : 'sqrt(a)'}; out=z[2]+a;
      end StorageMapping;`
    const { rendered } = compileDiagnosticJavaScript(wasm, source, 'StorageMapping', generator)
    await executeModelicaDiagnosticInSandbox({
      id: `modelica-storage-mapping-${generator}-${coupled}`,
      stopSignal: AbortSignal.timeout(10000),
      maxExecutionMs: 10000,
      code: `() => {
        ${rendered}
        ${defaultSolverSource}
        const model=Model();
        if(!Object.is(model.x0[0],0.1)||!Object.is(model.x0[1],-0.2))
          throw new Error('Initialization did not preserve the exact floating point starts');
        const run=simulateModel({sim:{t0:0,tf:0.2,dt:0.02,x0:model.x0,
          solverOptions:{timeIntegrator:'irk4',newtonTol:1e-9}}},{},model);
        if(run.meta.stopReason||run.meta.stopError||run.data.t.at(-1)!==0.2)
          throw new Error('Storage mapping simulation stopped: '+run.meta.stopReason);
        for(let i=0;i<run.data.t.length;i++) {
          const first=run.data.x['z[1]'][i],second=run.data.x['z[2]'][i];
          const alias=run.data.y.alias[i],a=run.data.y.a[i],b=run.data.y.b[i];
          const expected=Math.exp(-2*run.data.t[i]);
          const residual=${coupled ? 'Math.max(Math.abs(a-Math.cos(b)-first),Math.abs(b-Math.sin(a)))' : 'Math.max(Math.abs(a-first*first),Math.abs(b-Math.sqrt(a)))'};
          if([first,second,alias,a,b,run.data.y.out[i]].some(value=>!Number.isFinite(value)) ||
            Math.abs(first-0.1*expected)>1e-6 || Math.abs(second+0.2*expected)>1e-6 ||
            Math.abs(alias-first)>1e-7 || Math.abs(run.data.y.out[i]-second-a)>1e-7 ||
            residual>1e-7)
            throw new Error('State, alias, algebraic or output storage mapping is incorrect');
        }
        return {ok:true};
      }`,
    })
  }
  return { ok: true }
}
testModelicaSolverStorageMapping.modelicaGenerators = ['dae', 'solve'] as const

export async function testModelicaDiscreteTargetSelection(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  const wasm = await getDiagnosticsWasm()
  const { rendered } = compileDiagnosticJavaScript(
    wasm,
    `model DiscreteTargetSelection
      Boolean flags[2](each start=false); Real x(start=0,fixed=true);
      equation
      when time>=0.1 then flags[1]=true; end when;
      when time>=0.2 then flags[2]=true; end when;
      der(x)=(if flags[1] then 1 else 0)+(if flags[2] then 1 else 0);
      end DiscreteTargetSelection;`,
    'DiscreteTargetSelection',
    generator,
  )
  return executeModelicaDiagnosticInSandbox({
    id: `modelica-discrete-target-selection-${generator}`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
    code: `() => {
      ${rendered}
      ${defaultSolverSource}
      for(const timeIntegrator of ['sdirk2','irk4','rk45']) {
        const model=Model();
        const run=simulateModel({sim:{t0:0,tf:0.3,dt:0.05,x0:model.x0,
          solverOptions:{timeIntegrator}}},{},model);
        if(run.meta.stopReason||run.data.t.at(-1)!==0.3)
          throw new Error('Discrete target simulation stopped: '+run.meta.stopReason);
        for(let i=0;i<run.data.t.length;i++) {
          const t=run.data.t[i],expected=Math.max(t-0.1,0)+Math.max(t-0.2,0);
          if(!Number.isFinite(run.data.x.x[i])||Math.abs(run.data.x.x[i]-expected)>1e-5)
            throw new Error('Selected Boolean array elements did not drive the state equation at '+t+
              ': expected '+expected+', received '+run.data.x.x[i]);
          for(const [name,deadline] of [['flags[1]',0.1],['flags[2]',0.2]]) {
            if(Math.abs(t-deadline)>1e-8&&Number(run.data.y[name][i])!==Number(t>deadline))
              throw new Error('A held Boolean element changed before its owning event');
          }
        }
      }
      return {ok:true};
    }`,
  })
}
testModelicaDiscreteTargetSelection.modelicaGenerators = ['dae', 'solve'] as const

export async function testModelicaRetainedWorkerCompilation() {
  if (typeof Worker === 'undefined' || typeof document === 'undefined') {
    return { ok: true, skipped: 'retained-worker-compilation requires browser Worker + DOM' }
  }
  const worker = new ModelicaWorkerClient()
  try {
    await worker.init()
    const success = await worker.compileRender({
      modelicaSource:
        'model WorkerDecay Real x(start=1,fixed=true); equation der(x)=-x; end WorkerDecay;',
      modelName: 'WorkerDecay',
      templateSource: solveJavascriptTemplate,
      usePreparedDae: false,
      useSourceRoots: false,
    })
    if (success.renderError || !success.solveJson || !success.rendered) {
      throw new Error('Worker did not render retained Solve model')
    }
    await buildWorkerSandboxCodeChecked(success.rendered, 'retained-worker-abi')
    const failure = await worker.compileRender({
      modelicaSource:
        'model WorkerNonlinear Real x(start=1,fixed=true); equation der(x)*der(x)=x; end WorkerNonlinear;',
      modelName: 'WorkerNonlinear',
      templateSource: solveJavascriptTemplate,
      usePreparedDae: false,
      useSourceRoots: false,
    })
    if (!failure.renderError || !failure.daePretty || !failure.compiled.dae) {
      throw new Error('Worker discarded DAE analysis on Solve failure')
    }
    return { ok: true }
  } finally {
    worker.terminate()
  }
}

export async function testModelicaRetainedCompilation() {
  const wasm = await getDiagnosticsWasm()
  if (!wasm.compile_with_options) throw new Error('Missing retained compilation API')
  const source = `model RetainedDecay
    Real x(start=1, fixed=true); Real a;
    equation der(x)=-x; a=x*x;
    end RetainedDecay;`
  for (const representations of [['dae'], ['solve'], ['dae', 'solve']]) {
    const compiled = wasm.compile_with_options(
      source,
      'RetainedDecay',
      JSON.stringify({ representations }),
    )
    try {
      for (const representation of ['dae', 'solve'] as const) {
        let returned = false
        try {
          const json = compiled.representation_json(representation)
          JSON.parse(json)
          returned = true
        } catch {
          if (representations.includes(representation)) throw new Error(`Missing ${representation}`)
        }
        if (returned !== representations.includes(representation)) {
          throw new Error(`Unexpected ${representation} representation`)
        }
      }
    } finally {
      compiled.free()
    }
  }
  const result = compileRumocaTemplates({
    wasm,
    source,
    modelName: 'RetainedDecay',
    templates: [
      { source: '{{ dae.variables|length }}', path: 'dae.jinja' },
      {
        source:
          '{# rumoca-ir: solve #}{{ solve_model.initial_y.count }}:{{ solve.solve_layout.state_scalar_count }}',
        path: 'solve.jinja',
      },
    ],
  })
  const [daeView, solveView] = result.rendered
  if (!daeView?.ok || daeView.content !== '2' || !solveView?.ok || solveView.content !== '2:1') {
    throw new Error(`Incorrect retained views: ${JSON.stringify(result.rendered)}`)
  }
  if (!result.solveJson || result.solveError) throw new Error('Missing complete Solve model')
  return { ok: true, representations: ['dae', 'solve'], rendered: result.rendered }
}

export async function testModelicaRetainedCompilationFailureIsolation() {
  const wasm = await getDiagnosticsWasm()
  const result = compileRumocaTemplates({
    wasm,
    source: `model NonlinearDerivative
      Real x(start=1,fixed=true);
      equation der(x)*der(x)=x;
      end NonlinearDerivative;`,
    modelName: 'NonlinearDerivative',
    templates: [
      { source: '{{ dae.variables|length }}', path: 'dae.jinja' },
      { source: '{# rumoca-ir: solve #}{{ solve.layout.y_scalars }}', path: 'solve.jinja' },
    ],
  })
  if (!result.daeJson || !result.solveError) throw new Error('Missing DAE or Solve refusal')
  const [daeView, solveView] = result.rendered
  if (!daeView?.ok || daeView.content !== '1' || solveView?.ok !== false) {
    throw new Error('DAE rendering lost or Solve refusal hidden')
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorTargetAdmission() {
  const wasm = await getDiagnosticsWasm()
  const indexed = compileRumocaTemplates({
    wasm,
    source: `model IndexedAdmission
      input Real u=1; Real x[2](start={1,2},each fixed=true);
      equation der(x[1])=x[integer(u)]; der(x[2])=-x[2];
      end IndexedAdmission;`,
    modelName: 'IndexedAdmission',
    templates: [
      { source: solveJavascriptTemplate, path: 'javascript_solve.jinja' },
      {
        source: solveJavascriptTemplate.replace('{# rumoca-linear-ops: native #}\n', ''),
        path: 'scalar-only.jinja',
      },
    ],
  })
  const [native, scalar] = indexed.rendered
  if (!native?.ok) throw new Error(native?.error ?? 'Missing native checked-program output')
  if (scalar?.ok !== false || !scalar.error.includes('unsupported-feature:scalar.derivative_rhs'))
    throw new Error('Scalar-only target admitted unsupported runtime indexing')

  const compact = compileRumocaTemplates({
    wasm,
    source: `model CompactAdmission
      Real x[200](each start=1,each fixed=true);
      equation der(x)=-x;
      end CompactAdmission;`,
    modelName: 'CompactAdmission',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  }).rendered[0]
  if (!compact?.ok) throw new Error(compact?.error ?? 'Compact tensor fallback was lost')
  await executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-compact-admission',
    code: `() => {
      ${compact.content}
      const model=Model();
      const residual=model.residual(0,new Array(200).fill(1),new Array(200).fill(-1),[],[],null);
      if(residual.length!==200 || residual.some(value=>value!==0))
        throw new Error('Compact tensor fallback changed derivative values');
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })

  const mixed = compileRumocaTemplates({
    wasm,
    source: `model MixedAdmission
      input Real u=1; Real x[200](each start=1,each fixed=true);
      Real y(start=0,fixed=true);
      equation der(x)=-x; der(y)=x[integer(u)];
      end MixedAdmission;`,
    modelName: 'MixedAdmission',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  }).rendered[0]
  if (mixed?.ok !== false || !mixed.error.includes('unsupported-feature:scalar.derivative_rhs'))
    throw new Error('Compact tensor target bypassed scalar admission')
  return { ok: true }
}

export async function testModelicaSolveGeneratorEditorSamples() {
  const wasm = await getDiagnosticsWasm()
  await ensureDiagnosticsMslLoaded(wasm, {})
  const cases = [
    { key: 'bouncingBall', name: 'BouncingBall', tf: 7, dt: 0.1 },
    { key: 'resistorMsl', name: 'MslResistorExample', tf: 5, dt: 0.1 },
    { key: 'orbit', name: 'SatelliteOrbit2D', tf: 6000, dt: 20 },
    { key: 'drivenPendulumPhaseMap', name: 'DrivenPendulumPhaseMap', tf: 200, dt: 0.02 },
  ] as const
  const failures: string[] = []
  for (const sample of cases) {
    try {
      const compilation = compileRumocaTemplates({
        wasm,
        source: exampleModels[sample.key],
        modelName: sample.name,
        templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
      })
      const generated = compilation.rendered[0]
      if (!generated?.ok) throw new Error(generated?.error ?? 'Missing sample Solve model')
      const code = await buildWorkerSandboxCodeChecked(generated.content, sample.name)
      for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
        try {
          const run = await runOrbitSimulation(
            code,
            { t0: 0, tf: sample.tf, dt: sample.dt },
            sample.name + '-' + timeIntegrator,
            { timeIntegrator, newtonTol: 1e-9 },
          )
          const times = getOrbitTime(run)
          if (
            run.meta?.stopReason ||
            times.length < 2 ||
            Math.abs(times.at(-1)! - sample.tf) > 1e-9
          )
            throw new Error(run.meta?.stopError ?? 'Sample did not reach its experiment horizon')
          for (const channels of [run.data?.x, run.data?.y]) {
            if (!channels) throw new Error('Missing sample channels')
            for (const values of Object.values(channels)) {
              if (
                !Array.isArray(values) ||
                values.length !== times.length ||
                values.some((value) => !Number.isFinite(Number(value)))
              )
                throw new Error('Sample returned missing or non-finite observations')
            }
          }
        } catch (error) {
          failures.push(
            sample.name +
              '/' +
              timeIntegrator +
              ': ' +
              (error instanceof Error ? error.message : String(error)),
          )
        }
      }
    } catch (error) {
      failures.push(
        sample.name + '/compile: ' + (error instanceof Error ? error.message : String(error)),
      )
    }
  }
  if (failures.length) throw new Error(failures.join('\n'))
  return { ok: true, samples: cases.length, integrators: 3 }
}
testModelicaSolveGeneratorEditorSamples.setup = async () => {
  const wasm = await getDiagnosticsWasm()
  await ensureDiagnosticsMslLoaded(wasm, {})
}
testModelicaSolveGeneratorEditorSamples.timeoutMs = 120_000

export async function testModelicaSolveGeneratorMslResistorConsistency() {
  const wasm = await getDiagnosticsWasm()
  await ensureDiagnosticsMslLoaded(wasm, {})
  const compilation = compileRumocaTemplates({
    wasm,
    source: exampleModels.resistorMsl,
    modelName: 'MslResistorExample',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing Resistor Solve model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-msl-resistor-consistency',
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
    code: `() => {
      ${generated.content}
      ${defaultSolverSource}
      for(const timeIntegrator of ['sdirk2','irk4','rk45']) {
        const model=Model(),sizes=[],project=model.projectAlgebraics;
        model.projectAlgebraics=(...args)=>{
          const solve=args[5];
          args[5]=(residual,initial,scales)=>{sizes.push(initial.length);return solve(residual,initial,scales);};
          return project(...args);
        };
        const run=simulateModel({sim:{t0:0,tf:5,dt:0.1,
          solverOptions:{timeIntegrator,newtonTol:1e-9}}},{},model);
        if(run.meta.stopReason || run.data.t.at(-1)!==5)
          throw new Error('Resistor stopped before its experiment horizon');
        if(!sizes.length || sizes.some(size=>size>2))
          throw new Error('Resistor projection included coordinates outside its native tear sets');
        for(let i=0;i<run.data.t.length;i++) {
          const y=run.meta.model.solverAlgebraicNames.map(name=>run.data.y[name][i]);
          const residual=model.residual(run.data.t[i],[],[],y,[],undefined);
          if(residual.some(value=>!Number.isFinite(value)||Math.abs(value)>1e-7))
            throw new Error('Resistor observations violate their retained Modelica equations');
        }
      }
      return {ok:true};
    }`,
  })
}
testModelicaSolveGeneratorMslResistorConsistency.setup =
  testModelicaSolveGeneratorEditorSamples.setup
testModelicaSolveGeneratorMslResistorConsistency.timeoutMs = 120_000

export async function testModelicaSolveGeneratorArraysAndParameters() {
  const wasm = await getDiagnosticsWasm()
  const result = compileRumocaTemplates({
    wasm,
    source: `model SolveArrays
      parameter Real A[2,2]=[1,2;3,4];
      Real x[2](start={1,2},each fixed=true);
      equation der(x)=A*x;
      end SolveArrays;`,
    modelName: 'SolveArrays',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = result.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing generated model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-arrays-and-parameters',
    code: `() => {
${generated.content}
      const model = Model();
      if (model.x0.length !== 2 || model.meta.parameters.length !== 4) throw new Error('Incorrect scalar layout');
      const initial = model.residual(0,[1,2],[5,11],[],[],null);
      const overridden = model.residual(0,[1,2],[2,4],[],[],[2,0,0,2]);
      if ([...initial,...overridden].some(v => Math.abs(v)>1e-12)) throw new Error('Incorrect array or parameter evaluation');
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaSolveGeneratorProjectedDerivatives() {
  const wasm = await getDiagnosticsWasm()
  const cases = [
    {
      name: 'SolveAssignmentDerivative',
      source: `model SolveAssignmentDerivative
      parameter Real k=2; input Real u=1;
      Real x(start=2,fixed=true); Real a; Real b;
      equation a=x*x; b=3*a; der(x)=-k*b+u;
      end SolveAssignmentDerivative;`,
      algebraics: [],
      stateTangent: [1, 4, 12],
      rhsTangent: -24,
      parameterTangent: -12,
    },
    {
      name: 'SolveLoopDerivative',
      source: `model SolveLoopDerivative
      parameter Real k=2; input Real u=1;
      Real x(start=2,fixed=true); Real a(start=1);
      equation a*a=x; der(x)=-k*a+u;
      end SolveLoopDerivative;`,
      algebraics: [Math.sqrt(2)],
      stateTangent: [1, 1 / (2 * Math.sqrt(2))],
      rhsTangent: -1 / Math.sqrt(2),
      parameterTangent: -Math.sqrt(2),
    },
    {
      name: 'SolveCoupledDerivative',
      source: `model SolveCoupledDerivative
      parameter Real k=2; input Real u=1;
      Real x(start=2,fixed=true); Real a(start=3); Real b(start=-1);
      equation a+b=x; a-b=x*x; der(x)=-k*a+b+u;
      end SolveCoupledDerivative;`,
      algebraics: [3, -1],
      stateTangent: [1, 2.5, -1.5],
      rhsTangent: -6.5,
      parameterTangent: -3,
    },
  ]
  for (const fixture of cases) {
    const compilation = compileRumocaTemplates({
      wasm,
      source: fixture.source,
      modelName: fixture.name,
      templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
    })
    const generated = compilation.rendered[0]
    if (!generated?.ok) throw new Error(generated?.error ?? 'Missing projected-derivative model')
    await executeModelicaDiagnosticInSandbox({
      id: 'modelica-solve-projected-derivatives-' + fixture.name,
      code: `() => {
        ${generated.content}
        const model=Model(), y=${JSON.stringify(fixture.algebraics)};
        const result=model.evalProjectedJacobianVector(0,[2],y,[1],[2],{state:[1],parameters:[0],inputs:[0]});
        const expected=${JSON.stringify(fixture.stateTangent)};
        if(result.solverY.length!==expected.length || result.solverY.some((value,i)=>Math.abs(value-expected[i])>1e-10) || Math.abs(result.derivativeRhs[0]-(${fixture.rhsTangent}))>1e-10) throw new Error('Algebraic tangent was not projected');
        const parameter=model.evalProjectedJacobianVector(0,[2],y,[1],[2],{state:[0],parameters:[1],inputs:[0]});
        if(Math.abs(parameter.derivativeRhs[0]-(${fixture.parameterTangent}))>1e-10) throw new Error('Incorrect projected parameter tangent');
        const input=model.evalProjectedJacobianVector(0,[2],y,[1],[2],{state:[0],parameters:[0],inputs:[1]});
        if(Math.abs(input.derivativeRhs[0]-1)>1e-10) throw new Error('Incorrect projected input tangent');
        return {ok:true};
      }`,
      stopSignal: AbortSignal.timeout(10000),
      maxExecutionMs: 10000,
    })
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorDerivativePrograms() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `function Square
      input Real x; output Real y;
      algorithm if x>0 then y:=x*x; else y:=-x; end if;
      end Square;
      function Flow
      input Real x; output Real y;
      algorithm y:=0;
      for i in 1:3 loop y:=y+Square(x)/i; end for;
      end Flow;
      model SolveDerivatives
      parameter Real k=3; input Real u=1;
      Real x(start=2,fixed=true);
      equation der(x)=k*Flow(x)+u;
      end SolveDerivatives;`,
    modelName: 'SolveDerivatives',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing derivative model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-derivative-programs',
    code: `() => {
      ${generated.content}
      const model=Model();
      const directions=[
        [{solverY:[1],parameters:[0],inputs:[0]},22],
        [{solverY:[0],parameters:[1],inputs:[0]},22/3],
        [{solverY:[0],parameters:[0],inputs:[1]},1],
        [{solverY:[2],parameters:[3],inputs:[4]},70],
      ];
      for(const [direction,expected] of directions) {
        const result=model.evalSolveJacobianVector(0,[2],[],[1],[3],direction);
        if(result.derivativeRhs.length!==1 || Math.abs(result.derivativeRhs[0]-expected)>1e-10 || result.implicitResidual.length!==0) throw new Error('Incorrect compiler-derived tangent');
      }
      const negative=model.evalSolveJacobianVector(0,[-2],[],[1],[3],{solverY:[1],parameters:[0],inputs:[0]});
      if(Math.abs(negative.derivativeRhs[0]+5.5)>1e-10)throw new Error('Incorrect nested conditional tangent');
      let rejected=false;
      try {model.evalSolveJacobianVector(0,[2],[],[1],[3],{solverY:[],parameters:[0],inputs:[0]})} catch {rejected=true}
      if(!rejected)throw new Error('Tangent layout mismatch was accepted');
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaSolveGeneratorIntegerTensors() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `function IntegerTensors
      input Integer n; output Integer y;
      protected Integer A[2,2]; Integer B[2,2];
      algorithm A:=[n,2;1,0]; B:=[3,0;4,1];
      y:=sum(A*B);
      end IntegerTensors;
      model SolveIntegerTensors
      input Real u=1; Real x(start=0,fixed=true);
      equation der(x)=0.0+IntegerTensors(integer(u));
      end SolveIntegerTensors;`,
    modelName: 'SolveIntegerTensors',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing Integer tensor model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-integer-tensors',
    code: `() => {
      ${generated.content}
      const model=Model();
      for(const n of [1,3,-3]) {
        const result=model.residual(0,[0],[3*n+13],[],[n],null);
        if(result.length!==1 || result[0]!==0) throw new Error('Incorrect Integer tensor product');
      }
      let rejected=false;
      try { model.residual(0,[0],[0],[],[2**62],null) }
      catch(error) { if(!String(error).includes('Solve Integer overflow')) throw error; rejected=true }
      if(!rejected) throw new Error('Integer tensor intermediate overflow was accepted');
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaSolveGeneratorTypedTensors() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `function TensorFlow
      input Real x[3]; output Real y;
      protected Real A[3,3];
      algorithm A:=[1,2,3;4,5,6;7,8,9];
      y:=sum(transpose(A)*x)+sum(cross({3.0,1.0,2.0},x))+sum(diagonal(x))+sum(identity(3)*x);
      end TensorFlow;
      model SolveTensors
      Real x[3](start={1,2,3},each fixed=true);
      equation der(x)=fill(TensorFlow(x),3);
      end SolveTensors;`,
    modelName: 'SolveTensors',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing typed-tensor model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-typed-tensors',
    code: `() => {
      ${generated.content}
      const model=Model();
      for (const [state,derivative] of [[[1,2,3],117],[[3,2,1],87],[[0,0,0],0]]) {
        const result=model.residual(0,state,new Array(3).fill(derivative),[],[],null);
        if (result.length!==3 || result.some(value=>value!==0)) throw new Error('Incorrect typed tensor arithmetic');
      }
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaSolveGeneratorTypedFunctions() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `function SumFlow
      input Real x; output Real y;
      algorithm y:=0;
      for i in 1:3 loop
        if i==2 then y:=y+x; else y:=y+i; end if;
      end for;
      end SumFlow;
      function TypedFlow
      input Real x; input Integer row; output Real y;
      protected Real a[2,2]; Integer n;
      algorithm a:=[x,2;3,4]; a[row,:]:={5,6};
      n:=9007199254740993;
      if x<0 then n:=9223372036854775807; n:=n+1; end if;
      y:=a[row,2]+(n-9007199254740992)+SumFlow(x);
      end TypedFlow;
      model SolveTyped
      input Real u=1; Real x(start=1,fixed=true);
      equation der(x)=TypedFlow(x,integer(u));
      end SolveTyped;`,
    modelName: 'SolveTyped',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing typed-function model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-typed-functions',
    code: `() => {
      ${generated.content}
      const model=Model();
      for (const input of [1,2]) for (const state of [1,3]) {
        const result=model.residual(0,[state],[11+state],[],[input],null);
        if (result.length!==1 || result[0]!==0) throw new Error('Typed function lost Integer precision, array update or loop control');
      }
      for (const input of [0,3]) {
        let rejected=false;
        try {model.residual(0,[1],[0],[],[input],null)} catch {rejected=true}
        if (!rejected) throw new Error('Typed function accepted an invalid array index');
      }
      let overflowRejected=false;
      try {model.residual(0,[-1],[0],[],[1],null)} catch {overflowRejected=true}
      if (!overflowRejected) throw new Error('Typed function accepted Integer overflow');
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaSolveGeneratorBoundedWhileAndIntegerRemainders() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `function Halve
      input Real x; output Real y;
      protected Integer i;
      algorithm y:=x; i:=0;
      while i<100 and y>0.1 loop y:=y*0.5; i:=i+1; end while;
      end Halve;
      function IntegerTerms
      input Integer n; input Integer d; output Real y;
      algorithm y:=div(n,d)+mod(n,d)+rem(n,d);
      end IntegerTerms;
      model SolveWhile
      input Real u=1; Real x(start=1,fixed=true);
      equation der(x)=Halve(x)+IntegerTerms(integer(u),-3);
      end SolveWhile;`,
    modelName: 'SolveWhile',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing bounded-while model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-while-integer-remainders',
    code: `() => {
      ${generated.content}
      const model=Model();
      for(const [state,input,expected] of [[1,7,-2.9375],[0.05,-7,0.05],[2,6,-1.9375]]) {
        const residual=model.residual(0,[state],[expected],[],[input],null);
        if(residual.length!==1 || Math.abs(residual[0])>1e-12)throw new Error('Bounded while or signed Integer arithmetic differs from Modelica semantics');
      }
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaSolveGeneratorRuntimeIndexing() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveIndex
      input Real u=1;
      Real x[2](start={1,2},each fixed=true);
      equation der(x[1])=x[integer(u)]; der(x[2])=-x[2];
      end SolveIndex;`,
    modelName: 'SolveIndex',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing indexed model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-runtime-indexing',
    code: `() => {
      ${generated.content}
      const model=Model();
      for (const [input,derivative] of [[1,1],[2,2],[1.9,1]]) {
        const result=model.residual(0,[1,2],[derivative,-2],[],[input],null);
        if (result.some(value=>value!==0)) throw new Error('Incorrect runtime array index');
      }
      for (const input of [0,3,Infinity,NaN]) {
        const result=model.residual(0,[1,2],[0,-2],[],[input],null);
        if (!Number.isNaN(result[0]) || result[1]!==0) throw new Error('Invalid index must produce NaN');
      }
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaSolveGeneratorActionLifecycle() {
  const wasm = await getDiagnosticsWasm()
  const fixtures = [
    {
      name: 'SolveWarning',
      source: `model SolveWarning Real x(start=0,fixed=true); equation der(x)=1; assert(time<0,"accepted warning",AssertionLevel.warning); end SolveWarning;`,
      terminal: false,
    },
    {
      name: 'SolveTerminate',
      source: `model SolveTerminate Real x(start=0,fixed=true); equation der(x)=1; when initial() then terminate("requested stop"); end when; end SolveTerminate;`,
      terminal: true,
    },
  ]
  for (const fixture of fixtures) {
    const compilation = compileRumocaTemplates({
      wasm,
      source: fixture.source,
      modelName: fixture.name,
      templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
    })
    const generated = compilation.rendered[0]
    if (!generated?.ok) throw new Error(generated?.error ?? 'Missing action lifecycle model')
    const code = await buildWorkerSandboxCodeChecked(generated.content, fixture.name)
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 0.1, dt: 0.02, x0: [0] },
      fixture.name,
      { timeIntegrator: 'sdirk2' },
    )
    if (fixture.terminal) {
      if (
        run.meta?.stopReason !== 'modelica_terminate' ||
        getOrbitTime(run).length !== 1 ||
        getOrbitTime(run)[0] !== 0
      )
        throw new Error('Modelica termination did not end the run cleanly')
    } else {
      if (run.meta?.warnings?.filter((warning) => warning === 'accepted warning').length !== 1)
        throw new Error('Warning site was not reported once at an accepted point')
      const baselineCode = await buildWorkerSandboxCodeChecked(
        `${generated.content}
        Model=((create)=>()=>{const model=create();delete model.evaluateEventActions;return model;})(Model);`,
        fixture.name + '-baseline',
      )
      const baseline = await runOrbitSimulation(
        baselineCode,
        { t0: 0, tf: 0.1, dt: 0.02, x0: [0] },
        fixture.name + '-baseline',
        { timeIntegrator: 'sdirk2' },
      )
      const x = getStateSeries(run, 'x'),
        reference = getStateSeries(baseline, 'x')
      if (x.length !== reference.length || x.some((value, i) => value !== reference[i]))
        throw new Error('Warning changed the trajectory')
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorTerminalPhase() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveTerminalPhase
      Real x(start=0,fixed=true);
      discrete Boolean finished(start=false,fixed=true);
      equation der(x)=1;
      when initial() then assert(not terminal(),"terminal during initialization"); end when;
      when terminal() then
        finished=true;
        assert(not initial(),"initial during terminal");
        assert(false,"terminal warning",level=AssertionLevel.warning);
      end when;
      end SolveTerminalPhase;`,
    modelName: 'SolveTerminalPhase',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing terminal model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-terminal-phase')
  for (const [tf, dt] of [
    [0.65, 0.2],
    [0.6, 0.2],
    [0.1, 0.4],
    [0, 0.2],
  ] as const) {
    const run = await runOrbitSimulation(code, { t0: 0, tf, dt, x0: [0] }, 'solve-terminal-phase', {
      timeIntegrator: 'sdirk2',
    })
    const times = getOrbitTime(run),
      finished = getAlgebraicSeries(run, 'finished')
    if (Math.abs(Number(times.at(-1)) - tf) > 1e-12 || times.some((t) => Number(t) > tf))
      throw new Error('Simulation did not stop at its requested horizon')
    if (finished.at(-1) !== 1 || finished.slice(0, -1).some((value) => value !== 0))
      throw new Error('Terminal phase was omitted or activated early')
    if (run.meta?.warnings?.filter((message) => message === 'terminal warning').length !== 1)
      throw new Error('Terminal action was omitted or repeated')
    if (Math.abs(Number(getStateSeries(run, 'x').at(-1)) - tf) > 1e-5)
      throw new Error('Terminal phase changed the continuous trajectory')
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorPeriodicClocks() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolvePeriodicClocks
      Real x(start=0,fixed=true);
      discrete Integer count(start=0,fixed=true);
      discrete Integer other(start=0,fixed=true);
      equation der(x)=1;
      when sample(0,0.1) then count=pre(count)+1; end when;
      when sample(0.05,0.15) then other=pre(other)+1; end when;
      when time>=0.075 then reinit(x,5); end when;
      end SolvePeriodicClocks;`,
    modelName: 'SolvePeriodicClocks',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing clocked model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-periodic-clocks')
  for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 0.61, dt: 0.23, x0: [0] },
      'solve-periodic-clocks',
      { timeIntegrator },
    )
    const times = getOrbitTime(run)
    for (const [name, phase, period] of [
      ['count', 0, 0.1],
      ['other', 0.05, 0.15],
    ] as const) {
      const values = getAlgebraicSeries(run, name)
      if (values.length !== times.length) throw new Error('Missing clock observations: ' + name)
      for (let i = 0; i < times.length; i++) {
        const expected = Math.max(0, Math.floor((Number(times[i]) - phase + 1e-12) / period) + 1)
        if (values[i] !== expected)
          throw new Error(`Clock update missed or repeated: ${name} at ${times[i]}: ${values[i]}`)
      }
    }
    for (const tick of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
      if (!times.some((t) => Math.abs(Number(t) - tick) < 1e-12))
        throw new Error('Missing clock tick sample')
    if (Math.abs(Number(getStateSeries(run, 'x').at(-1)) - 5.535) > 1e-5)
      throw new Error('Unrelated time event changed clock execution')
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorClockPulseConditionHistory() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolvePulseHistory
      Real x(start=0,fixed=true);
      discrete Integer count(start=0,fixed=true);
      equation der(x)=1;
      when sample(0,0.1) or time>=0.25 then count=pre(count)+1; end when;
      end SolvePulseHistory;`,
    modelName: 'SolvePulseHistory',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing pulse-history model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-pulse-history')
  for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 0.41, dt: 0.23 },
      'solve-pulse-history-' + timeIntegrator,
      { timeIntegrator },
    )
    const times = getOrbitTime(run),
      counts = getAlgebraicSeries(run, 'count')
    if (run.meta?.stopReason || counts.length !== times.length || times.length < 5)
      throw new Error(run.meta?.stopError ?? 'Missing pulse-history samples')
    for (let i = 0; i < times.length; i++) {
      if (counts[i] !== (times[i]! >= 0.25 ? 4 : Math.floor((times[i]! + 1e-12) / 0.1) + 1))
        throw new Error('Clock pulse condition history suppressed or repeated its rising edge')
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorClockHistory() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveClockPrevious
      Real x(start=0,fixed=true); Clock c=Clock(1,10);
      Integer count(start=0,fixed=true);
      equation der(x)=1;
      when c then count=previous(count)+1; end when;
      when time>=0.15 then reinit(x,5); end when;
      end SolveClockPrevious;`,
    modelName: 'SolveClockPrevious',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing clock history model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-clock-history')
  for (const t0 of [0, 0.125]) {
    const run = await runOrbitSimulation(
      code,
      { t0, tf: t0 + 0.41, dt: 0.13, x0: [0] },
      'solve-clock-history',
      { timeIntegrator: 'sdirk2' },
    )
    const times = getOrbitTime(run),
      counts = getAlgebraicSeries(run, 'count')
    for (let i = 0; i < times.length; i++) {
      const expected = Math.max(
        0,
        Math.floor((Number(times[i]) + 1e-12) / 0.1) - Math.ceil((t0 - 1e-12) / 0.1) + 1,
      )
      if (counts[i] !== expected)
        throw new Error(`Clock history advanced outside its domain: ${times[i]}: ${counts[i]}`)
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorRelativeClock() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveRelativeClock
      Real x(start=0,fixed=true);
      parameter Real startTime(fixed=false);
      discrete Integer count(start=0,fixed=true);
      initial equation startTime=time;
      equation der(x)=1;
      when sample(startTime,0.1) then count=pre(count)+1; end when;
      end SolveRelativeClock;`,
    modelName: 'SolveRelativeClock',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing relative clock model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-relative-clock')
  for (const t0 of [0, 0.125, -0.125]) {
    const run = await runOrbitSimulation(
      code,
      { t0, tf: t0 + 0.41, dt: 0.13, x0: [0] },
      'solve-relative-clock',
      { timeIntegrator: 'sdirk2' },
    )
    const times = getOrbitTime(run),
      counts = getAlgebraicSeries(run, 'count')
    for (let i = 0; i < times.length; i++) {
      const expected = 1 + Math.floor((Number(times[i]) - t0 + 1e-12) / 0.1)
      if (counts[i] !== expected)
        throw new Error(`Relative clock lost its runtime origin: ${times[i]}: ${counts[i]}`)
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorClockIntermediates() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveClockAlias
      Real x(start=0,fixed=true);
      discrete Integer fast(start=0,fixed=true);
      Integer fastAlias; Integer slow(start=0,fixed=true);
      equation der(x)=1; fastAlias=fast+10;
      when sample(0,0.1) then fast=pre(fast)+1; end when;
      when sample(0,0.2) then slow=fastAlias; end when;
      end SolveClockAlias;`,
    modelName: 'SolveClockAlias',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing ordered clock model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-clock-intermediates')
  for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 0.61, dt: 0.23, x0: [0] },
      'solve-clock-intermediates',
      { timeIntegrator },
    )
    const times = getOrbitTime(run),
      fast = getAlgebraicSeries(run, 'fast'),
      slow = getAlgebraicSeries(run, 'slow')
    for (let i = 0; i < times.length; i++) {
      const time = Number(times[i])
      if (fast[i] !== 1 + Math.floor((time + 1e-12) / 0.1))
        throw new Error('Fast clock update failed')
      const expectedSlow = 11 + 2 * Math.floor((time + 1e-12) / 0.2)
      if (slow[i] !== expectedSlow)
        throw new Error(`Clock consumer read stale intermediate at ${time}: ${slow[i]}`)
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorEventTransactions() {
  const wasm = await getDiagnosticsWasm()
  for (const activation of ['sample(0,0.1)', 'time>=0.15']) {
    const compilation = compileRumocaTemplates({
      wasm,
      source: `model SolveTransaction
        Real x(start=0,fixed=true);
        discrete Integer first(start=0,fixed=true);
        discrete Integer second(start=0,fixed=true);
        equation der(x)=1;
        algorithm when ${activation} then
          first:=pre(first)+1;
          second:=first*2;
          assert(time>=0,"transaction time changed");
        end when;
        end SolveTransaction;`,
      modelName: 'SolveTransaction',
      templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
    })
    const generated = compilation.rendered[0]
    if (!generated?.ok) throw new Error(generated?.error ?? 'Missing event transaction model')
    const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-event-transactions')
    for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
      const run = await runOrbitSimulation(
        code,
        { t0: 0, tf: 0.41, dt: 0.23, x0: [0] },
        'solve-event-transactions',
        { timeIntegrator },
      )
      const times = getOrbitTime(run),
        first = getAlgebraicSeries(run, 'first'),
        second = getAlgebraicSeries(run, 'second')
      for (let i = 0; i < times.length; i++) {
        const expected = activation.startsWith('sample')
          ? 1 + Math.floor((Number(times[i]) + 1e-12) / 0.1)
          : Number(Number(times[i]) >= 0.15 - 1e-12)
        if (first[i] !== expected || second[i] !== 2 * expected)
          throw new Error('Source-ordered transaction did not commit exactly once')
      }
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorTransactionAssertions() {
  const wasm = await getDiagnosticsWasm()
  for (const warning of [false, true]) {
    const compilation = compileRumocaTemplates({
      wasm,
      source: `model SolveTransactionAssert
        Real x(start=0,fixed=true);
        discrete Integer first(start=0,fixed=true);
        discrete Integer second(start=0,fixed=true);
        equation der(x)=1;
        algorithm when sample(0,0.1) then
          first:=pre(first)+1; second:=first*2;
          assert(time<0.2,"transaction blocked"${warning ? ',level=AssertionLevel.warning' : ''});
        end when;
        end SolveTransactionAssert;`,
      modelName: 'SolveTransactionAssert',
      templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
    })
    const generated = compilation.rendered[0]
    if (!generated?.ok) throw new Error(generated?.error ?? 'Missing asserted transaction model')
    await executeModelicaDiagnosticInSandbox({
      id: 'modelica-solve-transaction-assertions',
      stopSignal: AbortSignal.timeout(10000),
      maxExecutionMs: 10000,
      code: `() => {
        ${generated.content}
        ${defaultSolverSource}
        for(const timeIntegrator of ['sdirk2','irk4','rk45']) {
          const model=Model();
          const run=simulateModel({sim:{t0:0,tf:0.41,dt:0.13,x0:[0],solverOptions:{timeIntegrator}}},{},model);
          if(${warning}) {
            if(run.meta.stopError || run.data.y.first.at(-1)!==5 || run.data.y.second.at(-1)!==10)throw new Error('Warning prevented atomic commit');
            if(run.meta.warnings.filter(message=>message==='transaction blocked').length!==1)throw new Error('Transaction warning omitted or repeated');
          } else {
            if(!String(run.meta.stopError).includes('transaction blocked'))throw new Error('Missing transaction assertion');
            const values=model.evalAlgebraics(0.2,[0.2],[],[],[]);
            if(values[0]!==2 || values[1]!==4)throw new Error('Failed transaction committed partial targets');
            let failed=false;
            try {model.applyResets(0.2,[0.2],[],[],[],[],[])}catch(error){failed=error.message.includes('transaction blocked')}
            if(!failed)throw new Error('Failed tick consumed clock or previous history');
          }
        }
        return {ok:true};
      }`,
    })
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorPrePropagation() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolvePrePropagation
      Real x(start=0,fixed=true);
      Boolean a(start=false,fixed=true); Boolean b(start=false,fixed=true); Boolean c(start=false,fixed=true);
      equation der(x)=1; a=time>=0.15; b=pre(a); c=pre(b);
      end SolvePrePropagation;`,
    modelName: 'SolvePrePropagation',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing event-iteration model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-pre-propagation')
  for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 0.41, dt: 0.23, x0: [0] },
      'solve-pre-propagation',
      { timeIntegrator },
    )
    const times = getOrbitTime(run)
    for (const name of ['a', 'b', 'c']) {
      const series = getAlgebraicSeries(run, name)
      for (let i = 0; i < times.length; i++)
        if (series[i] !== Number(Number(times[i]) >= 0.15 - 1e-12))
          throw new Error(
            `Ordinary pre history did not reach its event fixed point: ${name} at ${times[i]}: ${series[i]}`,
          )
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorStructuredDiscrete() {
  const wasm = await getDiagnosticsWasm()
  for (const clocked of [false, true]) {
    const compilation = compileRumocaTemplates({
      wasm,
      source: `model SolveStructuredDiscrete
        Real x(start=0,fixed=true);
        ${clocked ? 'Clock c=Clock(1,10);' : ''}
        Integer a(start=0,fixed=true); Integer b[3];
        equation der(x)=1;
        when ${clocked ? 'c' : 'sample(0,0.1)'} then a=${clocked ? 'previous(a)' : 'pre(a)'}+1; end when;
        for i in 1:3 loop b[i]=a+i; end for;
        end SolveStructuredDiscrete;`,
      modelName: 'SolveStructuredDiscrete',
      templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
    })
    const generated = compilation.rendered[0]
    if (!generated?.ok) throw new Error(generated?.error ?? 'Missing structured discrete model')
    const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-structured-discrete')
    for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
      const run = await runOrbitSimulation(
        code,
        { t0: 0, tf: 0.41, dt: 0.23, x0: [0] },
        'solve-structured-discrete',
        { timeIntegrator },
      )
      const times = getOrbitTime(run)
      for (let lane = 1; lane <= 3; lane++) {
        const series = getAlgebraicSeries(run, `b[${lane}]`)
        for (let i = 0; i < times.length; i++)
          if (series[i] !== lane + 1 + Math.floor((Number(times[i]) + 1e-12) / 0.1))
            throw new Error('Structured discrete target or execution order changed')
      }
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorImplicitEventEquations() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveImplicitWhen
      Real x(start=0,fixed=true); Real a(start=1); discrete Real z(start=0,fixed=true);
      equation der(x)=1; a*a+z=3;
      when time>=0.15 then z=-2*a; end when;
      end SolveImplicitWhen;`,
    modelName: 'SolveImplicitWhen',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing implicit event model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-implicit-event')
  for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 0.41, dt: 0.23, x0: [0] },
      'solve-implicit-event',
      { timeIntegrator },
    )
    const times = getOrbitTime(run),
      a = getAlgebraicSeries(run, 'a'),
      z = getAlgebraicSeries(run, 'z')
    for (let i = 0; i < times.length; i++) {
      if (Math.abs(Number(a[i]) ** 2 + Number(z[i]) - 3) > 1e-6)
        throw new Error('Event lost algebraic consistency')
      if (Number(times[i]) >= 0.15 && Math.abs(Number(z[i]) + 2 * Number(a[i])) > 1e-6)
        throw new Error('Condition history deactivated when equation before algebraics settled')
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorCoupledEventRecovery() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveEventRecovery
      Real x(start=0,fixed=true), a(start=1);
      discrete Real z(start=0,fixed=true);
      equation der(x)=1; 2*a=z+3;
      when time>=0.15 then z=6-2*a; end when;
      end SolveEventRecovery;`,
    modelName: 'SolveEventRecovery',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing coupled event model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-event-recovery')
  for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 0.3, dt: 0.2, x0: [0] },
      'solve-event-recovery',
      { timeIntegrator, newtonTol: 1e-9 },
    )
    const times = getOrbitTime(run)
    const a = getAlgebraicSeries(run, 'a')
    const z = getAlgebraicSeries(run, 'z')
    if (Number(times[times.length - 1]) !== 0.3)
      throw new Error('Stalled event equations stopped before the simulation horizon')
    for (let i = 0; i < times.length; i++) {
      if (Math.abs(2 * Number(a[i]) - Number(z[i]) - 3) > 1e-6)
        throw new Error('Coupled recovery lost algebraic consistency')
      if (Number(times[i]) >= 0.15 && Math.abs(Number(z[i]) + 2 * Number(a[i]) - 6) > 1e-6)
        throw new Error('Coupled recovery did not satisfy the active event equation')
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorRuntimeAssignments() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveRuntimeAliases
      Real x(start=0,fixed=true); Boolean a,b,c;
      equation der(x)=if c then 2 else 1;
      a=x>=0.15; b=a; c=b;
      end SolveRuntimeAliases;`,
    modelName: 'SolveRuntimeAliases',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing runtime assignment model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-runtime-aliases')
  for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 0.35, dt: 0.2, x0: [0] },
      'solve-runtime-aliases',
      { timeIntegrator, newtonTol: 1e-7, eventTolTime: 1e-6 },
    )
    const times = getOrbitTime(run)
    const x = getStateSeries(run, 'x')
    if (Number(times[times.length - 1]) !== 0.35)
      throw new Error('Runtime assignment model stopped before its horizon')
    for (let i = 0; i < times.length; i++) {
      const t = Number(times[i])
      if (Math.abs(Number(x[i]) - (t <= 0.15 ? t : 2 * t - 0.15)) > 1e-5)
        throw new Error('Runtime aliases did not propagate the accepted relation into dynamics')
      for (const name of ['a', 'b', 'c']) {
        const series = getAlgebraicSeries(run, name)
        if (t > 0.15001 && Number(series[i]) !== 1)
          throw new Error('Post-commit runtime alias observation is stale')
      }
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorAlgebraicRelations() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveAlgebraicRelations
      Real x(start=0,fixed=true), a(start=1);
      discrete Real z(start=0,fixed=true); Boolean b;
      equation der(x)=if b then 2 else 1;
      a*a=x+z+1; b=a>=1.5;
      when time>=0.15 then z=pre(z)+3; end when;
      end SolveAlgebraicRelations;`,
    modelName: 'SolveAlgebraicRelations',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing algebraic relation model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-algebraic-relations')
  for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 0.35, dt: 0.2, x0: [0] },
      'solve-algebraic-relations',
      { timeIntegrator, newtonTol: 1e-7 },
    )
    const times = getOrbitTime(run)
    const x = getStateSeries(run, 'x')
    const a = getAlgebraicSeries(run, 'a')
    const z = getAlgebraicSeries(run, 'z')
    const b = getAlgebraicSeries(run, 'b')
    if (Number(times[times.length - 1]) !== 0.35)
      throw new Error('Algebraic relation model stopped before its horizon')
    for (let i = 0; i < times.length; i++) {
      const t = Number(times[i])
      if (Math.abs(Number(a[i]) ** 2 - Number(x[i]) - Number(z[i]) - 1) > 1e-6)
        throw new Error('Relation refresh lost algebraic consistency')
      if (Math.abs(Number(x[i]) - (t <= 0.15 ? t : 2 * t - 0.15)) > 1e-5)
        throw new Error('Projected algebraic relation did not update the same-instant dynamics')
      if (t >= 0.15 && (Number(b[i]) !== 1 || Number(z[i]) !== 3))
        throw new Error(
          'Relation iteration advanced condition history before discrete equations settled',
        )
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorRelationModeSearch() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveRelationCycle
      Real x(start=0,fixed=true), a(start=-1), b(start=-1); Boolean p,q;
      equation der(x)=1;
      a=if time<0.15 then -1 else (if q then 1 else -1);
      b=if time<0.15 then -1 else (if p then 1 else (if q then -1 else 1));
      p=a>0; q=b>0;
      end SolveRelationCycle;`,
    modelName: 'SolveRelationCycle',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing relation cycle model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-relation-cycle')
  for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 0.3, dt: 0.2, x0: [0] },
      'solve-relation-cycle',
      { timeIntegrator, newtonTol: 1e-7 },
    )
    const times = getOrbitTime(run)
    if (Number(times[times.length - 1]) !== 0.3)
      throw new Error('Relation cycle stopped before its consistent mode was found')
    for (const name of ['a', 'b', 'p', 'q']) {
      const series = getAlgebraicSeries(run, name)
      for (let i = 0; i < times.length; i++)
        if (Number(times[i]) >= 0.15 && Math.abs(Number(series[i]) - 1) > 1e-6)
          throw new Error('Joint mode search left an inconsistent algebraic or Boolean coordinate')
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorAcceptedHistoryLifecycle() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveHistoryLifecycle
      Real x(start=1,fixed=true);
      equation der(x)=-20*x;
      when x<=0.2 then reinit(x,1); end when;
      end SolveHistoryLifecycle;`,
    modelName: 'SolveHistoryLifecycle',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing accepted-history model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-history-lifecycle',
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
    code: `() => {
      ${generated.content}
      ${defaultSolverSource}
      for(const timeIntegrator of ['sdirk2','irk4','rk45']) {
        const model=Model(),points=[];
        let evaluations=0,totalEvaluations=0,restores=0;
        const residual=model.residual;
        model.residual=(...args)=>{evaluations++;totalEvaluations++;return residual(...args);};
        model.checkpointRuntime=()=>{
          const saved=points.map(point=>({...point})),count=evaluations;
          return ()=>{points.splice(0,points.length,...saved);evaluations=count;restores++;};
        };
        model.commitAcceptedStep=(t,x)=>{
          if(points.length&&t<points[points.length-1].t)
            throw new Error('Speculative future history leaked into an accepted step');
          points.push({t,x:x[0]});
        };
        const run=simulateModel({sim:{t0:0,tf:0.23,dt:0.23,x0:[1],solverOptions:{
          timeIntegrator,eventTolTime:1e-5,rk45AbsTol:1e-9,rk45RelTol:1e-8,
        }}},{},model);
        if(run.meta.stopReason||run.data.t[run.data.t.length-1]!==0.23)
          throw new Error('Accepted-history lifecycle stopped the simulation');
        if(!points.length||points[0].t!==0||points[points.length-1].t!==0.23)
          throw new Error('Accepted-history callbacks missed the initial or final point');
        if(restores===0||evaluations>=totalEvaluations)
          throw new Error('Event localization did not rewind speculative runtime state');
        if(!points.some((point,i)=>i&&point.t===points[i-1].t&&point.x!==points[i-1].x))
          throw new Error('Event left and right limits were not committed at one timestamp');
        if(timeIntegrator==='rk45'&&!(run.meta.solverStats.rk45Rejected>0))
          throw new Error('Fixture did not exercise rejected adaptive steps');
      }
      return {ok:true};
    }`,
  })
}

export async function testModelicaSolveGeneratorDelayHistory() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveDelayHistory
      Real x(start=1,fixed=true); Real y;
      equation der(x)=-delay(x,0.1,0.3); y=delay(x,0.1,0.3);
      end SolveDelayHistory;`,
    modelName: 'SolveDelayHistory',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing delayed feedback model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-delay-history')
  for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 0.3, dt: 0.23, x0: [1] },
      'solve-delay-history',
      { timeIntegrator, newtonTol: 1e-7, maxStep: 0.02 },
    )
    const times = getOrbitTime(run)
    const x = getStateSeries(run, 'x')
    const delayed = getAlgebraicSeries(run, 'y')
    const solution = (t: number) =>
      1 - t + Math.max(0, t - 0.1) ** 2 / 2 - Math.max(0, t - 0.2) ** 3 / 6
    if (Number(times[times.length - 1]) !== 0.3)
      throw new Error('Delayed feedback stopped before its horizon')
    for (let i = 0; i < times.length; i++) {
      if (Math.abs(Number(x[i]) - solution(Number(times[i]))) > 2e-4)
        throw new Error('Delay feedback did not use accepted method-of-steps history')
      if (Math.abs(Number(delayed[i]) - solution(Math.max(0, Number(times[i]) - 0.1))) > 2e-4)
        throw new Error('Delay observation read speculative or stale history')
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorDelayReversal() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveDelayReversal
      Real x(start=0,fixed=true), y; discrete Real u(start=0,fixed=true);
      equation der(x)=1;
      when time>=0.1 then u=1; end when;
      y=delay(u,if time<0.7 then 0.2 else 0.8,1.0);
      end SolveDelayReversal;`,
    modelName: 'SolveDelayReversal',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing variable delay model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-delay-reversal')
  for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 1.2, dt: 0.4, x0: [0] },
      'solve-delay-reversal',
      { timeIntegrator, newtonTol: 1e-7, eventTolTime: 1e-6, maxStep: 0.02 },
    )
    const times = getOrbitTime(run)
    const y = getAlgebraicSeries(run, 'y')
    if (Number(times[times.length - 1]) !== 1.2)
      throw new Error('Variable delay stopped before its horizon')
    for (let i = 0; i < times.length; i++) {
      const t = Number(times[i])
      if ([0.3, 0.7, 0.9].some((boundary) => Math.abs(t - boundary) <= 2e-6)) continue
      const expected = t < 0.3 || (t >= 0.7 && t < 0.9) ? 0 : 1
      if (Number(y[i]) !== expected)
        throw new Error('Variable delay lost a forward or backward discontinuity crossing')
    }
    for (const boundary of [0.3, 0.7, 0.9])
      if (!times.some((t) => Math.abs(Number(t) - boundary) <= 2e-6))
        throw new Error('Transported delay discontinuity did not receive an event sample')
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorZeroDelay() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveZeroDelay
      Real x(start=0,fixed=true), y; discrete Real u(start=0,fixed=true);
      equation der(x)=1;
      when sample(0.1,0.2) then u=pre(u)+1; end when;
      y=delay(u,if time<0.3 then 0.2 else 0.0,0.5);
      end SolveZeroDelay;`,
    modelName: 'SolveZeroDelay',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing zero-delay transition model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-zero-delay')
  for (const timeIntegrator of ['sdirk2', 'irk4', 'rk45']) {
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 0.41, dt: 0.23, x0: [0] },
      'solve-zero-delay',
      { timeIntegrator, newtonTol: 1e-7, maxStep: 0.02 },
    )
    const times = getOrbitTime(run)
    const y = getAlgebraicSeries(run, 'y')
    const u = getAlgebraicSeries(run, 'u')
    if (Number(times[times.length - 1]) !== 0.41)
      throw new Error('Zero-delay transition stopped before its horizon')
    for (let i = 0; i < times.length; i++) {
      if (Number(times[i]) < 0.3 && Number(y[i]) !== 0)
        throw new Error('Positive delay exposed the discrete source too early')
      if (Number(times[i]) >= 0.3 && (Number(y[i]) !== 2 || Number(u[i]) !== 2))
        throw new Error('Zero delay missed the same-instant discrete source update')
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorRepeatedRuns() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveRepeated
      Real x(start=0,fixed=true);
      discrete Real deadline(start=0.15,fixed=true);
      discrete Integer count(start=0,fixed=true);
      equation der(x)=1;
      when time >= deadline then deadline=pre(deadline)+0.1; count=pre(count)+1; end when;
      when terminal() then assert(false,"run finished",level=AssertionLevel.warning); end when;
      end SolveRepeated;`,
    modelName: 'SolveRepeated',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing reusable model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-repeated-runs',
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
    code: `() => {
      ${generated.content}
      ${defaultSolverSource}
      const model=Model();
      const options={sim:{t0:0,tf:0.4,dt:0.2,x0:[0],solverOptions:{timeIntegrator:'sdirk2'}}};
      const first=simulateModel(options,{},model),second=simulateModel(options,{},model);
      for(const run of [first,second]) {
        if(run.meta.stopReason||run.meta.stopError)throw new Error('Reused model failed');
        if(run.data.y.count[0]!==0||run.data.y.count.at(-1)!==3)throw new Error('Discrete state leaked between runs');
        if(run.meta.warnings.filter(message=>message==='run finished').length!==1)throw new Error('Action lifecycle leaked between runs');
      }
      if(first.data.t.length!==second.data.t.length)throw new Error('Deadline state leaked between runs');
      for(let i=0;i<first.data.t.length;i++) {
        if(first.data.t[i]!==second.data.t[i]||first.data.x.x[i]!==second.data.x.x[i]||first.data.y.count[i]!==second.data.y.count[i])throw new Error('Repeated trajectory differs');
      }
      return {ok:true};
    }`,
  })
}

export async function testModelicaSolveGeneratorTornAlgebraicProjection() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveTornProjection
      input Real u=2; Real a(start=1),b(start=1),c;
      equation a*a+b=u; b=a; c=2*a;
      end SolveTornProjection;`,
    modelName: 'SolveTornProjection',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing torn projection model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-torn-projection',
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
    code: `() => {
      ${generated.content}
      ${defaultSolverSource}
      for(const timeIntegrator of ['sdirk2','irk4','rk45']) {
        const model=Model(),sizes=[],project=model.projectAlgebraics;
        model.projectAlgebraics=(...args)=>{
          const solve=args[5];
          args[5]=(residual,initial,scales)=>{sizes.push(initial.length);return solve(residual,initial,scales);};
          return project(...args);
        };
        const run=simulateModel({sim:{t0:0,tf:0.3,dt:0.1,f_u:t=>[2+100*t],
          solverOptions:{timeIntegrator,newtonTol:1e-8}}},{},model);
        if(run.meta.stopReason||run.data.t.at(-1)!==0.3)throw new Error('Torn projection stopped before its horizon');
        if(sizes.length<3||sizes.some(size=>size!==1))throw new Error('Newton included causal algebraic coordinates outside the native tear set');
        for(let i=0;i<run.data.t.length;i++) {
          const a=(-1+Math.sqrt(1+4*(2+100*run.data.t[i])))/2;
          for(const [name,value] of [['a',a],['b',a],['c',2*a]])
            if(Math.abs(run.data.y[name][i]-value)>1e-6)throw new Error('Torn projection lost causal back-substitution');
        }
      }
      return {ok:true};
    }`,
  })
}

export async function testModelicaSolveGeneratorFunctionLoopReturns() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `package LoopReturns
      function first
        input Boolean b[:]; output Integer index;
        algorithm index:=0;
        for i in 1:size(b,1) loop
          if b[i] then index:=i; return; end if;
        end for;
        index:=-1;
      end first;
      function nested
        input Boolean b[2,2]; output Integer index;
        algorithm index:=0;
        for i in 1:2 loop
          for j in 1:2 loop
            if b[i,j] then index:=10*i+j; return; end if;
          end for;
        end for;
        index:=-1;
      end nested;
      function stopBeforeFault
        input Real v[4]; output Real result;
        algorithm result:=0;
        for i in 1:4 loop
          if i==2 then return; end if;
          result:=result+v[i]/(i-2);
        end for;
        result:=1234;
      end stopBeforeFault;
      model Probe
        input Real u[4]={0,0,0,0}; Integer firstIndex,nestedIndex; Real stopped;
        equation
        firstIndex=first({u[1]>0,u[2]>0,u[3]>0,u[4]>0});
        nestedIndex=nested({{u[1]>0,u[2]>0},{u[3]>0,u[4]>0}});
        stopped=stopBeforeFault(u);
      end Probe;
      end LoopReturns;`,
    modelName: 'LoopReturns.Probe',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing function loop-return model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-function-loop-returns',
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
    code: `() => {
      ${generated.content}
      ${defaultSolverSource}
      const cases=[[0,0,0,0],[0,1,0,1],[1,1,1,1],[0,0,0,1]];
      for(const timeIntegrator of ['sdirk2','irk4','rk45']) {
        const run=simulateModel({sim:{t0:0,tf:0.3,dt:0.1,
          f_u:t=>cases[Math.min(3,Math.round(t/0.1))],
          solverOptions:{timeIntegrator}}},{},Model());
        if(run.meta.stopReason || run.data.t.at(-1)!==0.3)
          throw new Error('A loop return evaluated its faulting suffix or lost its carried state');
        for(let i=0;i<run.data.t.length;i++) {
          const u=cases[Math.min(3,Math.round(run.data.t[i]/0.1))];
          const first=u.findIndex(value=>value>0);
          const expected=first<0?-1:first+1;
          const nested=first<0?-1:10*(1+Math.floor(first/2))+1+first%2;
          if(run.data.y.firstIndex[i]!==expected || run.data.y.nestedIndex[i]!==nested
             || run.data.y.stopped[i]!==-u[0])
            throw new Error('A function loop return failed first-match or enclosing-function exit semantics');
        }
      }
      return {ok:true};
    }`,
  })
}

export async function testModelicaSolveGeneratorNativeExactAssignments() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `function NativePair
      input Real u; output Real a,b;
      algorithm a:=0; b:=0;
      for i in 1:3 loop
        if i==2 then return; end if;
        a:=a+u; b:=b+2*u;
      end for;
      a:=1234; b:=5678;
      end NativePair;
      model NativeExactAssignments
      input Real u=1; Real x(start=1,fixed=true),a,b;
      equation der(x)=x; (a,b)=NativePair(x+u);
      end NativeExactAssignments;`,
    modelName: 'NativeExactAssignments',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing native exact assignment model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-native-exact-assignments',
    code: `() => {
      ${generated.content}
      const model=Model();
      for(const input of [1,-2,0.5]) {
        const y=typeof model.projectAlgebraics==='function'
          ? model.projectAlgebraics(0,[7],model.y0,[input],null,()=>{
              throw new Error('Certified direct assignment required a numerical solve');
            })
          : model.y0;
        const observed=model.evalAlgebraics(0,[7],y,[input],null);
        if(observed.length!==2 || observed[0]!==7+input || observed[1]!==2*(7+input))
          throw new Error('Native exact assignments changed multiple function outputs');
        const residual=model.residual(0,[7],[7],y,[input],null);
        if(residual.some(value=>value!==0))
          throw new Error('Native assignment prefix overwrote a state coordinate');
      }
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaSolveGeneratorRectangularProjection() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveProjectionBoundary
      Real x(start=0,fixed=true),y(start=0,fixed=true),z(start=0,fixed=true);
      equation der(x)=1; der(y)=1; der(z)=0;
      end SolveProjectionBoundary;`,
    modelName: 'SolveProjectionBoundary',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing projection boundary fixture')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-rectangular-projection',
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
    code: `() => {
      ${generated.content}
      ${defaultSolverSource}
      for(const timeIntegrator of ['sdirk2','irk4','rk45']) {
        const model=Model();
        // Synthetic rectangular constraints exercise the same numerical callback the generator uses.
        model.projectStateManifold=(t,x,y,u,p,project)=>({x:project(
          coordinates=>[coordinates[0]+coordinates[1]-t,coordinates[1]+coordinates[2]],
          (coordinates,direction)=>[direction[0]+direction[1],direction[1]+direction[2]],
          x,[1,2,3]),y});
        const run=simulateModel({sim:{t0:0,tf:0.3,dt:0.1,x0:[0,0,0],
          solverOptions:{timeIntegrator,newtonTol:1e-8}}},{},model);
        if(run.meta.stopReason||run.data.t.at(-1)!==0.3)
          throw new Error('Rectangular projection stopped before its horizon');
        for(let i=0;i<run.data.t.length;i++) {
          const t=run.data.t[i],expected=[40*t/49,9*t/49,-9*t/49];
          if(['x','y','z'].some((name,k)=>Math.abs(run.data.x[name][i]-expected[k])>1e-7))
            throw new Error('Projection did not apply the minimum-norm nominal-scaled correction');
        }
        const failing=Model(),committed=[];
        let pending=0;
        failing.checkpointRuntime=()=>{const before=pending;return()=>{pending=before;};};
        failing.commitAcceptedStep=t=>committed.push(t);
        failing.projectStateManifold=(t,x,y,u,p,project)=>{
          pending++;
          return {x:project(()=>[1],()=>[0,0,0],x,[1,2,3]),y};
        };
        const refused=simulateModel({sim:{t0:0,tf:0.3,dt:0.1,x0:[0,0,0],
          solverOptions:{timeIntegrator,newtonTol:1e-8}}},{},failing);
        if(!refused.meta.stopReason || refused.data.t.at(-1)!==0 || pending!==0 || committed.some(t=>t!==0))
          throw new Error('Failed manifold projection committed a state or leaked its runtime trial');
      }
      return {ok:true};
    }`,
  })
}

export async function testModelicaSolveGeneratorManifoldProjection() {
  const wasm = await getDiagnosticsWasm()
  // A quaternion with three kinematic rows and the unit-norm constraint is an
  // index-2 DAE: Rumoca retains `Q*Q = 1` and reprojects every accepted state.
  // The start is a regular chart point; `{1,0,0,0}` puts the retained
  // constraint's dependent coordinate at zero, where the reduced system is
  // singular for Rumoca's own solver as well, so the fixture starts elsewhere.
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveQuaternion
 Real Q[4](start={0.5,0.5,0.5,0.5},fixed=true);
 parameter Real w1=0.1,w2=0.2,w3=0.3;
equation
 der(Q[1])=0.5*(-Q[2]*w1-Q[3]*w2-Q[4]*w3);
 der(Q[2])=0.5*(Q[1]*w1+Q[3]*w3-Q[4]*w2);
 der(Q[3])=0.5*(Q[1]*w2-Q[2]*w3+Q[4]*w1);
 Q*Q=1;
end SolveQuaternion;
`,
    modelName: 'SolveQuaternion',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing manifold model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-manifold-projection',
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
    code: `() => {
      ${generated.content}
      ${defaultSolverSource}
      const q0=[0.5,0.5,0.5,0.5],w=[0.1,0.2,0.3],omega=Math.sqrt(0.14);
      const product=(a,b)=>[
        a[0]*b[0]-(a[1]*b[1]+a[2]*b[2]+a[3]*b[3]),
        a[0]*b[1]+b[0]*a[1]+(a[2]*b[3]-a[3]*b[2]),
        a[0]*b[2]+b[0]*a[2]+(a[3]*b[1]-a[1]*b[3]),
        a[0]*b[3]+b[0]*a[3]+(a[1]*b[2]-a[2]*b[1])];
      for(const timeIntegrator of ['sdirk2','irk4','rk45']) {
        const model=Model(),run=simulateModel({sim:{t0:0,tf:35,dt:0.3,x0:model.x0,
          solverOptions:{timeIntegrator,newtonTol:1e-8}}},{},model);
        if(run.meta.stopReason||run.data.t.at(-1)!==35)
          throw new Error('Manifold simulation stopped before its horizon: '+run.meta.stopReason+' '+(run.meta.stopError||''));
        for(let i=0;i<run.data.t.length;i++) {
          const t=run.data.t[i],q=[1,2,3,4].map(k=>run.data.x['Q['+k+']'][i]);
          if(Math.abs(q.reduce((sum,value)=>sum+value*value,0)-1)>1e-7)
            throw new Error('Accepted state drifted from the retained quaternion norm');
          const half=omega*t/2;
          const exact=product(q0,[Math.cos(half),w[0]/omega*Math.sin(half),w[1]/omega*Math.sin(half),w[2]/omega*Math.sin(half)]);
          if(q.some((value,k)=>Math.abs(value-exact[k])>0.01))
            throw new Error('Projection did not preserve the quaternion rotation trajectory');
        }
      }
      return {ok:true};
    }`,
  })
}

export async function testModelicaSolveGeneratorImpureRandomRollback() {
  const wasm = await getDiagnosticsWasm()
  const fixtureFunction = `
    {% set null=none %}
    {% set program_fixtures=${JSON.stringify(checkedSolveFixtures)} %}
    function evaluateImpure(t) {
      const sy=[],sp=[],output=[];
      {% for fixture in program_fixtures %}
      {% if fixture.name == 'impure_event_calls' %}
      {{ evaluate(fixture.plan,'output',effects) }}
      {% endif %}
      {% endfor %}
      return output;
    }`
  const template = solveJavascriptTemplate
    .replace('  const description = {', fixtureFunction + '  const description = {')
    .replace('    abiRequired: true,', '    evaluateImpure,abiRequired: true,')
    .replace(
      '    const output=[],warnings=[],warningSites=[];',
      '    if(t>=0.1)evaluateImpure(t);const output=[],warnings=[],warningSites=[];',
    )
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveImpureRollback
      Real x(start=1,fixed=true);
      equation der(x)=-x; assert(time<0.1,"event rejected");
      end SolveImpureRollback;`,
    modelName: 'SolveImpureRollback',
    templates: [{ source: template, path: 'impure_rollback.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing impure random fixture')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-impure-rollback',
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
    code: `() => {
      ${generated.content}
      ${defaultSolverSource}
      const expected=${JSON.stringify(checkedSolveFixtures)}.find(fixture=>fixture.name==='impure_event_calls').expected;
      const model=Model(),other=Model();
      const options={sim:{t0:0,tf:0.05,dt:0.05,x0:[1]}};
      simulateModel(options,{},model);simulateModel(options,{},other);
      const equal=(a,b)=>a.length===b.length&&a.every((value,i)=>Object.is(value,b[i]));
      const first=model.evaluateImpure(0);
      if(!equal(first,expected)||!equal(first,model.evaluateImpure(0)))
        throw new Error('Impure stream differs from native or repeated event draw advanced it');
      if(first[1]!==first[2]||first[2]===first[3])
        throw new Error('Distinct u64 call sites collapsed or repeated site was not cached');
      const restore=model.checkpointRuntime(),next=model.evaluateImpure(1);
      model.evaluateImpure(2);restore();
      if(!equal(next,model.evaluateImpure(1)))
        throw new Error('Runtime rollback did not restore the random continuation');
      if(!equal(first,other.evaluateImpure(0))||!equal(next,other.evaluateImpure(1)))
        throw new Error('Random state leaked between generated model instances');
      const beforeEvent=model.checkpointRuntime();
      let failed=false;
      try {model.applyResets(0.2,[1],[],[],[],[true],[false]);}
      catch(error){if(!String(error).includes('event rejected'))throw error;failed=true;}
      if(!failed)throw new Error('Fixture did not exercise failed event rollback');
      const afterFailure=model.evaluateImpure(3);beforeEvent();
      if(!equal(afterFailure,model.evaluateImpure(3)))
        throw new Error('Failed event consumed a random draw');
      simulateModel(options,{},model);
      if(!equal(first,model.evaluateImpure(0)))
        throw new Error('Model initialization retained an old random stream');
      return {ok:true};
    }`,
  })
}

export async function testModelicaSolveGeneratorScalarPrograms() {
  const wasm = await getDiagnosticsWasm()
  // These template views were emitted from checked native IR and compared with its evaluator.
  const fixtureFunction = `
    {% set null=none %}
    {% set program_fixtures=${JSON.stringify(checkedSolveFixtures)} %}
    function evaluateProgramFixtures() {
      const sy=[],sp=[],t=0,results=[];
      {% for fixture in program_fixtures %}
      { const output=[]; {{ evaluate(fixture.plan,'output') }} results.push(output); }
      {% endfor %}
      return results;
    }`
  const template = solveJavascriptTemplate
    .replace('  const description = {', fixtureFunction + '  const description = {')
    .replace('    abiRequired: true,', '    evaluateProgramFixtures,abiRequired: true,')
  const compilation = compileRumocaTemplates({
    wasm,
    source:
      'model SolveScalarFolds Real x(start=1,fixed=true); equation der(x)=-x; end SolveScalarFolds;',
    modelName: 'SolveScalarFolds',
    templates: [{ source: template, path: 'scalar_programs.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing checked scalar-program output')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-scalar-folds',
    code: `() => {
      ${generated.content}
      const fixtures=${JSON.stringify(checkedSolveFixtures)},results=Model(fixtures.flatMap(fixture=>fixture.external_tables)).evaluateProgramFixtures();
      for(let i=0;i<fixtures.length;i++) {
        const expected=fixtures[i].expected,actual=results[i];
        if(actual.length!==expected.length || actual.some((value,k)=>value!==expected[k]))
          throw new Error('Scalar program differs from native evaluation: '+fixtures[i].name);
      }
      let rejected=false;
      try {Model([]).evaluateProgramFixtures()}
      catch(error){if(!String(error).includes('External table data was not provided'))throw error;rejected=true}
      if(!rejected)throw new Error('Missing external table data was silently accepted');
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaSolveGeneratorDiscreteObservations() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveObserved
      Real x(start=0,fixed=true); Real a;
      discrete Integer count(start=0,fixed=true);
      discrete Boolean fired(start=false,fixed=true);
      equation der(x)=1; a=2*x;
      when time >= 0.35 then count=pre(count)+1; fired=true; end when;
      end SolveObserved;`,
    modelName: 'SolveObserved',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing observed model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-observations')
  const run = await runOrbitSimulation(
    code,
    { t0: 0, tf: 0.6, dt: 0.2, x0: [0] },
    'solve-observations',
    { timeIntegrator: 'sdirk2' },
  )
  const times = getOrbitTime(run)
  for (const name of ['count', 'fired']) {
    const values = getAlgebraicSeries(run, name)
    if (values.length !== times.length) throw new Error('Missing discrete observations: ' + name)
    for (let i = 0; i < times.length; i++)
      if (Number(values[i]) !== (Number(times[i]) >= 0.35 ? 1 : 0))
        throw new Error('Incorrect discrete observation: ' + name)
  }
  const a = getAlgebraicSeries(run, 'a')
  const x = getStateSeries(run, 'x')
  if (a.some((value, i) => Math.abs(Number(value) - 2 * Number(x[i])) > 1e-8))
    throw new Error('Discrete observations changed algebraic projection')
  return { ok: true }
}

export async function testModelicaSolveGeneratorEventObservationSnapshots() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveObservationSnapshots
      Real x(start=0,fixed=true);
      discrete Real deadline(start=0.15,fixed=true);
      discrete Integer count(start=0,fixed=true);
      equation der(x)=1;
      when time >= deadline then
        deadline=pre(deadline)+0.1; count=pre(count)+1;
      end when;
      end SolveObservationSnapshots;`,
    modelName: 'SolveObservationSnapshots',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing observation snapshot model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-observation-snapshots')
  const run = await runOrbitSimulation(
    code,
    { t0: 0, tf: 0.8, dt: 0.4, x0: [0] },
    'solve-observation-snapshots',
    { timeIntegrator: 'sdirk2' },
  )
  const times = getOrbitTime(run),
    counts = getAlgebraicSeries(run, 'count')
  for (let i = 0; i < times.length; i++) {
    const expected = Math.max(0, Math.floor((Number(times[i]) - 0.15 + 1e-12) / 0.1) + 1)
    if (Number(counts[i]) !== expected)
      throw new Error(`Event observation was overwritten: t=${times[i]}, count=${counts[i]}`)
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorScheduledEvents() {
  const wasm = await getDiagnosticsWasm()
  const cases = [
    {
      name: 'SolveScheduled',
      source: `model SolveScheduled
      Real x(start=0,fixed=true);
      equation der(x)=1;
      when time >= 0.35 then reinit(x,10); end when;
      when time >= 0.65 then terminate("scheduled stop"); end when;
      end SolveScheduled;`,
      time: 0.65,
      x: 10.3,
      stop: 'modelica_terminate',
    },
    {
      name: 'SolveDynamicDeadline',
      source: `model SolveDynamicDeadline
      Real x(start=0,fixed=true); discrete Real deadline(start=0.35,fixed=true);
      equation der(x)=1;
      when time >= deadline then
        deadline=pre(deadline)+0.3; reinit(x,10);
      end when;
      end SolveDynamicDeadline;`,
      time: 1,
      x: 10.05,
      stop: null,
    },
  ]
  for (const fixture of cases) {
    const compilation = compileRumocaTemplates({
      wasm,
      source: fixture.source,
      modelName: fixture.name,
      templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
    })
    const generated = compilation.rendered[0]
    if (!generated?.ok) throw new Error(generated?.error ?? 'Missing scheduled model')
    const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-scheduled-events')
    const run = await runOrbitSimulation(
      code,
      { t0: 0, tf: 1, dt: 0.2, x0: [0] },
      'solve-scheduled-events',
      { timeIntegrator: 'sdirk2' },
    )
    const x = getStateSeries(run, 'x'),
      times = getOrbitTime(run)
    if (
      (run.meta?.stopReason ?? null) !== fixture.stop ||
      Math.abs(Number(times.at(-1)) - fixture.time) > 1e-12
    )
      throw new Error('Scheduled termination missed its exact deadline: ' + fixture.name)
    if (Math.abs(Number(x.at(-1)) - fixture.x) > 1e-6)
      throw new Error('Scheduled reset was missed or repeated: ' + fixture.name)
    for (const deadline of fixture.name === 'SolveScheduled' ? [0.35] : [0.35, 0.65, 0.95]) {
      const index = times.findIndex((time) => Math.abs(Number(time) - deadline) < 1e-12)
      if (index < 0 || Math.abs(Number(x[index]) - 10) > 1e-6)
        throw new Error('Missing accepted time-event sample: ' + deadline)
    }
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorActionMessages() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveActionMessages
      Real x(start=1,fixed=true);
      equation der(x)=0.0;
      assert(x<0,"μ="+String(x,minimumLength=8,leftJustified=false,significantDigits=3)+
        "; i="+String(integer(x))+"; b="+String(x>0),AssertionLevel.warning);
      end SolveActionMessages;`,
    modelName: 'SolveActionMessages',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing action-message model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-action-messages',
    code: `() => {
      ${generated.content}
      for(const [value,expected] of [[12.345,"μ=    12.3; i=12; b=true"],
          [0.000012345,"μ= 1.23e-5; i=0; b=true"],[0,"μ=       0; i=0; b=false"],[120,"μ=     120; i=120; b=true"]]) {
        const report=Model().evaluateEventActions(0,[value],[],[],null);
        if(report.warnings[0]!==expected)
          throw new Error('Incorrect Modelica action message: '+report.warnings[0]);
      }
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaSolveGeneratorActions() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `function LoopFlow
      input Real x; output Real y;
      algorithm y:=0;
      for i in 1:3 loop
        assert(x+i>0,"loop invariant "+String(integer(1/(if x+i>0 then 0 else 1))));
        y:=y+x;
      end for;
      end LoopFlow;
      model SolveActions
      Real x(start=1,fixed=true);
      equation der(x)=LoopFlow(x);
      assert(x<5,"accepted warning",AssertionLevel.warning);
      end SolveActions;`,
    modelName: 'SolveActions',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing action model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-actions',
    code: `() => {
      ${generated.content}
      const model=Model();
      const report=model.evaluateEventActions(0,[1],[],[],null);
      if(report.termination!==undefined || report.warnings.length!==0)throw new Error('Valid assertion produced an action');
      if(model.evaluateEventActions(0,[6],[],[],null).warnings[0]!=='accepted warning')throw new Error('Warning assertion was not reported');
      if(model.evaluateEventActions(0,[6],[],[],null).warnings.length!==0)throw new Error('Warning site was repeated');
      let rejected=false;
      try {model.evaluateEventActions(0,[-2],[],[],null)}
      catch(error){if(!String(error).includes('loop invariant 1'))throw error;rejected=true}
      if(!rejected)throw new Error('Function loop assertion was not evaluated');
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaSolveGeneratorAssertionObservations() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `function CheckFlow
      input Real x; output Real y;
      algorithm
        assert(x>0,"iteration "+String(integer(x))+" exact "+String(9007199254740993+integer(x+1)),AssertionLevel.warning);
        y:=x;
      end CheckFlow;
      function LoopFlow
      input Real x; output Real y;
      algorithm y:=0;
        for i in 1:3 loop y:=y+CheckFlow(x+i); end for;
      end LoopFlow;
      model SolveAssertionObservations
      Real x(start=1,fixed=true);
      equation der(x)=LoopFlow(x);
      end SolveAssertionObservations;`,
    modelName: 'SolveAssertionObservations',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing assertion observation model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-assertion-observations',
    code: `() => {
      ${generated.content}
      const model=Model();
      const report=model.evaluateEventActions(0,[-2],[],[],null);
      if(report.warnings.length!==1 || report.warnings[0]!=='iteration -1 exact 9007199254740993')
        throw new Error('Nested loop lost the first failed assertion or its message capture');
      if(model.evaluateEventActions(0,[-2],[],[],null).warnings.length!==0)
        throw new Error('Nested warning site was repeated');
      if(Model().evaluateEventActions(0,[1],[],[],null).warnings.length!==0)
        throw new Error('Accepted nested assertion produced a warning');
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaSolveGeneratorHomotopy() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveHomotopy
      Real x(start=0,fixed=false);
      initial equation homotopy(x*x*x+x,x)=2.0;
      equation der(x)=0.0;
      end SolveHomotopy;`,
    modelName: 'SolveHomotopy',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing homotopy model')
  const instrumented = `${generated.content}
    Model = ((create) => () => {
      const model=create(), initialize=model.initialize;
      let solves=0;
      model.initialize=(t,x,y,u,p,solve,continueHomotopy) => {
        const result=initialize(t,x,y,u,p,(residual,initial,scales)=>{
          if(solves++===0 && Math.abs(residual([2])[0])>1e-10) throw new Error('Homotopy did not start at the simplified system');
          return solve(residual,initial,scales);
        },continueHomotopy);
        if(solves<2)throw new Error('Homotopy did not continue to the actual system');
        return result;
      };
      return model;
    })(Model);`
  const code = await buildWorkerSandboxCodeChecked(instrumented, 'solve-homotopy')
  const run = await runOrbitSimulation(
    code,
    { t0: 0, tf: 0.1, dt: 0.02, x0: [0] },
    'solve-homotopy',
    { timeIntegrator: 'sdirk2' },
  )
  const x = getStateSeries(run, 'x')
  if (!Array.isArray(x) || x.some((value) => Math.abs(Number(value) - 1) > 1e-6))
    throw new Error('Homotopy did not preserve the actual initialized trajectory')
  return { ok: true }
}

export async function testModelicaSolveGeneratorInitialConsistency() {
  const wasm = await getDiagnosticsWasm()
  for (const value of [1, 2]) {
    const compilation = compileRumocaTemplates({
      wasm,
      modelName: 'SolveInitialCheck',
      source: `model SolveInitialCheck Real x(start=1,fixed=true);
        initial equation x=${value}; equation der(x)=0; end SolveInitialCheck;`,
      templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
    })
    const generated = compilation.rendered[0]
    if (!generated?.ok) throw new Error(generated?.error ?? 'Missing initialization-check model')
    const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-initial-check')
    let rejected = false
    try {
      const run = await runOrbitSimulation(
        code,
        { t0: 0, tf: 0.1, dt: 0.02, x0: [1] },
        'solve-initial-check',
        { timeIntegrator: 'sdirk2' },
      )
      if (value === 1 && getStateSeries(run, 'x').some((x) => Math.abs(x - 1) > 1e-8))
        throw new Error('Consistent initialization changed a fixed state')
    } catch (error) {
      if (value === 1 || !String(error).includes('Complete Solve initialization residual'))
        throw error
      rejected = true
    }
    if (value === 2 && !rejected)
      throw new Error('Contradictory initialization was silently accepted')
  }
  return { ok: true }
}

export async function testModelicaSolveGeneratorInitialization() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveInitial
      Real x(start=1,fixed=false);
      initial equation x*x=4;
      equation der(x)=-x;
      end SolveInitial;`,
    modelName: 'SolveInitial',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing initialized model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-initialization')
  const run = await runOrbitSimulation(
    code,
    { t0: 0, tf: 0.2, dt: 0.02, x0: [1] },
    'solve-initialization',
    { timeIntegrator: 'sdirk2' },
  )
  const x = getStateSeries(run, 'x')
  if (!Array.isArray(x) || Math.abs(Number(x[0]) - 2) > 1e-6)
    throw new Error('Initial equation not settled')
  if (Math.abs(Number(x.at(-1)) - 2 * Math.exp(-0.2)) > 1e-3)
    throw new Error('Incorrect initialized trajectory')
  return { ok: true }
}

export async function testModelicaSolveGeneratorStateEvents() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveBounce
      Real h(start=1,fixed=true); Real v(start=0,fixed=true);
      equation der(h)=v; der(v)=-9.81;
      when h<=0 then reinit(v,-0.9*pre(v)); end when;
      end SolveBounce;`,
    modelName: 'SolveBounce',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing event model')
  const code = await buildWorkerSandboxCodeChecked(generated.content, 'solve-state-events')
  const run = await runOrbitSimulation(
    code,
    { t0: 0, tf: 2, dt: 0.01, x0: [1, 0] },
    'solve-state-events',
    { timeIntegrator: 'sdirk2' },
  )
  const h = getStateSeries(run, 'h'),
    v = getStateSeries(run, 'v')
  if (run.meta?.stopReason || h.length < 100 || Math.min(...h) < -1e-4)
    throw new Error('Invalid bounce trajectory')
  const jumps = v.filter((value, index) => index > 0 && value - (v[index - 1] ?? value) > 1)
  if (jumps.length < 2) throw new Error('Missing repeated velocity resets')
  return { ok: true }
}

export async function testModelicaSolveGeneratorFloatingOperations() {
  const wasm = await getDiagnosticsWasm()
  const compilation = compileRumocaTemplates({
    wasm,
    source: `model SolveFloating
      input Real u=1; Real x(start=0,fixed=true);
      equation der(x)=sign(sqrt(u))+min(sqrt(u),3);
      end SolveFloating;`,
    modelName: 'SolveFloating',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const generated = compilation.rendered[0]
  if (!generated?.ok) throw new Error(generated?.error ?? 'Missing floating-point model')
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-solve-floating-operations',
    code: `() => {
      ${generated.content}
      const model=Model();
      for (const [input,derivative] of [[4,3],[0,0],[-1,3]]) {
        const result=model.residual(0,[0],[derivative],[],[input],null);
        if (result.length!==1 || result[0]!==0) throw new Error('Floating operations differ from Rumoca evaluator');
      }
      return {ok:true};
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaIndependentSolveGenerator() {
  const wasm = await getDiagnosticsWasm()
  const result = compileRumocaTemplates({
    wasm,
    source: `model IndependentDecay
      Real x(start=1, fixed=true); Real a; Real b;
      equation der(x)=-x; a=x*x; b=sqrt(a);
      end IndependentDecay;`,
    modelName: 'IndependentDecay',
    templates: [{ source: solveJavascriptTemplate, path: 'javascript_solve.jinja' }],
  })
  const rendered = result.rendered[0]
  if (!rendered?.ok) throw new Error(rendered?.error ?? 'Missing generated model')
  const code = `() => {
${rendered.content}
    const m = Model();
    if (m.meta.generator !== 'solve') throw new Error('Wrong generator');
    if (m.y0.length !== 0) throw new Error('Assignable variables sent to Newton');
    const residual = m.residual(0, [2], [-2], [], [], null);
    const algebraics = m.evalAlgebraics(0, [2], [], [], null);
    if (residual.length !== 1 || Math.abs(residual[0]) > 1e-12) throw new Error('Wrong residual');
    if (algebraics.length !== 2 || algebraics[0] !== 4 || algebraics[1] !== 2) throw new Error('Wrong outputs');
    return { ok: true };
  }`
  return executeModelicaDiagnosticInSandbox({
    id: 'modelica-independent-solve-generator',
    code,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
}

export async function testModelicaOrbitInvariantsCompareSolvers(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  return runModelicaOrbitInvariantTest(
    'compare',
    generator === 'dae' ? javascriptTemplate : solveJavascriptTemplate,
  )
}
testModelicaOrbitInvariantsCompareSolvers.modelicaGenerators = ['dae', 'solve'] as const
testModelicaOrbitInvariantsCompareSolvers.timeoutMs = 40_000

export async function testModelicaOrbitInvariantsSdirkOnly(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  return runModelicaOrbitInvariantTest(
    'sdirk-only',
    generator === 'dae' ? javascriptTemplate : solveJavascriptTemplate,
  )
}
testModelicaOrbitInvariantsSdirkOnly.modelicaGenerators = ['dae', 'solve'] as const
testModelicaOrbitInvariantsSdirkOnly.timeoutMs = 40_000

export async function testModelicaMslResistorSineVoltageIconSourceResolution() {
  const debug: Record<string, unknown> = {
    phase: 'init',
    mslZipPath: MSL_DIAGNOSTICS_ZIP_URL,
  }
  try {
    const wasm = await getDiagnosticsWasm()
    debug.phase = 'wasm-loaded'
    if (typeof wasm.get_class_info !== 'function') {
      throw new Error('Rumoca wasm export missing: get_class_info')
    }
    if (typeof wasm.parse !== 'function') {
      throw new Error('Rumoca wasm export missing: parse')
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

    const sourceModelicaParse = parseSourceSyntaxOrError(
      wasm,
      sourceModelica,
      sourceModelicaFileName,
    )
    const mslFiles = await loadMslSourcesFromZip()
    const sourceFileEntry = readMslSourceFromZipByPath(mslFiles, resolvedSourceFile)
    if (!sourceFileEntry) {
      throw new Error(`Could not locate SineVoltage source file in MSL zip: ${resolvedSourceFile}`)
    }
    const sourceFileParse = parseSourceSyntaxOrError(
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
testModelicaMslResistorSineVoltageIconSourceResolution.timeoutMs = 120_000

export async function testModelicaMslResistorSineVoltageClassInfoRoundtripStrict() {
  const debug: Record<string, unknown> = {
    phase: 'init',
    mslZipPath: MSL_DIAGNOSTICS_ZIP_URL,
  }
  try {
    const wasm = await getDiagnosticsWasm()
    debug.phase = 'wasm-loaded'
    if (typeof wasm.get_class_info !== 'function') {
      throw new Error('Rumoca wasm export missing: get_class_info')
    }
    if (typeof wasm.parse !== 'function') {
      throw new Error('Rumoca wasm export missing: parse')
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
    const daeJson = daeJsonForTemplate(compiled, { usePreparedDae: true })
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
    const sourceModelicaParse = parseSourceSyntaxOrError(wasm, sourceModelica, classInfoFileName)
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

export async function testModelicaDiagnosticGeneratorVariants() {
  const calls: string[] = []
  const setup = () => calls.push('setup')
  const test = Object.assign(
    (_context?: DiagnosticsTestContext, generator: ModelicaGenerator = 'dae') => {
      calls.push(generator)
      if (generator === 'dae') throw new Error('synthetic DAE failure')
      return { ok: true }
    },
    {
      modelicaGenerators: ['dae', 'solve'] as const,
      setup,
      timeoutMs: 1234,
      description: 'synthetic fixture',
    },
  )
  const tests = collectModelicaDiagnosticTests({ testModelicaSynthetic: test, unrelated: () => {} })
  const names = Object.keys(tests)
  if (names.join('|') !== 'testModelicaSyntheticDae|testModelicaSyntheticSolve')
    throw new Error('Generator variants must have distinct filterable names')
  const selected = Object.fromEntries(
    Object.entries(tests).filter(([name]) => name.includes('Synthetic')),
  )
  if (Object.keys(selected).length !== 2) throw new Error('Base-name filter lost a generator')
  for (const variant of Object.values(selected)) {
    if (
      variant.setup !== setup ||
      variant.timeoutMs !== 1234 ||
      variant.description !== test.description
    )
      throw new Error('Variant registration discarded diagnostic metadata')
  }
  const results = await runDiagnosticsTests(selected)
  if (
    results.length !== 2 ||
    results[0]?.ok !== false ||
    results[1]?.ok !== true ||
    calls.join('|') !== 'setup|dae|setup|solve'
  )
    throw new Error('A failing generator prevented independent execution of its sibling')
  return { ok: true }
}

testModelicaMslFirstOrderNativeSimulation.timeoutMs = 120_000

export async function testModelicaDaeExternalSymbolResolutionContract() {
  const wasm = await getDiagnosticsWasm()
  const { rendered } = compileDiagnosticJavaScript(
    wasm,
    MODELICA_BOOLEAN_NETWORK_SHIM_SOURCE,
    'BooleanNetworkShimSmoke',
    'dae',
  )
  if (!rendered.includes('__rumocaResolveExternalSymbol')) {
    throw new Error('Generated JS is missing external symbol resolver helper')
  }
  if (rendered.includes('__RUMOCA_SYMBOL_OVERRIDES__')) {
    throw new Error('Generated JS still contains hardcoded symbol overrides')
  }

  return { ok: true }
}

export async function testModelicaGeneratedStaticModelExecutionMode(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  const wasm = await getDiagnosticsWasm()
  const { rendered } = compileDiagnosticJavaScript(
    wasm,
    'model StaticOnly parameter Real p=2; constant Real c=3; end StaticOnly;',
    'StaticOnly',
    generator,
  )
  return runStaticModelExecutionModeRegression(rendered)
}
testModelicaGeneratedStaticModelExecutionMode.modelicaGenerators = ['dae', 'solve'] as const

const MODELICA_FUNCTION_CALL_MATRIX_SOURCE = `
package FunctionCallMatrix
  function andTrue
    input Boolean b[:];
    output Boolean result;
  algorithm
    result := true;
    for i in 1:size(b, 1) loop
      if not b[i] then
        result := false;
        return;
      end if;
    end for;
  end andTrue;

  function firstIndex
    input Boolean b[4];
    output Integer index;
  algorithm
    index := 0;
    for i in 1:4 loop
      if b[i] then
        index := i;
        return;
      end if;
    end for;
    index := -1;
  end firstIndex;

  function nestedFirst
    input Boolean b[2,2];
    output Integer index;
  algorithm
    index := 0;
    for i in 1:2 loop
      for j in 1:2 loop
        if b[i,j] then
          index := 10*i + j;
          return;
        end if;
      end for;
    end for;
    index := -1;
  end nestedFirst;

  function norm2
    input Real x[2];
    output Real y;
  protected
    Real s;
  algorithm
    s := 0;
    for i in 1:2 loop
      s := s + x[i]*x[i];
    end for;
    y := sqrt(s);
  end norm2;

  function clamp
    input Real x;
    input Real lo;
    input Real hi;
    output Real y;
  algorithm
    y := if x < lo then lo else if x > hi then hi else x;
  end clamp;

  function combined
    input Real a;
    input Real b;
    output Real y;
  algorithm
    y := clamp(norm2({a, b}), 1, 2);
  end combined;

  model Probe
    input Real u[4] = {0, 0, 0, 0};
    Integer firstMatch;
    Integer noMatch;
    Integer nestedMatch;
    Integer nestedNoMatch;
    Boolean allTrue;
    Boolean anyFalse;
    Real combinedNorm;
  equation
    firstMatch = firstIndex({u[1] > 0, u[2] > 0, u[3] > 0, u[4] > 0});
    noMatch = firstIndex({u[1] < 0, u[2] < 0, u[3] < 0, u[4] < 0});
    nestedMatch = nestedFirst({{u[1] > 0, u[2] > 0}, {u[3] > 0, u[4] > 0}});
    nestedNoMatch = nestedFirst({{u[1] < 0, u[2] < 0}, {u[3] < 0, u[4] < 0}});
    allTrue = andTrue({u[1] > 0, u[2] > 0, u[3] > 0, u[4] > 0});
    anyFalse = andTrue({u[1] > 0, false, u[3] > 0});
    combinedNorm = combined(u[1], u[2]);
  end Probe;
end FunctionCallMatrix;
`.trim()

export async function testModelicaFunctionCallMatrixRegression(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  const wasm = await getDiagnosticsWasm()
  const { rendered } = compileDiagnosticJavaScript(
    wasm,
    MODELICA_FUNCTION_CALL_MATRIX_SOURCE,
    'FunctionCallMatrix.Probe',
    generator,
  )
  return executeModelicaDiagnosticInSandbox({
    id: `modelica-function-call-matrix-${generator}`,
    code: `() => {
      ${rendered}
      ${defaultSolverSource}
      const cases = [
        [1, 2, 3, 4],
        [-1, 2, 3, 4],
        [-1, -1, 3, 4],
        [-1, -1, -1, -1],
        [-3, 4, 0, 0],
        [2, 3, -1, 0],
      ];
      const run = simulateModel(
        {
          sim: {
            t0: 0,
            tf: 0.5,
            dt: 0.1,
            f_u: (t) => cases[Math.min(cases.length - 1, Math.round(t / 0.1))],
            solverOptions: { timeIntegrator: 'sdirk2', newtonTol: 1e-8 },
          },
        },
        {},
        Model(),
      );
      if (run.meta.stopReason) {
        throw new Error(
          'Function-call matrix stopped: ' + String(run.meta.stopReason) + ' / ' + String(run.meta.stopError || ''),
        );
      }
      const expectedFor = (u) => {
        let first = -1;
        for (let i = 0; i < 4; i++) if (u[i] > 0) { first = i + 1; break; }
        let firstNegative = -1;
        for (let i = 0; i < 4; i++) if (u[i] < 0) { firstNegative = i + 1; break; }
        let nested = -1;
        for (let i = 0; i < 2 && nested < 0; i++)
          for (let j = 0; j < 2; j++) if (u[i * 2 + j] > 0) { nested = 10 * (i + 1) + (j + 1); break; }
        let nestedNegative = -1;
        for (let i = 0; i < 2 && nestedNegative < 0; i++)
          for (let j = 0; j < 2; j++) if (u[i * 2 + j] < 0) { nestedNegative = 10 * (i + 1) + (j + 1); break; }
        const norm = Math.sqrt(u[0] * u[0] + u[1] * u[1]);
        return {
          firstMatch: first,
          noMatch: firstNegative,
          nestedMatch: nested,
          nestedNoMatch: nestedNegative,
          allTrue: u.every((value) => value > 0),
          anyFalse: false,
          combinedNorm: Math.max(1, Math.min(2, norm)),
        };
      };
      for (let i = 0; i < run.data.t.length; i++) {
        const u = cases[Math.min(cases.length - 1, Math.round(run.data.t[i] / 0.1))];
        const expected = expectedFor(u);
        const observed = {
          firstMatch: run.data.y.firstMatch[i],
          noMatch: run.data.y.noMatch[i],
          nestedMatch: run.data.y.nestedMatch[i],
          nestedNoMatch: run.data.y.nestedNoMatch[i],
          allTrue: Boolean(run.data.y.allTrue[i]),
          anyFalse: Boolean(run.data.y.anyFalse[i]),
        };
        for (const key of Object.keys(observed)) {
          if (observed[key] !== expected[key]) {
            throw new Error(
              'Function-call matrix mismatch at t=' + run.data.t[i] + ' for ' + key +
                ': got ' + String(observed[key]) + ', expected ' + String(expected[key]),
            );
          }
        }
        if (Math.abs(run.data.y.combinedNorm[i] - expected.combinedNorm) > 1e-4) {
          throw new Error(
            'Function-call matrix combinedNorm mismatch at t=' + run.data.t[i] +
              ': got ' + String(run.data.y.combinedNorm[i]) + ', expected ' + String(expected.combinedNorm),
          );
        }
      }
      return { ok: true, samples: run.data.t.length, executionMode: run.meta.executionMode };
    }`,
    stopSignal: AbortSignal.timeout(20000),
    maxExecutionMs: 20000,
  })
}
testModelicaFunctionCallMatrixRegression.modelicaGenerators = ['dae', 'solve'] as const

export async function testModelicaNativeTableInterpolationRegression(
  _context?: DiagnosticsTestContext,
  generator: ModelicaGenerator = 'dae',
) {
  const wasm = await getDiagnosticsWasm()
  await ensureDiagnosticsMslLoaded(wasm, {})
  const source = `
model NativeTableInterpolation
  Modelica.Blocks.Tables.CombiTable1Ds linear(
    table=[0,10,100; 1,12,104; 2,14,108], columns={3,2});
  Modelica.Blocks.Tables.CombiTable1Ds periodic(
    table=[0,20; 1,30; 2,40],
    smoothness=Modelica.Blocks.Types.Smoothness.ConstantSegments,
    extrapolation=Modelica.Blocks.Types.Extrapolation.Periodic);
  Real selected;
  Real second;
  Real held;
equation
  linear.u = time;
  periodic.u = time;
  selected = linear.y[1];
  second = linear.y[2];
  held = periodic.y[1];
end NativeTableInterpolation;
`
  const { rendered } = compileDiagnosticJavaScript(
    wasm,
    source,
    'NativeTableInterpolation',
    generator,
  )
  return executeModelicaDiagnosticInSandbox({
    id: `modelica-native-table-interpolation-${generator}`,
    code: `() => {
      ${rendered}
      ${defaultSolverSource}
      const run = simulateModel({sim:{t0:0,tf:3.5,dt:0.25,
        solverOptions:{timeIntegrator:'sdirk2',newtonTol:1e-8}}}, {}, Model());
      if(run.meta.stopReason) throw new Error(String(run.meta.stopError || run.meta.stopReason));
      for(let i=0;i<run.data.t.length;i++) {
        const t=run.data.t[i];
        // Avoid knot instants: event-side values have a separate contract.
        if(Math.abs(t-Math.round(t))<1e-8) continue;
        const expected={selected:100+4*t,second:10+2*t,held:t%2<1?20:30};
        for(const [name,value] of Object.entries(expected))
          if(Math.abs(run.data.y[name][i]-value)>1e-5)
            throw new Error(name+' at '+t+': '+run.data.y[name][i]+' != '+value);
      }
      return {ok:true,samples:run.data.t.length};
    }`,
    stopSignal: AbortSignal.timeout(20000),
    maxExecutionMs: 20000,
  })
}
testModelicaNativeTableInterpolationRegression.modelicaGenerators = ['dae', 'solve'] as const
testModelicaNativeTableInterpolationRegression.setup =
  testModelicaBooleanNetwork1RuntimeRegression.setup
testModelicaNativeTableInterpolationRegression.timeoutMs =
  testModelicaBooleanNetwork1RuntimeRegression.timeoutMs

export async function testModelicaExecutionModeCapabilityClassification() {
  const expectedModes: Record<string, string> = {
    'explicit-constant-only': 'static_model',
    'explicit-algebraic-eliminated': 'algebraic_discrete',
    'explicit-event-only': 'algebraic_discrete',
    'dynamic-state': 'dynamic_dae',
    'legacy-callback-only': 'algebraic_discrete',
  }
  const result = await executeModelicaDiagnosticInSandbox<{
    modes: Record<string, string>
    staticSeries: { sampleCount: number; p: unknown[]; c: unknown[] } | null
  }>({
    id: 'modelica-execution-mode-capability-classification',
    code: `() => {
      ${defaultSolverSource}
      const fixtures = [
        {
          name: 'explicit-constant-only',
          make: () => ({
            name: 'ExplicitConstantOnly',
            capabilities: { events: false, algebraics: false },
            meta: {
              name: 'ExplicitConstantOnly',
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
            evalAlgebraics: () => [],
          }),
        },
        {
          name: 'explicit-algebraic-eliminated',
          make: () => ({
            name: 'ExplicitAlgebraicEliminated',
            capabilities: { events: false, algebraics: true },
            meta: {
              name: 'ExplicitAlgebraicEliminated',
              parameters: [],
              constants: [],
              states: [],
              algebraics: [{ name: 'a', start: 0 }],
              inputs: [],
              conditions: [],
              solverAlgebraics: [],
              summary: { nx: 0, ny: 1, nc: 0, neqs: 0 },
            },
            x0: [],
            y0: [0],
            c0: [],
            evalAlgebraics: () => [3],
          }),
        },
        {
          name: 'explicit-event-only',
          make: () => ({
            name: 'ExplicitEventOnly',
            capabilities: { events: true, algebraics: false },
            meta: {
              name: 'ExplicitEventOnly',
              parameters: [],
              constants: [],
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
            evalConditions: () => [],
            applyResets: (t, x, y, u, p, cPrev, cCurr) => ({ x, y, c: cCurr }),
          }),
        },
        {
          name: 'dynamic-state',
          make: () => ({
            name: 'DynamicState',
            capabilities: { events: false, algebraics: false },
            meta: {
              name: 'DynamicState',
              parameters: [],
              constants: [],
              states: [{ name: 'x', start: 0 }],
              algebraics: [],
              inputs: [],
              conditions: [],
              solverAlgebraics: [],
              summary: { nx: 1, ny: 0, nc: 0, neqs: 1 },
            },
            x0: [0],
            y0: [],
            c0: [],
            residual: (t, X, XDot) => [XDot[0] - 1],
          }),
        },
        {
          name: 'legacy-callback-only',
          make: () => ({
            name: 'LegacyCallbackOnly',
            meta: {
              name: 'LegacyCallbackOnly',
              parameters: [],
              constants: [],
              states: [],
              algebraics: [{ name: 'a', start: 0 }],
              inputs: [],
              conditions: [],
              solverAlgebraics: [],
              summary: { nx: 0, ny: 1, nc: 0, neqs: 0 },
            },
            x0: [],
            y0: [0],
            c0: [],
            evalAlgebraics: () => [1],
          }),
        },
      ];
      const modes = {};
      let staticSeries = null;
      for (const fixture of fixtures) {
        const run = simulateModel(
          { sim: { t0: 0, tf: 1, dt: 0.25, solverOptions: { timeIntegrator: 'rk4' } } },
          {},
          fixture.make(),
        );
        if (run.meta.stopReason) {
          throw new Error(
            'Execution-mode fixture ' + fixture.name + ' stopped: ' + String(run.meta.stopReason),
          );
        }
        modes[fixture.name] = run.meta.executionMode;
        if (fixture.name === 'explicit-constant-only') {
          staticSeries = {
            sampleCount: run.data.t.length,
            p: run.data.p.p,
            c: run.data.constants.c,
          };
        }
      }
      return { modes, staticSeries };
    }`,
    stopSignal: AbortSignal.timeout(10000),
    maxExecutionMs: 10000,
  })
  for (const [name, expected] of Object.entries(expectedModes)) {
    if (result.modes[name] !== expected)
      throw new Error(
        `Execution-mode fixture ${name} reported ${String(result.modes[name])}, expected ${expected}`,
      )
  }
  const series = result.staticSeries
  if (
    !series ||
    series.sampleCount !== 5 ||
    !Array.isArray(series.p) ||
    !Array.isArray(series.c) ||
    series.p.some((value) => value !== 2) ||
    series.c.some((value) => value !== 3)
  ) {
    throw new Error('Execution-mode static fixture lost its five-sample p=2/c=3 series')
  }
  return { ok: true, modes: result.modes }
}

export async function testModelicaTaskyonMetadataContract() {
  const wasm = await getDiagnosticsWasm()
  const source =
    'model MetadataProbe Real x(unit="V") annotation(Placement(transformation(origin={1,2}))); annotation(__FutureTool(data={1,2}), Documentation(info="hello")); end MetadataProbe;'
  const result = decodeClassMetadata(wasm.taskyon_source_metadata(source, 'MetadataProbe.mo'))
  const probe = result.classes.MetadataProbe
  if (!probe || probe.components.x?.type_name !== 'Real')
    throw new Error('Missing declaration metadata')
  const text = JSON.stringify(probe)
  if (!text.includes('__FutureTool') || !text.includes('Placement') || text.includes('span')) {
    throw new Error('Metadata must preserve unknown annotations without exposing AST internals')
  }
  let rejected = false
  try {
    decodeClassMetadata('{"schema_version":999}')
  } catch {
    rejected = true
  }
  if (!rejected) throw new Error('Unknown metadata versions must be rejected')
  return { ok: true, schemaVersion: result.schema_version }
}
