import type { ModelMessage, streamText, SystemModelMessage, ToolChoice, ToolSet } from 'ai'
import { jsonSchema, Output } from 'ai'
import type OpenAI from 'openai'
import type { apiConfig } from '../../types/chatCompletion'

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

const messageContentForPromptCacheKey = (message: ModelMessage | undefined) => {
  if (!message) return ''
  if (typeof message.content === 'string') return message.content
  try {
    return JSON.stringify(message.content)
  } catch {
    return ''
  }
}

const buildPromptCacheKey = (messages: ModelMessage[], selectedModel: string) => {
  const firstUserMessage = messages.find((message) => message.role === 'user')
  const seed = `${selectedModel}\n${messageContentForPromptCacheKey(firstUserMessage).slice(0, 8_000)}`
  return `taskyon-${hashStringForPromptCacheKey(seed)}`
}

const hasNonSystemMessages = (messages: ModelMessage[]) =>
  messages.some((message) => message.role !== 'system')

export const buildChatProviderRequest = async (input: {
  messages: ModelMessage[]
  tools: ToolSet
  selectedModel: string
  api: apiConfig
  apiKey: string
  schema?: Record<string, unknown>
  siteUrl?: string
  webSearch?: {
    maxResults: number
    searchContextSize: 'low' | 'high' | 'medium'
  }
  reasoningEffort?: 'low' | 'high' | 'medium' | 'none'
  verbosity?: OpenAI.ChatCompletionCreateParams['verbosity']
  toolChoice?: ToolChoice<ToolSet>
}) => {
  console.log('Creating chat completion request', {
    siteUrl: input.siteUrl,
    webSearch: input.webSearch,
    reasoning_effort: input.reasoningEffort,
    verbosity: input.verbosity,
  })

  let model
  let requestMessages = input.messages
  const overrideOptions: Record<string, unknown> = {}

  switch (input.api.name) {
    case 'openai':
    case 'chatgpt-codex': {
      const { createOpenAI } = await import('@ai-sdk/openai')
      const openai = createOpenAI({
        apiKey: input.apiKey,
        ...(input.api.defaultHeaders ? { headers: input.api.defaultHeaders } : {}),
        ...(input.api.name === 'chatgpt-codex' ? { baseURL: input.api.baseURL } : {}),
      })
      model = openai(input.selectedModel)

      const reasoningEffort = input.selectedModel.includes('gpt-5')
        ? ({ none: 'none', low: 'low', medium: 'medium', high: 'high' }[
            input.reasoningEffort ?? 'none'
          ] ?? null)
        : null
      overrideOptions.providerOptions = {
        openai: {
          reasoningEffort,
          reasoningSummary: 'auto',
          ...(input.api.name === 'chatgpt-codex'
            ? (() => {
                const split = extractLeadingSystemMessagesForProviderInstructions(input.messages)
                requestMessages = split.messages
                return {
                  instructions: split.instructions,
                  promptCacheKey: buildPromptCacheKey(requestMessages, input.selectedModel),
                  ...(hasNonSystemMessages(requestMessages)
                    ? { systemMessageMode: 'developer' as const }
                    : {}),
                  store: false,
                }
              })()
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
        if (!init?.headers) return fetch(requestInput, init)
        const headers = new Headers(init.headers)
        headers.delete('user-agent')
        headers.delete('User-Agent')
        return fetch(requestInput, { ...init, headers })
      }
      const openrouter = createOpenRouter({
        apiKey: input.apiKey,
        ...(input.api.name === 'taskyon'
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
