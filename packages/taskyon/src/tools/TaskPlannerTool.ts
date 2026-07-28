import type { JSONSchema7, JSONSchema7Definition } from 'json-schema'
import type { TyTaskManager } from '../core/taskManager'
import type { partialTaskDraft } from '../types/taskNode'
import { taskTypeOptions } from '../types/taskNode'
import {
  taskContractResultSchema,
  type TaskContract,
  type TaskContractResult,
} from '../types/taskContract'
import { createTool, toolCall } from '../types/toolApi'

type PlannedTaskConfig = {
  taskContract: TaskContract
  allowedTools?: string[]
}

type PlannedTaskInput =
  | string
  | {
      task: string
      agentInstructions?: string
      allowedTools?: string[]
      doneWhen?: string[]
      result?: TaskContractResult | 'message' | null
    }

const plannerTaskObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task: {
      type: 'string',
      description: 'Objective for this task. Keep it concrete and goal-oriented.',
    },
    agentInstructions: {
      type: 'string',
      description:
        'Optional task-specific behavior instructions, such as acting as a security reviewer or system architect.',
    },
    doneWhen: {
      type: 'array',
      items: { type: 'string' },
      description: 'Optional semantic criteria that define when the task is complete.',
    },
    result: {
      anyOf: [taskContractResultSchema, { type: 'null' }, { const: 'message' }],
    },
  },
  required: ['task'],
} as const satisfies JSONSchema7

const plannerTaskItemSchema = {
  anyOf: [{ type: 'string' }, plannerTaskObjectSchema],
} as const satisfies JSONSchema7

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isStructuredResultSchema = (value: unknown): value is JSONSchema7 & Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  'type' in value &&
  value.type === 'object'

const isSchemaPropertyMap = (value: unknown): value is Record<string, JSONSchema7Definition> =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length > 0 &&
  Object.values(value).every(
    (property) =>
      typeof property === 'boolean' ||
      (property !== null && typeof property === 'object' && !Array.isArray(property)),
  )

const normalizeStructuredResultSchema = (value: unknown): JSONSchema7 => {
  if (isStructuredResultSchema(value)) return value
  if (isSchemaPropertyMap(value)) {
    return {
      type: 'object',
      properties: value,
      required: Object.keys(value),
    }
  }
  throw new Error(
    'Planner structured results require a valid JSON Schema with top-level type "object" or a map of field names to JSON Schema property definitions.',
  )
}

const normalizeTaskResult = (value: unknown): TaskContractResult => {
  if (value === undefined || value === null || value === 'message') return { mode: 'message' }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Planner task "result" must be an object.')
  }

  const candidate: { mode?: unknown; schema?: unknown } = value
  if (candidate.mode === 'message') return { mode: 'message' }
  if (candidate.mode !== 'structured') {
    throw new Error('Planner task result mode must be "message" or "structured".')
  }
  if (candidate.schema === undefined) {
    throw new Error(`Planner task result mode "${candidate.mode}" requires a JSON schema.`)
  }
  return { mode: candidate.mode, schema: normalizeStructuredResultSchema(candidate.schema) }
}

export const normalizePlannedTaskInput = (value: unknown): PlannedTaskConfig => {
  if (typeof value === 'string') {
    const task = value.trim()
    if (task.length === 0) {
      throw new Error('Planner task strings must not be empty.')
    }
    return {
      taskContract: {
        objective: task,
        result: { mode: 'message' },
      },
    }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Planner tasks must be either a string or an object with a task field.')
  }

  const candidate: {
    task?: unknown
    agentInstructions?: unknown
    allowedTools?: unknown
    doneWhen?: unknown
    result?: unknown
  } = value
  const rawTask = candidate.task
  if (typeof rawTask !== 'string' || rawTask.trim().length === 0) {
    throw new Error('Planner task objects require a non-empty "task" string.')
  }

  const rawAgentInstructions = candidate.agentInstructions
  if (rawAgentInstructions !== undefined && typeof rawAgentInstructions !== 'string') {
    throw new Error('Planner task "agentInstructions" must be a string when provided.')
  }
  const rawAllowedTools = candidate.allowedTools
  if (rawAllowedTools !== undefined && !isStringArray(rawAllowedTools)) {
    throw new Error('Planner task "allowedTools" must be an array of strings when provided.')
  }
  const rawDoneWhen = candidate.doneWhen
  if (rawDoneWhen !== undefined && !isStringArray(rawDoneWhen)) {
    throw new Error('Planner task "doneWhen" must be an array of strings when provided.')
  }

  return {
    taskContract: {
      objective: rawTask.trim(),
      ...(rawAgentInstructions !== undefined && rawAgentInstructions.trim().length > 0
        ? { agentInstructions: rawAgentInstructions.trim() }
        : {}),
      ...(rawDoneWhen !== undefined
        ? { doneWhen: rawDoneWhen.map((criterion) => criterion.trim()).filter(Boolean) }
        : {}),
      result: normalizeTaskResult(candidate.result),
    },
    ...(rawAllowedTools !== undefined ? { allowedTools: rawAllowedTools } : {}),
  }
}

