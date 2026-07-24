import {
  buildDiagnosticsRegistry,
  runDiagnosticsTests,
  type DiagnosticsRunResult,
  type DiagnosticsTestContext,
  type TaskyonTestFn,
  type TestRecord,
} from '@taskyon/common/modules/diagnosticsRunner'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import process from 'node:process'
import { getSelectedProviderSettings } from '../cli/models'
import { bootstrapCliTaskyon } from '../cli/runtime'
import { diagnosticsTestMetadata, unsupportedModuleFallbacks } from './testMetadata'

type CliOptions = {
  listOnly: boolean
  details: boolean
  includeExperimental: boolean
  includeLargeTokens: boolean
  online: boolean
  json: boolean
  allowLongRun: boolean
  filter: string
  tyauth: string | undefined
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
  durationMs: number
  options: {
    filter: string
    includeExperimental: boolean
    includeLargeTokens?: boolean
    online: boolean
    details: boolean
    provider?: string
    model?: string
  }
  results: Array<{
    name: string
    ok: boolean
    skipped: boolean
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

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    listOnly: false,
    details: false,
    includeExperimental: false,
    includeLargeTokens: false,
    online: false,
    json: false,
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
    else if (arg === '--allow-long-run') opts.allowLongRun = true
    else if (arg === '--filter') opts.filter = args[++i] ?? ''
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
  const matches = source.matchAll(/\bexport\s+const\s+(test[A-Za-z0-9_]+)/g)
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
  discoveredCount: number,
  selectedProvider?: string,
  selectedModel?: string,
): Summary {
  const skipped = results.filter(isSkippedResult).length
  const failed = results.filter((result) => !result.ok).length
  const passed = results.filter((result) => result.ok && !isSkippedResult(result)).length

  return {
    ok: failed === 0,
    discovered: discoveredCount,
    selected: results.length,
    passed,
    failed,
    skipped,
    durationMs,
    options: {
      filter: opts.filter,
      includeExperimental: opts.includeExperimental,
      includeLargeTokens: opts.includeLargeTokens,
      online: opts.online,
      details: opts.details,
      ...(selectedProvider ? { provider: selectedProvider } : {}),
      ...(selectedModel ? { model: selectedModel } : {}),
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
  const { modules, discoveredFiles } = await loadTestModules(opts.filter)
  const registry = buildDiagnosticsRegistry({ modules })

  if (opts.listOnly) {
    const defaultTests = filterTests(
      filterLargeTokenTests(registry.tests, opts.includeLargeTokens),
      opts.filter,
    )
    const experimentalTests = filterTests(registry.experimentalTests, opts.filter)
    console.log(`Discovered files: ${discoveredFiles.length}`)
    for (const file of discoveredFiles) console.log(`- ${file}`)
    console.log('')
    listTests(defaultTests, experimentalTests)
    return
  }

  const selectedSource = opts.includeExperimental
    ? { ...registry.tests, ...registry.experimentalTests }
    : registry.tests
  const filtered = filterTests(
    filterLargeTokenTests(selectedSource, opts.includeLargeTokens),
    opts.filter,
  )
  const wrapped = wrapTests(filtered, opts)
  const selectedNames = Object.keys(wrapped)

  console.log(`[tycli-diagnostics] discovered ${discoveredFiles.length} test files`)
  console.log(
    `[tycli-diagnostics] selected ${selectedNames.length} tests` +
      (opts.filter ? ` (filter="${opts.filter}")` : ''),
  )

  if (selectedNames.length === 0) {
    console.error('[tycli-diagnostics] no tests matched the current selection')
    process.exit(1)
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
      console.log(formatResultLine(result))
      if (!result.ok && opts.details) {
        console.log(JSON.stringify(result.error, null, 2))
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

  console.log('')
  console.log(
    `[tycli-diagnostics] completed in ${durationMs}ms: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`,
  )
  console.log('TYCLI_DIAGNOSTICS_SUMMARY_START')
  console.log(
    JSON.stringify(opts.details || opts.json ? summary : { ...summary, results: [] }, null, 2),
  )
  console.log('TYCLI_DIAGNOSTICS_SUMMARY_END')

  if (!summary.ok) process.exit(1)
}

await main()
