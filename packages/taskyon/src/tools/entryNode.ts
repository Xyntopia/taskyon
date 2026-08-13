import { createChatCompletionTask } from '../api'
import { toPromptMessages } from '../llm/promptMessages'
import { CLARIFICATION_TOOL_NAME } from './clarificationTool'
import { match, P } from 'ts-pattern'
import { createTool } from '../types/toolApi'
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

const ENTRY_NODE_SELECTION_TOOL_NAME = 'selectTaskyonTools'
const entryNodeSelectionParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    allowedTools: {
      type: 'array',
      description: 'The exact tools which might help complete the current task.',
      items: { type: 'string' },
    },
    toolSearch: {
      type: 'object',
      additionalProperties: false,
      description: 'Search the tool catalog when the needed capability is missing.',
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
      required: ['query'],
    },
  },
} as const satisfies JSONSchema7

type EntryNodeMode = 'message' | 'toolresult' | 'error' | 'structured' | 'fallback'

type EntryNodeConfig = {
  name?: string
  renderOptions?: { hideChat?: boolean; hideLlm?: boolean; hideVector?: boolean }
  defaultAllowedTools?: string[]
  getToolCatalog?: (args: {
    taskChain: readonly TaskNode[]
    allowedTools: readonly string[] | undefined
  }) => Promise<Array<{ name: string; description: string }>>
  searchToolCatalog?: (
    query: string,
    limit: number,
  ) => Promise<Array<{ name: string; description: string }>>
  toolChooser?:
    | {
        enabled: true
        useTools?: boolean
        webSearch?: boolean
      }
    | { enabled: false }
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
  toolChooser: string
  retryExhausted: string
}