const renderTaskContractMessage = (contract: TaskContract) =>
  [
    'Task objective:',
    contract.objective,
    ...(contract.doneWhen && contract.doneWhen.length > 0
      ? ['', 'Complete when:', ...contract.doneWhen.map((criterion) => `- ${criterion}`)]
      : []),
  ].join('\n')

const createPlannerTaskChain = (
  task: PlannedTaskConfig,
  entryNodeName: string,
): partialTaskDraft[] => [
  ...(task.taskContract.agentInstructions
    ? [
        {
          role: 'system' as const,
          content: {
            type: 'message' as const,
            data: task.taskContract.agentInstructions,
          },
        },
      ]
    : []),
  {
    role: 'user',
    content: {
      type: 'message',
      data: renderTaskContractMessage(task.taskContract),
    },
  },
  toolCall({
    name: entryNodeName,
    arguments: {
      taskContract: task.taskContract,
      ...(task.allowedTools !== undefined ? { allowedTools: task.allowedTools } : {}),
    },
  }),
]

export const buildTaskPlannerTaskChains = (
  taskGroups: readonly (readonly PlannedTaskInput[])[],
  entryNodeName = 'entryNode',
) =>
  taskGroups.map((group) =>
    group.flatMap((item) => createPlannerTaskChain(normalizePlannedTaskInput(item), entryNodeName)),
  )

const resolvePlannerEntryNodeName = (taskChain: readonly partialTaskDraft[]) => {
  const functionCalls = taskChain.filter(
    (task) => task.content.type === 'functioncall' && task.content.data.name !== 'chatCompletion',
  )
  const selectedPlannerCall = [...functionCalls].reverse().find((task) => {
    if (task.content.type !== 'functioncall') return false
    const allowedTools = task.content.data.arguments.allowedTools
    return Array.isArray(allowedTools) && allowedTools.includes('taskPlanner')
  })
  if (selectedPlannerCall?.content.type === 'functioncall') {
    return selectedPlannerCall.content.data.name
  }
  const initialEntryCall = functionCalls.find(
    (task) => task.content.type === 'functioncall' && task.content.data.name !== 'taskPlanner',
  )
  return initialEntryCall?.content.type === 'functioncall'
    ? initialEntryCall.content.data.name
    : 'entryNode'
}

const taskManagerSearchUrl = (args: {
  searchString?: string | undefined
  k: number
  taskType?: string | undefined
}) => {
  const params = new URLSearchParams()
  params.set('k', String(args.k))
  if (args.searchString) params.set('q', args.searchString)
  if (args.taskType) params.set('ct', args.taskType)
  return `/taskmanager?${params.toString()}`
}

export const taskSearcher = (taskManager: TyTaskManager) =>
  createTool({
    name: 'taskSearcher',
    description: 'Search through available tasks using a search string',
    longDescription: `This tool allows you to search for tasks based on a search string. You can specify the number of tasks to return and filter by task type.`,
    parameters: {
      type: 'object',
      properties: {
        searchString: {
          type: 'string',
          default: undefined,
          description: `Use a search string which is similar to the task you want to find.`,
        },
        k: {
          type: 'number',
          default: 5,
          description: `The number of tasks to return. Default is 5.`,
        },
        taskType: {
          type: 'string',
          enum: taskTypeOptions.filter((option) => typeof option !== 'bigint'),
          default: undefined,
          description: `Filter tasks by type. If not provided, all types are included.`,
        },
      },
      required: [],
    } as const satisfies JSONSchema7,
    function: async ({ searchString, k, taskType }) => {
      const limit = k ?? 5
      const jsonfilter = taskType
        ? {
            content: {
              type: taskType,
            },
          }
        : undefined
      const result = searchString
        ? await taskManager.filteredVectorSearch(searchString, limit, jsonfilter)
        : []
      return {
        searchUrl: taskManagerSearchUrl({ searchString, k: limit, taskType }),
        results: result.map((entry) => ({
          ...entry,
          taskUrl: `/detailed?t=${encodeURIComponent(entry.taskId)}`,
        })),
      }
    },
  })

