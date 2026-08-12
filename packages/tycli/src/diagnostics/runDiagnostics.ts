import {
  buildDiagnosticsRegistry,
  runDiagnosticsTests,
  type DiagnosticsRunResult,
  type DiagnosticsTestContext,
  type TaskyonTestFn,
  type TestRecord,
} from '@taskyon/common/modules/diagnosticsRunner'
import { closeDatabases } from '@taskyon/taskyon/db'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'
import { resolveTaskyonCliStoragePaths } from '../cli/storagePaths'
import { createDiagnosticsOutput, formatFailedDiagnostics } from './diagnosticsOutput'
import { diagnosticsTestMetadata, unsupportedModuleFallbacks } from './testMetadata'

const diagnosticsCategories = [
  'standard',
  'experimental',
  'network',
  'authenticated',
  'large-tokens',
  'long-running',
  'model-based',
  'release',
] as const

type DiagnosticsCategory = (typeof diagnosticsCategories)[number]

type CliOptions = {
  listOnly: boolean
  details: boolean
  includeExperimental: boolean
  includeLargeTokens: boolean
  online: boolean
  json: boolean
  verbose: boolean
  allowLongRun: boolean
  filter: string
  tyauth: string | undefined
  category?: DiagnosticsCategory
  provider?: string
  model?: string
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
  modelCapability: {
    passed: number
    missed: number
    score: number | null
  }
  durationMs: number
  options: {
    filter: string
    includeExperimental: boolean
    includeLargeTokens?: boolean
    online: boolean
    details: boolean
    verbose: boolean
    category?: DiagnosticsCategory
    provider?: string
    model?: string
  }
  results: Array<{
    name: string
    ok: boolean
    skipped: boolean
    modelBased: boolean
    details?: unknown
    error?: unknown
  }>
}

type TestFileEntry = {
  entry: string
  moduleUrl: URL
  sourcePath: string
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return Object.prototype.toString.call(error)
}

const parseCategory = (value: string | undefined): DiagnosticsCategory => {
  if (diagnosticsCategories.includes(value as DiagnosticsCategory)) {
    return value as DiagnosticsCategory
  }
  throw new Error(
    `Unknown diagnostics category "${value ?? ''}". Expected one of: ${diagnosticsCategories.join(', ')}.`,
  )
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    listOnly: false,
    details: false,
    includeExperimental: false,
    includeLargeTokens: false,
    online: false,
    json: false,
    verbose: false,
    allowLongRun: false,
    filter: '',
    tyauth: process.env.TYAUTH ?? process.env.TASKYON_TYAUTH ?? undefined,
    ...(process.env.TASKYON_SELECTED_API?.trim()
      ? { provider: process.env.TASKYON_SELECTED_API.trim() }
      : {}),
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue

    if (arg === '--list') opts.listOnly = true
    else if (arg === '--details') opts.details = true
    else if (arg === '--experimental') opts.includeExperimental = true
    else if (arg === '--large-tokens') opts.includeLargeTokens = true
    else if (arg === '--online') opts.online = true
    else if (arg === '--json') opts.json = true
    else if (arg === '--verbose') opts.verbose = true
    else if (arg === '--allow-long-run') opts.allowLongRun = true
    else if (arg === '--category') opts.category = parseCategory(args[++i])
    else if (arg.startsWith('--category=')) {
      opts.category = parseCategory(arg.slice('--category='.length))
    } else if (arg === '--filter') opts.filter = args[++i] ?? ''
    else if (arg.startsWith('--filter=')) opts.filter = arg.slice('--filter='.length)
    else if (arg === '--tyauth') opts.tyauth = args[++i] ?? undefined
    else if (arg.startsWith('--tyauth=')) opts.tyauth = arg.slice('--tyauth='.length)
    else if (arg === '--provider') {
      const provider = args[++i]?.trim()
      if (provider) opts.provider = provider
      else delete opts.provider
    } else if (arg.startsWith('--provider=')) {
      const provider = arg.slice('--provider='.length).trim()
      if (provider) opts.provider = provider
      else delete opts.provider
    } else if (arg === '--model') {
      const model = args[++i]?.trim()
      if (model) opts.model = model
      else delete opts.model
    } else if (arg.startsWith('--model=')) {
      const model = arg.slice('--model='.length).trim()
      if (model) opts.model = model
      else delete opts.model
    }
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

function matchesFilter(value: string, filter: string): boolean {
  if (!filter.trim()) return true
  return value.toLowerCase().includes(filter.trim().toLowerCase())
}

function testIdentifier(name: string): string {
  const normalizedName = name.replace(/^Test\s+/i, '')
  const camelName = normalizedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/ +([a-z0-9])/g, (_, chr: string) => chr.toUpperCase())
  if (camelName.startsWith('test') && camelName.length > 4) return camelName
  return camelName.replace(/^([a-z])/, (_, chr: string) => `test${chr.toUpperCase()}`)
}

