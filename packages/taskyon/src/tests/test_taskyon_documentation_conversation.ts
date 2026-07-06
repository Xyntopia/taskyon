import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { processTasksDetailed } from '../api'
import { tyCore } from '../core/init'
import { createExternalToolContext, registerToolRpcTools } from '../core/toolRpc'
import { createStandardEntryNodeTool } from '../tools/entryNode'
import { createNodeTaskyonDocumentationProviderTool } from '../tools/nodeTaskyonDocumentationProvider'
import { llmSettings } from '../types/profiles'
import type { TaskNode } from '../types/taskNode'
import { toolCall } from '../types/toolApi'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const docsProviderToolName = 'getTaskyonDocumentationDocuments'
const documentationToolName = 'taskyonDocumentation'
const entryNodeToolName = 'entryNode'

const taskyonDocsQuestions = [
  {
    question:
      'According to the Taskyon docs, what is the difference between parentID and priorID in a task tree?',
    expected: ['parentID', 'priorID', 'parent', 'previous'],
  },
  {
    question:
      'Where should a long-running Taskyon tool keep its workflow state so it can be resumed and inspected?',
    expected: ['task tree', 'persisted artifacts', 'explicit arguments'],
  },
  {
    question:
      'In Taskyon, what owns prompt templates and tool-calling behavior: chatCompletion or entryNode?',
    expected: ['entryNode', 'prompt templates', 'chatCompletion'],
  },
] as const

const isNamedFunctionCall = (task: TaskNode, name: string) =>
  task.content.type === 'functioncall' && task.content.data.name === name

const isExpectedAssistantAnswer =
  (expected: readonly string[]) =>
  (task: TaskNode): boolean => {
    if (task.role !== 'assistant' || task.content.type !== 'message') return false
    const text = String(task.content.data ?? '').toLowerCase()
    return expected.every((snippet) => text.includes(snippet.toLowerCase()))
  }

const isIndexingNotice = (task: TaskNode) =>
  task.role === 'assistant' &&
  task.content.type === 'message' &&
  String(task.content.data ?? '').includes('Indexing Taskyon documentation')

const summarizeTask = (task: TaskNode) => ({
  id: task.id,
  parentID: task.parentID,
  priorID: task.priorID,
  role: task.role,
  content: task.content,
})

export const testTaskyonCliConversationUsesDocumentationTool = async (
  context?: DiagnosticsTestContext,
) => {
  const providerKey = context?.providerKey
  if (!providerKey) {
    return {
      skipped: true,
      reason:
        'No configured tycli provider key/session was available. Configure tycli provider credentials first.',
    }
  }

  const parsedLlmSettings = llmSettings.safeParse(context?.llmSettings)
  if (!parsedLlmSettings.success) {
    return {
      skipped: true,
      reason:
        'No runtime llmSettings were provided by the diagnostics harness. Run through tycli diagnostics or a harness that passes the active profile settings.',
    }
  }

  const llmState = parsedLlmSettings.data
  const dataDir = join(tmpdir(), `taskyon-docs-conversation-${Date.now()}`)
  await mkdir(dataDir, { recursive: true })

  const taskyonRef: { current?: Awaited<ReturnType<typeof tyCore>> } = {}
  const entryNodeTool = createStandardEntryNodeTool({
    name: entryNodeToolName,
    renderOptions: { hideChat: true, hideLlm: true },
    defaultAllowedTools: [documentationToolName],
    toolChooser: { enabled: false },
    getToolCatalog: () =>
      Promise.resolve([{ name: documentationToolName, description: 'Search Taskyon docs.' }]),
  })

  const ty = await tyCore(
    () => llmState,
    () => toolCall({ name: entryNodeToolName, arguments: {} }),
    () => ({
      entryNode: {
        providerToolCalling: true,
        use_baseprompt: true,
        use_multimodal: true,
        max_error_retries: 3,
      },
    }),
    undefined,
    {
      indexTaskVectors: false,
      nodePgLiteDataDir: dataDir,
    },
  )
  taskyonRef.current = ty
  const selectedApi = llmState.selectedApi ?? 'taskyon'
  await ty.setSecret('chatCompletionApiKeys', selectedApi, providerKey)
  await ty.updateChatCompletionApiKey(selectedApi, providerKey)

  const toolRpcExecutor = await registerToolRpcTools({
    port: ty.port,
    tools: [entryNodeTool, createNodeTaskyonDocumentationProviderTool()],
    createContext: (call, stopSignal) =>
      createExternalToolContext(stopSignal, {
        getExecutionTaskChain: () => {
          const current = taskyonRef.current
          if (!current || !call.taskId) {
            throw new Error('Expected a task id while executing the documentation conversation.')
          }
          return current.getTaskChain(call.taskId)
        },
      }),
  })

  try {
    const selected = taskyonDocsQuestions[0]
    const result = await processTasksDetailed(ty.port)(
      [
        [
          {
            role: 'user',
            content: {
              type: 'message',
              data: 'hi!',
            },
          },
          {
            role: 'assistant',
            content: {
              type: 'message',
              data: 'Hi! How can I help?',
            },
          },
          {
            role: 'user',
            content: {
              type: 'message',
              data: selected.question,
            },
          },
          toolCall({
            name: entryNodeToolName,
            arguments: {
              allowedTools: [documentationToolName],
              providerToolCalling: true,
              use_tool_chooser: false,
            },
          }),
        ],
      ],
      'return',
      {
        show: false,
        timeoutMs: 180_000,
      },
    )

    assert(
      result.status === 'matched',
      `Expected a matching assistant answer, got ${result.status}`,
    )
    const answerTask = result.observedTasks.find(isExpectedAssistantAnswer(selected.expected))
    const indexingNotice = result.observedTasks.find(isIndexingNotice)
    const docsToolCall = result.observedTasks.find((task) =>
      isNamedFunctionCall(task, documentationToolName),
    )
    const docsProviderCall = result.observedTasks.find((task) =>
      isNamedFunctionCall(task, docsProviderToolName),
    )
    assert(!!indexingNotice, 'Expected taskyonDocumentation to announce documentation indexing.')
    assert(!!answerTask, 'Expected a matching assistant answer before the final return.')
    assert(!!docsToolCall, 'Expected the conversation to call taskyonDocumentation.')
    assert(!!docsProviderCall, 'Expected taskyonDocumentation to load docs through the provider.')

    return {
      success: true,
      selectedApi: llmState.selectedApi,
      model: context?.model,
      question: selected.question,
      answer: answerTask && answerTask.content.type === 'message' ? answerTask.content.data : '',
      observedTasks: result.observedTasks.map(summarizeTask),
    }
  } finally {
    toolRpcExecutor.destroy()
    ty.workerStop('documentation conversation diagnostic complete')
  }
}

testTaskyonCliConversationUsesDocumentationTool.description =
  'Runs a tycli-style conversation and verifies Taskyon calls taskyonDocumentation to answer from its docs.'
testTaskyonCliConversationUsesDocumentationTool.requiresLargeTokens = true
testTaskyonCliConversationUsesDocumentationTool.timeoutMs = 200_000
