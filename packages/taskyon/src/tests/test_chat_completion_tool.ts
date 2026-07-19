import {
  convertTaskNodesToOpenAIChat,
  getCommandFromStructuredResponse,
  prepareChatCompletionContext,
} from '../tools/chatCompletionTool'
import { serializeObject } from '@taskyon/common/modules/serializeObject'
import { selectTaskChainIds } from '../core/taskChainSelection'
import { createTaskVariablePresentationService } from '../core/taskVariables'
import { buildChatProviderRequest } from '../tools/chatCompletion/providerRequest'
import { interpretAssistantMessage } from '../tools/chatCompletion/response'
import { classifyStreamingFailure } from '../tools/chatCompletion/streamResult'
import type { TaskNode } from '../types/taskNode'
import type { ToolBase } from '../types/tools'

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const task = (node: TaskNode) => node

const createTaskAccess = (tasks: TaskNode[]) => {
  const tasksById = new Map(tasks.map((node) => [node.id, node]))
  const directChildrenByParent = new Map<string, string[]>()
  const nextSiblingByPrior = new Map<string, string[]>()

  for (const node of tasks) {
    if (node.parentID && !node.priorID) {
      const children = directChildrenByParent.get(node.parentID) ?? []
      children.push(node.id)
      directChildrenByParent.set(node.parentID, children)
    }
    if (node.priorID) {
      const siblings = nextSiblingByPrior.get(node.priorID) ?? []
      siblings.push(node.id)
      nextSiblingByPrior.set(node.priorID, siblings)
    }
  }

  const findSiblingLeafTasks = (taskId: string) => {
    const leafTasks: string[] = []
    const pending = [taskId]
    while (pending.length > 0) {
      const current = pending.pop()
      if (!current) continue
      const next = nextSiblingByPrior.get(current) ?? []
      if (next.length === 0) {
        leafTasks.push(current)
      } else {
        pending.push(...next)
      }
    }
    return Promise.resolve(leafTasks)
  }

  return {
    getTask: (taskId: string) => Promise.resolve(tasksById.get(taskId) ?? null),
    getFlattenedChain: () => {
      throw new Error('Flattened task-chain selection is not used by these tests.')
    },
    searchAllDirectChildren: (taskId: string) =>
      Promise.resolve(new Set(directChildrenByParent.get(taskId) ?? [])),
    findSiblingLeafTasks,
  }
}

export const testChatCompletionContextUsesLineageAndTerminalSubtaskResults = async () => {
  const tasks = [
    task({
      id: 'root-user',
      role: 'user',
      created_at: 1,
      content: { type: 'message', data: 'Collect battery spec sheets.' },
    }),
    task({
      id: 'planner-call',
      role: 'function',
      priorID: 'root-user',
      created_at: 2,
      content: { type: 'functioncall', data: { name: 'webResearchPlanner', arguments: {} } },
    }),
    task({
      id: 'branch-a-start',
      role: 'user',
      parentID: 'planner-call',
      created_at: 3,
      content: { type: 'message', data: 'Noisy branch A prompt.' },
    }),
    task({
      id: 'branch-a-internal-tool',
      role: 'function',
      parentID: 'planner-call',
      priorID: 'branch-a-start',
      created_at: 4,
      content: { type: 'functioncall', data: { name: 'downloadFile', arguments: {} } },
    }),
    task({
      id: 'nested-noise-start',
      role: 'user',
      parentID: 'branch-a-internal-tool',
      created_at: 5,
      content: { type: 'message', data: 'Nested branch internals must stay hidden.' },
    }),
    task({
      id: 'nested-noise-result',
      role: 'assistant',
      parentID: 'branch-a-internal-tool',
      priorID: 'nested-noise-start',
      created_at: 6,
      content: { type: 'message', data: 'Nested result should not be pulled into parent chat.' },
    }),
    task({
      id: 'branch-a-result',
      role: 'assistant',
      parentID: 'planner-call',
      priorID: 'branch-a-internal-tool',
      created_at: 7,
      content: { type: 'message', data: 'Branch A final summary.' },
    }),
    task({
      id: 'branch-a-return',
      role: 'system',
      parentID: 'planner-call',
      priorID: 'branch-a-result',
      created_at: 8,
      content: { type: 'return', data: 'done' },
    }),
    task({
      id: 'branch-b-start',
      role: 'user',
      parentID: 'planner-call',
      created_at: 9,
      content: { type: 'message', data: 'Noisy branch B prompt.' },
    }),
    task({
      id: 'branch-b-result',
      role: 'assistant',
      parentID: 'planner-call',
      priorID: 'branch-b-start',
      created_at: 10,
      content: { type: 'structured', data: { result: 'Branch B final summary.' } },
    }),
    task({
      id: 'continue-user',
      role: 'user',
      priorID: 'planner-call',
      created_at: 11,
      content: { type: 'message', data: 'Continue from the research results.' },
    }),
  ]

  const selectedIds = await selectTaskChainIds(
    'continue-user',
    1e9,
    { method: 'lineage' },
    createTaskAccess(tasks),
  )

  assert(
    JSON.stringify(selectedIds) ===
      JSON.stringify([
        'root-user',
        'planner-call',
        'branch-a-result',
        'branch-b-result',
        'continue-user',
      ]),
    `Expected lineage plus terminal direct subtask results, got ${JSON.stringify(selectedIds)}`,
  )

  assert(
    !selectedIds.includes('branch-a-start') && !selectedIds.includes('branch-a-internal-tool'),
    'Expected noisy direct subtask internals to stay hidden',
  )
  assert(
    !selectedIds.includes('nested-noise-result'),
    'Expected nested subtask output to stay hidden from the parent chat context',
  )

  return { success: true }
}

