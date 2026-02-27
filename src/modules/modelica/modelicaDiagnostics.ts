import {
  buildIframeCode,
  buildModelAbiValidationIframeCode,
  loadWasm,
  shouldValidateModelAbiForRenderedOutput,
  validateModelAbiValidationResultV1,
} from 'src/modules/modelica/modelica'
import baseDaeTemplate from 'src/modules/modelica/base_dae.jinja?raw'
import javascriptTemplate from 'src/modules/modelica/javascript.jinja?raw'
import standaloneHtmlTemplate from 'src/modules/modelica/standalon_html.jinja?raw'
import bouncingBallTemplate from 'src/modules/modelica/bouncing_ball_animation.jinja?raw'
import { serializeObject } from 'src/modules/serializeObject'
import { strFromU8, unzipSync } from 'fflate'
import { executeCodeInIframeSimple } from '../../../packages/taskyon/src/utils/iframeWorker'

const templateChecks = [
  {
    name: 'javascript.jinja',
    source: javascriptTemplate,
    requiredSnippets: ['function Model()', 'const meta = {'],
    executableAsJs: true,
  },
  {
    name: 'standalon_html.jinja',
    source: standaloneHtmlTemplate,
    requiredSnippets: ['<html lang="en">', 'function Model()'],
    executableAsJs: false,
  },
  {
    name: 'bouncing_ball_animation.jinja',
    source: bouncingBallTemplate,
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
  maxArrayLength: 25,
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

function extractModelicaRefsFromText(text: string, limit = 80): string[] {
  return Array.from(new Set(text.match(/\bModelica\.[A-Za-z0-9_.]+\b/g) ?? [])).slice(0, limit)
}

async function runTemplateCoverage(source: string, modelName: string) {
  const wasm = await loadWasm()

  if (typeof wasm.compile_to_json !== 'function') {
    throw new Error('Rumoca wasm export missing: compile_to_json')
  }
  if (typeof wasm.render_template !== 'function') {
    throw new Error('Rumoca wasm export missing: render_template')
  }

  const compiled = wasm.compile_to_json(source, modelName)
  const parsed = JSON.parse(compiled) as { dae?: unknown; dae_native?: unknown }
  const dae = parsed.dae_native ?? parsed.dae
  if (!dae) {
    throw new Error('Rumoca compile_to_json returned no DAE payload')
  }

  const rendered = wasm.render_template(
    JSON.stringify(dae),
    '{{ dae.model_name | default("unknown") }}',
  )
  if (typeof rendered !== 'string' || rendered.length === 0) {
    throw new Error('Rumoca render_template returned empty output')
  }

  const templateResults: Record<
    string,
    { ok: boolean; preview: string; jsExecutable: boolean; expectedJs: boolean; abiOk?: boolean }
  > = {}
  for (const check of templateChecks) {
    const out = wasm.render_template(JSON.stringify(dae), check.source)
    if (typeof out !== 'string' || out.length === 0) {
      throw new Error(`Template render failed or empty output: ${check.name}`)
    }
    for (const snippet of check.requiredSnippets) {
      if (!out.includes(snippet)) {
        throw new Error(`Template ${check.name} missing expected snippet: ${snippet}`)
      }
    }
    let jsExecutable = false
    let abiOk: boolean | undefined
    if (check.executableAsJs) {
      const code = buildModelAbiValidationIframeCode(out)
      const id = `modelica-template-abi-check-${check.name.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}`
      const abort = new AbortController()
      try {
        const rawAbiResult = await executeCodeInIframeSimple(
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
            __taskyonRunId: id,
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
    exports: {
      compile_to_json: true,
      render_template: true,
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

export async function testModelicaAbiValidationRoutingRegression() {
  const wasm = await loadWasm()

  const source = `
model Test
  Real x(start=0);
equation
  der(x) = 1;
end Test;
`.trim()

  const compiled = wasm.compile_to_json(source, 'Test')
  const parsed = JSON.parse(compiled) as { dae?: unknown; dae_native?: unknown }
  const dae = parsed.dae_native ?? parsed.dae
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
      name: 'standalon_html.jinja',
      template: standaloneHtmlTemplate,
      shouldValidate: false,
    },
    {
      name: 'bouncing_ball_animation.jinja',
      template: bouncingBallTemplate,
      shouldValidate: false,
    },
    {
      name: 'base_dae.jinja',
      template: baseDaeTemplate,
      shouldValidate: false,
    },
  ] as const

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
    const rendered = wasm.render_template(daeJson, c.template)
    const decision = shouldValidateModelAbiForRenderedOutput(rendered)
    if (decision.shouldValidate !== c.shouldValidate) {
      throw new Error(
        `Guard decision mismatch for ${c.name}: expected ${String(c.shouldValidate)} got ${String(decision.shouldValidate)}`,
      )
    }

    let abiValidationOk: boolean | undefined
    let abiSandboxExecuted = false
    if (decision.shouldValidate) {
      const code = buildModelAbiValidationIframeCode(rendered)
      const id = `modelica-abi-routing-${c.name.replaceAll(/[^a-zA-Z0-9_-]/g, '_')}`
      const abort = new AbortController()
      abiSandboxExecuted = true
      try {
        const rawAbiResult = await executeCodeInIframeSimple(
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
            __taskyonRunId: id,
          },
        )
        const abiResult = validateModelAbiValidationResultV1(rawAbiResult)
        if (abiResult.ok !== true) {
          throw new Error(abiResult.errorMessage || `ABI validation failed for ${c.name}`)
        }
        abiValidationOk = true
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
    results,
  }
}

// Backward-compat alias so existing diagnostics button names still work.
export async function testModelicaForcedAbiValidationFailureModes() {
  return testModelicaAbiValidationRoutingRegression()
}

const MSL_LOCAL_ZIP_PATH = '/msl/ModelicaStandardLibrary-4.1.0.zip'

function buildModelConstructionProbeIframeCode(compiledJs: string): string {
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
  wasm: {
    load_libraries?: (librariesJson: string) => string
  },
  debug: Record<string, unknown>,
) {
  if (typeof wasm.load_libraries !== 'function') {
    throw new Error('Rumoca wasm export missing: load_libraries')
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

  const loadRaw = wasm.load_libraries(JSON.stringify(libraries))
  const loadParsed = JSON.parse(String(loadRaw)) as {
    parsed_count?: number
    skipped_files?: string[]
    conflicts?: string[]
  }
  debug.loadParsed = loadParsed

  return {
    libraryFileCount,
    loadParsed,
  }
}

export async function testModelicaMslCompileAndRunSmoke() {
  const debug: Record<string, unknown> = {
    mslZipPath: MSL_LOCAL_ZIP_PATH,
    phase: 'init',
  }
  let fullGeneratedCode = ''

  try {
    const wasm = await loadWasm()
    debug.phase = 'wasm-loaded'

    if (typeof wasm.compile_with_libraries !== 'function') {
      throw new Error('Rumoca wasm export missing: compile_with_libraries')
    }
    if (typeof wasm.render_template !== 'function') {
      throw new Error('Rumoca wasm export missing: render_template')
    }

    const { libraryFileCount, loadParsed } = await loadLocalMslLibraries(wasm, debug)

    const source = `
model MslConstRamp
  parameter Real gain = Modelica.Constants.pi;
  Real x(start = 0);
equation
  der(x) = gain;
end MslConstRamp;
`.trim()

    const compiledRaw = wasm.compile_with_libraries(source, 'MslConstRamp', '{}')
    debug.phase = 'compiled-with-libraries'
    const compiled = JSON.parse(String(compiledRaw)) as {
      dae?: unknown
      dae_native?: unknown
      pretty?: string
    }
    const dae = compiled.dae_native ?? compiled.dae
    if (!dae) {
      throw new Error('compile_with_libraries returned no DAE payload')
    }

    const rendered = wasm.render_template(JSON.stringify(dae), javascriptTemplate)
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

    const modelProbeCode = buildModelConstructionProbeIframeCode(rendered)
    const modelProbeRunId = 'modelica-msl-smoke-model-probe'
    const modelProbeAbort = new AbortController()
    let modelProbeResult: unknown
    try {
      modelProbeResult = await executeCodeInIframeSimple(
        {
          id: modelProbeRunId,
          code: modelProbeCode,
          sourceURL: 'modelica-msl-smoke-model-probe.js',
          stopSignal: modelProbeAbort.signal,
        },
        {},
        {
          source: 'ModelicaDiagnostics',
          __taskyonRunId: modelProbeRunId,
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

    const abiCode = buildModelAbiValidationIframeCode(rendered)
    const abiRunId = 'modelica-msl-smoke-abi'
    const abiAbort = new AbortController()
    try {
      const rawAbiResult = await executeCodeInIframeSimple(
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
          __taskyonRunId: abiRunId,
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

    const runCode = buildIframeCode(rendered)
    const runId = 'modelica-msl-smoke-run'
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
      runResult = await executeCodeInIframeSimple(
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
          __taskyonRunId: runId,
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
      generatedCode: rendered,
      renderedPreview: rendered.slice(0, 120),
      prettyPreview: String(compiled.pretty ?? '').slice(0, 120),
    }
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    throw new Error([baseMessage, `MSL smoke debug:\n${debugDump}`].join('\n'), {
      cause: {
        generatedCode: fullGeneratedCode || '[generated code unavailable]',
      },
    })
  }
}

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
    const wasm = await loadWasm()
    debug.phase = 'wasm-loaded'

    if (typeof wasm.compile_with_libraries !== 'function') {
      throw new Error('Rumoca wasm export missing: compile_with_libraries')
    }
    if (typeof wasm.render_template !== 'function') {
      throw new Error('Rumoca wasm export missing: render_template')
    }

    const { libraryFileCount, loadParsed } = await loadLocalMslLibraries(wasm, debug)
    debug.mslLibraryFiles = libraryFileCount
    debug.mslParsedCount = Number(loadParsed.parsed_count ?? 0)

    const compileAndSummarize = (source: string, modelName: string) => {
      const compiledRaw = wasm.compile_with_libraries(source, modelName, '{}')
      const compiled = JSON.parse(String(compiledRaw)) as {
        dae?: unknown
        dae_native?: unknown
        pretty?: string
      }
      const dae = compiled.dae_native ?? compiled.dae
      if (!dae) {
        throw new Error(`compile_with_libraries returned no DAE payload for ${modelName}`)
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
        const lhsVarRef = (lhs as Record<string, unknown>).VarRef as Record<string, unknown> | undefined
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
        baseDaeRendered = wasm.render_template(daeJson, baseDaeTemplate)
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
      sources: {
        extendsSource: extendsResistorSource,
        manualSource: manualResistorSource,
      },
      rumoca: {
        extendsSummary,
        manualSummary,
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
          stateEq: manualSummary.baseDae.stateEquationCount - extendsSummary.baseDae.stateEquationCount,
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
    const wasm = await loadWasm()
    debug.phase = 'wasm-loaded'

    if (typeof wasm.compile_with_libraries !== 'function') {
      throw new Error('Rumoca wasm export missing: compile_with_libraries')
    }
    if (typeof wasm.render_template !== 'function') {
      throw new Error('Rumoca wasm export missing: render_template')
    }

    const { libraryFileCount, loadParsed } = await loadLocalMslLibraries(wasm, debug)
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
    const compiledRaw = wasm.compile_with_libraries(source, 'MslResistorExample', '{}')
    debug.phase = 'compiled'
    const compiled = JSON.parse(String(compiledRaw)) as {
      dae?: unknown
      dae_native?: unknown
      pretty?: string
    }
    const dae = compiled.dae_native ?? compiled.dae
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
      const baseDaeRendered = wasm.render_template(daeJson, baseDaeTemplate)
      const derivativeRefsFromTemplate = Array.from(
        new Set(baseDaeRendered.match(/der\([^)]+\)/g) ?? []),
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
    const rendered = wasm.render_template(daeJson, javascriptTemplate)
    if (!rendered || typeof rendered !== 'string') {
      throw new Error('Rendering javascript.jinja failed for MSL resistor example')
    }
    fullGeneratedCode = rendered
    debug.renderedPreview = rendered.slice(0, 220)
    debug.generatedCodeLength = rendered.length

    debug.phase = 'build-iframe-code'
    const runCode = buildIframeCode(rendered)
    const runId = 'modelica-msl-resistor-example-run'
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
      { len: number; min: number | null; max: number | null; first: number[]; last: number[]; maxDelta: number }
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
      runResult = await executeCodeInIframeSimple(
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
          __taskyonRunId: runId,
        },
      )
      debug.runResultPreview = {
        meta: runResult?.meta,
        tLen: Array.isArray(runResult?.data?.t) ? runResult.data.t.length : 0,
        xLen: getSeriesSampleLength(runResult?.data?.x),
        yLen: getSeriesSampleLength(runResult?.data?.y),
      }
      serializedRunResult = serializeObject(runResult, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
      debug.runResultSerialized = serializedRunResult
      debug.runResultSerializedExtended = serializeObject(
        runResult,
        MODELICA_DIAGNOSTICS_EXTENDED_SERIALIZE_OPTIONS,
      )
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
    const stateCount = stateNames.length
    const algebraicCount = algebraicNames.length

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
      throw new Error(
        [
          'MSL resistor example produced zero states; expected at least one dynamic state variable',
          `stateCount=${stateCount}`,
          `algebraicCount=${algebraicCount}`,
          `xLen=${xLen}`,
          `yLen=${yLen}`,
          `xAmp=${xAmp}`,
          `yAmp=${yAmp}`,
          `xTemporal=${xTemporal}`,
          `yTemporal=${yTemporal}`,
          `baseDae.derivativeRefCount=${derivativeRefs.length}`,
          `baseDae.derivativeRefsPreview=${serializeObject(derivativeRefs.slice(0, 20), MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)}`,
        ].join('\n'),
      )
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
        stateSeriesValues: xSeriesByName,
        xAmplitude: xAmp,
        yAmplitude: yAmp,
        serializedResult: serializedRunResult,
      },
      generatedCode: rendered,
      prettyPreview: String(compiled.pretty ?? '').slice(0, 120),
    }
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err)
    const debugDump = serializeObject(debug, MODELICA_DIAGNOSTICS_SERIALIZE_OPTIONS)
    const debugDumpExtended = serializeObject(debug, MODELICA_DIAGNOSTICS_EXTENDED_SERIALIZE_OPTIONS)
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
        `MSL resistor example debug (extended):\n${debugDumpExtended}`,
      ].join('\n'),
      {
        cause: {
          generatedCode: fullGeneratedCode || '[generated code unavailable]',
          debug,
        },
      },
    )
  }
}
