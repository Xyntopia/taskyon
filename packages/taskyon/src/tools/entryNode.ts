import { createChatCompletionTask } from '../api'
import { toPromptMessages } from '../llm/promptMessages'
import { CLARIFICATION_TOOL_NAME } from './clarificationTool'
import { match, P } from 'ts-pattern'
import { createTool } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import type { toolContext } from '../types/toolApi'
import type { JSONSchema7 } from '../utils/jsonSchema'
import { taskContractSchema, type TaskContract } from '../types/taskContract'
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
  stableContext?: (args: {
    mode: EntryNodeMode
    taskChain: TaskNode[]
    previousTask: TaskNode | undefined
  }) => string
  includeRoutinePrompt?: boolean
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

export type EntryNodeArgs = {
  toolResultSection?: string
  allowedTools?: string[]
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
  ...(input?.taskContract ? { taskContract: input.taskContract } : {}),
  use_baseprompt: input?.use_baseprompt ?? true,
  providerToolCalling:
    input?.taskContract?.result.mode !== undefined && input.taskContract.result.mode !== 'message'
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
  const prependSystemPrompts = useBasePrompt ? [templates.basePrompt] : []
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
  const appendSystemPrompts = [
    ...(!providerToolCalling ? [templates.instruction] : []),
    ...(allowedTools.length > 0 && !providerToolCalling
      ? [interpolatePromptTemplate(templates.tools, templateVariables)]
      : []),
    modePrompt,
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
  prependSystemPrompts: string[]
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
  routingContext: EntryNodeRoutingContext
  toolResultSection?: string
}

const buildToolShortlistPrompt = (
  toolCatalog: ReadonlyArray<{ name: string; description: string }>,
  entryNodeName: string,
  toolNum = 3,
) => {
  const taskPlannerGuidance = toolCatalog.some((tool) => tool.name === 'taskPlanner')
    ? [
        '',
        'Important: choose taskPlanner only when the request is genuinely multi-phase, has',
        'independent branches, or needs adaptive checkpoints. For simple answers or small',
        'single-artifact edits, choose the ordinary execution tools directly. The planner can',
        'emit one task, a short sequential packet, or independent parallel branches before',
        'replanning. When the request contains multiple distinct tasks, choose taskPlanner by',
        'itself and let each delegated entry node choose its own execution tools. This rule',
        'takes precedence over guidance for any execution tool mentioned by one subtask.',
      ].join('\n')
    : ''
  const clarificationGuidance = toolCatalog.some((tool) => tool.name === 'askClarifyingQuestions')
    ? [
        '',
        'Important: choose askClarifyingQuestions as the first step only when important',
        'requirements are unclear enough that starting work would likely be wrong. Ask',
        '4-5 compact multiple-choice questions for ambiguous project work. Do not ask',
        'questions just to collect preferences when practical defaults are obvious.',
      ].join('\n')
    : ''
  const toolSearcherGuidance = toolCatalog.some((tool) => tool.name === 'toolSearcher')
    ? [
        '',
        'Important: for a standalone or delegated task that asks to list or inspect the',
        'available tools, select toolSearcher. When tool inventory is only one objective in a',
        'request with multiple distinct tasks, select taskPlanner first instead. The catalog',
        'below is routing metadata, not the tool-inventory result; never copy, summarize, or',
        'answer from the catalog itself.',
      ].join('\n')
    : ''

  return `Here is list of all the tools which are available to you:

${safeYamlDump(toolCatalog)}

Choose up to ${toolNum} tools which might be relevant for this task. Include a tool only
when it would help solve the task. Do not select a tool merely because it is available.
Route the current leaf task only. When the conversation contains a recent message beginning
with "Task objective:", treat that message as the current delegated objective. Earlier parent
requests remain useful context, but do not classify or plan them again. Decide whether planning
is needed from the current objective alone.
This catalog is routing metadata only. Do not use its contents as evidence for the user's
requested result; select and execute the relevant tool when the task asks for tool inventory.
Do not repeat successful tool work. If the available evidence already satisfies the task,
call ${entryNodeName} with an empty allowedTools list so the task can produce its result.

Examples are:
- something that you can't answer with pure text
- a math problem
- something that requires an API call
- a multi-step task that should be planned, verified, or split into packets
- a task with blocking ambiguity that should start with structured clarification questions
- ... and more! make sure to think about it!
${taskPlannerGuidance}
${clarificationGuidance}
${toolSearcherGuidance}

If you are sure that none of the tools are relevant, call ${entryNodeName} with an empty allowedTools list.

Call ${entryNodeName} with only the allowedTools argument. Do not set any other arguments and do not answer the user yet.`
}

const createEntryNodeSelectionTask = (
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
  createChatCompletionTask({
    allowedTools: [entryNodeName],
    toolChoice: { type: 'tool', toolName: entryNodeName },
    appendSystemPrompts: [...(options.appendSystemPrompts ?? []), prompt],
    ...(options.prependSystemPrompts ? { prependSystemPrompts: options.prependSystemPrompts } : {}),
    ...withReasoningEffort(options.reasoning_effort),
    ...(options.trace ? { trace: options.trace } : {}),
    use_multimodal: options.use_multimodal,
  })

const emphasizePlanningTool = (
  toolCatalog: ReadonlyArray<{ name: string; description: string }>,
) => {
  const planner = toolCatalog.find((tool) => tool.name === 'taskPlanner')
  if (!planner) return [...toolCatalog]
  return [
    {
      ...planner,
      description: `${planner.description} Entry-node hint: use this for complex multi-step work, independent branches, or adaptive checkpoints; skip it for simple direct tasks.`,
    },
    ...toolCatalog.filter((tool) => tool.name !== 'taskPlanner'),
  ]
}

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
    providerToolCalling?: boolean
    allowedTools?: string[]
  },
) =>
  (() => {
    const augmentations = buildEntryNodePromptAugmentations({
      mode: overrides?.mode ?? promptContext.mode,
      prompt: overrides?.prompt ?? promptContext.prompt,
      previousTask: promptContext.previousTask,
      templates: promptContext.normalizedSettings.prompt_templates,
      useBasePrompt: promptContext.normalizedSettings.use_baseprompt,
      providerToolCalling:
        overrides?.providerToolCalling ?? promptContext.normalizedSettings.providerToolCalling,
      allowedTools: overrides?.allowedTools ?? promptContext.allowedTools,
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
): Promise<AvailableToolsResult> => {
  const configuredToolCatalog = await config.getToolCatalog?.()
  const availableToolCatalog =
    configuredToolCatalog && configuredToolCatalog.length > 0
      ? configuredToolCatalog
      : createFallbackToolCatalog(allowedTools ?? [])
  const allowedToolNames = allowedTools ? new Set(allowedTools) : undefined
  const toolCatalog = emphasizePlanningTool(
    availableToolCatalog.filter((tool) => allowedToolNames?.has(tool.name) ?? true),
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
  ...(base.prompt_templates || override.prompt_templates
    ? { prompt_templates: { ...base.prompt_templates, ...override.prompt_templates } }
    : {}),
})

const inheritEntryNodeArguments = (
  taskChain: readonly TaskNode[],
  entryNodeName: string,
  args: EntryNodeArgs,
) => {
  const latestUserTaskIndex = taskChain.findLastIndex((task) => task.role === 'user')
  const currentTaskChain = taskChain.slice(latestUserTaskIndex + 1)
  const inherited = currentTaskChain.reduce<EntryNodeArgs>(
    (inherited, task) =>
      task.content.type === 'functioncall' && task.content.data.name === entryNodeName
        ? mergeEntryNodeArguments(inherited, task.content.data.arguments as EntryNodeArgs)
        : inherited,
    {},
  )
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
  const { toolResultSection, allowedTools: allowedToolsOverride, ...settings } = inheritedArgs
  const previousTask = taskChain.at(-2)
  const mode = resolveMode(previousTask)
  const promptArgsBase = {
    mode,
    taskChain,
    previousTask,
  }
  const prompt = config.buildPrompt(
    toolResultSection === undefined ? promptArgsBase : { ...promptArgsBase, toolResultSection },
  )
  const stableContext = config.stableContext?.(promptArgsBase)
  const rawAllowedTools =
    allowedToolsOverride ??
    resolveAllowedToolsFromFailedTask(taskChain, previousTask, config.defaultAllowedTools)
  const toolRestriction = resolveAllowedToolsForMode(mode, rawAllowedTools)
  const allowedTools = toolRestriction ?? []
  const normalizedSettings = normalizeEntryNodeSettings(settings)
  const promptContext = {
    mode,
    prompt,
    prependSystemPrompts: stableContext ? [stableContext] : [],
    previousTask,
    allowedTools,
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
    ...(toolResultSection !== undefined ? { toolResultSection } : {}),
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
  stableContext?: (args: {
    mode: EntryNodeMode
    previousTask: TaskNode | undefined
    taskChain: TaskNode[]
  }) => string
  includeRoutinePrompt?: boolean
}

const buildStandardPrompt = (args: {
  mode: EntryNodeMode
  previousTask: TaskNode | undefined
  taskChain: TaskNode[]
  toolResultSection?: string
  extraContext?: string
  includeRoutinePrompt?: boolean
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
  if (args.includeRoutinePrompt === false) return prefix.join('\n')
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

export const createStandardEntryNodeTool = (options: StandardEntryNodeOptions) => {
  const config: EntryNodeConfig = {
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
      const prompt = buildStandardPrompt(
        toolResultSection === undefined
          ? {
              mode,
              previousTask,
              taskChain,
              ...(extraContext ? { extraContext } : {}),
              ...(options.includeRoutinePrompt !== undefined
                ? { includeRoutinePrompt: options.includeRoutinePrompt }
                : {}),
            }
          : {
              mode,
              previousTask,
              taskChain,
              toolResultSection,
              ...(extraContext ? { extraContext } : {}),
              ...(options.includeRoutinePrompt !== undefined
                ? { includeRoutinePrompt: options.includeRoutinePrompt }
                : {}),
            },
      )
      return prompt
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
        allowedTools: {
          type: 'array',
          description:
            'Optional internal override for the exact allowed tool set on entry-node reentry.',
          items: {
            type: 'string',
          },
        },
        taskContract: taskContractSchema,
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
    } as const satisfies JSONSchema7,
    renderOptions: { hideChat: true, hideLlm: true, hideVector: true, ...config.renderOptions },
    function: async (args: EntryNodeArgs = {}, context) => {
      const runtime = await createEntryNodeRuntimeState(config, args, context)
      const promptAugmentations = resolveEntryNodePromptAugmentations(runtime.promptContext)

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
            prompt: [
              'The same tool call has failed',
              String(giveUpAfterError - 1),
              'times.',
              'Do not retry. Explain concisely what went wrong and what the user can do.',
            ].join(' '),
            allowedTools: [],
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

              return [
                createEntryNodeSelectionTask(
                  runtime.entryNodeName,
                  buildToolShortlistPrompt(toolCatalog, runtime.entryNodeName, 1),
                  {
                    appendSystemPrompts: messagePromptAugmentations.appendSystemPrompts,
                    prependSystemPrompts: messagePromptAugmentations.prependSystemPrompts,
                    reasoning_effort: runtime.normalizedSettings.reasoning_effort,
                    trace: runtime.normalizedSettings.trace,
                    use_multimodal: runtime.normalizedSettings.use_multimodal,
                  },
                ),
              ]
            }

            return [
              createEntryNodeSelectionTask(
                runtime.entryNodeName,
                buildToolShortlistPrompt(toolCatalog, runtime.entryNodeName),
                {
                  reasoning_effort: 'low',
                  trace: runtime.normalizedSettings.trace,
                  use_multimodal: runtime.normalizedSettings.use_multimodal,
                },
              ),
            ]
          },
        )
        // Plain user message path: resolve callable tools and let provider tool-calling continue.
        .with({ mode: 'message' }, async () => {
          const { availableTools } = await resolveAvailableToolsForMessage(
            config,
            runtime.toolRestriction,
          )
          const messagePromptAugmentations = resolveEntryNodePromptAugmentations(
            runtime.promptContext,
            {
              allowedTools: availableTools,
            },
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

          return [
            createEntryNodeSelectionTask(
              runtime.entryNodeName,
              buildToolShortlistPrompt(
                createFallbackToolCatalog(availableTools),
                runtime.entryNodeName,
                1,
              ),
              {
                appendSystemPrompts: messagePromptAugmentations.appendSystemPrompts,
                prependSystemPrompts: messagePromptAugmentations.prependSystemPrompts,
                reasoning_effort: runtime.normalizedSettings.reasoning_effort,
                trace: runtime.normalizedSettings.trace,
                use_multimodal: runtime.normalizedSettings.use_multimodal,
              },
            ),
          ]
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

          return [
            createEntryNodeSelectionTask(
              runtime.entryNodeName,
              buildToolShortlistPrompt(
                createFallbackToolCatalog(runtime.allowedTools),
                runtime.entryNodeName,
                1,
              ),
              {
                appendSystemPrompts: promptAugmentations.appendSystemPrompts,
                prependSystemPrompts: promptAugmentations.prependSystemPrompts,
                reasoning_effort: runtime.normalizedSettings.reasoning_effort,
                trace: runtime.normalizedSettings.trace,
                use_multimodal: runtime.normalizedSettings.use_multimodal,
              },
            ),
          ]
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

          return [
            createEntryNodeSelectionTask(
              runtime.entryNodeName,
              buildToolShortlistPrompt(
                createFallbackToolCatalog(runtime.allowedTools),
                runtime.entryNodeName,
                1,
              ),
              {
                appendSystemPrompts: promptAugmentations.appendSystemPrompts,
                prependSystemPrompts: promptAugmentations.prependSystemPrompts,
                reasoning_effort: runtime.normalizedSettings.reasoning_effort,
                trace: runtime.normalizedSettings.trace,
                use_multimodal: runtime.normalizedSettings.use_multimodal,
              },
            ),
          ]
        })

      return context.createSubtasksResult(subtaskDrafts)
    },
  })
}
