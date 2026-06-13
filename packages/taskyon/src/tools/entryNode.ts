import { createChatCompletionTask } from '../api'
import { match, P } from 'ts-pattern'
import { createTool, makeTaskResult, toolCall } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
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
    llmTools: {
      type: 'boolean',
      default: true,
      title: 'Native Tool Calling',
      description:
        'Enable native LLM tool calling during chatCompletion. Disable to prefer Taskyon DIY function-calling.',
    },
    nativeToolCalling: {
      type: 'boolean',
      default: true,
      description: 'Alias for llmTools. If set, this value takes precedence over llmTools.',
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
  use_baseprompt?: boolean
  llmTools?: boolean
  nativeToolCalling?: boolean
  use_tool_chooser?: boolean
  tool_chooser_min_tools?: number
  tool_shortlist_reasoning?: boolean
  reasoning_effort?: 'low' | 'medium' | 'high' | 'none'
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
  llmTools: boolean
  nativeToolCalling: boolean
  use_tool_chooser: boolean
  tool_chooser_min_tools: number
  tool_shortlist_reasoning: boolean
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
): EntryNodeArgs => ({
  use_baseprompt: settings.use_baseprompt,
  llmTools: settings.llmTools,
  nativeToolCalling: settings.nativeToolCalling,
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
  llmTools: input?.llmTools ?? true,
  nativeToolCalling: input?.nativeToolCalling ?? true,
  use_tool_chooser: input?.use_tool_chooser ?? true,
  tool_chooser_min_tools: input?.tool_chooser_min_tools ?? 5,
  tool_shortlist_reasoning: input?.tool_shortlist_reasoning ?? false,
  ...(input?.reasoning_effort ? { reasoning_effort: input.reasoning_effort } : {}),
  use_multimodal: input?.use_multimodal ?? true,
  websearch: {
    enabled: input?.websearch?.enabled ?? false,
    max_results: input?.websearch?.max_results ?? 5,
  },
  prompt_templates: resolvePromptTemplates(input?.prompt_templates),
})

