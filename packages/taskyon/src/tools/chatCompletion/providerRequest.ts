import type { ModelMessage, streamText, SystemModelMessage, ToolChoice, ToolSet } from 'ai'
import { jsonSchema, Output } from 'ai'
import type OpenAI from 'openai'
import type { JSONSchema7, JSONSchema7Definition } from 'json-schema'
import type {
  ChatCompletionProviderSettings,
  ProviderRequestTrace,
} from '../../types/chatCompletion'
import { createChatCompletionRecordingFetch } from '../chatCompletionTrace'

const collectSystemInstructions = (messages: ModelMessage[]) => {
  const instructions = messages
    .filter((message): message is SystemModelMessage => message.role === 'system')
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0)
    .join('\n\n')
    .trim()

  return instructions.length > 0 ? instructions : undefined
}

const extractLeadingSystemMessagesForProviderInstructions = (messages: ModelMessage[]) => {
  const leadingSystemMessages: SystemModelMessage[] = []
  const remainingMessages: ModelMessage[] = []
  let sawNonSystemMessage = false

  for (const message of messages) {
    if (!sawNonSystemMessage && message.role === 'system') {
      leadingSystemMessages.push(message)
      continue
    }
    sawNonSystemMessage = true
    remainingMessages.push(message)
  }

  return {
    instructions: collectSystemInstructions(leadingSystemMessages),
    messages: remainingMessages,
  }
}

const hashStringForPromptCacheKey = (value: string) => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

const promptCacheNamespacePart = (value: string) =>
  /^[a-zA-Z0-9._-]+$/.test(value) && value.length <= 80 ? value : hashStringForPromptCacheKey(value)

const buildPromptCacheKey = (provider: string, selectedModel: string, rootTaskId: string) => {
  const cacheKey = ['taskyon', provider, selectedModel, rootTaskId]
    .map(promptCacheNamespacePart)
    .join('-')
  return cacheKey.length <= 64 ? cacheKey : `taskyon-${hashStringForPromptCacheKey(cacheKey)}`
}

const withOpenAIPromptCacheBreakpoints = (messages: ModelMessage[]) => {
  const eligibleIndexes = messages.flatMap((message, index) =>
    message.role === 'user' || message.role === 'assistant' ? [index] : [],
  )
  const rootIndex = eligibleIndexes[0]
  const recentIndexes = eligibleIndexes.filter((index) => index !== rootIndex).slice(-3)
  const breakpointIndexes = new Set([
    ...(rootIndex === undefined ? [] : [rootIndex]),
    ...recentIndexes,
  ])

  return messages.map((message, index) =>
    breakpointIndexes.has(index)
      ? {
          ...message,
          providerOptions: {
            ...message.providerOptions,
            openai: {
              ...message.providerOptions?.openai,
              promptCacheBreakpoint: true,
            },
          },
        }
      : message,
  )
}

const hasNonSystemMessages = (messages: ModelMessage[]) =>
  messages.some((message) => message.role !== 'system')

type JsonSchemaObject = JSONSchema7 & Record<string, unknown>
type JsonSchemaMap = Record<string, JSONSchema7Definition>

const isJsonSchemaObject = (value: unknown): value is JsonSchemaObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeSchemaMap = (value: unknown): JsonSchemaMap | undefined => {
  if (!isJsonSchemaObject(value)) return undefined
  const entries = Object.entries(value).map(([name, schema]) => {
    const normalized = normalizeNativeStructuredOutputSchema(schema)
    return normalized ? ([name, normalized] as const) : undefined
  })
  if (entries.some((entry) => entry === undefined)) return undefined
  return Object.fromEntries(entries.filter((entry) => entry !== undefined))
}

const normalizeSchemaList = (value: unknown): JsonSchemaObject[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const schemas = value.map(normalizeNativeStructuredOutputSchema)
  return schemas.every((schema): schema is JsonSchemaObject => schema !== undefined)
    ? schemas
    : undefined
}

/**
 * Closes compatible object schemas for providers that enforce strict structured output.
 * Schemas with maps or optional object properties remain prompt-enforced so their contract is
 * not silently narrowed at the provider boundary.
 */
export const normalizeNativeStructuredOutputSchema = (
  value: unknown,
): JsonSchemaObject | undefined => {
  if (!isJsonSchemaObject(value)) return undefined
  const normalized: JsonSchemaObject = { ...value }
  const properties =
    value.properties === undefined ? undefined : normalizeSchemaMap(value.properties)
  if (value.properties !== undefined && !properties) return undefined
  if (properties) normalized.properties = properties

  const objectBoundary = value.type === 'object' || properties !== undefined
  if (objectBoundary) {
    if (value.additionalProperties !== undefined && value.additionalProperties !== false) {
      return undefined
    }
    const propertyNames = Object.keys(properties ?? {})
    const required = Array.isArray(value.required)
      ? value.required.filter((name): name is string => typeof name === 'string')
      : []
    if (propertyNames.some((name) => !required.includes(name))) return undefined
    normalized.additionalProperties = false
  }

  for (const keyword of ['items', 'contains', 'not', 'if', 'then', 'else'] as const) {
    if (value[keyword] === undefined) continue
    const child = normalizeNativeStructuredOutputSchema(value[keyword])
    if (!child) return undefined
    normalized[keyword] = child
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const) {
    if (value[keyword] === undefined) continue
    const children = normalizeSchemaList(value[keyword])
    if (!children) return undefined
    normalized[keyword] = children
  }
  for (const keyword of ['$defs', 'definitions', 'patternProperties'] as const) {
    if (value[keyword] === undefined) continue
    const children = normalizeSchemaMap(value[keyword])
    if (!children) return undefined
    normalized[keyword] = children
  }
  return normalized
}

