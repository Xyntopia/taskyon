export type DiagnosticsProviderSession = {
  provider: string
  model?: string
  authenticate: (runtime: {
    updateChatCompletionApiKey: (provider: string, value?: string) => Promise<void>
  }) => Promise<boolean>
}

export type DiagnosticsStorageClient = {
  getBlob: (request: { namespace: string; id: string }) => Promise<{
    data: Uint8Array
    metadata: {
      id: string
      size: number
      contentType?: string | undefined
      sha256?: string | undefined
      modifiedAt: string
    }
  } | null>
}

export type DiagnosticsStorageDownload = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export type DiagnosticsTestContext = {
  abortSignal?: AbortSignal
  tyauth?: string
  allowLongRun?: boolean
  isCypress?: boolean
  selectedApi?: string
  model?: string
  llmSettings?: unknown
  toolchainConfig?: unknown
  providerSession?: DiagnosticsProviderSession
  storageClient?: DiagnosticsStorageClient
  storageDownload?: DiagnosticsStorageDownload
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
  requiresJouliosRuntime?: boolean
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
  preparationFailed?: boolean
  details?: unknown
  error?: unknown
}

export type DiagnosticsRunOptions = {
  details?: boolean
  tyauth?: string
  timeoutMs?: number
  isCypress?: boolean
  context?: DiagnosticsTestContext
  contextForTest?: (
    name: string,
    test: TaskyonTestFn,
    context: DiagnosticsTestContext,
  ) => DiagnosticsTestContext | Promise<DiagnosticsTestContext>
  onProgress?: (progress: {
    phase: 'start' | 'finish'
    test: string
    ok?: boolean
    error?: unknown
  }) => void
  onResult?: (result: DiagnosticsRunResult) => void
  shouldAbort?: () => boolean
  onAbort?: (nextTest: string) => void
}

export function getDiagnosticsSkipReason(details: unknown): string | undefined {
  if (
    typeof details !== 'object' ||
    details === null ||
    !('skipped' in details) ||
    details.skipped !== true
  ) {
    return undefined
  }
  return 'reason' in details && typeof details.reason === 'string'
    ? details.reason
    : 'Required runtime capability is unavailable.'
}

const DEFAULT_DIAGNOSTICS_TEST_TIMEOUT_MS = 20_000
const MAX_DIAGNOSTICS_TEST_TIMEOUT_MS = 600_000

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
  opts?: DiagnosticsRunOptions,
): Promise<DiagnosticsRunResult[]> {
  const details = opts?.details ?? false
  const requestedDefaultTimeoutMs = opts?.timeoutMs ?? DEFAULT_DIAGNOSTICS_TEST_TIMEOUT_MS
  const defaultTimeoutMs = Math.min(requestedDefaultTimeoutMs, MAX_DIAGNOSTICS_TEST_TIMEOUT_MS)
  const out: DiagnosticsRunResult[] = []

  const withTimeout = async (
    name: string,
    timeoutMs: number,
    fn: () => Promise<unknown>,
    controller: AbortController,
  ) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(`Test timed out after ${timeoutMs}ms: ${name}`)
        reject(new Error(`Test timed out after ${timeoutMs}ms: ${name}`))
      }, timeoutMs)
    })
    try {
      return await Promise.race([Promise.resolve().then(fn), timeout])
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
    const controller = new AbortController()
    let preparing = false
    try {
      const fallbackContext =
        opts?.tyauth !== undefined || opts?.isCypress !== undefined
          ? {
              ...(opts?.tyauth !== undefined ? { tyauth: opts.tyauth } : {}),
              ...(opts?.isCypress !== undefined ? { isCypress: opts.isCypress } : {}),
            }
          : undefined
      const baseContext: DiagnosticsTestContext = {
        ...(opts?.context ?? fallbackContext),
        abortSignal: controller.signal,
      }
      const timeoutMs = testFn.timeoutMs ?? defaultTimeoutMs
      const run = async () => {
        if (testFn.requiresLongRun && !baseContext.allowLongRun) {
          return {
            skipped: true,
            reason: 'Requires explicit permission for long-running diagnostics.',
          }
        }
        preparing = opts?.contextForTest !== undefined
        const testOpts = opts?.contextForTest
          ? await opts.contextForTest(name, testFn, baseContext)
          : baseContext
        preparing = false
        if (testFn.requiresAuth && !testOpts.tyauth) {
          return { skipped: true, reason: 'Requires an authenticated Taskyon user session.' }
        }
        if (typeof testFn.setup === 'function') await testFn.setup(testOpts)
        return await testFn(testOpts)
      }
      const result = await withTimeout(name, timeoutMs, run, controller)
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
        ...(preparing ? { preparationFailed: true } : {}),
        error: normalizedError,
      })
      opts?.onResult?.(out[out.length - 1]!)
      opts?.onProgress?.({ phase: 'finish', test: name, ok: false, error: normalizedError })
    }
  }

  return out
}
