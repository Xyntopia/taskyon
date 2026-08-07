import { executeInWorkerSandbox } from '@taskyon/common/modules/sandbox/workerSandbox'
import { createCapabilityPolicy, type CapabilityRequest } from '../security/capabilityPolicy'
import { createMediatedFetch } from '../security/mediatedFetch'
import { executePythonScript } from '../tools/executePython'
import { createSubtasksResult } from '../types/toolApi'
import { executeToolInWorkerSandbox } from '../utils/executeToolInWorkerSandbox'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testCapabilityDecisionsCanBeReset = async () => {
  const storedDecisions = new Map<string, 'allow' | 'deny'>()
  let promptDecision: 'allow' | 'deny' = 'deny'
  const prompts: Array<'allow' | 'deny'> = []
  const policy = createCapabilityPolicy({
    storage: {
      get: (key) => Promise.resolve(storedDecisions.get(key) ?? null),
      set: (key, decision) => {
        storedDecisions.set(key, decision)
        return Promise.resolve()
      },
      delete: (key) => {
        storedDecisions.delete(key)
        return Promise.resolve()
      },
      clear: () => {
        storedDecisions.clear()
        return Promise.resolve()
      },
    },
    prompt: () => {
      prompts.push(promptDecision)
      return Promise.resolve({ decision: promptDecision, scope: 'permanent' })
    },
  })
  const request = {
    tool: {
      publisherId: 'test',
      name: 'gitlabTool',
      revision: 'sha256:test-revision',
    },
    capability: {
      action: 'popup' as const,
      target: 'origin:https://gitlab.com' as const,
    },
  } satisfies CapabilityRequest

  assert(!(await policy.authorize(request)), 'Expected the first popup request to be denied')
  assert(!(await policy.authorize(request)), 'Expected the persisted denial to be reused')
  assert(prompts.length === 1, 'Expected a persisted decision to skip the second prompt')

  promptDecision = 'allow'
  await policy.reset()

  assert(await policy.authorize(request), 'Expected reset to permit a new authorization decision')
  assert(prompts[1] === 'allow', 'Expected reset to clear the persisted and session decisions')

  const fetchRequest = {
    tool: request.tool,
    capability: {
      action: 'fetch' as const,
      origin: 'https://gitlab.com',
      access: 'read' as const,
    },
  } satisfies CapabilityRequest
  assert(await policy.authorize(fetchRequest), 'Expected the network request to be allowed')
  assert(prompts[2] === 'allow', 'Popup and network access must remain separate decisions')
}

testCapabilityDecisionsCanBeReset.description =
  'Capability policy reset clears decisions while popup and network permissions remain independent.'

export async function tool_security_contractsMediatedFetchAuthorizesOncePerExecution() {
  let authorizationCount = 0
  const mediatedFetch = createMediatedFetch({
    authorize: () => {
      authorizationCount += 1
      return Promise.resolve(true)
    },
    fetch: () => Promise.resolve(new Response('ok')),
  })

  await mediatedFetch('https://gitlab.com/api/v4/user')
  await mediatedFetch('https://gitlab.com/api/v4/issues')

  assert(
    authorizationCount === 1,
    `Expected one authorization for the tool execution, got ${authorizationCount}`,
  )
}

tool_security_contractsMediatedFetchAuthorizesOncePerExecution.description =
  'A capability decision covers repeated requests to the same origin during one tool execution.'

export async function tool_security_contractsMediatedFetchBlocksPrivateNetworks() {
  let hostFetchCalled = false
  const mediatedFetch = createMediatedFetch({
    authorize: () => Promise.resolve(true),
    fetch: () => {
      hostFetchCalled = true
      return Promise.resolve(new Response('unexpected'))
    },
  })

  await mediatedFetch('http://127.0.0.1/admin').then(
    () => {
      throw new Error('Private network request unexpectedly succeeded')
    },
    () => undefined,
  )
  assert(!hostFetchCalled, 'Blocked targets must not reach the host fetch implementation')
  await mediatedFetch('https://[::ffff:127.0.0.1]/admin').then(
    () => {
      throw new Error('IPv4-mapped private request unexpectedly succeeded')
    },
    () => undefined,
  )
}

tool_security_contractsMediatedFetchBlocksPrivateNetworks.description =
  'Sandbox fetch rejects loopback, private, link-local, and metadata targets before authorization or I/O.'