function testDisplayName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/^Test\s+/i, '')
    .replace(/^([a-z])/, (_, chr: string) => chr.toUpperCase())
}

function exportedTestNames(source: string): string[] {
  const matches = source.matchAll(
    /\bexport\s+(?:const|(?:async\s+)?function)\s+(test[A-Za-z0-9_]+)/g,
  )
  return Array.from(matches, (match) => match[1]).filter((name): name is string => Boolean(name))
}

async function testFileMatchesFilter(file: TestFileEntry, filter: string): Promise<boolean> {
  if (!filter.trim()) return true
  if (matchesFilter(file.sourcePath, filter) || matchesFilter(basename(file.entry), filter)) {
    return true
  }

  const source = await readFile(filePathFromUrl(file.moduleUrl), 'utf8')
  return exportedTestNames(source).some(
    (name) =>
      matchesFilter(name, filter) ||
      matchesFilter(testDisplayName(name), filter) ||
      matchesFilter(testIdentifier(name), filter),
  )
}

async function listTestFileEntries() {
  const testDirs = [
    {
      dirUrl: new URL('../../../taskyon/src/tests/', import.meta.url),
      sourcePrefix: 'packages/taskyon/src/tests/',
    },
    {
      dirUrl: new URL('../../../runtime-browser/src/tests/', import.meta.url),
      sourcePrefix: 'packages/runtime-browser/src/tests/',
    },
    {
      dirUrl: new URL('./tests/', import.meta.url),
      sourcePrefix: 'packages/tycli/src/diagnostics/tests/',
    },
    {
      dirUrl: new URL('../../../common/modules/', import.meta.url),
      sourcePrefix: 'packages/common/modules/',
    },
    {
      dirUrl: new URL('../../../comp-dag/', import.meta.url),
      sourcePrefix: 'packages/comp-dag/',
    },
    {
      dirUrl: new URL('../../../ui/components/', import.meta.url),
      sourcePrefix: 'packages/ui/components/',
    },
    {
      dirUrl: new URL('../../../surrogate/', import.meta.url),
      sourcePrefix: 'packages/surrogate/',
    },
  ]

  const files: TestFileEntry[] = []

  for (const { dirUrl, sourcePrefix } of testDirs) {
    const entries = await listTestFiles(dirUrl)

    for (const entry of entries) {
      const moduleUrl = new URL(entry, dirUrl)
      files.push({
        entry,
        moduleUrl,
        sourcePath: `${sourcePrefix}${entry}`,
      })
    }
  }

  return files
}

