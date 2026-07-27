export type DiagnosticsTestContext = {
  tyauth?: string
  allowLongRun?: boolean
  isCypress?: boolean
  selectedApi?: string
  model?: string
  llmSettings?: unknown
  toolchainConfig?: unknown
  providerKey?: string
  providerAccessToken?: string
  accountId?: string
}

export interface TaskyonTestFn {
  (opts?: DiagnosticsTestContext): unknown
  setup?: (opts?: DiagnosticsTestContext) => unknown
  description?: string
  gui?: boolean
  experimental?: boolean
  requiresLargeTokens?: boolean
  requiresLongRun?: boolean
  requiresAuth?: boolean
  modelBased?: boolean
  helper?: boolean
  timeoutMs?: number
}

export type TestRecord = Record<string, TaskyonTestFn>

export type DiagnosticsRegistry = {
  tests: TestRecord
  guiTests: TestRecord
  experimentalTests: TestRecord
  modelBasedTests: TestRecord
  testsByFolder: Record<string, TestRecord>
  testsByFile: Record<string, TestRecord>
}

export type DiagnosticsTestModule = {
  sourcePath: string
  mod: unknown
}

export type DiagnosticsBuiltinTest = {
  testName: string
  func: TaskyonTestFn
  sourcePath: string
}

export type DiagnosticsRunResult = {
  name: string
  ok: boolean
  modelBased: boolean
  details?: unknown
  error?: unknown
}

const MAX_DIAGNOSTICS_TEST_TIMEOUT_MS = 20_000

function camelToNormal(input: string): string {
  if (!input) return ''
  const withSpaces = input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1)
}

function normalizeSourcePath(path: string): string {
  return path.replace(/^(\.\.\/)+/, '')
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/')
  if (idx < 0) return '.'
  return path.slice(0, idx)
}

function addToGroup(
  group: Record<string, TestRecord>,
  name: string,
  fn: TaskyonTestFn,
  key: string,
) {
  if (!group[key]) group[key] = {}
  group[key][name] = fn
}

export function buildDiagnosticsRegistry(args: {
  modules: DiagnosticsTestModule[]
  builtins?: DiagnosticsBuiltinTest[]
}): DiagnosticsRegistry {
  const tests: TestRecord = {}
  const guiTests: TestRecord = {}
  const experimentalTests: TestRecord = {}
  const modelBasedTests: TestRecord = {}
  const testsByFolder: Record<string, TestRecord> = {}
  const testsByFile: Record<string, TestRecord> = {}
  const registeredSources = new Map<string, string>()

  const registerTest = (testName: string, func: TaskyonTestFn, sourcePath: string) => {
    const name = camelToNormal(String(testName))
    if ('helper' in func) return
    const existingSource = registeredSources.get(name)
    if (existingSource) {
      throw new Error(
        `Duplicate diagnostic name "${name}" from "${existingSource}" and "${sourcePath}"`,
      )
    }
    registeredSources.set(name, sourcePath)
    if ('gui' in func) guiTests[name] = func
    else if ('experimental' in func) experimentalTests[name] = func
    else if (func.modelBased) modelBasedTests[name] = func
    else tests[name] = func

    addToGroup(testsByFile, name, func, sourcePath)
    addToGroup(testsByFolder, name, func, dirname(sourcePath))
  }

  for (const builtin of args.builtins ?? []) {
    registerTest(builtin.testName, builtin.func, builtin.sourcePath)
  }

  for (const { sourcePath, mod } of args.modules) {
    if (!mod || typeof mod !== 'object') continue
    for (const [name, fn] of Object.entries(mod as Record<string, unknown>)) {
      if (typeof fn !== 'function') continue
      registerTest(name, fn as TaskyonTestFn, normalizeSourcePath(sourcePath))
    }
  }

  return {
    tests,
    guiTests,
    experimentalTests,
    modelBasedTests,
    testsByFolder,
    testsByFile,
  }
}

export async function runDiagnosticsTests(
  tests: TestRecord,
  opts?: {
    details?: boolean
    tyauth?: string
    timeoutMs?: number
    isCypress?: boolean
    context?: DiagnosticsTestContext
    onProgress?: (progress: {
      phase: 'start' | 'finish'
      test: string
      ok?: boolean
      error?: unknown
    }) => void
    onResult?: (result: DiagnosticsRunResult) => void
    shouldAbort?: () => boolean
    onAbort?: (nextTest: string) => void
  },
): Promise<DiagnosticsRunResult[]> {
  const details = opts?.details ?? false
  const requestedDefaultTimeoutMs = opts?.timeoutMs ?? MAX_DIAGNOSTICS_TEST_TIMEOUT_MS
  const defaultTimeoutMs = Math.min(requestedDefaultTimeoutMs, MAX_DIAGNOSTICS_TEST_TIMEOUT_MS)
  const out: DiagnosticsRunResult[] = []

  const withTimeout = async (name: string, timeoutMs: number, fn: () => Promise<unknown>) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`Test timed out after ${timeoutMs}ms: ${name}`))
          }, timeoutMs)
        }),
      ])
    } finally {
      if (timer !== null) clearTimeout(timer)
    }
  }

  for (const [name, testFn] of Object.entries(tests)) {
    if (opts?.shouldAbort?.()) {
      opts.onAbort?.(name)
      break
    }
    opts?.onProgress?.({ phase: 'start', test: name })
    try {
      const fallbackContext =
        opts?.tyauth !== undefined || opts?.isCypress !== undefined
          ? {
              ...(opts?.tyauth !== undefined ? { tyauth: opts.tyauth } : {}),
              ...(opts?.isCypress !== undefined ? { isCypress: opts.isCypress } : {}),
            }
          : undefined
      const testOpts: DiagnosticsTestContext | undefined = opts?.context ?? fallbackContext
      const unavailable =
        testFn.requiresAuth && !testOpts?.tyauth
          ? {
              skipped: true,
              reason: 'Requires an authenticated Taskyon user session.',
            }
          : undefined
      if (!unavailable && typeof testFn.setup === 'function') {
        await Promise.resolve(testFn.setup(testOpts))
      }
      const timeoutMs = testFn.timeoutMs ?? defaultTimeoutMs
      const run = () => Promise.resolve(testFn(testOpts))
      const result = unavailable ?? (await withTimeout(name, timeoutMs, run))
      const skipped =
        typeof result === 'object' &&
        result !== null &&
        'skipped' in result &&
        result.skipped === true
      out.push({
        name,
        ok: true,
        modelBased: testFn.modelBased === true,
        details: details || skipped ? result : undefined,
      })
      opts?.onResult?.(out[out.length - 1]!)
      opts?.onProgress?.({ phase: 'finish', test: name, ok: true })
    } catch (error) {
      const normalizedError =
        error instanceof Error
          ? { message: error.message, stack: error.stack, cause: error.cause, name: error.name }
          : error
      out.push({
        name,
        ok: false,
        modelBased: testFn.modelBased === true,
        error: normalizedError,
      })
      opts?.onResult?.(out[out.length - 1]!)
      opts?.onProgress?.({ phase: 'finish', test: name, ok: false, error: normalizedError })
    }
  }

  return out
}
