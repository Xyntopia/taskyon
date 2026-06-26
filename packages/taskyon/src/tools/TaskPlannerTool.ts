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
    goal: 'SimpleCompletion',
    prompts: [plannerTaskChainPrompt],
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

export const buildTaskPlannerTaskChains = (
  taskGroups: readonly (readonly PlannedTaskInput[])[],
  taskChain: readonly TaskNode[],
) => {
  const plannerContext = summarizePlannerContext([...taskChain])
  return taskGroups.map((group) =>
    group.flatMap((item) =>
      createPlannerTaskChain(normalizePlannedTaskInput(item), plannerContext),
    ),
  )
}

// TODO: provide a link to the search page from the result!
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
          enum: taskTypeOptions,
          default: undefined,
          description: `Filter tasks by type. If not provided, all types are included.`,
        },
      },
      required: [],
    } as const satisfies JSONSchema7,
    function: async ({ searchString, k, taskType }) => {
      const jsonfilter = taskType
        ? {
            content: {
              type: taskType,
            },
          }
        : undefined
      const result = searchString
        ? await taskManager.filteredVectorSearch(searchString, k, jsonfilter)
        : []
      return result
    },
  })

export const taskPlanner = createTool({
  name: 'taskPlanner',
  description:
    'Launches delegated subtasks. Use one outer group per parallel branch and one inner list for sequential work inside that branch.',
  longDescription: `Use this tool only when a task is complex enough to benefit from delegated subtasks.

The "tasks" parameter is a list of groups:
- Each outer group runs in parallel with the other groups.
- Each inner list runs in sequence from left to right.

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
          'Parallel groups of delegated work. Each outer array item runs in parallel. Each inner array item runs sequentially. Each task item is usually a short string objective, or optionally an object with { task, allowedTools }.',
      },
    },
    required: ['tasks'],
  } as const satisfies JSONSchema7,
  function: ({ tasks }, context) => {
    const normalizedGroups = tasks.map((group) =>
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
      ],
      ...buildTaskPlannerTaskChains(tasks, context.taskChain),
    ])
  },
})

export const taskOrganizationTools = [taskPlanner]
