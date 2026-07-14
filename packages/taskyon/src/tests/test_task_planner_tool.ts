import { TaskNode as TaskNodeSchema, type TaskNode } from '../types/taskNode'
import { createSubtasksResult, type toolContext } from '../types/toolApi'
import {
  buildTaskPlannerTaskChains,
  normalizePlannedTaskInput,
  taskPlanner,
} from '../tools/TaskPlannerTool'
import {
  selectChildTaskChains,
  selectSiblingTaskChain,
  selectTaskQueueBranches,
} from '../core/taskQueueSelection'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

const getFunctionCall = (task: unknown) => {
  if (!task || typeof task !== 'object' || !('content' in task)) return undefined
  const content = task.content
  if (!content || typeof content !== 'object' || !('type' in content) || !('data' in content)) {
    return undefined
  }
  return content.type === 'functioncall' ? content.data : undefined
}

const createPlannerContext = (): TaskNode[] => [
  TaskNodeSchema.parse({
    id: '1',
    role: 'user',
    content: {
      type: 'message',
      data: 'Research the best approach for this migration.',
    },
  }),
  TaskNodeSchema.parse({
    id: '2',
    role: 'assistant',
    priorID: '1',
    content: {
      type: 'message',
      data: 'I will split this into several sub-investigations.',
    },
  }),
]

export const testTaskPlannerBuildsParallelAndSequentialChains = () => {
  const chains = buildTaskPlannerTaskChains([
    [
      'Investigate API migration risks',
      {
        task: 'Compare rollout options',
        agentInstructions:
          'Act as a system architect. Focus on ownership boundaries and migration risk.',
        allowedTools: ['websearch'],
        doneWhen: [
          'Each viable rollout option has explicit tradeoffs.',
          'A recommended option is identified.',
        ],
        result: {
          mode: 'structured',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              recommendation: { type: 'string' },
              risks: { type: 'array', items: { type: 'string' } },
            },
            required: ['recommendation', 'risks'],
          },
        },
      },
    ],
    ['Gather current dependency constraints'],
  ])

  assert(chains.length === 2, `Expected 2 parallel chains, got ${chains.length}`)
  assert(
    chains[0]?.length === 5,
    `Expected 5 tasks in first sequential chain, got ${chains[0]?.length}`,
  )
  assert(chains[1]?.length === 2, `Expected 2 tasks in second chain, got ${chains[1]?.length}`)

  const firstTask = chains[0]?.[0]
  assert(firstTask?.role === 'user', 'Expected first planner bootstrap task to be a user message')
  assert(
    firstTask?.content.type === 'message' &&
      firstTask.content.data.includes('Task objective:\nInvestigate API migration risks'),
    'Expected first planner bootstrap message to contain the delegated objective',
  )
  assert(
    firstTask?.content.type === 'message' &&
      !firstTask.content.data.includes('Shared planner context:') &&
      !firstTask.content.data.includes('Research the best approach for this migration.'),
    'Expected planner task messages to rely on lineage instead of copying planner context',
  )

  const firstEntryNodeCall = getFunctionCall(chains[0]?.[1])
  assert(
    firstEntryNodeCall &&
      typeof firstEntryNodeCall === 'object' &&
      'name' in firstEntryNodeCall &&
      firstEntryNodeCall.name === 'entryNode',
    'Expected planner to hand each task back to entryNode',
  )
  assert(
    firstEntryNodeCall &&
      typeof firstEntryNodeCall === 'object' &&
      'arguments' in firstEntryNodeCall &&
      firstEntryNodeCall.arguments &&
      typeof firstEntryNodeCall.arguments === 'object' &&
      !('allowedTools' in firstEntryNodeCall.arguments) &&
      'taskContract' in firstEntryNodeCall.arguments,
    'Expected plain string tasks to pass a task contract while leaving tools unrestricted',
  )

  const roleMessage = chains[0]?.[2]
  assert(
    roleMessage?.role === 'system' &&
      roleMessage.content.type === 'message' &&
      roleMessage.content.data ===
        'Act as a system architect. Focus on ownership boundaries and migration risk.',
    'Expected agent instructions to render once as a system message',
  )

  const contractedTaskMessage = chains[0]?.[3]
  assert(
    contractedTaskMessage?.role === 'user' &&
      contractedTaskMessage.content.type === 'message' &&
      contractedTaskMessage.content.data.includes('Task objective:\nCompare rollout options') &&
      contractedTaskMessage.content.data.includes(
        '- Each viable rollout option has explicit tradeoffs.',
      ) &&
      !contractedTaskMessage.content.data.includes('Act as a system architect') &&
      !contractedTaskMessage.content.data.includes('recommendation:'),
    'Expected task message to contain objective and completion criteria without duplicating agent instructions or result schema',
  )

  const restrictedEntryNodeCall = getFunctionCall(chains[0]?.[4])
  assert(
    restrictedEntryNodeCall &&
      typeof restrictedEntryNodeCall === 'object' &&
      'arguments' in restrictedEntryNodeCall &&
      restrictedEntryNodeCall.arguments &&
      typeof restrictedEntryNodeCall.arguments === 'object' &&
      'allowedTools' in restrictedEntryNodeCall.arguments &&
      Array.isArray(restrictedEntryNodeCall.arguments.allowedTools) &&
      restrictedEntryNodeCall.arguments.allowedTools[0] === 'websearch' &&
      'taskContract' in restrictedEntryNodeCall.arguments &&
      restrictedEntryNodeCall.arguments.taskContract &&
      typeof restrictedEntryNodeCall.arguments.taskContract === 'object' &&
      'agentInstructions' in restrictedEntryNodeCall.arguments.taskContract &&
      'result' in restrictedEntryNodeCall.arguments.taskContract,
    'Expected object tasks to forward tools and the complete contract to entryNode',
  )

  const reviewMessage = chains[0]?.find(
    (task) =>
      task.content.type === 'message' &&
      task.content.data.includes('Review the delegated work against the original request'),
  )
  assert(!reviewMessage, 'Expected planner branches not to add an implicit review task')

  return { success: true }
}