export async function tool_security_contractsMediatedFetchTimesOut() {
  let hostRequestAborted = false
  const hostFetch: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => {
          hostRequestAborted = true
          reject(new Error('Host request aborted after the fetch deadline'))
        },
        { once: true },
      )
    })
  const mediatedFetch = createMediatedFetch({
    authorize: () => Promise.resolve(true),
    fetch: hostFetch,
    timeoutMs: 20,
  })

  await mediatedFetch('https://gitlab.com/api/v4/user').then(
    () => {
      throw new Error('A stalled sandbox request unexpectedly completed')
    },
    () => undefined,
  )
  assert(hostRequestAborted, 'The fetch timeout must abort the host request')
}

tool_security_contractsMediatedFetchTimesOut.description =
  'Taskyon-mediated fetch aborts stalled host requests instead of leaving tools processing forever.'

export async function tool_security_contractsMediatedFetchUsesToolCancellation() {
  const stopController = new AbortController()
  let markRequestStarted: (() => void) | undefined
  const requestStarted = new Promise<void>((resolve) => {
    markRequestStarted = resolve
  })
  let hostRequestAborted = false
  const hostFetch: typeof fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      markRequestStarted?.()
      init?.signal?.addEventListener(
        'abort',
        () => {
          hostRequestAborted = true
          reject(new Error('Host request aborted after tool cancellation'))
        },
        { once: true },
      )
    })
  const request = createMediatedFetch({
    authorize: () => Promise.resolve(true),
    fetch: hostFetch,
    signal: stopController.signal,
  })('https://gitlab.com/api/v4/user')

  await requestStarted
  stopController.abort('diagnostic stop')
  await request.then(
    () => {
      throw new Error('A cancelled sandbox request unexpectedly completed')
    },
    () => undefined,
  )
  assert(hostRequestAborted, 'Stopping a tool must abort its active host request')
}

tool_security_contractsMediatedFetchUsesToolCancellation.description =
  'Taskyon-mediated fetch propagates tool cancellation to the active host request.'

export async function tool_security_contractsSandboxUsesOnlyMediatedFetch() {
  const stopController = new AbortController()
  const result = (await executeToolInWorkerSandbox(
    `async (_params, ctx) => ({
      body: await (await fetch('https://example.com/data')).text(),
      contextBody: await (await ctx.fetch('https://example.com/context')).text(),
      processType: typeof process,
      constructorProcessType: (() => {
        try {
          return globalThis.constructor.constructor('return typeof process')();
        } catch {
          return 'blocked';
        }
      })(),
    })`,
    {
      params: {},
      context: {
        getExecutionTaskChain: () => Promise.resolve([]),
        createSubtasksResult,
        getSecret: () => Promise.resolve(null),
        setSecret: () => Promise.resolve(),
        stopSignal: stopController.signal,
        toolId: `security-fetch-${Date.now()}`,
        fetch: (input) => Promise.resolve(new Response(`mediated:${String(input)}`)),
      },
    },
    'security-fetch.js',
    stopController.signal,
  )) as {
    body: string
    contextBody: string
    processType: string
    constructorProcessType: string
  }

  assert(result.body === 'mediated:https://example.com/data', 'Global fetch must use the host port')
  assert(
    result.contextBody === 'mediated:https://example.com/context',
    'Context fetch must use the same host capability',
  )
  assert(result.processType === 'undefined', 'Node process must not be visible to sandbox code')
  assert(
    result.constructorProcessType !== 'object',
    'Sandbox constructors must not recover the Node process object',
  )
}

tool_security_contractsSandboxUsesOnlyMediatedFetch.description =
  'Browser and CLI sandboxes route global and context fetch through the typed host capability.'

export async function tool_security_contractsSandboxStopsCpuLoops() {
  const startedAt = Date.now()
  await executeInWorkerSandbox({
    id: `security-timeout-${startedAt}`,
    code: '() => { while (true) {} }',
    stopSignal: new AbortController().signal,
    maxExecutionMs: 50,
  }).then(
    () => {
      throw new Error('Infinite sandbox program unexpectedly completed')
    },
    () => undefined,
  )
  assert(Date.now() - startedAt < 2_000, 'CPU limit must destroy the retained sandbox promptly')
}

tool_security_contractsSandboxStopsCpuLoops.description =
  'A synchronous CPU loop is stopped by destroying its retained browser worker or CLI subprocess.'

