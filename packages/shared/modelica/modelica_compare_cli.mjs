#!/usr/bin/env node

import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import initRumoca from 'rumoca'
import * as rumoca from 'rumoca'
import { strFromU8, unzipSync } from 'fflate'

const require = createRequire(import.meta.url)
const SCRIPT_DIR = dirname(new URL(import.meta.url).pathname)
const PROJECT_ROOT = resolve(SCRIPT_DIR, '../../..')
const TMP_ROOT = join(PROJECT_ROOT, '.tmp')
const OMC_CACHE_DIR = join(TMP_ROOT, 'modelica-omc-cache')
const RUN_CACHE_DIR = join(TMP_ROOT, 'modelica-compare')

function usage() {
  return `
Modelica solver-vs-OMC comparator (Node CLI)

Usage:
  node src/modules/modelica/modelica_compare_cli.mjs run [options]

Required:
  --msl-zip <path>                     MSL zip file for rumoca source roots

Options:
  --model <qualified.name>             Single model (overrides --targets-file)
  --targets-file <path>                JSON model list (array or object.model_names)
  --max-models <n>                     Limit model count
  --mode <full|random-stop>            Evaluation mode (default: full)
  --seed <n>                           Random seed for random-stop (default: current time)
  --stop-threshold-percent <n>         Stop threshold (default: 25)
  --t0 <n>                             Solver t0 (default: 0)
  --tf <n>                             Solver tf (default: 5)
  --dt <n>                             Solver dt (default: 0.01)
  --solver-options-json <json>         Solver options JSON (e.g. '{"timeIntegrator":"irk4"}')
  --solver-file <path>                 JS solver file (default: src/modules/modelica/simulateModel.js)
  --template-file <path>               Jinja template file (default: src/modules/modelica/javascript.jinja)
  --omc-wrapper <path>                 OMC podman wrapper (default: src/modules/modelica/scripts/omc-via-podman.sh)
  --omc-msl-dir <path>                 OMC MSL directory (default: packages/rumoca/target/msl/ModelicaStandardLibrary-4.1.0)
  --json                               Emit final JSON summary
  --help                               Show help
`.trim()
}

function parseArgs(argv) {
  const options = {
    command: '',
    mslZip: '',
    modelName: '',
    targetsFile: '',
    maxModels: 0,
    mode: 'full',
    seed: Date.now(),
    stopThresholdPercent: 25,
    t0: 0,
    tf: 5,
    dt: 0.01,
    solverOptionsJson: '',
    solverFile: join(PROJECT_ROOT, 'src/modules/modelica/simulateModel.js'),
    templateFile: join(PROJECT_ROOT, 'src/modules/modelica/javascript.jinja'),
    omcWrapper: join(PROJECT_ROOT, 'src/modules/modelica/scripts/omc-via-podman.sh'),
    omcMslDir: join(PROJECT_ROOT, 'packages/rumoca/target/msl/ModelicaStandardLibrary-4.1.0'),
    json: false,
    help: false,
  }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? '')
    if (!token.startsWith('--')) {
      positional.push(token)
      continue
    }
    if (token === '--json') {
      options.json = true
      continue
    }
    if (token === '--help') {
      options.help = true
      continue
    }
    const key = token.slice(2)
    const value = String(argv[i + 1] ?? '')
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    i += 1
    if (key === 'msl-zip') options.mslZip = value
    else if (key === 'model') options.modelName = value
    else if (key === 'targets-file') options.targetsFile = value
    else if (key === 'max-models') options.maxModels = Math.max(0, Number.parseInt(value, 10) || 0)
    else if (key === 'mode') options.mode = value
    else if (key === 'seed') options.seed = Number.parseInt(value, 10) || options.seed
    else if (key === 'stop-threshold-percent')
      options.stopThresholdPercent = Number.parseFloat(value) || options.stopThresholdPercent
    else if (key === 't0') options.t0 = Number.parseFloat(value)
    else if (key === 'tf') options.tf = Number.parseFloat(value)
    else if (key === 'dt') options.dt = Number.parseFloat(value)
    else if (key === 'solver-options-json') options.solverOptionsJson = value
    else if (key === 'solver-file') options.solverFile = resolve(value)
    else if (key === 'template-file') options.templateFile = resolve(value)
    else if (key === 'omc-wrapper') options.omcWrapper = resolve(value)
    else if (key === 'omc-msl-dir') options.omcMslDir = resolve(value)
    else throw new Error(`Unknown option: --${key}`)
  }
  options.command = positional[0] ?? ''
  return options
}

function asObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}

function asString(v) {
  return typeof v === 'string' ? v : ''
}

function sanitizeLibraryPath(path) {
  const parts = String(path || '')
    .split('/')
    .filter(Boolean)
  if (parts.length > 1 && /(?:Standard)?Library|^MSL/i.test(parts[0] ?? '')) return parts.slice(1).join('/')
  if (parts.length > 0) parts[0] = parts[0].replace(/[\s-][\d.]+$/, '')
  return parts.join('/')
}

function withLibraryContext(qualifiedName, sourceModelica) {
  const source = String(sourceModelica || '')
  if (!source.trim()) return source
  if (/^\s*within\s+[A-Za-z0-9_.]+\s*;/m.test(source)) return source
  const parts = String(qualifiedName || '')
    .split('.')
    .filter(Boolean)
  if (parts.length < 2) return source
  return `within ${parts.slice(0, -1).join('.')};\n\n${source}`
}

function resolveModelName(qualifiedName) {
  const parts = String(qualifiedName || '')
    .split('.')
    .filter(Boolean)
  return parts[parts.length - 1] ?? 'Model'
}

function parseJson(raw) {
  return JSON.parse(String(raw))
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true })
}

async function fileExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function initRumocaEngine() {
  const wasmPath = require.resolve('rumoca/rumoca_bind_wasm_bg.wasm')
  const wasmBytes = await readFile(wasmPath)
  await initRumoca({ module_or_path: wasmBytes })
  const rayonEnabled = typeof rumoca.wasm_init === 'function' ? Boolean(await rumoca.wasm_init(0)) : false
  return {
    version: typeof rumoca.get_version === 'function' ? asString(rumoca.get_version()) : '',
    gitCommit: typeof rumoca.get_git_commit === 'function' ? asString(rumoca.get_git_commit()) : '',
    buildTimeUtc: typeof rumoca.get_build_time_utc === 'function' ? asString(rumoca.get_build_time_utc()) : '',
    rayonEnabled,
  }
}

async function loadMslZip(mslZipPath) {
  const absolute = resolve(mslZipPath)
  const bytes = new Uint8Array(await readFile(absolute))
  const archive = unzipSync(bytes)
  const libraries = {}
  for (const [rawPath, content] of Object.entries(archive)) {
    const lower = rawPath.toLowerCase()
    if (!lower.endsWith('.mo')) continue
    if (rawPath.includes('Test') || rawPath.includes('Obsolete')) continue
    libraries[sanitizeLibraryPath(rawPath)] = strFromU8(content)
  }
  const resultRaw = rumoca.load_source_roots(JSON.stringify(libraries))
  const loaded = parseJson(resultRaw)
  return {
    mslZip: absolute,
    fileCount: Object.keys(libraries).length,
    parsedCount: Number(loaded?.parsed_count) || 0,
  }
}

function flattenClasses(nodes, out = []) {
  for (const raw of nodes) {
    const node = asObj(raw)
    if (!node) continue
    const qualifiedName = asString(node.qualified_name)
    if (qualifiedName) out.push(qualifiedName)
    const children = Array.isArray(node.children) ? node.children : []
    flattenClasses(children, out)
  }
  return out
}

function isRootStandaloneExampleModel(modelName) {
  if (!modelName.startsWith('Modelica.') || !modelName.includes('.Examples.')) return false
  const parts = modelName.split('.Examples.')
  if (parts.length !== 2) return false
  const suffixParts = parts[1].split('.')
  if (suffixParts.length <= 1) return true
  const helper = new Set(['Utilities', 'BaseClasses', 'Internal', 'Interfaces'])
  return !suffixParts.slice(0, -1).some((seg) => helper.has(seg))
}

