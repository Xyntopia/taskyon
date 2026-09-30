import { serializeObject } from '@taskyon/common/modules/serializeObject'
import type { streamText as streamTextType } from 'ai'
import { APICallError, RetryError, smoothStream } from 'ai'
import type {
  ChatCompletionStreamChunk,
  ProviderWebSearchObservation,
} from '../../types/chatCompletion'
import { humanizeError } from '../../utils/error'

const normalizeChunkText = (value: unknown) => (typeof value === 'string' ? value : '')

const extractTextFromChunk = (chunk: ChatCompletionStreamChunk) => {
  const record: Record<string, unknown> = chunk
  if (record['type'] === 'text-delta') return normalizeChunkText(record['textDelta'])
  if (record['type'] === 'text') return normalizeChunkText(record['text'])
  if (typeof record['textDelta'] === 'string') return record['textDelta']
  if (typeof record['text'] === 'string') return record['text']
  return ''
}

export const cleanupRawStreamOutput = (rawOutput: string) => {
  if (!rawOutput) return ''
  return rawOutput
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/^data:\s*/, ''))
    .filter((line) => line && line !== '[DONE]')
    .join('\n')
    .trim()
}

const serializeRawChunkValue = (value: unknown) => {
  if (typeof value === 'string') return value
  if (value === undefined) return ''
  return serializeObject(value, {
    format: 'yaml',
    maxDepth: 4,
    maxArrayLength: 30,
    maxObjectKeys: 30,
    maxStringLength: 8_000,
    includeTruncationNotice: true,
  })
}

export const getProviderWebSearchObservation = (
  rawValue: unknown,
): ProviderWebSearchObservation | undefined => {
  if (typeof rawValue !== 'object' || rawValue === null || Array.isArray(rawValue)) return

  if (Reflect.get(rawValue, 'type') === 'response.web_search_call.completed') {
    return { performed: true }
  }
  const item = Reflect.get(rawValue, 'item')
  if (
    Reflect.get(rawValue, 'type') === 'response.output_item.done' &&
    typeof item === 'object' &&
    item !== null &&
    !Array.isArray(item) &&
    Reflect.get(item, 'type') === 'web_search_call' &&
    Reflect.get(item, 'status') === 'completed'
  ) {
    return { performed: true }
  }

  const usage = Reflect.get(rawValue, 'usage')
  if (typeof usage !== 'object' || usage === null || Array.isArray(usage)) return
  const counts = [
    ['server_tool_use', 'web_search_requests'],
    ['server_tool_use_details', 'web_search_requests'],
    ['web_search', 'num_requests'],
  ] as const
  const requestCounts = counts.flatMap(([key, countKey]) => {
    const value = Reflect.get(usage, key)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
    const requests = Reflect.get(value, countKey)
    return typeof requests === 'number' && Number.isInteger(requests) && requests > 0
      ? [requests]
      : []
  })
  return requestCounts.length > 0
    ? { performed: true, requests: Math.max(...requestCounts) }
    : undefined
}

const mergeProviderWebSearchObservation = (
  current: ProviderWebSearchObservation | undefined,
  incoming: ProviderWebSearchObservation | undefined,
): ProviderWebSearchObservation | undefined => {
  if (!incoming) return current
  const requests = Math.max(current?.requests ?? 0, incoming.requests ?? 0)
  return requests > 0 ? { performed: true, requests } : { performed: true }
}

