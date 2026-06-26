import { createChatCompletionTask } from '../api'
import { toPromptMessages } from '../llm/promptMessages'
import { match, P } from 'ts-pattern'
import { createTool, toolCall } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import type { toolContext } from '../types/toolApi'
import type { FunctionCall } from '../types/tools'
import type { JSONSchema7 } from '../utils/jsonSchema'
import { safeYamlDump } from '../utils/yamlUtils'

type EntryNodeMode = 'message' | 'toolresult' | 'error' | 'structured' | 'fallback'

type EntryNodeConfig = {
  name?: string
  renderOptions?: { hideChat?: boolean; hideLlm?: boolean; hideVector?: boolean }
  defaultAllowedTools?: string[]
  getToolCatalog?: () => Promise<Array<{ name: string; description: string }>>
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
}

export type EntryNodePromptTemplates = {
  basePrompt: string
  instruction: string
  toolResult: string
  task: string
  evaluate: string
  schemaReminder: string
  tools: string
}

export const EntryNodeSettingsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
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
    tool_shortlist_reasoning: {
      type: 'boolean',
      default: false,
      title: 'Tool Shortlist Reasoning',
      description:
        'Include explicit reasoning text in shortlist results. Usually unnecessary with modern reasoning-capable models.',
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
      description: 'Configure how many results Taskyon includes when a message is sent via search.',
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
    prompt_templates: {
      required: ['basePrompt', 'instruction', 'toolResult', 'task', 'schemaReminder', 'tools'],
      type: 'object',
      properties: {
        basePrompt: { type: 'string' },
        instruction: { type: 'string' },
        toolResult: { type: 'string' },
        task: { type: 'string' },
        evaluate: { type: 'string' },
        schemaReminder: { type: 'string' },
        tools: { type: 'string' },
      },
    },
  },
} as const satisfies JSONSchema7

export type EntryNodeArgs = {
  toolResultSection?: string
  allowedTools?: string[]
  use_baseprompt?: boolean
  providerToolCalling?: boolean
  use_tool_chooser?: boolean
  tool_chooser_min_tools?: number
  tool_shortlist_reasoning?: boolean
  reasoning_effort?: 'low' | 'medium' | 'high' | 'none'
  max_error_retries?: number
  use_multimodal?: boolean
  websearch?: {
    enabled?: boolean
    max_results?: number
  }
  prompt_templates?: {
    basePrompt?: string
    instruction?: string
    toolResult?: string
    task?: string
    evaluate?: string
    schemaReminder?: string
    tools?: string
  }
}

export type ResolvedEntryNodeSettings = {
  use_baseprompt: boolean
  providerToolCalling: boolean
  use_tool_chooser: boolean
  tool_chooser_min_tools: number
  tool_shortlist_reasoning: boolean
  max_error_retries: number
  reasoning_effort?: 'low' | 'medium' | 'high' | 'none'
  use_multimodal: boolean
  websearch: {
    enabled: boolean
    max_results: number
  }
  prompt_templates: EntryNodePromptTemplates
}

const toEntryNodeArguments = (
  settings: ResolvedEntryNodeSettings,
  toolResultSection?: string,
  allowedTools?: string[],
): EntryNodeArgs => ({
  ...(allowedTools ? { allowedTools } : {}),
  use_baseprompt: settings.use_baseprompt,
  providerToolCalling: settings.providerToolCalling,
  use_tool_chooser: settings.use_tool_chooser,
  tool_chooser_min_tools: settings.tool_chooser_min_tools,
  tool_shortlist_reasoning: settings.tool_shortlist_reasoning,
  ...(settings.reasoning_effort ? { reasoning_effort: settings.reasoning_effort } : {}),
  use_multimodal: settings.use_multimodal,
  websearch: {
    enabled: settings.websearch.enabled,
    max_results: settings.websearch.max_results,
  },
  prompt_templates: { ...settings.prompt_templates },
  ...(toolResultSection !== undefined ? { toolResultSection } : {}),
})

const EntryNodeParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    toolResultSection: {
      type: 'string',
      description: 'Optional additional context about the most recent tool result.',
    },
    allowedTools: {
      type: 'array',
      description:
        'Optional internal override for the exact allowed tool set on entry-node reentry.',
      items: {
        type: 'string',
      },
    },
    ...EntryNodeSettingsSchema.properties,
  },
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
): EntryNodePromptTemplates => ({
  basePrompt: '',
  instruction: '',
  toolResult: '',
  task: '',
  evaluate: '',
  schemaReminder: '',
  tools: '',
  ...(overrides ?? {}),
})

