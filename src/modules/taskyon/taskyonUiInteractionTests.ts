import {
  buildCreateNewTaskChain,
  partialTaskDraft,
  type partialTaskDraft as PartialTaskDraft,
} from '@taskyon/taskyon'
import { processTasks } from '@taskyon/tyclient'
import { useTaskyonStore } from 'src/stores/taskyonState'

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