async function loadTargetModels({ targetsFile, modelName }) {
  if (String(modelName || '').trim()) return [String(modelName).trim()]
  if (!targetsFile) {
    const listRaw = parseJson(rumoca.list_classes())
    const classes = flattenClasses(Array.isArray(listRaw?.classes) ? listRaw.classes : [])
    return classes.filter((name) => isRootStandaloneExampleModel(name))
  }
  const raw = parseJson(await readFile(resolve(targetsFile), 'utf8'))
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string')
  const modelNames = Array.isArray(raw?.model_names) ? raw.model_names : []
  return modelNames.filter((x) => typeof x === 'string')
}

function mulberry32(seed) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled(list, seed) {
  const rng = mulberry32(seed)
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

function safeName(text) {
  return String(text || '')
    .replaceAll(/[^a-zA-Z0-9_.-]/g, '_')
    .slice(0, 200)
}

function parseCsvRow(line) {
  const out = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur.trim())
  return out
}

function parseOmcCsv(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) throw new Error('empty OMC CSV')
  const headers = parseCsvRow(lines[0])
  const timeIdx = headers.findIndex((h) => /^time$/i.test(h))
  if (timeIdx < 0) throw new Error('OMC CSV has no time column')
  const times = []
  const series = {}
  headers.forEach((h, idx) => {
    if (idx !== timeIdx && h) series[h] = []
  })
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvRow(lines[i])
    const t = Number(cols[timeIdx])
    if (!Number.isFinite(t)) continue
    times.push(t)
    headers.forEach((h, idx) => {
      if (idx === timeIdx || !h) return
      const v = Number(cols[idx])
      series[h].push(Number.isFinite(v) ? v : Number.NaN)
    })
  }
  return { times, series }
}

function normalizeOmcTrace(raw) {
  const obj = asObj(raw)
  if (!obj) return { times: [], series: {} }
  if (Array.isArray(obj.times) && asObj(obj.series)) {
    const times = obj.times.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    const seriesObj = asObj(obj.series) ?? {}
    const series = {}
    for (const [name, values] of Object.entries(seriesObj)) {
      if (!Array.isArray(values)) continue
      series[name] = values.slice(0, times.length).map((v) => Number(v))
    }
    return { times, series }
  }
  if (Array.isArray(obj.times) && Array.isArray(obj.names) && Array.isArray(obj.data)) {
    const times = obj.times.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    const n = times.length
    const names = obj.names
    const data = obj.data
    const series = {}
    const cols = Math.min(names.length, data.length)
    for (let i = 0; i < cols; i += 1) {
      const name = typeof names[i] === 'string' ? names[i] : ''
      if (!name || name === 'time' || name === 't') continue
      const column = Array.isArray(data[i]) ? data[i] : []
      series[name] = column.slice(0, n).map((v) => Number(v))
    }
    return { times, series }
  }
  return { times: [], series: {} }
}

function approxEq(a, b, tol) {
  return Math.abs(a - b) <= tol
}

function validateTraceShape(trace, { modelName, t0, tf, dt, sourcePath }) {
  const times = Array.isArray(trace?.times) ? trace.times : []
  const series = asObj(trace?.series) ?? {}
  const channels = Object.keys(series)
  if (times.length < 2) {
    throw new Error(`OMC trace invalid for ${modelName}: expected >=2 time samples from ${sourcePath}`)
  }
  if (channels.length === 0) {
    throw new Error(`OMC trace invalid for ${modelName}: no channels found in ${sourcePath}`)
  }
  const tol = Math.max(Math.abs(dt) * 3, 1e-6)
  const tFirst = Number(times[0])
  const tLast = Number(times[times.length - 1])
  if (!Number.isFinite(tFirst) || !Number.isFinite(tLast)) {
    throw new Error(`OMC trace invalid for ${modelName}: non-finite time range in ${sourcePath}`)
  }
  if (!approxEq(tFirst, Number(t0), tol) || !approxEq(tLast, Number(tf), tol)) {
    throw new Error(
      `OMC trace range mismatch for ${modelName}: expected [${t0}, ${tf}] got [${tFirst}, ${tLast}] from ${sourcePath}`,
    )
  }
  for (const name of channels) {
    const values = Array.isArray(series[name]) ? series[name] : []
    if (values.length === 0) {
      throw new Error(`OMC trace invalid for ${modelName}: channel ${name} is empty in ${sourcePath}`)
    }
  }
}