export async function tool_security_contractsSandboxExecutesWasmInsideWorker() {
  const result = await executeInWorkerSandbox<number>({
    id: `security-wasm-${Date.now()}`,
    nodeRuntime: 'deno',
    code: `async () => {
      const bytes = new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0,
        7, 7, 1, 3, 114, 117, 110, 0, 0, 10, 6, 1, 4, 0, 65, 42, 11,
      ]);
      const { instance } = await WebAssembly.instantiate(bytes);
      return instance.exports.run();
    }`,
    stopSignal: new AbortController().signal,
  })

  assert(result === 42, 'WASM must execute inside the ordinary JavaScript sandbox')
}

tool_security_contractsSandboxExecutesWasmInsideWorker.description =
  'Ordinary sandbox JavaScript can instantiate bundled WASM without a host runtime callback.'

export async function tool_security_contractsPythonUsesReusableBrowserSandbox() {
  if (typeof window === 'undefined') return
  const stopController = new AbortController()
  assert(executePythonScript.code, 'Python must be implemented as standard sandbox code')
  assert(!('function' in executePythonScript), 'Python must not use a trusted native tool function')
  assert(!('sandboxRuntime' in executePythonScript), 'Tools must not declare a special runtime')
  const result = (await executeToolInWorkerSandbox(
    executePythonScript.code,
    {
      params: {
        code: `import js
from pyodide.code import run_js
from pyodide.http import pyfetch
from pyodide_js._api import abortSignalAny
try:
    process_type = run_js('typeof process')
except (ImportError, AttributeError):
    process_type = 'blocked'
try:
    fetch_constructor_process_type = js.fetch.constructor.constructor('return typeof process')()
except (AttributeError, TypeError):
    fetch_constructor_process_type = 'blocked'
try:
    fetch_promise = js.fetch('https://example.com/data')
    fetch_promise_process_type = fetch_promise.constructor.constructor('return typeof process')()
except (AttributeError, TypeError):
    fetch_promise_process_type = 'blocked'
try:
    pyodide_api_process_type = abortSignalAny.constructor.constructor('return typeof process')()
except (AttributeError, TypeError):
    pyodide_api_process_type = 'blocked'
host_file_access = 'blocked'
host_network_access = 'blocked'
try:
    deno = abortSignalAny.constructor.constructor('return Deno')()
    try:
        await deno.readTextFile('/etc/passwd')
        host_file_access = 'allowed'
    except Exception:
        pass
    try:
        await deno.resolveDns('example.com', 'A')
        host_network_access = 'allowed'
    except Exception:
        pass
except Exception:
    pass
response = await pyfetch('https://example.com/data')
try:
    response_process_type = response.js_response.constructor.constructor('return typeof process')()
except (AttributeError, TypeError):
    response_process_type = 'blocked'
response_worker_type = response.js_response.constructor.constructor('return typeof Worker')()
response_indexed_db_type = response.js_response.constructor.constructor('return typeof indexedDB')()
('process' in dir(js), process_type, fetch_constructor_process_type, fetch_promise_process_type, pyodide_api_process_type, host_file_access, host_network_access, response_process_type, response_worker_type, response_indexed_db_type, 6 * 7)`,
      },
      context: {
        getExecutionTaskChain: () => Promise.resolve([]),
        createSubtasksResult,
        getSecret: () => Promise.resolve(null),
        setSecret: () => Promise.resolve(),
        stopSignal: stopController.signal,
        toolId: 'executePythonScript:test-revision',
        fetch: () => Promise.resolve(new Response('mediated')),
      },
    },
    'executePythonScript.js',
    stopController.signal,
  )) as { result?: unknown }
  assert(result?.result !== undefined, 'Python sandbox did not return a result')
  const serializedResult = JSON.stringify(result.result)
  assert(serializedResult.includes('42'), 'Python sandbox returned the wrong calculation')
  assert(!serializedResult.includes('true'), 'Pyodide must not expose the Node process object')
  assert(!serializedResult.includes('allowed'), 'Pyodide must not gain host I/O permissions')
  assert(!serializedResult.includes('function'), 'Pyodide must not recover Worker constructors')
}

tool_security_contractsPythonUsesReusableBrowserSandbox.description =
  'Browser Python runs in reusable Pyodide with a restricted JavaScript global scope.'
tool_security_contractsPythonUsesReusableBrowserSandbox.timeoutMs = 120_000