export const testChatCompletionContextSizeTrimsAfterLineageSelection = async () => {
  const tasks = [
    task({
      id: 'root-user',
      role: 'user',
      created_at: 1,
      content: { type: 'message', data: 'Root.' },
    }),
    task({
      id: 'tool-call',
      role: 'function',
      priorID: 'root-user',
      created_at: 2,
      content: { type: 'functioncall', data: { name: 'taskPlanner', arguments: {} } },
    }),
    task({
      id: 'child-start',
      role: 'user',
      parentID: 'tool-call',
      created_at: 3,
      content: { type: 'message', data: 'Child.' },
    }),
    task({
      id: 'child-result',
      role: 'assistant',
      parentID: 'tool-call',
      priorID: 'child-start',
      created_at: 4,
      content: { type: 'message', data: 'Child result.' },
    }),
    task({
      id: 'next-user',
      role: 'user',
      priorID: 'tool-call',
      created_at: 5,
      content: { type: 'message', data: 'Next.' },
    }),
  ]

  const selectedIds = await selectTaskChainIds(
    'next-user',
    2,
    { method: 'lineage' },
    createTaskAccess(tasks),
  )

  assert(
    JSON.stringify(selectedIds) === JSON.stringify(['child-result', 'next-user']),
    `Expected maxFollow to trim after terminal child results are inserted, got ${JSON.stringify(
      selectedIds,
    )}`,
  )

  return { success: true }
}

export const testOrphanedToolResultRendersAsSystemContext = async () => {
  const toolResult = task({
    id: 'terminal-tool-result',
    role: 'system',
    parentID: 'hidden-tool-call',
    created_at: 3,
    content: { type: 'toolresult', data: { summary: 'Terminal branch result.' } },
  })
  const tools: Record<string, ToolBase> = {}

  const messages = await convertTaskNodesToOpenAIChat(
    [toolResult],
    () => Promise.resolve(null),
    () => Promise.resolve(undefined),
    false,
    true,
    tools,
  )

  assert(messages.length === 1, `Expected one rendered message, got ${messages.length}`)
  assert(
    messages[0]?.role === 'system',
    'Expected orphaned tool result to render as system context',
  )

  return { success: true }
}

export const testHiddenToolCallResultRendersAsSystemContext = async () => {
  const hiddenToolCall = task({
    id: 'hidden-docs-provider-call',
    role: 'function',
    created_at: 2,
    content: {
      type: 'functioncall',
      data: { name: 'getTaskyonDocumentationDocuments', arguments: {} },
    },
  })
  const toolResult = task({
    id: 'hidden-docs-provider-result',
    role: 'system',
    parentID: hiddenToolCall.id,
    created_at: 3,
    content: { type: 'toolresult', data: { documents: [{ id: 'taskyon.md' }] } },
  })
  const tools: Record<string, ToolBase> = {
    getTaskyonDocumentationDocuments: {
      name: 'getTaskyonDocumentationDocuments',
      description: 'Hidden docs provider',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      renderOptions: { hideLlm: true },
    },
  }

  const messages = await convertTaskNodesToOpenAIChat(
    [hiddenToolCall, toolResult],
    () => Promise.resolve(null),
    () => Promise.resolve(undefined),
    false,
    true,
    tools,
  )

  assert(messages.length === 1, `Expected one rendered message, got ${messages.length}`)
  assert(messages[0]?.role === 'system', 'Expected hidden tool result to render as system context')

  return { success: true }
}

