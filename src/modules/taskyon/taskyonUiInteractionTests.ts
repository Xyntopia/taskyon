import {
  buildCreateNewTaskChain,
  partialTaskDraft,
  type partialTaskDraft as PartialTaskDraft,
} from '@taskyon/taskyon'
import { processTasksDetailed, runTasks } from '@taskyon/tyclient'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { z } from 'zod'

const tystate = useTaskyonStore()

const toolCatalogResult = z.object({
  'Here are the currently available tools you can inspect': z.array(
    z.object({ name: z.string() }).passthrough(),
  ),
})

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

const waitForRegisteredTool = async (toolName: string, timeoutMs = 2_000) => {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const tool = tystate.allTools[toolName]
    if (tool) return tool
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return tystate.allTools[toolName]
}

export const testTaskyonUiSimpleChatInteraction = async () => {
  const taskChain = buildCreateNewTaskChain({
    currentTask: null,
    draftTask: getSimpleMessageTask('Please answer with one short plain-text sentence only.'),
    entryNode: getEntryNodeDraft(),
    mode: 'message',
  })

  const result = await runTasks(tystate.api)([taskChain], 'message', {
    display: 'background',
    timeoutMs: 50_000,
  })
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

  const result = await runTasks(tystate.api)([taskChain], 'message', {
    display: 'background',
    timeoutMs: 50_000,
  })
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

  const result = await runTasks(tystate.api)([taskChain], 'toolresult', {
    display: 'background',
    timeoutMs: 20_000,
  })
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

export const testTaskyonUiListsAndUsesAvailableTools = async () => {
  await tystate.taskyon

  const taskChain = buildCreateNewTaskChain({
    currentTask: null,
    draftTask: getSimpleMessageTask(
      [
        'Complete exactly these three authorized actions as separate sequential delegated tasks. Do not replace an action with a capability explanation.',
        'First, list all registered user-facing Taskyon tools using their public exact tool names. Reporting these public names is expected and safe.',
        'Second, use the registered weather capability to get the current weather for latitude 32.7157 and longitude -117.1611 and begin that result with WEATHER_TASK_COMPLETE.',
        'Third, use the registered animatedClock capability to open the existing animated alarm clock in a popup. The runtime confirms this tool is available and authorized. Begin that task result with ALARM_CLOCK_TASK_COMPLETE.',
      ].join(' '),
    ),
    entryNode: getEntryNodeDraft(),
    mode: 'message',
  })

  const execution = await processTasksDetailed(tystate.api)(
    [taskChain],
    (task) => task.content.type === 'functioncall' && task.content.data.name === 'newWindowOpener',
    { timeoutMs: 400_000, display: 'background' },
  )
  if (execution.status !== 'matched') {
    const observedTaskSummary = execution.observedTasks.map((task) => ({
      role: task.role,
      contentType: task.content.type,
      ...(task.content.type === 'functioncall'
        ? {
            tool: task.content.data.name,
            ...(['taskPlanner', 'taskyonFlow'].includes(task.content.data.name)
              ? { arguments: task.content.data.arguments }
              : {}),
          }
        : {}),
      ...(task.role === 'user' && task.content.type === 'message'
        ? { message: task.content.data }
        : {}),
      ...(task.content.type === 'error' ? { error: task.content.data } : {}),
    }))
    throw new Error(
      `Tool workflow ${execution.status}. Observed tasks: ${JSON.stringify(observedTaskSummary)}`,
    )
  }
  const result = execution.result
  const conversation = await tystate.taskyonClient.task.getChain({ id: result.id })
  const functionCalls = conversation
    .filter((task) => task.content.type === 'functioncall')
    .map((task) => (task.content.type === 'functioncall' ? task.content.data.name : ''))
  const catalogResult = conversation
    .filter((task) => task.content.type === 'toolresult')
    .map((task) =>
      task.content.type === 'toolresult'
        ? toolCatalogResult.safeParse(task.content.data)
        : undefined,
    )
    .find((candidate) => candidate?.success)

  assert(functionCalls.includes('taskPlanner'), 'Expected Taskyon to call taskPlanner')
  assert(functionCalls.includes('toolSearcher'), 'Expected Taskyon to call toolSearcher')
  assert(
    functionCalls.includes('openMeteoWeatherTool'),
    'Expected Taskyon to call openMeteoWeatherTool',
  )
  assert(functionCalls.includes('animatedClock'), 'Expected Taskyon to call animatedClock')
  assert(functionCalls.includes('newWindowOpener'), 'Expected animatedClock to open a popup')
  assert(
    catalogResult !== undefined && catalogResult.success,
    'Expected toolSearcher to return the available-tool catalog',
  )
  const availableToolNames = catalogResult.data[
    'Here are the currently available tools you can inspect'
  ].map((tool) => tool.name)
  for (const toolName of [
    'taskPlanner',
    'getGitlabInfo',
    'openMeteoWeatherTool',
    'animatedClock',
  ]) {
    assert(
      availableToolNames.includes(toolName),
      `Expected available-tool catalog to include ${toolName}`,
    )
  }
  const entryNodeSelections = conversation
    .filter(
      (task) =>
        task.content.type === 'functioncall' &&
        ['entryNode', 'taskyonFlow'].includes(task.content.data.name),
    )
    .map((task) =>
      task.content.type === 'functioncall' ? task.content.data.arguments.allowedTools : undefined,
    )
  for (const expectedTool of [
    'taskPlanner',
    'toolSearcher',
    'openMeteoWeatherTool',
    'animatedClock',
  ]) {
    assert(
      entryNodeSelections.some(
        (selection) =>
          Array.isArray(selection) && selection.length === 1 && selection[0] === expectedTool,
      ),
      `Expected an entry-node chooser to select only ${expectedTool}`,
    )
  }

  return { taskChain, result, conversation }
}
testTaskyonUiListsAndUsesAvailableTools.description =
  'Runs the browser Taskyon entry flow, plans separate tool-list, weather, and animated-clock tasks, and verifies each delegated entry node chooses its relevant tool.'

export const testTaskyonUiProfileManagementToolRegistration = async () => {
  await tystate.taskyon
  const tool = await waitForRegisteredTool('manageTaskyonProfile')
  assert(!!tool, 'Expected manageTaskyonProfile to be registered as a Taskyon UI tool')

  return {
    toolName: tool.name,
  }
}
testTaskyonUiProfileManagementToolRegistration.description =
  'Verifies the Taskyon UI registers the profile-management tool.'

export const testTaskyonUiDocumentationToolsRegistration = async () => {
  await tystate.taskyon
  const workflowTool = await waitForRegisteredTool('taskyonDocumentation')
  const indexTool = await waitForRegisteredTool('documentationIndex')
  assert(!!workflowTool, 'Expected Taskyon documentation workflow tool to be registered')
  assert(!!indexTool, 'Expected generic documentation index tool to be registered')

  return {
    workflowTool: workflowTool.name,
    indexTool: indexTool.name,
  }
}
testTaskyonUiDocumentationToolsRegistration.description =
  'Verifies the Taskyon UI registers the Taskyon documentation workflow and generic runtime index.'
