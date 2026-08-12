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
      description:
        'Optional result contract. Use message for prose or structured with a JSON Schema for a typed handoff.',
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

const normalizeStructuredResultSchema = (value: unknown): JSONSchema7 & Record<string, unknown> => {
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

const removeModelSelectedTools = (task: PlannedTaskInput): PlannedTaskInput => {
  if (typeof task === 'string') return task
  const { allowedTools, ...taskWithoutTools } = task
  void allowedTools
  return taskWithoutTools
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
    description: 'Semantically search persisted Taskyon tasks, optionally filtered by task type.',
    longDescription:
      'Search uses the task index and returns matching task records plus a task-manager URL for inspecting the same query. It reads existing task history and does not modify task state.',
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
    'Split genuinely multi-phase work into bounded sequential tasks or independent parallel branches; each delegated task chooses its own tools.',
  longDescription: `Use this only when decomposition adds value; direct one-step work should use its execution capability without an extra planning layer.

The planner materializes each delegated objective as a visible task contract and launches a fresh entry node that chooses its own tools. Flat task arrays execute sequentially; nested arrays create independent parallel branches whose inner steps remain sequential. Results stay available through task lineage, so plans and handoffs remain inspectable rather than hidden in model state.

Plan through the requested deliverable, preserve exact user-supplied identities, and keep dependent research, implementation, artifact generation, and verification phases ordered. Parallelize only work that cannot race or depend on sibling results.`,
  parameters: {
    type: 'object',
    additionalProperties: false,
    properties: {
      tasks: {
        anyOf: [
          { type: 'array', minItems: 2, items: plannerTaskItemSchema },
          {
            type: 'array',
            minItems: 2,
            items: { type: 'array', minItems: 1, items: plannerTaskItemSchema },
          },
        ],
        description:
          'Provide at least two tasks. Use [a, b, c] for one sequential branch. Use [[a, b], [c, d]] only for at least two independent parallel branches; each inner array is sequential. Never use taskPlanner merely to wrap one task. Every delegated task must surface a useful final message or structured result. Emit one concrete task per requested objective and include all explicit downstream phases. A packet containing only research, discovery, inspection, recommendations, or other preparation is invalid: it must also contain the requested output-producing work and its verification/reporting task. When external research determines an implementation contract, use three distinct sequential phases: research handoff, author/install, then verify/reuse/report; never combine research and authoring in one task. Put final exports and usage reports only in the verification/reporting task, not the author/install task, because repairs can change the registered revision. Fold repository inspection into the task that uses its findings unless inspection itself is a requested deliverable. Preserve requested actions, named capabilities, product identities, domains, and URLs verbatim. For map/reduce work, keep the outer workflow sequential: its collection task may recursively launch nested independent branches, followed by synthesis. Stop recursive planning once tasks are concrete enough to execute.',
        examples: [
          ['Inspect the API contract', 'Implement the client', 'Verify the client'],
          [
            ['Research option A', 'Summarize option A'],
            ['Research option B', 'Summarize option B'],
          ],
        ],
      },
    },
    required: ['tasks'],
  } as const satisfies JSONSchema7,
  function: async ({ tasks }, context) => {
    const taskGroups: readonly (readonly PlannedTaskInput[])[] = Array.isArray(tasks[0])
      ? (tasks as unknown as readonly (readonly PlannedTaskInput[])[])
      : [tasks as unknown as readonly PlannedTaskInput[]]
    const taskChain = await context.getExecutionTaskChain()
    const entryNodeName = resolvePlannerEntryNodeName(taskChain)
    return context.createSubtasksResult(
      buildTaskPlannerTaskChains(
        taskGroups.map((group) => group.map(removeModelSelectedTools)),
        entryNodeName,
      ),
    )
  },
  renderOptions: { hideLlm: true, hideVector: true },
})

export const taskOrganizationTools = [taskPlanner]
