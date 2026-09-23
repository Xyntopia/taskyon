import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import type { JSONSchema7 } from 'json-schema'
import {
  createTaskyonClient,
  createTaskyonHostClient,
  setTaskyonProviderCredential,
} from '../../../api'
import { buildCreateNewTaskChain } from '../../../core/createNewTaskChain'
import { tyCore, type Taskyon } from '../../../core/init'
import { createPortableTestStorage } from '../../../testSupport/portableTestStorage'
import {
  authenticateDiagnosticsRuntime,
  resolveDiagnosticsRuntimeConfig,
  type WorkflowDiagnosticsTestContext,
} from '../../../testSupport/onlineProviderSupport'
import { readPublicWebPageAsMarkdown } from '../../../tools/helperCollection'
import { hasProviderWebSearchObservation } from '../../../tools/chatCompletion/streamResult'
import { type TaskNode } from '../../../types/taskNode'
import { createTool, type InternalTool } from '../../../types/toolApi'
import { createInMemoryDatabase } from '../../../utils/pglite.api'
import {
  getWorkflowDeviation,
  hasSearchSource,
  searchStreamContent,
  waitForTaskMeta,
  workflowSteps,
  verifySearchedComputation,
} from './workflowTestSupport'

type TaskWithParent = TaskNode & { parentID: string }
type ExpectedWorkflows = (entryNodeName: string) => readonly (readonly string[])[]

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const functionCalls = (tasks: readonly TaskNode[], name: string) =>
  tasks.filter((task) => task.content.type === 'functioncall' && task.content.data.name === name)

const assistantAnswer = (tasks: readonly TaskNode[]) => {
  const message = [...tasks]
    .reverse()
    .find((task) => task.role === 'assistant' && task.content.type === 'message')
  assert(message?.content.type === 'message', 'Expected an assistant answer')
  return message.content.data
}

const simpleAnswerWorkflows: ExpectedWorkflows = () => [['chatCompletion', 'assistant', 'return']]

const directToolWorkflows: ExpectedWorkflows = (entryNodeName) =>
  ['executeJavaScript', 'bash'].map((toolName) => [
    'chatCompletion',
    toolName,
    'tool result',
    entryNodeName,
    'chatCompletion',
    'assistant',
    'return',
  ])

const combinedWorkflows: ExpectedWorkflows = (entryNodeName) => [
  ...directToolWorkflows(entryNodeName),
  ...['executeJavaScript', 'bash'].flatMap((firstTool) =>
    ['executeJavaScript', 'bash'].map((secondTool) => [
      'chatCompletion',
      firstTool,
      'tool result',
      entryNodeName,
      'chatCompletion',
      secondTool,
      'tool result',
      entryNodeName,
      'chatCompletion',
      'assistant',
      'return',
    ]),
  ),
]

const discoveredToolWorkflows: ExpectedWorkflows = (entryNodeName) => [
  [
    'chatCompletion',
    'selectTaskyonTools',
    entryNodeName,
    'entryNodeToolSearch',
    entryNodeName,
    'toolSearcher',
    'tool result',
    entryNodeName,
    'chatCompletion',
    'readWorkflowFixturePhrase',
    'tool result',
    entryNodeName,
    'chatCompletion',
    'assistant',
    'return',
  ],
]

const createConversationHarness = async (
  context: DiagnosticsTestContext,
  runtimeConfig: NonNullable<ReturnType<typeof resolveDiagnosticsRuntimeConfig>>,
  extraTools: InternalTool[],
) => {
  const workflowHost = (context as WorkflowDiagnosticsTestContext).workflowDiagnosticsHost
  if (!workflowHost) throw new Error('Workflow diagnostics require the active host tool setup')
  const storage = createPortableTestStorage()
  const database = await createInMemoryDatabase('ideal-workflow-diagnostic')
  const entryNodeName = runtimeConfig.settings.entryFunction
  let ty: Taskyon
  try {
    ty = await tyCore(
      () => runtimeConfig.settings,
      () => ({
        role: 'system',
        content: { type: 'functioncall', data: { name: entryNodeName, arguments: {} } },
      }),
      runtimeConfig.toolchainConfig,
      undefined,
      {
        databaseFactory: () => Promise.resolve(database),
        indexTaskVectors: false,
        taskManagerStorageFactory: storage.taskManagerStorageFactory,
        toolSetup: workflowHost.createToolSetup(storage.storageClient),
      },
    )
  } catch (error) {
    storage.destroy()
    await database.close()
    throw error
  }
  const client = createTaskyonClient(ty.port)
  const executor = await workflowHost.registerTools(ty, extraTools)
  return {
    ty,
    database,
    client,
    entryNodeName,
    cleanup: () => {
      executor.destroy()
      storage.destroy()
    },
  }
}

