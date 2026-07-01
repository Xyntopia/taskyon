#!/usr/bin/env node

import { readFile, writeFile, mkdir, access, readdir, stat, unlink, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import initRumoca from 'rumoca-full-web'
import * as rumoca from 'rumoca-full-web'
import { strFromU8, unzipSync } from 'fflate'

const SCRIPT_PATH = new URL(import.meta.url).pathname
const SCRIPT_DIR = dirname(SCRIPT_PATH)
const PROJECT_ROOT = resolve(SCRIPT_DIR, '../../..')
const TMP_ROOT = join(PROJECT_ROOT, '.tmp')
const OMC_CACHE_DIR = join(TMP_ROOT, 'modelica-omc-cache')
const RUN_CACHE_DIR = join(TMP_ROOT, 'modelica-compare')
const DEFAULT_TARGETS_FILE = join(
  PROJECT_ROOT,
  'packages/rumoca/crates/rumoca-test-msl/tests/msl_tests/msl_simulation_targets_180.json',
)
const DEFAULT_RANDOM_SEED = 20260507
const DEFAULT_COMPILE_TIMEOUT_MS = 10_000
const DEFAULT_OMC_TIMEOUT_MS = 30_000
const DEFAULT_SOLVER_TIMEOUT_MS = 20_000
const DEFAULT_OMC_MAX_CSV_BYTES = 256 * 1024 * 1024
const COMPARE_ARTIFACT_DIR = join(PROJECT_ROOT, 'packages/shared/modelica/compare')
const PUBLIC_COMPARE_DIR = join(PROJECT_ROOT, 'public/modelica-compare')
const DEFAULT_BASELINE_FILE = join(COMPARE_ARTIFACT_DIR, 'baseline_default.json')
const DEFAULT_RUN_JSON_FILE = join(COMPARE_ARTIFACT_DIR, 'run_latest_default.json')
const DEFAULT_PUBLIC_DIFF_FILE = join(PUBLIC_COMPARE_DIR, 'diff_latest.json')
const BASELINE_SCHEMA_VERSION = 2

function usage() {
  return `
Modelica solver-vs-OMC comparator (Node CLI)

Usage:
  node packages/shared/modelica/modelica_compare_cli.mjs run [options]
  node packages/shared/modelica/modelica_compare_cli.mjs baseline-diff [options]
  node packages/shared/modelica/modelica_compare_cli.mjs baseline-update [options]
  node packages/shared/modelica/modelica_compare_cli.mjs probe-compile --model <qualified.name> [options]
  node packages/shared/modelica/modelica_compare_cli.mjs probe-source --model <qualified.name> --source-file <path> [options]
  node packages/shared/modelica/modelica_compare_cli.mjs probe-solve --model <qualified.name> [options]

Options:
  --msl-zip <path>                     MSL zip file (default: packages/rumoca/target/msl/ModelicaStandardLibrary-4.1.0.zip)
  --library-zip <path|csv>             Additional library zip(s) to load (repeatable or comma-separated)
  --model <qualified.name>             Single model (overrides auto-discovered targets)
  --baseline-file <path>               Baseline JSON path (default: library-specific baseline file)
  --baseline-profile <key>             Override runtime baseline profile for diff/update (e.g. native.auto)
  --candidate-file <path>              Candidate run JSON path (default: library-specific latest run file)
  --diff-file <path>                   Diff JSON output path (default: library-specific diff file)
  --diff-csv-file <path>               Diff CSV output path (default: library-specific diff CSV)
  --public-diff-file <path>            Public analysis JSON path (default: public/modelica-compare/diff_<library>.json)
  --targets-prefix <prefix|csv>        Restrict targets to fully-qualified name prefixes
  --target-class-types <csv>           Restrict targets by class_type (e.g. model,block)
  --max-models <n>                     Limit model count
  --mode <full|random-stop>            Evaluation mode (default: full)
  --seed <n>                           Random seed for random-stop (default: 20260507)
  --stop-threshold-percent <n>         Stop threshold (default: 25)
  --always-continue                    Never stop for prompts/failures in random-stop mode
  --compile-only                       Only validate Rumoca compilation (skip OMC/solver/compare)
  --compile-timeout-ms <n>             Per-model compile timeout in milliseconds (default: 10000)
  --omc-timeout-ms <n>                 Per-model OMC reference timeout in milliseconds (default: 30000)
  --omc-max-csv-bytes <n>              Fail OMC reference traces above this size before parsing (default: 268435456)
  --solver-timeout-ms <n>              Per-model solver timeout in milliseconds (default: 20000)
  --compile-workers <n>                Compile-only: worker process count (default: 1)
  --compile-debug                      Compile-only: include per-plan compile timing/details in logs
  --compile-force-dae                 Compile-only: bypass compile_check fast-path; force full DAE compile plans
  --compile-options-json <json>       Internal: forwarded Rumoca compile behavior options JSON
  --t0 <n>                             Solver t0 (default: 0)
  --tf <n>                             Solver tf (default: 5)
  --dt <n>                             Solver dt (default: 0.01)
  --solver-options-json <json>         Solver options JSON (e.g. '{"timeIntegrator":"irk4"}')
  --rumoca-runtime <template|native>   Rumoca simulation backend (default: template)
  --solver-file <path>                 JS solver file (default: packages/shared/modelica/simulateModel.js)
  --template-file <path>               Jinja template file (default: packages/shared/modelica/javascript.jinja)
  --omc-wrapper <path>                 OMC podman wrapper (default: packages/shared/modelica/scripts/omc-via-podman.sh)
  --omc-msl-dir <path>                 OMC MSL directory (default: packages/rumoca/target/msl/ModelicaStandardLibrary-4.1.0)
  --debug-bundle                       Write debug bundle(s); auto-enabled for single-model runs
  --event-debug-vars <csv>             Comma-separated variable names to trace in solver event log
  --source-file <path>                 Used by probe-source: Modelica source file path
  --help                               Show help
`.trim()
}

function parseArgs(argv) {
  const options = {
    command: '',
    mslZip: join(PROJECT_ROOT, 'packages/rumoca/target/msl/ModelicaStandardLibrary-4.1.0.zip'),
    libraryZips: [],
    modelName: '',
    baselineFile: '',
    baselineProfile: '',
    candidateFile: '',
    diffFile: '',
    diffCsvFile: '',
    publicDiffFile: '',
    targetPrefixesCsv: '',
    targetClassTypesCsv: '',
    maxModels: 0,
    mode: 'full',
    seed: DEFAULT_RANDOM_SEED,
    stopThresholdPercent: 25,
    alwaysContinue: false,
    compileOnly: false,
    compileTimeoutMs: DEFAULT_COMPILE_TIMEOUT_MS,
    omcTimeoutMs: DEFAULT_OMC_TIMEOUT_MS,
    omcMaxCsvBytes: DEFAULT_OMC_MAX_CSV_BYTES,
    solverTimeoutMs: DEFAULT_SOLVER_TIMEOUT_MS,
    compileWorkers: 1,
    compileDebug: false,
    compileForceDae: true,
    compileOptionsJson: '{}',
    t0: 0,
    tf: 5,
    dt: 0.01,
    solverOptionsJson: '',
    rumocaRuntime: 'template',
    probeOutputFile: '',
    solverFile: join(PROJECT_ROOT, 'packages/shared/modelica/simulateModel.js'),
    templateFile: join(PROJECT_ROOT, 'packages/shared/modelica/javascript.jinja'),
    omcWrapper: join(PROJECT_ROOT, 'packages/shared/modelica/scripts/omc-via-podman.sh'),
    omcMslDir: join(PROJECT_ROOT, 'packages/rumoca/target/msl/ModelicaStandardLibrary-4.1.0'),
    debugBundle: false,
    eventDebugVarsCsv: '',
    sourceFile: '',
    help: false,
  }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? '')
    if (token === '--') continue
    if (!token.startsWith('--')) {
      positional.push(token)
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
    if (token === '--always-continue') {
      options.alwaysContinue = true
      continue
    }
    if (token === '--compile-only') {
      options.compileOnly = true
      continue
    }
    if (token === '--compile-debug') {
      options.compileDebug = true
      continue
    }
    if (token === '--compile-force-dae') {
      options.compileForceDae = true
      continue
    }
    const key = token.slice(2)
    const value = String(argv[i + 1] ?? '')
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`)
    i += 1
    if (key === 'msl-zip') options.mslZip = value
    else if (key === 'library-zip') {
      const entries = String(value)
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => resolve(x))
      options.libraryZips.push(...entries)
    } else if (key === 'model') options.modelName = value
    else if (key === 'baseline-file') options.baselineFile = resolve(value)
    else if (key === 'baseline-profile') options.baselineProfile = sanitizeTag(value)
    else if (key === 'candidate-file') options.candidateFile = resolve(value)
    else if (key === 'diff-file') options.diffFile = resolve(value)
    else if (key === 'diff-csv-file') options.diffCsvFile = resolve(value)
    else if (key === 'public-diff-file') options.publicDiffFile = resolve(value)
    else if (key === 'targets-prefix') options.targetPrefixesCsv = value
    else if (key === 'target-class-types') options.targetClassTypesCsv = value
    else if (key === 'max-models') options.maxModels = Math.max(0, Number.parseInt(value, 10) || 0)
    else if (key === 'mode') options.mode = value
    else if (key === 'compile-timeout-ms')
      options.compileTimeoutMs = Math.max(
        1,
        Number.parseInt(value, 10) || DEFAULT_COMPILE_TIMEOUT_MS,
      )
    else if (key === 'omc-timeout-ms')
      options.omcTimeoutMs = Math.max(1, Number.parseInt(value, 10) || DEFAULT_OMC_TIMEOUT_MS)
    else if (key === 'omc-max-csv-bytes')
      options.omcMaxCsvBytes = Math.max(1, Number.parseInt(value, 10) || DEFAULT_OMC_MAX_CSV_BYTES)
    else if (key === 'solver-timeout-ms')
      options.solverTimeoutMs = Math.max(1, Number.parseInt(value, 10) || DEFAULT_SOLVER_TIMEOUT_MS)
    else if (key === 'compile-workers')
      options.compileWorkers = Math.max(1, Number.parseInt(value, 10) || 1)
    else if (key === 'compile-options-json') options.compileOptionsJson = value
    else if (key === 'seed') options.seed = Number.parseInt(value, 10) || options.seed
    else if (key === 'stop-threshold-percent')
      options.stopThresholdPercent = Number.parseFloat(value) || options.stopThresholdPercent
    else if (key === 't0') options.t0 = Number.parseFloat(value)
    else if (key === 'tf') options.tf = Number.parseFloat(value)
    else if (key === 'dt') options.dt = Number.parseFloat(value)
    else if (key === 'solver-options-json') options.solverOptionsJson = value
    else if (key === 'rumoca-runtime') options.rumocaRuntime = value
    else if (key === 'probe-output-file') options.probeOutputFile = resolve(value)
    else if (key === 'solver-file') options.solverFile = resolve(value)
    else if (key === 'template-file') options.templateFile = resolve(value)
    else if (key === 'omc-wrapper') options.omcWrapper = resolve(value)
    else if (key === 'omc-msl-dir') options.omcMslDir = resolve(value)
    else if (key === 'event-debug-vars') options.eventDebugVarsCsv = value
    else if (key === 'source-file') options.sourceFile = resolve(value)
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

function normalizeRumocaRuntime(value) {
  const runtime = String(value || 'template')
    .trim()
    .toLowerCase()
  if (runtime === 'template' || runtime === 'js' || runtime === 'js-template') return 'template'
  if (runtime === 'native' || runtime === 'rumoca-native') return 'native'
  throw new Error(`Unsupported --rumoca-runtime ${value}`)
}

function renderWithRumoca({ dae, templateSource, modelName }) {
  const daeJson = JSON.stringify(dae)
  if (typeof rumoca.render_template === 'function') {
    return String(rumoca.render_template(daeJson, templateSource) || '')
  }
  if (typeof rumoca.render_target === 'function') {
    const manifestSource = [
      'version = 1',
      'ir = "dae"',
      'name = "javascript"',
      '',
      '[[files]]',
      'path = "{{ model_name }}.js"',
      'template = "javascript.jinja"',
      '',
    ].join('\n')
    const templatesJson = JSON.stringify({ 'javascript.jinja': templateSource })
    const rendered = rumoca.render_target(
      daeJson,
      modelName,
      'javascript',
      manifestSource,
      templatesJson,
    )
    const renderedObj = asObj(rendered)
    const files = Array.isArray(renderedObj?.files) ? renderedObj.files : []
    const firstFile = files[0]
    const firstContent = firstFile && typeof firstFile === 'object' ? firstFile.content : null
    if (typeof firstContent === 'string') return firstContent
    if (typeof rendered === 'string') return rendered
    throw new Error(
      `render_target returned unexpected payload: ${JSON.stringify(rendered).slice(0, 500)}`,
    )
  }
  throw new Error('WASM module is missing render_template / render_target exports')
}

function sanitizeLibraryPath(path) {
  const parts = String(path || '')
    .split('/')
    .filter(Boolean)
  if (parts.length > 1 && /(?:Standard)?Library|^MSL/i.test(parts[0] ?? ''))
    return parts.slice(1).join('/')
  if (parts.length > 0) parts[0] = parts[0].replace(/[\s-][\d.]+$/, '')
  return parts.join('/')
}

function parseJson(raw) {
  return JSON.parse(String(raw))
}

function tryParseJsonObject(raw) {
  try {
    return asObj(parseJson(raw)) ?? {}
  } catch {
    return {}
  }
}

function baseName(path) {
  const parts = String(path || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
  return parts[parts.length - 1] || ''
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true })
}

async function removeDirIfExists(path) {
  try {
    await rm(path, { recursive: true, force: true })
  } catch {
    // best-effort cleanup for generated temp artifacts
  }
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
  await initRumoca({ module_or_path: await loadRumocaWasmBytes() })
  const rayonEnabled =
    typeof rumoca.wasm_init === 'function' ? Boolean(await rumoca.wasm_init(0)) : false
  return {
    version: typeof rumoca.get_version === 'function' ? asString(rumoca.get_version()) : '',
    gitCommit: typeof rumoca.get_git_commit === 'function' ? asString(rumoca.get_git_commit()) : '',
    buildTimeUtc:
      typeof rumoca.get_build_time_utc === 'function' ? asString(rumoca.get_build_time_utc()) : '',
    rayonEnabled,
  }
}

async function loadRumocaWasmBytes() {
  const packageDir = dirname(fileURLToPath(import.meta.resolve('rumoca-full-web')))
  return await readFile(join(packageDir, 'rumoca_bind_wasm_bg.wasm'))
}

async function readLibraryZip(mslZipPath) {
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
  return {
    zipPath: absolute,
    libraries,
    fileCount: Object.keys(libraries).length,
  }
}

async function loadLibrariesFromZips(zipPaths) {
  const normalized = [...new Set(zipPaths.map((x) => resolve(x)))]
  const loadedZips = []
  const mergedLibraries = {}
  const libraryRoots = new Set()
  const rootsByZipPath = {}
  for (const zipPath of normalized) {
    const loadedZip = await readLibraryZip(zipPath)
    loadedZips.push({
      zipPath: loadedZip.zipPath,
      fileCount: loadedZip.fileCount,
    })
    const zipRoots = new Set()
    for (const [path, source] of Object.entries(loadedZip.libraries)) {
      mergedLibraries[path] = source
      const root = String(path).split('/').filter(Boolean)[0] || ''
      if (root) {
        libraryRoots.add(root)
        zipRoots.add(root)
      }
    }
    rootsByZipPath[loadedZip.zipPath] = [...zipRoots].sort()
  }
  const resultRaw = rumoca.load_source_roots(JSON.stringify(mergedLibraries))
  const loaded = parseJson(resultRaw)
  return {
    loaded: loadedZips,
    totalLoadedFiles: Object.keys(mergedLibraries).length,
    totalParsedCount: Number(loaded?.parsed_count) || 0,
    libraryRoots: [...libraryRoots].sort(),
    rootsByZipPath,
  }
}

async function ensureOmcMslDirFromZip({ omcMslDir, mslZip }) {
  const targetDir = resolve(omcMslDir)
  const zipPath = resolve(mslZip)
  const targetParent = dirname(targetDir)
  logRaw(`OMC MSL target dir: ${targetDir}`)
  logRaw(`OMC MSL target parent: ${targetParent}`)
  logRaw(`MSL zip source: ${zipPath}`)

  if (await fileExists(targetDir)) {
    const existingBase = await resolveOmcMslBaseDir(targetDir)
    if (await hasRequiredOmcMslFiles(existingBase)) {
      logRaw(`OMC MSL dir already exists, reusing: ${targetDir}`)
      logRaw(`OMC MSL validated at base: ${existingBase}`)
      return targetDir
    }
    logRaw(`Existing OMC MSL dir is incomplete, re-extracting from zip`)
  }

  if (!(await fileExists(zipPath))) {
    throw new Error(`OMC MSL dir not found and MSL zip missing: dir=${targetDir}, zip=${zipPath}`)
  }

  logRaw(`OMC MSL dir missing, extracting zip into: ${targetParent}`)
  const zipBytes = new Uint8Array(await readFile(zipPath))
  const archive = unzipSync(zipBytes)
  await ensureDir(targetDir)

  let extractedFiles = 0
  for (const [entryPath, content] of Object.entries(archive)) {
    if (!entryPath || entryPath.endsWith('/')) {
      continue
    }
    const outPath = join(targetParent, entryPath)
    await ensureDir(dirname(outPath))
    await writeFile(outPath, content)
    extractedFiles += 1
  }

  if (!(await fileExists(targetDir))) {
    throw new Error(`Failed to materialize OMC MSL dir from zip: ${targetDir}`)
  }
  const extractedBase = await resolveOmcMslBaseDir(targetDir)
  if (!(await hasRequiredOmcMslFiles(extractedBase))) {
    const required = requiredOmcMslRelativePaths().map((p) => join(extractedBase, p))
    throw new Error(
      `OMC MSL extracted but required files are missing.\nbase=${extractedBase}\nmissing_any_of=${required.join(', ')}`,
    )
  }
  logRaw(`Extracted ${extractedFiles} files into: ${targetParent}`)
  logRaw(`OMC MSL dir ready: ${targetDir}`)
  logRaw(`OMC MSL validated at base: ${extractedBase}`)
  return targetDir
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

function flattenClassInfos(nodes, out = []) {
  for (const raw of nodes) {
    const node = asObj(raw)
    if (!node) continue
    const qualifiedName = asString(node.qualified_name)
    const classType = asString(node.class_type)
    if (qualifiedName) {
      out.push({
        qualifiedName,
        classType,
      })
    }
    const children = Array.isArray(node.children) ? node.children : []
    flattenClassInfos(children, out)
  }
  return out
}

function collectKnownClassNames(listClassesRaw) {
  const listParsed = parseJson(listClassesRaw)
  const roots = Array.isArray(listParsed?.classes) ? listParsed.classes : []
  return new Set(flattenClasses(roots))
}

function collectKnownClassInfoByName(listClassesRaw) {
  const listParsed = parseJson(listClassesRaw)
  const roots = Array.isArray(listParsed?.classes) ? listParsed.classes : []
  const pairs = flattenClassInfos(roots)
  return new Map(pairs.map((x) => [x.qualifiedName, x]))
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

function isStandaloneExampleForRoot(modelName, rootName) {
  if (!modelName.startsWith(`${rootName}.`) || !modelName.includes('.Examples.')) return false
  const parts = modelName.split('.Examples.')
  if (parts.length !== 2) return false
  const suffixParts = parts[1].split('.')
  if (suffixParts.length <= 1) return true
  const helper = new Set(['Utilities', 'BaseClasses', 'Internal', 'Interfaces'])
  return !suffixParts.slice(0, -1).some((seg) => helper.has(seg))
}

async function loadTargetModels({ modelName, libraryRoots, knownClassNames }) {
  if (String(modelName || '').trim()) return [String(modelName).trim()]

  const roots = Array.isArray(libraryRoots)
    ? libraryRoots.filter((x) => typeof x === 'string' && x.trim())
    : []
  const classes = [...knownClassNames]
  if (roots.length > 0) {
    const byRoot = classes.filter((name) =>
      roots.some((root) => isStandaloneExampleForRoot(name, root)),
    )
    if (byRoot.length > 0) return byRoot
  }
  if (await fileExists(DEFAULT_TARGETS_FILE)) {
    const raw = parseJson(await readFile(DEFAULT_TARGETS_FILE, 'utf8'))
    const modelNames = Array.isArray(raw?.model_names) ? raw.model_names : []
    const fromCurated = modelNames.filter((x) => typeof x === 'string' && knownClassNames.has(x))
    if (fromCurated.length > 0) return fromCurated
  }
  return classes.filter((name) => isRootStandaloneExampleModel(name))
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

function nowIso() {
  return new Date().toISOString()
}

const RUN_LOG_BUFFER = []
const MAX_RUN_LOG_LINES = 20000

function pushRunLog(line) {
  RUN_LOG_BUFFER.push(line)
  if (RUN_LOG_BUFFER.length > MAX_RUN_LOG_LINES) RUN_LOG_BUFFER.shift()
}

function logRaw(message) {
  const line = `[modelica_compare_cli] ${message}`
  console.log(line)
  pushRunLog(line)
}

function logInfo(message) {
  logRaw(`${nowIso()} ${message}`)
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
    throw new Error(
      `OMC trace invalid for ${modelName}: expected >=2 time samples from ${sourcePath}`,
    )
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
      throw new Error(
        `OMC trace invalid for ${modelName}: channel ${name} is empty in ${sourcePath}`,
      )
    }
  }
}

function normalizeSolverTrace(runResult) {
  const direct = asObj(runResult)
  if (direct && Array.isArray(direct.times) && asObj(direct.series)) {
    const times = direct.times.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    const n = times.length
    const seriesObj = asObj(direct.series) ?? {}
    const series = {}
    for (const [name, raw] of Object.entries(seriesObj)) {
      if (!Array.isArray(raw)) continue
      series[name] = raw
        .slice(0, n)
        .map((v) => (Number.isFinite(Number(v)) ? Number(v) : Number.NaN))
    }
    return { times, series }
  }
  const payload = asObj(direct?.payload) ?? direct
  if (payload && Array.isArray(payload.names) && Array.isArray(payload.allData)) {
    const names = payload.names
    const allData = payload.allData
    const times = Array.isArray(allData[0])
      ? allData[0].map((v) => Number(v)).filter((v) => Number.isFinite(v))
      : []
    const n = times.length
    const series = {}
    const cols = Math.min(names.length, allData.length - 1)
    for (let i = 0; i < cols; i += 1) {
      const name = typeof names[i] === 'string' ? names[i] : ''
      const column = Array.isArray(allData[i + 1]) ? allData[i + 1] : []
      if (!name || column.length === 0) continue
      series[name] = column
        .slice(0, n)
        .map((v) => (Number.isFinite(Number(v)) ? Number(v) : Number.NaN))
    }
    return { times, series }
  }
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
      series[`${prefix}.${name}`] = raw
        .slice(0, n)
        .map((v) => (Number.isFinite(Number(v)) ? Number(v) : Number.NaN))
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

async function runOmcScript({ omcWrapper, mosPath, cwd, timeoutMs, modelName }) {
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
    let settled = false
    const timer = setTimeout(
      () => {
        if (settled) return
        settled = true
        try {
          child.kill('SIGKILL')
        } catch {
          // ignore kill races on already-exited children
        }
        rejectPromise(new Error(`OMC timeout after ${timeoutMs}ms for ${modelName}`))
      },
      Math.max(1, Number(timeoutMs) || DEFAULT_OMC_TIMEOUT_MS),
    )
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', rejectPromise)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (code === 0) resolvePromise({ stdout, stderr })
      else rejectPromise(new Error(`OMC wrapper failed with code ${code}: ${stderr || stdout}`))
    })
  })
}

async function resolveOmcMslBaseDir(mslDir) {
  const direct = resolve(mslDir)
  const nestedHuman = join(direct, 'Modelica 4.1.0')
  const nestedArchive = join(direct, 'ModelicaStandardLibrary-4.1.0')
  if (await fileExists(join(direct, 'Modelica/package.mo'))) return direct
  if (await fileExists(join(nestedHuman, 'Modelica/package.mo'))) return nestedHuman
  if (await fileExists(join(nestedArchive, 'Modelica/package.mo'))) return nestedArchive
  return direct
}

function requiredOmcMslRelativePaths() {
  return [
    'Complex.mo',
    'Modelica/package.mo',
    'ModelicaServices/package.mo',
    'ModelicaReference/package.mo',
    'ModelicaTestOverdetermined.mo',
  ]
}

async function hasRequiredOmcMslFiles(mslBaseDir) {
  const required = requiredOmcMslRelativePaths()
  for (const rel of required) {
    if (!(await fileExists(join(mslBaseDir, rel)))) return false
  }
  return true
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

async function loadOrCreateOmcTrace({
  modelName,
  sim,
  omcWrapper,
  omcMslDir,
  omcTimeoutMs,
  omcMaxCsvBytes,
}) {
  await ensureDir(OMC_CACHE_DIR)
  const key = `${safeName(modelName)}__t0_${sim.t0}__tf_${sim.tf}__dt_${sim.dt}.json`
  const cachePath = join(OMC_CACHE_DIR, key)
  if (await fileExists(cachePath)) {
    const raw = parseJson(await readFile(cachePath, 'utf8'))
    const trace = normalizeOmcTrace(raw)
    try {
      validateTraceShape(trace, {
        modelName,
        t0: sim.t0,
        tf: sim.tf,
        dt: sim.dt,
        sourcePath: cachePath,
      })
      logInfo(
        `[${modelName}] OMC cache hit: valid cached reference found, skipping OMC recomputation`,
      )
      return { trace, cachePath, fromCache: true }
    } catch {
      // stale or malformed cache entry; regenerate
      logInfo(`[${modelName}] OMC cache hit but invalid trace shape, regenerating reference`)
    }
  }
  const runDir = join(OMC_CACHE_DIR, `${safeName(modelName)}__run`)
  await removeDirIfExists(runDir)
  await ensureDir(runDir)
  const fileNamePrefix = safeName(modelName)
  const csvName = `${fileNamePrefix}_res.csv`
  const mosPath = join(runDir, `run_${Date.now()}.mos`)
  const mslBaseDir = await resolveOmcMslBaseDir(omcMslDir)
  logRaw(`OMC MSL load base: ${mslBaseDir}`)
  if (!(await hasRequiredOmcMslFiles(mslBaseDir))) {
    const required = requiredOmcMslRelativePaths().map((p) => join(mslBaseDir, p))
    throw new Error(
      `OMC MSL base is missing required files before simulation.\nbase=${mslBaseDir}\nrequired=${required.join(', ')}`,
    )
  }
  const script = [
    ...mslLoadLines(mslBaseDir),
    `simulate(${modelName}, startTime=${sim.t0}, stopTime=${sim.tf}, outputFormat="csv", fileNamePrefix="${fileNamePrefix}");`,
    'getErrorString();',
  ].join('\n')
  try {
    await writeFile(mosPath, script, 'utf8')
    const omcRun = await runOmcScript({
      omcWrapper,
      mosPath,
      cwd: runDir,
      timeoutMs: omcTimeoutMs,
      modelName,
    })
    const csvPath = join(runDir, csvName)
    if (!(await fileExists(csvPath))) {
      const runDirEntries = await readDirSafe(runDir)
      throw new Error(
        [
          `OMC did not produce expected CSV: ${csvPath}`,
          `model=${modelName}`,
          `mos=${mosPath}`,
          `run_dir=${runDir}`,
          `run_dir_entries=${runDirEntries.join(', ') || '(empty)'}`,
          `omc_stdout=${(omcRun.stdout || '').trim() || '(empty)'}`,
          `omc_stderr=${(omcRun.stderr || '').trim() || '(empty)'}`,
        ].join('\n'),
      )
    }
    const csvStats = await stat(csvPath)
    if (Number(csvStats.size) > Number(omcMaxCsvBytes)) {
      throw new Error(
        `OMC CSV exceeds limit for ${modelName}: ${csvStats.size} bytes > ${omcMaxCsvBytes} bytes (${csvPath})`,
      )
    }
    const csvContent = await readFile(csvPath, 'utf8')
    const trace = normalizeOmcTrace(parseOmcCsv(csvContent))
    validateTraceShape(trace, {
      modelName,
      t0: sim.t0,
      tf: sim.tf,
      dt: sim.dt,
      sourcePath: csvPath,
    })
    await writeFile(cachePath, JSON.stringify(trace), 'utf8')
    return { trace, cachePath, fromCache: false }
  } finally {
    await removeDirIfExists(runDir)
  }
}

async function readDirSafe(path) {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

async function runSolverForModel({
  modelName,
  sourceModelica,
  templateSource,
  solverSource,
  sim,
  debug,
}) {
  const compileStartedAt = Date.now()
  const { compiled, dae } = compileModelForTemplate({ modelName, sourceModelica })
  const compileElapsedMs = Date.now() - compileStartedAt

  if (!dae) {
    const preparedStatus = asString(compiled?.dae_prepared_status)
    const preparedError = asString(compiled?.dae_prepared_error)
    const diagnostics = asObj(compiled?.dae_prepared_diagnostics) ?? {}
    const planErrors = Array.isArray(compiled?.__compile_plan_errors)
      ? compiled.__compile_plan_errors
      : []
    throw new Error(
      `compile returned no usable DAE for ${modelName}: dae_prepared_status=${preparedStatus || 'n/a'}, dae_prepared_error=${preparedError || 'n/a'}, diagnostics=${JSON.stringify(diagnostics).slice(0, 500)}${planErrors.length ? `, plan_errors=${planErrors.join(' || ')}` : ''}`,
    )
  }
  const rendered = renderWithRumoca({ dae, templateSource, modelName })
  let runFn
  try {
    runFn = new Function(
      'params',
      'context',
      `${rendered}\n${solverSource}\nif (typeof Model !== 'function') throw new Error('Model() missing'); if (typeof simulateModel !== 'function') throw new Error('simulateModel() missing'); const __rumocaNamedArgFn = (value, fallback) => (typeof value === 'undefined' ? fallback : value); const __rumoca_named_arg__ = new Proxy(__rumocaNamedArgFn, { get: () => __rumocaNamedArgFn }); const __rumocaIntervalDt = Number(params?.sim?.dt); const interval = () => __rumocaIntervalDt; const __model = Model(); if (__model && typeof __model.configureDebug === 'function') { __model.configureDebug({ enabled: !!context.enableEventDebug, vars: Array.isArray(context.debugVars) ? context.debugVars : [], maxEvents: context.maxDebugEvents }); } const __result = simulateModel(params, context, __model); if (__result && __model && typeof __model.getDebugEvents === 'function') { __result.__debugEvents = __model.getDebugEvents(); } return __result;`,
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
  let result
  try {
    result = runFn(
      { sim: { t0: sim.t0, tf: sim.tf, dt: sim.dt, solverOptions: sim.solverOptions || {} } },
      {
        log: () => {},
        enableEventDebug: Boolean(debug?.enabled),
        debugVars: Array.isArray(debug?.vars) ? debug.vars : [],
        maxDebugEvents: Number(debug?.maxEvents) || 100000,
      },
    )
  } catch (error) {
    if (error && typeof error === 'object') {
      error.renderedJs = rendered
      error.daePrepared = dae
      error.compileElapsedMs = compileElapsedMs
    }
    throw error
  }
  const stopReason = asString(result?.meta?.stopReason)
  if (stopReason) {
    const stopError = asString(result?.meta?.stopError)
    const details = asObj(result?.meta?.stopDetails) ?? {}
    const stats = asObj(result?.meta?.solverStats) ?? {}
    throw new Error(
      `solver stopped for ${modelName}: stopReason=${stopReason}, stopError=${stopError || 'n/a'}, stepIndex=${details.stepIndex ?? 'n/a'}, time=${details.time ?? 'n/a'}, flowStepCalls=${stats.flowStepCalls ?? 'n/a'}`,
    )
  }
  return {
    result,
    rendered,
    dae,
    compileElapsedMs,
    debugEvents: Array.isArray(result?.__debugEvents) ? result.__debugEvents : [],
  }
}

function compileModelForTemplateDetailed({ modelName, compileOptionsJson = '{}' }) {
  const compilePlans = [{ source: '', target: modelName }]
  let compiled = null
  let dae = null
  let lastCompiled = null
  const planErrors = []
  const planStats = []
  for (const plan of compilePlans) {
    const startedAt = Date.now()
    const label = `plan(source=${plan.source ? 'inline' : 'loaded'}, target=${plan.target})`
    try {
      const compiledRaw =
        typeof rumoca.compile_with_source_roots_with_options === 'function'
          ? rumoca.compile_with_source_roots_with_options(
              plan.source,
              plan.target,
              '{}',
              compileOptionsJson,
            )
          : rumoca.compile_with_source_roots(plan.source, plan.target, '{}')
      const candidate = parseJson(compiledRaw)
      lastCompiled = candidate
      const candidateDae = selectDaeForTemplate(candidate, true)
      planStats.push({
        label,
        elapsedMs: Date.now() - startedAt,
        result: candidateDae ? 'dae_ok' : 'no_usable_dae',
        daePreparedStatus: asString(candidate?.dae_prepared_status) || '',
        daePreparedError: asString(candidate?.dae_prepared_error) || '',
        compilePhaseTiming: asObj(candidate?.__compile_phase_timing) ?? null,
      })
      if (candidateDae) {
        compiled = candidate
        dae = candidateDae
        break
      }
      planErrors.push(`${label} returned no usable DAE`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      planStats.push({
        label,
        elapsedMs: Date.now() - startedAt,
        result: 'crashed',
        error: message,
      })
      planErrors.push(`${label} crashed: ${message}`)
    }
  }
  if (!compiled) compiled = lastCompiled
  if (!compiled) {
    const error = new Error(
      `all compile plans failed for ${modelName}: ${planErrors.join(' | ') || 'no diagnostics'}`,
    )
    error.planStats = planStats
    throw error
  }
  if (!dae && planErrors.length > 0) {
    compiled.__compile_plan_errors = planErrors
  }
  return { compiled, dae, planStats, planErrors }
}

function compileModelForTemplate({ modelName }) {
  const { compiled, dae } = compileModelForTemplateDetailed({ modelName })
  return { compiled, dae }
}

async function runSingleModelCompileProbe(options) {
  if (!String(options.modelName || '').trim()) {
    throw new Error('probe-compile requires --model <qualified.name>')
  }
  const init = await initRumocaEngine()
  const libraries = await loadLibrariesFromZips([options.mslZip, ...options.libraryZips])
  const classInfo = parseJson(rumoca.get_class_info(options.modelName))
  const sourceModelica = asString(classInfo?.source_modelica)
  if (!sourceModelica.trim()) {
    return {
      status: 'compile_fail',
      modelName: options.modelName,
      error: 'missing source_modelica',
      init,
      libraries,
    }
  }
  if (!options.compileForceDae && typeof rumoca.compile_check_with_source_roots === 'function') {
    try {
      const compileOptionsJson = asString(options.compileOptionsJson || '{}')
      if (typeof rumoca.compile_check_with_source_roots_with_options === 'function') {
        rumoca.compile_check_with_source_roots_with_options(
          '',
          options.modelName,
          '{}',
          compileOptionsJson,
        )
      } else {
        rumoca.compile_check_with_source_roots('', options.modelName, '{}')
      }
      return { status: 'compiled', modelName: options.modelName, init, libraries }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : null
      return {
        status: 'compile_fail',
        modelName: options.modelName,
        error: message,
        ...(stack ? { stack } : {}),
        init,
        libraries,
      }
    }
  }
  try {
    const { compiled, dae, planStats } = compileModelForTemplateDetailed({
      modelName: options.modelName,
      sourceModelica,
      compileOptionsJson: asString(options.compileOptionsJson || '{}'),
    })
    if (!dae) {
      const preparedStatus = asString(compiled?.dae_prepared_status)
      const preparedError = asString(compiled?.dae_prepared_error)
      return {
        status: 'compile_fail',
        modelName: options.modelName,
        error: `compile returned no usable DAE: dae_prepared_status=${preparedStatus || 'n/a'}, dae_prepared_error=${preparedError || 'n/a'}`,
        init,
        libraries,
        planStats,
      }
    }
    return { status: 'compiled', modelName: options.modelName, init, libraries, planStats }
  } catch (error) {
    return {
      status: 'compile_fail',
      modelName: options.modelName,
      error: error instanceof Error ? error.message : String(error),
      ...(Array.isArray(error?.planStats) ? { planStats: error.planStats } : {}),
      init,
      libraries,
    }
  }
}

async function runSourceCompileProbe(options) {
  if (!String(options.modelName || '').trim()) {
    throw new Error('probe-source requires --model <qualified.name>')
  }
  if (!String(options.sourceFile || '').trim()) {
    throw new Error('probe-source requires --source-file <path>')
  }
  const init = await initRumocaEngine()
  const libraries = await loadLibrariesFromZips([options.mslZip, ...options.libraryZips])
  const sourceModelica = await readFile(resolve(options.sourceFile), 'utf8')
  if (!options.compileForceDae && typeof rumoca.compile_check_with_source_roots === 'function') {
    try {
      const compileOptionsJson = asString(options.compileOptionsJson || '{}')
      if (typeof rumoca.compile_check_with_source_roots_with_options === 'function') {
        rumoca.compile_check_with_source_roots_with_options(
          sourceModelica,
          options.modelName,
          '{}',
          compileOptionsJson,
        )
      } else {
        rumoca.compile_check_with_source_roots(sourceModelica, options.modelName, '{}')
      }
      return { status: 'compiled', modelName: options.modelName, init, libraries }
    } catch (error) {
      return {
        status: 'compile_fail',
        modelName: options.modelName,
        error: error instanceof Error ? error.message : String(error),
        init,
        libraries,
      }
    }
  }
  try {
    const { compiled, dae, planStats } = compileModelForTemplateDetailed({
      modelName: options.modelName,
      sourceModelica,
      compileOptionsJson: asString(options.compileOptionsJson || '{}'),
    })
    if (!dae) {
      const preparedStatus = asString(compiled?.dae_prepared_status)
      const preparedError = asString(compiled?.dae_prepared_error)
      return {
        status: 'compile_fail',
        modelName: options.modelName,
        error: `compile returned no usable DAE: dae_prepared_status=${preparedStatus || 'n/a'}, dae_prepared_error=${preparedError || 'n/a'}`,
        init,
        libraries,
        planStats,
      }
    }
    return { status: 'compiled', modelName: options.modelName, init, libraries, planStats }
  } catch (error) {
    return {
      status: 'compile_fail',
      modelName: options.modelName,
      error: error instanceof Error ? error.message : String(error),
      ...(Array.isArray(error?.planStats) ? { planStats: error.planStats } : {}),
      init,
      libraries,
    }
  }
}

async function runSingleModelSolveProbe(options) {
  if (!String(options.modelName || '').trim()) {
    throw new Error('probe-solve requires --model <qualified.name>')
  }
  options.rumocaRuntime = normalizeRumocaRuntime(options.rumocaRuntime)
  await initRumocaEngine()
  await loadLibrariesFromZips([options.mslZip, ...options.libraryZips])
  let solverOptions = {}
  if (String(options.solverOptionsJson || '').trim()) {
    try {
      const parsed = JSON.parse(options.solverOptionsJson)
      solverOptions = asObj(parsed) ?? {}
    } catch (error) {
      return {
        status: 'run_fail',
        modelName: options.modelName,
        error: `invalid solver options json: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
  if (options.rumocaRuntime === 'native') {
    try {
      const solverRun = runNativeRumocaSimulation({
        modelName: options.modelName,
        t0: options.t0,
        tf: options.tf,
        dt: options.dt,
        solverOptions,
      })
      return {
        status: 'ok',
        modelName: options.modelName,
        compileElapsedMs: 0,
        nativeElapsedMs: Number(solverRun.elapsedMs) || 0,
        solverTrace: normalizeSolverTrace(solverRun.result),
      }
    } catch (error) {
      return {
        status: 'run_fail',
        modelName: options.modelName,
        error: error instanceof Error ? error.message : String(error),
        compileElapsedMs: 0,
      }
    }
  }
  const classInfo = parseJson(rumoca.get_class_info(options.modelName))
  const sourceModelica = asString(classInfo?.source_modelica)
  if (!sourceModelica.trim()) {
    return {
      status: 'run_fail',
      modelName: options.modelName,
      error: 'missing source_modelica',
    }
  }
  const templateSource = await readFile(resolve(options.templateFile), 'utf8')
  const solverSource = await readFile(resolve(options.solverFile), 'utf8')
  try {
    const solverRun = await runSolverForModel({
      modelName: options.modelName,
      sourceModelica,
      templateSource,
      solverSource,
      sim: { t0: options.t0, tf: options.tf, dt: options.dt, solverOptions },
      debug: {
        enabled: false,
        vars: [],
        maxEvents: 0,
      },
    })
    return {
      status: 'ok',
      modelName: options.modelName,
      compileElapsedMs: Number(solverRun.compileElapsedMs) || 0,
      renderedJs: asString(solverRun.rendered || ''),
      solverTrace: normalizeSolverTrace(solverRun.result),
    }
  } catch (error) {
    return {
      status: 'run_fail',
      modelName: options.modelName,
      error: error instanceof Error ? error.message : String(error),
      renderedJs: asString(error?.renderedJs || ''),
      compileElapsedMs: Number(error?.compileElapsedMs) || 0,
    }
  }
}

function nativeSolverName(solverOptions) {
  const solver = asString(solverOptions?.solver || solverOptions?.solverName).trim()
  return solver || 'auto'
}

function isSolverTimeoutError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return /solver timeout after \d+ms/i.test(message)
}

