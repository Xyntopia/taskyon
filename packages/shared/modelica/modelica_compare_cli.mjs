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
const DEFAULT_TARGETS_FILE = join(
  PROJECT_ROOT,
  'packages/rumoca/crates/rumoca-test-msl/tests/msl_tests/msl_simulation_targets_180.json',
)

function usage() {
  return `
Modelica solver-vs-OMC comparator (Node CLI)

Usage:
  node packages/shared/modelica/modelica_compare_cli.mjs run [options]

Options:
  --msl-zip <path>                     MSL zip file (default: packages/rumoca/target/msl/ModelicaStandardLibrary-4.1.0.zip)
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
  --solver-file <path>                 JS solver file (default: packages/shared/modelica/simulateModel.js)
  --template-file <path>               Jinja template file (default: packages/shared/modelica/javascript.jinja)
  --omc-wrapper <path>                 OMC podman wrapper (default: packages/shared/modelica/scripts/omc-via-podman.sh)
  --omc-msl-dir <path>                 OMC MSL directory (default: packages/rumoca/target/msl/ModelicaStandardLibrary-4.1.0)
  --json                               Emit final JSON summary
  --debug-bundle                       Write debug bundle(s); auto-enabled for single-model runs
  --event-debug-vars <csv>             Comma-separated variable names to trace in solver event log
  --help                               Show help
`.trim()
}

function parseArgs(argv) {
  const options = {
    command: '',
    mslZip: join(PROJECT_ROOT, 'packages/rumoca/target/msl/ModelicaStandardLibrary-4.1.0.zip'),
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
    solverFile: join(PROJECT_ROOT, 'packages/shared/modelica/simulateModel.js'),
    templateFile: join(PROJECT_ROOT, 'packages/shared/modelica/javascript.jinja'),
    omcWrapper: join(PROJECT_ROOT, 'packages/shared/modelica/scripts/omc-via-podman.sh'),
    omcMslDir: join(PROJECT_ROOT, 'packages/rumoca/target/msl/ModelicaStandardLibrary-4.1.0'),
    json: false,
    debugBundle: false,
    eventDebugVarsCsv: '',
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
    if (token === '--debug-bundle') {
      options.debugBundle = true
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
    else if (key === 'event-debug-vars') options.eventDebugVarsCsv = value
    else throw new Error(`Unknown option: --${key}`)
  }
  options.command = positional[0] ?? ''
  return options
}

function asObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : null
}