const waitForConversation = (
  ty: Taskyon,
  createChain: () => Promise<{ ids: string[] }>,
  expectedWorkflows: readonly (readonly string[])[],
  label: string,
  timeoutMs: number,
  abortSignal?: AbortSignal,
) =>
  new Promise<{ terminal: TaskNode; observed: TaskNode[] }>((resolve, reject) => {
    const seen = new Set<string>()
    const pending = new Map<string, TaskWithParent[]>()
    const observed: TaskNode[] = []
    let finished = false
    const stop = () => {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      unsubscribe()
      abortSignal?.removeEventListener('abort', onAbort)
    }
    const fail = (message: string) => {
      if (finished) return
      stop()
      ty.cancelCurrentRun(message)
      reject(new Error(`${message}; observed: ${workflowSteps(observed).join(' → ')}`))
    }
    const onAbort = () => fail('Ideal workflow diagnostic cancelled')
    const observe = (task: TaskWithParent) => {
      if (finished || seen.has(task.id)) return
      seen.add(task.id)
      observed.push(task)
      const deviation = getWorkflowDeviation(workflowSteps(observed), expectedWorkflows, label)
      if (deviation) return fail(deviation)
      if (task.content.type === 'error') return fail('Task processing produced an error')
      if (task.content.type === 'return') {
        stop()
        resolve({ terminal: task, observed })
        return
      }
      const children = pending.get(task.id) ?? []
      pending.delete(task.id)
      children.forEach(observe)
    }
    const unsubscribe = ty.port.receive((message) => {
      if (message.type !== 'taskCreated' || !message.task?.parentID) return
      const task = message.task as TaskWithParent
      if (seen.has(task.parentID)) observe(task)
      else pending.set(task.parentID, [...(pending.get(task.parentID) ?? []), task])
    })
    const timeout = setTimeout(
      () => fail(`Ideal workflow timed out after ${timeoutMs}ms`),
      timeoutMs,
    )
    abortSignal?.addEventListener('abort', onAbort, { once: true })
    if (abortSignal?.aborted) return onAbort()
    void createChain()
      .then(({ ids }) => {
        for (const id of ids) {
          seen.add(id)
          const children = pending.get(id) ?? []
          pending.delete(id)
          children.forEach(observe)
        }
      })
      .catch((error: unknown) =>
        fail(error instanceof Error ? error.message : 'Chain creation failed'),
      )
  })