export const normalizeEntryNodeSettings = (
  input: Partial<EntryNodeArgs> | undefined,
): ResolvedEntryNodeSettings => ({
  use_baseprompt: input?.use_baseprompt ?? true,
  providerToolCalling:
    input?.providerToolCalling ??
    (input as { nativeToolCalling?: boolean } | undefined)?.nativeToolCalling ??
    (input as { llmTools?: boolean } | undefined)?.llmTools ??
    true,
  use_tool_chooser: input?.use_tool_chooser ?? true,
  tool_chooser_min_tools: input?.tool_chooser_min_tools ?? 5,
  tool_shortlist_reasoning: input?.tool_shortlist_reasoning ?? false,
  max_error_retries: input?.max_error_retries ?? 3,
  ...(input?.reasoning_effort ? { reasoning_effort: input.reasoning_effort } : {}),
  use_multimodal: input?.use_multimodal ?? true,
  websearch: {
    enabled: input?.websearch?.enabled ?? false,
    max_results: input?.websearch?.max_results ?? 5,
  },
  prompt_templates: resolvePromptTemplates(input?.prompt_templates),
})

export const buildEntryNodePromptAugmentations = (args: {
  mode: EntryNodeMode
  prompt: string
  previousTask: TaskNode | undefined
  templates: EntryNodePromptTemplates
  useBasePrompt: boolean
  providerToolCalling: boolean
  allowedTools: string[]
}) => {
  const {
    mode,
    prompt,
    previousTask,
    templates,
    useBasePrompt,
    providerToolCalling,
    allowedTools,
  } = args
  const promptInjections = useBasePrompt ? [templates.basePrompt] : []
  const templateVariables = {
    format: 'markdown',
    message: stringifyPromptValue(previousTask?.content.data ?? ''),
    schema: '<No schema specified>',
    tools: allowedTools.join(', '),
  }
  const modePrompt =
    mode === 'toolresult'
      ? prompt
      : mode === 'error'
        ? prompt
        : mode === 'message'
          ? prompt
          : prompt
  const prompts = [
    ...(!providerToolCalling ? [templates.instruction] : []),
    ...(allowedTools.length > 0 && !providerToolCalling
      ? [interpolatePromptTemplate(templates.tools, templateVariables)]
      : []),
    modePrompt,
  ].filter((value) => value.trim().length > 0)
  return {
    prompts,
    promptInjections: promptInjections.filter((value) => value.trim().length > 0),
  }
}

