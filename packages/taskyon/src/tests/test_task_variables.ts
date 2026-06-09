import { convertTaskNodesToOpenAIChat } from '../tools/chatCompletionTool'
import { addPrompts } from '../llm/promptCreation'
import {
  compileTaskyonFunctionArguments,
  compileTaskyonMessageString,
  createTaskVariablePresentationService,
  materializeTaskyonFunctionArguments,
  materializeTaskyonMessageString,
} from '../core/taskVariables'
import type { TaskNode } from '../types/taskNode'
import type { ToolBase } from '../types/tools'
import z from 'zod'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const createTask = (task: TaskNode) => task

const RecordSchema = z.record(z.string(), z.unknown())

const toRecord = (value: unknown): Record<string, unknown> | null => {
  const result = RecordSchema.safeParse(value)
  return result.success ? result.data : null
}

const toDebugString = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value)

const exampleTool: ToolBase = {
  name: 'summarizeDocument',
  description: 'Summarize a document.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      document: { type: 'string' },
      question: { type: 'string' },
    },
  },
}

export const testTaskVariableCompilationAndMaterialization = async () => {
  const sourceTask = createTask({
    id: 'task-source',
    role: 'assistant',
    content: { type: 'message', data: 'Hello from Taskyon.' },
  })
  const tasksById = new Map([[sourceTask.id, sourceTask]])
  const variableService = createTaskVariablePresentationService()
  const variableName = variableService.getOrAssignVariableName(sourceTask, tasksById)

  assert(
    variableName === 'message1',
    `Expected first message variable to be message1, got ${variableName}`,
  )

  const compiled = compileTaskyonFunctionArguments(
    {
      $use: { document: variableName },
      question: 'Summarize this document.',
    },
    variableService,
  )

  const compiledUse = toRecord(compiled.$use)
  assert(
    compiledUse?.document === '_t:task-source',
    `Expected $use ref to compile to _t:task-source, got ${toDebugString(compiledUse?.document)}`,
  )
  assert(compiled.question === 'Summarize this document.', 'Expected literal arguments unchanged')

  const materialized = await materializeTaskyonFunctionArguments(compiled, {
    surface: 'execution',
    getTaskById: (taskId) => Promise.resolve(tasksById.get(taskId) ?? null),
  })

  assert(
    materialized.document === 'Hello from Taskyon.',
    `Expected $use to materialize full content, got ${toDebugString(materialized.document)}`,
  )
  assert(
    materialized.question === 'Summarize this document.',
    `Expected literal argument to remain unchanged, got ${toDebugString(materialized.question)}`,
  )

  return { success: true }
}

export const testTaskVariableRenderingInOpenAiChat = async () => {
  const offChainSource = createTask({
    id: 'task-document',
    role: 'assistant',
    content: { type: 'message', data: '# Report\n\nRevenue increased.' },
  })
  const functionTask = createTask({
    id: 'task-call',
    role: 'function',
    content: {
      type: 'functioncall',
      data: {
        name: 'summarizeDocument',
        arguments: {
          $use: {
            document: '_t:task-document',
          },
          question: 'Explain this briefly.',
        },
      },
    },
  })

  const variableService = createTaskVariablePresentationService()
  const allTasks = new Map([
    [offChainSource.id, offChainSource],
    [functionTask.id, functionTask],
  ])
  variableService.getOrAssignVariableName(offChainSource, allTasks)

  const messages = await convertTaskNodesToOpenAIChat(
    [functionTask],
    () => Promise.resolve(null),
    () => Promise.resolve(undefined),
    false,
    true,
    { summarizeDocument: exampleTool },
    {
      getTaskById: (taskId) => Promise.resolve(allTasks.get(taskId) ?? null),
      variableService,
    },
  )

  const injectedVariableMessage = messages.find(
    (message) => message.role === 'system' && typeof message.content === 'string',
  )
  assert(
    Boolean(injectedVariableMessage),
    'Expected an injected system variable block for off-chain task',
  )
  assert(
    typeof injectedVariableMessage?.content === 'string' &&
      injectedVariableMessage.content.includes('taskyon variable message1 content start'),
    'Expected injected variable block to use Taskyon markers',
  )

  const toolCallMessage = messages.find((message) => message.role === 'assistant')
  assert(toolCallMessage?.role === 'assistant', 'Expected assistant tool-call message')
  if (toolCallMessage?.role !== 'assistant' || !Array.isArray(toolCallMessage.content)) {
    throw new Error('Assistant tool-call message has unexpected shape')
  }
  const toolCall = toolCallMessage.content.find(
    (part) => typeof part !== 'string' && part.type === 'tool-call',
  )
  assert(Boolean(toolCall), 'Expected native tool-call content part')
  const toolCallInput = toRecord(toolCall?.input)
  const toolCallUse = toRecord(toolCallInput?.['$use'])
  assert(
    toolCallUse?.document === 'message1',
    `Expected LLM-facing $use mapping to show message1, got ${JSON.stringify(toolCallInput)}`,
  )
  assert(
    toolCallInput?.question === 'Explain this briefly.',
    `Expected literal argument to stay unchanged, got ${toDebugString(toolCallInput?.question)}`,
  )

  return { success: true }
}