async function loadTestModules(filter: string) {
  const files = await listTestFileEntries()
  const modules = []
  const discoveredFiles = files.map((file) => file.sourcePath)
  const selectedFiles = []

  for (const file of files) {
    if (await testFileMatchesFilter(file, filter)) {
      selectedFiles.push(file)
    }
  }

  for (const file of selectedFiles) {
    try {
      const mod = await import(file.moduleUrl.href)
      modules.push({
        sourcePath: file.sourcePath,
        mod,
      })
    } catch (error) {
      const fallback = unsupportedModuleFallbacks[basename(file.entry)]
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
        sourcePath: file.sourcePath,
        mod,
      })
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

function filterLargeTokenTests(tests: TestRecord, includeLargeTokens: boolean): TestRecord {
  if (includeLargeTokens) return tests
  return Object.fromEntries(
    Object.entries(tests).filter(([name]) => {
      const metadata = diagnosticsTestMetadata[testIdentifier(name)]
      return !metadata?.requiresLargeTokens
    }),
  )
}

function filterTestsByCategory(
  tests: TestRecord,
  category: DiagnosticsCategory | undefined,
): TestRecord {
  if (!category) return tests
  return Object.fromEntries(
    Object.entries(tests).filter(([name, fn]) => {
      const metadata = diagnosticsTestMetadata[testIdentifier(name)]
      if (category === 'standard') return !fn.experimental && !fn.modelBased
      if (category === 'experimental') return fn.experimental === true
      if (category === 'network') return metadata?.requiresNetwork === true
      if (category === 'authenticated') return metadata?.requiresAuth === true
      if (category === 'large-tokens') return metadata?.requiresLargeTokens === true
      if (category === 'long-running') return metadata?.requiresLongRun === true
      if (category === 'release') return metadata?.release === true
      return fn.modelBased === true || metadata?.modelBased === true
    }),
  )
}

function shouldSkipTest(name: string, opts: CliOptions): WrappedSkippedResult | null {
  const id = testIdentifier(name)
  const metadata = diagnosticsTestMetadata[id]
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

  if (metadata.requiresLargeTokens && !opts.includeLargeTokens) {
    return {
      skipped: true,
      reason: 'Requires larger token usage. Re-run with --large-tokens to enable.',
      testId: id,
    }
  }

  return null
}

function wrapTests(tests: TestRecord, opts: CliOptions): TestRecord {
  return Object.fromEntries(
    Object.entries(tests).map(([name, fn]) => {
      const wrapped: TaskyonTestFn = async (ctx) => {
        const skipped = shouldSkipTest(name, opts)
        if (skipped) return skipped

        const nextContext: DiagnosticsTestContext = {
          ...(ctx ?? {}),
          ...(opts.tyauth ? { tyauth: opts.tyauth } : {}),
          allowLongRun: opts.allowLongRun,
        }
        return await Promise.resolve(fn(nextContext))
      }
      if (fn.description !== undefined) wrapped.description = fn.description
      if (fn.setup !== undefined) wrapped.setup = fn.setup
      if (fn.timeoutMs !== undefined) wrapped.timeoutMs = fn.timeoutMs
      const modelBased = fn.modelBased ?? diagnosticsTestMetadata[testIdentifier(name)]?.modelBased
      if (modelBased !== undefined) wrapped.modelBased = modelBased
      return [name, wrapped]
    }),
  )
}

function listTests(tests: TestRecord, experimentalTests: TestRecord) {
  const render = (name: string, kind: 'default' | 'experimental') => {
    const id = testIdentifier(name)
    const metadata = diagnosticsTestMetadata[id]
    const tags = [
      kind === 'experimental' ? 'experimental' : '',
      metadata?.requiresNetwork ? 'network' : '',
      metadata?.requiresAuth ? 'auth' : '',
      metadata?.requiresLargeTokens ? 'large-tokens' : '',
      metadata?.requiresLongRun ? 'long-running' : '',
      metadata?.modelBased ? 'model-based' : '',
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

function formatResultLine(result: DiagnosticsRunResult, verbose: boolean): string {
  if (result.ok) {
    if (isSkippedResult(result)) {
      const details = result.details as WrappedSkippedResult
      return `[SKIP] ${result.name}${verbose ? ` - ${details.reason}` : ''}`
    }
    return `[${result.modelBased ? 'MODEL PASS' : 'PASS'}] ${result.name}`
  }
  const error = result.error
  const errorText =
    typeof error === 'object' && error && 'message' in error
      ? toErrorMessage(error.message)
      : toErrorMessage(error)
  return `[${result.modelBased ? 'MODEL MISS' : 'FAIL'}] ${result.name}${verbose ? ` - ${errorText}` : ''}`
}

function buildSummary(
  results: DiagnosticsRunResult[],
  opts: CliOptions,
  durationMs: number,
  discoveredCount: number,
  selectedProvider?: string,
  selectedModel?: string,
): Summary {
  const skipped = results.filter(isSkippedResult).length
  const modelResults = results.filter((result) => result.modelBased && !isSkippedResult(result))
  const modelPassed = modelResults.filter((result) => result.ok).length
  const modelMissed = modelResults.length - modelPassed
  const failed = results.filter((result) => !result.ok && !result.modelBased).length
  const passed = results.filter(
    (result) => result.ok && !result.modelBased && !isSkippedResult(result),
  ).length

  return {
    ok: failed === 0,
    discovered: discoveredCount,
    selected: results.length,
    passed,
    failed,
    skipped,
    modelCapability: {
      passed: modelPassed,
      missed: modelMissed,
      score: modelResults.length > 0 ? modelPassed / modelResults.length : null,
    },
    durationMs,
    options: {
      filter: opts.filter,
      includeExperimental: opts.includeExperimental,
      includeLargeTokens: opts.includeLargeTokens,
      online: opts.online,
      details: opts.details,
      verbose: opts.verbose,
      ...(opts.category ? { category: opts.category } : {}),
      ...(selectedProvider ? { provider: selectedProvider } : {}),
      ...(selectedModel ? { model: selectedModel } : {}),
    },
    results: results.map((result) => ({
      name: result.name,
      ok: result.ok,
      skipped: isSkippedResult(result),
      modelBased: result.modelBased,
      details: result.details,
      error: result.error,
    })),
  }
}

function applyDiagnosticsEnvironment(context: DiagnosticsTestContext) {
  if (context.selectedApi) process.env.TASKYON_SELECTED_API = context.selectedApi
  if (context.model) {
    process.env.TASKYON_TEST_MODEL = context.model
  }
  if (context.tyauth) {
    process.env.TYAUTH = context.tyauth
    process.env.TASKYON_TYAUTH = context.tyauth
  }
  if (context.selectedApi === 'openai' && context.providerKey) {
    process.env.TASKYON_OPENAI_API_KEY = context.providerKey
    process.env.OPENAI_API_KEY = context.providerKey
  }
  if (context.selectedApi === 'taskyon' && context.providerKey) {
    process.env.TASKYON_API_KEY = context.providerKey
  }
  if (context.selectedApi === 'openrouter.ai' && context.providerKey) {
    process.env.TASKYON_OPENROUTER_API_KEY = context.providerKey
    process.env.OPENROUTER_API_KEY = context.providerKey
  }
  if (context.selectedApi === 'chatgpt-codex' && context.providerKey) {
    process.env.TASKYON_CHATGPT_CODEX_API_KEY = context.providerKey
    process.env.CHATGPT_CODEX_API_KEY = context.providerKey
  }
  if (context.selectedApi === 'chatgpt-codex' && context.accountId) {
    process.env.TASKYON_CHATGPT_CODEX_ACCOUNT_ID = context.accountId
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))

  if (opts.listOnly) {
    const { modules, discoveredFiles } = await loadTestModules(opts.filter)
    const registry = buildDiagnosticsRegistry({ modules })
    const defaultTests = filterTests(
      filterTestsByCategory(
        filterLargeTokenTests(
          { ...registry.tests, ...registry.modelBasedTests },
          opts.includeLargeTokens,
        ),
        opts.category,
      ),
      opts.filter,
    )
    const experimentalTests = filterTests(
      filterTestsByCategory(registry.experimentalTests, opts.category),
      opts.filter,
    )
    console.log(`Discovered files: ${discoveredFiles.length}`)
    for (const file of discoveredFiles) console.log(`- ${file}`)
    console.log('')
    listTests(defaultTests, experimentalTests)
    return
  }

  if (opts.verbose) process.env.TASKYON_CLI_VERBOSE = '1'
  const output = createDiagnosticsOutput({
    logDir: resolveTaskyonCliStoragePaths().logDir,
    verbose: opts.verbose,
  })
  const restoreOutput = output.capture()
  let fatalExitStarted = false
  const exitAfterFatalError = (kind: string, error: unknown) => {
    if (fatalExitStarted) return
    fatalExitStarted = true
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    output.log(kind, `${message}\n`)
    output.status(`[tycli-diagnostics] ${kind}: ${toErrorMessage(error)}`, 'stderr')
    output.status(`[tycli-diagnostics] log file: ${output.logFile}`, 'stderr')
    restoreOutput()
    process.stderr.write('', () => process.exit(1))
  }
  const handleUncaughtException = (error: Error) => exitAfterFatalError('uncaught exception', error)
  const handleUnhandledRejection = (error: unknown) =>
    exitAfterFatalError('unhandled rejection', error)
  process.once('uncaughtException', handleUncaughtException)
  process.once('unhandledRejection', handleUnhandledRejection)

  try {
    const [{ getSelectedProviderSettings }, { bootstrapCliTaskyon }] = await Promise.all([
      import('../cli/models'),
      import('../cli/runtime'),
    ])
    const { modules, discoveredFiles } = await loadTestModules(opts.filter)
    const registry = buildDiagnosticsRegistry({ modules })

    const selectedSource = opts.includeExperimental
      ? { ...registry.tests, ...registry.modelBasedTests, ...registry.experimentalTests }
      : { ...registry.tests, ...registry.modelBasedTests }
    const filtered = filterTests(
      filterTestsByCategory(
        filterLargeTokenTests(selectedSource, opts.includeLargeTokens),
        opts.category,
      ),
      opts.filter,
    )
    const wrapped = wrapTests(filtered, opts)
    const selectedNames = Object.keys(wrapped)

    console.log(`[tycli-diagnostics] discovered ${discoveredFiles.length} test files`)
    console.log(
      `[tycli-diagnostics] selected ${selectedNames.length} tests` +
        (opts.filter ? ` (filter="${opts.filter}")` : '') +
        (opts.category ? ` (category="${opts.category}")` : ''),
    )

    if (selectedNames.length === 0) {
      output.status('[tycli-diagnostics] no tests matched the current selection', 'stderr')
      output.status(`[tycli-diagnostics] log file: ${output.logFile}`, 'stderr')
      process.exitCode = 1
      return
    }

    const diagnosticsDataDir = await mkdtemp(join(tmpdir(), 'tycli-diagnostics-pglite-'))
    const runtime = await bootstrapCliTaskyon({
      nodePgLiteDataDir: diagnosticsDataDir,
      ...(opts.provider ? { selectedApi: opts.provider } : {}),
      ...(opts.model ? { model: opts.model } : {}),
    })
    const context: DiagnosticsTestContext = {
      ...(opts.tyauth ? { tyauth: opts.tyauth } : {}),
      allowLongRun: opts.allowLongRun,
      selectedApi: runtime.selectedApi,
      llmSettings: runtime.llmState.settings,
      toolchainConfig: {
        chatCompletion: getSelectedProviderSettings(runtime.llmState),
      },
      ...(runtime.model ? { model: runtime.model } : {}),
      ...(runtime.providerKey ? { providerKey: runtime.providerKey } : {}),
      ...(runtime.oauthSession?.accessToken
        ? { providerAccessToken: runtime.oauthSession.accessToken }
        : {}),
      ...(runtime.oauthSession?.accountId ? { accountId: runtime.oauthSession.accountId } : {}),
    }
    applyDiagnosticsEnvironment(context)

    const startedAt = Date.now()
    const results = await runDiagnosticsTests(wrapped, {
      details: true,
      context,
      onProgress: (progress) => {
        if (progress.phase === 'start') console.log(`[RUN ] ${progress.test}`)
      },
      onResult: (result) => {
        output.status(formatResultLine(result, opts.verbose), result.ok ? 'stdout' : 'stderr')
        output.log('result', `${JSON.stringify(result, null, 2)}\n`)
        if (!result.ok && opts.details) {
          output.status(JSON.stringify(result.error, null, 2), 'stderr')
        }
      },
    })
    const durationMs = Date.now() - startedAt
    const summary = buildSummary(
      results,
      opts,
      durationMs,
      discoveredFiles.length,
      runtime.selectedApi,
      runtime.model,
    )
    const summaryJson = JSON.stringify(
      opts.details || opts.json ? summary : { ...summary, results: [] },
      null,
      2,
    )

    runtime.taskyon.cancelCurrentRun('tycli diagnostics complete')
    output.status('')
    output.status(
      `[tycli-diagnostics] completed in ${durationMs}ms: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped, model score ${summary.modelCapability.passed}/${summary.modelCapability.passed + summary.modelCapability.missed}`,
    )
    if (summary.failed > 0) output.status(formatFailedDiagnostics(results), 'stderr')
    const modelMisses = results.filter((result) => !result.ok && result.modelBased)
    if (modelMisses.length > 0) {
      output.status(`Model misses:\n${modelMisses.map((result) => `- ${result.name}`).join('\n')}`)
    }
    output.log('summary', `${summaryJson}\n`)
    if (opts.verbose || opts.details || opts.json) {
      output.status('TYCLI_DIAGNOSTICS_SUMMARY_START')
      output.status(summaryJson)
      output.status('TYCLI_DIAGNOSTICS_SUMMARY_END')
    }
    output.status(`[tycli-diagnostics] log file: ${output.logFile}`)

    process.exitCode = summary.ok ? 0 : 1
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    output.log('fatal', `${message}\n`)
    output.status(`[tycli-diagnostics] fatal: ${toErrorMessage(error)}`, 'stderr')
    output.status(`[tycli-diagnostics] log file: ${output.logFile}`, 'stderr')
    process.exitCode = 1
  } finally {
    process.removeListener('uncaughtException', handleUncaughtException)
    process.removeListener('unhandledRejection', handleUnhandledRejection)
    restoreOutput()
  }
}

try {
  await main()
} finally {
  await closeDatabases()
}
await Promise.all(
  [process.stdout, process.stderr].map(
    (stream) =>
      new Promise<void>((resolve) => {
        stream.write('', () => resolve())
      }),
  ),
)
process.exit(process.exitCode ?? 0)
