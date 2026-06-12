import { processTasks } from '@taskyon/client'
import { buildCreateNewTaskChain, partialTaskDraft, type TaskNode } from '../..'
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

export const testTimeQuestionConversationUsesClockTool = async () => {
  const taskChain = buildCreateNewTaskChain({
    currentTask: null,
    draftTask: getSimpleMessageTask('hi! what is the time?'),
    entryNode: getEntryNodeDraft(),
    mode: 'message',
  })

  const lastTask = taskChain.at(-1)
  assert(lastTask?.content.type === 'functioncall', 'Expected taskyonFlow at the end of the chain')
  assert(
    isNamedFunctionCall(lastTask.content.data, 'taskyonFlow'),
    'Expected the UI-style chain to end in taskyonFlow',
  )

  const observedTasks: TaskNode[] = []
  const unsubscribe = tystate.api.receive((msg) => {
    if (msg.type === 'taskCreated' && msg.task) {
      observedTasks.push(msg.task)
    }
  })

  try {
    const result = await processTasks(tystate.api)(
      [taskChain],
      (task) => task.content.type === 'return' && task.content.data === 'assistant answered',
      { timeoutMs: 50_000 },
    )

    const shortlistCall = observedTasks.find(
      (task) =>
        task.content.type === 'functioncall' &&
        isNamedFunctionCall(task.content.data, 'chatCompletion') &&
        hasGoal(task.content.data, 'AnalyzeToolResult'),
    )
    const shortlistResult = observedTasks.find(
      (task) => task.content.type === 'structured' && hasToolChoice(task.content.data, 'clock'),
    )
    const clockCall = observedTasks.find(
      (task) =>
        task.content.type === 'functioncall' && isNamedFunctionCall(task.content.data, 'clock'),
    )
    const clockResult = observedTasks.find(isClockToolResult)
    const errorTask = observedTasks.find((task) => task.content.type === 'error')
    const assistantMessage = observedTasks.find(
      (task) =>
        task.role === 'assistant' &&
        task.content.type === 'message' &&
        typeof task.content.data === 'string' &&
        task.content.data.trim().length > 0,
    )

    assert(!!shortlistCall, 'Expected a shortlist/decision phase before tool execution')
    assert(!!shortlistResult, 'Expected the shortlist phase to include the clock tool')
    assert(!!clockCall, 'Expected the time conversation to call the clock tool')
    assert(!!clockResult, 'Expected the clock tool result to contain time/date/weekday')
    assert(!errorTask, 'Expected the time conversation to finish without any error task')
    assert(!!assistantMessage, 'Expected a non-empty assistant message after the tool result')
    assert(result.content.type === 'return', `Expected return result, got ${result.content.type}`)

    return {
      taskChain,
      observedTasks,
      result,
    }
  } finally {
    unsubscribe()
  }
}
testTimeQuestionConversationUsesClockTool.description =
  'Runs the exact UI-style initial Taskyon chain for a time question and asserts that the conversation auto-selects and executes the clock tool without any error task.'
