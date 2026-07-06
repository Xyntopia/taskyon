import type { DiagnosticsTestContext } from '@taskyon/common/modules/diagnosticsRunner'
import { createTaskyonClient } from '../../api'
import { buildCreateNewTaskChain } from '../../core/createNewTaskChain'
import { forgeTaskChain } from '../../core/createTasks'
import { tyCore, type Taskyon } from '../../core/init'
import { registerToolRpcTools } from '../../core/toolRpc'
import { createStandardEntryNodeTool } from '../../tools/entryNode'
import { llmSettings } from '../../types/profiles'
import { partialTaskDraft, type TaskNode } from '../../types/taskNode'

type TaskNodeWithParent = TaskNode & { parentID: string }

type ConversationRunResult =
  | {
      status: 'matched'
      result: TaskNode
      stopTask: TaskNode
      observedTasks: TaskNode[]
      initialIds: string[]
    }
  | {
      status: 'timeout'
      observedTasks: TaskNode[]
      initialIds: string[]
      timeoutMs: number
    }
  | {
      status: 'error'
      observedTasks: TaskNode[]
      initialIds: string[]
      error: Error
      errorTask: TaskNode
    }

function assert(condition: boolean, msg?: string): asserts condition {
  if (!condition) {
    throw new Error(msg ?? 'Assertion failed')
  }
}

const taskyonFlowToolchainConfig = {
  taskyonFlow: {
    use_baseprompt: true,
    use_tool_chooser: true,
    tool_chooser_min_tools: 5,
    max_error_retries: 3,
    providerToolCalling: true,
    use_multimodal: true,
    reasoning_effort: 'low',
    websearch: {
      max_results: 5,
    },
    prompt_templates: {
      basePrompt:
        'You are a helpful assistant called **Taskyon**.\nReturn answers in **Markdown**.',
      instruction: 'You are a helpful assistant tasked with accurately completing the given task.',
      toolResult:
        '**Instruction:**\n\nPlease evaluate the tool/function result.\n\n```\n{message}\n```',
      task: 'COMPLETE THE FOLLOWING TASK:\n\n```\n{message}\n```',
      schemaReminder:
        'Your output must strictly follow these rules and match the requested {format} schema.\n\nSchema:\n\n{schema}',
      tools: 'Choose one of the following tools if it helps you to complete the task:\n\n${tools}',
    },
  },
} as const

const initializeProviderKey = async (ty: Taskyon, selectedApi: string, key: string) => {
  await ty.setSecret('AiProviderKey', selectedApi, key)
  await ty.updateChatCompletionApiKey(selectedApi, key)
}

const getEntryNodeDraft = (entryNodeArgs?: Record<string, unknown>) =>
  partialTaskDraft.parse({
    role: 'system',
    content: {
      type: 'functioncall',
      data: {
        name: 'taskyonFlow',
        arguments: {
          ...(entryNodeArgs ?? {}),
        },
      },
    },
  })

const createConversationHarness = async (
  runtimeLlmSettings: llmSettings,
): Promise<{ ty: Taskyon; cleanup: () => void }> => {
  const entryNodeTool = createStandardEntryNodeTool({
    name: 'taskyonFlow',
    renderOptions: { hideChat: true, hideLlm: true },
    toolChooser: { enabled: true, useTools: true },
    defaultAllowedTools: [],
    getToolCatalog: async () => {
      const ty = await tyPromise
      const cachedTools = await createTaskyonClient(ty.port).listTools({ includeHidden: true })
      return Object.values(cachedTools)
        .filter((tool) => !['chatCompletion', 'entryNode', 'taskyonFlow'].includes(tool.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description,
        }))
    },
  })

  const tyPromise: Promise<Taskyon> = tyCore(
    () => runtimeLlmSettings,
    () => getEntryNodeDraft(),
    () => taskyonFlowToolchainConfig,
  )
  const ty = await tyPromise
  const toolRpcExecutor = await registerToolRpcTools({ port: ty.port, tools: [entryNodeTool] })

  return { ty, cleanup: () => toolRpcExecutor.destroy() }
}

const getSimpleMessageTask = (text: string) => ({
  role: 'user' as const,
  content: {
    type: 'message' as const,
    data: text,
  },
})

const isNamedFunctionCall = (data: unknown, name: string): boolean => {
  return !!data && typeof data === 'object' && 'name' in data && data.name === name
}

