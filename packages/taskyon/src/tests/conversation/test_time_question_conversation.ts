import {
  buildCreateNewTaskChain,
  partialTaskDraft,
  processTasksDetailed,
  type TaskNode,
} from '../..'
import { useTaskyonStore } from 'src/stores/taskyonState'

const tystate = useTaskyonStore()

function assert(condition: boolean, msg?: string): asserts condition {
  if (!condition) {
    throw new Error(msg ?? 'Assertion failed')
  }
}

const getEntryNodeDraft = () => partialTaskDraft.parse(structuredClone(tystate.entryNode))

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

const hasGoal = (data: unknown, goal: string): boolean => {
  if (!data || typeof data !== 'object' || !('arguments' in data)) return false
  const args = data.arguments
  return !!args && typeof args === 'object' && 'goal' in args && args.goal === goal
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
  taskChain: ReturnType<typeof buildCreateNewTaskChain>,
  observedTasks: TaskNode[],
  conversationTasks: TaskNode[],
  processingResult?: unknown,
) => {
  const metaEntries = await Promise.all(
    conversationTasks.map(async (task) => ({
      taskId: task.id,
      meta: (await tystate.getMeta(task.id)) ?? null,
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
  taskChain: ReturnType<typeof buildCreateNewTaskChain>,
  observedTasks: TaskNode[],
  conversationTasks: TaskNode[],
  processingResult?: unknown,
) => {
  if (condition) return
  throw new Error(message, {
    cause: await collectTaskDiagnostics(
      taskChain,
      observedTasks,
      conversationTasks,
      processingResult,
    ),
  })
}

const summarizeProcessingResult = (
  result: Awaited<ReturnType<ReturnType<typeof processTasksDetailed>>>,
) => {
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
    ...(result.status === 'timeout' ? { timeoutMs: result.timeoutMs } : {}),
    observedTaskIds: result.observedTasks.map((task) => task.id),
  }
}

const getLatestLeafId = async (rootTaskId: string) => {
  const ty = await tystate.taskyon
  const leafIds = await ty.findSiblingLeafTasks(rootTaskId)
  const leafTasks = await ty.convertTaskIDs(leafIds)
  const latestLeaf = leafTasks.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))[0]
  return latestLeaf?.id
}

const getConversationTasks = async (
  processingResult: Awaited<ReturnType<ReturnType<typeof processTasksDetailed>>>,
) => {
  const ty = await tystate.taskyon
  const rootTaskId = processingResult.initialIds.at(-1)
  if (!rootTaskId) {
    throw new Error('Expected an initial root task id for the created conversation')
  }

  const terminalTaskId =
    processingResult.status === 'matched'
      ? processingResult.result.id
      : processingResult.status === 'error'
        ? processingResult.errorTask.id
        : await getLatestLeafId(rootTaskId)

  if (!terminalTaskId) {
    throw new Error('Expected a terminal task id for the created conversation')
  }
  return await ty.convertTaskIDs(await ty.getTaskIdChain(terminalTaskId))
}

const processConversationUntilReturn = (taskChain: ReturnType<typeof buildCreateNewTaskChain>) => {
  return processTasksDetailed(tystate.api)([taskChain], 'return', {
    timeoutMs: 120_000,
    show: true,
    throwOnError: true,
  })
}

export const testTimeQuestionConversationUsesClockTool = async () => {
  const taskChain = buildCreateNewTaskChain({
    currentTask: null,
    draftTask: getSimpleMessageTask('hi! what is the time? use the tool please!'),
    entryNode: getEntryNodeDraft(),
    mode: 'message',
  })

  const lastTask = taskChain.at(-1)
  assert(lastTask?.content.type === 'functioncall', 'Expected taskyonFlow at the end of the chain')
  assert(
    isNamedFunctionCall(lastTask.content.data, 'taskyonFlow'),
    'Expected the UI-style chain to end in taskyonFlow',
  )

  try {
    const processingResult = await processConversationUntilReturn(taskChain)
    const conversationTasks = await getConversationTasks(processingResult)
    const observedTasks = processingResult.observedTasks
    const stopSummary = summarizeProcessingResult(processingResult)

    const shortlistCall = conversationTasks.find(
      (task: TaskNode) =>
        task.content.type === 'functioncall' &&
        isNamedFunctionCall(task.content.data, 'chatCompletion') &&
        hasGoal(task.content.data, 'AnalyzeToolResult'),
    )
    const shortlistResult = conversationTasks.find(
      (task: TaskNode) =>
        task.content.type === 'structured' && hasToolChoice(task.content.data, 'clock'),
    )
    const clockCall = conversationTasks.find(
      (task: TaskNode) =>
        task.content.type === 'functioncall' && isNamedFunctionCall(task.content.data, 'clock'),
    )
    const clockResult = conversationTasks.find(isClockToolResult)
    const errorTask = conversationTasks.find((task: TaskNode) => task.content.type === 'error')
    const returnTasks = conversationTasks.filter((task: TaskNode) => task.content.type === 'return')
    const finalAssistantMessage = [...conversationTasks].reverse().find(isAssistantMessage)
    await assertWithDiagnostics(
      processingResult.status === 'matched',
      `Expected processing to stop on a return task, got ${processingResult.status}`,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      processingResult.status !== 'matched' || processingResult.result.content.type === 'return',
      'Expected the stop task to be a return task',
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !!shortlistCall,
      'Expected a shortlist/decision phase before tool execution',
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !!shortlistResult,
      'Expected the shortlist phase to include the clock tool',
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !!clockCall,
      'Expected the time conversation to call the clock tool',
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !!clockResult,
      'Expected the clock tool result to contain time/date/weekday',
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !errorTask,
      'Expected the time conversation to finish without any error task',
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      returnTasks.length === 1,
      `Expected exactly one return task for the time conversation, got ${returnTasks.length}`,
      taskChain,
      observedTasks,
      conversationTasks,
      stopSummary,
    )
    await assertWithDiagnostics(
      !!finalAssistantMessage,
      'Expected a final assistant message after the tool result',
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
      cause: await collectTaskDiagnostics(taskChain, [], [], error),
    })
  }
}
testTimeQuestionConversationUsesClockTool.description =
  'Runs the exact UI-style initial Taskyon chain for a time question, waits for the terminal return, then inspects the resulting conversation thread to ensure the clock tool was selected and executed without intermediate error returns.'