function normalizeSolverTrace(runResult) {
  const data = asObj(runResult?.data) ?? {}
  const timesRaw = Array.isArray(data.t) ? data.t : []
  const times = timesRaw.map((v) => Number(v)).filter((v) => Number.isFinite(v))
  const n = times.length
  const series = {}
  const pushRecord = (prefix, rec) => {
    const obj = asObj(rec)
    if (!obj) return
    for (const [name, raw] of Object.entries(obj)) {
      if (!Array.isArray(raw)) continue
      series[`${prefix}.${name}`] = raw.slice(0, n).map((v) => (Number.isFinite(Number(v)) ? Number(v) : Number.NaN))
    }
  }
  pushRecord('x', data.x)
  pushRecord('y', data.y)
  pushRecord('u', data.u)
  pushRecord('z', data.z)
  pushRecord('c', data.c)
  return { times, series }
}

function validateSolverTrace(trace, { modelName }) {
  const times = Array.isArray(trace?.times) ? trace.times : []
  const series = asObj(trace?.series) ?? {}
  const channels = Object.keys(series)
  if (times.length < 2) {
    throw new Error(`Solver trace invalid for ${modelName}: expected >=2 time samples`)
  }
  if (channels.length === 0) {
    throw new Error(`Solver trace invalid for ${modelName}: no channels available`)
  }
}

function interpolate(times, values, t) {
  if (!times.length || !values.length) return Number.NaN
  if (t <= times[0]) return values[0]
  const last = times.length - 1
  if (t >= times[last]) return values[last]
  let hi = 1
  while (hi < times.length && times[hi] < t) hi += 1
  const lo = hi - 1
  const t0 = times[lo]
  const t1 = times[hi]
  const v0 = values[lo]
  const v1 = values[hi]
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 === t0) return v0
  return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)
}

function canonicalName(name) {
  return String(name || '').replace(/^[xyuzc]\./, '')
}

function compareTraces(omc, solver) {
  const omcByCanonical = new Map()
  for (const name of Object.keys(omc.series)) {
    const key = canonicalName(name)
    if (!omcByCanonical.has(key)) omcByCanonical.set(key, name)
  }
  const solverByCanonical = new Map()
  for (const name of Object.keys(solver.series)) {
    const key = canonicalName(name)
    if (!solverByCanonical.has(key)) solverByCanonical.set(key, name)
  }
  const commonCanonical = [...omcByCanonical.keys()].filter((k) => solverByCanonical.has(k))
  if (commonCanonical.length === 0) return null

  const perChannel = []
  for (const key of commonCanonical) {
    const omcName = omcByCanonical.get(key)
    const solverName = solverByCanonical.get(key)
    const oSeries = omc.series[omcName]
    const sSeries = solver.series[solverName]
    let maxDev = 0
    let maxAbs = 0
    let maxAtTime = Number.NaN
    let maxAtOmc = Number.NaN
    let maxAtSolver = Number.NaN
    let samples = 0
    const n = Math.min(omc.times.length, oSeries.length)
    for (let i = 0; i < n; i += 1) {
      const t = omc.times[i]
      const ov = oSeries[i]
      const sv = interpolate(solver.times, sSeries, t)
      if (!Number.isFinite(t) || !Number.isFinite(ov) || !Number.isFinite(sv)) continue
      const d = Math.abs(sv - ov) / Math.max(1, Math.abs(ov))
      const absErr = Math.abs(sv - ov)
      if (d > maxDev) maxDev = d
      if (absErr > maxAbs) {
        maxAbs = absErr
        maxAtTime = t
        maxAtOmc = ov
        maxAtSolver = sv
      }
      samples += 1
    }
    if (samples > 0) {
      perChannel.push({
        name: key,
        maxDeviationPercent: maxDev * 100,
        maxAbsError: maxAbs,
        maxAtTime,
        maxAtOmc,
        maxAtSolver,
        samples,
      })
    }
  }
  if (!perChannel.length) return null
  const maxDeviationPercent = Math.max(...perChannel.map((c) => c.maxDeviationPercent))
  const meanDeviationPercent =
    perChannel.reduce((acc, c) => acc + c.maxDeviationPercent, 0) / perChannel.length
  const badChannels = perChannel.filter((c) => c.maxDeviationPercent > 10).length
  const severeChannels = perChannel.filter((c) => c.maxDeviationPercent > 50).length
  const topChannels = perChannel
    .slice()
    .sort((a, b) => b.maxDeviationPercent - a.maxDeviationPercent)
    .slice(0, 8)
  return {
    maxDeviationPercent,
    meanDeviationPercent,
    badChannels,
    severeChannels,
    comparedChannels: perChannel.length,
    topChannels,
  }
}