function runNativeRumocaSimulation({ modelName, t0, tf, dt, solverOptions }) {
  if (typeof rumoca.simulate_model !== 'function') {
    throw new Error('WASM module is missing simulate_model')
  }
  if (Math.abs(Number(t0) || 0) > 1e-12) {
    throw new Error('native Rumoca wasm simulation currently supports only t0=0')
  }
  const startedAt = Date.now()
  const raw = rumoca.simulate_model(
    '',
    modelName,
    Number.isFinite(tf) ? tf : 5,
    Number.isFinite(dt) ? dt : 0.01,
    nativeSolverName(solverOptions),
    '{}',
  )
  return {
    elapsedMs: Date.now() - startedAt,
    result: parseJson(raw),
  }
}

async function runSolverProbeInSubprocess({
  modelName,
  mslZip,
  libraryZips,
  solverTimeoutMs,
  solverFile,
  templateFile,
  t0,
  tf,
  dt,
  solverOptionsJson,
  rumocaRuntime,
}) {
  await mkdir(RUN_CACHE_DIR, { recursive: true })
  const probeOutputFile = join(
    RUN_CACHE_DIR,
    `solve_probe_${safeName(modelName)}_${process.pid}_${Date.now()}.json`,
  )
  const args = [
    SCRIPT_PATH,
    'probe-solve',
    '--msl-zip',
    resolve(mslZip),
    '--model',
    modelName,
    '--solver-file',
    resolve(solverFile),
    '--template-file',
    resolve(templateFile),
    '--t0',
    String(t0),
    '--tf',
    String(tf),
    '--dt',
    String(dt),
    '--probe-output-file',
    probeOutputFile,
  ]
  for (const zipPath of libraryZips) args.push('--library-zip', resolve(zipPath))
  if (String(solverOptionsJson || '').trim()) {
    args.push('--solver-options-json', String(solverOptionsJson))
  }
  if (String(rumocaRuntime || '').trim()) {
    args.push('--rumoca-runtime', String(rumocaRuntime))
  }
  return await new Promise((resolveProbe, rejectProbe) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(
      () => {
        if (settled) return
        settled = true
        child.kill('SIGKILL')
        void unlink(probeOutputFile).catch(() => {})
        rejectProbe(new Error(`solver timeout after ${solverTimeoutMs}ms for ${modelName}`))
      },
      Math.max(1, Number(solverTimeoutMs) || DEFAULT_SOLVER_TIMEOUT_MS),
    )
    child.stdout.on('data', (buf) => {
      stdout += String(buf)
    })
    child.stderr.on('data', (buf) => {
      stderr += String(buf)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void unlink(probeOutputFile).catch(() => {})
      rejectProbe(error)
    })
    child.on('close', async (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        void unlink(probeOutputFile).catch(() => {})
        rejectProbe(
          new Error(
            `solver probe process failed for ${modelName}: exit=${code}, stderr=${stderr.trim() || '(empty)'}, stdout=${stdout.trim() || '(empty)'}`,
          ),
        )
        return
      }
      try {
        const probe = await readJsonFile(probeOutputFile)
        void unlink(probeOutputFile).catch(() => {})
        resolveProbe(probe)
      } catch (error) {
        void unlink(probeOutputFile).catch(() => {})
        rejectProbe(
          new Error(
            `solver probe returned no JSON output file for ${modelName}: ${(error instanceof Error ? error.message : String(error)) || 'unknown error'}; stdout=${(stdout || '').trim().slice(0, 500) || '(empty)'} stderr=${(stderr || '').trim().slice(0, 500) || '(empty)'}`,
          ),
        )
      }
    })
  })
}