const buildEntryNodePromptAugmentations = (args: {
  mode: EntryNodeMode
  prompt: string
  previousTask: TaskNode | undefined
  templates: EntryNodePromptTemplates
  useBasePrompt: boolean
  llmTools: boolean
  allowedTools: string[]
}) => {
  const { mode, prompt, previousTask, templates, useBasePrompt, llmTools, allowedTools } = args
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
    ...(!llmTools ? [templates.instruction] : []),
    ...(allowedTools.length > 0 && !llmTools
      ? [interpolatePromptTemplate(templates.tools, templateVariables)]
      : []),
    modePrompt,
  ].filter((value) => value.trim().length > 0)
  return {
    prompts,
    promptInjections: promptInjections.filter((value) => value.trim().length > 0),
  }
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
    function: ({ toolResultSection, ...settings }: EntryNodeArgs = {}, context) => {
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
      const allowedTools = resolveAllowedToolsFromFailedTask(
        context.taskChain,
        previousTask,
        config.defaultAllowedTools ?? [],
      )
      const normalizedSettings = normalizeEntryNodeSettings(settings)
      const useToolChooser = normalizedSettings.use_tool_chooser
      const webSearchEnabled = normalizedSettings.websearch.enabled
      const chooserConfig = config.toolChooser?.enabled ? config.toolChooser : undefined
      const routingContext = {
        mode,
        webSearchEnabled,
        useToolChooser,
        chooserEnabled: !!chooserConfig,
        chooserUsesTools: chooserConfig?.useTools ?? false,
        chooserWebSearch: chooserConfig?.webSearch,
        shortlistResult,
      }

      const buildChatCompletionResult = (
        goal: 'SimpleCompletion' | 'AnalyzeToolResult' | 'WebSearch',
        args?: {
          allowedTools?: string[]
          llmTools?: boolean
          prompts?: string[]
          prompt_injections?: string[]
          max_results?: number
          schema?: Record<string, unknown>
          reasoning_effort?: 'low' | 'medium' | 'high' | 'none'
        },
      ) => {
        // TODO:  I am not sur,e why we are doing this here..  if an arg isn#t given, we can siply leae it out...
        const chatCompletionArgs = {
          goal,
          llmTools: args?.llmTools ?? normalizedSettings.nativeToolCalling,
          use_multimodal: normalizedSettings.use_multimodal,
          ...(args?.allowedTools ? { allowedTools: args.allowedTools } : {}),
          ...(args?.prompts ? { prompts: args.prompts } : {}),
          ...(args?.prompt_injections ? { prompt_injections: args.prompt_injections } : {}),
          ...(args?.schema ? { schema: args.schema } : {}),
          ...(args?.reasoning_effort ? { reasoning_effort: args.reasoning_effort } : {}),
          ...(args?.max_results !== undefined ? { max_results: args.max_results } : {}),
        }
        return makeTaskResult([createChatCompletionTask(chatCompletionArgs)])
      }

      const resolveAvailableToolsForMessage = async () => {
        const fallbackToolNames = resolveFallbackToolNames(
          allowedTools,
          config.defaultAllowedTools ?? [],
        )
        const toolCatalog =
          (await config.getToolCatalog?.()) ?? createFallbackToolCatalog(fallbackToolNames)
        return {
          toolCatalog,
          availableTools: resolveToolNames(toolCatalog, fallbackToolNames),
        }
      }

      const promptAugmentations = buildEntryNodePromptAugmentations({
        mode,
        prompt,
        previousTask,
        templates: normalizedSettings.prompt_templates,
        useBasePrompt: normalizedSettings.use_baseprompt,
        llmTools: normalizedSettings.nativeToolCalling,
        allowedTools,
      })

      return match(routingContext)
        .with({ webSearchEnabled: true }, () =>
          buildChatCompletionResult('WebSearch', {
            allowedTools,
            llmTools: normalizedSettings.nativeToolCalling,
            prompts: promptAugmentations.prompts,
            prompt_injections: promptAugmentations.promptInjections,
            max_results: normalizedSettings.websearch.max_results,
            ...(normalizedSettings.reasoning_effort
              ? { reasoning_effort: normalizedSettings.reasoning_effort }
              : {}),
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
            const { toolCatalog, availableTools } = await resolveAvailableToolsForMessage()
            const messagePromptAugmentations = buildEntryNodePromptAugmentations({
              mode,
              prompt,
              previousTask,
              templates: normalizedSettings.prompt_templates,
              useBasePrompt: normalizedSettings.use_baseprompt,
              llmTools: normalizedSettings.nativeToolCalling,
              allowedTools: availableTools,
            })

            if (availableTools.length === 0) {
              return buildChatCompletionResult('SimpleCompletion', {
                allowedTools: availableTools,
                llmTools: normalizedSettings.nativeToolCalling,
                prompts: messagePromptAugmentations.prompts,
                prompt_injections: messagePromptAugmentations.promptInjections,
                ...(normalizedSettings.reasoning_effort
                  ? { reasoning_effort: normalizedSettings.reasoning_effort }
                  : {}),
              })
            }

            if (
              !shouldRunToolChooser(
                availableTools.length,
                normalizedSettings.tool_chooser_min_tools,
              )
            ) {
              return buildChatCompletionResult('SimpleCompletion', {
                allowedTools: availableTools,
                llmTools: normalizedSettings.nativeToolCalling,
                prompts: messagePromptAugmentations.prompts,
                prompt_injections: messagePromptAugmentations.promptInjections,
                ...(normalizedSettings.reasoning_effort
                  ? { reasoning_effort: normalizedSettings.reasoning_effort }
                  : {}),
              })
            }

            return makeTaskResult([
              // TODO: replace this static shortlist prompt with a dedicated tool-search tool once
              // Taskyon has enough tools that shortlist prompting becomes too expensive or tool limits matter.
              createChatCompletionTask({
                goal: 'AnalyzeToolResult',
                prompts: [buildToolShortlistPrompt(toolCatalog)],
                llmTools: true,
                schema: buildToolShortlistSchema(normalizedSettings.tool_shortlist_reasoning),
                reasoning_effort: 'low',
                use_multimodal: normalizedSettings.use_multimodal,
              }),
              // Re-enter after the shortlist completion.
              // The next entryNode run will see the structured shortlist as previousTask.
              toolCall({
                name: config.name ?? 'entryNode',
                arguments: toEntryNodeArguments(normalizedSettings, toolResultSection),
              }),
            ])
          },
        )
        .with({ mode: 'structured', shortlistResult: { type: 'none' } }, () =>
          buildChatCompletionResult('SimpleCompletion', {
            allowedTools,
            llmTools: normalizedSettings.nativeToolCalling,
            prompts: promptAugmentations.prompts,
            prompt_injections: promptAugmentations.promptInjections,
            ...(normalizedSettings.reasoning_effort
              ? { reasoning_effort: normalizedSettings.reasoning_effort }
              : {}),
          }),
        )
        .with(
          { mode: 'structured', shortlistResult: { type: 'tools', tools: P.select() } },
          (tools) => {
            const narrowedPromptAugmentations = buildEntryNodePromptAugmentations({
              mode: 'message',
              prompt:
                'Use exactly one of the allowed tools when needed to answer the previous user request. Emit the tool call instead of answering from memory.',
              previousTask,
              templates: normalizedSettings.prompt_templates,
              useBasePrompt: normalizedSettings.use_baseprompt,
              llmTools: normalizedSettings.nativeToolCalling,
              allowedTools: tools,
            })

            return makeTaskResult([
              createChatCompletionTask({
                goal: 'ChooseTool',
                prompts: narrowedPromptAugmentations.prompts,
                prompt_injections: narrowedPromptAugmentations.promptInjections,
                allowedTools: tools,
                llmTools: normalizedSettings.nativeToolCalling,
                ...(normalizedSettings.reasoning_effort
                  ? { reasoning_effort: normalizedSettings.reasoning_effort }
                  : {}),
                use_multimodal: normalizedSettings.use_multimodal,
              }),
            ])
          },
        )
        .with({ mode: 'message' }, async () => {
          const { availableTools } = await resolveAvailableToolsForMessage()
          const messagePromptAugmentations = buildEntryNodePromptAugmentations({
            mode,
            prompt,
            previousTask,
            templates: normalizedSettings.prompt_templates,
            useBasePrompt: normalizedSettings.use_baseprompt,
            llmTools: normalizedSettings.nativeToolCalling,
            allowedTools: availableTools,
          })
          return buildChatCompletionResult('SimpleCompletion', {
            allowedTools: availableTools,
            llmTools: normalizedSettings.nativeToolCalling,
            prompts: messagePromptAugmentations.prompts,
            prompt_injections: messagePromptAugmentations.promptInjections,
            ...(normalizedSettings.reasoning_effort
              ? { reasoning_effort: normalizedSettings.reasoning_effort }
              : {}),
          })
        })
        .with({ mode: P.union('toolresult', 'error', 'fallback', 'structured') }, () =>
          buildChatCompletionResult('AnalyzeToolResult', {
            allowedTools,
            llmTools: normalizedSettings.nativeToolCalling,
            prompts: promptAugmentations.prompts,
            prompt_injections: promptAugmentations.promptInjections,
            ...(normalizedSettings.reasoning_effort
              ? { reasoning_effort: normalizedSettings.reasoning_effort }
              : {}),
          }),
        )
        .otherwise(() => {
          return makeTaskResult([
            createChatCompletionTask({
              goal: 'AnalyzeToolResult',
              allowedTools,
              prompts: promptAugmentations.prompts,
              prompt_injections: promptAugmentations.promptInjections,
              llmTools: normalizedSettings.nativeToolCalling,
              ...(normalizedSettings.reasoning_effort
                ? { reasoning_effort: normalizedSettings.reasoning_effort }
                : {}),
              use_multimodal: normalizedSettings.use_multimodal,
            }),
          ])
        })
    },
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