function traceDiagnosticHint(omcTrace, solverTrace, comparison) {
  if (!comparison) return ''
  const tops = Array.isArray(comparison.topChannels) ? comparison.topChannels : []
  if (tops.length === 0) return ''
  const stuckTop = tops.filter((c) => Math.abs(Number(c.maxAtSolver) || 0) < 1e-12).length
  const severe = tops.filter((c) => Number(c.maxDeviationPercent) >= 99).length
  if (stuckTop >= 4 && severe >= 4) {
    return 'Solver channels appear stuck near zero while OMC channels switch. This often indicates missing discrete/event equation propagation in generated JS (template/runtime), not only integrator tuning.'
  }
  const omcT0 = Number(omcTrace?.times?.[0])
  const solverT0 = Number(solverTrace?.times?.[0])
  if (Number.isFinite(omcT0) && Number.isFinite(solverT0) && Math.abs(omcT0 - solverT0) > 1e-9) {
    return `Trace start-time mismatch: solver starts at ${solverT0}, OMC at ${omcT0}`
  }
  return ''
}

async function runOmcScript(omcWrapper, mosPath, cwd) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(omcWrapper, [mosPath], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      if (code === 0) resolvePromise({ stdout, stderr })
      else rejectPromise(new Error(`OMC wrapper failed with code ${code}: ${stderr || stdout}`))
    })
  })
}

function mslLoadLines(mslDir) {
  return [
    join(mslDir, 'Complex.mo'),
    join(mslDir, 'ModelicaServices/package.mo'),
    join(mslDir, 'Modelica/package.mo'),
    join(mslDir, 'ModelicaTest/package.mo'),
    join(mslDir, 'ModelicaReference/package.mo'),
    join(mslDir, 'ModelicaTestOverdetermined.mo'),
  ].map((p) => `loadFile("${p.replaceAll('\\', '/')}");`)
}

