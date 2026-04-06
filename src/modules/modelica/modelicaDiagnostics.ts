import {
  buildIframeCode,
  buildModelAbiValidationIframeCode,
  getPreparedDaeDiagnostics,
  getPreparedDaeStatus,
  loadWasm,
  selectDaeForTemplate,
  shouldValidateModelAbiForRenderedOutput,
  validateModelAbiValidationResultV1,
} from 'src/modules/modelica/modelica'
import baseDaeTemplate from 'src/modules/modelica/base_dae.jinja?raw'
import javascriptTemplate from 'src/modules/modelica/javascript.jinja?raw'
import standaloneHtmlTemplate from 'src/modules/modelica/standalone_html.jinja?raw'
import bouncingBallTemplate from 'src/modules/modelica/bouncing_ball_animation.jinja?raw'
import { serializeObject } from '../../../packages/shared/modules/serializeObject'
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
    name: 'standalone_html.jinja',
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

function extractModelicaRefsFromText(text: string, limit = 80): string[] {
  return Array.from(new Set(text.match(/\bModelica\.[A-Za-z0-9_.]+\b/g) ?? [])).slice(0, limit)
}

async function runTemplateCoverage(source: string, modelName: string) {
  const wasm = await getDiagnosticsWasm()

  if (typeof wasm.compile_to_json !== 'function') {
    throw new Error('Rumoca wasm export missing: compile_to_json')
  }
  if (typeof wasm.render_template !== 'function') {
    throw new Error('Rumoca wasm export missing: render_template')
  }

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
  if (!preparedStatus) {
    throw new Error('Selected DAE is missing __rumoca_prepared_status metadata')
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
  }
  const dae = selectDaeForTemplate(parsed, { usePreparedDae: true })
  if (!dae) {
    throw new Error('compile_to_json returned no DAE payload')
  }

  const status = getPreparedDaeStatus(dae)
  if (status !== 'prepared' && status !== 'fallback_native') {
    throw new Error(`Unexpected __rumoca_prepared_status value: ${String(status)}`)
  }
  const diagnostics = getPreparedDaeDiagnostics(dae)
  const hints = dae.__rumoca_solver_hints
  if (!hints || typeof hints !== 'object' || Array.isArray(hints)) {
    throw new Error('Selected DAE is missing __rumoca_solver_hints object')
  }

  return {
    ok: true,
    preparedStatus: status,
    preparedDiagnostics: diagnostics,
    hasSolverHints: true,
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
  if (typeof wasm.render_template !== 'function') {
    throw new Error('Rumoca wasm export missing: render_template')
  }

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
    return {
      f_x: len('f_x'),
      f_c: len('f_c'),
      relation: len('relation'),
      synthetic_root_conditions: len('synthetic_root_conditions'),
      when_clauses: len('when_clauses'),
      f_z: len('f_z'),
      f_m: len('f_m'),
      prepared_status: getPreparedDaeStatus(asObj),
      prepared_diagnostics: getPreparedDaeDiagnostics(asObj),
    }
  }

  const selectedDaeSummary = summarizeDaeEventShape(dae)
  const nativeDaeSummary = summarizeDaeEventShape(parsed.dae_native ?? parsed.dae)
  const preparedDaeSummary = summarizeDaeEventShape(parsed.dae_prepared)

  const rendered = wasm.render_template(JSON.stringify(dae), javascriptTemplate)
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

  const runCode = buildIframeCode(rendered)
  const runId = 'modelica-bouncing-ball-event-localization'
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
    runResult = await executeCodeInIframeSimple(
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
  if (typeof wasm.render_template !== 'function') {
    throw new Error('Rumoca wasm export missing: render_template')
  }

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

  const rendered = wasm.render_template(JSON.stringify(dae), javascriptTemplate)
  if (!rendered || typeof rendered !== 'string') {
    throw new Error('Rendering javascript.jinja failed for BouncingBall')
  }

  const runCode = buildIframeCode(rendered)
  const runId = 'modelica-bouncing-ball-standard-settings'
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
    runResult = await executeCodeInIframeSimple(
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
  const minH = hSeries.filter(Number.isFinite).reduce((m, v) => Math.min(m, v), Number.POSITIVE_INFINITY)
  const maxH = hSeries.filter(Number.isFinite).reduce((m, v) => Math.max(m, v), Number.NEGATIVE_INFINITY)
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
    stateNames: Array.isArray(runResult?.meta?.model?.stateNames) ? runResult.meta.model.stateNames : [],
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

  const summarizeRenderedPreview = (rendered: string) => {
    const head = rendered.slice(0, 1200)
    const tail = rendered.length > 1200 ? rendered.slice(-1200) : ''
    return {
      length: rendered.length,
      hasLegacyDotSymbols:
        rendered.includes('_dot - (') ||
        rendered.includes('x_dot') ||
        rendered.includes('v_dot'),
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
    const rendered = wasm.render_template(daeJson, c.template)
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

const MSL_LOCAL_ZIP_PATH = '/msl/ModelicaStandardLibrary-4.1.0.zip'
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
  compile_with_source_roots?: (source: string, modelName: string, sourceRootsJson: string) => string
  compile_with_libraries?: (source: string, modelName: string, librariesJson: string) => string
  load_source_roots?: (sourceRootsJson: string) => string
  load_libraries?: (librariesJson: string) => string
  list_classes?: () => string
  wasm_init?: (numThreads: number) => unknown
  lsp_diagnostics?: (source: string) => string
  lsp_completion_with_timing?: (source: string, line: number, character: number) => string
}

let sharedDiagnosticsWasmPromise: Promise<DiagnosticsWasm> | null = null
let sharedDiagnosticsMslLoadPromise: Promise<SharedMslLoadResult> | null = null

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
    collectQualifiedClassNames(node.children as Array<{ qualified_name?: unknown; children?: unknown }>, out)
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
      throw new Error('Rumoca wasm export missing: compile_with_source_roots / compile_with_libraries')
    }
    if (typeof wasm.render_template !== 'function') {
      throw new Error('Rumoca wasm export missing: render_template')
    }

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
      throw new Error('Rumoca wasm export missing: compile_with_source_roots / compile_with_libraries')
    }
    if (typeof wasm.render_template !== 'function') {
      throw new Error('Rumoca wasm export missing: render_template')
    }

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
      throw new Error('Rumoca wasm export missing: compile_with_source_roots / compile_with_libraries')
    }
    if (typeof wasm.render_template !== 'function') {
      throw new Error('Rumoca wasm export missing: render_template')
    }

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
      const baseDaeRendered = wasm.render_template(daeJson, baseDaeTemplate)
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
    const rendered = wasm.render_template(daeJson, javascriptTemplate)
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
  if (typeof wasm.render_template !== 'function') {
    throw new Error('Rumoca wasm export missing: render_template')
  }

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

  const rendered = wasm.render_template(JSON.stringify(dae), javascriptTemplate)
  if (!rendered || typeof rendered !== 'string') {
    throw new Error('Rendering javascript.jinja failed for SatelliteOrbit2D')
  }
  const generatedCodeDebug = summarizeGeneratedCodeForDebug(rendered)

  const runCode = buildIframeCode(rendered)
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
      return await executeCodeInIframeSimple(
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

export async function testModelicaOrbitInvariantsSdirkOnly() {
  return runModelicaOrbitInvariantTest('sdirk-only')
}
