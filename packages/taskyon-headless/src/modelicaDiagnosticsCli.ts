import * as ModelicaDiagnostics from '../../shared/modelica/modelicaDiagnostics'
import { runDiagnosticsTests, type TestRecord } from '../../shared/modules/diagnosticsRunner'
import { createRequire } from 'node:module'
import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const rumocaWasmPath = require.resolve('rumoca/rumoca_bind_wasm_bg.wasm')
const rumocaWasmUrl = pathToFileURL(rumocaWasmPath).href
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const mslZipCandidates = [
  process.env.MODELICA_DIAG_MSL_ZIP_PATH?.trim() || '',
  resolve(repoRoot, 'public/modelica-libraries/ModelicaStandardLibrary-4.1.0.zip'),
  resolve(repoRoot, 'packages/rumoca/target/msl/ModelicaStandardLibrary-4.1.0.zip'),
].filter(Boolean)

const findExistingFile = async (paths: string[]): Promise<string | null> => {
  for (const path of paths) {
    try {
      await access(path)
      return path
    } catch {
      continue
    }
  }
  return null
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

const installNodeFetchWasmFallback = async () => {
  const nativeFetch = globalThis.fetch?.bind(globalThis)
  if (!nativeFetch) return
  const resolvedMslZipPath = await findExistingFile(mslZipCandidates)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (typeof url === 'string' && (url.endsWith('/rumoca_bind_wasm_bg.wasm') || url === rumocaWasmUrl)) {
      const bytes = await readFile(rumocaWasmPath)
      return new Response(toArrayBuffer(bytes), {
        status: 200,
        headers: { 'content-type': 'application/wasm' },
      })
    }
    if (
      typeof url === 'string' &&
      (url === '/modelica-libraries/ModelicaStandardLibrary-4.1.0.zip' ||
        url === '/public/modelica-libraries/ModelicaStandardLibrary-4.1.0.zip')
    ) {
      if (!resolvedMslZipPath) {
        throw new Error(
          `Could not locate ModelicaStandardLibrary-4.1.0.zip. Checked: ${mslZipCandidates.join(', ')}`,
        )
      }
      const bytes = await readFile(resolvedMslZipPath)
      return new Response(toArrayBuffer(bytes), {
        status: 200,
        headers: { 'content-type': 'application/zip' },
      })
    }
    return nativeFetch(input as RequestInfo, init)
  }) as typeof globalThis.fetch
}

type CliOptions = {
  filter: string
  details: boolean
}

const parseArgs = (args: string[]): CliOptions => {
  const opts: CliOptions = {
    filter: '',
    details: false,
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (!arg) continue
    if (arg === '--details') opts.details = true
    else if (arg === '--filter') opts.filter = args[++i] ?? ''
    else if (arg.startsWith('--filter=')) opts.filter = arg.slice('--filter='.length)
  }
  return opts
}

const camelToNormal = (input: string): string => {
  if (!input) return ''
  const withSpaces = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1)
}

const collectModelicaTests = (): TestRecord => {
  const tests: TestRecord = {}
  for (const [name, value] of Object.entries(ModelicaDiagnostics as Record<string, unknown>)) {
    if (!name.startsWith('testModelica')) continue
    if (typeof value !== 'function') continue
    tests[camelToNormal(name)] = value as TestRecord[string]
  }
  return tests
}

const filterTests = (tests: TestRecord, filter: string): TestRecord => {
  if (!filter.trim()) return tests
  const needle = filter.trim().toLowerCase()
  return Object.fromEntries(
    Object.entries(tests).filter(([name]) => name.toLowerCase().includes(needle)),
  )
}

const main = async (): Promise<void> => {
  await installNodeFetchWasmFallback()
  if (!process.env.MODELICA_DIAG_RUNTIME_TIMEOUT_MS) {
    process.env.MODELICA_DIAG_RUNTIME_TIMEOUT_MS = '60000'
  }
  const opts = parseArgs(process.argv.slice(2))
  const all = collectModelicaTests()
  const selected = filterTests(all, opts.filter)
  const names = Object.keys(selected)
  console.log(`[modelica-node] discovered ${Object.keys(all).length} tests`)
  console.log(`[modelica-node] selected ${names.length} tests${opts.filter ? ` (filter="${opts.filter}")` : ''}`)
  if (names.length === 0) {
    console.error('[modelica-node] no tests selected')
    process.exit(1)
  }

  const startedAt = Date.now()
  const results = await runDiagnosticsTests(selected, {
    details: opts.details,
    timeoutMs: 300_000,
    onProgress: ({ phase, test, ok }) => {
      if (phase === 'start') console.log(`[RUN ] ${test}`)
      else console.log(`[${ok ? 'PASS' : 'FAIL'}] ${test}`)
    },
  })

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log(
    `[modelica-node] completed in ${Date.now() - startedAt}ms: ${passed} passed, ${failed} failed`,
  )
  console.log('MODELICA_NODE_SUMMARY_START')
  console.log(
    JSON.stringify(
      {
        ok: failed === 0,
        discovered: Object.keys(all).length,
        selected: results.length,
        passed,
        failed,
        results,
      },
      null,
      2,
    ),
  )
  console.log('MODELICA_NODE_SUMMARY_END')
  if (failed > 0) process.exit(1)
}

await main()