async function loadOrCreateOmcTrace({ modelName, sim, omcWrapper, omcMslDir }) {
  await ensureDir(OMC_CACHE_DIR)
  const key = `${safeName(modelName)}__t0_${sim.t0}__tf_${sim.tf}__dt_${sim.dt}.json`
  const cachePath = join(OMC_CACHE_DIR, key)
  if (await fileExists(cachePath)) {
    const raw = parseJson(await readFile(cachePath, 'utf8'))
    const trace = normalizeOmcTrace(raw)
    try {
      validateTraceShape(trace, { modelName, t0: sim.t0, tf: sim.tf, dt: sim.dt, sourcePath: cachePath })
      return { trace, cachePath, fromCache: true }
    } catch {
      // stale or malformed cache entry; regenerate
    }
  }
  const runDir = join(OMC_CACHE_DIR, `${safeName(modelName)}__run`)
  await ensureDir(runDir)
  const fileNamePrefix = safeName(modelName)
  const csvName = `${fileNamePrefix}_res.csv`
  const mosPath = join(runDir, `run_${Date.now()}.mos`)
  const script = [
    ...mslLoadLines(omcMslDir),
    `simulate(${modelName}, startTime=${sim.t0}, stopTime=${sim.tf}, outputFormat="csv", fileNamePrefix="${fileNamePrefix}");`,
    'getErrorString();',
  ].join('\n')
  await writeFile(mosPath, script, 'utf8')
  await runOmcScript(omcWrapper, mosPath, runDir)
  const csvPath = join(runDir, csvName)
  const csvContent = await readFile(csvPath, 'utf8')
  const trace = normalizeOmcTrace(parseOmcCsv(csvContent))
  validateTraceShape(trace, { modelName, t0: sim.t0, tf: sim.tf, dt: sim.dt, sourcePath: csvPath })
  await writeFile(cachePath, JSON.stringify(trace), 'utf8')
  return { trace, cachePath, fromCache: false }
}

async function runSolverForModel({ modelName, sourceModelica, templateSource, solverSource, sim }) {
  const normalizedSource = withLibraryContext(modelName, sourceModelica)
  const shortName = resolveModelName(modelName)
  const compiledRaw = rumoca.compile_with_source_roots(normalizedSource, shortName, '{}')
  const compiled = parseJson(compiledRaw)
  const dae = asObj(compiled?.dae_prepared)
  if (!dae) {
    const preparedStatus = asString(compiled?.dae_prepared_status)
    const preparedError = asString(compiled?.dae_prepared_error)
    const diagnostics = asObj(compiled?.dae_prepared_diagnostics) ?? {}
    throw new Error(
      `compile returned no prepared DAE for ${modelName}: dae_prepared_status=${preparedStatus || 'n/a'}, dae_prepared_error=${preparedError || 'n/a'}, diagnostics=${JSON.stringify(diagnostics).slice(0, 500)}`,
    )
  }
  const rendered = String(rumoca.render_template(JSON.stringify(dae), templateSource) || '')
  const runFn = new Function(
    'params',
    'context',
    `${rendered}\n${solverSource}\nif (typeof Model !== 'function') throw new Error('Model() missing'); if (typeof simulateModel !== 'function') throw new Error('simulateModel() missing'); return simulateModel(params, context, Model());`,
  )
  const result = runFn(
    { sim: { t0: sim.t0, tf: sim.tf, dt: sim.dt, solverOptions: sim.solverOptions || {} } },
    { log: () => {} },
  )
  const stopReason = asString(result?.meta?.stopReason)
  if (stopReason) {
    const stopError = asString(result?.meta?.stopError)
    const details = asObj(result?.meta?.stopDetails) ?? {}
    const stats = asObj(result?.meta?.solverStats) ?? {}
    throw new Error(
      `solver stopped for ${modelName}: stopReason=${stopReason}, stopError=${stopError || 'n/a'}, stepIndex=${details.stepIndex ?? 'n/a'}, time=${details.time ?? 'n/a'}, flowStepCalls=${stats.flowStepCalls ?? 'n/a'}`,
    )
  }
  return { result, rendered }
}

async function promptChoice(modelName, deviationPercent) {
  const rl = readline.createInterface({ input, output })
  const prompt = `High diff for ${modelName} (max ${deviationPercent.toFixed(3)}%). [c]ontinue, [d]ebug+stop, [s]top: `
  const answer = (await rl.question(prompt)).trim().toLowerCase()
  rl.close()
  if (answer === 'c') return 'continue'
  if (answer === 'd') return 'debug'
  return 'stop'
}

