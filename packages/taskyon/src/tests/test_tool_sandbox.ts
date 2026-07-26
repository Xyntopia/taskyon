import { createSubtasksResult, type toolContext } from '../types/toolApi.ts'
import { executeToolInWorkerSandbox } from '../utils/executeToolInWorkerSandbox.ts'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const toolCode = `async (params, ctx) => ({
  label: params.label,
  secret: await ctx.getSecret('token', false),
  interaction: await ctx.waitForInteraction({ tool: 'test', token: params.label }),
})`

const createContext = (label: string): toolContext => ({
  toolId: 'concurrent-tool-sandbox-test',
  stopSignal: new AbortController().signal,
  getExecutionTaskChain: () => Promise.resolve([]),
  createSubtasksResult,
  getSecret: () => Promise.resolve(`${label}-secret`),
  setSecret: () => Promise.resolve(),
  waitForInteraction: (request) => Promise.resolve({ label, request }),
})

export const testToolSandboxKeepsConcurrentCapabilitiesIsolated = async () => {
  const controller = new AbortController()
  const [first, second] = await Promise.all([
    executeToolInWorkerSandbox(
      toolCode,
      { params: { label: 'A' }, context: createContext('A') },
      'concurrent-tool.sandbox.js',
      controller.signal,
    ),
    executeToolInWorkerSandbox(
      toolCode,
      { params: { label: 'B' }, context: createContext('B') },
      'concurrent-tool.sandbox.js',
      controller.signal,
    ),
  ])
  if (
    typeof first !== 'object' ||
    first === null ||
    !('secret' in first) ||
    typeof second !== 'object' ||
    second === null ||
    !('secret' in second)
  ) {
    throw new Error('Expected object results from both sandbox calls.')
  }
  assert(first.secret === 'A-secret', 'Expected the first call to retain its tool context.')
  assert(second.secret === 'B-secret', 'Expected the second call to retain its tool context.')
  return { success: true }
}

testToolSandboxKeepsConcurrentCapabilitiesIsolated.description =
  'Runs concurrent calls for one immutable tool in one sandbox with execution-scoped capabilities.'