const getFunctionArgs = (data: unknown): Record<string, unknown> | undefined => {
  if (!data || typeof data !== 'object' || !('arguments' in data)) return undefined
  const args = data.arguments
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : undefined
}

const hasPromptSnippet = (data: unknown, snippet: string): boolean => {
  const args = getFunctionArgs(data)
  const prompts = args?.appendSystemPrompts
  return (
    Array.isArray(prompts) &&
    prompts.some((prompt) => typeof prompt === 'string' && prompt.includes(snippet))
  )
}

const hasToolChoiceSchema = (data: unknown): boolean => {
  const args = getFunctionArgs(data)
  const schema = args?.schema
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false
  const properties = (schema as Record<string, unknown>).properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return false
  return 'choice' in (properties as Record<string, unknown>)
}

const hasToolChoice = (data: unknown, toolName: string): boolean => {
  if (!data || typeof data !== 'object' || !('choice' in data)) return false
  const choice = data.choice
  return Array.isArray(choice) && choice.includes(toolName)
}

const isClockToolResult = (task: TaskNode): boolean => {
  const data = task.content.data
  return (
    task.content.type === 'toolresult' &&
    !!data &&
    typeof data === 'object' &&
    'time' in data &&
    'date' in data &&
    'weekday' in data
  )
}

const isAssistantMessage = (task: TaskNode): boolean => {
  return (
    task.role === 'assistant' &&
    task.content.type === 'message' &&
    typeof task.content.data === 'string' &&
    task.content.data.trim().length > 0
  )
}

const summarizeTask = (task: TaskNode) => ({
  id: task.id,
  parentID: task.parentID,
  priorID: task.priorID,
  role: task.role,
  created_at: task.created_at,
  name: task.name,
  content: task.content,
})

const collectTaskDiagnostics = async (
  ty: Taskyon,
  taskChain: ReturnType<typeof buildCreateNewTaskChain>,
  observedTasks: TaskNode[],
  conversationTasks: TaskNode[],
  processingResult?: unknown,
) => {
  const metaEntries = await Promise.all(
    conversationTasks.map(async (task) => ({
      taskId: task.id,
      meta: (await ty.getMeta(task.id)) ?? null,
    })),
  )

  return {
    initialTaskChain: taskChain,
    processingResult,
    observedTasks: observedTasks.map(summarizeTask),
    conversationTasks: conversationTasks.map(summarizeTask),
    taskMeta: Object.fromEntries(metaEntries.map(({ taskId, meta }) => [taskId, meta])),
  }
}

const assertWithDiagnostics = async (
  condition: boolean,
  message: string,
  ty: Taskyon,
  taskChain: ReturnType<typeof buildCreateNewTaskChain>,
  observedTasks: TaskNode[],
  conversationTasks: TaskNode[],
  processingResult?: unknown,
) => {
  if (condition) return
  throw new Error(message, {
    cause: await collectTaskDiagnostics(
      ty,
      taskChain,
      observedTasks,
      conversationTasks,
      processingResult,
    ),
  })
}

const summarizeProcessingResult = (result: ConversationRunResult) => {
  if (result.status === 'matched') {
    return {
      status: result.status,
      initialIds: result.initialIds,
      stopTask: summarizeTask(result.stopTask),
      observedTaskIds: result.observedTasks.map((task) => task.id),
    }
  }

  if (result.status === 'error') {
    return {
      status: result.status,
      initialIds: result.initialIds,
      errorTask: summarizeTask(result.errorTask),
      error: {
        name: result.error.name,
        message: result.error.message,
      },
      observedTaskIds: result.observedTasks.map((task) => task.id),
    }
  }

  return {
    status: result.status,
    initialIds: result.initialIds,
    timeoutMs: result.timeoutMs,
    observedTaskIds: result.observedTasks.map((task) => task.id),
  }
}

const getLatestLeafId = async (ty: Taskyon, rootTaskId: string) => {
  const leafIds = await ty.findSiblingLeafTasks(rootTaskId)
  const leafTasks = await ty.convertTaskIDs(leafIds)
  const latestLeaf = leafTasks.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
  return latestLeaf?.id
}