export type EntryNodeArgs = {
  toolResultSection?: string
  allowedTools?: string[]
  toolSearch?: { query: string; limit?: number }
  taskContract?: TaskContract
  use_baseprompt?: boolean
  providerToolCalling?: boolean
  use_tool_chooser?: boolean
  tool_chooser_min_tools?: number
  reasoning_effort?: 'low' | 'medium' | 'high' | 'none'
  max_error_retries?: number
  use_multimodal?: boolean
  websearch?: {
    enabled?: boolean
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
  use_baseprompt: boolean
  providerToolCalling: boolean
  use_tool_chooser: boolean
  tool_chooser_min_tools: number
  max_error_retries: number
  reasoning_effort?: 'low' | 'medium' | 'high' | 'none'
  use_multimodal: boolean
  websearch: {
    enabled: boolean
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
    use_baseprompt: input?.use_baseprompt ?? true,
    providerToolCalling:
      taskContract?.result.mode !== undefined && taskContract.result.mode !== 'message'
        ? false
        : (input?.providerToolCalling ??
          (input as { nativeToolCalling?: boolean } | undefined)?.nativeToolCalling ??
          (input as { llmTools?: boolean } | undefined)?.llmTools ??
          true),
    use_tool_chooser: input?.use_tool_chooser ?? true,
    tool_chooser_min_tools: input?.tool_chooser_min_tools ?? 5,
    max_error_retries: input?.max_error_retries ?? 3,
    ...(input?.reasoning_effort ? { reasoning_effort: input.reasoning_effort } : {}),
    use_multimodal: input?.use_multimodal ?? true,
    websearch: {
      enabled: input?.websearch?.enabled ?? false,
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
}

type EntryNodePromptContext = {
  mode: EntryNodeMode
  prompt: string
  includeModePrompt: boolean
  prependSystemPrompts: string[]
  previousTask: TaskNode | undefined
  normalizedSettings: ResolvedEntryNodeSettings
}

type EntryNodeRoutingContext = {
  mode: EntryNodeMode
  webSearchEnabled: boolean
  useToolChooser: boolean
  chooserEnabled: boolean
  chooserUsesTools: boolean
  chooserWebSearch: boolean | undefined
}

type EntryNodeRuntimeState = {
  allowedTools: string[]
  toolRestriction: string[] | undefined
  entryNodeName: string
  mode: EntryNodeMode
  normalizedSettings: ResolvedEntryNodeSettings
  previousTask: TaskNode | undefined
  prompt: string
  promptContext: EntryNodePromptContext
  retryToolSelection: boolean
  routingContext: EntryNodeRoutingContext
  toolResultSection?: string
  toolSearch?: { query: string; limit?: number }
  taskChain: TaskNode[]
}

const isToolSelectionRequest = (task: TaskNode | undefined, selectionToolName: string) => {
  if (task?.content.type !== 'functioncall' || task.content.data.name !== 'chatCompletion') {
    return false
  }
  const args = task.content.data.arguments as {
    allowedTools?: unknown
    toolChoice?: { type?: unknown; toolName?: unknown }
  }
  return (
    isStringArray(args.allowedTools) &&
    args.allowedTools.length === 1 &&
    args.allowedTools[0] === selectionToolName &&
    args.toolChoice?.type === 'tool' &&
    args.toolChoice.toolName === selectionToolName
  )
}

const normalizeEntryNodeSelectionArgs = (
  args: EntryNodeArgs,
  isToolSelection: boolean,
): { args: EntryNodeArgs; retry: boolean } => {
  if (!isToolSelection) return { args, retry: false }
  const hasAllowedTools = Array.isArray(args.allowedTools)
  const hasToolSearch = args.toolSearch !== undefined
  return {
    args: {
      ...(hasAllowedTools ? { allowedTools: args.allowedTools } : {}),
      ...(hasToolSearch ? { toolSearch: args.toolSearch } : {}),
    },
    retry: hasAllowedTools === hasToolSearch,
  }
}

const buildToolShortlistPrompt = (
  template: string,
  toolCatalog: ReadonlyArray<{ name: string; description: string }>,
  entryNodeName: string,
  toolNum = 3,
) =>
  interpolatePromptTemplate(template, {
    maxTools: String(toolNum),
    selectorTool: entryNodeName,
    toolCatalog: safeYamlDump(toolCatalog),
  })

const createEntryNodeSelectionTasks = (
  entryNodeName: string,
  prompt: string,
  options: {
    appendSystemPrompts?: string[]
    prependSystemPrompts?: Parameters<typeof createChatCompletionTask>[0]['prependSystemPrompts']
    reasoning_effort?: ResolvedEntryNodeSettings['reasoning_effort']
    trace?: ResolvedEntryNodeSettings['trace']
    use_multimodal: boolean
  },
) =>
  bind(
    {
      name: ENTRY_NODE_SELECTION_TOOL_NAME,
      description: 'Select relevant tools or request a focused search of the tool catalog.',
      target: entryNodeName,
      publicArguments: entryNodeSelectionParameters.properties,
    },
    {
      appendSystemPrompts: [...(options.appendSystemPrompts ?? []), prompt],
      ...(options.prependSystemPrompts
        ? { prependSystemPrompts: options.prependSystemPrompts }
        : {}),
      ...withReasoningEffort(options.reasoning_effort),
      ...(options.trace ? { trace: options.trace } : {}),
      use_multimodal: options.use_multimodal,
    },
  )

const createFallbackToolCatalog = (toolNames: readonly string[]) =>
  toolNames.map((name) => ({ name, description: name }))

const shouldRunToolChooser = (toolCount: number, minTools: number) => toolCount > minTools

const resolveAllowedToolsForMode = (
  mode: EntryNodeMode,
  allowedTools: readonly string[] | undefined,
) =>
  mode === 'error'
    ? allowedTools?.filter((toolName) => toolName !== CLARIFICATION_TOOL_NAME)
    : allowedTools
      ? [...allowedTools]
      : undefined

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

const resolveAvailableToolsForMessage = async (
  config: EntryNodeConfig,
  allowedTools: readonly string[] | undefined,
  taskChain: readonly TaskNode[],
): Promise<AvailableToolsResult> => {
  const configuredToolCatalog = await config.getToolCatalog?.({ taskChain, allowedTools })
  const availableToolCatalog =
    configuredToolCatalog && configuredToolCatalog.length > 0
      ? configuredToolCatalog
      : createFallbackToolCatalog(allowedTools ?? [])
  const allowedToolNames = allowedTools ? new Set(allowedTools) : undefined
  const toolCatalog = availableToolCatalog.filter(
    (tool) => allowedToolNames?.has(tool.name) ?? true,
  )

  return {
    toolCatalog,
    availableTools: toolCatalog.map((tool) => tool.name),
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
      toolSearch: transientSearch,
      websearch: transientWebSearch,
      ...persistentArgs
    } = task.content.data.arguments as EntryNodeArgs
    void transientSearch
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
  const selection = normalizeEntryNodeSelectionArgs(
    args,
    isToolSelectionRequest(taskChain.at(-2), ENTRY_NODE_SELECTION_TOOL_NAME),
  )
  const inheritedArgs = inheritEntryNodeArguments(taskChain, entryNodeName, selection.args)
  const {
    toolResultSection,
    allowedTools: allowedToolsOverride,
    toolSearch,
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
    resolveAllowedToolsFromFailedTask(taskChain, previousTask, config.defaultAllowedTools)
  const toolRestriction = resolveAllowedToolsForMode(mode, rawAllowedTools)
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
    toolRestriction,
    entryNodeName,
    mode,
    normalizedSettings,
    previousTask,
    prompt,
    promptContext,
    retryToolSelection: selection.retry,
    routingContext: {
      mode,
      webSearchEnabled: normalizedSettings.websearch.enabled,
      useToolChooser: normalizedSettings.use_tool_chooser,
      chooserEnabled: !!config.toolChooser?.enabled,
      chooserUsesTools: config.toolChooser?.enabled
        ? (config.toolChooser.useTools ?? false)
        : false,
      chooserWebSearch: config.toolChooser?.enabled ? config.toolChooser.webSearch : undefined,
    },
    taskChain,
    ...(toolResultSection !== undefined ? { toolResultSection } : {}),
    ...(toolSearch ? { toolSearch } : {}),
  }
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
  }) => Promise<Array<{ name: string; description: string }>>
  searchToolCatalog?: (
    query: string,
    limit: number,
  ) => Promise<Array<{ name: string; description: string }>>
  toolChooser:
    | {
        enabled: true
        useTools?: boolean
        webSearch?: boolean
      }
    | { enabled: false }
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
    ...(options.searchToolCatalog ? { searchToolCatalog: options.searchToolCatalog } : {}),
    ...(options.toolChooser ? { toolChooser: options.toolChooser } : {}),
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
        ...entryNodeSelectionParameters.properties,
        taskContract: entryNodeTaskContractSchema,
        use_baseprompt: {
          type: 'boolean',
          default: true,
          title: 'Base Prompt',
          description:
            'Enable base system prompting for assistant style and formatting when calling chatCompletion.',
        },
        providerToolCalling: {
          type: 'boolean',
          default: true,
          title: 'Provider Tool Calling',
          description:
            'Enable provider-native tool calling during chatCompletion. Disable to prefer Taskyon DIY tool selection via structured results.',
        },
        use_tool_chooser: {
          type: 'boolean',
          default: true,
          title: 'Tool Chooser',
          description:
            'Enable the tool-shortlist stage for this specific entry-node run. This is captured on the entry node for replayability.',
        },
        tool_chooser_min_tools: {
          type: 'integer',
          default: 5,
          minimum: 0,
          title: 'Tool Chooser Min Tools',
          description:
            'Only run the tool-shortlist stage when more than this many tools are available. Smaller tool sets are passed directly to chatCompletion.',
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
              description: 'Internal per-message flag set by the send button that was used.',
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
          required: [
            'basePrompt',
            'message',
            'toolResult',
            'error',
            'toolChooser',
            'retryExhausted',
          ],
          type: 'object',
          properties: {
            basePrompt: { type: 'string' },
            message: { type: 'string' },
            toolResult: { type: 'string' },
            error: { type: 'string' },
            toolChooser: { type: 'string' },
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

      if (runtime.retryToolSelection) {
        const { toolCatalog } = await resolveAvailableToolsForMessage(
          config,
          runtime.toolRestriction,
          runtime.taskChain,
        )
        return context.createSubtasksResult(
          createEntryNodeSelectionTasks(
            runtime.entryNodeName,
            `${buildToolShortlistPrompt(
              runtime.normalizedSettings.prompt_templates.toolChooser,
              toolCatalog,
              ENTRY_NODE_SELECTION_TOOL_NAME,
            )}\n\nYour previous routing call was invalid: provide exactly one of allowedTools or toolSearch, and do not provide execution settings or a taskContract.`,
            {
              appendSystemPrompts: promptAugmentations.appendSystemPrompts,
              prependSystemPrompts: promptAugmentations.prependSystemPrompts,
              reasoning_effort: runtime.normalizedSettings.reasoning_effort,
              trace: runtime.normalizedSettings.trace,
              use_multimodal: runtime.normalizedSettings.use_multimodal,
            },
          ),
        )
      }

      if (runtime.toolSearch) {
        if (!config.searchToolCatalog) {
          throw new Error('Entry-node tool search is unavailable in this runtime.')
        }
        const limit = Math.max(1, Math.min(runtime.toolSearch.limit ?? 10, 50))
        const searched = await config.searchToolCatalog(runtime.toolSearch.query, limit)
        const restriction = runtime.toolRestriction ? new Set(runtime.toolRestriction) : undefined
        const matches = searched.filter((tool) => restriction?.has(tool.name) ?? true)
        return context.createSubtasksResult(
          createEntryNodeSelectionTasks(
            runtime.entryNodeName,
            buildToolShortlistPrompt(
              runtime.normalizedSettings.prompt_templates.toolChooser,
              matches,
              ENTRY_NODE_SELECTION_TOOL_NAME,
            ),
            {
              reasoning_effort: 'low',
              trace: runtime.normalizedSettings.trace,
              use_multimodal: runtime.normalizedSettings.use_multimodal,
            },
          ),
        )
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

      const subtaskDrafts = await match(runtime.routingContext)
        // Web-search button path: send the message through chatCompletion with hosted search enabled.
        .with({ webSearchEnabled: true }, () => [
          createChatCompletionTask({
            use_multimodal: runtime.normalizedSettings.use_multimodal,
            ...withTaskContractResult(runtime.normalizedSettings.taskContract),
            ...(runtime.allowedTools.length > 0
              ? {
                  allowedTools: runtime.allowedTools,
                }
              : {}),
            appendSystemPrompts: promptAugmentations.appendSystemPrompts,
            prependSystemPrompts: promptAugmentations.prependSystemPrompts,
            websearch: {
              enabled: true,
              max_results: runtime.normalizedSettings.websearch.max_results,
            },
            ...withReasoningEffort(runtime.normalizedSettings.reasoning_effort),
            ...(runtime.normalizedSettings.trace
              ? { trace: runtime.normalizedSettings.trace }
              : {}),
          }),
        ])
        // First user message with many tools: optionally shortlist the available tool catalog first.
        .with(
          {
            mode: 'message',
            chooserEnabled: true,
            useToolChooser: true,
            chooserUsesTools: true,
          },
          async () => {
            const { toolCatalog, availableTools } = await resolveAvailableToolsForMessage(
              config,
              runtime.toolRestriction,
              runtime.taskChain,
            )
            const messagePromptAugmentations = resolveEntryNodePromptAugmentations(
              runtime.promptContext,
            )

            if (
              availableTools.length === 0 ||
              !shouldRunToolChooser(
                availableTools.length,
                runtime.normalizedSettings.tool_chooser_min_tools,
              )
            ) {
              if (runtime.normalizedSettings.providerToolCalling || availableTools.length === 0) {
                return [
                  createChatCompletionTask({
                    use_multimodal: runtime.normalizedSettings.use_multimodal,
                    ...withTaskContractResult(runtime.normalizedSettings.taskContract),
                    ...(availableTools.length > 0 ? { allowedTools: availableTools } : {}),
                    ...(availableTools.length === 1
                      ? {
                          toolChoice: {
                            type: 'tool' as const,
                            toolName: availableTools[0] as string,
                          },
                        }
                      : {}),
                    appendSystemPrompts: messagePromptAugmentations.appendSystemPrompts,
                    prependSystemPrompts: messagePromptAugmentations.prependSystemPrompts,
                    ...withReasoningEffort(runtime.normalizedSettings.reasoning_effort),
                    ...(runtime.normalizedSettings.trace
                      ? { trace: runtime.normalizedSettings.trace }
                      : {}),
                  }),
                ]
              }

              return createEntryNodeSelectionTasks(
                runtime.entryNodeName,
                buildToolShortlistPrompt(
                  runtime.normalizedSettings.prompt_templates.toolChooser,
                  toolCatalog,
                  ENTRY_NODE_SELECTION_TOOL_NAME,
                  1,
                ),
                {
                  appendSystemPrompts: messagePromptAugmentations.appendSystemPrompts,
                  prependSystemPrompts: messagePromptAugmentations.prependSystemPrompts,
                  reasoning_effort: runtime.normalizedSettings.reasoning_effort,
                  trace: runtime.normalizedSettings.trace,
                  use_multimodal: runtime.normalizedSettings.use_multimodal,
                },
              )
            }

            return createEntryNodeSelectionTasks(
              runtime.entryNodeName,
              buildToolShortlistPrompt(
                runtime.normalizedSettings.prompt_templates.toolChooser,
                toolCatalog,
                ENTRY_NODE_SELECTION_TOOL_NAME,
              ),
              {
                appendSystemPrompts: messagePromptAugmentations.appendSystemPrompts,
                prependSystemPrompts: messagePromptAugmentations.prependSystemPrompts,
                reasoning_effort: 'low',
                trace: runtime.normalizedSettings.trace,
                use_multimodal: runtime.normalizedSettings.use_multimodal,
              },
            )
          },
        )
        // Plain user message path: resolve callable tools and let provider tool-calling continue.
        .with({ mode: 'message' }, async () => {
          const { availableTools } = await resolveAvailableToolsForMessage(
            config,
            runtime.toolRestriction,
            runtime.taskChain,
          )
          const messagePromptAugmentations = resolveEntryNodePromptAugmentations(
            runtime.promptContext,
          )

          if (runtime.normalizedSettings.providerToolCalling || availableTools.length === 0) {
            return [
              createChatCompletionTask({
                use_multimodal: runtime.normalizedSettings.use_multimodal,
                ...withTaskContractResult(runtime.normalizedSettings.taskContract),
                ...(availableTools.length > 0 ? { allowedTools: availableTools } : {}),
                ...(availableTools.length === 1
                  ? {
                      toolChoice: {
                        type: 'tool' as const,
                        toolName: availableTools[0] as string,
                      },
                    }
                  : {}),
                appendSystemPrompts: messagePromptAugmentations.appendSystemPrompts,
                prependSystemPrompts: messagePromptAugmentations.prependSystemPrompts,
                ...withReasoningEffort(runtime.normalizedSettings.reasoning_effort),
                ...(runtime.normalizedSettings.trace
                  ? { trace: runtime.normalizedSettings.trace }
                  : {}),
              }),
            ]
          }

          return createEntryNodeSelectionTasks(
            runtime.entryNodeName,
            buildToolShortlistPrompt(
              runtime.normalizedSettings.prompt_templates.toolChooser,
              createFallbackToolCatalog(availableTools),
              ENTRY_NODE_SELECTION_TOOL_NAME,
              1,
            ),
            {
              appendSystemPrompts: messagePromptAugmentations.appendSystemPrompts,
              prependSystemPrompts: messagePromptAugmentations.prependSystemPrompts,
              reasoning_effort: runtime.normalizedSettings.reasoning_effort,
              trace: runtime.normalizedSettings.trace,
              use_multimodal: runtime.normalizedSettings.use_multimodal,
            },
          )
        })
        // Re-entry after tool results, recoverable errors, or fallback states.
        .with({ mode: P.union('toolresult', 'error', 'fallback', 'structured') }, () => {
          const executeSelectedTool =
            runtime.mode === 'fallback' && runtime.allowedTools.length === 1
          if (
            runtime.normalizedSettings.providerToolCalling ||
            runtime.allowedTools.length === 0 ||
            executeSelectedTool
          ) {
            return [
              createChatCompletionTask({
                use_multimodal: runtime.normalizedSettings.use_multimodal,
                ...(executeSelectedTool
                  ? {}
                  : withTaskContractResult(runtime.normalizedSettings.taskContract)),
                ...(runtime.allowedTools.length > 0 ? { allowedTools: runtime.allowedTools } : {}),
                ...(executeSelectedTool
                  ? {
                      toolChoice: {
                        type: 'tool' as const,
                        toolName: runtime.allowedTools[0] as string,
                      },
                    }
                  : {}),
                appendSystemPrompts: promptAugmentations.appendSystemPrompts,
                prependSystemPrompts: promptAugmentations.prependSystemPrompts,
                ...withReasoningEffort(runtime.normalizedSettings.reasoning_effort),
                ...(runtime.normalizedSettings.trace
                  ? { trace: runtime.normalizedSettings.trace }
                  : {}),
              }),
            ]
          }

          return createEntryNodeSelectionTasks(
            runtime.entryNodeName,
            buildToolShortlistPrompt(
              runtime.normalizedSettings.prompt_templates.toolChooser,
              createFallbackToolCatalog(runtime.allowedTools),
              ENTRY_NODE_SELECTION_TOOL_NAME,
              1,
            ),
            {
              appendSystemPrompts: promptAugmentations.appendSystemPrompts,
              prependSystemPrompts: promptAugmentations.prependSystemPrompts,
              reasoning_effort: runtime.normalizedSettings.reasoning_effort,
              trace: runtime.normalizedSettings.trace,
              use_multimodal: runtime.normalizedSettings.use_multimodal,
            },
          )
        })
        // Defensive fallback for future routing modes.
        .otherwise(() => {
          if (runtime.normalizedSettings.providerToolCalling || runtime.allowedTools.length === 0) {
            return [
              createChatCompletionTask({
                use_multimodal: runtime.normalizedSettings.use_multimodal,
                ...withTaskContractResult(runtime.normalizedSettings.taskContract),
                ...(runtime.allowedTools.length > 0 ? { allowedTools: runtime.allowedTools } : {}),
                ...(runtime.allowedTools.length === 1
                  ? {
                      toolChoice: {
                        type: 'tool' as const,
                        toolName: runtime.allowedTools[0] as string,
                      },
                    }
                  : {}),
                appendSystemPrompts: promptAugmentations.appendSystemPrompts,
                prependSystemPrompts: promptAugmentations.prependSystemPrompts,
                ...withReasoningEffort(runtime.normalizedSettings.reasoning_effort),
                ...(runtime.normalizedSettings.trace
                  ? { trace: runtime.normalizedSettings.trace }
                  : {}),
              }),
            ]
          }

          return createEntryNodeSelectionTasks(
            runtime.entryNodeName,
            buildToolShortlistPrompt(
              runtime.normalizedSettings.prompt_templates.toolChooser,
              createFallbackToolCatalog(runtime.allowedTools),
              ENTRY_NODE_SELECTION_TOOL_NAME,
              1,
            ),
            {
              appendSystemPrompts: promptAugmentations.appendSystemPrompts,
              prependSystemPrompts: promptAugmentations.prependSystemPrompts,
              reasoning_effort: runtime.normalizedSettings.reasoning_effort,
              trace: runtime.normalizedSettings.trace,
              use_multimodal: runtime.normalizedSettings.use_multimodal,
            },
          )
        })

      return context.createSubtasksResult(subtaskDrafts)
    },
  })
}
