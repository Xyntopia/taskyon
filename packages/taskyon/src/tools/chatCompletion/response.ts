import type {
  AssistantModelMessage,
  ModelMessage,
  streamText,
  ToolCallPart,
  ToolModelMessage,
} from 'ai'
import Ajv, { type SchemaObject } from 'ajv'
import { load } from 'js-yaml'
import type { JSONSchema7 } from 'json-schema'
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
import {
  createDeepTransformer,
  normalizeFalsyValues,
  pickProperties,
  serializeForJson,
} from '../../utils/objHelpers'
import { augmentToolSchemaForTaskyonVariables } from './context'

type ProviderSource = Awaited<ReturnType<typeof streamText>['sources']>[number]

const getOpenRouterSourceContent = (source: ProviderSource) => {
  const content = source.providerMetadata?.openrouter?.content
  return typeof content === 'string' ? content : undefined
}

export const convertProviderSourceToAnnotation = (source: ProviderSource): Annotation => {
  const providerContent = getOpenRouterSourceContent(source)
  if (source.sourceType === 'url') {
    return {
      type: 'url',
      id: source.id,
      title: source.title,
      url: source.url,
      ...(providerContent ? { content: providerContent } : {}),
    }
  }

  return {
    type: 'document',
    id: source.id,
    title: source.title,
    filename: source.filename,
    mediaType: source.mediaType,
    ...(providerContent ? { content: providerContent } : {}),
  }
}

const parseLeadingJsonDocument = (value: string) => {
  const start = value.search(/\S/)
  if (start < 0 || !['{', '['].includes(value[start] ?? '')) return undefined

  const closing = new Map([
    ['{', '}'],
    ['[', ']'],
  ])
  const expectedClosings: string[] = []
  let insideString = false
  let escaped = false

  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (character === undefined) continue
    if (insideString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') insideString = false
      continue
    }
    if (character === '"') insideString = true
    else if (closing.has(character)) expectedClosings.push(closing.get(character) ?? '')
    else if (character === '}' || character === ']') {
      if (expectedClosings.pop() !== character) return undefined
      if (expectedClosings.length === 0) {
        return {
          document: value.slice(start, index + 1),
          trailingText: value.slice(index + 1).trim(),
        }
      }
    }
  }
  return undefined
}

const structuredResponseParseError = (message: string, content: string, error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : JSON.stringify(error)
  return new Error(
    `Not able to convert the response to yaml:

We got:

${message}

and the Error:

${errorMessage}
`,
    { cause: { yamlString: content, error } },
  )
}

export const parseStructuredResponseWithTrailingText = (
  message: string,
): { data: unknown; trailingText?: string } => {
  const fence = /```(?:yaml|YAML|json|JSON|[^\n]*)\n?([\s\S]*?)\n?```/.exec(message)
  const content = (fence?.[1] ?? message).trim()
  const surroundingText = fence
    ? [message.slice(0, fence.index), message.slice(fence.index + fence[0].length)]
        .map((value) => value.trim())
        .filter(Boolean)
    : []

  try {
    const data = load(content)
    const trailingText = surroundingText.join('\n\n')
    return { data, ...(trailingText ? { trailingText } : {}) }
  } catch (yamlError) {
    const json = parseLeadingJsonDocument(content)
    if (!json) throw structuredResponseParseError(message, content, yamlError)
    try {
      const data = JSON.parse(json.document) as unknown
      const trailingText = [...surroundingText, json.trailingText].filter(Boolean).join('\n\n')
      return { data, ...(trailingText ? { trailingText } : {}) }
    } catch (jsonError) {
      throw structuredResponseParseError(message, content, jsonError)
    }
  }
}

export const parseStructuredResponse = (message: string) => {
  const parsed = parseStructuredResponseWithTrailingText(message)
  if (parsed.trailingText) {
    throw structuredResponseParseError(
      message,
      message.trim(),
      new Error('Unexpected text followed the structured response.'),
    )
  }
  return parsed.data
}

export const validateStructuredResponse = (data: unknown, schema: JSONSchema7) => {
  const ajv = new Ajv()
  // JSONSchema7 allows explicitly undefined optional fields; Ajv's exact-optional schema type does not.
  const validate = ajv.compile(schema as SchemaObject)
  if (validate(data)) return data

  const errors = validate.errors ?? []
  // Keep provider extras intact while enforcing all other schema constraints.
  if (errors.length > 0 && errors.every((error) => error.keyword === 'additionalProperties')) {
    return data
  }
  throw new Error('Chat response has the wrong format: ' + ajv.errorsText(errors), {
    cause: { validationErrors: errors },
  })
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

const createToolArgumentsValidationError = (content: ToolCallPart, validationErrors: unknown) => {
  const error = new Error(`Invalid arguments for tool "${content.toolName}".`)
  error.name = 'ToolArgumentsValidationError'
  Object.assign(error, {
    toolName: content.toolName,
    validationErrors: serializeForJson(validationErrors),
    receivedArguments: serializeForJson(content.input),
  })
  return error
}

const normalizeProviderToolArguments = (input: unknown) => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input
  return Object.fromEntries(Object.entries(input).filter(([key]) => key.trim().length > 0))
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
  const tool = tools[content.toolName]
  if (!tool) return undefined

  const parsedArguments = FunctionArguments.safeParse(normalizeProviderToolArguments(content.input))
  if (!parsedArguments.success) {
    throw createToolArgumentsValidationError(content, parsedArguments.error.issues)
  }

  const ajv = new Ajv()
  const validate = ajv.compile(augmentToolSchemaForTaskyonVariables(tool.parameters) as object)
  if (!validate(parsedArguments.data)) {
    throw createToolArgumentsValidationError(content, validate.errors)
  }

  const functionCall: FunctionCall = {
    name: content.toolName,
    arguments: variableService
      ? compileTaskyonFunctionArguments(parsedArguments.data, variableService)
      : parsedArguments.data,
  }
  return functionCall
}

export const interpretAssistantMessage = (
  sources: Annotation[],
  message: ModelMessage,
  useProviderToolCalling: boolean,
  availableTools: Record<string, ToolBase>,
  variableService: ReturnType<typeof createTaskVariablePresentationService>,
  webSearchPerformed = false,
) => {
  if (!Array.isArray(message.content)) return { kind: 'empty' as const, sanitation: [] }

  const toolCallParts = message.content.filter(
    (content): content is ToolCallPart =>
      typeof content !== 'string' && content.type === 'tool-call',
  )
  const calls = toolCallParts
    .map((content) => convertFunctionCall(content, availableTools, variableService))
    .filter((call): call is FunctionCall => call !== undefined)

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
    const searchObservation =
      sources.length > 0
        ? { content: '', annotations: sources }
        : webSearchPerformed
          ? { content: 'Hosted web search activity was reported.' }
          : undefined
    if (calls.length > 0) {
      return {
        kind: 'tool-calls' as const,
        calls,
        ...(searchObservation ? { assistantMessages: [searchObservation] } : {}),
        sanitation,
      }
    }
    return searchObservation
      ? { kind: 'answers' as const, answers: [searchObservation], sanitation }
      : { kind: 'empty' as const, sanitation }
  }

  if (useProviderToolCalling && calls.length > 0) {
    return {
      kind: 'tool-calls' as const,
      calls,
      assistantMessages: [
        ...(webSearchPerformed && sources.length === 0
          ? [{ content: 'Hosted web search activity was reported.' }]
          : []),
        ...answers.map((answer, index) => ({
          ...answer,
          ...(index === 0 && sources.length > 0 ? { annotations: sources } : {}),
        })),
      ],
      sanitation,
    }
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