async function runSolverProbeInProcess({
  modelName,
  mslZip,
  libraryZips,
  solverFile,
  templateFile,
  t0,
  tf,
  dt,
  solverOptionsJson,
  rumocaRuntime,
}) {
  return await runSingleModelSolveProbe({
    command: 'probe-solve',
    modelName,
    mslZip: resolve(mslZip),
    libraryZips: Array.isArray(libraryZips) ? libraryZips.map((p) => resolve(p)) : [],
    solverFile: resolve(solverFile),
    templateFile: resolve(templateFile),
    t0,
    tf,
    dt,
    solverOptionsJson: String(solverOptionsJson || ''),
    rumocaRuntime: normalizeRumocaRuntime(rumocaRuntime),
  })
}

function compileCurrentModelInLoadedSession(modelName, options = {}) {
  if (!options.compileForceDae && typeof rumoca.compile_check_with_source_roots === 'function') {
    const startedAt = Date.now()
    try {
      const compileOptionsJson = asString(options.compileOptionsJson || '{}')
      const compiledRaw =
        typeof rumoca.compile_check_with_source_roots_with_options === 'function'
          ? rumoca.compile_check_with_source_roots_with_options(
              '',
              modelName,
              '{}',
              compileOptionsJson,
            )
          : rumoca.compile_check_with_source_roots('', modelName, '{}')
      const compiled = parseJson(compiledRaw)
      return {
        status: 'compiled',
        modelName,
        planStats: [
          {
            label: 'plan(source=loaded,target=qualified,mode=compile_check)',
            elapsedMs: Date.now() - startedAt,
            result: 'compiled',
            compilePhaseTiming: asObj(compiled?.__compile_phase_timing) ?? null,
            compileCheckTiming: asObj(compiled?.__compile_check_timing) ?? null,
          },
        ],
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        status: 'compile_fail',
        modelName,
        error: message,
        planStats: [
          {
            label: 'plan(source=loaded,target=qualified,mode=compile_check)',
            elapsedMs: Date.now() - startedAt,
            result: 'crashed',
            error: message,
          },
        ],
      }
    }
  }
  const classInfo = parseJson(rumoca.get_class_info(modelName))
  const sourceModelica = asString(classInfo?.source_modelica)
  if (!sourceModelica.trim()) {
    return { status: 'compile_fail', modelName, error: 'missing source_modelica' }
  }
  try {
    const { compiled, dae, planStats } = compileModelForTemplateDetailed({
      modelName,
      sourceModelica,
      compileOptionsJson: asString(options.compileOptionsJson || '{}'),
    })
    if (!dae) {
      const preparedStatus = asString(compiled?.dae_prepared_status)
      const preparedError = asString(compiled?.dae_prepared_error)
      return {
        status: 'compile_fail',
        modelName,
        error: `compile returned no usable DAE: dae_prepared_status=${preparedStatus || 'n/a'}, dae_prepared_error=${preparedError || 'n/a'}`,
        planStats,
      }
    }
    return { status: 'compiled', modelName, planStats }
  } catch (error) {
    return {
      status: 'compile_fail',
      modelName,
      error: error instanceof Error ? error.message : String(error),
      ...(Array.isArray(error?.planStats) ? { planStats: error.planStats } : {}),
    }
  }
}

async function runCompileWorkerDaemon(options) {
  await initRumocaEngine()
  await loadLibrariesFromZips([options.mslZip, ...options.libraryZips])
  if (typeof process.send === 'function') process.send({ type: 'ready' })
  process.on('message', async (msg) => {
    if (!msg || msg.type !== 'compile') return
    const requestId = asString(msg.requestId)
    const modelName = asString(msg.modelName)
    const timeoutMs = Math.max(1, Number(msg.compileTimeoutMs) || DEFAULT_COMPILE_TIMEOUT_MS)
    const startedAt = Date.now()
    try {
      const probe = await Promise.resolve(compileCurrentModelInLoadedSession(modelName, options))
      const elapsedMs = Date.now() - startedAt
      const result =
        probe.status === 'compiled' && elapsedMs > timeoutMs
          ? {
              status: 'compile_fail',
              modelName,
              error: `compile timeout after ${timeoutMs}ms for ${modelName}`,
            }
          : probe
      if (typeof process.send === 'function') {
        process.send({ type: 'result', requestId, modelName, elapsedMs, result })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (typeof process.send === 'function') {
        process.send({
          type: 'result',
          requestId,
          modelName,
          elapsedMs: Date.now() - startedAt,
          result: { status: 'compile_fail', modelName, error: message },
        })
      }
    }
  })
  await new Promise(() => {})
}

async function promptChoice(modelName, deviationPercent) {
  const rl = readline.createInterface({ input, output })
  const prompt = `High diff for ${modelName} (max ${deviationPercent.toFixed(3)}%). [c]ontinue, [a]lways continue, [d]ebug+stop, [s]top: `
  const answer = (await rl.question(prompt)).trim().toLowerCase()
  rl.close()
  if (answer === 'c') return 'continue'
  if (answer === 'a') return 'always_continue'
  if (answer === 'd') return 'debug'
  return 'stop'
}

async function spawnCompileWorkerProcess(options) {
  const args = [SCRIPT_PATH, 'compile-worker', '--msl-zip', resolve(options.mslZip)]
  for (const zipPath of options.libraryZips) args.push('--library-zip', resolve(zipPath))
  if (asString(options.compileOptionsJson || '').trim()) {
    args.push('--compile-options-json', asString(options.compileOptionsJson))
  }
  const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  child.stdout.on('data', () => {})
  child.stderr.on('data', () => {})
  await new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error('compile worker ready timeout')), 120000)
    const onMessage = (msg) => {
      if (msg?.type === 'ready') {
        clearTimeout(timer)
        child.off('message', onMessage)
        resolveReady()
      }
    }
    child.on('message', onMessage)
    child.on('exit', (code) => {
      clearTimeout(timer)
      rejectReady(new Error(`compile worker exited before ready (code=${code})`))
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      rejectReady(error)
    })
  })
  return child
}

