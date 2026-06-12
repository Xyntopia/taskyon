import { partialTaskDraft, type partialTaskDraft as PartialTaskDraft } from '@taskyon/taskyon'
import { processTasks } from '@taskyon/client'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { buildCreateNewTaskChain } from './createNewTaskChain'

const tystate = useTaskyonStore()

function assert(condition: boolean, msg?: string): asserts condition {
  if (!condition) {
    throw new Error(msg ?? 'Assertion failed')
  }
}

const getEntryNodeDraft = (): PartialTaskDraft => {
  return partialTaskDraft.parse(structuredClone(tystate.entryNode))
}

const getSimpleMessageTask = (text: string): PartialTaskDraft => ({
  role: 'user',
  content: {
    type: 'message',
    data: text,
  },
})

const getClockToolTask = (): PartialTaskDraft => ({
  role: 'function',
  content: {
    type: 'functioncall',
    data: {
      name: 'clock',
      arguments: {},
    },
  },
})

const hasEnabledWebSearch = (value: unknown): boolean => {
  if (!value || typeof value !== 'object' || !('websearch' in value)) return false
  const websearch = value.websearch
  return (
    !!websearch &&
    typeof websearch === 'object' &&
    'enabled' in websearch &&
    websearch.enabled === true
  )
}

export const testTaskyonUiSimpleChatInteraction = async () => {
  const taskChain = buildCreateNewTaskChain({
    currentTask: null,
    draftTask: getSimpleMessageTask('Please answer with one short plain-text sentence only.'),
    entryNode: getEntryNodeDraft(),
    mode: 'message',
  })

  const result = await processTasks(tystate.api)([taskChain], 'message', { timeoutMs: 50_000 })
  assert(result.content.type === 'message', `Expected message result, got ${result.content.type}`)
  assert(result.content.data.trim().length > 0, 'Expected non-empty assistant message')

  return {
    taskChain,
    result,
  }
}
testTaskyonUiSimpleChatInteraction.description =
  'Runs the same initial Taskyon UI chat chain builder as CreateNewTask and expects a plain message result.'

export const testTaskyonUiWebSearchInteraction = async () => {
  const taskChain = buildCreateNewTaskChain({
    currentTask: null,
    draftTask: getSimpleMessageTask(
      'Please search the web for what Taskyon is and answer in two short sentences.',
    ),
    entryNode: getEntryNodeDraft(),
    mode: 'websearch',
  })

  const lastTask = taskChain.at(-1)
  assert(
    lastTask?.content.type === 'functioncall',
    'Expected entry node function call at chain end',
  )
  assert(
    hasEnabledWebSearch(lastTask.content.data.arguments),
    'Expected websearch to be enabled in the entry node arguments',
  )

  const result = await processTasks(tystate.api)([taskChain], 'message', { timeoutMs: 50_000 })
  assert(result.content.type === 'message', `Expected message result, got ${result.content.type}`)
  assert(result.content.data.trim().length > 0, 'Expected non-empty websearch response')

  return {
    taskChain,
    result,
  }
}
testTaskyonUiWebSearchInteraction.description =
  'Builds the UI-style websearch chain, verifies the entry-node websearch flag, and expects a non-empty message result.'

export const testTaskyonUiToolInteraction = async () => {
  const taskChain = buildCreateNewTaskChain({
    currentTask: null,
    draftTask: getClockToolTask(),
    mode: 'message',
  })

  const result = await processTasks(tystate.api)([taskChain], 'toolresult', { timeoutMs: 20_000 })
  assert(result.content.type === 'toolresult', `Expected toolresult, got ${result.content.type}`)
  const data = result.content.data
  assert(!!data && typeof data === 'object', 'Expected clock tool to return an object payload')
  assert('time' in data, 'Expected clock tool result to contain time')
  assert('date' in data, 'Expected clock tool result to contain date')
  assert('weekday' in data, 'Expected clock tool result to contain weekday')

  return {
    taskChain,
    result,
  }
}
testTaskyonUiToolInteraction.description =
  'Builds the same initial function-call chain the UI would send for a tool task and expects the clock tool result.'

export const testTaskyonUiTimeQuestionUsesClockTool = async () => {
  const taskChain = buildCreateNewTaskChain({
    currentTask: null,
    draftTask: getSimpleMessageTask('hi! whats the time?'),
    entryNode: getEntryNodeDraft(),
    mode: 'message',
  })

  const observedTasks: Array<{ role: string; content: { type: string; data: unknown } }> = []
  const unsubscribe = tystate.api.receive((msg) => {
    if (msg.type === 'taskCreated' && msg.task) {
      observedTasks.push({
        role: msg.task.role,
        content: {
          type: msg.task.content.type,
          data: msg.task.content.data,
        },
      })
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
    const clockResult = observedTasks.find(
      (task) =>
        task.content.type === 'toolresult' &&
        !!task.content.data &&
        typeof task.content.data === 'object' &&
        'time' in task.content.data &&
        'date' in task.content.data &&
        'weekday' in task.content.data,
    )
    const errorTask = observedTasks.find((task) => task.content.type === 'error')
    const assistantMessage = observedTasks.find(
      (task) =>
        task.role === 'assistant' &&
        task.content.type === 'message' &&
        typeof task.content.data === 'string' &&
        task.content.data.trim().length > 0,
    )

    assert(!!shortlistCall, 'Expected taskyonFlow to run the internal tool shortlist phase')
    assert(!!shortlistResult, 'Expected the shortlist phase to include the clock tool')
    assert(!!clockCall, 'Expected the time question flow to call the clock tool')
    assert(!!clockResult, 'Expected a clock tool result containing time/date/weekday')
    assert(!errorTask, 'Expected the time question flow to finish without any error task')
    assert(!!assistantMessage, 'Expected a final assistant message after the clock tool result')
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
testTaskyonUiTimeQuestionUsesClockTool.description =
  'Runs the UI-style "what is the time" flow through taskyonFlow and asserts that the internal shortlist phase selects the clock tool without any error task.'

function isNamedFunctionCall(data: unknown, name: string): boolean {
  return !!data && typeof data === 'object' && 'name' in data && data.name === name
}

function hasGoal(data: unknown, goal: string): boolean {
  if (!data || typeof data !== 'object' || !('arguments' in data)) return false
  const args = data.arguments
  return !!args && typeof args === 'object' && 'goal' in args && args.goal === goal
}

function hasToolChoice(data: unknown, toolName: string): boolean {
  if (!data || typeof data !== 'object' || !('choice' in data)) return false
  const choice = data.choice
  return Array.isArray(choice) && choice.includes(toolName)
}