export const testSerializeObjectTruncationNoticeIsOptIn = () => {
  const value = { a: 1, b: 2, c: 3 }

  const defaultSerialized = serializeObject(value, {
    format: 'yaml',
    maxObjectKeys: 1,
  })
  const noticeSerialized = serializeObject(value, {
    format: 'yaml',
    maxObjectKeys: 1,
    includeTruncationNotice: true,
  })

  assert(
    !defaultSerialized.startsWith('Note: this serialized value was truncated'),
    'Expected truncation notice to be opt-in',
  )
  assert(
    noticeSerialized.startsWith('Note: this serialized value was truncated'),
    'Expected opt-in truncation notice when object keys are omitted',
  )

  return { success: true }
}

export const testToolResultRenderingUsesBoundedSerializationForLlm = async () => {
  const toolResult = task({
    id: 'large-tool-result',
    role: 'system',
    created_at: 4,
    content: {
      type: 'toolresult',
      data: {
        rows: Array.from({ length: 65 }, (_, index) => ({
          index,
          value: `row-${index}`,
        })),
      },
    },
  })

  const messages = await convertTaskNodesToOpenAIChat(
    [toolResult],
    () => Promise.resolve(null),
    () => Promise.resolve(undefined),
    false,
    false,
    {},
  )

  const content = messages[0]?.content
  assert(typeof content === 'string', 'Expected tool result to render as text context')
  assert(
    content.includes('Note: this serialized value was truncated'),
    'Expected LLM-facing tool result to state when data was truncated',
  )
  assert(content.includes('__omittedItems: 5'), 'Expected omitted array item count in tool result')

  return { success: true }
}

export const testChooseToolPlainTextResponseDoesNotThrow = () => {
  const response = 'I cannot provide the current time.'
  const commands = getCommandFromStructuredResponse(response)

  assert(Array.isArray(commands), 'Expected command parser to return an array')
  assert(commands.length === 0, 'Expected plain text chooser response to produce no commands')

  return {
    response,
    commands,
  }
}

export const testChatCompletionContextVariableNamesAreInvocationScoped = async () => {
  const contextTask = task({
    id: 'context-message',
    role: 'user',
    created_at: 1,
    content: { type: 'message', data: 'Stable context.' },
  })
  const prepare = () =>
    prepareChatCompletionContext({
      taskChain: [contextTask],
      allowedTools: [],
      toolDefinitions: {},
      appendSystemPrompts: [],
      prependSystemPrompts: [],
      useVisionModels: false,
      getFileMapping: () => Promise.resolve(null),
      getUploadedFile: () => Promise.resolve(undefined),
      getTaskById: () => Promise.resolve(null),
    })

  const first = await prepare()
  const second = await prepare()

  assert(
    JSON.stringify(first.messages) === JSON.stringify(second.messages),
    'Expected independent chat invocations to render identical context messages',
  )
  assert(
    first.variableService !== second.variableService,
    'Expected each chat invocation to own its variable-presentation state',
  )

  return { success: true }
}

export const testChatCompletionMixedTextAndNativeToolCallContinuesWithTool = () => {
  const toolDefinition: ToolBase = {
    name: 'clock',
    description: 'Read the clock.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  }
  const outcome = interpretAssistantMessage(
    [],
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will check.' },
        {
          type: 'tool-call',
          toolCallId: 'clock-call',
          toolName: 'clock',
          input: {},
        },
      ],
    },
    true,
    { clock: toolDefinition },
    createTaskVariablePresentationService(),
  )

  assert(outcome.kind === 'tool-calls', 'Expected native tool call to control continuation')
  assert(outcome.calls.length === 1, 'Expected one interpreted tool call')
  assert(outcome.calls[0]?.name === 'clock', 'Expected the clock tool call')

  return { success: true }
}

export const testChatCompletionCodexRequestMovesLeadingSystemPromptToInstructions = async () => {
  const request = await buildChatProviderRequest({
    messages: [
      { role: 'system', content: 'Follow the system instructions.' },
      { role: 'user', content: 'Hello.' },
    ],
    tools: {},
    selectedModel: 'gpt-5',
    api: {
      name: 'chatgpt-codex',
      baseURL: 'https://example.test/v1',
      defaultModel: 'gpt-5',
      streamSupport: true,
      routes: {
        chatCompletion: '/responses',
        models: '/models',
      },
    },
    apiKey: 'diagnostic-key',
  })

  assert(request.messages?.length === 1, 'Expected leading system prompt outside request messages')
  assert(request.messages?.[0]?.role === 'user', 'Expected user message to remain')
  assert(
    request.providerOptions?.openai?.instructions === 'Follow the system instructions.',
    'Expected Codex provider instructions to contain the leading system prompt',
  )

  return { success: true }
}