async function runCompileOnWorker({ child, modelName, compileTimeoutMs }) {
  const requestId = `${Date.now()}_${Math.random().toString(36).slice(2)}`
  return await new Promise((resolveResult, rejectResult) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      rejectResult(new Error(`compile timeout after ${compileTimeoutMs}ms for ${modelName}`))
    }, compileTimeoutMs)
    const onMessage = (msg) => {
      if (settled || msg?.type !== 'result' || asString(msg.requestId) !== requestId) return
      settled = true
      clearTimeout(timer)
      child.off('message', onMessage)
      resolveResult({
        modelName,
        elapsedMs: Number(msg.elapsedMs) || 0,
        result: asObj(msg.result) ?? {
          status: 'compile_fail',
          modelName,
          error: 'invalid worker response',
        },
      })
    }
    child.on('message', onMessage)
    child.send({ type: 'compile', requestId, modelName, compileTimeoutMs })
  })
}

async function writeDebugBundle(payload) {
  const dir = join(RUN_CACHE_DIR, `debug_${Date.now()}_${safeName(payload.modelName)}`)
  await ensureDir(dir)
  await writeFile(join(dir, 'summary.json'), JSON.stringify(payload.summary, null, 2), 'utf8')
  await writeFile(join(dir, 'modelica.mo'), payload.sourceModelica || '', 'utf8')
  await writeFile(join(dir, 'generated_model.js'), payload.renderedJs || '', 'utf8')
  await writeFile(
    join(dir, 'dae_prepared.json'),
    JSON.stringify(payload.daePrepared ?? null, null, 2),
    'utf8',
  )
  await writeFile(join(dir, 'solver.js'), payload.solverSource || '', 'utf8')
  await writeFile(
    join(dir, 'solver_trace.json'),
    JSON.stringify(payload.solverTrace, null, 2),
    'utf8',
  )
  await writeFile(join(dir, 'omc_trace.json'), JSON.stringify(payload.omcTrace, null, 2), 'utf8')
  if (Array.isArray(payload.solverEventLog)) {
    await writeFile(
      join(dir, 'solver_event_log.json'),
      JSON.stringify(payload.solverEventLog, null, 2),
      'utf8',
    )
  }
  if (payload.comparison) {
    await writeFile(
      join(dir, 'comparison.json'),
      JSON.stringify(payload.comparison, null, 2),
      'utf8',
    )
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
  const compiled = records.filter((r) => r.status === 'compiled').length
  const compared = records.filter((r) => r.status === 'compared').length
  const compileFailed = records.filter((r) => r.status === 'compile_fail').length
  const runtimeFailed = records.filter((r) => r.status === 'run_fail').length
  const missingChannels = records.filter((r) => r.status === 'missing_channels').length
  const maxDeviationPercent = records.reduce(
    (acc, r) => Math.max(acc, Number(r.maxDeviationPercent) || 0),
    0,
  )
  return {
    total,
    compiled,
    compared,
    compileFailed,
    runtimeFailed,
    missingChannels,
    maxDeviationPercent,
  }
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((p / 100) * sortedValues.length)),
  )
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
  const avgElapsedMs = elapsed.length
    ? elapsed.reduce((acc, value) => acc + value, 0) / elapsed.length
    : 0
  const topOutliers = compared
    .slice()
    .sort((a, b) => (Number(b.maxDeviationPercent) || 0) - (Number(a.maxDeviationPercent) || 0))
    .slice(0, 10)

  const formatFailureLine = (r, idx) => {
    const modelName = String(r.modelName)
    const errorText = String(r.error || 'unknown error')
    const stackFirstLine =
      String(r.stack || '')
        .split('\n')
        .map((x) => x.trim())
        .find(Boolean) || ''
    const debugPath = String(r.debugPath || '')
    const details = [
      `${idx + 1}. ${modelName} | ${errorText}`,
      ...(stackFirstLine ? [`   stack: ${stackFirstLine}`] : []),
      ...(debugPath ? [`   debug: ${debugPath}`] : []),
    ]
    return details.join('\n')
  }

  const lines = [
    'Modelica Compare Report',
    'NOTE: AI/debug agents should follow the testing strategy in packages/shared/modelica/README.md',
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${String(summary.mode || '')}`,
    `Rumoca runtime: ${String(summary.rumocaRuntime || 'template')}`,
    `Seed: ${String(summary.seed ?? '')}`,
    '',
    'Summary',
    `- Total models: ${summary.summary.total}`,
    `- Compiled only: ${Number(summary.summary.compiled || 0)}`,
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
    ...(runFails.length ? runFails.map((r, idx) => formatFailureLine(r, idx)) : ['(none)']),
    '',
    'Compile Failures',
    ...(compileFails.length ? compileFails.map((r, idx) => formatFailureLine(r, idx)) : ['(none)']),
    '',
    'Missing Channels',
    ...(missingChannels.length
      ? missingChannels.map((r, idx) => `${idx + 1}. ${String(r.modelName)}`)
      : ['(none)']),
    '',
    `Progress JSON: ${String(summary.progressPath || '')}`,
    `OMC Cache Dir: ${String(summary.omcCacheDir || '')}`,
    '',
    'CLI Log Transcript',
    ...(Array.isArray(summary.cliLogs) && summary.cliLogs.length > 0
      ? summary.cliLogs
      : ['(none)']),
    '',
    'Run JSON',
    '```json',
    JSON.stringify(summary, null, 2),
    '```',
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

async function readJsonFile(path) {
  return parseJson(await readFile(resolve(path), 'utf8'))
}

async function pickNewestRunLatestFile() {
  await ensureDir(COMPARE_ARTIFACT_DIR)
  const names = await readdir(COMPARE_ARTIFACT_DIR)
  const candidates = names
    .filter((name) => /^run_latest_.*\.json$/i.test(name))
    .filter((name) => name.toLowerCase() !== 'run_latest_default.json')
    .map((name) => join(COMPARE_ARTIFACT_DIR, name))
  if (candidates.length === 0) return ''
  let newest = candidates[0]
  let newestMtime = 0
  for (const path of candidates) {
    const s = await stat(path)
    const m = Number(s.mtimeMs) || 0
    if (m > newestMtime) {
      newestMtime = m
      newest = path
    }
  }
  return newest
}

function sortJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  const obj = asObj(value)
  if (!obj) return value
  const entries = Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(entries.map(([k, v]) => [k, sortJsonValue(v)]))
}

async function writeJsonFile(path, payload) {
  await ensureDir(dirname(path))
  const sorted = sortJsonValue(payload)
  await writeFile(path, JSON.stringify(sorted, null, 2), 'utf8')
}

function byModelName(records) {
  const map = new Map()
  for (const raw of Array.isArray(records) ? records : []) {
    const modelName = asString(raw?.modelName)
    if (modelName) map.set(modelName, asObj(raw) ?? {})
  }
  return map
}

function sanitizeTag(text) {
  return String(text || '')
    .trim()
    .replaceAll(/[^a-zA-Z0-9._-]+/g, '_')
    .replaceAll(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

function deriveLibraryTagFromLibraries(libraries) {
  const zips = Array.isArray(libraries?.loaded) ? libraries.loaded : []
  const hasAnyZip = zips.length > 0
  const hasOnlyMslZip =
    hasAnyZip &&
    zips.every((x) => {
      const name = baseName(x?.zipPath)
      return /modelicastandardlibrary/i.test(name)
    })
  if (hasOnlyMslZip) return 'msl'
  const nonMslZipNames = zips
    .map((x) => baseName(x?.zipPath))
    .filter((name) => name && !/modelicastandardlibrary/i.test(name))
    .map((name) => name.replace(/\.zip$/i, ''))
  if (nonMslZipNames.length > 0) return sanitizeTag(nonMslZipNames.join('+'))
  const roots = Array.isArray(libraries?.libraryRoots) ? libraries.libraryRoots.filter(Boolean) : []
  const rootsLower = roots.map((x) => String(x).toLowerCase())
  const mslRoots = ['complex.mo', 'modelica', 'modelicareference', 'modelicaservices']
  if (rootsLower.length > 0 && rootsLower.every((x) => mslRoots.includes(x))) return 'msl'
  if (roots.length > 0) return sanitizeTag(roots.join('+'))
  const zipNames = zips.map((x) => baseName(x?.zipPath)).filter(Boolean)
  if (zipNames.length > 0) return sanitizeTag(zipNames.join('+'))
  return 'default'
}

function deriveLibraryTagFromRun(run) {
  return sanitizeTag(asString(run?.libraryTag) || deriveLibraryTagFromLibraries(run?.libraries))
}

function solverOptionsFromRun(run) {
  return tryParseJsonObject(run?.options?.solverOptionsJson)
}

function runtimeFamilyFromValue(value) {
  return normalizeRumocaRuntime(value) === 'native' ? 'native' : 'js'
}

function runtimeVariantForFamily(runtimeFamily, solverOptions) {
  if (runtimeFamily === 'native') {
    return sanitizeTag(
      asString(solverOptions?.solver || solverOptions?.solverName).trim() || 'auto',
    )
  }
  return sanitizeTag(
    asString(
      solverOptions?.timeIntegrator || solverOptions?.solver || solverOptions?.solverName,
    ).trim() || 'default',
  )
}

function runtimeProfileKeyForRun(run, overrideProfile = '') {
  const explicit = sanitizeTag(overrideProfile)
  if (explicit) return explicit
  const runtimeFamily = runtimeFamilyFromValue(run?.rumocaRuntime || run?.options?.rumocaRuntime)
  const solverOptions = solverOptionsFromRun(run)
  const variant = runtimeVariantForFamily(runtimeFamily, solverOptions)
  return `${runtimeFamily}.${variant}`
}

function profileFileTag(profileKey) {
  return sanitizeTag(profileKey).replaceAll('.', '_')
}

function defaultDiffPathsForLibraryAndProfile(libraryTag, profileKey) {
  const tag = sanitizeTag(libraryTag || 'default')
  const profileTag = profileFileTag(profileKey || 'unknown')
  return {
    diffFile: join(COMPARE_ARTIFACT_DIR, `diff_${tag}__${profileTag}.json`),
    diffCsvFile: join(COMPARE_ARTIFACT_DIR, `diff_${tag}__${profileTag}.csv`),
    publicDiffFile: join(PUBLIC_COMPARE_DIR, `diff_${tag}__${profileTag}.json`),
  }
}

function compileBehaviorOptionsForLibraryTag(libraryTag) {
  const tag = sanitizeTag(libraryTag || 'default')
  if (tag === 'powersystems') {
    return {
      allowNonParamEvaluateAnnotation: true,
      allowMultiWhenSingleAssign: false,
      reason:
        'PowerSystems uses Evaluate annotations on non-parameter record fields; ER053 remains strict',
    }
  }
  return {
    allowNonParamEvaluateAnnotation: false,
    allowMultiWhenSingleAssign: false,
    reason: 'strict-default',
  }
}

function defaultPathsForLibraryTag(libraryTag) {
  const tag = sanitizeTag(libraryTag || 'default')
  return {
    baselineFile: join(COMPARE_ARTIFACT_DIR, `baseline_${tag}.json`),
    candidateFile: join(COMPARE_ARTIFACT_DIR, `run_latest_${tag}.json`),
    diffFile: join(COMPARE_ARTIFACT_DIR, `diff_${tag}.json`),
    diffCsvFile: join(COMPARE_ARTIFACT_DIR, `diff_${tag}.csv`),
    publicDiffFile: join(PUBLIC_COMPARE_DIR, `diff_${tag}.json`),
  }
}

function artifactTagForRumocaRuntime(libraryTag, runtime) {
  const tag = sanitizeTag(libraryTag || 'default')
  return normalizeRumocaRuntime(runtime) === 'native' ? `${tag}_native` : tag
}

function inferLibraryTagFromCompareFilePath(path) {
  const name = baseName(path)
  const latest = /^run_latest_(.+)\.json$/i.exec(name)
  if (latest?.[1]) return sanitizeTag(latest[1])
  const baseline = /^baseline_(.+)\.json$/i.exec(name)
  if (baseline?.[1]) return sanitizeTag(baseline[1])
  return ''
}

function datedRunFileForLibraryTag(libraryTag, isoDate = new Date().toISOString()) {
  const tag = sanitizeTag(libraryTag || 'default')
  const stamp = isoDate.replaceAll(':', '-')
  return join(COMPARE_ARTIFACT_DIR, `run_${tag}_${stamp}.json`)
}

function deriveCompileRecord(record) {
  const r = asObj(record) ?? {}
  const status = asString(r.status) === 'compile_fail' ? 'compile_fail' : 'compiled'
  return {
    modelName: asString(r.modelName),
    status,
    elapsedMs: asNumber(r.elapsedMs),
    compileElapsedMs: asNumber(r.compileElapsedMs),
    error: asString(r.error),
  }
}

function deriveRuntimeRecord(record) {
  const r = asObj(record) ?? {}
  const status = asString(r.status)
  if (status !== 'compared' && status !== 'missing_channels' && status !== 'run_fail') return null
  return {
    modelName: asString(r.modelName),
    status,
    elapsedMs: asNumber(r.elapsedMs),
    maxDeviationPercent: asNumber(r.maxDeviationPercent),
    meanDeviationPercent: asNumber(r.meanDeviationPercent),
    badChannels: asNumber(r.badChannels),
    severeChannels: asNumber(r.severeChannels),
    comparedChannels: asNumber(r.comparedChannels),
    compileElapsedMs: asNumber(r.compileElapsedMs),
    omcElapsedMs: asNumber(r.omcElapsedMs),
    solverElapsedMs: asNumber(r.solverElapsedMs),
    compareElapsedMs: asNumber(r.compareElapsedMs),
    error: asString(r.error),
  }
}

function buildSection(records, projector) {
  const projected = []
  for (const raw of Array.isArray(records) ? records : []) {
    const item = projector(raw)
    if (!item) continue
    if (!item.modelName) continue
    projected.push(item)
  }
  return {
    updatedAt: new Date().toISOString(),
    records: projected,
    recordsByModel: Object.fromEntries(projected.map((x) => [x.modelName, x])),
  }
}

function asNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function hydrateSection(raw) {
  const obj = asObj(raw) ?? {}
  const records = Array.isArray(obj.records)
    ? obj.records.filter((x) => asString(x?.modelName))
    : []
  return {
    updatedAt: asString(obj.updatedAt) || new Date().toISOString(),
    records,
    recordsByModel: Object.fromEntries(records.map((x) => [x.modelName, x])),
  }
}

function persistableSection(raw) {
  const section = hydrateSection(raw)
  return {
    updatedAt: section.updatedAt,
    records: section.records,
  }
}

function stripModelName(record) {
  const obj = asObj(record) ?? {}
  const { modelName, ...rest } = obj
  void modelName
  return rest
}

function normalizeRuntimeModelRecord(raw) {
  const obj = asObj(raw) ?? {}
  const modelName = asString(obj.modelName)
  if (!modelName) return null
  const rawProfiles = asObj(obj.profiles) ?? asObj(obj.baselines) ?? {}
  const profiles = {}
  for (const [profileKey, value] of Object.entries(rawProfiles)) {
    const normalizedKey = sanitizeTag(profileKey)
    const profileRecord = asObj(value)
    if (!normalizedKey || !profileRecord) continue
    profiles[normalizedKey] = stripModelName(profileRecord)
  }
  return { modelName, profiles }
}

function runtimeProfileSectionFromEnvelope(envelope, profileKey) {
  const normalizedKey = sanitizeTag(profileKey)
  const records = []
  for (const entry of Array.isArray(envelope?.runtimeRecords) ? envelope.runtimeRecords : []) {
    const modelEntry = normalizeRuntimeModelRecord(entry)
    if (!modelEntry) continue
    const profileRecord = asObj(modelEntry.profiles?.[normalizedKey])
    if (!profileRecord) continue
    records.push({
      modelName: modelEntry.modelName,
      ...profileRecord,
    })
  }
  const section = hydrateSection({
    updatedAt: envelope?.runtimeProfiles?.[normalizedKey]?.updatedAt,
    records,
  })
  return {
    ...section,
    profileMeta: asObj(envelope?.runtimeProfiles?.[normalizedKey]) ?? null,
  }
}

function mergeRuntimeProfileRecords(existingRuntimeRecords, profileKey, profileRecords) {
  const normalizedKey = sanitizeTag(profileKey)
  const map = new Map()
  for (const rawEntry of Array.isArray(existingRuntimeRecords) ? existingRuntimeRecords : []) {
    const entry = normalizeRuntimeModelRecord(rawEntry)
    if (!entry) continue
    map.set(entry.modelName, entry)
  }
  for (const rawRecord of Array.isArray(profileRecords) ? profileRecords : []) {
    const record = asObj(rawRecord) ?? {}
    const modelName = asString(record.modelName)
    if (!modelName) continue
    const current = map.get(modelName) ?? { modelName, profiles: {} }
    current.profiles = {
      ...current.profiles,
      [normalizedKey]: stripModelName(record),
    }
    map.set(modelName, current)
  }
  return [...map.values()].sort((a, b) => a.modelName.localeCompare(b.modelName))
}

function buildRuntimeProfileMeta({ profileKey, run }) {
  const solverOptions = solverOptionsFromRun(run)
  const runtime = run?.rumocaRuntime || run?.options?.rumocaRuntime || 'template'
  return {
    profileKey,
    updatedAt: new Date().toISOString(),
    rumocaRuntime: normalizeRumocaRuntime(runtime),
    solverKey: runtimeVariantForFamily(runtimeFamilyFromValue(runtime), solverOptions),
    solverOptions,
    artifactTag: asString(run?.artifactTag),
    generatedAt: asString(run?.generatedAt || run?.updatedAt),
  }
}

function legacyBaselineEnvelope(raw, libraryTag) {
  const obj = asObj(raw) ?? {}
  const legacyCompileRecords = Array.isArray(obj.records)
    ? obj.records
    : Array.isArray(obj?.compile?.records)
      ? obj.compile.records
      : []
  const legacyRuntimeRecords = Array.isArray(obj.records)
    ? obj.records
    : Array.isArray(obj?.runtime?.records)
      ? obj.runtime.records
      : []
  const compile = buildSection(legacyCompileRecords, deriveCompileRecord)
  const runtimeSection = buildSection(legacyRuntimeRecords, deriveRuntimeRecord)
  const profileKey = 'js.default'
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    libraryTag,
    compile,
    runtimeProfiles:
      runtimeSection.records.length > 0
        ? {
            [profileKey]: {
              profileKey,
              updatedAt: runtimeSection.updatedAt,
              rumocaRuntime: 'template',
              solverKey: 'default',
              solverOptions: {},
              artifactTag: sanitizeTag(libraryTag),
              generatedAt: runtimeSection.updatedAt,
            },
          }
        : {},
    runtimeRecords: mergeRuntimeProfileRecords([], profileKey, runtimeSection.records),
  }
}

function ensureBaselineEnvelope(raw, libraryTag) {
  const obj = asObj(raw) ?? {}
  if (
    Array.isArray(obj.records) ||
    Array.isArray(obj?.runtime?.records) ||
    (asObj(obj.runtime) && !Array.isArray(obj.runtimeRecords))
  ) {
    return legacyBaselineEnvelope(raw, libraryTag)
  }
  return {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    libraryTag,
    compile: obj.compile ? hydrateSection(obj.compile) : null,
    runtimeProfiles: asObj(obj.runtimeProfiles) ?? {},
    runtimeRecords: Array.isArray(obj.runtimeRecords)
      ? obj.runtimeRecords.map((x) => normalizeRuntimeModelRecord(x)).filter(Boolean)
      : [],
  }
}

function diffModelRecords(baseRecord, candidateRecord) {
  return {
    modelName: asString(candidateRecord?.modelName || baseRecord?.modelName),
    statusBefore: asString(baseRecord?.status),
    statusAfter: asString(candidateRecord?.status),
    statusChanged: asString(baseRecord?.status) !== asString(candidateRecord?.status),
    elapsedMsBefore: asNumber(baseRecord?.elapsedMs),
    elapsedMsAfter: asNumber(candidateRecord?.elapsedMs),
    deltaMaxDeviationPercent:
      asNumber(candidateRecord?.maxDeviationPercent) - asNumber(baseRecord?.maxDeviationPercent),
    deltaMeanDeviationPercent:
      asNumber(candidateRecord?.meanDeviationPercent) - asNumber(baseRecord?.meanDeviationPercent),
    deltaElapsedMs: asNumber(candidateRecord?.elapsedMs) - asNumber(baseRecord?.elapsedMs),
    deltaBadChannels: asNumber(candidateRecord?.badChannels) - asNumber(baseRecord?.badChannels),
    deltaSevereChannels:
      asNumber(candidateRecord?.severeChannels) - asNumber(baseRecord?.severeChannels),
    deltaComparedChannels:
      asNumber(candidateRecord?.comparedChannels) - asNumber(baseRecord?.comparedChannels),
  }
}

function compareBaseline({ baseline, candidate, compareCompile = true, runtimeProfileKey = '' }) {
  const baselineCompile = compareCompile ? byModelName(baseline?.compile?.records) : new Map()
  const candidateCompile = compareCompile ? byModelName(candidate?.compile?.records) : new Map()
  const allCompileNames = [
    ...new Set([...baselineCompile.keys(), ...candidateCompile.keys()]),
  ].sort()
  const compileTransitions = allCompileNames.map((name) =>
    diffModelRecords(baselineCompile.get(name), candidateCompile.get(name)),
  )
  const runtimeProfile = sanitizeTag(runtimeProfileKey)
  const baselineRuntime = byModelName(
    candidate?.baselineRuntimeRecords || baseline?.runtime?.records,
  )
  const candidateRuntime = byModelName(candidate?.runtime?.records)
  const allRuntimeNames = [
    ...new Set([...baselineRuntime.keys(), ...candidateRuntime.keys()]),
  ].sort()
  const runtimeTransitions = allRuntimeNames.map((name) =>
    diffModelRecords(baselineRuntime.get(name), candidateRuntime.get(name)),
  )
  return {
    generatedAt: new Date().toISOString(),
    libraryTag: asString(candidate?.libraryTag || baseline?.libraryTag),
    runtimeProfileKey: runtimeProfile,
    totals: {
      modelsCompared: allCompileNames.length,
      addedModels: allCompileNames.filter((name) => !baselineCompile.has(name)).length,
      removedModels: allCompileNames.filter((name) => !candidateCompile.has(name)).length,
    },
    transitions: compileTransitions,
    runtimeTotals: {
      modelsCompared: allRuntimeNames.length,
      addedModels: allRuntimeNames.filter((name) => !baselineRuntime.has(name)).length,
      removedModels: allRuntimeNames.filter((name) => !candidateRuntime.has(name)).length,
      statusRegressions: runtimeTransitions.filter(
        (x) => x.statusBefore === 'compared' && x.statusAfter !== 'compared',
      ).length,
      statusImprovements: runtimeTransitions.filter(
        (x) => x.statusBefore !== 'compared' && x.statusAfter === 'compared',
      ).length,
      qualityRegressions: runtimeTransitions.filter((x) => x.deltaMaxDeviationPercent > 0).length,
      qualityImprovements: runtimeTransitions.filter((x) => x.deltaMaxDeviationPercent < 0).length,
    },
    runtimeTransitions,
    baselineProfileMeta: baseline?.runtimeProfileMeta ?? null,
    candidateProfileMeta: candidate?.runtimeProfileMeta ?? null,
  }
}

function toCsvCell(v) {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}

function toCsv(rows, header) {
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(header.map((key) => toCsvCell(row[key])).join(','))
  }
  return `${lines.join('\n')}\n`
}

