import {
  buildDiagnosticsRegistry,
  runDiagnosticsTests,
  type DiagnosticsRunResult,
  type TaskyonTestFn,
  type TestRecord,
} from '../../shared/modules/diagnosticsRunner'
import { freeKey as taskyonDevFreeKey } from '../../../src/assets/taskyon_free_key'
import { readdir } from 'node:fs/promises'
import { basename } from 'node:path'
import { headlessTestMetadata, unsupportedModuleFallbacks } from './testMetadata'

type CliOptions = {
  listOnly: boolean
  details: boolean
  includeExperimental: boolean
  online: boolean
  json: boolean
  allowLongRun: boolean
  filter: string
  tyauth: string | undefined
}

const runtimeEnv = {
  args: process.argv.slice(2),
  getEnv(name: string) {
    return process.env[name]
  },
  exit(code: number) {
    process.exit(code)
  },
}

type WrappedSkippedResult = {
  skipped: true
  reason: string
  testId: string
}

type Summary = {
  ok: boolean
  discovered: number
  selected: number
  passed: number
  failed: number
  skipped: number
  durationMs: number
  options: {
    filter: string
    includeExperimental: boolean
    online: boolean
    details: boolean
  }
  results: Array<{
    name: string
    ok: boolean
    skipped: boolean
    details?: unknown
    error?: unknown
  }>
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return Object.prototype.toString.call(error)
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    listOnly: false,
    details: false,
    includeExperimental: false,
    online: false,
    json: false,
    allowLongRun: false,
    filter: '',
    tyauth: runtimeEnv.getEnv('TYAUTH') ?? runtimeEnv.getEnv('TASKYON_TYAUTH') ?? taskyonDevFreeKey,
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue

    if (arg === '--list') opts.listOnly = true
    else if (arg === '--details') opts.details = true
    else if (arg === '--experimental') opts.includeExperimental = true
    else if (arg === '--online') opts.online = true
    else if (arg === '--json') opts.json = true
    else if (arg === '--allow-long-run') opts.allowLongRun = true
    else if (arg === '--filter') opts.filter = args[++i] ?? ''
    else if (arg.startsWith('--filter=')) opts.filter = arg.slice('--filter='.length)
    else if (arg === '--tyauth') opts.tyauth = args[++i] ?? undefined
    else if (arg.startsWith('--tyauth=')) opts.tyauth = arg.slice('--tyauth='.length)
  }

  return opts
}

function filePathFromUrl(url: URL): string {
  return decodeURIComponent(url.pathname)
}

