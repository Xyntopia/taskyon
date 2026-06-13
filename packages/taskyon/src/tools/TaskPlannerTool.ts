import type { JSONSchema7 } from 'json-schema'
import type { TyTaskManager } from '../core/taskManager'
import { createChatCompletionTask } from '../api'
import type { partialTaskDraft, TaskNode } from '../types/taskNode'
import { taskTypeOptions } from '../types/taskNode'
import { createTool, toolCall } from '../types/toolApi'
import { safeYamlDump } from '../utils/yamlUtils'

type PlannedTaskConfig = {
  task: string
  allowedTools?: string[]
}

type PlannedTaskInput = string | PlannedTaskConfig

const plannerTaskObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    task: {
      type: 'string',
      description: 'Broad objective for this subtask. Keep it short and goal-oriented.',
    },
    allowedTools: {
      type: 'array',
      items: {
        type: 'string',
      },
      description:
        'Optional restrictive override for the exact tools this subtask may use. Only set this when you are truly certain no other tools are needed.',
    },
  },
  required: ['task'],
} as const satisfies JSONSchema7

const plannerTaskItemSchema = {
  anyOf: [{ type: 'string' }, plannerTaskObjectSchema],
} as const satisfies JSONSchema7

const plannerTaskChainPrompt = [
  'You are starting a delegated subtask.',
  'Read the previous user message and expand it into a more detailed local objective and execution strategy for this subtask.',
  'Keep the original intent intact, but make the next execution phase more concrete.',
  'Do not call any tools yet.',
  'Respond only with the detailed objective and short execution strategy as assistant text.',
].join('\n')

const plannerContinuationPrompt = (allowedTools?: string[]) =>
  [
    'Continue this delegated subtask using the detailed objective above.',
    'Carry out the work autonomously and continue the chain normally.',
    'Do not ask whether to continue; finish this delegated branch with saved artifacts, verification evidence, or a concise completion status. Later planned tasks will continue automatically.',
    ...(allowedTools
      ? [
          allowedTools.length > 0
            ? `Important: the callable helper tools for this subtask are intentionally restricted to: ${allowedTools.join(', ')}. Configured entry-node capabilities such as web search may still be available; use them when the objective asks for discovery.`
            : 'Important: this subtask should not call tools. Use the configured entry-node capabilities directly.',
        ]
      : []),
  ].join('\n')

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

export const normalizePlannedTaskInput = (value: unknown): PlannedTaskConfig => {
  if (typeof value === 'string') {
    const task = value.trim()
    if (task.length === 0) {
      throw new Error('Planner task strings must not be empty.')
    }
    return { task }
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Planner tasks must be either a string or an object with a task field.')
  }

  const candidate: { task?: unknown; allowedTools?: unknown } = value
  const rawTask = candidate.task
  if (typeof rawTask !== 'string' || rawTask.trim().length === 0) {
    throw new Error('Planner task objects require a non-empty "task" string.')
  }

  const rawAllowedTools = candidate.allowedTools
  if (rawAllowedTools !== undefined && !isStringArray(rawAllowedTools)) {
    throw new Error('Planner task "allowedTools" must be an array of strings when provided.')
  }

  return {
    task: rawTask.trim(),
    ...(rawAllowedTools !== undefined ? { allowedTools: rawAllowedTools } : {}),
  }
}

const summarizePlannerContext = (taskChain: TaskNode[]) => {
  const contextItems = taskChain
    .filter((task) => ['message', 'toolresult', 'structured', 'error'].includes(task.content.type))
    .slice(-6)
    .map((task) => ({
      role: task.role,
      type: task.content.type,
      data: task.content.data,
    }))

  return contextItems.length > 0 ? safeYamlDump(contextItems) : 'No additional context provided.'
}

const createPlannerBootstrapMessage = (task: PlannedTaskConfig, plannerContext: string) =>
  [
    `Subtask objective: ${task.task}`,
    '',
    'Shared planner context:',
    plannerContext,
    '',
    'First, expand this into a more detailed local objective and execution strategy before continuing.',
  ].join('\n')

const createPlannerTaskChain = (
  task: PlannedTaskConfig,
  plannerContext: string,
): partialTaskDraft[] => [
  {
    role: 'user',
    content: {
      type: 'message',
      data: createPlannerBootstrapMessage(task, plannerContext),
    },
  },
  createChatCompletionTask({
    appendSystemPrompts: [plannerTaskChainPrompt],
  }),
  {
    role: 'user',
    content: {
      type: 'message',
      data: plannerContinuationPrompt(task.allowedTools),
    },
  },
  toolCall({
    name: 'entryNode',
    arguments: {
      ...(task.allowedTools !== undefined ? { allowedTools: task.allowedTools } : {}),
    },
  }),
]

