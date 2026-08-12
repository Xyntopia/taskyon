import * as ModelicaDiagnostics from '@taskyon/modelica/modelicaDiagnostics'
import { runDiagnosticsTests, type TestRecord } from '@taskyon/common/modules/diagnosticsRunner'
import {
  resolveBundledRumocaWasmPath,
  resolveCachedModelicaLibraryZip,
} from '@taskyon/modelica/modelicaLibraryCacheNode'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import {
  createProtocolPort,
  createStorageClient,
  taskyonStorageProtocol,
  type TaskyonStorageClient,
} from '@taskyon/taskyon/api'
import { resolveDataDirectoryPath } from '../cli/config'
import { createCliFileStorageService } from '../cli/fileStorage'

const rumocaWasmPath = resolveBundledRumocaWasmPath()
const rumocaWasmUrl = pathToFileURL(rumocaWasmPath).href
const mslReleaseZipUrl =
  'https://github.com/modelica/ModelicaStandardLibrary/archive/refs/tags/v4.1.0.zip'

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

const installNodeFetchWasmFallback = async (storageClient: TaskyonStorageClient) => {
  const nativeFetch = globalThis.fetch?.bind(globalThis)
  if (!nativeFetch) return
  const cachedMsl = await resolveCachedModelicaLibraryZip(storageClient)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (
      typeof url === 'string' &&
      (url.endsWith('/rumoca_bind_wasm_bg.wasm') || url === rumocaWasmUrl)
    ) {
      const bytes = await readFile(rumocaWasmPath)
      return new Response(toArrayBuffer(bytes), {
        status: 200,
        headers: { 'content-type': 'application/wasm' },
      })
    }
    if (typeof url === 'string' && url === mslReleaseZipUrl) {
      return new Response(toArrayBuffer(cachedMsl.data), {
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

const collectModelicaTests = (storageClient: TaskyonStorageClient): TestRecord => {
  const tests: TestRecord = {}
  for (const [name, value] of Object.entries(ModelicaDiagnostics as Record<string, unknown>)) {
    if (!name.startsWith('testModelica')) continue
    if (typeof value !== 'function') continue
    tests[camelToNormal(name)] =
      name === 'testModelicaMslFirstOrderRumocaSimulation'
        ? () => (value as (client: TaskyonStorageClient) => unknown)(storageClient)
        : (value as TestRecord[string])
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
  const storagePort = createProtocolPort(taskyonStorageProtocol)
  const stopStorage = createCliFileStorageService(
    storagePort.y,
    join(await resolveDataDirectoryPath(), 'storage'),
  )
  const storageClient = createStorageClient(storagePort.x, {
    namespacePrefix: 'taskyon',
    distribution: 'local-only',
  })
  try {
    await installNodeFetchWasmFallback(storageClient)
    if (!process.env.MODELICA_DIAG_RUNTIME_TIMEOUT_MS) {
      process.env.MODELICA_DIAG_RUNTIME_TIMEOUT_MS = '60000'
    }
    const opts = parseArgs(process.argv.slice(2))
    const all = collectModelicaTests(storageClient)
    const selected = filterTests(all, opts.filter)
    const names = Object.keys(selected)
    console.log(`[modelica-node] discovered ${Object.keys(all).length} tests`)
    console.log(
      `[modelica-node] selected ${names.length} tests${opts.filter ? ` (filter="${opts.filter}")` : ''}`,
    )
    if (names.length === 0) {
      console.error('[modelica-node] no tests selected')
      process.exitCode = 1
      return
    }

    const startedAt = Date.now()
    const results = await runDiagnosticsTests(selected, {
      details: opts.details,
      onProgress: ({ phase, test, ok }) => {
        if (phase === 'start') console.log(`[RUN ] ${test}`)
        else console.log(`[${ok ? 'PASS' : 'FAIL'}] ${test}`)
      },
    })

    const passed = results.filter((result) => result.ok).length
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
    if (failed > 0) process.exitCode = 1
  } finally {
    stopStorage()
  }
}

await main()