function buildDiffAnalysis(
  diff,
  {
    candidateRun,
    baselineRun,
    baselineCompileRecords,
    baselineRuntimeRecords,
    baselineEnvelope,
    candidateEnvelope,
    compareCompile = true,
  } = {},
) {
  const compileTransitions = Array.isArray(diff?.transitions) ? diff.transitions : []
  const runtimeTransitions = Array.isArray(diff?.runtimeTransitions) ? diff.runtimeTransitions : []
  const allTransitions = [...compileTransitions, ...runtimeTransitions]
  const allModelNames = [
    ...new Set(allTransitions.map((t) => asString(t?.modelName)).filter(Boolean)),
  ].sort()

  const runtimeDeltaMax = runtimeTransitions
    .map((t) => asNumber(t.deltaMaxDeviationPercent))
    .sort((a, b) => a - b)
  const runtimeDeltaElapsed = runtimeTransitions
    .map((t) => asNumber(t.deltaElapsedMs))
    .sort((a, b) => a - b)
  const worsenedRuntime = runtimeTransitions.filter(
    (t) => asNumber(t.deltaMaxDeviationPercent) > 0,
  ).length
  const improvedRuntime = runtimeTransitions.filter(
    (t) => asNumber(t.deltaMaxDeviationPercent) < 0,
  ).length
  const compileSuccessRegressedModels = compileTransitions
    .filter(
      (t) => asString(t.statusBefore) === 'compiled' && asString(t.statusAfter) === 'compile_fail',
    )
    .map((t) => asString(t.modelName))
    .filter(Boolean)
    .sort()
  const compileSuccessImprovedModels = compileTransitions
    .filter(
      (t) => asString(t.statusBefore) === 'compile_fail' && asString(t.statusAfter) === 'compiled',
    )
    .map((t) => asString(t.modelName))
    .filter(Boolean)
    .sort()
  const compileTimeTransitions = compileTransitions.filter(
    (t) => asString(t.statusBefore) === 'compiled' && asString(t.statusAfter) === 'compiled',
  )
  const compileTimeRegressedModels = compileTimeTransitions
    .filter((t) => asNumber(t.deltaElapsedMs) > 0)
    .map((t) => asString(t.modelName))
    .filter(Boolean)
    .sort()
  const compileTimeImprovedModels = compileTimeTransitions
    .filter((t) => asNumber(t.deltaElapsedMs) < 0)
    .map((t) => asString(t.modelName))
    .filter(Boolean)
    .sort()
  const compileTimeRegressedDetails = compileTimeTransitions
    .filter((t) => asNumber(t.deltaElapsedMs) > 0)
    .map((t) => ({
      modelName: asString(t.modelName),
      previousElapsedMs: asNumber(t.elapsedMsBefore),
      currentElapsedMs: asNumber(t.elapsedMsAfter),
      deltaElapsedMs: asNumber(t.deltaElapsedMs),
    }))
    .sort((a, b) => b.deltaElapsedMs - a.deltaElapsedMs)
  const compileTimeDeltaElapsed = compileTimeTransitions
    .map((t) => asNumber(t.deltaElapsedMs))
    .sort((a, b) => a - b)
  const modelCount = allModelNames.length
  const compileCompared = compareCompile ? asNumber(diff?.totals?.modelsCompared) : 0
  const runtimeCompared = asNumber(diff?.runtimeTotals?.modelsCompared)
  const pct = (num, den) => (den > 0 ? (num / den) * 100 : 0)
  const baselinePerformanceRecords = buildBaselinePerformanceRecords({
    compileRecords: baselineCompileRecords,
    runtimeRecords: baselineRuntimeRecords,
  })

  return {
    summary: {
      generatedAt: new Date().toISOString(),
      libraryTag: asString(diff?.libraryTag),
      runtimeProfileKey: asString(diff?.runtimeProfileKey),
      modelCount,
      compileModelsCompared: compileCompared,
      runtimeModelsCompared: runtimeCompared,
      compileCoveragePercent: pct(compileCompared, modelCount),
      runtimeCoveragePercent: pct(runtimeCompared, modelCount),
      statusRegressions: asNumber(diff?.runtimeTotals?.statusRegressions),
      statusImprovements: asNumber(diff?.runtimeTotals?.statusImprovements),
      qualityRegressions: asNumber(diff?.runtimeTotals?.qualityRegressions),
      qualityImprovements: asNumber(diff?.runtimeTotals?.qualityImprovements),
      statusRegressionPercent: pct(
        asNumber(diff?.runtimeTotals?.statusRegressions),
        runtimeCompared,
      ),
      statusImprovementPercent: pct(
        asNumber(diff?.runtimeTotals?.statusImprovements),
        runtimeCompared,
      ),
      qualityRegressionPercent: pct(
        asNumber(diff?.runtimeTotals?.qualityRegressions),
        runtimeCompared,
      ),
      qualityImprovementPercent: pct(
        asNumber(diff?.runtimeTotals?.qualityImprovements),
        runtimeCompared,
      ),
      compileSuccessTransitions: {
        regressedCount: compileSuccessRegressedModels.length,
        improvedCount: compileSuccessImprovedModels.length,
        regressedPercent: pct(compileSuccessRegressedModels.length, compileCompared),
        improvedPercent: pct(compileSuccessImprovedModels.length, compileCompared),
      },
      compileTimeTransitions: {
        comparedCompiledToCompiledCount: compileTimeTransitions.length,
        regressedCount: compileTimeRegressedModels.length,
        improvedCount: compileTimeImprovedModels.length,
        regressedPercent: pct(compileTimeRegressedModels.length, compileTimeTransitions.length),
        improvedPercent: pct(compileTimeImprovedModels.length, compileTimeTransitions.length),
        deltaElapsedMs: {
          mean:
            compileTimeDeltaElapsed.length > 0
              ? compileTimeDeltaElapsed.reduce((acc, x) => acc + x, 0) /
                compileTimeDeltaElapsed.length
              : 0,
          median: percentile(compileTimeDeltaElapsed, 50),
          p95: percentile(compileTimeDeltaElapsed, 95),
          max:
            compileTimeDeltaElapsed.length > 0
              ? compileTimeDeltaElapsed[compileTimeDeltaElapsed.length - 1]
              : 0,
          min: compileTimeDeltaElapsed.length > 0 ? compileTimeDeltaElapsed[0] : 0,
        },
      },
      runtimeWorsenedCount: worsenedRuntime,
      runtimeImprovedCount: improvedRuntime,
      runtimeWorsenedPercent: pct(worsenedRuntime, runtimeCompared),
      runtimeImprovedPercent: pct(improvedRuntime, runtimeCompared),
      runtimeDeltaMaxDeviation: {
        mean:
          runtimeDeltaMax.length > 0
            ? runtimeDeltaMax.reduce((acc, x) => acc + x, 0) / runtimeDeltaMax.length
            : 0,
        median: percentile(runtimeDeltaMax, 50),
        p95: percentile(runtimeDeltaMax, 95),
        max: runtimeDeltaMax.length > 0 ? runtimeDeltaMax[runtimeDeltaMax.length - 1] : 0,
        min: runtimeDeltaMax.length > 0 ? runtimeDeltaMax[0] : 0,
      },
      runtimeDeltaElapsedMs: {
        mean:
          runtimeDeltaElapsed.length > 0
            ? runtimeDeltaElapsed.reduce((acc, x) => acc + x, 0) / runtimeDeltaElapsed.length
            : 0,
        median: percentile(runtimeDeltaElapsed, 50),
        p95: percentile(runtimeDeltaElapsed, 95),
        max:
          runtimeDeltaElapsed.length > 0 ? runtimeDeltaElapsed[runtimeDeltaElapsed.length - 1] : 0,
        min: runtimeDeltaElapsed.length > 0 ? runtimeDeltaElapsed[0] : 0,
      },
      candidatePerformance: computeRunPerformanceMetrics(candidateRun?.records),
      baselinePerformance: computeRunPerformanceMetrics(
        baselinePerformanceRecords.length > 0
          ? baselinePerformanceRecords
          : Array.isArray(baselineCompileRecords)
            ? baselineCompileRecords
            : baselineRun?.records,
      ),
      baselineProfileMeta: asObj(diff?.baselineProfileMeta) ?? null,
      candidateProfileMeta: asObj(diff?.candidateProfileMeta) ?? null,
      categoryBreakdown: buildCategoryBreakdown({
        baseline: baselineEnvelope,
        candidate: candidateEnvelope,
        runtimeProfileKey: asString(diff?.runtimeProfileKey),
        compareCompile,
      }),
    },
    detailed: {
      compileSuccessRegressedModels,
      compileSuccessImprovedModels,
      compileTimeRegressedModels,
      compileTimeImprovedModels,
      compileTimeRegressedDetails,
      addedModels: Array.isArray(diff?.runtimeAddedModels) ? diff.runtimeAddedModels : [],
      removedModels: Array.isArray(diff?.runtimeRemovedModels) ? diff.runtimeRemovedModels : [],
      compileTransitionCount: compileTransitions.length,
      runtimeTransitionCount: runtimeTransitions.length,
    },
  }
}