export const buildChatProviderRequest = async (input: {
  messages: ModelMessage[]
  tools: ToolSet
  selectedModel: string
  api: ChatCompletionProviderSettings
  apiKey: string
  schema?: Record<string, unknown>
  webSearch?: {
    maxResults: number
    searchContextSize: 'low' | 'high' | 'medium'
  }
  reasoningEffort?: 'low' | 'high' | 'medium' | 'none'
  verbosity?: OpenAI.ChatCompletionCreateParams['verbosity']
  toolChoice?: ToolChoice<ToolSet>
  providerRequest?: ProviderRequestTrace
  promptCacheRootId?: string
}) => {
  console.log('Creating chat completion request', {
    webSearch: input.webSearch,
    reasoning_effort: input.reasoningEffort,
    verbosity: input.verbosity,
  })

  let model
  let requestMessages = input.messages
  const overrideOptions: Record<string, unknown> = {}
  const recordingFetch = input.providerRequest
    ? createChatCompletionRecordingFetch(input.providerRequest, fetch)
    : undefined
  const requestHeaders = input.api.provider === 'taskyon' ? undefined : input.api.defaultHeaders

  switch (input.api.provider) {
    case 'openai':
    case 'chatgpt-codex': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const openai = createOpenAI({
        apiKey: input.apiKey,
        ...(requestHeaders ? { headers: requestHeaders } : {}),
        ...(recordingFetch ? { fetch: recordingFetch } : {}),
        ...(input.api.provider === 'chatgpt-codex' ? { baseURL: input.api.baseURL } : {}),
      })
      model = openai(input.selectedModel)
      const usesExplicitPromptCaching =
        input.api.provider === 'openai' && input.selectedModel.includes('gpt-5.6')
      if (usesExplicitPromptCaching) {
        requestMessages = withOpenAIPromptCacheBreakpoints(requestMessages)
      }

      const reasoningEffort = input.selectedModel.includes('gpt-5')
        ? ({ none: 'none', low: 'low', medium: 'medium', high: 'high' }[
            input.reasoningEffort ?? 'none'
          ] ?? null)
        : null
      overrideOptions.providerOptions = {
        openai: {
          reasoningEffort,
          reasoningSummary: 'auto',
          ...(input.api.provider === 'chatgpt-codex'
            ? (() => {
                const split = extractLeadingSystemMessagesForProviderInstructions(requestMessages)
                requestMessages = split.messages
                return {
                  instructions: split.instructions,
                  ...(hasNonSystemMessages(requestMessages)
                    ? { systemMessageMode: 'developer' as const }
                    : {}),
                  store: false,
                }
              })()
            : {}),
          ...(input.promptCacheRootId
            ? {
                promptCacheKey: buildPromptCacheKey(
                  input.api.provider,
                  input.selectedModel,
                  input.promptCacheRootId,
                ),
              }
            : {}),
          ...(usesExplicitPromptCaching
            ? { promptCacheOptions: { mode: 'explicit' as const, ttl: '30m' as const } }
            : {}),
          parallelToolCalls: false,
        },
      }

      if (input.webSearch?.maxResults) {
        overrideOptions.tools = {
          ...input.tools,
          web_search: openai.tools.webSearch({
            externalWebAccess: true,
            searchContextSize: input.webSearch.searchContextSize,
          }),
        }
        overrideOptions.toolChoice = { type: 'tool', toolName: 'web_search' }
      }
      break
    }
    case 'taskyon':
    case 'openrouter.ai': {
      const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
      const stripUserAgentFetch: typeof fetch = (requestInput, init) => {
        if (!init?.headers) return (recordingFetch ?? fetch)(requestInput, init)
        const headers = new Headers(init.headers)
        headers.delete('user-agent')
        headers.delete('User-Agent')
        return (recordingFetch ?? fetch)(requestInput, { ...init, headers })
      }
      const openrouter = createOpenRouter({
        apiKey: input.apiKey,
        ...(requestHeaders ? { headers: requestHeaders } : {}),
        ...(input.api.provider === 'taskyon'
          ? { baseURL: input.api.baseURL + input.api.routes.chatCompletion }
          : {}),
        fetch: stripUserAgentFetch,
      })
      const options: Parameters<typeof openrouter>[1] = {
        provider: { ignore: ['GMICloud'] },
        usage: { include: true },
      }

      if (input.reasoningEffort && input.reasoningEffort !== 'none') {
        options.reasoning = {
          effort: input.reasoningEffort,
          exclude: false,
        }
      }

      if (input.webSearch?.maxResults) {
        options.plugins = [
          {
            id: 'web',
            engine: 'exa',
            max_results: input.webSearch.maxResults,
          },
          {
            id: 'file-parser',
            pdf: { engine: 'native' },
          },
        ]
        options.extraBody = {
          web_search_options: {
            engine: 'exa',
            search_context_size: input.webSearch.searchContextSize,
          },
        }
      }

      model = openrouter(input.selectedModel, options)
      break
    }
    default: {
      const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
      const openai = createOpenAICompatible({
        apiKey: input.apiKey,
        baseURL: input.api.baseURL + input.api.routes.chatCompletion,
        name: input.api.name,
        ...(requestHeaders ? { headers: requestHeaders } : {}),
        ...(recordingFetch ? { fetch: recordingFetch } : {}),
      })
      model = openai(input.selectedModel)
    }
  }

  const streamOptions: Parameters<typeof streamText>[0] = {
    model,
    messages: requestMessages,
    tools: input.tools,
    ...(input.toolChoice ? { toolChoice: input.toolChoice } : {}),
    ...overrideOptions,
  }

  if (input.schema) {
    streamOptions.output = Output.object({
      schema: jsonSchema(input.schema),
    })
  }

  return streamOptions
}
