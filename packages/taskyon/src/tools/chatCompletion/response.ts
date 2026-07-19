import type { AssistantModelMessage, ModelMessage, ToolCallPart, ToolModelMessage } from 'ai'
import { load } from 'js-yaml'
import {
  compileTaskyonFunctionArguments,
  compileTaskyonMessageString,
  type createTaskVariablePresentationService,
  sanitizeTaskyonVariableCommentsOutsideCode,
} from '../../core/taskVariables'
import type { TaskNodeMeta } from '../../types/chatCompletion'
import type { Annotation } from '../../types/taskNode'
import type { ToolBase } from '../../types/tools'
import { FunctionArguments, FunctionCall } from '../../types/tools'
import { createDeepTransformer, normalizeFalsyValues, pickProperties } from '../../utils/objHelpers'

export const parseStructuredResponse = (message: string) => {
  let yamlContent = message.trim()
  const yamlMatch = /```(?:yaml|YAML|[^\n]*)\n?([\s\S]*?)\n?```/.exec(yamlContent)
  if (yamlMatch?.[1]) yamlContent = yamlMatch[1]

  try {
    return load(yamlContent)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error)
    throw new Error(
      `Not able to convert the response to yaml:

We got:

${message}

and the Error:

${errorMessage}
`,
      {
        cause: {
          yamlString: yamlContent,
          error,
        },
      },
    )
  }
}

const extractTaggedToolCall = (message: string) => {
  const toolName = /<tool_call>\s*([^<\s][^<]*)\s*/i.exec(message)?.[1]?.trim()
  if (!toolName) return

  const args: FunctionArguments = {}
  const argumentPattern =
    /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi

  let match = argumentPattern.exec(message)
  while (match) {
    const key = match[1]?.trim()
    if (key) args[key] = match[2]?.trim() ?? ''
    match = argumentPattern.exec(message)
  }

  return { name: toolName, arguments: args }
}

const createTaggedToolCallId = (input: string) => {
  const normalized = input.slice(0, 64)
  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0
  }
  return `tagged-${hash.toString(36)}`
}

export const normalizeAssistantMessageForToolCall = (
  message: AssistantModelMessage | ToolModelMessage,
  availableTools: Record<string, ToolBase>,
) => {
  if (message.role !== 'assistant') return message

  const taggedToolCall =
    typeof message.content === 'string'
      ? extractTaggedToolCall(message.content)
      : (() => {
          if (
            message.content.some(
              (part): boolean => typeof part !== 'string' && part.type === 'tool-call',
            )
          ) {
            return
          }
          const textPart = message.content.find(
            (part): part is { type: 'text'; text: string } =>
              typeof part !== 'string' && part.type === 'text',
          )
          return textPart ? extractTaggedToolCall(textPart.text) : undefined
        })()

  if (!taggedToolCall || !availableTools[taggedToolCall.name]) return message
  const sourceText =
    typeof message.content === 'string'
      ? message.content
      : (message.content.find(
          (part): part is { type: 'text'; text: string } =>
            typeof part !== 'string' && part.type === 'text',
        )?.text ?? '')

  const normalizedMessage: AssistantModelMessage = {
    role: 'assistant',
    content: [
      {
        type: 'tool-call',
        toolCallId: createTaggedToolCallId(sourceText),
        toolName: taggedToolCall.name,
        input: taggedToolCall.arguments,
      },
    ],
  }
  return normalizedMessage
}

export const convertFunctionCall = (
  content: ToolCallPart,
  tools: Record<string, ToolBase>,
  variableService?: ReturnType<typeof createTaskVariablePresentationService>,
) => {
  let argumentsValue: FunctionArguments = {}
  try {
    argumentsValue = FunctionArguments.parse(content.input)
  } catch (error) {
    console.warn('Failed to parse arguments as JSON:', error)
  }

  const functionCall: FunctionCall = {
    name: content.toolName,
    arguments: variableService
      ? compileTaskyonFunctionArguments(argumentsValue, variableService)
      : argumentsValue,
  }
  return tools[functionCall.name] ? functionCall : undefined
}

