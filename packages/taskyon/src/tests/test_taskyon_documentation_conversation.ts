import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { createDocumentationBaseStore } from '@taskyon/common/modules/documentationBases'
import type { DocumentationManifest } from '@taskyon/common/modules/resourceFiles'
import { createTaskyonClient, processTasksDetailed } from '../api'
import { tyCore } from '../core/init'
import { createExternalToolContext, registerToolRpcTools } from '../core/toolRpc'
import { createDefaultTaskyonToolSetup } from '../tools'
import { createStandardEntryNodeTool } from '../tools/entryNode'
import { createNodeResourceFilesLoader } from '../tools/nodeTaskyonDocumentationProvider'
import {
  createDocumentationIndexClientTool,
  loadDocumentationDocumentsFromManifest,
} from '../tools/documentationProviderTool'
import { taskyonDocumentationTool } from '../tools/documentationTool'
import { taskyonDocumentationManifest } from '../documentationManifest'
import { resolveDiagnosticsRuntimeConfig } from '../testSupport/onlineProviderSupport'
import type { TaskNode } from '../types/taskNode'
import { toolCall } from '../types/toolApi'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const documentationIndexToolName = 'documentationIndex'
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

const isDocumentationLoadingNotice = (task: TaskNode) =>
  task.role === 'assistant' &&
  task.content.type === 'message' &&
  String(task.content.data ?? '').includes('Searching Taskyon documentation')

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

  const runtimeConfig = resolveDiagnosticsRuntimeConfig(context)
  if (!runtimeConfig) {
    return {
      skipped: true,
      reason:
        'No runtime llmSettings were provided by the diagnostics harness. Run through tycli diagnostics or a harness that passes the active profile settings.',
    }
  }

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
    () => runtimeConfig.settings,
    () => toolCall({ name: entryNodeToolName, arguments: {} }),
    {
      chatCompletion: runtimeConfig.providerSettings,
      entryNode: {
        providerToolCalling: true,
        use_baseprompt: true,
        use_multimodal: true,
        max_error_retries: 3,
      },
    },
    undefined,
    {
      toolSetup: createDefaultTaskyonToolSetup(),
      indexTaskVectors: false,
      nodePgLiteDataDir: dataDir,
    },
  )
  taskyonRef.current = ty
  const selectedApi = runtimeConfig.providerSettings.provider
  await ty.updateChatCompletionApiKey(selectedApi, providerKey)

  const manifests = new Map<string, DocumentationManifest>()
  const loadFiles = createNodeResourceFilesLoader(
    fileURLToPath(new URL('../../../../public/docs', import.meta.url)),
    async () => {
      const current = taskyonRef.current
      if (!current) throw new Error('Expected Taskyon while describing documentation API.')
      return await createTaskyonClient(current.port).discovery.describe({})
    },
  )
  const documentationBases = createDocumentationBaseStore(
    {
      get: (id) => Promise.resolve(manifests.get(id) ?? null),
      set: (id, manifest) => {
        manifests.set(id, manifest)
        return Promise.resolve()
      },
      delete: (id) => {
        manifests.delete(id)
        return Promise.resolve()
      },
      list: () => Promise.resolve(Array.from(manifests, ([id, data]) => ({ id, data }))),
    },
    async (manifest) =>
      (await loadDocumentationDocumentsFromManifest(manifest, loadFiles)).documents.map(
        (document) => ({
          ...document,
          title: document.title ?? document.path,
          url: document.url ?? document.path,
        }),
      ),
  )
  await documentationBases.register(taskyonDocumentationManifest, 'taskyon')

  const toolRpcExecutor = await registerToolRpcTools({
    port: ty.port,
    tools: [
      entryNodeTool,
      createDocumentationIndexClientTool(documentationBases),
      taskyonDocumentationTool,
    ],
    createContext: (call, stopSignal) =>
      createExternalToolContext(stopSignal, {
        getExecutionTaskChain: () => {
          const current = taskyonRef.current
          if (!current || !call.taskId) {
            throw new Error('Expected a task id while executing the documentation conversation.')
          }
          return createTaskyonClient(current.port).task.getChain({ id: call.taskId })
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
    const loadingNotice = result.observedTasks.find(isDocumentationLoadingNotice)
    const docsToolCall = result.observedTasks.find((task) =>
      isNamedFunctionCall(task, documentationToolName),
    )
    const documentationIndexCall = result.observedTasks.find((task) =>
      isNamedFunctionCall(task, documentationIndexToolName),
    )
    assert(!!loadingNotice, 'Expected taskyonDocumentation to announce documentation loading.')
    assert(!!answerTask, 'Expected a matching assistant answer before the final return.')
    assert(!!docsToolCall, 'Expected the conversation to call taskyonDocumentation.')
    assert(!!documentationIndexCall, 'Expected taskyonDocumentation to use documentationIndex.')

    return {
      success: true,
      selectedApi,
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