export const classifyStreamingFailure = (error: unknown, aborted: boolean) => {
  const message = humanizeError(error).toLowerCase()
  if (
    aborted ||
    /(abort|aborted|cancel|canceled|interrupt|stopped by user|stop signal)/.test(message)
  ) {
    return {
      shortReason: 'interrupted',
      assistantPrefix: 'Generation was interrupted. Keeping the partial response below.',
      systemNote:
        'Chat completion was interrupted (likely user stop/abort signal). Partial assistant output was preserved.',
    }
  }
  if (/(timeout|timed out|deadline)/.test(message)) {
    return {
      shortReason: 'timed out',
      assistantPrefix: 'Generation timed out. Keeping the partial response below.',
      systemNote:
        'Chat completion timed out before finishing. Partial assistant output was preserved.',
    }
  }
  const providerError = RetryError.isInstance(error) ? error.lastError : error
  const sdkRetryable = APICallError.isInstance(providerError) && providerError.isRetryable
  if (
    sdkRetryable ||
    /(overloaded|temporarily unavailable|rate limit|rate-limited|429|503|server busy)/.test(message)
  ) {
    return {
      shortReason: 'transient provider failure',
      assistantPrefix:
        'Generation stopped because the provider was temporarily unavailable. Keeping the partial response below.',
      systemNote:
        'Chat completion hit a transient provider failure. Partial assistant output was preserved.',
    }
  }
  return {
    shortReason: 'failed',
    assistantPrefix: 'Generation ended early due to an error. Keeping the partial response below.',
    systemNote: 'Chat completion failed before finishing. Partial assistant output was preserved.',
  }
}

export type ChatCompletionStreamResult =
  | {
      ok: true
      completion: ReturnType<typeof streamTextType>
      response: Awaited<ReturnType<typeof streamTextType>['response']>
      rawOutput: string
      partialTextOutput: string
      providerWebSearch?: ProviderWebSearchObservation
    }
  | {
      ok: false
      completion: ReturnType<typeof streamTextType>
      error: unknown
      failure: ReturnType<typeof classifyStreamingFailure>
      rawOutput: string
      partialTextOutput: string
      providerWebSearch?: ProviderWebSearchObservation
    }

export const runChatCompletionStream = async (input: {
  streamText: typeof streamTextType
  streamOptions: Parameters<typeof streamTextType>[0]
  timeout: {
    totalMs: number
    stepMs: number
    chunkMs: number
  }
  useArtificialStreaming: boolean
  abortSignal?: AbortSignal
  onChunk: (chunk: ChatCompletionStreamChunk) => void
}): Promise<ChatCompletionStreamResult> => {
  let rawOutput = ''
  let partialTextOutput = ''
  let capturedError: unknown
  let providerWebSearch: ProviderWebSearchObservation | undefined

  const completion = input.streamText({
    timeout: input.timeout,
    includeRawChunks: true,
    onChunk({ chunk }) {
      input.onChunk(chunk)
      if (chunk.type === 'raw') {
        rawOutput += serializeRawChunkValue(chunk.rawValue)
        providerWebSearch = mergeProviderWebSearchObservation(
          providerWebSearch,
          getProviderWebSearchObservation(chunk.rawValue),
        )
      }
      partialTextOutput += extractTextFromChunk(chunk)
    },
    onError(error) {
      capturedError = error
      console.error('Error in chat completion stream:', error)
    },
    ...(input.useArtificialStreaming
      ? {
          experimental_transform: smoothStream({
            delayInMs: 5,
            chunking: 'line',
          }),
        }
      : {}),
    ...(input.abortSignal ? { abortSignal: input.abortSignal } : {}),
    ...input.streamOptions,
  })

  try {
    const finishReason = await completion.rawFinishReason
    console.log('chat completion finished because of', finishReason)
    const response = await completion.response
    console.log('chat completion response', response, await completion.output)
    return {
      ok: true as const,
      completion,
      response,
      rawOutput,
      partialTextOutput,
      ...(providerWebSearch ? { providerWebSearch } : {}),
    }
  } catch (error) {
    const effectiveError = capturedError ?? error
    return {
      ok: false as const,
      completion,
      error: effectiveError,
      failure: classifyStreamingFailure(effectiveError, input.abortSignal?.aborted ?? false),
      rawOutput,
      partialTextOutput,
      ...(providerWebSearch ? { providerWebSearch } : {}),
    }
  }
}