export const taskPlanner = createTool({
  name: 'taskPlanner',
  description:
    'Plans and launches bounded packets of delegated work. Defaults to one sequential workflow; opt into parallel branches only for truly independent work.',
  longDescription: `Use this tool only when a task is complex enough to benefit from delegated subtasks. Do not use it for simple one-step answers or small single-artifact edits where ordinary tools can finish the work directly.

The "tasks" parameter is a list of groups. By default, Taskyon flattens all groups into one sequential workflow because most project work has dependencies between exploration, implementation, documentation, and verification. Set "parallel" to true only when the outer groups are genuinely independent and can safely edit or gather results without racing each other.

"parallel" is only a top-level taskPlanner argument beside "tasks". Never place it inside a task item or an inner task group; omit it for sequential work.

For artifact-building tasks, use the default sequential mode. Do not split implementation, README writing, and verification into parallel groups; verification must run after implementation exists, and documentation should match the final artifact.

Choose the packet size dynamically:
- Use one task when the next step depends on unknown exploration or a risky result.
- Use a short sequential packet when several steps are obvious and low-risk.
- Use parallel groups with "parallel": true only when branches are independent and can be merged later.
- Re-enter taskPlanner after uncertainty boundaries such as exploration, edits, tests, external calls, or errors only when the next plan genuinely needs to adapt.

Do not keep hidden planner state. Any plan, checklist, status, acceptance criteria, or evidence should be represented in visible task messages, structured results, or delegated task outputs so the task tree remains the source of truth.

Preserve the requested work when constructing delegated objectives:
- Emit one concrete task per requested objective when the request explicitly identifies separate tasks.
- Do not add a meta-task that merely says to plan, coordinate, or execute the remaining tasks; taskPlanner already performs that orchestration.
- Preserve explicit requested actions and named capabilities. Do not rewrite an executable action as an explanation of capability limitations.
- Do not combine several distinct requested objectives into one delegated task.

Each task item may be a short plain string when a normal message result is sufficient.

Optionally, a task item may instead be:
{ task: string, agentInstructions?: string, doneWhen?: string[], result?: { mode: "message" } | { mode: "structured", schema: JSONSchema } }

Prefer full structured-result JSON Schema objects with top-level { type: "object", properties: {...}, required: [...] }. A map of field names to JSON Schema property definitions is also accepted and normalized to a required object schema. Scalar shorthand such as { summary: "string" } is invalid.

Each delegated entryNode runs the normal dynamic tool chooser for its own objective. Do not select execution tools on behalf of delegated tasks.

Use "agentInstructions" for task-specific behavior such as acting as a security reviewer or system architect. Keep it distinct from the task objective. For dependent sequential work, provide explicit "doneWhen" criteria and a structured result schema when the next task needs a reliable handoff.

Taskyon renders each contract once as task-chain messages and launches entryNode directly. Previous task results remain available through task lineage; do not copy them into later task descriptions.`,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'array',
          items: plannerTaskItemSchema,
        },
        description:
          'A bounded execution packet. By default all outer groups are flattened into one sequential workflow. Each inner array item is a sequential step. Use multiple outer groups only with parallel=true and only for independent work. Every delegated task must surface a useful final message or structured result. Use structured fields when a later task needs a reliable handoff. Emit one concrete task per requested objective when the request explicitly identifies separate tasks. Preserve explicit requested actions and named capabilities; do not add a meta-task that plans the plan, combine distinct objectives, or rewrite executable work as a capability explanation. Each delegated entryNode chooses its execution tools dynamically. For map/reduce work, keep the outer workflow sequential: first delegate one collection task that may call taskPlanner recursively with parallel=true, then add an explicit synthesis task after it. The worker waits for the nested branches and surfaces their terminal results through lineage. Omit synthesis when independent branch results are already the requested deliverables. Stop recursive planning once tasks are concrete enough to execute; do not recursively restate the same work. Emit only the next useful packet before replanning: one task for uncertain steps or a short sequential list for obvious low-risk steps.',
      },
      parallel: {
        type: 'boolean',
        description:
          'Top-level taskPlanner option beside tasks. Set true only when each outer tasks group is independent and safe to run in parallel. Never put parallel inside a task item; omit it for normal sequential work.',
      },
    },
    required: ['tasks'],
  } as const satisfies JSONSchema7,
  function: async ({ tasks, parallel = false }, context) => {
    const taskGroups = parallel ? tasks : [tasks.flat()]
    const taskChain = await context.getExecutionTaskChain()
    const entryNodeName = resolvePlannerEntryNodeName(taskChain)
    return context.createSubtasksResult(buildTaskPlannerTaskChains(taskGroups, entryNodeName))
  },
  renderOptions: { hideLlm: true, hideVector: true },
})

export const taskOrganizationTools = [taskPlanner]