export const testTaskPlannerDoesNotAddImplicitReviewCheckpoint = () => {
  const chains = buildTaskPlannerTaskChains([['Inspect project']])

  assert(chains.length === 1, `Expected 1 chain, got ${chains.length}`)
  assert(
    chains[0]?.length === 2,
    `Expected one planner task without an implicit review checkpoint, got ${chains[0]?.length}`,
  )
  const reviewTask = chains[0]?.find(
    (task) =>
      task.content.type === 'message' &&
      typeof task.content.data === 'string' &&
      task.content.data.includes('Planner review checkpoint.'),
  )
  assert(!reviewTask, 'Expected no implicit planner review checkpoint')

  return { success: true }
}

export const testTaskPlannerNormalizesTaskInputs = () => {
  const stringTask = normalizePlannedTaskInput('  Search with a different angle  ')
  assert(
    stringTask.taskContract.objective === 'Search with a different angle',
    'Expected string tasks to become trimmed task contracts',
  )
  assert(
    stringTask.taskContract.result?.mode === 'message',
    'Expected string tasks to default to message results',
  )
  assert(!stringTask.allowedTools, 'Expected plain string tasks to keep allowedTools undefined')

  const objectTask = normalizePlannedTaskInput({
    task: 'Summarize the findings',
    agentInstructions: 'Act as a concise technical editor.',
    allowedTools: ['ragSearchTool'],
    doneWhen: ['The important findings and caveats are surfaced.'],
    result: {
      mode: 'structured',
      schema: {
        type: 'object',
        properties: { summary: { type: 'string' } },
        required: ['summary'],
      },
    },
  })
  assert(
    objectTask.taskContract.objective === 'Summarize the findings',
    'Expected object task to preserve its objective',
  )
  assert(
    objectTask.taskContract.agentInstructions === 'Act as a concise technical editor.',
    'Expected object task to preserve agent instructions',
  )
  assert(
    objectTask.taskContract.doneWhen?.[0] === 'The important findings and caveats are surfaced.',
    'Expected object task to preserve completion criteria',
  )
  assert(
    objectTask.taskContract.result?.mode === 'structured',
    'Expected object task to preserve its result contract',
  )
  assert(
    objectTask.allowedTools?.[0] === 'ragSearchTool',
    'Expected object task to preserve allowedTools',
  )

  let errorMessage = ''
  try {
    normalizePlannedTaskInput({ task: '', allowedTools: [1] })
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }
  assert(
    errorMessage.includes('non-empty "task" string'),
    `Expected invalid planner task objects to be rejected, got ${errorMessage}`,
  )

  errorMessage = ''
  try {
    normalizePlannedTaskInput({
      task: 'Return structured findings',
      result: { mode: 'structured' },
    })
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : String(error)
  }
  assert(
    errorMessage.includes('requires a JSON schema'),
    `Expected structured planner results without a schema to be rejected, got ${errorMessage}`,
  )

  return { success: true }
}

export const testTaskPlannerReturnsOnlyDelegatedBranches = async () => {
  if (!taskPlanner.function) throw new Error('Expected taskPlanner to have a function')

  const context: toolContext = {
    getExecutionTaskChain: () => Promise.resolve(createPlannerContext()),
    createSubtasksResult,
    getSecret: () => Promise.resolve(null),
    setSecret: () => Promise.resolve(),
    stopSignal: new AbortController().signal,
    toolId: 'test-task-planner',
  }
  const result = await taskPlanner.function({ tasks: [['Inspect project']] }, context)
  assert(
    result.taskChainList.length === 1,
    `Expected only one delegated branch, got ${result.taskChainList.length}`,
  )
  assert(
    result.taskChainList
      .flat()
      .every(
        (task) =>
          task.content.type !== 'message' || !task.content.data.startsWith('Task Breakdown:'),
      ),
    'Expected taskPlanner not to add a duplicate task-breakdown branch',
  )
  assert(
    taskPlanner.renderOptions?.hideLlm === true,
    'Expected taskPlanner orchestration calls to stay out of later LLM context',
  )
  const tasksDescription = taskPlanner.parameters.properties.tasks.description
  assert(
    tasksDescription?.includes('Every delegated task must surface') &&
      tasksDescription.includes('outer workflow sequential') &&
      tasksDescription.includes('Stop recursive planning') &&
      tasksDescription.includes('one concrete task per requested objective') &&
      tasksDescription.includes('Preserve explicit requested actions'),
    'Expected map/reduce and result-handoff policy in the provider-visible task schema',
  )
  assert(
    !('default' in taskPlanner.parameters.properties.parallel),
    'Expected the optional parallel flag not to advertise a redundant false default',
  )
  const providerTaskProperties =
    taskPlanner.parameters.properties.tasks.items.items.anyOf[1].properties
  assert(
    !('allowedTools' in providerTaskProperties),
    'Expected delegated entry nodes, not taskPlanner, to choose execution tools',
  )

  return { success: true }
}

