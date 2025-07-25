import type { OpenRouterGenerationInfo, Model, llmSettings, OpenAIMessage } from './types'
import type OpenAI from 'openai'
import { sleep, asyncTimeLruCache } from '../utils'
import { ChatResponseType } from './types'
import { charHash } from '../crypto_webcrypto'

export function generateHeaders(apiSecret: string, siteUrl: string, selectedApi: string) {
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (apiSecret && !(selectedApi === 'taskyon' && apiSecret === 'anonymous')) {
    headers.Authorization = `Bearer ${apiSecret}`
  }

  if (selectedApi == 'openrouter.ai') {
    headers = {
      ...headers,
      'HTTP-Referer': `${siteUrl}`, // To identify your app. Can be set to localhost for testing
      'X-Title': `${siteUrl}`, // Optional. Shows on openrouter.ai
    }
  }

  return headers
}

export function accumulateStep(
  existing: OpenAI.ChatCompletion | ChatResponseType | undefined,
  chunk: OpenAI.ChatCompletionChunk,
): ChatResponseType {
  // ─── 1) init or clone ───────────────────────────────────
  const response: ChatResponseType = existing
    ? { ...existing }
    : {
        id: chunk.id,
        object: 'chat.completion',
        created: chunk.created,
        model: chunk.model,
        choices: [],
      }

  // ─── 2) overwrite top-level with latest chunk ───────────

  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    choices: [chunkChoice0, ..._rest],
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    object: _ignoreObject,
    ...meta
  } = chunk
  Object.assign(response, meta)

  if (chunkChoice0) {
    // ─── 3) grab our single choice and its delta ────────────
    const choice = response.choices[0]
      ? response.choices[0]
      : ({
          index: 0,
          message: {
            content: null,
            refusal: null,
            role: 'assistant',
            tool_calls: [],
          },
          finish_reason: 'cancelled',
          logprobs: null,
        } as ChatResponseType['choices'][0])
    const delta = chunkChoice0.delta

    // ─── 4) accumulate text + role + finish_reason/logprobs ─
    if (delta.content) {
      choice.message.content = (choice.message.content || '') + delta.content
    }
    if (delta.role) {
      choice.message.role = delta.role
    }

    if (chunkChoice0.finish_reason) {
      choice.finish_reason = chunkChoice0.finish_reason
    }
    if (chunkChoice0.logprobs) {
      choice.logprobs = chunkChoice0.logprobs
    }

    // ─── 5) accumulate any tool_calls ────────────────────────
    // rebuild a map from any existing tool_calls array
    const existingCalls = choice.message.tool_calls ?? []
    const toolCallsMap: Record<string, NonNullable<OpenAIMessage['tool_calls']>[0]> = {}
    // 5a) seed from existingCalls by their array index
    existingCalls.forEach((call, idx) => {
      toolCallsMap[idx] = call
    })
    // merge in new deltas
    for (const tc of delta.tool_calls || []) {
      const index = tc.index || 0
      // check if we had a tool call with this index before
      const entry = choice.message.tool_calls?.[index] ?? {
        index: 0,
        type: 'function',
        id: '',
        function: { name: '', arguments: '' },
      }
      // entry.idx // I assume this is an old entry...we don't use it anymore..
      entry.id += tc.id || ''
      entry.function.name += tc.function?.name || ''
      entry.function.arguments += tc.function?.arguments || ''
      toolCallsMap[index] = entry
    }
    if (Object.keys(toolCallsMap).length > 0) {
      choice.message.tool_calls = Object.keys(toolCallsMap)
        .sort((a, b) => Number(a) - Number(b)) // Sort keys numerically
        .map((key) => toolCallsMap[key]!) // Convert sorted keys to values
    }
    response.choices[0] = choice // update the choice in the response
  }

  return response
}