async function writeDebugBundle(payload) {
  const dir = join(RUN_CACHE_DIR, `debug_${Date.now()}_${safeName(payload.modelName)}`)
  await ensureDir(dir)
  await writeFile(join(dir, 'summary.json'), JSON.stringify(payload.summary, null, 2), 'utf8')
  await writeFile(join(dir, 'modelica.mo'), payload.sourceModelica || '', 'utf8')
  await writeFile(join(dir, 'generated_model.js'), payload.renderedJs || '', 'utf8')
  await writeFile(join(dir, 'solver.js'), payload.solverSource || '', 'utf8')
  await writeFile(join(dir, 'solver_trace.json'), JSON.stringify(payload.solverTrace, null, 2), 'utf8')
  await writeFile(join(dir, 'omc_trace.json'), JSON.stringify(payload.omcTrace, null, 2), 'utf8')
  return dir
}

async function saveProgress(path, data) {
  await ensureDir(dirname(path))
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8')
}

function recordSummary(records) {
  const total = records.length
  const compared = records.filter((r) => r.status === 'compared').length
  const compileFailed = records.filter((r) => r.status === 'compile_fail').length
  const runtimeFailed = records.filter((r) => r.status === 'run_fail').length
  const missingChannels = records.filter((r) => r.status === 'missing_channels').length
  const maxDeviationPercent = records.reduce((acc, r) => Math.max(acc, Number(r.maxDeviationPercent) || 0), 0)
  return { total, compared, compileFailed, runtimeFailed, missingChannels, maxDeviationPercent }
}