const getConversationTasks = async (ty: Taskyon, processingResult: ConversationRunResult) => {
  const rootTaskId = processingResult.initialIds.at(-1)
  if (!rootTaskId) {
    throw new Error('Expected an initial root task id for the created conversation')
  }

  const terminalTaskId =
    processingResult.status === 'matched'
      ? processingResult.result.id
      : processingResult.status === 'error'
        ? processingResult.errorTask.id
        : await getLatestLeafId(ty, rootTaskId)

  if (!terminalTaskId) {
    throw new Error('Expected a terminal task id for the created conversation')
  }
  return await ty.convertTaskIDs(await ty.getTaskIdChain(terminalTaskId))
}

const processConversationUntilReturn =
  (ty: Taskyon) => async (taskChain: ReturnType<typeof buildCreateNewTaskChain>) => {
    const tasks = await forgeTaskChain([taskChain])
    const initialIds = tasks.map((task) => task.id)
    const trackedIds = new Set(initialIds)
    const pendingByParentId = new Map<string, TaskNodeWithParent[]>()
    const observedTasks: TaskNode[] = []

    const appendPendingTask = (task: TaskNodeWithParent) => {
      const pending = pendingByParentId.get(task.parentID) ?? []
      pending.push(task)
      pendingByParentId.set(task.parentID, pending)
    }

    return await new Promise<ConversationRunResult>((resolve) => {
      const finish = (result: ConversationRunResult) => {
        clearTimeout(timeout)
        unsubscribe()
        resolve(result)
      }

      const emitTaskAndFlush = (task: TaskNodeWithParent) => {
        if (trackedIds.has(task.id)) return
        trackedIds.add(task.id)
        observedTasks.push(task)

        if (task.content.type === 'error') {
          finish({
            status: 'error',
            observedTasks,
            initialIds,
            error: new Error(`Task processing failed on task ${task.id}`, {
              cause: task.content.data,
            }),
            errorTask: task,
          })
          return
        }

        if (task.content.type === 'return') {
          finish({
            status: 'matched',
            result: task,
            stopTask: task,
            observedTasks,
            initialIds,
          })
          return
        }

        const pendingChildren = pendingByParentId.get(task.id) ?? []
        pendingByParentId.delete(task.id)
        pendingChildren.forEach(emitTaskAndFlush)
      }

      const unsubscribe = ty.port.receive((msg) => {
        if (msg.type !== 'taskCreated' || !msg.task || typeof msg.task.parentID !== 'string') return
        const task = msg.task as TaskNodeWithParent
        if (trackedIds.has(task.parentID)) {
          emitTaskAndFlush(task)
          return
        }
        appendPendingTask(task)
      })

      const timeoutMs = 120_000
      const timeout = setTimeout(() => {
        finish({
          status: 'timeout',
          observedTasks,
          initialIds,
          timeoutMs,
        })
      }, timeoutMs)

      void createTaskyonClient(ty.port).createTaskChain({
        tasks,
        execute: true,
        show: true,
      })
    })
  }