async function getClearErrorMessage(response: Response): Promise<string> {
  const httpCode = response.status // 400
  const defaultReasons: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  }

  // ── read body once, regardless of content‑type ─────────────
  let raw = ''
  try {
    raw = (await response.clone().text()).trim()
  } catch {
    /* swallow */
  }

  // ── Try JSON first ─────────────────────────────────────────
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const obj = JSON.parse(raw)

      /* possible structures and where the human message hides:

         { message: "…", code:400 }
         { error:  "…" }
         { error: { message:"…", type:"invalid_request_error", code:"400" } }
         { detail:"…" }   // Supabase
      */
      const msg =
        (typeof obj.message === 'string' && obj.message.trim()) ||
        (typeof obj.error === 'string' && obj.error.trim()) ||
        (typeof obj.error?.message === 'string' && obj.error.message.trim()) ||
        (typeof obj.detail === 'string' && obj.detail.trim()) ||
        ''

      if (msg) {
        const statusText = response.statusText || defaultReasons[httpCode] || ''
        return `${httpCode}${statusText ? ` ${statusText}` : ''}: ${msg}`
      }
      // fall‑through to plain‑text handling if JSON but no useful field
    } catch {
      /* JSON.parse failed ⇒ treat as plain text below */
    }
  }

  // ── Plain‑text body (includes XML / HTML etc.) ─────────────
  if (raw) {
    const statusText = response.statusText || defaultReasons[httpCode] || ''
    return `${httpCode}${statusText ? ` ${statusText}` : ''}: ${raw}`
  }

  // ── No body worth showing ──────────────────────────────────
  const statusText = response.statusText || defaultReasons[httpCode] || 'Unknown Error'
  return `${httpCode} ${statusText}: No additional information available.`
}

// calls OpenAI API compatible chatmodels
export async function callLLM(
  request: {
    payload: OpenAI.Chat.Completions.ChatCompletionCreateParams
    headers: Record<string, string>
    url: string
  },
  stream: boolean | undefined = false,
  contentCallBack: (chunk?: OpenAI.Chat.Completions.ChatCompletionChunk) => void,
  stopSignal: AbortSignal,
  timeoutMs: number = 10000, // Timeout in milliseconds for waiting for first streamed response
  maxRetries: number = 3, // Maximum number of retry attempts
): Promise<ChatResponseType | undefined> {
  const accumulatedErrors: Set<string> = new Set()

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`Attempt ${attempt} of ${maxRetries}`)

    // Use AbortController to handle stream cancellation and timeout
    const controller = new AbortController()
    // Propagate caller’s stopSignal into it…
    const onAbort = () => controller.abort(stopSignal.reason)
    stopSignal.addEventListener('abort', onAbort)
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response | undefined = undefined
    try {
      response = await fetch(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify(request.payload),
        signal: controller.signal,
      })
    } catch (err) {
      const clearMsg =
        err instanceof Error
          ? `${err.name}: ${err.message}`
          : typeof err === 'string'
            ? err
            : JSON.stringify(err)
      accumulatedErrors.add(clearMsg)
      console.error(`Attempt ${attempt} network failure:`, clearMsg)
    } finally {
      clearTimeout(timeoutId) // Clear timeout if fetch completes in time
      stopSignal.removeEventListener('abort', onAbort)
    }

    if (!response) {
      console.error(`Attempt ${attempt} failed: No response received.`)
      accumulatedErrors.add('Not able to get a response from AI!')
      continue
    } else if (!response.ok) {
      // Check for non-OK status codes and throw error
      const clearMsg = await getClearErrorMessage(response)
      console.error(
        `Attempt ${attempt} failed with status`,
        clearMsg,
        await response.clone().text(),
      )
      accumulatedErrors.add(clearMsg)
      continue
    }

    let chatCompletion: ChatResponseType | undefined = undefined
    if (stream && response.body) {
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const chunks: OpenAI.Chat.Completions.ChatCompletionChunk[] = []
      let bufferedData = '' // Buffer to hold partial JSON chunks
      let receivedFirstChunk = false

      const firstChunkTimeout = setTimeout(() => {
        if (!receivedFirstChunk) {
          console.warn('First streamed response timed out')
          controller.abort()
        }
      }, timeoutMs)

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          console.log('Stream finished')
          break
        }

        clearTimeout(firstChunkTimeout) // Clear first-chunk timeout on receiving data
        receivedFirstChunk = true

        // Decode the binary chunk into a string
        const chunk = decoder.decode(value, { stream: true })
        bufferedData += chunk

        // Process the buffered data and split at newlines (for each "data: ..." chunk)
        const lines = bufferedData.split('\n')

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i]!.trim()

          // Only process lines starting with "data: "
          if (line.startsWith('data: ')) {
            const jsonString = line.replace(/^data: /, '').trim()

            if (jsonString && jsonString !== '[DONE]') {
              let jsonChunk: OpenAI.Chat.Completions.ChatCompletionChunk
              try {
                // Parse the current line into a JSON object
                jsonChunk = JSON.parse(jsonString)
              } catch (err) {
                throw new Error(`Failed to parse chunk; ${jsonString}`, { cause: err })
              }
              chunks.push(jsonChunk)
              // Call the callback function to process the chunk
              contentCallBack(jsonChunk)
            }
          }
        }

        // Keep the last partial chunk in the buffer for the next iteration
        bufferedData = lines[lines.length - 1]!

        // If the cancelStream callback signals to cancel, break the loop and abort the request
        if (stopSignal.aborted) {
          controller.abort(stopSignal.reason)
          console.log('Stream cancelled by user')
          break
        }
      }

      // After finishing, accumulate the full chat completion
      chatCompletion = chunks.reduce<ChatResponseType | undefined>(
        (existing, chunk) =>
          accumulateStep(existing, chunk as unknown as OpenAI.ChatCompletionChunk),
        chatCompletion,
      )!
    } else {
      // Non-streaming case: Just return the full response
      chatCompletion = await response.json()
      break
    }
    console.log('AI responded:', chatCompletion)
    // we would like to keep any additional properties that are not part of the OpenAI.ChatCompletion type
    // and are doin a "passthrough" here becaus of this :)
    const resp = ChatResponseType.passthrough().parse(chatCompletion)
    return resp
  }
  // we weren't able to get a response to we throw an error!
  throw new Error(`AI call failed after ${maxRetries} attempts.`, {
    cause: [...accumulatedErrors],
  })
}