export const buildEntryNodePromptPreviewMessages = (args: {
  prompt: string
  templates: EntryNodePromptTemplates
  useBasePrompt: boolean
  providerToolCalling: boolean
  allowedTools: string[]
}) => {
  const augmentations = buildEntryNodePromptAugmentations({
    mode: 'message',
    prompt: args.prompt,
    previousTask: undefined,
    templates: args.templates,
    useBasePrompt: args.useBasePrompt,
    providerToolCalling: args.providerToolCalling,
    allowedTools: args.allowedTools,
  })
  const { prependMessages, appendMessages } = toPromptMessages(
    augmentations.prompts,
    augmentations.promptInjections,
  )

  return [...prependMessages, ...appendMessages]
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const resolveAllowedToolsFromFailedTask = (
  taskChain: TaskNode[],
  previousTask: TaskNode | undefined,
  fallback: string[],
): string[] => {
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

type ToolShortlistResult = { type: 'none' } | { type: 'tools'; tools: string[] }

type PromptBasedToolDecision = { type: 'none' } | { type: 'tool'; command: FunctionCall }

type AvailableToolsResult = {
  toolCatalog: Array<{ name: string; description: string }>
  availableTools: string[]
}

type EntryNodeExecutionConfig = {
  entryNodeName: string
  toolResultSection?: string
  normalizedSettings: ResolvedEntryNodeSettings
}

type EntryNodePromptContext = {
  mode: EntryNodeMode
  prompt: string
  previousTask: TaskNode | undefined
  allowedTools: string[]
  normalizedSettings: ResolvedEntryNodeSettings
}

type EntryNodeRoutingContext = {
  mode: EntryNodeMode
  webSearchEnabled: boolean
  useToolChooser: boolean
  chooserEnabled: boolean
  chooserUsesTools: boolean
  chooserWebSearch: boolean | undefined
  shortlistResult: ToolShortlistResult | undefined
}

type EntryNodeRuntimeState = {
  allowedTools: string[]
  entryNodeName: string
  mode: EntryNodeMode
  normalizedSettings: ResolvedEntryNodeSettings
  previousTask: TaskNode | undefined
  prompt: string
  promptContext: EntryNodePromptContext
  promptBasedToolDecision: PromptBasedToolDecision | undefined
  routingContext: EntryNodeRoutingContext
  shortlistResult: ToolShortlistResult | undefined
  toolResultSection?: string
}

const buildToolShortlistSchema = (
  includeReasoning: boolean,
): JSONSchema7 & Record<string, unknown> => ({
  type: 'object',
  properties: {
    ...(includeReasoning
      ? {
          reasoning_steps: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Short reasoning notes for why these tools were chosen.',
          },
        }
      : {}),
    choice: {
      anyOf: [
        {
          enum: ['no'],
          description:
            'If you are sure no tools are required for an answer, choose "no" as an answer instead of a list.',
        },
        {
          type: 'array',
          description: 'List of tool names you think might be relevant.',
          items: {
            type: 'string',
          },
        },
      ],
    },
  },
  additionalProperties: false,
  required: includeReasoning ? ['reasoning_steps', 'choice'] : ['choice'],
})

const resolveToolShortlistResult = (
  task: TaskNode | undefined,
): ToolShortlistResult | undefined => {
  if (task?.content.type !== 'structured') return undefined
  const data = task.content.data
  if (!data || typeof data !== 'object' || !('choice' in data)) return undefined
  const choice = data.choice
  if (choice === 'no') return { type: 'none' }
  if (Array.isArray(choice) && choice.every((item) => typeof item === 'string')) {
    const filteredTools = choice.filter((tool) => tool !== 'no')
    return filteredTools.length > 0 ? { type: 'tools', tools: filteredTools } : { type: 'none' }
  }
  return undefined
}

const buildPromptBasedToolDecisionSchema = (
  allowedTools: readonly string[],
): JSONSchema7 & Record<string, unknown> => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    use_tool: {
      type: 'boolean',
      description: 'Whether exactly one of the allowed tools should be called next.',
    },
    command: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: {
          type: 'string',
          enum: [...allowedTools],
          description: 'Tool name to call when use_tool is true.',
        },
        arguments: {
          type: 'object',
          additionalProperties: true,
          description: 'Arguments for the selected tool.',
        },
      },
      required: ['name', 'arguments'],
    },
  },
  required: ['use_tool'],
})