export const runVerifiedWorkflow = async (
  context: DiagnosticsTestContext | undefined,
  model: string | undefined,
  input: {
    label: string
    prompt: string
    mode: 'message' | 'websearch'
    expectedWorkflows: ExpectedWorkflows
    extraTool?: InternalTool
    timeoutMs: number
  },
) => {
  if (!context?.providerSession) {
    return { success: false as const, skipped: true, reason: 'No provider session was available.' }
  }
  if (!model) {
    return { success: false as const, skipped: true, reason: 'No diagnostic model was selected.' }
  }
  const baseRuntimeConfig = resolveDiagnosticsRuntimeConfig(context)
  if (!baseRuntimeConfig) {
    return { success: false as const, skipped: true, reason: 'No runtime settings were available.' }
  }
  const modelContext: DiagnosticsTestContext = {
    ...context,
    model,
    selectedApi: baseRuntimeConfig.providerSettings.provider,
    providerSession: { ...context.providerSession, model },
    toolchainConfig: {
      ...baseRuntimeConfig.toolchainConfig,
      chatCompletion: { ...baseRuntimeConfig.providerSettings, model },
    },
  }
  const runtimeConfig = resolveDiagnosticsRuntimeConfig(modelContext)
  if (!runtimeConfig) {
    return { success: false as const, skipped: true, reason: 'No runtime settings were available.' }
  }
  const { ty, database, client, entryNodeName, cleanup } = await createConversationHarness(
    modelContext,
    runtimeConfig,
    input.extraTool ? [input.extraTool] : [],
  )
  try {
    const host = createTaskyonHostClient(ty.hostPort)
    if (
      !(await authenticateDiagnosticsRuntime(modelContext, {
        updateChatCompletionApiKey: (provider, value) =>
          setTaskyonProviderCredential(host, provider, value),
      }))
    ) {
      return { success: false as const, skipped: true, reason: 'Provider session unavailable.' }
    }
    const taskChain = buildCreateNewTaskChain({
      currentTask: null,
      draftTask: { role: 'user', content: { type: 'message', data: input.prompt } },
      entryNode: {
        role: 'system',
        content: { type: 'functioncall', data: { name: entryNodeName, arguments: {} } },
      },
      mode: input.mode,
    })
    const initialEntryNode = taskChain.at(-1)
    assert(
      initialEntryNode?.content.type === 'functioncall' &&
        initialEntryNode.content.data.name === entryNodeName &&
        typeof initialEntryNode.content.data.arguments.websearch === 'object' &&
        initialEntryNode.content.data.arguments.websearch !== null &&
        !Array.isArray(initialEntryNode.content.data.arguments.websearch) &&
        'mode' in initialEntryNode.content.data.arguments.websearch &&
        initialEntryNode.content.data.arguments.websearch.mode === 'auto',
      'Expected the initial entry node to enable automatic web search',
    )
    const { terminal, observed } = await waitForConversation(
      ty,
      () => client.task.createChain({ tasks: taskChain, execute: true, show: true }),
      input.expectedWorkflows(entryNodeName),
      input.label,
      input.timeoutMs,
      modelContext.abortSignal,
    )
    const ids = await client.task.getIdChain({ id: terminal.id })
    const tasks = await ty.convertTaskIDs(ids)
    const flow = workflowSteps(tasks)
    const observedFlow = workflowSteps(observed)
    assert(
      flow[0] === 'user' && flow[1] === entryNodeName,
      `Expected the workflow to start with the user and entry node, got ${flow.join(' → ')}`,
    )
    const deviation = getWorkflowDeviation(
      observedFlow,
      input.expectedWorkflows(entryNodeName),
      input.label,
      true,
    )
    assert(!deviation, deviation ?? `Unexpected ${input.label} workflow`)
    assert(!tasks.some((task) => task.content.type === 'error'), 'Workflow produced an error task')
    const completionMetas = await Promise.all(
      functionCalls(tasks, 'chatCompletion').map(
        async (call) => await waitForTaskMeta(ty.getMeta, call.id),
      ),
    )
    return {
      success: true as const,
      model,
      entryNodeName,
      taskChain,
      tasks,
      flow,
      observedFlow,
      completionMetas,
    }
  } finally {
    try {
      await ty.dispose('ideal workflow diagnostic complete')
    } finally {
      cleanup()
      await database.close()
    }
  }
}
runVerifiedWorkflow.helper = true

export const testSimpleGreetingConversationUsesNormalTaskyonFlow = async (
  context?: DiagnosticsTestContext,
  model = context?.model,
) => {
  const result = await runVerifiedWorkflow(context, model, {
    label: 'greeting',
    prompt: 'hi',
    mode: 'message',
    expectedWorkflows: simpleAnswerWorkflows,
    timeoutMs: 80_000,
  })
  if (!result.success) return result
  assert(assistantAnswer(result.tasks).trim().length > 0, 'Expected a greeting response')
  assert(
    !result.completionMetas.some((meta) =>
      hasProviderWebSearchObservation(searchStreamContent(meta)),
    ),
    'A greeting should not search the web',
  )
  return { success: true, flow: result.flow }
}
testSimpleGreetingConversationUsesNormalTaskyonFlow.description =
  'A plain greeting produces one answer without tools or search.'
testSimpleGreetingConversationUsesNormalTaskyonFlow.modelBased = true
testSimpleGreetingConversationUsesNormalTaskyonFlow.timeoutMs = 90_000

export const testSimplePinnedToolConversationUsesNormalTaskyonFlow = async (
  context?: DiagnosticsTestContext,
  model = context?.model,
) => {
  const result = await runVerifiedWorkflow(context, model, {
    label: 'pinned tool',
    prompt: 'Use executeJavaScript or bash to calculate 2 + 2, then tell me the result.',
    mode: 'message',
    expectedWorkflows: directToolWorkflows,
    timeoutMs: 25_000,
  })
  if (!result.success) return result
  const toolResult = result.tasks.find((task) => task.content.type === 'toolresult')
  assert(toolResult?.content.type === 'toolresult', 'Expected an execution result')
  const output = JSON.stringify(toolResult.content.data)
  assert(/(?:^|\D)4(?:\D|$)/.test(output), 'Expected tool result 4')
  assert(/(?:^|\D)4(?:\D|$)/.test(assistantAnswer(result.tasks)), 'Expected answer 4')
  return { success: true, flow: result.flow }
}
testSimplePinnedToolConversationUsesNormalTaskyonFlow.description =
  'A pinned execution tool calculates 2 + 2 before the answer.'