function statsFrom(values) {
  const xs = values
    .map((v) => asNumber(v))
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b)
  if (xs.length === 0) return { count: 0, total: 0, mean: 0, median: 0, p95: 0, min: 0, max: 0 }
  const total = xs.reduce((acc, x) => acc + x, 0)
  return {
    count: xs.length,
    total,
    mean: total / xs.length,
    median: percentile(xs, 50),
    p95: percentile(xs, 95),
    min: xs[0],
    max: xs[xs.length - 1],
  }
}

function computeRunPerformanceMetrics(records) {
  const rows = Array.isArray(records) ? records.map((r) => asObj(r) ?? {}) : []
  const totalModels = rows.length
  const compileSuccess = rows.filter((r) => asString(r.status) !== 'compile_fail').length
  const solveSuccess = rows.filter((r) => asString(r.status) === 'compared').length
  const runtimeAttempted = rows.filter((r) => {
    const s = asString(r.status)
    return s === 'compared' || s === 'missing_channels' || s === 'run_fail'
  }).length
  const totalElapsed = statsFrom(rows.map((r) => r.elapsedMs))
  const compileElapsed = statsFrom(rows.map((r) => r.compileElapsedMs))
  const omcElapsed = statsFrom(rows.map((r) => r.omcElapsedMs))
  const solverElapsed = statsFrom(rows.map((r) => r.solverElapsedMs))
  const compareElapsed = statsFrom(rows.map((r) => r.compareElapsedMs))
  const totalSeconds = totalElapsed.total / 1000
  const solvedPerMinute = totalSeconds > 0 ? (solveSuccess * 60) / totalSeconds : 0
  const compiledPerMinute = totalSeconds > 0 ? (compileSuccess * 60) / totalSeconds : 0
  const pct = (num, den) => (den > 0 ? (num / den) * 100 : 0)
  return {
    rates: {
      compileSuccessRatePercent: pct(compileSuccess, totalModels),
      solveSuccessRatePercent: pct(solveSuccess, runtimeAttempted),
      runtimeAttemptRatePercent: pct(runtimeAttempted, totalModels),
      compiledPerMinute,
      solvedPerMinute,
    },
    timeMs: {
      total: totalElapsed,
      compile: compileElapsed,
      omc: omcElapsed,
      solver: solverElapsed,
      compare: compareElapsed,
    },
    counters: {
      totalModels,
      compileSuccess,
      solveSuccess,
      runtimeAttempted,
    },
  }
}

