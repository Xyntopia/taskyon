export interface TaskyonTestFn {
  (opts?: { tyauth?: string; isCypress?: boolean }): unknown
  description?: string
  gui?: boolean
  experimental?: boolean
  helper?: boolean
  timeoutMs?: number
}

export type TestRecord = Record<string, TaskyonTestFn>

export type DiagnosticsRegistry = {
  tests: TestRecord
  guiTests: TestRecord
  experimentalTests: TestRecord
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
  details?: unknown
  error?: unknown
}

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
  const testsByFolder: Record<string, TestRecord> = {}
  const testsByFile: Record<string, TestRecord> = {}

  const registerTest = (testName: string, func: TaskyonTestFn, sourcePath: string) => {
    const name = camelToNormal(String(testName))
    if ('helper' in func) return
    if ('gui' in func) guiTests[name] = func
    else if ('experimental' in func) experimentalTests[name] = func
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
  const defaultTimeoutMs = opts?.timeoutMs ?? 60_000
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
      let testOpts: { tyauth?: string; isCypress?: boolean } | undefined
      if (opts?.tyauth !== undefined || opts?.isCypress !== undefined) {
        testOpts = {}
        if (opts?.tyauth !== undefined) testOpts.tyauth = opts.tyauth
        if (opts?.isCypress !== undefined) testOpts.isCypress = opts.isCypress
      }
      const timeoutMs = testFn.timeoutMs ?? defaultTimeoutMs
      const run = () => Promise.resolve(testFn(testOpts))
      const result = timeoutMs !== undefined ? await withTimeout(name, timeoutMs, run) : await run()
      out.push({
        name,
        ok: true,
        details: details ? result : undefined,
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
        error: normalizedError,
      })
      opts?.onResult?.(out[out.length - 1]!)
      opts?.onProgress?.({ phase: 'finish', test: name, ok: false, error: normalizedError })
    }
  }

  return out
}