export const testTaskVariableRenderingInMessageStrings = async () => {
  const sourceTask = createTask({
    id: 'task-source',
    role: 'assistant',
    content: { type: 'message', data: 'Rendered value' },
  })
  const tasksById = new Map([[sourceTask.id, sourceTask]])
  const rendered = await materializeTaskyonMessageString('Value: {{_t:task-source}}', {
    surface: 'ui',
    getTaskById: (taskId) => Promise.resolve(tasksById.get(taskId) ?? null),
  })

  assert(
    rendered === 'Value: Rendered value',
    `Expected message placeholders to render in UI strings, got ${toDebugString(rendered)}`,
  )

  return { success: true }
}

export const testTaskVariableCompilationInMessageStrings = () => {
  const sourceTask = createTask({
    id: 'task-source',
    role: 'assistant',
    content: { type: 'message', data: 'Rendered value' },
  })
  const tasksById = new Map([[sourceTask.id, sourceTask]])
  const variableService = createTaskVariablePresentationService()
  variableService.getOrAssignVariableName(sourceTask, tasksById)

  const compiled = compileTaskyonMessageString('Value: {{message1}}', variableService)

  assert(
    compiled === 'Value: {{_t:task-source}}',
    `Expected LLM-facing message variable to compile to internal task ref, got ${toDebugString(compiled)}`,
  )

  return { success: true }
}

export const testPromptInjectionPlacement = () => {
  const promptResult = addPrompts(
    {},
    false,
    false,
    true,
    {
      basePrompt: 'base prompt',
      evaluate: 'evaluate {message}',
      instruction: 'instruction',
      tools: 'tools {tools}',
      task: 'task {message}',
      schemaReminder: 'schema {schema}',
      toolResult: 'toolResult {message}',
    },
    [],
    [],
    ['append me'],
    ['prepend me'],
    'hello',
    'SimpleCompletion',
  )

  const prependMessages = promptResult.prependMessages
  const appendMessages = promptResult.appendMessages
  assert(
    prependMessages.some(
      (message) => message.role === 'system' && message.content === 'prepend me',
    ),
    'Expected prepend prompt injection to be placed in prependMessages',
  )
  assert(
    appendMessages.some((message) => message.role === 'system' && message.content === 'append me'),
    'Expected append prompt injection to be placed in appendMessages',
  )

  return { success: true }
}

testTaskVariableCompilationAndMaterialization.description =
  'Compiles LLM-facing variable names to task refs and materializes them for execution.'
testTaskVariableRenderingInOpenAiChat.description =
  'Renders session-scoped Taskyon variables for the LLM and injects off-chain references on demand.'
testTaskVariableRenderingInMessageStrings.description =
  'Renders task-id placeholders only in human-visible message strings, not function arguments.'
testTaskVariableCompilationInMessageStrings.description =
  'Compiles LLM-facing message template variables back to internal task-id placeholders.'
testPromptInjectionPlacement.description =
  'Places transient prompt injections before the rendered chat and prompts after it.'