async function runComparison(options) {
  if (!options.mslZip) throw new Error('Missing required --msl-zip <path>')
  if (options.mode !== 'full' && options.mode !== 'random-stop') {
    throw new Error(`Unsupported --mode ${options.mode}`)
  }
  let solverOptions = {}
  if (String(options.solverOptionsJson || '').trim()) {
    try {
      const parsed = JSON.parse(options.solverOptionsJson)
      solverOptions = asObj(parsed) ?? {}
    } catch (error) {
      throw new Error(
        `Invalid --solver-options-json: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const init = await initRumocaEngine()
  const msl = await loadMslZip(options.mslZip)
  const templateSource = await readFile(resolve(options.templateFile), 'utf8')
  const solverSource = await readFile(resolve(options.solverFile), 'utf8')
  const allTargets = await loadTargetModels({
    targetsFile: options.targetsFile,
    modelName: options.modelName,
  })
  const limited = options.maxModels > 0 ? allTargets.slice(0, options.maxModels) : allTargets
  const targets = options.mode === 'random-stop' ? shuffled(limited, options.seed) : limited
  const progressPath = join(RUN_CACHE_DIR, 'latest_run.json')

  const records = []
  let stoppedAtModel = ''
  let debugPath = ''
  for (let i = 0; i < targets.length; i += 1) {
    const modelName = targets[i]
    const startedAt = Date.now()
    let sourceModelica = ''
    let renderedJs = ''
    let solverTraceSnapshot = null
    let omcTraceSnapshot = null
    process.stdout.write(`[${i + 1}/${targets.length}] ${modelName}\n`)
    try {
      const classInfo = parseJson(rumoca.get_class_info(modelName))
      sourceModelica = asString(classInfo?.source_modelica)
      if (!sourceModelica.trim()) {
        records.push({ modelName, status: 'compile_fail', error: 'missing source_modelica' })
        continue
      }

      const [solverRun, omcRun] = await Promise.all([
        runSolverForModel({
          modelName,
          sourceModelica,
          templateSource,
          solverSource,
          sim: { t0: options.t0, tf: options.tf, dt: options.dt, solverOptions },
        }),
        loadOrCreateOmcTrace({
          modelName,
          sim: { t0: options.t0, tf: options.tf, dt: options.dt },
          omcWrapper: resolve(options.omcWrapper),
          omcMslDir: resolve(options.omcMslDir),
        }),
      ])
      renderedJs = solverRun.rendered
      omcTraceSnapshot = omcRun.trace

      const solverTrace = normalizeSolverTrace(solverRun.result)
      solverTraceSnapshot = solverTrace
      validateSolverTrace(solverTrace, { modelName })
      const comparison = compareTraces(omcRun.trace, solverTrace)
      if (!comparison) {
        records.push({
          modelName,
          status: 'missing_channels',
          elapsedMs: Date.now() - startedAt,
          omcCachePath: omcRun.cachePath,
        })
      } else {
        const hint = traceDiagnosticHint(omcRun.trace, solverTrace, comparison)
        records.push({
          modelName,
          status: 'compared',
          elapsedMs: Date.now() - startedAt,
          omcCachePath: omcRun.cachePath,
          omcFromCache: omcRun.fromCache,
          ...comparison,
          ...(hint ? { diagnosticHint: hint } : {}),
        })
      }

      const record = records[records.length - 1]
      const isBad =
        record.status !== 'compared' ||
        Number(record.maxDeviationPercent) >= Number(options.stopThresholdPercent)
      if (options.mode === 'random-stop' && isBad) {
        const choice = await promptChoice(modelName, Number(record.maxDeviationPercent) || 0)
        if (choice === 'continue') {
          // continue
        } else if (choice === 'debug') {
          debugPath = await writeDebugBundle({
            modelName,
            sourceModelica,
            renderedJs: solverRun.rendered,
            solverSource,
            solverTrace,
            omcTrace: omcRun.trace,
            summary: { record, thresholdPercent: options.stopThresholdPercent },
          })
          stoppedAtModel = modelName
          break
        } else {
          stoppedAtModel = modelName
          break
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      let failureDebugPath = ''
      try {
        failureDebugPath = await writeDebugBundle({
          modelName,
          sourceModelica,
          renderedJs,
          solverSource,
          solverTrace: solverTraceSnapshot,
          omcTrace: omcTraceSnapshot,
          summary: {
            status: 'run_fail',
            error: message,
            stack: stack || null,
            thresholdPercent: options.stopThresholdPercent,
          },
        })
      } catch {
        failureDebugPath = ''
      }
      records.push({
        modelName,
        status: 'run_fail',
        elapsedMs: Date.now() - startedAt,
        error: message,
        ...(stack ? { stack } : {}),
        ...(failureDebugPath ? { debugPath: failureDebugPath } : {}),
      })
      if (options.mode === 'random-stop') {
        stoppedAtModel = modelName
        break
      }
    } finally {
      await saveProgress(progressPath, {
        startedAt: records[0]?.startedAt || null,
        updatedAt: new Date().toISOString(),
        init,
        msl,
        options,
        summary: recordSummary(records),
        records,
      })
    }
  }

  const summary = {
    init,
    msl,
    mode: options.mode,
    seed: options.seed,
    thresholdPercent: options.stopThresholdPercent,
    stoppedAtModel: stoppedAtModel || null,
    debugPath: debugPath || null,
    summary: recordSummary(records),
    records,
    progressPath,
    omcCacheDir: OMC_CACHE_DIR,
  }
  await saveProgress(progressPath, summary)
  return summary
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help || !options.command) {
    console.log(usage())
    process.exit(0)
  }
  if (options.command !== 'run') {
    console.error(`Unsupported command: ${options.command}\n`)
    console.log(usage())
    process.exit(1)
  }
  if (!(await fileExists(resolve(options.omcWrapper)))) {
    throw new Error(`OMC wrapper not found: ${options.omcWrapper}`)
  }
  if (!(await fileExists(resolve(options.omcMslDir)))) {
    throw new Error(`OMC MSL dir not found: ${options.omcMslDir}`)
  }
  const summary = await runComparison(options)
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(`Compared models: ${summary.summary.compared}/${summary.summary.total}`)
    console.log(`Max deviation: ${summary.summary.maxDeviationPercent.toFixed(3)}%`)
    console.log(`Progress file: ${summary.progressPath}`)
    console.log(`OMC cache dir: ${summary.omcCacheDir}`)
    if (summary.debugPath) console.log(`Debug bundle: ${summary.debugPath}`)
  }
}

main().catch((error) => {
  console.error(`[modelica_compare_cli] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