function selectDaeForTemplate(compiled, usePreparedDae = true) {
  if (usePreparedDae) {
    const prepared = asObj(compiled?.dae_prepared)
    if (prepared) return prepared
  }
  const dae = asObj(compiled?.dae)
  if (dae) return dae
  return null
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
    if (await fileExists(DEFAULT_TARGETS_FILE)) {
      const raw = parseJson(await readFile(DEFAULT_TARGETS_FILE, 'utf8'))
      const modelNames = Array.isArray(raw?.model_names) ? raw.model_names : []
      const fromCurated = modelNames.filter((x) => typeof x === 'string')
      if (fromCurated.length > 0) return fromCurated
    }
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
    let omcMin = Number.POSITIVE_INFINITY
    let omcMax = Number.NEGATIVE_INFINITY
    let solverMin = Number.POSITIVE_INFINITY
    let solverMax = Number.NEGATIVE_INFINITY
    let samples = 0
    const n = Math.min(omc.times.length, oSeries.length)
    for (let i = 0; i < n; i += 1) {
      const t = omc.times[i]
      const ov = oSeries[i]
      const sv = interpolate(solver.times, sSeries, t)
      if (!Number.isFinite(t) || !Number.isFinite(ov) || !Number.isFinite(sv)) continue
      const d = Math.abs(sv - ov) / Math.max(1, Math.abs(ov))
      const absErr = Math.abs(sv - ov)
      if (ov < omcMin) omcMin = ov
      if (ov > omcMax) omcMax = ov
      if (sv < solverMin) solverMin = sv
      if (sv > solverMax) solverMax = sv
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
        omcMin,
        omcMax,
        solverMin,
        solverMax,
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
  const mismatchedChannels = perChannel
    .filter((c) => Number(c.maxDeviationPercent) > 10)
    .slice()
    .sort((a, b) => b.maxDeviationPercent - a.maxDeviationPercent)
    .map((c) => ({
      name: c.name,
      maxDeviationPercent: c.maxDeviationPercent,
      maxAbsError: c.maxAbsError,
      maxAtTime: c.maxAtTime,
      maxAtOmc: c.maxAtOmc,
      maxAtSolver: c.maxAtSolver,
      omcMin: c.omcMin,
      omcMax: c.omcMax,
      solverMin: c.solverMin,
      solverMax: c.solverMax,
      samples: c.samples,
    }))
  const binaryScaleSuspects = perChannel
    .filter((c) => c.samples > 0)
    .filter(
      (c) =>
        Number.isFinite(c.omcMin) &&
        Number.isFinite(c.omcMax) &&
        Number.isFinite(c.solverMin) &&
        Number.isFinite(c.solverMax) &&
        c.omcMin >= -1e-9 &&
        c.omcMax <= 1 + 1e-9 &&
        c.solverMin >= -1e-9 &&
        c.solverMax <= 4 + 1e-9 &&
        c.solverMax > 1.5,
    )
    .map((c) => c.name)
    .slice(0, 20)
  return {
    maxDeviationPercent,
    meanDeviationPercent,
    badChannels,
    severeChannels,
    comparedChannels: perChannel.length,
    topChannels,
    mismatchedChannels,
    binaryScaleSuspects,
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
    const child = spawn(omcWrapper, [mosPath], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        OMC_PODMAN_WORKSPACE_ROOT: PROJECT_ROOT,
        OMC_PODMAN_CONTAINER_ROOT: '/workspace',
        OMC_PODMAN_WORKDIR: '',
      },
    })
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

async function runSolverForModel({ modelName, sourceModelica, templateSource, solverSource, sim, debug }) {
  const normalizedSource = withLibraryContext(modelName, sourceModelica)
  const shortName = resolveModelName(modelName)
  let compiledRaw = rumoca.compile_with_source_roots(normalizedSource, shortName, '{}')
  let compiled = parseJson(compiledRaw)
  let dae = selectDaeForTemplate(compiled, true)

  if (!dae) {
    const preparedError = asString(compiled?.dae_prepared_error)
    const diagnostics = asObj(compiled?.dae_prepared_diagnostics) ?? {}
    const compileFailureText = `${preparedError}\n${JSON.stringify(diagnostics)}`
    if (/Duplicate class\s+'[^']+'\s+found in\s+'input\.mo'/i.test(compileFailureText)) {
      compiledRaw = rumoca.compile_with_source_roots('', modelName, '{}')
      compiled = parseJson(compiledRaw)
      dae = selectDaeForTemplate(compiled, true)
    }
  }

  if (!dae) {
    const preparedStatus = asString(compiled?.dae_prepared_status)
    const preparedError = asString(compiled?.dae_prepared_error)
    const diagnostics = asObj(compiled?.dae_prepared_diagnostics) ?? {}
    throw new Error(
      `compile returned no usable DAE for ${modelName}: dae_prepared_status=${preparedStatus || 'n/a'}, dae_prepared_error=${preparedError || 'n/a'}, diagnostics=${JSON.stringify(diagnostics).slice(0, 500)}`,
    )
  }
  const rendered = String(rumoca.render_template(JSON.stringify(dae), templateSource) || '')
  let runFn
  try {
    runFn = new Function(
      'params',
      'context',
      `${rendered}\n${solverSource}\nif (typeof Model !== 'function') throw new Error('Model() missing'); if (typeof simulateModel !== 'function') throw new Error('simulateModel() missing'); const __model = Model(); if (__model && typeof __model.configureDebug === 'function') { __model.configureDebug({ enabled: !!context.enableEventDebug, vars: Array.isArray(context.debugVars) ? context.debugVars : [], maxEvents: context.maxDebugEvents }); } const __result = simulateModel(params, context, __model); if (__result && __model && typeof __model.getDebugEvents === 'function') { __result.__debugEvents = __model.getDebugEvents(); } return __result;`,
    )
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    let dumpPath = ''
    try {
      dumpPath = join(RUN_CACHE_DIR, `failed_render_${safeName(modelName)}_${Date.now()}.js`)
      await ensureDir(dirname(dumpPath))
      await writeFile(dumpPath, rendered, 'utf8')
    } catch {
      dumpPath = ''
    }
    const head = String(rendered || '')
      .split('\n')
      .slice(0, 30)
      .join('\n')
    throw new Error(
      `generated JS failed to compile for ${modelName}: ${msg}; rendered_length=${rendered.length}; dump_path=${dumpPath || 'n/a'}; rendered_head=\n${head}`,
    )
  }
  const result = runFn(
    { sim: { t0: sim.t0, tf: sim.tf, dt: sim.dt, solverOptions: sim.solverOptions || {} } },
    {
      log: () => {},
      enableEventDebug: Boolean(debug?.enabled),
      debugVars: Array.isArray(debug?.vars) ? debug.vars : [],
      maxDebugEvents: Number(debug?.maxEvents) || 100000,
    },
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
  return { result, rendered, dae, debugEvents: Array.isArray(result?.__debugEvents) ? result.__debugEvents : [] }
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
  await writeFile(join(dir, 'dae_prepared.json'), JSON.stringify(payload.daePrepared ?? null, null, 2), 'utf8')
  await writeFile(join(dir, 'solver.js'), payload.solverSource || '', 'utf8')
  await writeFile(join(dir, 'solver_trace.json'), JSON.stringify(payload.solverTrace, null, 2), 'utf8')
  await writeFile(join(dir, 'omc_trace.json'), JSON.stringify(payload.omcTrace, null, 2), 'utf8')
  if (Array.isArray(payload.solverEventLog)) {
    await writeFile(join(dir, 'solver_event_log.json'), JSON.stringify(payload.solverEventLog, null, 2), 'utf8')
  }
  if (payload.comparison) {
    await writeFile(join(dir, 'comparison.json'), JSON.stringify(payload.comparison, null, 2), 'utf8')
    const mismatches = Array.isArray(payload.comparison.mismatchedChannels)
      ? payload.comparison.mismatchedChannels
      : []
    const lines = [
      'Mismatch Report',
      `Model: ${String(payload.modelName || '')}`,
      `Mismatch threshold: >10% max deviation`,
      `Total mismatched channels: ${mismatches.length}`,
      '',
      'name | maxDev% | maxAbsErr | t@maxAbsErr | omc@maxAbsErr | solver@maxAbsErr | omc[min,max] | solver[min,max] | samples',
      ...mismatches.map(
        (m) =>
          `${m.name} | ${Number(m.maxDeviationPercent || 0).toFixed(6)} | ${Number(m.maxAbsError || 0).toFixed(6)} | ${Number(m.maxAtTime || 0).toFixed(6)} | ${Number(m.maxAtOmc || 0).toFixed(6)} | ${Number(m.maxAtSolver || 0).toFixed(6)} | [${Number(m.omcMin || 0).toFixed(6)}, ${Number(m.omcMax || 0).toFixed(6)}] | [${Number(m.solverMin || 0).toFixed(6)}, ${Number(m.solverMax || 0).toFixed(6)}] | ${Number(m.samples || 0)}`,
      ),
    ]
    await writeFile(join(dir, 'mismatch_report.txt'), `${lines.join('\n')}\n`, 'utf8')
  }
  if (String(payload.renderedJs || '').trim()) {
    const guardLines = String(payload.renderedJs)
      .split('\n')
      .map((line, idx) => ({ line: idx + 1, text: line }))
      .filter((entry) => /\(\s*0\s*\)\s*\?/.test(entry.text))
    const guardReport = [
      'Collapsed Guard Report',
      `Model: ${String(payload.modelName || '')}`,
      `Total collapsed guards: ${guardLines.length}`,
      '',
      ...guardLines.map((entry) => `${entry.line}: ${entry.text.trim()}`),
    ].join('\n')
    await writeFile(join(dir, 'collapsed_guards.txt'), `${guardReport}\n`, 'utf8')
  }
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

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0
  const idx = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((p / 100) * sortedValues.length)))
  return Number(sortedValues[idx]) || 0
}