function categoryFromModelName(modelName) {
  const parts = asString(modelName)
    .split('.')
    .map((x) => x.trim())
    .filter(Boolean)
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}`
  if (parts.length === 1) return parts[0]
  return 'unknown'
}

function isExampleModelName(modelName) {
  return asString(modelName).includes('.Examples.')
}

function buildBaselinePerformanceRecords({ compileRecords, runtimeRecords }) {
  const map = new Map()
  for (const raw of Array.isArray(compileRecords) ? compileRecords : []) {
    const record = asObj(raw) ?? {}
    const modelName = asString(record.modelName)
    if (!modelName) continue
    map.set(modelName, { ...record })
  }
  for (const raw of Array.isArray(runtimeRecords) ? runtimeRecords : []) {
    const record = asObj(raw) ?? {}
    const modelName = asString(record.modelName)
    if (!modelName) continue
    map.set(modelName, {
      ...(map.get(modelName) ?? { modelName, status: 'compiled' }),
      ...record,
      modelName,
    })
  }
  return [...map.values()]
}

function buildCategoryBreakdown({
  baseline,
  candidate,
  runtimeProfileKey = '',
  compareCompile = true,
}) {
  const baselineCompile = compareCompile ? byModelName(baseline?.compile?.records) : new Map()
  const candidateCompile = compareCompile ? byModelName(candidate?.compile?.records) : new Map()
  const baselineRuntime = byModelName(
    Array.isArray(candidate?.baselineRuntimeRecords)
      ? candidate.baselineRuntimeRecords
      : runtimeProfileSectionFromEnvelope(baseline, runtimeProfileKey).records,
  )
  const candidateRuntime = byModelName(candidate?.runtime?.records)
  const allCompileNames = [
    ...new Set([...baselineCompile.keys(), ...candidateCompile.keys()]),
  ].sort()
  const allRuntimeNames = [
    ...new Set([...baselineRuntime.keys(), ...candidateRuntime.keys()]),
  ].sort()
  const categories = new Map()
  const getCategoryRow = (modelName) => {
    const category = categoryFromModelName(modelName)
    if (!categories.has(category)) {
      categories.set(category, {
        category,
        compile: {
          modelsCompared: 0,
          baselineCompiled: 0,
          candidateCompiled: 0,
          baselineCompileRatePercent: 0,
          candidateCompileRatePercent: 0,
          deltaCompiledCount: 0,
          deltaCompileRatePercent: 0,
          statusImprovedCount: 0,
          statusRegressedCount: 0,
        },
        runtime: {
          modelsCompared: 0,
          baselineRuntimeAttempted: 0,
          candidateRuntimeAttempted: 0,
          baselineSolved: 0,
          candidateSolved: 0,
          baselineSolveRatePercent: 0,
          candidateSolveRatePercent: 0,
          deltaSolvedCount: 0,
          deltaSolveRatePercent: 0,
        },
        examples: {
          modelsCompared: 0,
          baselineCompiled: 0,
          candidateCompiled: 0,
          baselineCompileRatePercent: 0,
          candidateCompileRatePercent: 0,
          deltaCompiledCount: 0,
          deltaCompileRatePercent: 0,
        },
      })
    }
    return categories.get(category)
  }

  for (const modelName of allCompileNames) {
    const row = getCategoryRow(modelName)
    const before = baselineCompile.get(modelName)
    const after = candidateCompile.get(modelName)
    const beforeCompiled = asString(before?.status) === 'compiled'
    const afterCompiled = asString(after?.status) === 'compiled'
    row.compile.modelsCompared += 1
    if (beforeCompiled) row.compile.baselineCompiled += 1
    if (afterCompiled) row.compile.candidateCompiled += 1
    if (!beforeCompiled && afterCompiled) row.compile.statusImprovedCount += 1
    if (beforeCompiled && !afterCompiled) row.compile.statusRegressedCount += 1
    if (isExampleModelName(modelName)) {
      row.examples.modelsCompared += 1
      if (beforeCompiled) row.examples.baselineCompiled += 1
      if (afterCompiled) row.examples.candidateCompiled += 1
    }
  }

  for (const modelName of allRuntimeNames) {
    const row = getCategoryRow(modelName)
    const before = baselineRuntime.get(modelName)
    const after = candidateRuntime.get(modelName)
    const beforeStatus = asString(before?.status)
    const afterStatus = asString(after?.status)
    const beforeAttempted =
      beforeStatus === 'compared' ||
      beforeStatus === 'missing_channels' ||
      beforeStatus === 'run_fail'
    const afterAttempted =
      afterStatus === 'compared' || afterStatus === 'missing_channels' || afterStatus === 'run_fail'
    const beforeSolved = beforeStatus === 'compared'
    const afterSolved = afterStatus === 'compared'
    row.runtime.modelsCompared += 1
    if (beforeAttempted) row.runtime.baselineRuntimeAttempted += 1
    if (afterAttempted) row.runtime.candidateRuntimeAttempted += 1
    if (beforeSolved) row.runtime.baselineSolved += 1
    if (afterSolved) row.runtime.candidateSolved += 1
  }

  const pct = (num, den) => (den > 0 ? (num / den) * 100 : 0)
  const rows = [...categories.values()]
  for (const row of rows) {
    row.compile.baselineCompileRatePercent = pct(
      row.compile.baselineCompiled,
      row.compile.modelsCompared,
    )
    row.compile.candidateCompileRatePercent = pct(
      row.compile.candidateCompiled,
      row.compile.modelsCompared,
    )
    row.compile.deltaCompiledCount = row.compile.candidateCompiled - row.compile.baselineCompiled
    row.compile.deltaCompileRatePercent =
      row.compile.candidateCompileRatePercent - row.compile.baselineCompileRatePercent
    row.runtime.baselineSolveRatePercent = pct(
      row.runtime.baselineSolved,
      row.runtime.baselineRuntimeAttempted,
    )
    row.runtime.candidateSolveRatePercent = pct(
      row.runtime.candidateSolved,
      row.runtime.candidateRuntimeAttempted,
    )
    row.runtime.deltaSolvedCount = row.runtime.candidateSolved - row.runtime.baselineSolved
    row.runtime.deltaSolveRatePercent =
      row.runtime.candidateSolveRatePercent - row.runtime.baselineSolveRatePercent
    row.examples.baselineCompileRatePercent = pct(
      row.examples.baselineCompiled,
      row.examples.modelsCompared,
    )
    row.examples.candidateCompileRatePercent = pct(
      row.examples.candidateCompiled,
      row.examples.modelsCompared,
    )
    row.examples.deltaCompiledCount = row.examples.candidateCompiled - row.examples.baselineCompiled
    row.examples.deltaCompileRatePercent =
      row.examples.candidateCompileRatePercent - row.examples.baselineCompileRatePercent
  }
  rows.sort((a, b) => {
    const byCount = b.compile.modelsCompared - a.compile.modelsCompared
    if (byCount !== 0) return byCount
    return a.category.localeCompare(b.category)
  })
  return rows
}

function buildPublicDiffPayload({
  diff,
  analysis,
  baselineFile,
  candidateFile,
  diffFile,
  diffCsvFile,
}) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    libraryTag: asString(diff?.libraryTag),
    runtimeProfileKey: asString(diff?.runtimeProfileKey),
    references: {
      baselineFile,
      candidateFile,
      diffFile,
      diffCsvFile,
    },
    baselineProfileMeta: asObj(diff?.baselineProfileMeta) ?? null,
    candidateProfileMeta: asObj(diff?.candidateProfileMeta) ?? null,
    summary: analysis.summary,
    detailed: analysis.detailed,
  }
}

function buildCandidateEnvelope({ candidateRun, libraryTag, runtimeProfileKey, includeCompile }) {
  return {
    libraryTag,
    compile: includeCompile ? buildSection(candidateRun?.records, deriveCompileRecord) : null,
    runtime: buildSection(candidateRun?.records, deriveRuntimeRecord),
    runtimeProfileMeta: buildRuntimeProfileMeta({
      profileKey: runtimeProfileKey,
      run: candidateRun,
    }),
  }
}

async function listLatestRunFilesForDiff() {
  await ensureDir(COMPARE_ARTIFACT_DIR)
  const entries = await readdir(COMPARE_ARTIFACT_DIR, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /^run_latest_.*\.json$/i.test(entry.name))
    .map((entry) => join(COMPARE_ARTIFACT_DIR, entry.name))
    .filter((file) => baseName(file) !== baseName(DEFAULT_RUN_JSON_FILE))
    .sort()
}

async function runBaselineDiff(options) {
  const preferredCandidate = options.candidateFile || (await pickNewestRunLatestFile())
  const fallbackCandidate = DEFAULT_RUN_JSON_FILE
  let candidateFileInput = preferredCandidate
  if (!candidateFileInput || !(await fileExists(candidateFileInput))) {
    if (await fileExists(fallbackCandidate)) {
      candidateFileInput = fallbackCandidate
    }
  }
  if (!candidateFileInput || !(await fileExists(candidateFileInput))) {
    const baselineFallback = options.baselineFile || DEFAULT_BASELINE_FILE
    if (await fileExists(baselineFallback)) {
      candidateFileInput = baselineFallback
    } else {
      throw new Error('No candidate run file found and no baseline file available for fallback')
    }
  }
  const candidateRaw = await readJsonFile(candidateFileInput)
  const libraryTag =
    deriveLibraryTagFromRun(candidateRaw) || inferLibraryTagFromCompareFilePath(candidateFileInput)
  const runtimeProfileKey = runtimeProfileKeyForRun(candidateRaw, options.baselineProfile)
  const compareCompile = runtimeProfileKey.startsWith('js.')
  const defaults = defaultPathsForLibraryTag(libraryTag)
  const diffDefaults = defaultDiffPathsForLibraryAndProfile(libraryTag, runtimeProfileKey)
  const baselineFile = options.baselineFile || defaults.baselineFile
  const diffFile = options.diffFile || diffDefaults.diffFile
  const diffCsvFile = options.diffCsvFile || diffDefaults.diffCsvFile
  const publicDiffFile =
    options.publicDiffFile || diffDefaults.publicDiffFile || DEFAULT_PUBLIC_DIFF_FILE
  const baselineRaw = (await fileExists(baselineFile)) ? await readJsonFile(baselineFile) : {}
  const baseline = ensureBaselineEnvelope(baselineRaw, libraryTag)
  const baselineRuntimeSection = runtimeProfileSectionFromEnvelope(baseline, runtimeProfileKey)
  const candidate = buildCandidateEnvelope({
    candidateRun: candidateRaw,
    libraryTag,
    runtimeProfileKey,
    includeCompile: compareCompile,
  })
  candidate.baselineRuntimeRecords = baselineRuntimeSection.records
  const diff = compareBaseline({
    baseline: {
      ...baseline,
      runtime: baselineRuntimeSection,
      runtimeProfileMeta: baselineRuntimeSection.profileMeta,
    },
    candidate,
    compareCompile,
    runtimeProfileKey,
  })
  const analysis = buildDiffAnalysis(diff, {
    candidateRun: candidateRaw,
    baselineRun: baselineRaw,
    baselineCompileRecords: baseline?.compile?.records,
    baselineRuntimeRecords: baselineRuntimeSection.records,
    baselineEnvelope: baseline,
    candidateEnvelope: candidate,
    compareCompile,
  })
  await writeJsonFile(diffFile, diff)
  const csvSource = diff.runtimeTransitions.length > 0 ? diff.runtimeTransitions : diff.transitions
  const csvRows = csvSource.map((x) => ({
    model_name: x.modelName,
    status_before: x.statusBefore,
    status_after: x.statusAfter,
    status_changed: x.statusChanged ? 'yes' : 'no',
    delta_max_deviation_percent: x.deltaMaxDeviationPercent,
    delta_mean_deviation_percent: x.deltaMeanDeviationPercent,
    delta_elapsed_ms: x.deltaElapsedMs,
    delta_bad_channels: x.deltaBadChannels,
    delta_severe_channels: x.deltaSevereChannels,
    delta_compared_channels: x.deltaComparedChannels,
  }))
  await ensureDir(dirname(diffCsvFile))
  await writeFile(
    diffCsvFile,
    toCsv(csvRows, [
      'model_name',
      'status_before',
      'status_after',
      'status_changed',
      'delta_max_deviation_percent',
      'delta_mean_deviation_percent',
      'delta_elapsed_ms',
      'delta_bad_channels',
      'delta_severe_channels',
      'delta_compared_channels',
    ]),
    'utf8',
  )
  const publicPayload = buildPublicDiffPayload({
    diff,
    analysis,
    baselineFile,
    candidateFile: candidateFileInput,
    diffFile,
    diffCsvFile,
  })
  await writeJsonFile(publicDiffFile, publicPayload)
  return {
    diff,
    analysis,
    baselineFile,
    diffFile,
    diffCsvFile,
    publicDiffFile,
    candidateFile: candidateFileInput,
    candidateMeta: {
      generatedAt: asString(candidateRaw?.generatedAt || candidateRaw?.updatedAt),
      libraryTag,
      runtimeProfileKey,
      totalModels: asNumber(candidateRaw?.summary?.total),
    },
    baselineProfileMeta: baselineRuntimeSection.profileMeta,
  }
}

function shouldRunBaselineDiffAll(options) {
  return (
    !options.baselineFile &&
    !options.baselineProfile &&
    !options.candidateFile &&
    !options.diffFile &&
    !options.diffCsvFile &&
    !options.publicDiffFile
  )
}

async function runBaselineDiffAll(options) {
  const candidateFiles = await listLatestRunFilesForDiff()
  if (candidateFiles.length === 0) {
    throw new Error('No latest run files found in compare artifacts directory')
  }
  const results = []
  for (const candidateFile of candidateFiles) {
    const result = await runBaselineDiff({
      ...options,
      candidateFile,
    })
    results.push(result)
  }
  return results
}

async function runBaselineUpdate(options) {
  const candidateFileInput = options.candidateFile || DEFAULT_RUN_JSON_FILE
  const candidate = await readJsonFile(candidateFileInput)
  const libraryTag =
    deriveLibraryTagFromRun(candidate) || inferLibraryTagFromCompareFilePath(candidateFileInput)
  const runtimeProfileKey = runtimeProfileKeyForRun(candidate, options.baselineProfile)
  const defaults = defaultPathsForLibraryTag(libraryTag)
  const baselineFile = options.baselineFile || defaults.baselineFile
  const baselineRaw = (await fileExists(baselineFile)) ? await readJsonFile(baselineFile) : {}
  const existing = ensureBaselineEnvelope(baselineRaw, libraryTag)
  const isJsRuntime = runtimeProfileKey.startsWith('js.')
  const merged = {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    libraryTag,
    compile: existing.compile ? persistableSection(existing.compile) : null,
    runtimeProfiles: {
      ...(asObj(existing.runtimeProfiles) ?? {}),
    },
    runtimeRecords: existing.runtimeRecords,
  }
  const isCompileOnly = Boolean(candidate?.options?.compileOnly)
  if (isJsRuntime) {
    merged.compile = persistableSection(buildSection(candidate.records, deriveCompileRecord))
  }
  if (!isCompileOnly) {
    const runtimeSection = buildSection(candidate.records, deriveRuntimeRecord)
    merged.runtimeProfiles[runtimeProfileKey] = buildRuntimeProfileMeta({
      profileKey: runtimeProfileKey,
      run: candidate,
    })
    merged.runtimeRecords = mergeRuntimeProfileRecords(
      existing.runtimeRecords,
      runtimeProfileKey,
      runtimeSection.records,
    )
  }
  await writeJsonFile(baselineFile, merged)
  return {
    baselineFile,
    candidateFile: candidateFileInput,
    runtimeProfileKey,
    models: Array.isArray(candidate?.records) ? candidate.records.length : 0,
    updatedSections: isCompileOnly
      ? isJsRuntime
        ? ['compile']
        : []
      : isJsRuntime
        ? ['compile', 'runtime']
        : ['runtime'],
    updatedAt: new Date().toISOString(),
  }
}

async function promptBaselineFileSelection() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return ''
  const entries = await readdir(COMPARE_ARTIFACT_DIR, { withFileTypes: true }).catch(() => [])
  const baselineFiles = entries
    .filter((entry) => entry.isFile() && /^baseline_.*\.json$/i.test(entry.name))
    .map((entry) => join(COMPARE_ARTIFACT_DIR, entry.name))
    .sort()
  if (baselineFiles.length === 0) return ''

  console.log('Select baseline file to update:')
  console.log('  0) Auto (default behavior)')
  for (let idx = 0; idx < baselineFiles.length; idx += 1) {
    const rel = baselineFiles[idx].replace(`${PROJECT_ROOT}/`, '')
    console.log(`  ${idx + 1}) ${rel}`)
  }

  const rl = readline.createInterface({ input, output })
  try {
    const answer = String(await rl.question('Choice [0]: ')).trim()
    if (!answer || answer === '0') return ''
    const picked = Number(answer)
    if (Number.isInteger(picked) && picked >= 1 && picked <= baselineFiles.length) {
      return baselineFiles[picked - 1]
    }
    console.log(`[modelica_compare_cli] Invalid choice '${answer}', using auto mode.`)
    return ''
  } finally {
    rl.close()
  }
}

async function runComparison(options) {
  options.rumocaRuntime = normalizeRumocaRuntime(options.rumocaRuntime)
  if (options.mode !== 'full' && options.mode !== 'random-stop') {
    throw new Error(`Unsupported --mode ${options.mode}`)
  }
  const runId = `run_${Date.now()}_${options.seed}`
  logInfo(`Starting compare run id=${runId}`)
  logInfo(
    `Config mode=${options.mode} seed=${options.seed} maxModels=${options.maxModels || 0} stopThreshold=${options.stopThresholdPercent}% alwaysContinue=${options.alwaysContinue ? 'yes' : 'no'} compileOnly=${options.compileOnly ? 'yes' : 'no'} rumocaRuntime=${options.rumocaRuntime}`,
  )
  logInfo(
    `Config sim t0=${options.t0} tf=${options.tf} dt=${options.dt} omcTimeoutMs=${options.omcTimeoutMs} solverTimeoutMs=${options.solverTimeoutMs} omcMaxCsvBytes=${options.omcMaxCsvBytes}`,
  )
  logInfo(`Path mslZip=${resolve(options.mslZip)}`)
  logInfo(`Path libraryZips=${options.libraryZips.map((x) => resolve(x)).join(', ') || '(none)'}`)
  logInfo(`Path omcWrapper=${resolve(options.omcWrapper)}`)
  if (options.rumocaRuntime === 'native' && Math.abs(Number(options.t0) || 0) > 1e-12) {
    throw new Error('native Rumoca wasm comparison currently supports only --t0 0')
  }

  const init = await initRumocaEngine()
  const libraries = await loadLibrariesFromZips([options.mslZip, ...options.libraryZips])
  const libraryTag = deriveLibraryTagFromLibraries(libraries)
  const compileBehaviorOptions = compileBehaviorOptionsForLibraryTag(libraryTag)
  options.compileOptionsJson = JSON.stringify({
    allowNonParamEvaluateAnnotation: Boolean(
      compileBehaviorOptions.allowNonParamEvaluateAnnotation,
    ),
    allowMultiWhenSingleAssign: Boolean(compileBehaviorOptions.allowMultiWhenSingleAssign),
  })
  logInfo(
    `Compile behavior options for '${libraryTag}': ${options.compileOptionsJson} (${compileBehaviorOptions.reason})`,
  )
  const artifactTag = artifactTagForRumocaRuntime(libraryTag, options.rumocaRuntime)
  const defaultPaths = defaultPathsForLibraryTag(artifactTag)
  const candidateFile = options.candidateFile || defaultPaths.candidateFile
  const mslZipResolved = resolve(options.mslZip)
  const additionalZipRoots = options.libraryZips
    .map((x) => resolve(x))
    .filter((zipPath) => zipPath !== mslZipResolved)
    .flatMap((zipPath) => libraries.rootsByZipPath?.[zipPath] ?? [])
  const preferredTargetRoots = [...new Set(additionalZipRoots)].sort()

  const solverSource = await readFile(resolve(options.solverFile), 'utf8')
  const listClassesRaw = rumoca.list_classes()
  const knownClassNames = collectKnownClassNames(listClassesRaw)
  const knownClassInfoByName = collectKnownClassInfoByName(listClassesRaw)
  const rawTargets = await loadTargetModels({
    modelName: options.modelName,
    libraryRoots: preferredTargetRoots.length > 0 ? preferredTargetRoots : libraries.libraryRoots,
    knownClassNames,
  })
  const targetPrefixes = String(options.targetPrefixesCsv || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  if (String(options.modelName || '').trim()) {
    if (!knownClassNames.has(options.modelName)) {
      throw new Error(`Requested --model not found in loaded classes: ${options.modelName}`)
    }
  }
  const shouldDiscoverFromPrefixes =
    targetPrefixes.length > 0 && !String(options.modelName || '').trim()
  let allTargets = shouldDiscoverFromPrefixes
    ? [...knownClassNames]
    : rawTargets.filter((name) => knownClassNames.has(name))
  if (targetPrefixes.length > 0 && !String(options.modelName || '').trim()) {
    allTargets = allTargets.filter((name) =>
      targetPrefixes.some((prefix) => name.startsWith(prefix)),
    )
  }
  const targetClassTypes = String(options.targetClassTypesCsv || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
  const defaultCompareClassTypes =
    !options.compileOnly &&
    targetClassTypes.length === 0 &&
    !String(options.modelName || '').trim() &&
    targetPrefixes.length === 0
      ? ['model', 'block', 'class']
      : []
  const defaultCompileOnlyClassTypes =
    options.compileOnly && targetClassTypes.length === 0 && !String(options.modelName || '').trim()
      ? ['model', 'block']
      : []
  const effectiveTargetClassTypes =
    targetClassTypes.length > 0
      ? targetClassTypes
      : defaultCompareClassTypes.length > 0
        ? defaultCompareClassTypes
        : defaultCompileOnlyClassTypes
  if (effectiveTargetClassTypes.length > 0) {
    allTargets = allTargets.filter((name) => {
      const info = knownClassInfoByName.get(name)
      const classType = String(info?.classType || '').toLowerCase()
      return effectiveTargetClassTypes.includes(classType)
    })
  }
  const skippedTargets = rawTargets.length - allTargets.length
  if (skippedTargets > 0) {
    const missing = rawTargets.filter((name) => !knownClassNames.has(name))
    logInfo(`Skipped ${skippedTargets} missing targets (not found in loaded classes)`)
    logInfo(`Missing targets sample: ${missing.slice(0, 10).join(', ')}`)
  }
  const targets =
    options.mode === 'random-stop'
      ? shuffled(allTargets, options.seed).slice(
          0,
          options.maxModels > 0 ? options.maxModels : allTargets.length,
        )
      : options.maxModels > 0
        ? allTargets.slice(0, options.maxModels)
        : allTargets
  logInfo(
    `Selection mode=${options.mode} seed=${options.seed} totalTargets=${allTargets.length} selected=${targets.length}`,
  )
  if (effectiveTargetClassTypes.length > 0) {
    logInfo(`Selection class types: ${effectiveTargetClassTypes.join(', ')}`)
  }
  if (options.mode === 'random-stop') {
    logInfo('Deterministic random selection active (override with --seed <n>)')
  }
  logInfo(`Selected targets sample: ${targets.slice(0, 10).join(', ')}`)
  if (preferredTargetRoots.length > 0) {
    logInfo(`Target roots constrained to additional libraries: ${preferredTargetRoots.join(', ')}`)
  }
  const progressPath = join(RUN_CACHE_DIR, 'latest_run.json')

  const records = []
  let stoppedAtModel = ''
  let debugPath = ''
  let alwaysContinue = Boolean(options.alwaysContinue)
  const stopOnFailure = options.mode === 'random-stop' && !alwaysContinue
  if (options.compileOnly && Number(options.compileWorkers) > 1) {
    logInfo(`Compile-only worker pool enabled: workers=${Number(options.compileWorkers)}`)
    const workerCount = Math.min(Number(options.compileWorkers), Math.max(1, targets.length))
    const workers = []
    try {
      for (let i = 0; i < workerCount; i += 1) {
        const child = await spawnCompileWorkerProcess(options)
        workers.push(child)
      }
      let nextTargetIndex = 0
      const active = new Map()
      const launch = (child) => {
        if (nextTargetIndex >= targets.length) return
        const modelName = targets[nextTargetIndex]
        nextTargetIndex += 1
        process.stdout.write(`[${nextTargetIndex}/${targets.length}] ${modelName}\n`)
        logInfo(`[${modelName}] Compile-only mode: validating Rumoca compile`)
        const run = runCompileOnWorker({
          child,
          modelName,
          compileTimeoutMs: Number(options.compileTimeoutMs),
        })
          .then((payload) => ({ ok: true, child, payload }))
          .catch((error) => ({ ok: false, child, modelName, error }))
        active.set(child, run)
      }
      for (const child of workers) launch(child)
      while (active.size > 0) {
        const finished = await Promise.race(active.values())
        active.delete(finished.child)
        if (!finished.ok) {
          const message =
            finished.error instanceof Error ? finished.error.message : String(finished.error)
          logInfo(`[${finished.modelName}] Failure captured: ${message}`)
          records.push({
            modelName: finished.modelName,
            status: 'compile_fail',
            elapsedMs: Number(options.compileTimeoutMs),
            error: message,
          })
          if (stopOnFailure) {
            stoppedAtModel = finished.modelName
            break
          }
          try {
            const replacement = await spawnCompileWorkerProcess(options)
            const idx = workers.indexOf(finished.child)
            if (idx >= 0) workers[idx] = replacement
            launch(replacement)
          } catch {
            // If worker respawn fails, continue draining other active workers and preserve failures.
          }
          logInfo(`[${finished.modelName}] Writing progress snapshot -> ${progressPath}`)
          await saveProgress(progressPath, {
            startedAt: records[0]?.startedAt || null,
            updatedAt: new Date().toISOString(),
            init,
            libraries,
            options,
            summary: recordSummary(records),
            records,
          })
          continue
        }
        const { modelName, elapsedMs, result } = finished.payload
        if (result.status !== 'compiled') {
          const message = asString(result.error) || `compile probe failed for ${modelName}`
          logInfo(`[${modelName}] Failure captured: ${message}`)
          records.push({
            modelName,
            status: 'compile_fail',
            elapsedMs: Number(elapsedMs) || 0,
            error: message,
          })
          if (stopOnFailure) {
            stoppedAtModel = modelName
            break
          }
          launch(finished.child)
          logInfo(`[${modelName}] Writing progress snapshot -> ${progressPath}`)
          await saveProgress(progressPath, {
            startedAt: records[0]?.startedAt || null,
            updatedAt: new Date().toISOString(),
            init,
            libraries,
            options,
            summary: recordSummary(records),
            records,
          })
          continue
        }
        const compileElapsedMs = Number(result?.planStats?.[0]?.elapsedMs || elapsedMs || 0)
        if (compileElapsedMs > Number(options.compileTimeoutMs)) {
          const message = `compile timeout after ${options.compileTimeoutMs}ms for ${modelName}`
          logInfo(`[${modelName}] Failure captured: ${message}`)
          records.push({
            modelName,
            status: 'compile_fail',
            elapsedMs: Number(elapsedMs) || compileElapsedMs,
            error: message,
          })
          if (stopOnFailure) {
            stoppedAtModel = modelName
            break
          }
          launch(finished.child)
          logInfo(`[${modelName}] Writing progress snapshot -> ${progressPath}`)
          await saveProgress(progressPath, {
            startedAt: records[0]?.startedAt || null,
            updatedAt: new Date().toISOString(),
            init,
            libraries,
            options,
            summary: recordSummary(records),
            records,
          })
          continue
        }
        records.push({
          modelName,
          status: 'compiled',
          elapsedMs: Number(elapsedMs) || compileElapsedMs,
          compileElapsedMs,
        })
        logInfo(`[${modelName}] Compile-only success`)
        launch(finished.child)
        logInfo(`[${modelName}] Writing progress snapshot -> ${progressPath}`)
        await saveProgress(progressPath, {
          startedAt: records[0]?.startedAt || null,
          updatedAt: new Date().toISOString(),
          init,
          libraries,
          options,
          summary: recordSummary(records),
          records,
        })
      }
    } finally {
      for (const child of workers) {
        try {
          child.kill('SIGKILL')
        } catch (error) {
          void error
        }
      }
    }
    const summary = {
      init,
      libraries,
      mode: options.mode,
      seed: options.seed,
      thresholdPercent: options.stopThresholdPercent,
      stoppedAtModel: stoppedAtModel || null,
      debugPath: debugPath || null,
      summary: recordSummary(records),
      records,
      progressPath,
      omcCacheDir: OMC_CACHE_DIR,
      cliLogs: RUN_LOG_BUFFER.slice(),
      libraryTag,
      artifactTag,
      rumocaRuntime: options.rumocaRuntime,
    }
    await saveProgress(progressPath, summary)
    const datedRunFile = datedRunFileForLibraryTag(artifactTag, new Date().toISOString())
    await writeJsonFile(candidateFile, summary)
    await writeJsonFile(datedRunFile, summary)
    if (
      options.rumocaRuntime !== 'native' &&
      resolve(candidateFile) !== resolve(DEFAULT_RUN_JSON_FILE)
    )
      await writeJsonFile(DEFAULT_RUN_JSON_FILE, summary)
    summary.candidateFile = candidateFile
    summary.datedRunFile = datedRunFile
    return summary
  }
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
      if (options.compileOnly) {
        const compileStartedAt = Date.now()
        logInfo(`[${modelName}] Compile-only mode: validating Rumoca compile`)
        const probe = await Promise.resolve(compileCurrentModelInLoadedSession(modelName, options))
        if (options.compileDebug && Array.isArray(probe.planStats)) {
          for (const stat of probe.planStats) {
            const base = `[${modelName}] compile-debug ${stat.label} => ${stat.result} in ${Number(stat.elapsedMs) || 0}ms`
            if (stat.error) {
              logInfo(`${base}; error=${stat.error}`)
            } else if (stat.daePreparedStatus || stat.daePreparedError) {
              logInfo(
                `${base}; dae_prepared_status=${stat.daePreparedStatus || 'n/a'}; dae_prepared_error=${stat.daePreparedError || 'n/a'}`,
              )
            } else if (stat.compilePhaseTiming) {
              const p = stat.compilePhaseTiming
              const fmt = (k) => {
                const calls = Number(p?.[k]?.calls || 0)
                const ms = Number(p?.[k]?.total_ms || 0)
                return `${k}=${ms.toFixed(1)}ms(calls=${calls})`
              }
              logInfo(
                `${base}; phases ${fmt('instantiate')} ${fmt('typecheck')} ${fmt('flatten')} ${fmt('todae')}`,
              )
              if (stat.compileCheckTiming) {
                const t = stat.compileCheckTiming
                logInfo(
                  `[${modelName}] compile-debug check-timing load=${Number(t.load_source_roots_ms) || 0}ms update=${Number(t.update_document_ms) || 0}ms qualify=${Number(t.qualify_model_ms) || 0}ms check=${Number(t.check_model_ms) || 0}ms total=${Number(t.total_ms) || 0}ms`,
                )
                const s = asObj(t.strict) ?? null
                if (s) {
                  logInfo(
                    `[${modelName}] compile-debug strict-check build_resolved=${Number(s.build_resolved_ms) || 0}ms reachable_closure=${Number(s.reachable_closure_ms) || 0}ms parse_failures=${Number(s.collect_parse_failures_ms) || 0}ms resolve_failures=${Number(s.collect_resolve_failures_ms) || 0}ms dae_query=${Number(s.dae_phase_query_ms) || 0}ms strict_total=${Number(s.total_ms) || 0}ms`,
                  )
                }
              }
            } else {
              logInfo(base)
            }
          }
        }
        if (probe.status !== 'compiled') {
          throw new Error(probe.error || `compile probe failed for ${modelName}`)
        }
        const measuredCompileMs = Number(
          probe?.planStats?.[0]?.elapsedMs || Date.now() - compileStartedAt,
        )
        if (measuredCompileMs > Number(options.compileTimeoutMs)) {
          throw new Error(`compile timeout after ${options.compileTimeoutMs}ms for ${modelName}`)
        }
        records.push({
          modelName,
          status: 'compiled',
          elapsedMs: Date.now() - startedAt,
          compileElapsedMs: Date.now() - compileStartedAt,
        })
        logInfo(`[${modelName}] Compile-only success`)
        continue
      }
      const classInfo = parseJson(rumoca.get_class_info(modelName))
      sourceModelica = asString(classInfo?.source_modelica)
      if (!sourceModelica.trim()) {
        records.push({ modelName, status: 'compile_fail', error: 'missing source_modelica' })
        continue
      }

      const omcStart = Date.now()
      let omcRun = null
      let omcError = ''
      logInfo(`[${modelName}] Step 1/4 running OMC reference simulation`)
      try {
        omcRun = await loadOrCreateOmcTrace({
          modelName,
          sim: { t0: options.t0, tf: options.tf, dt: options.dt },
          omcWrapper: resolve(options.omcWrapper),
          omcMslDir: resolve(options.omcMslDir),
          omcTimeoutMs: Number(options.omcTimeoutMs),
          omcMaxCsvBytes: Number(options.omcMaxCsvBytes),
        })
        logInfo(
          `[${modelName}] OMC done in ${Date.now() - omcStart}ms (cache=${omcRun.fromCache ? 'hit' : 'miss'}) -> ${omcRun.cachePath}`,
        )
      } catch (error) {
        omcError = error instanceof Error ? error.message : String(error)
        logInfo(`[${modelName}] OMC failed but continuing to solver stage: ${omcError}`)
      }
      const omcElapsedMs = Date.now() - omcStart

      const solverStart = Date.now()
      logInfo(
        `[${modelName}] Step 2/4 running Rumoca ${options.rumocaRuntime === 'native' ? 'native wasm' : 'template-based'} simulation`,
      )
      let solverRun = null
      try {
        solverRun = await runSolverProbeInSubprocess({
          modelName,
          mslZip: options.mslZip,
          libraryZips: options.libraryZips,
          solverTimeoutMs: Number(options.solverTimeoutMs),
          solverFile: options.solverFile,
          templateFile: options.templateFile,
          t0: options.t0,
          tf: options.tf,
          dt: options.dt,
          solverOptionsJson: options.solverOptionsJson,
          rumocaRuntime: options.rumocaRuntime,
        })
      } catch (subprocessError) {
        const msg =
          subprocessError instanceof Error ? subprocessError.message : String(subprocessError)
        if (isSolverTimeoutError(subprocessError)) {
          throw subprocessError
        }
        logInfo(`[${modelName}] Solver subprocess failed (${msg}); retrying in-process`)
        solverRun = await runSolverProbeInProcess({
          modelName,
          mslZip: options.mslZip,
          libraryZips: options.libraryZips,
          solverFile: options.solverFile,
          templateFile: options.templateFile,
          t0: options.t0,
          tf: options.tf,
          dt: options.dt,
          solverOptionsJson: options.solverOptionsJson,
          rumocaRuntime: options.rumocaRuntime,
        })
      }
      if (asString(solverRun?.status) !== 'ok') {
        renderedJs = asString(solverRun?.renderedJs || '')
        throw new Error(asString(solverRun?.error) || `solver run failed for ${modelName}`)
      }
      logInfo(`[${modelName}] Rumoca run done in ${Date.now() - solverStart}ms`)
      const solverElapsedMs = Date.now() - solverStart
      renderedJs = asString(solverRun?.renderedJs || '')
      solverEventLogSnapshot = null
      omcTraceSnapshot = omcRun?.trace || null

      const solverTrace = normalizeSolverTrace(solverRun.solverTrace)
      solverTraceSnapshot = solverTrace
      validateSolverTrace(solverTrace, { modelName })
      if (!omcRun) {
        records.push({
          modelName,
          status: 'run_fail',
          rumocaRuntime: options.rumocaRuntime,
          elapsedMs: Date.now() - startedAt,
          compileElapsedMs: Number(solverRun.compileElapsedMs) || 0,
          omcElapsedMs,
          solverElapsedMs,
          compareElapsedMs: 0,
          error: `OMC trace unavailable; solver stage completed. ${omcError || 'OMC failed'}`,
        })
        logInfo(`[${modelName}] Step 3/4 skipped: no OMC trace available`)
        logInfo(`[${modelName}] Step 4/4 storing progress/results`)
        continue
      }
      const compareStart = Date.now()
      logInfo(`[${modelName}] Step 3/4 comparing Rumoca vs OMC traces`)
      const comparison = compareTraces(omcRun.trace, solverTrace)
      logInfo(`[${modelName}] Trace comparison done in ${Date.now() - compareStart}ms`)
      const compareElapsedMs = Date.now() - compareStart
      if (!comparison) {
        records.push({
          modelName,
          status: 'missing_channels',
          rumocaRuntime: options.rumocaRuntime,
          elapsedMs: Date.now() - startedAt,
          compileElapsedMs: Number(solverRun.compileElapsedMs) || 0,
          omcElapsedMs,
          solverElapsedMs,
          compareElapsedMs,
          omcCachePath: omcRun.cachePath,
        })
      } else {
        const hint = traceDiagnosticHint(omcRun.trace, solverTrace, comparison)
        let comparedDebugPath = ''
        if (options.debugBundle || options.modelName) {
          comparedDebugPath = await writeDebugBundle({
            modelName,
            sourceModelica,
            renderedJs,
            daePrepared: null,
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
          compileElapsedMs: Number(solverRun.compileElapsedMs) || 0,
          omcElapsedMs,
          solverElapsedMs,
          compareElapsedMs,
          omcCachePath: omcRun.cachePath,
          omcFromCache: omcRun.fromCache,
          rumocaRuntime: options.rumocaRuntime,
          ...comparison,
          ...(hint ? { diagnosticHint: hint } : {}),
          ...(comparedDebugPath ? { debugPath: comparedDebugPath } : {}),
        })
      }
      logInfo(`[${modelName}] Step 4/4 storing progress/results`)

      const record = records[records.length - 1]
      const isBad =
        record.status !== 'compared' ||
        Number(record.maxDeviationPercent) >= Number(options.stopThresholdPercent)
      if (options.mode === 'random-stop' && isBad) {
        if (alwaysContinue) {
          logInfo(
            `[${modelName}] random-stop guard triggered but continuing due to --always-continue`,
          )
        } else {
          const choice = await promptChoice(modelName, Number(record.maxDeviationPercent) || 0)
          if (choice === 'continue') {
            // continue
          } else if (choice === 'always_continue') {
            alwaysContinue = true
            options.alwaysContinue = true
            logInfo(
              `[${modelName}] Interactive mode switched to always-continue for remaining models`,
            )
          } else if (choice === 'debug') {
            debugPath = await writeDebugBundle({
              modelName,
              sourceModelica,
              renderedJs,
              daePrepared: null,
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
      }
    } catch (error) {
      let message = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      logInfo(`[${modelName}] Failure captured: ${message}`)
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
      const status =
        options.compileOnly || /^Compilation error:/i.test(message) ? 'compile_fail' : 'run_fail'
      records.push({
        modelName,
        status,
        rumocaRuntime: options.rumocaRuntime,
        elapsedMs: Date.now() - startedAt,
        ...(options.compileOnly
          ? {}
          : { compileElapsedMs: 0, omcElapsedMs: 0, solverElapsedMs: 0, compareElapsedMs: 0 }),
        error: message,
        ...(stack ? { stack } : {}),
        ...(failureDebugPath ? { debugPath: failureDebugPath } : {}),
      })
      if (failureDebugPath) {
        logInfo(`[${modelName}] Failure debug bundle: ${failureDebugPath}`)
      }
      if (options.mode === 'random-stop' && !alwaysContinue) {
        stoppedAtModel = modelName
        break
      }
      if (options.mode === 'random-stop' && alwaysContinue) {
        logInfo(`[${modelName}] Failure recorded; continuing due to --always-continue`)
      }
    } finally {
      logInfo(`[${modelName}] Writing progress snapshot -> ${progressPath}`)
      await saveProgress(progressPath, {
        startedAt: records[0]?.startedAt || null,
        updatedAt: new Date().toISOString(),
        init,
        libraries,
        options,
        summary: recordSummary(records),
        records,
      })
    }
  }

  const summary = {
    init,
    libraries,
    mode: options.mode,
    seed: options.seed,
    thresholdPercent: options.stopThresholdPercent,
    stoppedAtModel: stoppedAtModel || null,
    debugPath: debugPath || null,
    summary: recordSummary(records),
    records,
    progressPath,
    omcCacheDir: OMC_CACHE_DIR,
    cliLogs: RUN_LOG_BUFFER.slice(),
    libraryTag,
    artifactTag,
    rumocaRuntime: options.rumocaRuntime,
  }
  await saveProgress(progressPath, summary)
  const datedRunFile = datedRunFileForLibraryTag(artifactTag, new Date().toISOString())
  await writeJsonFile(candidateFile, summary)
  await writeJsonFile(datedRunFile, summary)
  if (
    options.rumocaRuntime !== 'native' &&
    resolve(candidateFile) !== resolve(DEFAULT_RUN_JSON_FILE)
  )
    await writeJsonFile(DEFAULT_RUN_JSON_FILE, summary)
  summary.candidateFile = candidateFile
  summary.datedRunFile = datedRunFile
  return summary
}

async function main() {
  RUN_LOG_BUFFER.length = 0
  const options = parseArgs(process.argv.slice(2))
  if (options.help || !options.command) {
    console.log(usage())
    process.exit(0)
  }
  if (
    options.command !== 'run' &&
    options.command !== 'baseline-diff' &&
    options.command !== 'baseline-update' &&
    options.command !== 'probe-compile' &&
    options.command !== 'probe-source' &&
    options.command !== 'probe-solve' &&
    options.command !== 'compile-worker'
  ) {
    console.error(`Unsupported command: ${options.command}\n`)
    console.log(usage())
    process.exit(1)
  }
  if (options.command === 'probe-compile') {
    process.title = `modelica-compare:probe:${safeName(options.modelName || 'unknown')}`
    const probe = await runSingleModelCompileProbe(options)
    console.log(JSON.stringify(probe))
    return
  }
  if (options.command === 'probe-source') {
    process.title = `modelica-compare:probe-source:${safeName(options.modelName || 'unknown')}`
    const probe = await runSourceCompileProbe(options)
    console.log(JSON.stringify(probe))
    return
  }
  if (options.command === 'probe-solve') {
    process.title = `modelica-compare:probe-solve:${safeName(options.modelName || 'unknown')}`
    const probe = await runSingleModelSolveProbe(options)
    if (options.probeOutputFile) {
      await writeJsonFile(options.probeOutputFile, probe)
      return
    }
    console.log(JSON.stringify(probe))
    return
  }
  if (options.command === 'compile-worker') {
    process.title = 'modelica-compare:compile-worker'
    await runCompileWorkerDaemon(options)
    return
  }
  if (options.command === 'baseline-diff') {
    if (shouldRunBaselineDiffAll(options)) {
      const results = await runBaselineDiffAll(options)
      console.log(`Computed baseline diffs: ${results.length}`)
      for (const entry of results) {
        const {
          diff,
          analysis,
          baselineFile,
          candidateFile,
          diffFile,
          diffCsvFile,
          publicDiffFile,
          candidateMeta,
        } = entry
        console.log('')
        console.log(
          `Library: ${asString(diff?.libraryTag) || asString(candidateMeta?.libraryTag) || 'unknown'}`,
        )
        console.log(`Runtime profile: ${candidateMeta.runtimeProfileKey || 'n/a'}`)
        console.log(`Baseline file: ${baselineFile}`)
        console.log(`Candidate file: ${candidateFile}`)
        console.log(
          `Candidate meta: library=${candidateMeta.libraryTag || 'n/a'}, profile=${candidateMeta.runtimeProfileKey || 'n/a'}, generatedAt=${candidateMeta.generatedAt || 'n/a'}, totalModels=${candidateMeta.totalModels}`,
        )
        console.log(`Diff JSON: ${diffFile}`)
        console.log(`Diff CSV: ${diffCsvFile}`)
        console.log(`Public analysis JSON: ${publicDiffFile}`)
        console.log(
          `Compile success improved=${analysis.summary.compileSuccessTransitions.improvedCount}, regressed=${analysis.summary.compileSuccessTransitions.regressedCount}; compile-time compared=${analysis.summary.compileTimeTransitions.comparedCompiledToCompiledCount}, slower=${analysis.summary.compileTimeTransitions.regressedCount}, faster=${analysis.summary.compileTimeTransitions.improvedCount}; Runtime status regressions=${diff.runtimeTotals.statusRegressions}`,
        )
      }
      return
    }
    const {
      diff,
      analysis,
      baselineFile,
      candidateFile,
      diffFile,
      diffCsvFile,
      publicDiffFile,
      candidateMeta,
    } = await runBaselineDiff(options)
    console.log(`Baseline file: ${baselineFile}`)
    console.log(`Candidate file: ${candidateFile}`)
    console.log(
      `Candidate meta: library=${candidateMeta.libraryTag || 'n/a'}, profile=${candidateMeta.runtimeProfileKey || 'n/a'}, generatedAt=${candidateMeta.generatedAt || 'n/a'}, totalModels=${candidateMeta.totalModels}`,
    )
    console.log(`Diff JSON: ${diffFile}`)
    console.log(`Diff CSV: ${diffCsvFile}`)
    console.log(`Public analysis JSON: ${publicDiffFile}`)
    console.log(
      `Compile success improved=${analysis.summary.compileSuccessTransitions.improvedCount}, regressed=${analysis.summary.compileSuccessTransitions.regressedCount}; compile-time compared=${analysis.summary.compileTimeTransitions.comparedCompiledToCompiledCount}, slower=${analysis.summary.compileTimeTransitions.regressedCount}, faster=${analysis.summary.compileTimeTransitions.improvedCount}; Runtime status regressions=${diff.runtimeTotals.statusRegressions}`,
    )
    return
  }
  if (options.command === 'baseline-update') {
    if (!options.baselineFile) {
      const selectedBaseline = await promptBaselineFileSelection()
      if (selectedBaseline) options.baselineFile = selectedBaseline
    }
    const updated = await runBaselineUpdate(options)
    console.log(`Updated baseline: ${updated.baselineFile}`)
    console.log(`From candidate: ${updated.candidateFile}`)
    console.log(`Runtime profile: ${updated.runtimeProfileKey}`)
    console.log(`Models: ${updated.models}`)
    console.log(`Updated at: ${updated.updatedAt}`)
    return
  }
  process.title = `modelica-compare:run:${safeName(options.mode || 'full')}`
  if (!options.compileOnly) {
    if (!(await fileExists(resolve(options.omcWrapper)))) {
      throw new Error(`OMC wrapper not found: ${options.omcWrapper}`)
    }
    await ensureOmcMslDirFromZip({ omcMslDir: options.omcMslDir, mslZip: options.mslZip })
  }
  const summary = await runComparison(options)
  const report = await writeCompareReport(summary)
  console.log(`Compared models: ${summary.summary.compared}/${summary.summary.total}`)
  console.log(`Max deviation: ${summary.summary.maxDeviationPercent.toFixed(3)}%`)
  console.log(`Progress file: ${summary.progressPath}`)
  console.log(`Run JSON: ${summary.candidateFile || DEFAULT_RUN_JSON_FILE}`)
  if (summary.datedRunFile) console.log(`Dated run JSON: ${summary.datedRunFile}`)
  console.log(`OMC cache dir: ${summary.omcCacheDir}`)
  console.log(`Report file: ${report.latestPath}`)
  console.log(`Timestamped report: ${report.timestampedPath}`)
  if (summary.debugPath) console.log(`Debug bundle: ${summary.debugPath}`)
}

main().catch((error) => {
  console.error(`[modelica_compare_cli] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
