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

const createContext = (
  label: string,
  toolId = 'concurrent-tool-sandbox-test',
): toolContext => ({
  toolId,
  stopSignal: new AbortController().signal,
  getExecutionTaskChain: () => Promise.resolve([]),
  createSubtasksResult,
  getSecret: () => Promise.resolve(`${label}-secret`),
  setSecret: () => Promise.resolve(),
  waitForInteraction: (request) => Promise.resolve({ label, request }),
})

export const testToolSandboxResolvesInvocationRevisionsOnDemand = async () => {
  const requested: string[] = []
  const context: toolContext = {
    ...createContext('revision', 'invocation-revision-sandbox-test'),
    resolveInvocation: ({ name }) => {
      requested.push(name)
      return Promise.resolve({ toolRevision: `sha256:${'a'.repeat(43)}` })
    },
  }
  const result = await executeToolInWorkerSandbox(
    `async (_params, ctx) => await ctx.resolveInvocation({ name: 'targetTool' })`,
    { params: {}, context },
    'invocation-revision.sandbox.js',
    new AbortController().signal,
  )

  assert(requested.join(',') === 'targetTool', 'Expected one explicit revision lookup')
  assert(
    typeof result === 'object' && result !== null && 'toolRevision' in result,
    'Expected only opaque invocation revisions in the sandbox response',
  )
}

testToolSandboxResolvesInvocationRevisionsOnDemand.description =
  'Lets sandboxed tools request one target invocation revision without receiving global settings.'

export const testToolSandboxReceivesCompiledSubtasks = async () => {
  const context: toolContext = {
    ...createContext('compile', 'compiled-subtasks-sandbox-test'),
    createSubtasksResult: (tasks) => {
      const result = createSubtasksResult(tasks)
      return Promise.resolve({
        ...result,
        taskChainList: result.taskChainList.map((chain) =>
          chain.map((task) => ({ ...task, id: 'compiled-task-id' })),
        ),
      })
    },
  }
  const result = await executeToolInWorkerSandbox(
    `async (_params, ctx) => {
      const result = await ctx.createSubtasksResult({
        role: 'assistant',
        content: { type: 'message', data: 'draft' },
      });
      return result.taskChainList[0][0].id;
    }`,
    { params: {}, context },
    'compiled-subtasks.sandbox.js',
    new AbortController().signal,
  )

  assert(result === 'compiled-task-id', 'Expected the sandbox to receive compiled child tasks')
}

testToolSandboxReceivesCompiledSubtasks.description =
  'Returns the trusted core result of subtask compilation across the sandbox RPC boundary.'

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