function formatCompareReport(summary) {
  const records = Array.isArray(summary?.records) ? summary.records : []
  const compared = records.filter((r) => r.status === 'compared')
  const runFails = records.filter((r) => r.status === 'run_fail')
  const compileFails = records.filter((r) => r.status === 'compile_fail')
  const missingChannels = records.filter((r) => r.status === 'missing_channels')
  const elapsed = records.map((r) => Number(r.elapsedMs) || 0).filter((v) => v > 0)
  const deviations = compared
    .map((r) => Number(r.maxDeviationPercent) || 0)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b)

  const avgDeviation = deviations.length
    ? deviations.reduce((acc, value) => acc + value, 0) / deviations.length
    : 0
  const avgElapsedMs = elapsed.length ? elapsed.reduce((acc, value) => acc + value, 0) / elapsed.length : 0
  const topOutliers = compared
    .slice()
    .sort((a, b) => (Number(b.maxDeviationPercent) || 0) - (Number(a.maxDeviationPercent) || 0))
    .slice(0, 10)

  const lines = [
    'Modelica Compare Report',
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${String(summary.mode || '')}`,
    `Seed: ${String(summary.seed ?? '')}`,
    '',
    'Summary',
    `- Total models: ${summary.summary.total}`,
    `- Compared: ${summary.summary.compared}`,
    `- Compile failed: ${summary.summary.compileFailed}`,
    `- Runtime failed: ${summary.summary.runtimeFailed}`,
    `- Missing channels: ${summary.summary.missingChannels}`,
    `- Max deviation (%): ${Number(summary.summary.maxDeviationPercent || 0).toFixed(6)}`,
    `- Avg deviation (%): ${avgDeviation.toFixed(6)}`,
    `- Median deviation (%): ${percentile(deviations, 50).toFixed(6)}`,
    `- P95 deviation (%): ${percentile(deviations, 95).toFixed(6)}`,
    `- Avg model elapsed (ms): ${avgElapsedMs.toFixed(2)}`,
    '',
    'Top Deviation Outliers',
    ...(topOutliers.length
      ? topOutliers.map(
          (r, idx) =>
            `${idx + 1}. ${String(r.modelName)} | max=${Number(r.maxDeviationPercent || 0).toFixed(6)}% | avg=${Number(r.meanDeviationPercent || 0).toFixed(6)}%`,
        )
      : ['(none)']),
    '',
    'Runtime Failures',
    ...(runFails.length
      ? runFails.map((r, idx) => `${idx + 1}. ${String(r.modelName)} | ${String(r.error || 'unknown error')}`)
      : ['(none)']),
    '',
    'Compile Failures',
    ...(compileFails.length
      ? compileFails.map((r, idx) => `${idx + 1}. ${String(r.modelName)} | ${String(r.error || 'unknown error')}`)
      : ['(none)']),
    '',
    'Missing Channels',
    ...(missingChannels.length ? missingChannels.map((r, idx) => `${idx + 1}. ${String(r.modelName)}`) : ['(none)']),
    '',
    `Progress JSON: ${String(summary.progressPath || '')}`,
    `OMC Cache Dir: ${String(summary.omcCacheDir || '')}`,
  ]
  return `${lines.join('\n')}\n`
}

async function writeCompareReport(summary) {
  const stamp = new Date().toISOString().replaceAll(':', '-')
  const latestPath = join(PROJECT_ROOT, 'modelica_compare_report_latest.txt')
  const timestampedPath = join(PROJECT_ROOT, `modelica_compare_report_${stamp}.txt`)
  const reportText = formatCompareReport(summary)
  await writeFile(latestPath, reportText, 'utf8')
  await writeFile(timestampedPath, reportText, 'utf8')
  return { latestPath, timestampedPath }
}

async function runComparison(options) {
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
  const eventDebugVars = String(options.eventDebugVarsCsv || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
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
      let solverEventLogSnapshot = null
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
          debug: {
            enabled: Boolean(options.debugBundle || options.modelName),
            vars: eventDebugVars,
            maxEvents: 100000,
          },
        }),
        loadOrCreateOmcTrace({
          modelName,
          sim: { t0: options.t0, tf: options.tf, dt: options.dt },
          omcWrapper: resolve(options.omcWrapper),
          omcMslDir: resolve(options.omcMslDir),
        }),
      ])
      renderedJs = solverRun.rendered
      solverEventLogSnapshot = Array.isArray(solverRun.debugEvents) ? solverRun.debugEvents : []
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
        let comparedDebugPath = ''
        if (options.debugBundle || options.modelName) {
          comparedDebugPath = await writeDebugBundle({
            modelName,
            sourceModelica,
            renderedJs: solverRun.rendered,
            daePrepared: solverRun.dae,
            solverSource,
            solverTrace,
            solverEventLog: solverEventLogSnapshot,
            omcTrace: omcRun.trace,
            comparison,
            summary: { comparison, thresholdPercent: options.stopThresholdPercent },
          })
        }
        records.push({
          modelName,
          status: 'compared',
          elapsedMs: Date.now() - startedAt,
          omcCachePath: omcRun.cachePath,
          omcFromCache: omcRun.fromCache,
          ...comparison,
          ...(hint ? { diagnosticHint: hint } : {}),
          ...(comparedDebugPath ? { debugPath: comparedDebugPath } : {}),
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
            daePrepared: solverRun.dae,
            solverSource,
            solverTrace,
            solverEventLog: solverEventLogSnapshot,
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
          solverEventLog: solverEventLogSnapshot,
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
      const status = /^Compilation error:/i.test(message) ? 'compile_fail' : 'run_fail'
      records.push({
        modelName,
        status,
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
  const report = await writeCompareReport(summary)
  if (options.json) {
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log(`Compared models: ${summary.summary.compared}/${summary.summary.total}`)
    console.log(`Max deviation: ${summary.summary.maxDeviationPercent.toFixed(3)}%`)
    console.log(`Progress file: ${summary.progressPath}`)
    console.log(`OMC cache dir: ${summary.omcCacheDir}`)
    console.log(`Report file: ${report.latestPath}`)
    console.log(`Timestamped report: ${report.timestampedPath}`)
    if (summary.debugPath) console.log(`Debug bundle: ${summary.debugPath}`)
  }
}

main().catch((error) => {
  console.error(`[modelica_compare_cli] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