export const interpretAssistantMessage = (
  sources: Annotation[],
  message: ModelMessage,
  useProviderToolCalling: boolean,
  availableTools: Record<string, ToolBase>,
  variableService: ReturnType<typeof createTaskVariablePresentationService>,
) => {
  if (!Array.isArray(message.content)) return { kind: 'empty' as const, sanitation: [] }

  const toolCallParts = message.content.filter(
    (content): content is ToolCallPart =>
      typeof content !== 'string' && content.type === 'tool-call',
  )
  const calls = toolCallParts
    .map((content) => convertFunctionCall(content, availableTools, variableService))
    .filter((call): call is FunctionCall => call !== undefined)

  if (useProviderToolCalling && toolCallParts.length > 0) {
    return calls.length > 0
      ? { kind: 'tool-calls' as const, calls, sanitation: [] }
      : { kind: 'empty' as const, sanitation: [] }
  }

  const sanitation: NonNullable<TaskNodeMeta['assistantOutputSanitation']>[] = []
  const answers = message.content.flatMap((content) => {
    if (typeof content === 'string' || content.type !== 'text' || !content.text) return []

    const sanitized = sanitizeTaskyonVariableCommentsOutsideCode(content.text)
    if (sanitized.removedComments.length > 0) {
      console.warn('Removed Taskyon variable comments from assistant output.', {
        original: content.text,
        sanitized: sanitized.sanitized,
        removedComments: sanitized.removedComments,
      })
      sanitation.push({
        rawIncomingMessage: content.text,
        sanitizedMessage: sanitized.sanitized,
        removedComments: sanitized.removedComments,
      })
    }

    return [
      {
        content: compileTaskyonMessageString(sanitized.sanitized, variableService, {
          preserveUnknownPlaceholders: true,
        }),
      },
    ]
  })

  if (answers.length === 0) {
    return calls.length > 0
      ? { kind: 'tool-calls' as const, calls, sanitation }
      : { kind: 'empty' as const, sanitation }
  }

  return {
    kind: 'answers' as const,
    answers: answers.map((answer, index) => ({
      ...answer,
      ...(index === 0 && sources.length > 0 ? { annotations: sources } : {}),
    })),
    sanitation,
  }
}

const robustKeys = createDeepTransformer({
  keyFn: (key) =>
    String(key)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ''),
})

export function getCommandFromStructuredResponse(
  message: string,
  variableService?: ReturnType<typeof createTaskVariablePresentationService>,
) {
  const structuredResponse = parseStructuredResponse(message || '')
  if (
    !structuredResponse ||
    typeof structuredResponse !== 'object' ||
    Array.isArray(structuredResponse)
  ) {
    return []
  }

  const normalizedResponse = normalizeFalsyValues()(structuredResponse)
  const lowerStructuredResponse = robustKeys(normalizedResponse) as Record<string, string | boolean>
  const hasUseToolKey = 'usetool' in lowerStructuredResponse
  const useTool = Boolean(lowerStructuredResponse['usetool'])
  const doWeHaveToUseTool = Boolean(lowerStructuredResponse['dowehavetouseatool'])
  const whichTool = lowerStructuredResponse['whichtool']
  const tryAgain = Boolean(lowerStructuredResponse['tryagain'])
  const command = 'command' in structuredResponse ? structuredResponse.command : undefined

  let parsed = FunctionCall.safeParse(command)
  if (!parsed.success) parsed = FunctionCall.safeParse(lowerStructuredResponse.command)

  if (
    (!hasUseToolKey && doWeHaveToUseTool && parsed.success && parsed.data.name === whichTool) ||
    useTool ||
    (tryAgain && useTool) ||
    (doWeHaveToUseTool && tryAgain) ||
    (doWeHaveToUseTool && useTool)
  ) {
    if (parsed.success) {
      return [
        variableService
          ? {
              ...parsed.data,
              arguments: compileTaskyonFunctionArguments(parsed.data.arguments, variableService),
            }
          : parsed.data,
      ]
    }

    throw new Error(
      `The response (${JSON.stringify(
        pickProperties(structuredResponse, ['use tool', 'try again']),
      )}) suggests we should use a tool, but we could not parse the ${JSON.stringify(
        command,
      )} property correctly.`,
    )
  }
  return []
}