const createPlannerReviewTaskChain = (plannerContext: string): partialTaskDraft[] => [
  {
    role: 'user',
    content: {
      type: 'message',
      data: [
        'Planner review checkpoint.',
        '',
        'Compare the completed delegated work in this branch against the original request and shared planner context.',
        '',
        'Shared planner context:',
        plannerContext,
        '',
        'If the requested outcome is not complete, continue autonomously using taskPlanner or the available execution tools.',
        'If the requested outcome is complete, give a concise final report with verification evidence and human-check instructions.',
      ].join('\n'),
    },
  },
  toolCall({
    name: 'entryNode',
    arguments: {},
  }),
]

export const buildTaskPlannerTaskChains = (
  taskGroups: readonly (readonly PlannedTaskInput[])[],
  taskChain: readonly TaskNode[],
  options?: { includeReview?: boolean },
) => {
  const plannerContext = summarizePlannerContext([...taskChain])
  const includeReview = options?.includeReview ?? true
  return taskGroups.map((group) => [
    ...group.flatMap((item) =>
      createPlannerTaskChain(normalizePlannedTaskInput(item), plannerContext),
    ),
    ...(includeReview ? createPlannerReviewTaskChain(plannerContext) : []),
  ])
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
          enum: taskTypeOptions.filter(option => typeof option !== 'bigint'),
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

For artifact-building tasks, use the default sequential mode. Do not split implementation, README writing, and verification into parallel groups; verification must run after implementation exists, and documentation should match the final artifact.

Choose the packet size dynamically:
- Use one task when the next step depends on unknown exploration or a risky result.
- Use a short sequential packet when several steps are obvious and low-risk.
- Use parallel groups with "parallel": true only when branches are independent and can be merged later.
- Re-enter taskPlanner after uncertainty boundaries such as exploration, edits, tests, external calls, or errors only when the next plan genuinely needs to adapt.

Do not keep hidden planner state. Any plan, checklist, status, acceptance criteria, or evidence should be represented in visible task messages, structured results, or delegated task outputs so the task tree remains the source of truth.

Each task item should usually be a short plain string that states the broad objective. Keep these broad and compact so the delegated agent can refine the task locally.

Optionally, a task item may instead be:
{ task: string, allowedTools?: string[] }

Only use "allowedTools" when you are truly certain that no other tools are needed. It is restrictive and should remain rare.

For every delegated task, Taskyon first creates a fresh local context, expands the broad objective into a more detailed local plan, and then launches entryNode to continue the subtask normally.`,
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
          'A bounded execution packet. By default all outer groups are flattened into one sequential workflow. Each inner array item is a sequential step. Use multiple outer groups only with parallel=true and only for independent work. Emit only the next useful packet before replanning: one task for uncertain steps or a short sequential list for obvious low-risk steps.',
      },
      parallel: {
        type: 'boolean',
        default: false,
        description:
          'Set true only when each outer tasks group is independent and safe to run in parallel. Leave false for normal project work, especially implementation plus README plus verification workflows.',
      },
    },
    required: ['tasks'],
  } as const satisfies JSONSchema7,
  function: async ({ tasks, parallel = false }, context) => {
    const taskGroups = parallel ? tasks : [tasks.flat()]
    const normalizedGroups = taskGroups.map((group) =>
      group.map((item) => normalizePlannedTaskInput(item)),
    )
    const groupsFormatted = normalizedGroups
      .map((group, index) => {
        const description = group
          .map((item) =>
            item.allowedTools && item.allowedTools.length > 0
              ? `${item.task} [allowedTools: ${item.allowedTools.join(', ')}]`
              : item.task,
          )
          .join(' -> ')
        return `Group ${index + 1}: ${description}`
      })
      .join('\n')

    return context.createSubtasksResult([
      [
        {
          role: 'assistant',
          content: {
            type: 'message',
            data: `Task Breakdown:\n${groupsFormatted}`,
          },
        },
        {
          role: 'system',
          content: { type: 'return', data: 'task breakdown recorded' },
        },
      ],
      ...buildTaskPlannerTaskChains(taskGroups, await context.getExecutionTaskChain()),
    ])
  },
})

export const taskOrganizationTools = [taskPlanner]