async function listTestFiles(dirUrl: URL, relativeDir = ''): Promise<string[]> {
  const dirPath = filePathFromUrl(new URL(relativeDir, dirUrl))
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const relativePath = relativeDir ? `${relativeDir}${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...(await listTestFiles(dirUrl, `${relativePath}/`)))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || !entry.name.startsWith('test')) continue
    files.push(relativePath)
  }

  return files.sort((a, b) => a.localeCompare(b))
}

async function loadTestModules() {
  const testDirs = [
    {
      dirUrl: new URL('../../taskyon/src/tests/', import.meta.url),
      sourcePrefix: 'frontend/packages/taskyon/src/tests/',
    },
    {
      dirUrl: new URL('./tests/', import.meta.url),
      sourcePrefix: 'frontend/packages/taskyon-headless/src/tests/',
    },
    {
      dirUrl: new URL('../../shared/surrogate/', import.meta.url),
      sourcePrefix: 'frontend/packages/shared/surrogate/',
    },
  ]

  const modules = []
  const discoveredFiles: string[] = []

  for (const { dirUrl, sourcePrefix } of testDirs) {
    const entries = await listTestFiles(dirUrl)

    for (const entry of entries) {
      const moduleUrl = new URL(entry, dirUrl)
      discoveredFiles.push(`${sourcePrefix}${entry}`)
      try {
        const mod = await import(moduleUrl.href)
        modules.push({
          sourcePath: `${sourcePrefix}${entry}`,
          mod,
        })
      } catch (error) {
        const fallback = unsupportedModuleFallbacks[basename(entry)]
        if (!fallback) throw error

        const mod = Object.fromEntries(
          fallback.tests.map(({ exportName, experimental }) => {
            const fn: TaskyonTestFn = () => ({
              skipped: true,
              reason: fallback.reason,
              testId: exportName,
            })
            if (experimental) fn.experimental = true
            return [exportName, fn]
          }),
        )

        modules.push({
          sourcePath: `${sourcePrefix}${entry}`,
          mod,
        })
      }
    }
  }

  return { modules, discoveredFiles }
}

function filterTests(tests: TestRecord, filter: string): TestRecord {
  if (!filter.trim()) return tests
  const normalized = filter.trim().toLowerCase()
  return Object.fromEntries(
    Object.entries(tests).filter(([name]) => name.toLowerCase().includes(normalized)),
  )
}

function testIdentifier(name: string): string {
  const camelName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/ +([a-z0-9])/g, (_, chr: string) => chr.toUpperCase())
  if (camelName.startsWith('test') && camelName.length > 4) return camelName
  return camelName.replace(/^([a-z])/, (_, chr: string) => `test${chr.toUpperCase()}`)
}

function shouldSkipTest(name: string, opts: CliOptions): WrappedSkippedResult | null {
  const id = testIdentifier(name)
  const metadata = headlessTestMetadata[id]
  if (!metadata) return null

  if (metadata.requiresNetwork && !opts.online) {
    return {
      skipped: true,
      reason: 'Requires network/service access. Re-run with --online to enable.',
      testId: id,
    }
  }

  if (metadata.requiresAuth && !opts.tyauth) {
    return {
      skipped: true,
      reason: 'Requires Taskyon auth. Set TYAUTH or pass --tyauth.',
      testId: id,
    }
  }

  return null
}

function wrapTests(tests: TestRecord, opts: CliOptions): TestRecord {
  return Object.fromEntries(
    Object.entries(tests).map(([name, fn]) => {
      const wrapped: TaskyonTestFn = async () => {
        const skipped = shouldSkipTest(name, opts)
        if (skipped) return skipped

        const ctx = {
          tyauth: opts.tyauth ?? '',
          allowLongRun: opts.allowLongRun,
        }
        return await Promise.resolve(fn(ctx))
      }
      if (fn.description !== undefined) wrapped.description = fn.description
      if (fn.setup !== undefined) wrapped.setup = fn.setup
      if (fn.timeoutMs !== undefined) wrapped.timeoutMs = fn.timeoutMs
      return [name, wrapped]
    }),
  )
}

function listTests(tests: TestRecord, experimentalTests: TestRecord) {
  const render = (name: string, kind: 'default' | 'experimental') => {
    const id = testIdentifier(name)
    const metadata = headlessTestMetadata[id]
    const tags = [
      kind === 'experimental' ? 'experimental' : '',
      metadata?.requiresNetwork ? 'network' : '',
      metadata?.requiresAuth ? 'auth' : '',
    ].filter(Boolean)
    const tagText = tags.length ? ` [${tags.join(', ')}]` : ''
    console.log(`${name}${tagText}`)
  }

  console.log('Default tests:')
  for (const name of Object.keys(tests).sort((a, b) => a.localeCompare(b))) render(name, 'default')

  console.log('')
  console.log('Experimental tests:')
  for (const name of Object.keys(experimentalTests).sort((a, b) => a.localeCompare(b))) {
    render(name, 'experimental')
  }
}

function isSkippedResult(result: DiagnosticsRunResult): boolean {
  return (
    result.ok === true &&
    typeof result.details === 'object' &&
    result.details !== null &&
    (result.details as Record<string, unknown>).skipped === true
  )
}

function formatResultLine(result: DiagnosticsRunResult): string {
  if (result.ok) {
    if (isSkippedResult(result)) {
      const details = result.details as WrappedSkippedResult
      return `[SKIP] ${result.name} - ${details.reason}`
    }
    return `[PASS] ${result.name}`
  }
  const error = result.error
  const errorText =
    typeof error === 'object' && error && 'message' in error
      ? toErrorMessage(error.message)
      : toErrorMessage(error)
  return `[FAIL] ${result.name} - ${errorText}`
}

function buildSummary(
  results: DiagnosticsRunResult[],
  opts: CliOptions,
  durationMs: number,
): Summary {
  const skipped = results.filter(isSkippedResult).length
  const failed = results.filter((result) => !result.ok).length
  const passed = results.filter((result) => result.ok && !isSkippedResult(result)).length

  return {
    ok: failed === 0,
    discovered: results.length,
    selected: results.length,
    passed,
    failed,
    skipped,
    durationMs,
    options: {
      filter: opts.filter,
      includeExperimental: opts.includeExperimental,
      online: opts.online,
      details: opts.details,
    },
    results: results.map((result) => ({
      name: result.name,
      ok: result.ok,
      skipped: isSkippedResult(result),
      details: result.details,
      error: result.error,
    })),
  }
}

async function main() {
  const opts = parseArgs(runtimeEnv.args)
  const { modules, discoveredFiles } = await loadTestModules()
  const registry = buildDiagnosticsRegistry({ modules })

  if (opts.listOnly) {
    console.log(`Discovered files: ${discoveredFiles.length}`)
    for (const file of discoveredFiles) console.log(`- ${file}`)
    console.log('')
    listTests(registry.tests, registry.experimentalTests)
    return
  }

  const selectedSource = opts.includeExperimental
    ? { ...registry.tests, ...registry.experimentalTests }
    : registry.tests
  const filtered = filterTests(selectedSource, opts.filter)
  const wrapped = wrapTests(filtered, opts)
  const selectedNames = Object.keys(wrapped)

  console.log(`[taskyon-headless] discovered ${discoveredFiles.length} test files`)
  console.log(
    `[taskyon-headless] selected ${selectedNames.length} tests` +
      (opts.filter ? ` (filter="${opts.filter}")` : ''),
  )

  if (selectedNames.length === 0) {
    console.error('[taskyon-headless] no tests matched the current selection')
    runtimeEnv.exit(1)
  }

  const startedAt = Date.now()
  const results = await runDiagnosticsTests(wrapped, {
    details: true,
    onProgress: (progress) => {
      if (progress.phase === 'start') console.log(`[RUN ] ${progress.test}`)
    },
    onResult: (result) => {
      console.log(formatResultLine(result))
      if (!result.ok && opts.details) {
        console.log(JSON.stringify(result.error, null, 2))
      }
    },
  })
  const durationMs = Date.now() - startedAt
  const summary = buildSummary(results, opts, durationMs)

  console.log('')
  console.log(
    `[taskyon-headless] completed in ${durationMs}ms: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`,
  )
  console.log('TASKYON_HEADLESS_SUMMARY_START')
  console.log(
    JSON.stringify(opts.details || opts.json ? summary : { ...summary, results: [] }, null, 2),
  )
  console.log('TASKYON_HEADLESS_SUMMARY_END')

  if (!summary.ok) runtimeEnv.exit(1)
}

await main()