export async function createOpenAIRequest(
  apiKey: string,
  siteUrl: string,
  api: { selectedModel: string; streamSupport: boolean; baseURL: string; name: string },
  chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  schema: Record<string, unknown> | undefined,
  stream: boolean,
  functions: OpenAI.Chat.Completions.ChatCompletionTool[],
  maxSchemaIdLength: number = 9, // max length of the schema id (default is 9, because e.g. mistral has that limit)
) {
  const headers: Record<string, string> = generateHeaders(apiKey, siteUrl, api.name)
  if (!api.selectedModel) {
    throw new Error('No AI model was selected for chat completion!')
  }

  const payload: OpenAI.ChatCompletionCreateParams & {
    reasoning?: {
      effort?: 'high' | 'medium' | 'low'
      max_tokens?: number
      exclude?: boolean
      enabled?: boolean
    }
  } = {
    model: api.selectedModel,
    messages: chatMessages,
    response_format: schema
      ? {
          type: 'json_schema',
          json_schema: {
            // we generate a hash of the schema in order to make sure the schema is cached
            // we are using 9 chars max, because e.g. mistral has that limit
            name: await charHash(schema, maxSchemaIdLength),
            schema,
            strict: true, // we can use false here, because taskyon is doing its own checks and this gives us more freedom what we can do in our schemas...
            description: '',
          },
        }
      : { type: 'text' },
    user: 'taskyon',
    temperature: 0.0,
    stream: stream && api.streamSupport,
    stream_options: { include_usage: true },
    n: 1,
    ...(functions.length > 0 && { tools: functions, tool_choice: 'auto' }),
    // the following comes from openrouter
  }
  if (api.name == 'taskyon' || api.name == 'openrouter.ai') {
    const models = await availableModels(api.baseURL, apiKey, headers, false)
    if (models[api.selectedModel]?.supported_parameters?.includes('reasoning')) {
      // we can use reasoning with this model
      payload.reasoning = {
        // One of the following (not both):
        // Can be "high", "medium", or "low" (OpenAI-style)
        // for other APIs, we use max_tokens
        effort: 'low',
        // max tokens can only be used if we don't use "effort"
        // max_tokens: 2000, // Specific token limit (Anthropic-style)
        // Optional: Default is false. All models support this.
        exclude: false, // Set to true to exclude reasoning tokens from response
        // Or enable reasoning with the default parameters:
        enabled: true, // Default: inferred from `effort` or `max_tokens`
      }
    }
  }
  return { headers, payload, url: `${api.baseURL}/chat/completions` }
}