const isFunctionArguments = (value: unknown): value is FunctionCall['arguments'] => {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const resolvePromptBasedToolDecision = (
  task: TaskNode | undefined,
  allowedTools: readonly string[],
): PromptBasedToolDecision | undefined => {
  if (task?.content.type !== 'structured') return undefined
  const data = task.content.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined
  const decision = data as Record<string, unknown>

  if (decision['use_tool'] !== true) return { type: 'none' }
  const command = decision['command']
  if (!command || typeof command !== 'object' || Array.isArray(command)) {
    throw new Error('DIY tool selection requested a tool call without a valid command payload.', {
      cause: decision,
    })
  }
  const commandRecord = command as Record<string, unknown>

  const toolName = commandRecord['name']
  const toolArguments = commandRecord['arguments']
  if (typeof toolName !== 'string' || !allowedTools.includes(toolName)) {
    throw new Error(`Tool '${String(toolName)}' is not in the list of allowed tools`, {
      cause: { allowedTools, requestedTool: toolName },
    })
  }
  if (!isFunctionArguments(toolArguments)) {
    throw new Error(`Tool '${toolName}' is missing a valid arguments object`, {
      cause: commandRecord,
    })
  }

  return {
    type: 'tool',
    command: {
      name: toolName,
      arguments: toolArguments,
    },
  }
}

const buildToolShortlistPrompt = (
  toolCatalog: ReadonlyArray<{ name: string; description: string }>,
  toolNum = 3,
) => {
  return `Here is list of all the tools which are available to you:

${safeYamlDump(toolCatalog)}

Can you please choose ${toolNum} of these which you think might be relevant for this
task. Only choose one if you think it would help you to solve the task.

Examples are:
- something that you can't answer with pure text
- a math problem
- something that requires an API call
- ... and more! make sure to think about it!

If you are sure that none of the tools are relevant, your choice should be simple string "no".

Return only the structured shortlist result. Do not answer the user yet.`
}

const createFallbackToolCatalog = (toolNames: readonly string[]) =>
  toolNames.map((name) => ({ name, description: name }))

const resolveToolNames = (
  toolCatalog: ReadonlyArray<{ name: string; description: string }>,
  fallbackToolNames: readonly string[],
) => {
  const catalogToolNames = toolCatalog.map((tool) => tool.name)
  return catalogToolNames.length > 0 ? catalogToolNames : [...fallbackToolNames]
}

const shouldRunToolChooser = (toolCount: number, minTools: number) => toolCount > minTools

const resolveFallbackToolNames = (
  allowedTools: readonly string[],
  defaultAllowedTools: readonly string[],
) => (allowedTools.length > 0 ? [...allowedTools] : [...defaultAllowedTools])

const withReasoningEffort = (reasoningEffort: ResolvedEntryNodeSettings['reasoning_effort']) =>
  reasoningEffort ? { reasoning_effort: reasoningEffort } : {}

const resolveEntryNodePromptAugmentations = (
  promptContext: EntryNodePromptContext,
  overrides?: {
    mode?: EntryNodeMode
    prompt?: string
    providerToolCalling?: boolean
    allowedTools?: string[]
  },
) =>
  buildEntryNodePromptAugmentations({
    mode: overrides?.mode ?? promptContext.mode,
    prompt: overrides?.prompt ?? promptContext.prompt,
    previousTask: promptContext.previousTask,
    templates: promptContext.normalizedSettings.prompt_templates,
    useBasePrompt: promptContext.normalizedSettings.use_baseprompt,
    providerToolCalling:
      overrides?.providerToolCalling ?? promptContext.normalizedSettings.providerToolCalling,
    allowedTools: overrides?.allowedTools ?? promptContext.allowedTools,
  })

const buildEntryNodeChatCompletionResult = (
  executionConfig: EntryNodeExecutionConfig,
  args?: {
    allowedTools?: string[]
    toolChoice?:
      | { type: 'auto' }
      | { type: 'required' }
      | {
          type: 'tool'
          toolName: string
        }
    prompts?: string[]
    prompt_injections?: string[]
    websearch?: { enabled: boolean; max_results: number }
    schema?: Record<string, unknown>
    reasoning_effort?: 'low' | 'medium' | 'high' | 'none'
  },
) => {
  const chatCompletionArgs = {
    use_multimodal: executionConfig.normalizedSettings.use_multimodal,
    ...(args?.allowedTools && args.allowedTools.length > 0
      ? { allowedTools: args.allowedTools }
      : {}),
    ...(args?.toolChoice ? { toolChoice: args.toolChoice } : {}),
    ...(args?.prompts ? { prompts: args.prompts } : {}),
    ...(args?.prompt_injections ? { prompt_injections: args.prompt_injections } : {}),
    ...(args?.schema ? { schema: args.schema } : {}),
    ...(args?.reasoning_effort ? { reasoning_effort: args.reasoning_effort } : {}),
    ...(args?.websearch ? { websearch: args.websearch } : {}),
  }

  return [createChatCompletionTask(chatCompletionArgs)]
}

const buildPromptBasedChatCompletionResult = (
  executionConfig: EntryNodeExecutionConfig,
  args: {
    allowedTools: string[]
    prompts: string[]
    prompt_injections: string[]
    reasoning_effort?: 'low' | 'medium' | 'high' | 'none'
  },
) => [
  createChatCompletionTask({
    prompts: args.prompts,
    prompt_injections: args.prompt_injections,
    schema: buildPromptBasedToolDecisionSchema(args.allowedTools),
    ...withReasoningEffort(args.reasoning_effort),
    use_multimodal: executionConfig.normalizedSettings.use_multimodal,
  }),
  toolCall({
    name: executionConfig.entryNodeName,
    arguments: toEntryNodeArguments(
      executionConfig.normalizedSettings,
      executionConfig.toolResultSection,
      args.allowedTools,
    ),
  }),
]

const buildEntryNodeToolCallingResult = (
  executionConfig: EntryNodeExecutionConfig,
  args: {
    allowedTools: string[]
    prompts: string[]
    prompt_injections: string[]
    reasoning_effort?: 'low' | 'medium' | 'high' | 'none'
  },
) => {
  if (executionConfig.normalizedSettings.providerToolCalling || args.allowedTools.length === 0) {
    return buildEntryNodeChatCompletionResult(executionConfig, {
      allowedTools: args.allowedTools,
      ...(args.allowedTools.length === 1
        ? {
            toolChoice: {
              type: 'tool' as const,
              toolName: args.allowedTools[0] as string,
            },
          }
        : {}),
      prompts: args.prompts,
      prompt_injections: args.prompt_injections,
      ...withReasoningEffort(args.reasoning_effort),
    })
  }

  return buildPromptBasedChatCompletionResult(executionConfig, args)
}

const buildEntryNodeToolCallingResultFromPrompt = (
  executionConfig: EntryNodeExecutionConfig,
  normalizedSettings: ResolvedEntryNodeSettings,
  allowedTools: string[],
  promptAugmentations: ReturnType<typeof buildEntryNodePromptAugmentations>,
) =>
  buildEntryNodeToolCallingResult(executionConfig, {
    allowedTools,
    prompts: promptAugmentations.prompts,
    prompt_injections: promptAugmentations.promptInjections,
    ...withReasoningEffort(normalizedSettings.reasoning_effort),
  })

const buildPromptBasedFinalAnswerResult = (
  executionConfig: EntryNodeExecutionConfig,
  promptContext: EntryNodePromptContext,
) => {
  const promptAugmentations = resolveEntryNodePromptAugmentations(promptContext, {
    providerToolCalling: true,
    allowedTools: [],
  })

  return buildEntryNodeChatCompletionResult(executionConfig, {
    prompts: promptAugmentations.prompts,
    prompt_injections: promptAugmentations.promptInjections,
    ...withReasoningEffort(executionConfig.normalizedSettings.reasoning_effort),
  })
}

const resolveAvailableToolsForMessage = async (
  config: EntryNodeConfig,
  allowedTools: readonly string[],
): Promise<AvailableToolsResult> => {
  const fallbackToolNames = resolveFallbackToolNames(allowedTools, config.defaultAllowedTools ?? [])
  const toolCatalog =
    (await config.getToolCatalog?.()) ?? createFallbackToolCatalog(fallbackToolNames)

  return {
    toolCatalog,
    availableTools: resolveToolNames(toolCatalog, fallbackToolNames),
  }
}

const buildShortlistReentryResult = (
  executionConfig: EntryNodeExecutionConfig,
  toolCatalog: ReadonlyArray<{ name: string; description: string }>,
) => [
  createChatCompletionTask({
    prompts: [buildToolShortlistPrompt(toolCatalog)],
    schema: buildToolShortlistSchema(executionConfig.normalizedSettings.tool_shortlist_reasoning),
    reasoning_effort: 'low',
    use_multimodal: executionConfig.normalizedSettings.use_multimodal,
  }),
  toolCall({
    name: executionConfig.entryNodeName,
    arguments: toEntryNodeArguments(
      executionConfig.normalizedSettings,
      executionConfig.toolResultSection,
    ),
  }),
]

const createEntryNodeRuntimeState = (
  config: EntryNodeConfig,
  args: EntryNodeArgs,
  context: toolContext,
): EntryNodeRuntimeState => {
  const { toolResultSection, allowedTools: allowedToolsOverride, ...settings } = args
  const previousTask = context.taskChain.at(-2)
  const mode = resolveMode(previousTask)
  const shortlistResult = resolveToolShortlistResult(previousTask)
  const promptArgsBase = {
    mode,
    taskChain: context.taskChain,
    previousTask,
  }
  const prompt = config.buildPrompt(
    toolResultSection === undefined ? promptArgsBase : { ...promptArgsBase, toolResultSection },
  )
  const allowedTools =
    allowedToolsOverride ??
    resolveAllowedToolsFromFailedTask(
      context.taskChain,
      previousTask,
      config.defaultAllowedTools ?? [],
    )
  const normalizedSettings = normalizeEntryNodeSettings(settings)
  const promptContext = {
    mode,
    prompt,
    previousTask,
    allowedTools,
    normalizedSettings,
  }

  return {
    allowedTools,
    entryNodeName: config.name ?? 'entryNode',
    mode,
    normalizedSettings,
    previousTask,
    prompt,
    promptContext,
    promptBasedToolDecision: resolvePromptBasedToolDecision(previousTask, allowedTools),
    routingContext: {
      mode,
      webSearchEnabled: normalizedSettings.websearch.enabled,
      useToolChooser: normalizedSettings.use_tool_chooser,
      chooserEnabled: !!config.toolChooser?.enabled,
      chooserUsesTools: config.toolChooser?.enabled
        ? (config.toolChooser.useTools ?? false)
        : false,
      chooserWebSearch: config.toolChooser?.enabled ? config.toolChooser.webSearch : undefined,
      shortlistResult,
    },
    shortlistResult,
    ...(toolResultSection !== undefined ? { toolResultSection } : {}),
  }
}

const buildErrorGiveUpResult = (
  executionConfig: EntryNodeExecutionConfig,
  promptContext: EntryNodePromptContext,
  errorRetries: number,
) => {
  const giveUpPromptAugmentations = resolveEntryNodePromptAugmentations(promptContext, {
    mode: 'error',
    prompt: [
      'The same tool call has failed',
      String(errorRetries - 1),
      'times.',
      'Do not retry. Explain concisely what went wrong and what the user can do.',
    ].join(' '),
    allowedTools: [],
  })

  return buildEntryNodeChatCompletionResult(executionConfig, {
    prompts: giveUpPromptAugmentations.prompts,
    prompt_injections: giveUpPromptAugmentations.promptInjections,
    ...withReasoningEffort(executionConfig.normalizedSettings.reasoning_effort),
  })
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

const runEntryNode = async (config: EntryNodeConfig, args: EntryNodeArgs, context: toolContext) => {
  const runtime = createEntryNodeRuntimeState(config, args, context)
  const executionConfig = {
    entryNodeName: runtime.entryNodeName,
    normalizedSettings: runtime.normalizedSettings,
    ...(runtime.toolResultSection !== undefined
      ? { toolResultSection: runtime.toolResultSection }
      : {}),
  }
  const promptAugmentations = resolveEntryNodePromptAugmentations(runtime.promptContext)

  if (runtime.mode === 'structured' && runtime.shortlistResult === undefined) {
    if (runtime.promptBasedToolDecision?.type === 'tool') {
      return context.createSubtasksResult([toolCall(runtime.promptBasedToolDecision.command)])
    }
    if (runtime.promptBasedToolDecision?.type === 'none') {
      return context.createSubtasksResult(
        buildPromptBasedFinalAnswerResult(executionConfig, runtime.promptContext),
      )
    }
  }

  const giveUpAfterError = shouldGiveUpAfterError(
    context.taskChain,
    runtime.previousTask,
    runtime.normalizedSettings.max_error_retries,
  )
  if (giveUpAfterError !== undefined) {
    return context.createSubtasksResult(
      buildErrorGiveUpResult(executionConfig, runtime.promptContext, giveUpAfterError),
    )
  }

  const subtaskDrafts = await match(runtime.routingContext)
    .with({ webSearchEnabled: true }, () =>
      buildEntryNodeChatCompletionResult(executionConfig, {
        allowedTools: runtime.allowedTools,
        prompts: promptAugmentations.prompts,
        prompt_injections: promptAugmentations.promptInjections,
        websearch: {
          enabled: true,
          max_results: runtime.normalizedSettings.websearch.max_results,
        },
        ...withReasoningEffort(runtime.normalizedSettings.reasoning_effort),
      }),
    )
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
          runtime.allowedTools,
        )
        const messagePromptAugmentations = resolveEntryNodePromptAugmentations(
          runtime.promptContext,
          { allowedTools: availableTools },
        )

        if (
          availableTools.length === 0 ||
          !shouldRunToolChooser(
            availableTools.length,
            runtime.normalizedSettings.tool_chooser_min_tools,
          )
        ) {
          return buildEntryNodeToolCallingResultFromPrompt(
            executionConfig,
            runtime.normalizedSettings,
            availableTools,
            messagePromptAugmentations,
          )
        }

        return buildShortlistReentryResult(executionConfig, toolCatalog)
      },
    )
    .with({ mode: 'structured', shortlistResult: { type: 'none' } }, () =>
      buildEntryNodeChatCompletionResult(executionConfig, {
        prompts: promptAugmentations.prompts,
        prompt_injections: promptAugmentations.promptInjections,
        ...withReasoningEffort(runtime.normalizedSettings.reasoning_effort),
      }),
    )
    .with(
      { mode: 'structured', shortlistResult: { type: 'tools', tools: P.select() } },
      (tools) => {
        const narrowedPromptAugmentations = resolveEntryNodePromptAugmentations(
          runtime.promptContext,
          {
            mode: 'message',
            prompt:
              'Use exactly one of the allowed tools when needed to answer the previous user request. Emit the tool call instead of answering from memory.',
            allowedTools: tools,
          },
        )

        return buildEntryNodeToolCallingResultFromPrompt(
          executionConfig,
          runtime.normalizedSettings,
          tools,
          narrowedPromptAugmentations,
        )
      },
    )
    .with({ mode: 'message' }, async () => {
      const { availableTools } = await resolveAvailableToolsForMessage(config, runtime.allowedTools)
      const messagePromptAugmentations = resolveEntryNodePromptAugmentations(
        runtime.promptContext,
        {
          allowedTools: availableTools,
        },
      )

      return buildEntryNodeToolCallingResultFromPrompt(
        executionConfig,
        runtime.normalizedSettings,
        availableTools,
        messagePromptAugmentations,
      )
    })
    .with({ mode: P.union('toolresult', 'error', 'fallback', 'structured') }, () =>
      buildEntryNodeToolCallingResultFromPrompt(
        executionConfig,
        runtime.normalizedSettings,
        runtime.allowedTools,
        promptAugmentations,
      ),
    )
    .otherwise(() =>
      buildEntryNodeToolCallingResultFromPrompt(
        executionConfig,
        runtime.normalizedSettings,
        runtime.allowedTools,
        promptAugmentations,
      ),
    )

  return context.createSubtasksResult(subtaskDrafts)
}

