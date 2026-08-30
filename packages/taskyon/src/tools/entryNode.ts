import { createChatCompletionTask } from '../api'
import { toPromptMessages } from '../llm/promptMessages'
import { CLARIFICATION_TOOL_NAME } from './clarificationTool'
import { createTool, toolCall } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import type { toolContext } from '../types/toolApi'
import type { JSONSchema7 } from '../utils/jsonSchema'
import {
  taskContractResultSchema,
  taskContractSchema,
  type TaskContract,
} from '../types/taskContract'
import { safeYamlDump } from '../utils/yamlUtils'
import { bind } from './lambdaTool'

export const ENTRY_NODE_SELECTION_TOOL_NAME = 'selectTaskyonTools'
export const ENTRY_NODE_TOOL_SEARCH_BINDING_NAME = 'entryNodeToolSearch'
export const isEntryNodeInternalToolName = (name: string) =>
  name === ENTRY_NODE_SELECTION_TOOL_NAME ||
  name === ENTRY_NODE_TOOL_SEARCH_BINDING_NAME ||
  name === 'toolSearcher'

type EntryNodeMode = 'message' | 'toolresult' | 'error' | 'structured' | 'fallback'

type EntryNodeToolCatalog = {
  tools: Array<{ name: string; description: string }>
  total: number
}

type EntryNodeConfig = {
  name?: string
  renderOptions?: { hideChat?: boolean; hideLlm?: boolean; hideVector?: boolean }
  defaultAllowedTools?: string[]
  getToolCatalog?: (args: {
    taskChain: readonly TaskNode[]
    allowedTools: readonly string[] | undefined
    pinnedToolNames: readonly string[]
    recentToolCount: number
    frequentToolCount: number
  }) => Promise<EntryNodeToolCatalog | EntryNodeToolCatalog['tools']>
  buildPrompt: (args: {
    mode: EntryNodeMode
    taskChain: TaskNode[]
    previousTask: TaskNode | undefined
    toolResultSection?: string
  }) => string
  stableContext?: (args: {
    mode: EntryNodeMode
    taskChain: TaskNode[]
    previousTask: TaskNode | undefined
  }) => string
  includeRoutinePrompt?: boolean
}

export type EntryNodePromptTemplates = {
  basePrompt: string
  message: string
  toolResult: string
  error: string
  retryExhausted: string
}

export type EntryNodeArgs = {
  toolResultSection?: string
  allowedTools?: string[]
  requireToolCall?: boolean
  toolSearch?: { mode?: 'focused' | 'overview'; query: string; limit?: number }
  toolSearchInput?: Record<string, unknown>
  taskContract?: TaskContract
  pinnedTools?: string[]
  toolSearchEnabled?: boolean
  use_baseprompt?: boolean
  recentToolCount?: number
  frequentToolCount?: number
  recentSearchToolCount?: number
  max_error_retries?: number
  reasoning_effort?: 'low' | 'medium' | 'high' | 'none'
  use_multimodal?: boolean
  websearch?: {
    enabled?: boolean
    mode?: 'auto' | 'required'
    max_results?: number
  }
  trace?: {
    enabled?: boolean
    label?: string
  }
  prompt_templates?: EntryNodePromptTemplates
}

export type ResolvedEntryNodeSettings = {
  taskContract?: TaskContract
  pinnedTools: string[]
  toolSearchEnabled: boolean
  use_baseprompt: boolean
  recentToolCount: number
  frequentToolCount: number
  recentSearchToolCount: number
  max_error_retries: number
  reasoning_effort?: 'low' | 'medium' | 'high' | 'none'
  use_multimodal: boolean
  websearch: {
    enabled: boolean
    mode: 'auto' | 'required'
    max_results: number
  }
  trace?: {
    enabled: boolean
    label?: string
  }
  prompt_templates: EntryNodePromptTemplates
}

const entryNodeTaskContractSchema = {
  ...taskContractSchema,
  properties: {
    ...taskContractSchema.properties,
    result: {
      anyOf: [taskContractResultSchema, { type: 'null' }, { const: 'message' }],
    },
  },
  required: ['objective'],
} as const satisfies JSONSchema7

const stringifyPromptValue = (value: unknown) =>
  typeof value === 'string' ? value : safeYamlDump(value)

const interpolatePromptTemplate = (template: string, variables: Record<string, string>) =>
  Object.entries(variables).reduce(
    (acc, [key, value]) => acc.replace(new RegExp(`\\$?\\{${key}\\}`, 'g'), value),
    template,
  )

