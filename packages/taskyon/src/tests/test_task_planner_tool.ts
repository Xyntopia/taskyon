import { TaskNode as TaskNodeSchema, type TaskNode } from '../types/taskNode'
import { buildTaskPlannerTaskChains, normalizePlannedTaskInput } from '../tools/TaskPlannerTool'

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
  const chains = buildTaskPlannerTaskChains(
    [
      [
        'Investigate API migration risks',
        { task: 'Compare rollout options', allowedTools: ['websearch'] },
      ],
      ['Gather current dependency constraints'],
    ],
    createPlannerContext(),
  )

  assert(chains.length === 2, `Expected 2 parallel chains, got ${chains.length}`)
  assert(
    chains[0]?.length === 8,
    `Expected 8 tasks in first sequential chain, got ${chains[0]?.length}`,
  )
  assert(chains[1]?.length === 4, `Expected 4 tasks in second chain, got ${chains[1]?.length}`)

  const firstTask = chains[0]?.[0]
  assert(firstTask?.role === 'user', 'Expected first planner bootstrap task to be a user message')
  assert(
    firstTask?.content.type === 'message' &&
      firstTask.content.data.includes('Subtask objective: Investigate API migration risks'),
    'Expected first planner bootstrap message to contain the delegated objective',
  )
  assert(
    firstTask?.content.type === 'message' &&
      firstTask.content.data.includes('Shared planner context:'),
    'Expected first planner bootstrap message to include inherited planner context',
  )

  const planningCall = getFunctionCall(chains[0]?.[1])
  assert(
    planningCall &&
      typeof planningCall === 'object' &&
      'name' in planningCall &&
      planningCall.name === 'chatCompletion',
    'Expected second task to be a chatCompletion planning call',
  )
  assert(
    planningCall &&
      typeof planningCall === 'object' &&
      'arguments' in planningCall &&
      planningCall.arguments &&
      typeof planningCall.arguments === 'object' &&
      'goal' in planningCall.arguments &&
      planningCall.arguments.goal === 'SimpleCompletion',
    'Expected planner chatCompletion to use goal SimpleCompletion',
  )

  const firstEntryNodeCall = getFunctionCall(chains[0]?.[3])
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
      !('allowedTools' in firstEntryNodeCall.arguments),
    'Expected plain string tasks to leave allowedTools unrestricted',
  )

  const restrictedEntryNodeCall = getFunctionCall(chains[0]?.[7])
  assert(
    restrictedEntryNodeCall &&
      typeof restrictedEntryNodeCall === 'object' &&
      'arguments' in restrictedEntryNodeCall &&
      restrictedEntryNodeCall.arguments &&
      typeof restrictedEntryNodeCall.arguments === 'object' &&
      'allowedTools' in restrictedEntryNodeCall.arguments &&
      Array.isArray(restrictedEntryNodeCall.arguments.allowedTools) &&
      restrictedEntryNodeCall.arguments.allowedTools[0] === 'websearch',
    'Expected object tasks to forward allowedTools to entryNode',
  )

  return { success: true }
}

export const testTaskPlannerNormalizesTaskInputs = () => {
  const stringTask = normalizePlannedTaskInput('  Search with a different angle  ')
  assert(stringTask.task === 'Search with a different angle', 'Expected string tasks to be trimmed')
  assert(!stringTask.allowedTools, 'Expected plain string tasks to keep allowedTools undefined')

  const objectTask = normalizePlannedTaskInput({
    task: 'Summarize the findings',
    allowedTools: ['ragSearchTool'],
  })
  assert(objectTask.task === 'Summarize the findings', 'Expected object task to preserve task text')
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

  return { success: true }
}

testTaskPlannerBuildsParallelAndSequentialChains.description =
  'Builds planner task chains where outer groups are parallel and inner tasks expand into sequential entryNode bootstrap chains.'
testTaskPlannerNormalizesTaskInputs.description =
  'Normalizes planner task inputs and rejects invalid task planner objects at the boundary.'
