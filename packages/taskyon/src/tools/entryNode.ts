import { createChatCompletionTask } from '../api'
import { createTool, makeTaskResult, toolCall } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import type { JSONSchema7 } from '../utils/jsonSchema'

type EntryNodeMode = 'message' | 'toolresult' | 'error' | 'fallback'

type EntryNodeConfig = {
  name?: string
  renderOptions?: { hideChat?: boolean; hideLlm?: boolean }
  defaultAllowedTools?: string[]
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

export const EntryNodePromptTemplates = {
  basePrompt:
    'You are a helpful assistant called Taskyon. Return concise and correct Markdown answers.',
  instruction:
    'Complete the task accurately. If structured output is requested, follow the required format exactly.',
  toolResult: 'Evaluate the following tool result and respond in {format}:\n\n{message}',
  task: 'Complete this task:\n\n{message}',
  evaluate: 'Evaluate this message and respond in {format}:\n\n{message}',
  schemaReminder:
    'Output must strictly match {format} and this schema:\n\n{schema}\n\nDo not add extra text.',
  tools: 'Available tools:\n\n${tools}',
} as const

export const EntryNodeSettingsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    use_baseprompt: {
      type: 'boolean',
      default: true,
      description:
        'Enable base system prompting for assistant style and formatting when calling chatCompletion.',
    },
    llmTools: {
      type: 'boolean',
      default: true,
      description:
        'Enable native LLM tool calling during chatCompletion. Disable to prefer Taskyon DIY function-calling.',
    },
    nativeToolCalling: {
      type: 'boolean',
      default: true,
      description: 'Alias for llmTools. If set, this value takes precedence over llmTools.',
    },
    reasoning_effort: {
      enum: ['low', 'medium', 'high', 'none'],
      description: 'Reasoning effort forwarded to chatCompletion.',
    },
    use_multimodal: {
      type: 'boolean',
      description: 'Allow multimodal model input handling.',
      default: true,
    },
    websearch: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean', default: false },
        max_results: { type: 'integer', default: 5 },
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

type EntryNodeArgs = {
  toolResultSection?: string
  use_baseprompt?: boolean
  llmTools?: boolean
  nativeToolCalling?: boolean
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
  if (previousTask.content.type === 'message' && previousTask.role === 'user') return 'message'
  return 'fallback'
}

type StandardEntryNodeOptions = {
  name: string
  renderOptions: { hideChat?: boolean; hideLlm?: boolean }
  defaultAllowedTools: string[]
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

const shouldUseToolChooser = (
  mode: EntryNodeMode,
  toolChooser: EntryNodeConfig['toolChooser'],
): boolean => {
  if (!toolChooser?.enabled) return false
  return mode !== 'error'
}

export const createEntryNodeToolFactory = (config: EntryNodeConfig) =>
  createTool({
    name: config.name ?? 'entryNode',
    description: 'Task entry router that decides how to continue based on the previous task.',
    parameters: EntryNodeParameters,
    renderOptions: config.renderOptions ?? { hideChat: true, hideLlm: true },
    function: ({ toolResultSection, ...settings }: EntryNodeArgs = {}, context) => {
      const previousTask = context.taskChain.at(-2)
      const mode = resolveMode(previousTask)
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
      if (config.toolChooser?.enabled && shouldUseToolChooser(mode, config.toolChooser)) {
        return makeTaskResult([
          toolCall({
            name: 'chooseTool',
            arguments: {
              useTools: config.toolChooser.useTools ?? true,
              ...(config.toolChooser.webSearch ? { webSearch: true } : {}),
            },
          }),
        ])
      }

      const promptTemplates = {
        ...EntryNodePromptTemplates,
        ...(settings.prompt_templates ?? {}),
      }
      const llmTools = settings.nativeToolCalling ?? settings.llmTools ?? true
      const webSearchEnabled = settings.websearch?.enabled ?? false
      const nextGoal = webSearchEnabled ? 'WebSearch' : 'AnalyzeToolResult'
      return makeTaskResult([
        createChatCompletionTask({
          goal: nextGoal,
          allowedTools,
          prompts: [prompt],
          llmTools,
          ...(settings.reasoning_effort ? { reasoning_effort: settings.reasoning_effort } : {}),
          ...(settings.use_multimodal !== undefined
            ? { use_multimodal: settings.use_multimodal }
            : {}),
          ...(settings.use_baseprompt !== undefined
            ? { use_baseprompt: settings.use_baseprompt }
            : {}),
          ...(webSearchEnabled
            ? {
                max_results: settings.websearch?.max_results ?? 5,
              }
            : {}),
          prompt_templates: promptTemplates,
        }),
      ])
    },
  })

export const createStandardEntryNodeTool = (options: StandardEntryNodeOptions) =>
  createEntryNodeToolFactory({
    ...options,
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