const resolvePromptTemplates = (
  overrides: EntryNodeArgs['prompt_templates'],
): EntryNodePromptTemplates => {
  if (!overrides) {
    throw new Error('Entry-node settings require complete prompt_templates configuration.')
  }
  return overrides
}

export const normalizeEntryNodeSettings = (
  input: Partial<EntryNodeArgs> | undefined,
): ResolvedEntryNodeSettings => {
  const rawTaskContractResult = input?.taskContract?.result as unknown
  const taskContract = input?.taskContract
    ? {
        ...input.taskContract,
        result:
          rawTaskContractResult === null ||
          rawTaskContractResult === undefined ||
          rawTaskContractResult === 'message'
            ? { mode: 'message' as const }
            : input.taskContract.result,
      }
    : undefined

  return {
    ...(taskContract ? { taskContract } : {}),
    pinnedTools: Array.from(new Set(input?.pinnedTools ?? [])),
    toolSearchEnabled: input?.toolSearchEnabled ?? true,
    use_baseprompt: input?.use_baseprompt ?? true,
    recentToolCount: input?.recentToolCount ?? 3,
    frequentToolCount: input?.frequentToolCount ?? 3,
    recentSearchToolCount: input?.recentSearchToolCount ?? 3,
    max_error_retries: input?.max_error_retries ?? 3,
    ...(input?.reasoning_effort ? { reasoning_effort: input.reasoning_effort } : {}),
    use_multimodal: input?.use_multimodal ?? true,
    websearch: {
      enabled: input?.websearch?.enabled ?? false,
      mode: input?.websearch?.mode ?? 'auto',
      max_results: input?.websearch?.max_results ?? 5,
    },
    ...(input?.trace?.enabled === true
      ? {
          trace: {
            enabled: true,
            ...(typeof input.trace.label === 'string' ? { label: input.trace.label } : {}),
          },
        }
      : {}),
    prompt_templates: resolvePromptTemplates(input?.prompt_templates),
  }
}

export const buildEntryNodePromptAugmentations = (args: {
  mode: EntryNodeMode
  prompt: string
  previousTask: TaskNode | undefined
  templates: EntryNodePromptTemplates
  useBasePrompt: boolean
  retryCount?: number
}) => {
  const { mode, prompt, previousTask, templates, useBasePrompt, retryCount } = args
  const prependSystemPrompts = useBasePrompt ? [templates.basePrompt] : []
  const templateVariables = {
    message: stringifyPromptValue(previousTask?.content.data ?? ''),
    toolResult: stringifyPromptValue(previousTask?.content.data ?? ''),
    error: stringifyPromptValue(previousTask?.content.data ?? ''),
    retryCount: String(retryCount ?? 0),
  }
  const modePrompt =
    retryCount !== undefined
      ? templates.retryExhausted
      : mode === 'toolresult'
        ? templates.toolResult
        : mode === 'error'
          ? templates.error
          : templates.message
  const appendSystemPrompts = [
    interpolatePromptTemplate(modePrompt, templateVariables),
    prompt,
  ].filter((value) => value.trim().length > 0)
  return {
    appendSystemPrompts,
    prependSystemPrompts: prependSystemPrompts.filter((value) => value.trim().length > 0),
  }
}