export async function getTaskyonCosts(
  llmSettings: llmSettings,
  apiKey: string,
  api: llmSettings['llmApis'][0],
  completionId: string,
  taskid: string,
) {
  const headers = {
    ...llmSettings.llmApis['taskyon']?.defaultHeaders,
    ...generateHeaders(apiKey, llmSettings.siteUrl, api.name),
  }
  const baseUrl = new URL(api.baseURL).origin
  console.log('get generation info from ', baseUrl)
  const url = `${baseUrl}/rest/v1/api_usage_log?select=reference_data&id=eq.${completionId}`
  const response = await fetch(url, { headers })
  if (!response.ok) {
    // TODO: replace this with an error message in the UsageInfos
    //       so that the user can manually try to get the cost info...
    throw new Error(`Could not find generation information for task ${taskid}`)
  }
  const data = await (response.json() as Promise<{ reference_data: OpenRouterGenerationInfo }[]>)

  return data[0]?.reference_data
}

export async function getOpenRouterGenerationInfo(
  generationId: string,
  headers: Record<string, string>,
) {
  let retryCount = 0
  let delay = 5000 // first delay

  while (retryCount < 3) {
    const response = await fetch(`https://openrouter.ai/api/v1/generation?id=${generationId}`, {
      headers,
    })

    if (response.ok) {
      const generationInfo = (await response.json()) as {
        data: OpenRouterGenerationInfo
      }
      console.log('received generation info for task')
      return generationInfo.data
    } else if (response.status === 404) {
      console.log(`Received 404, retrying in ${delay}ms`)
      await sleep(delay)
      retryCount++
      delay *= 2 // increase delay for next retry
    } else {
      throw new Error(
        `Failed to get cost information for Openrouter.ai: ${generationId} - ${response.status}`,
      )
    }
  }
  throw new Error(`Failed to get generation info after 3 retries for ${generationId}`)
}

const availableModelsTmp = async (
  modelsUrl: string,
  apiKey: string,
  headers: Record<string, string>,
  invalidateCache = false,
): Promise<Record<string, Model>> => {
  try {
    // Construct the URL with an optional cache-busting query parameter
    const url = invalidateCache ? `${modelsUrl}?_=${new Date().getTime()}` : modelsUrl

    // Setting up the Fetch request
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...headers,
        Authorization: `Bearer ${apiKey}`,
        //'Cache-Control': 'max-stale=3600',
        'Cache-Control': 'no-cache', // Ensure the freshest data is fetched as we're caching this function anyways...
      },
    })

    // Check if the response is ok (status in the range 200-299)
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    // Parse the JSON response
    const data = (await response.json()) as { data: Model[] }

    // Return the list of models directly
    const models = data.data.reduce<Record<string, Model>>((acc, m) => {
      acc[m.id] = m
      return acc
    }, {})
    return models
  } catch (error) {
    console.error('Error fetching models:', error)
    throw error // re-throwing the error to be handled by the calling code
  }
}

export const availableModels = asyncTimeLruCache(
  10, // max 10 entries
  60 * 60 * 1000, //1h
  true, // use localStorage for persistence
  'modelCache', // save it here..
)(availableModelsTmp)