export const runTimeQuestionConversationUsesClockToolScenario = async (ty: Taskyon) => {
  const taskChain = buildCreateNewTaskChain({
    currentTask: null,
    draftTask: getSimpleMessageTask('hi! what is the time? use the tool please!'),
    entryNode: getEntryNodeDraft({
      use_tool_chooser: true,
      tool_chooser_min_tools: 0,
    }),
    mode: 'message',
  })

  const lastTask = taskChain.at(-1)
  assert(lastTask?.content.type === 'functioncall', 'Expected taskyonFlow at the end of the chain')
  assert(
    isNamedFunctionCall(lastTask.content.data, 'taskyonFlow'),
    'Expected the UI-style chain to end in taskyonFlow',
  )

  try {
    const processingResult = await processConversationUntilReturn(ty)(taskChain)
    const conversationTasks = await getConversationTasks(ty, processingResult)
    const observedTasks = processingResult.observedTasks
    const stopSummary = summarizeProcessingResult(processingResult)

    const shortlistCallIndex = conversationTasks.findIndex(
      (task: TaskNode) =>
        task.content.type === 'functioncall' &&
        isNamedFunctionCall(task.content.data, 'chatCompletion') &&
        hasToolChoiceSchema(task.content.data) &&
        hasPromptSnippet(task.content.data, 'Return only the structured shortlist result.'),
    )
    const shortlistCall =
      shortlistCallIndex >= 0 ? conversationTasks[shortlistCallIndex] : undefined
    const shortlistResult = conversationTasks.find(
      (task: TaskNode) =>
        task.content.type === 'structured' && hasToolChoice(task.content.data, 'clock'),
    )
    const chooseToolCall = conversationTasks.find(
      (task: TaskNode) =>
        task.content.type === 'functioncall' &&
        isNamedFunctionCall(task.content.data, 'chatCompletion') &&
        hasPromptSnippet(
          task.content.data,
          'Use exactly one of the allowed tools when needed to answer the previous user request.',
        ),
    )
    const clockCallIndex = conversationTasks.findIndex(
      (task: TaskNode) =>
        task.content.type === 'functioncall' && isNamedFunctionCall(task.content.data, 'clock'),
    )
    const tasksAfterClock = clockCallIndex >= 0 ? conversationTasks.slice(clockCallIndex + 1) : []
    const analyzeToolResultCall = tasksAfterClock.find(
      (task: TaskNode) =>
        task.content.type === 'functioncall' &&
        isNamedFunctionCall(task.content.data, 'chatCompletion') &&
        hasPromptSnippet(
          task.content.data,
          'Analyze the previous tool result and continue the task.',
        ),
    )
    const clockCall = clockCallIndex >= 0 ? conversationTasks[clockCallIndex] : undefined
    const clockResult = conversationTasks.find(isClockToolResult)
    const errorTask = conversationTasks.find((task: TaskNode) => task.content.type === 'error')
    const returnTasks = conversationTasks.filter((task: TaskNode) => task.content.type === 'return')
    const finalAssistantMessage = [...conversationTasks].reverse().find(isAssistantMessage)

    await assertWithDiagnostics(
      processingResult.status === 'matched',
      `Expected processing to stop on a return task, got ${processingResult.status}`,
      ty,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      processingResult.status !== 'matched' || processingResult.result.content.type === 'return',
      'Expected the stop task to be a return task',
      ty,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !!shortlistCall,
      'Expected a shortlist/decision phase before tool execution',
      ty,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !!shortlistResult,
      'Expected the shortlist phase to include the clock tool',
      ty,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !!chooseToolCall,
      'Expected a ChooseTool phase after the shortlist result',
      ty,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !!analyzeToolResultCall,
      'Expected an AnalyzeToolResult phase after the clock tool returned',
      ty,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !!clockCall,
      'Expected the time conversation to call the clock tool',
      ty,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !!clockResult,
      'Expected the clock tool result to contain time/date/weekday',
      ty,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !errorTask,
      'Expected the time conversation to finish without any error task',
      ty,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      returnTasks.length === 1,
      `Expected exactly one return task for the time conversation, got ${returnTasks.length}`,
      ty,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !!finalAssistantMessage,
      'Expected a final assistant message after the tool result',
      ty,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )

    return {
      taskChain,
      processingResult: stopSummary,
      observedTasks,
      conversationTasks,
      result: finalAssistantMessage,
    }
  } catch (error) {
    if (error instanceof Error && error.cause) {
      throw error
    }
    throw new Error('Time question conversation test failed', {
      cause: await collectTaskDiagnostics(ty, taskChain, [], [], error),
    })
  }
}
runTimeQuestionConversationUsesClockToolScenario.helper = true

export const testTimeQuestionConversationUsesClockTool = async (
  context?: DiagnosticsTestContext,
) => {
  if (!context?.providerKey) {
    return {
      skipped: true,
      reason: 'No configured provider key/session was available from the diagnostics harness.',
    }
  }
  const parsedLlmSettings = llmSettings.safeParse(context.llmSettings)
  if (!parsedLlmSettings.success) {
    return {
      skipped: true,
      reason: 'No runtime llmSettings were provided by the diagnostics harness.',
    }
  }

  const { ty, cleanup } = await createConversationHarness(parsedLlmSettings.data)
  try {
    const selectedApi = parsedLlmSettings.data.selectedApi ?? 'taskyon'
    const providerKey = context.providerKey
    await initializeProviderKey(ty, selectedApi, providerKey)
    return await runTimeQuestionConversationUsesClockToolScenario(ty)
  } finally {
    cleanup()
  }
}
testTimeQuestionConversationUsesClockTool.description =
  'Runs the exact UI-style initial Taskyon chain for a time question with the entry-node tool chooser forced on, then verifies shortlist, ChooseTool, clock execution, and final assistant response without intermediate error returns.'
testTimeQuestionConversationUsesClockTool.timeoutMs = 30_000