export const buildEntryNodePromptPreviewMessages = (args: {
  prompt: string
  templates: EntryNodePromptTemplates
  useBasePrompt: boolean
}) => {
  const augmentations = buildEntryNodePromptAugmentations({
    mode: 'message',
    prompt: args.prompt,
    previousTask: undefined,
    templates: args.templates,
    useBasePrompt: args.useBasePrompt,
  })
  const { prependMessages, appendMessages } = toPromptMessages(
    augmentations.appendSystemPrompts,
    augmentations.prependSystemPrompts,
  )

  return [...prependMessages, ...appendMessages]
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const resolveAllowedToolsFromFailedTask = (
  taskChain: TaskNode[],
  previousTask: TaskNode | undefined,
  fallback: string[] | undefined,
): string[] | undefined => {
  if (!previousTask || previousTask.content.type !== 'error' || !previousTask.parentID)
    return fallback
  const failedTask = taskChain.find((task) => task.id === previousTask.parentID)
  if (!failedTask || failedTask.content.type !== 'functioncall') return fallback
  if (failedTask.content.data.name !== 'chatCompletion') return [failedTask.content.data.name]
  const allowedTools = (failedTask.content.data.arguments as { allowedTools?: unknown })
    ?.allowedTools
  return isStringArray(allowedTools) && allowedTools.length > 0 ? allowedTools : fallback
}

const resolveMode = (previousTask: TaskNode | undefined): EntryNodeMode => {
  if (!previousTask) return 'fallback'
  if (previousTask.content.type === 'error') return 'error'
  if (previousTask.content.type === 'toolresult') return 'toolresult'
  if (previousTask.content.type === 'structured') return 'structured'
  if (previousTask.content.type === 'message' && previousTask.role === 'user') return 'message'
  return 'fallback'
}

type AvailableToolsResult = {
  toolCatalog: Array<{ name: string; description: string }>
  availableTools: string[]
  invalidToolNames: string[]
  totalTools: number
}

type EntryNodePromptContext = {
  mode: EntryNodeMode
  prompt: string
  includeModePrompt: boolean
  prependSystemPrompts: string[]
  previousTask: TaskNode | undefined
  normalizedSettings: ResolvedEntryNodeSettings
}

type EntryNodeRuntimeState = {
  allowedTools: string[]
  requireToolCall: boolean
  toolRestriction: string[] | undefined
  entryNodeName: string
  mode: EntryNodeMode
  normalizedSettings: ResolvedEntryNodeSettings
  previousTask: TaskNode | undefined
  prompt: string
  promptContext: EntryNodePromptContext
  toolResultSection?: string
  toolSearch?: { mode?: 'focused' | 'overview'; query: string; limit?: number }
  toolSearchInput?: Record<string, unknown>
  taskChain: TaskNode[]
}

const createFallbackToolCatalog = (toolNames: readonly string[]) =>
  toolNames.map((name) => ({ name, description: name }))

type EntryNodeChatCompletionArgs = Omit<
  Parameters<typeof createChatCompletionTask>[0],
  'allowedTools' | 'toolChoice'
>

const createChatCompletionWithToolSelector = (
  entryNodeName: string,
  args: EntryNodeChatCompletionArgs,
  allowedTools: readonly string[],
  toolSearchEnabled: boolean,
  toolSelectorDefined: boolean,
) => {
  if (!toolSearchEnabled) {
    return [
      createChatCompletionTask({
        ...args,
        ...(allowedTools.length > 0 ? { allowedTools: [...allowedTools] } : {}),
      }),
    ]
  }
  const visibleTools = Array.from(new Set([...allowedTools, ENTRY_NODE_SELECTION_TOOL_NAME]))
  return [
    ...(toolSelectorDefined ? [] : [createToolSelectorBinding(entryNodeName)]),
    createChatCompletionTask({
      ...args,
      allowedTools: [...visibleTools],
    }),
  ]
}

const hasCurrentTurnToolSelector = (taskChain: readonly TaskNode[], entryNodeName: string) => {
  const userIndex = taskChain.findLastIndex((task) => task.role === 'user')
  return taskChain.slice(userIndex + 1).some((task) => {
    if (
      task.content.type !== 'tooldefinition' ||
      task.content.data.name !== ENTRY_NODE_SELECTION_TOOL_NAME
    ) {
      return false
    }
    const definition = task.content.data
    return (
      'implementation' in definition &&
      definition.implementation.type === 'binding' &&
      definition.implementation.target === entryNodeName &&
      definition.implementation.fixedArguments.requireToolCall === true
    )
  })
}

const createToolSelectorBinding = (entryNodeName: string) => {
  const [definition] = bind({
    name: ENTRY_NODE_SELECTION_TOOL_NAME,
    description: 'Search the full tool catalog when the current callable tools are insufficient.',
    renderOptions: { hideChat: true, hideLlm: true, hideVector: true },
    target: entryNodeName,
    fixedArguments: { requireToolCall: true },
    publicArguments: { toolSearch: {} },
  })
  if (!definition) throw new Error('Failed to create the tool-selector binding.')
  return definition
}

const resolveAllowedToolsForMode = (
  mode: EntryNodeMode,
  allowedTools: readonly string[] | undefined,
) => {
  return mode === 'error'
    ? allowedTools?.filter((toolName) => toolName !== CLARIFICATION_TOOL_NAME)
    : allowedTools
}

const resolveAllowedToolsFromLatestCompletion = (taskChain: readonly TaskNode[]) => {
  for (const task of [...taskChain].reverse()) {
    if (task.content.type !== 'functioncall' || task.content.data.name !== 'chatCompletion')
      continue
    const allowedTools = (task.content.data.arguments as { allowedTools?: unknown }).allowedTools
    return isStringArray(allowedTools) ? allowedTools : undefined
  }
  return undefined
}

const withReasoningEffort = (reasoningEffort: ResolvedEntryNodeSettings['reasoning_effort']) =>
  reasoningEffort ? { reasoning_effort: reasoningEffort } : {}

const withTaskContractResult = (taskContract: TaskContract | undefined) => {
  if (!taskContract || taskContract.result.mode === 'message') return {}
  return {
    schema: taskContract.result.schema,
  }
}

const resolveEntryNodePromptAugmentations = (
  promptContext: EntryNodePromptContext,
  overrides?: {
    mode?: EntryNodeMode
    prompt?: string
    retryCount?: number
  },
) =>
  (() => {
    const templates =
      promptContext.includeModePrompt || overrides?.retryCount !== undefined
        ? promptContext.normalizedSettings.prompt_templates
        : {
            ...promptContext.normalizedSettings.prompt_templates,
            message: '',
            toolResult: '',
          }
    const augmentations = buildEntryNodePromptAugmentations({
      mode: overrides?.mode ?? promptContext.mode,
      prompt: overrides?.prompt ?? promptContext.prompt,
      previousTask: promptContext.previousTask,
      templates,
      useBasePrompt: promptContext.normalizedSettings.use_baseprompt,
      ...(overrides?.retryCount !== undefined ? { retryCount: overrides.retryCount } : {}),
    })
    return {
      ...augmentations,
      prependSystemPrompts: [
        ...augmentations.prependSystemPrompts,
        ...promptContext.prependSystemPrompts,
      ],
    }
  })()

const normalizeToolCatalog = (
  value: EntryNodeToolCatalog | EntryNodeToolCatalog['tools'],
): EntryNodeToolCatalog => (Array.isArray(value) ? { tools: value, total: value.length } : value)

const isToolCatalogEntry = (value: unknown): value is EntryNodeToolCatalog['tools'][number] =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof Reflect.get(value, 'name') === 'string' &&
  typeof Reflect.get(value, 'description') === 'string'

const normalizeToolSearchInput = (value: unknown): EntryNodeToolCatalog => {
  const matches = Array.isArray(value)
    ? value
    : typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (Reflect.get(value, 'Here are the matching tools') ?? Reflect.get(value, 'tools'))
      : undefined
  if (!Array.isArray(matches) || !matches.every(isToolCatalogEntry)) {
    throw new Error('Entry-node tool search returned no usable matching-tool catalog.')
  }
  const totalValue =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Reflect.get(value, 'total')
      : undefined
  const total =
    typeof totalValue === 'number' && totalValue >= matches.length ? totalValue : matches.length
  return {
    tools: matches.map(({ name, description }) => ({ name, description })),
    total,
  }
}

const createEntryNodeToolSearchTasks = (
  runtime: EntryNodeRuntimeState,
  search: NonNullable<EntryNodeRuntimeState['toolSearch']>,
) => {
  const mode = search.mode ?? 'focused'
  const defaultLimit = mode === 'overview' ? 30 : runtime.normalizedSettings.recentSearchToolCount
  const limit = Math.max(1, Math.min(search.limit ?? defaultLimit, 50))
  const [definition] = bind({
    name: ENTRY_NODE_TOOL_SEARCH_BINDING_NAME,
    description: 'Search the available tool catalog for the current EntryNode request.',
    renderOptions: { hideChat: true, hideLlm: true, hideVector: true },
    target: 'toolSearcher',
    fixedArguments: { analyze: false, focused: mode === 'focused' },
    publicArguments: { query: {}, limit: {} },
  })
  if (!definition) throw new Error('Failed to create the EntryNode tool-search binding.')
  return [
    definition,
    toolCall({
      name: ENTRY_NODE_TOOL_SEARCH_BINDING_NAME,
      arguments: { query: search.query, limit },
    }),
    toolCall({
      name: runtime.entryNodeName,
      arguments: { $use: { toolSearchInput: '$previousResult' } },
    }),
  ]
}

const resolveAvailableToolsForMessage = async (
  config: EntryNodeConfig,
  allowedTools: readonly string[] | undefined,
  taskChain: readonly TaskNode[],
  settings: Pick<
    ResolvedEntryNodeSettings,
    'pinnedTools' | 'recentToolCount' | 'frequentToolCount' | 'recentSearchToolCount'
  >,
): Promise<AvailableToolsResult> => {
  const configuredToolCatalog = await config.getToolCatalog?.({
    taskChain,
    allowedTools,
    pinnedToolNames: settings.pinnedTools,
    recentToolCount: settings.recentToolCount,
    frequentToolCount: settings.frequentToolCount,
  })
  const normalizedCatalog = configuredToolCatalog
    ? normalizeToolCatalog(configuredToolCatalog)
    : undefined
  const availableToolCatalog =
    normalizedCatalog && normalizedCatalog.tools.length > 0
      ? normalizedCatalog.tools
      : createFallbackToolCatalog(allowedTools ?? [])
  const totalTools = normalizedCatalog?.total ?? availableToolCatalog.length
  const allowedToolNames = allowedTools ? new Set(allowedTools) : undefined
  const toolCatalog = availableToolCatalog.filter(
    (tool) => allowedToolNames?.has(tool.name) ?? true,
  )
  const knownToolNames = new Set(availableToolCatalog.map((tool) => tool.name))
  const invalidToolNames = (allowedTools ?? []).filter(
    (name) => name !== ENTRY_NODE_SELECTION_TOOL_NAME && !knownToolNames.has(name),
  )

  return {
    toolCatalog,
    availableTools: toolCatalog.map((tool) => tool.name),
    invalidToolNames,
    totalTools,
  }
}

const mergeEntryNodeArguments = (base: EntryNodeArgs, override: EntryNodeArgs): EntryNodeArgs => ({
  ...base,
  ...override,
  ...(base.websearch || override.websearch
    ? { websearch: { ...base.websearch, ...override.websearch } }
    : {}),
  ...(base.trace || override.trace ? { trace: { ...base.trace, ...override.trace } } : {}),
})

const inheritEntryNodeArguments = (
  taskChain: readonly TaskNode[],
  entryNodeName: string,
  args: EntryNodeArgs,
) => {
  const latestUserTaskIndex = taskChain.findLastIndex((task) => task.role === 'user')
  const currentTaskChain = taskChain.slice(latestUserTaskIndex + 1)
  const inherited = currentTaskChain.reduce<EntryNodeArgs>((inherited, task) => {
    if (task.content.type !== 'functioncall' || task.content.data.name !== entryNodeName) {
      return inherited
    }
    const {
      allowedTools: transientAllowedTools,
      requireToolCall: transientRequireToolCall,
      toolSearch: transientToolSearch,
      toolSearchInput: transientToolSearchInput,
      websearch: transientWebSearch,
      ...persistentArgs
    } = task.content.data.arguments as EntryNodeArgs
    void transientAllowedTools
    void transientRequireToolCall
    void transientToolSearch
    void transientToolSearchInput
    void transientWebSearch
    return mergeEntryNodeArguments(inherited, persistentArgs)
  }, {})
  return mergeEntryNodeArguments(inherited, args)
}

const createEntryNodeRuntimeState = async (
  config: EntryNodeConfig,
  args: EntryNodeArgs,
  context: toolContext,
): Promise<EntryNodeRuntimeState> => {
  const taskChain = await context.getExecutionTaskChain()
  const entryNodeName = config.name ?? 'entryNode'
  const inheritedArgs = inheritEntryNodeArguments(taskChain, entryNodeName, args)
  const {
    toolResultSection,
    allowedTools: allowedToolsOverride,
    requireToolCall = false,
    toolSearch,
    toolSearchInput,
    ...settings
  } = inheritedArgs
  const previousTask = taskChain.at(-2)
  const mode = resolveMode(previousTask)
  const promptArgsBase = {
    mode,
    taskChain,
    previousTask,
  }
  const normalizedSettings = normalizeEntryNodeSettings(settings)
  const prompt = config.buildPrompt(
    toolResultSection === undefined ? promptArgsBase : { ...promptArgsBase, toolResultSection },
  )
  const stableContext = config.stableContext?.(promptArgsBase)
  const rawAllowedTools =
    allowedToolsOverride ??
    resolveAllowedToolsFromFailedTask(taskChain, previousTask, undefined) ??
    resolveAllowedToolsFromLatestCompletion(taskChain) ??
    config.defaultAllowedTools
  const toolRestriction = resolveAllowedToolsForMode(mode, rawAllowedTools)?.filter(
    (toolName) => toolName !== entryNodeName,
  )
  const allowedTools = toolRestriction ?? []
  const promptContext = {
    mode,
    prompt,
    includeModePrompt: mode === 'error' || config.includeRoutinePrompt !== false,
    prependSystemPrompts: stableContext ? [stableContext] : [],
    previousTask,
    normalizedSettings,
  }
  return {
    allowedTools,
    requireToolCall,
    toolRestriction,
    entryNodeName,
    mode,
    normalizedSettings,
    previousTask,
    prompt,
    promptContext,
    taskChain,
    ...(toolResultSection !== undefined ? { toolResultSection } : {}),
    ...(toolSearch ? { toolSearch } : {}),
    ...(toolSearchInput !== undefined ? { toolSearchInput } : {}),
  }
}

const createToolSearchContinuationTasks = (
  runtime: EntryNodeRuntimeState,
  searched: EntryNodeToolCatalog,
) => {
  const allowedTools = Array.from(
    new Set([
      ...runtime.allowedTools.filter((name) => name !== ENTRY_NODE_SELECTION_TOOL_NAME),
      ...searched.tools.map((tool) => tool.name),
    ]),
  )

  if (searched.tools.length === 0) {
    return [
      [
        toolCall({
          name: runtime.entryNodeName,
          arguments: {
            allowedTools,
            toolSearchEnabled: false,
          },
        }),
      ],
    ]
  }

  return [
    [
      toolCall({
        name: runtime.entryNodeName,
        arguments: {
          allowedTools,
          requireToolCall: true,
        },
      }),
    ],
  ]
}

const shouldGiveUpAfterError = (
  taskChain: TaskNode[],
  previousTask: TaskNode | undefined,
  maxErrorRetries: number,
) => {
  if (!previousTask?.parentID || previousTask.content.type !== 'error') return undefined
  const errorRetries = taskChain.filter(
    (task) => task.content.type === 'error' && task.parentID === previousTask.parentID,
  ).length

  return errorRetries > maxErrorRetries ? errorRetries : undefined
}

type StandardEntryNodeOptions = {
  name: string
  renderOptions: { hideChat?: boolean; hideLlm?: boolean }
  defaultAllowedTools?: string[]
  getToolCatalog?: (args: {
    taskChain: readonly TaskNode[]
    allowedTools: readonly string[] | undefined
    pinnedToolNames: readonly string[]
    recentToolCount: number
    frequentToolCount: number
  }) => Promise<EntryNodeToolCatalog | EntryNodeToolCatalog['tools']>
  extraContext?: (args: {
    mode: EntryNodeMode
    previousTask: TaskNode | undefined
    taskChain: TaskNode[]
    toolResultSection?: string
  }) => string
  stableContext?: (args: {
    mode: EntryNodeMode
    previousTask: TaskNode | undefined
    taskChain: TaskNode[]
  }) => string
  includeRoutinePrompt?: boolean
}

export const createStandardEntryNodeTool = (options: StandardEntryNodeOptions) => {
  const config: EntryNodeConfig = {
    ...options,
    ...(options.getToolCatalog ? { getToolCatalog: options.getToolCatalog } : {}),
    buildPrompt: ({ mode, previousTask, taskChain, toolResultSection }) => {
      const extraContextArgsBase = { mode, previousTask, taskChain }
      const extraContext = options.extraContext
        ? options.extraContext(
            toolResultSection === undefined
              ? extraContextArgsBase
              : { ...extraContextArgsBase, toolResultSection },
          )
        : undefined
      return extraContext ?? ''
    },
    ...(options.stableContext ? { stableContext: options.stableContext } : {}),
  }

  return createTool({
    name: config.name ?? 'entryNode',
    description: 'Task entry router that decides how to continue based on the previous task.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        toolResultSection: {
          type: 'string',
          description: 'Optional additional context about the most recent tool result.',
        },
        requireToolCall: {
          type: 'boolean',
          description:
            'Internal control requiring one call from a focused tool-search result before answering.',
        },
        toolSearch: {
          type: 'object',
          additionalProperties: false,
          description:
            'Search the full catalog when the current callable tools do not provide the needed capability.',
          properties: {
            mode: {
              type: 'string',
              enum: ['focused', 'overview'],
              default: 'focused',
              description:
                'Use focused normally. Use overview only after focused search fails or broad multi-tool planning is required.',
            },
            query: {
              type: 'string',
              minLength: 1,
              description: 'Describe the capability needed for the current task.',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 50,
              description: 'Maximum number of matching tools.',
            },
          },
          required: ['query'],
        },
        toolSearchInput: {
          type: 'object',
          additionalProperties: true,
          description: 'Internal result from the immediately preceding EntryNode catalog search.',
        },
        allowedTools: {
          type: 'array',
          description: 'Exact tools available to the next chat completion.',
          items: { type: 'string' },
        },
        taskContract: entryNodeTaskContractSchema,
        use_baseprompt: {
          type: 'boolean',
          default: true,
          title: 'Base Prompt',
          description:
            'Enable base system prompting for assistant style and formatting when calling chatCompletion.',
        },
        pinnedTools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Host-configured tools that remain callable in every entry-node window.',
        },
        toolSearchEnabled: {
          type: 'boolean',
          default: true,
          title: 'Tool Chooser',
          description: 'Expose focused and overview tool-catalog search to the model.',
        },
        recentToolCount: {
          type: 'integer',
          default: 3,
          minimum: 0,
          title: 'Recent Tool Count',
          description: 'Number of recently used tools to expose in the next chat completion.',
        },
        frequentToolCount: {
          type: 'integer',
          default: 3,
          minimum: 0,
          title: 'Frequent Tool Count',
          description: 'Number of frequently used tools to expose in the next chat completion.',
        },
        recentSearchToolCount: {
          type: 'integer',
          default: 3,
          minimum: 1,
          title: 'Recent Search Tool Count',
          description: 'Number of focused search results to carry into the next entry-node window.',
        },
        max_error_retries: {
          type: 'integer',
          default: 3,
          minimum: 0,
          title: 'Max Error Retries',
          description:
            'Maximum number of error-recovery attempts for the same failed tool call before giving up and explaining the situation.',
        },
        reasoning_effort: {
          enum: ['low', 'medium', 'high', 'none'],
          title: 'Reasoning Effort',
          description: 'Reasoning effort forwarded to chatCompletion.',
        },
        use_multimodal: {
          type: 'boolean',
          title: 'Multimodal Input',
          description: 'Allow multimodal model input handling.',
          default: true,
        },
        websearch: {
          type: 'object',
          title: 'Web Search',
          description:
            'Configure how many results Taskyon includes when a message is sent via search.',
          additionalProperties: false,
          properties: {
            enabled: {
              type: 'boolean',
              default: false,
              title: 'Enabled',
              description: 'Expose provider-controlled web search for this entry-node call.',
            },
            mode: {
              type: 'string',
              enum: ['auto', 'required'],
              default: 'auto',
              description:
                'Use auto for normal model choice or required for an explicit search action when the provider supports it.',
            },
            max_results: {
              type: 'integer',
              default: 5,
              title: 'Search Max Results',
              description: 'Maximum number of web results to include when web search is requested.',
            },
          },
        },
        trace: {
          type: 'object',
          title: 'Chat Completion Trace',
          description:
            'Forward request tracing options to chatCompletion for diagnostics and benchmark runs.',
          additionalProperties: false,
          properties: {
            enabled: {
              type: 'boolean',
              default: false,
              title: 'Enabled',
              description:
                'Enable input/output trace files when the runtime installed a trace writer.',
            },
            label: {
              type: 'string',
              title: 'Label',
              description: 'Optional stable label for trace file names, such as an e2e task id.',
            },
          },
        },
        prompt_templates: {
          required: ['basePrompt', 'message', 'toolResult', 'error', 'retryExhausted'],
          type: 'object',
          properties: {
            basePrompt: { type: 'string' },
            message: { type: 'string' },
            toolResult: { type: 'string' },
            error: { type: 'string' },
            retryExhausted: { type: 'string' },
          },
        },
      },
      required: ['prompt_templates'],
    } as const satisfies JSONSchema7,
    renderOptions: { hideChat: true, hideLlm: true, hideVector: true, ...config.renderOptions },
    function: async (args: EntryNodeArgs = {}, context) => {
      const runtime = await createEntryNodeRuntimeState(config, args, context)
      const promptAugmentations = resolveEntryNodePromptAugmentations(runtime.promptContext)

      if (runtime.allowedTools.length > 0) {
        const selectedCatalog = await resolveAvailableToolsForMessage(
          config,
          runtime.allowedTools,
          runtime.taskChain,
          runtime.normalizedSettings,
        )
        if (selectedCatalog.invalidToolNames.length > 0) {
          throw new Error(
            `Entry-node received unknown tool name(s): ${selectedCatalog.invalidToolNames.join(', ')}.`,
          )
        }
      }

      if (runtime.toolSearch) {
        if (!runtime.normalizedSettings.toolSearchEnabled) {
          throw new Error('Entry-node tool search is disabled for this run.')
        }
        return context.createSubtasksResult([
          createEntryNodeToolSearchTasks(runtime, runtime.toolSearch),
        ])
      }

      if (runtime.toolSearchInput !== undefined) {
        const searched = normalizeToolSearchInput(runtime.toolSearchInput)
        return context.createSubtasksResult(createToolSearchContinuationTasks(runtime, searched))
      }

      if (runtime.requireToolCall) {
        if (runtime.allowedTools.length === 0) {
          throw new Error('A focused tool search cannot continue without a matching tool.')
        }
        return context.createSubtasksResult([
          createChatCompletionTask({
            use_multimodal: runtime.normalizedSettings.use_multimodal,
            allowedTools: runtime.allowedTools,
            toolChoice: { type: 'required' },
            appendSystemPrompts: promptAugmentations.appendSystemPrompts,
            prependSystemPrompts: promptAugmentations.prependSystemPrompts,
            ...withReasoningEffort(runtime.normalizedSettings.reasoning_effort),
            ...(runtime.normalizedSettings.trace
              ? { trace: runtime.normalizedSettings.trace }
              : {}),
          }),
        ])
      }

      const giveUpAfterError = shouldGiveUpAfterError(
        await context.getExecutionTaskChain(),
        runtime.previousTask,
        runtime.normalizedSettings.max_error_retries,
      )
      if (giveUpAfterError !== undefined) {
        const giveUpPromptAugmentations = resolveEntryNodePromptAugmentations(
          runtime.promptContext,
          {
            mode: 'error',
            prompt: '',
            retryCount: giveUpAfterError - 1,
          },
        )

        return context.createSubtasksResult([
          createChatCompletionTask({
            use_multimodal: runtime.normalizedSettings.use_multimodal,
            appendSystemPrompts: giveUpPromptAugmentations.appendSystemPrompts,
            prependSystemPrompts: giveUpPromptAugmentations.prependSystemPrompts,
            ...withReasoningEffort(runtime.normalizedSettings.reasoning_effort),
            ...(runtime.normalizedSettings.trace
              ? { trace: runtime.normalizedSettings.trace }
              : {}),
          }),
        ])
      }

      const webSearchEnabled = runtime.normalizedSettings.websearch.enabled
      const isNewMessage = runtime.mode === 'message'
      const availableTools =
        webSearchEnabled || isNewMessage
          ? (
              await resolveAvailableToolsForMessage(
                config,
                runtime.toolRestriction,
                runtime.taskChain,
                runtime.normalizedSettings,
              )
            ).availableTools
          : runtime.allowedTools
      const requireSelectedTool = runtime.mode === 'fallback' && runtime.allowedTools.length === 1
      const allowToolSearch =
        runtime.normalizedSettings.toolSearchEnabled &&
        !(webSearchEnabled && runtime.normalizedSettings.websearch.mode === 'required')

      return context.createSubtasksResult(
        createChatCompletionWithToolSelector(
          runtime.entryNodeName,
          {
            use_multimodal: runtime.normalizedSettings.use_multimodal,
            ...(requireSelectedTool
              ? {}
              : withTaskContractResult(runtime.normalizedSettings.taskContract)),
            appendSystemPrompts: promptAugmentations.appendSystemPrompts,
            prependSystemPrompts: promptAugmentations.prependSystemPrompts,
            ...(webSearchEnabled
              ? {
                  websearch: {
                    enabled: true,
                    mode: runtime.normalizedSettings.websearch.mode,
                    max_results: runtime.normalizedSettings.websearch.max_results,
                  },
                }
              : {}),
            ...withReasoningEffort(runtime.normalizedSettings.reasoning_effort),
            ...(runtime.normalizedSettings.trace
              ? { trace: runtime.normalizedSettings.trace }
              : {}),
          },
          availableTools,
          allowToolSearch,
          hasCurrentTurnToolSelector(runtime.taskChain, runtime.entryNodeName),
        ),
      )
    },
  })
}