type StandardEntryNodeOptions = {
  name: string
  renderOptions: { hideChat?: boolean; hideLlm?: boolean }
  defaultAllowedTools: string[]
  getToolCatalog?: () => Promise<Array<{ name: string; description: string }>>
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
}

const buildStandardPrompt = (args: {
  mode: EntryNodeMode
  previousTask: TaskNode | undefined
  taskChain: TaskNode[]
  toolResultSection?: string
  extraContext?: string
}) => {
  const prefix = args.extraContext ? [args.extraContext, ''] : []
  if (args.mode === 'error') {
    return [
      ...prefix,
      'A tool error happened in the previous task.',
      'Decide whether we can correct the error and retry.',
      'If retry is feasible, issue exactly one corrected tool call.',
      'If retry is not feasible, explain concisely what failed and what input is needed.',
      'Prefer minimal argument changes and preserve user intent.',
      `Previous task summary: ${JSON.stringify(args.previousTask?.content ?? null)}`,
    ].join('\n')
  }
  if (args.mode === 'toolresult') {
    return [
      ...prefix,
      'Analyze the previous tool result and continue the task.',
      'If another tool call is required, emit exactly one valid tool call.',
      'If no tool call is required, provide a concise assistant response.',
    ].join('\n')
  }
  return [...prefix, 'Continue the conversation. Use a tool only when needed.'].join('\n')
}

export const createEntryNodeToolFactory = (config: EntryNodeConfig) =>
  createTool({
    name: config.name ?? 'entryNode',
    description: 'Task entry router that decides how to continue based on the previous task.',
    parameters: EntryNodeParameters,
    renderOptions: { hideChat: true, hideLlm: true, hideVector: true, ...config.renderOptions },
    function: (args: EntryNodeArgs = {}, context) => runEntryNode(config, args, context),
  })

export const createStandardEntryNodeTool = (options: StandardEntryNodeOptions) =>
  createEntryNodeToolFactory({
    ...options,
    ...(options.getToolCatalog ? { getToolCatalog: options.getToolCatalog } : {}),
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
      return buildStandardPrompt(
        toolResultSection === undefined
          ? { mode, previousTask, taskChain, ...(extraContext ? { extraContext } : {}) }
          : {
              mode,
              previousTask,
              taskChain,
              toolResultSection,
              ...(extraContext ? { extraContext } : {}),
            },
      )
    },
  })