testSimplePinnedToolConversationUsesNormalTaskyonFlow.modelBased = true
testSimplePinnedToolConversationUsesNormalTaskyonFlow.requiresLongRun = true
testSimplePinnedToolConversationUsesNormalTaskyonFlow.timeoutMs = 30_000

const createFixturePhraseTool = () =>
  createTool({
    name: 'readWorkflowFixturePhrase',
    description: 'Read the synthetic diagnostic phrase stored only in this test tool.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    } satisfies JSONSchema7,
    function: () => ({ phrase: 'violet compass river' }),
  })

export const testWebSearchThenToolUsesSearchedValue = async (
  context?: DiagnosticsTestContext,
  model = context?.model,
) => {
  const result = await runVerifiedWorkflow(context, model, {
    label: 'combined search and tool',
    prompt:
      'This asks for a changing value, so do not answer from memory. First use Taskyon hosted web search to inspect https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml and find its current Last Updated date in YYYY-MM-DD form. Only after the search returns that exact date, use executeJavaScript or bash to reverse the date string. Report the date, reversed date, and source link.',
    mode: 'message',
    expectedWorkflows: combinedWorkflows,
    timeoutMs: 75_000,
  })
  if (!result.success) return result
  assert(
    result.completionMetas.some((meta) =>
      hasProviderWebSearchObservation(searchStreamContent(meta)),
    ) || hasSearchSource(result.tasks),
    'Expected web search evidence',
  )
  const sourceUrl = 'https://www.iana.org/assignments/http-status-codes/http-status-codes.xhtml'
  const source = await readPublicWebPageAsMarkdown(sourceUrl)
  const searchedDate = source
    .replace(/<[^>]*>/g, ' ')
    .match(/Last Updated\s*:?\s*(\d{4}-\d{2}-\d{2})/i)?.[1]
  assert(searchedDate, 'Could not independently verify the IANA Last Updated date')
  const reversedDate = verifySearchedComputation(result.tasks, result.completionMetas, searchedDate)
  const answer = assistantAnswer(result.tasks)
  assert(
    answer.includes(searchedDate) && answer.includes(reversedDate),
    'Expected the source and reversed dates',
  )
  assert(
    answer.includes('https://www.iana.org/assignments/http-status-codes') ||
      result.tasks.some(
        (task) =>
          task.content.type === 'message' &&
          task.content.ann?.some(
            (ann) =>
              ann.type === 'url' && ann.url?.includes('iana.org/assignments/http-status-codes'),
          ),
      ),
    'Expected a citation to the IANA HTTP status-code registry',
  )
  return { success: true, flow: result.flow }
}
testWebSearchThenToolUsesSearchedValue.description =
  'Search, calculate from the source, and answer in one of two minimal chains.'
testWebSearchThenToolUsesSearchedValue.modelBased = true
testWebSearchThenToolUsesSearchedValue.timeoutMs = 90_000

export const testCatalogSearchThenUsesDiscoveredTool = async (
  context?: DiagnosticsTestContext,
  model = context?.model,
) => {
  const result = await runVerifiedWorkflow(context, model, {
    label: 'catalog search',
    prompt:
      'Search the tool catalog for the tool holding the synthetic diagnostic phrase, call it, and report the phrase.',
    mode: 'message',
    expectedWorkflows: discoveredToolWorkflows,
    extraTool: createFixturePhraseTool(),
    timeoutMs: 75_000,
  })
  if (!result.success) return result
  assert(
    functionCalls(result.tasks, 'readWorkflowFixturePhrase').length === 1,
    'Expected one fixture-tool call',
  )
  assert(
    assistantAnswer(result.tasks).includes('violet compass river'),
    'Expected the discovered phrase',
  )
  return { success: true, flow: result.flow }
}
testCatalogSearchThenUsesDiscoveredTool.description =
  'Find one noninitial tool, call it once, and report its result.'
testCatalogSearchThenUsesDiscoveredTool.modelBased = true
testCatalogSearchThenUsesDiscoveredTool.timeoutMs = 90_000