export const testTaskPlannerDefaultsToSequentialGroups = async () => {
  if (!taskPlanner.function) throw new Error('Expected taskPlanner to have a function')

  const context: toolContext = {
    getExecutionTaskChain: () => Promise.resolve(createPlannerContext()),
    createSubtasksResult,
    getSecret: () => Promise.resolve(null),
    setSecret: () => Promise.resolve(),
    stopSignal: new AbortController().signal,
    toolId: 'test-task-planner',
  }
  const result = await taskPlanner.function(
    {
      tasks: [['Implement artifact'], ['Write README'], ['Run verification']],
    },
    context,
  )
  const delegatedBranches = result.taskChainList

  assert(
    delegatedBranches.length === 1,
    `Expected default planner mode to create one sequential branch, got ${delegatedBranches.length}`,
  )
  assert(
    delegatedBranches[0]?.length === 6,
    `Expected one branch with three sequential planner tasks, got ${delegatedBranches[0]?.length}`,
  )

  return { success: true }
}

export const testTaskQueueSelectionGroupsPendingParallelBranches = () => {
  const branchA = [
    TaskNodeSchema.parse({
      id: 'a-message',
      parentID: 'planner',
      role: 'user',
      content: { type: 'message', data: 'Research implementation evidence.' },
    }),
    TaskNodeSchema.parse({
      id: 'a-entry',
      parentID: 'planner',
      priorID: 'a-message',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'entryNode', arguments: {} } },
    }),
  ]
  const branchB = [
    TaskNodeSchema.parse({
      id: 'b-message',
      parentID: 'planner',
      role: 'user',
      content: { type: 'message', data: 'Research documentation evidence.' },
    }),
  ]
  const stages = new Map([
    ['a-message', 'processing' as const],
    ['a-entry', 'waiting' as const],
    ['b-message', 'queued' as const],
  ])

  const branches = selectTaskQueueBranches([branchA, branchB, branchA], stages)

  assert(
    branches.length === 2,
    `Expected two deduplicated visible queue branches, got ${branches.length}`,
  )
  assert(
    branches[0]?.activeTasks[0]?.id === 'a-message' &&
      branches[0]?.pendingTasks[0]?.id === 'a-entry',
    'Expected branch A to separate active and pending tasks',
  )
  assert(
    branches[1]?.pendingTasks[0]?.id === 'b-message',
    'Expected the unselected parallel branch to remain visible in the queue',
  )
  const childChains = selectChildTaskChains('planner', [...branchA, ...branchB])
  assert(
    childChains.map((chain) => chain.map((task) => task.id).join(',')).join('|') ===
      'a-message,a-entry|b-message',
    `Expected first-level child chains grouped by prior links, got ${childChains
      .map((chain) => chain.map((task) => task.id).join(','))
      .join('|')}`,
  )

  const selectedLineage = [
    TaskNodeSchema.parse({
      id: 'outer',
      role: 'function',
      content: { type: 'functioncall', data: { name: 'taskPlanner', arguments: {} } },
    }),
    ...branchA,
  ]
  const siblingChain = selectSiblingTaskChain(selectedLineage)
  assert(
    siblingChain.map((task) => task.id).join(',') === 'a-message,a-entry',
    `Expected only the selected leaf's first hierarchy, got ${siblingChain
      .map((task) => task.id)
      .join(',')}`,
  )

  return { success: true }
}

testTaskPlannerBuildsParallelAndSequentialChains.description =
  'Builds planner task contracts as non-duplicated system/user messages followed directly by entryNode calls.'
testTaskPlannerDoesNotAddImplicitReviewCheckpoint.description =
  'Builds planner task chains without implicit reviews; planners must request synthesis explicitly.'
testTaskPlannerNormalizesTaskInputs.description =
  'Normalizes planner task inputs and rejects invalid task planner objects at the boundary.'
testTaskPlannerReturnsOnlyDelegatedBranches.description =
  'Ensures taskPlanner returns only delegated work and hides orchestration-only calls from later LLM context.'
testTaskPlannerDefaultsToSequentialGroups.description =
  'Ensures taskPlanner flattens dependent groups into one sequential branch unless parallel execution is explicit.'
testTaskQueueSelectionGroupsPendingParallelBranches.description =
  'Groups active and pending tasks across first-level parallel branches while keeping selected lineage traversal at one hierarchy.'