export const testChatCompletionStreamingFailureClassification = () => {
  const interrupted = classifyStreamingFailure(new Error('request aborted'), false)
  const transient = classifyStreamingFailure(new Error('503 server busy'), false)

  assert(interrupted.shortReason === 'interrupted', 'Expected abort classification')
  assert(
    transient.shortReason === 'transient provider failure',
    'Expected transient provider classification',
  )

  return { success: true }
}

export const testChatCompletionRendersUploadedTextFile = async () => {
  const fileTask = task({
    id: 'uploaded-files',
    role: 'user',
    created_at: 1,
    content: { type: 'files', data: ['file-1'] },
  })
  const uploadedFile = new File(['hello from the file'], 'notes.txt', {
    type: 'text/plain',
  })
  const messages = await convertTaskNodesToOpenAIChat(
    [fileTask],
    () =>
      Promise.resolve({
        id: 'file-1',
        name: 'notes.txt',
        type: 'text/plain',
      }),
    () => Promise.resolve(uploadedFile),
    false,
    false,
    {},
  )

  assert(messages[0]?.role === 'system', 'Expected uploaded-file summary first')
  assert(messages[1]?.role === 'user', 'Expected uploaded file content as user context')
  assert(
    messages[1]?.role === 'user' &&
      Array.isArray(messages[1].content) &&
      messages[1].content.some(
        (content) =>
          content.type === 'file' &&
          typeof content.data === 'string' &&
          content.data.includes('hello from the file'),
      ),
    'Expected uploaded text content in the rendered file part',
  )

  return { success: true }
}

export const testChatCompletionAnswerCompilesPresentationVariable = () => {
  const sourceTask = task({
    id: 'answer-source',
    role: 'assistant',
    created_at: 1,
    content: { type: 'message', data: 'Source value.' },
  })
  const tasksById = new Map([[sourceTask.id, sourceTask]])
  const variableService = createTaskVariablePresentationService()
  variableService.getOrAssignVariableName(sourceTask, tasksById)
  const outcome = interpretAssistantMessage(
    [{ type: 'url', title: 'Source', url: 'https://example.test' }],
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'Use {{message1}}.' }],
    },
    false,
    {},
    variableService,
  )

  assert(outcome.kind === 'answers', 'Expected an assistant answer outcome')
  assert(
    outcome.answers[0]?.content === 'Use {{_t:answer-source}}.',
    'Expected presentation variable to compile to its durable task reference',
  )
  assert(outcome.answers[0]?.annotations?.length === 1, 'Expected sources on the first answer')

  return { success: true }
}
testChooseToolPlainTextResponseDoesNotThrow.description =
  'Plain text LLM output in ChooseTool/AnalyzeToolResult mode must not crash the structured command parser.'
testChatCompletionContextVariableNamesAreInvocationScoped.description =
  'Independent chatCompletion invocations derive deterministic variable names without sharing mutable presentation state.'
testChatCompletionMixedTextAndNativeToolCallContinuesWithTool.description =
  'A provider response containing both text and a native tool call continues with the tool instead of returning prematurely.'
testChatCompletionCodexRequestMovesLeadingSystemPromptToInstructions.description =
  'Codex provider requests move the leading system prompt into provider instructions without making a network request.'
testChatCompletionStreamingFailureClassification.description =
  'Chat completion stream failures distinguish interruption and transient provider failures.'
testChatCompletionRendersUploadedTextFile.description =
  'chatCompletion renders an uploaded text file into model-readable context.'
testChatCompletionAnswerCompilesPresentationVariable.description =
  'Assistant answers compile request-scoped presentation variables back to durable task references.'
testChatCompletionContextUsesLineageAndTerminalSubtaskResults.description =
  'chatCompletion context follows parent/prior lineage and exposes terminal direct subtask results without flattening branch internals.'
testChatCompletionContextSizeTrimsAfterLineageSelection.description =
  'chatCompletion context_size maps to maxFollow and limits the final lineage context after terminal subtask results are selected.'
testOrphanedToolResultRendersAsSystemContext.description =
  'Terminal tool results without their hidden function-call parent render as system context instead of orphaned native tool output.'
testSerializeObjectTruncationNoticeIsOptIn.description =
  'serializeObject keeps existing output stable and only emits a truncation notice when requested.'
testToolResultRenderingUsesBoundedSerializationForLlm.description =
  'LLM-facing tool result rendering uses bounded serialization and explicitly marks truncated data.'
