import type { apiConfig, Model, OpenAIMessage, OpenRouterGenerationInfo } from '@taskyon/taskyon'
import { charHash, ChatResponseType, sleep } from '@taskyon/taskyon'
import type OpenAI from 'openai'
import { asyncTimeLruCache } from '../../../../src/modules/utils'

export function generateHeaders(Bearer: string, selectedApi: string, siteUrl?: string) {
  let headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (Bearer && !(selectedApi === 'taskyon' && Bearer === 'anonymous')) {
    headers.Authorization = `Bearer ${Bearer}`
  }

  if (selectedApi == 'openrouter.ai') {
    headers = {
      ...headers,
      ...(siteUrl
        ? {
            'HTTP-Referer': `${siteUrl}`, // To identify your app. Can be set to localhost for testing
            'X-Title': `${siteUrl}`, // Optional. Shows on openrouter.ai
          }
        : {}),
    }
  }

  return headers
}

export type ChatCompletionChunk = {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  system_fingerprint?: string

  // Non-standard vendor additions
  provider?: string

  choices: Array<{
    index: number
    delta: {
      role?: 'system' | 'user' | 'assistant' | 'tool' | 'developer'
      content?: string | null
      refusal?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        // ✅ CHANGE: Made the 'type' property optional
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>

      // Vendor extensions
      reasoning?: string
      reasoning_details?: Array<{
        type: string
        text: string
        format?: string
        index?: number
      }>
    }
    finish_reason?: 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'function_call' | null
    native_finish_reason?: string | null // vendor-specific
    logprobs?: unknown
  }>
}

// Compile-time check: OpenAI.ChatCompletionChunk must be assignable to ChatCompletionChunk
export declare const _check: ChatCompletionChunk

// ❌ If not assignable, TS will error with full details:
// "Type 'OpenAI.ChatCompletionChunk' is not assignable to type 'ChatCompletionChunk'…"
export const _openaiChunk: typeof _check = {} as OpenAI.ChatCompletionChunk

// TODO: can we use this:  https://github.com/rexxars/eventsource-parser?
export function accumulateStep(
  existing: OpenAI.ChatCompletion | ChatResponseType | undefined,
  chunk: ChatCompletionChunk,
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
          finish_reason: 'unknown',
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
    if (delta.reasoning) {
      choice.reasoning = (choice.reasoning || '') + delta.reasoning
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

// TODO: can we use this:  https://github.com/rexxars/eventsource-parser?
// calls OpenAI API compatible chatmodels
export async function callLLM(
  request: {
    payload: tyChatCompletion
    headers: Record<string, string>
    url: string
  },
  stream: boolean | undefined = false,
  contentCallBack: (chunk: ChatCompletionChunk | undefined) => void,
  stopSignal: AbortSignal,
  timeoutMs: number, // Timeout in milliseconds for waiting for first streamed response
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
    let wasTimeoutSet = false
    const timeoutId = setTimeout(() => {
      wasTimeoutSet = true
      controller.abort(new Error('Timeout waiting for first streamed chunk from AI'))
    }, timeoutMs)

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
      accumulatedErrors.add(
        wasTimeoutSet
          ? 'Waiting for an AI response for too long. AI might be working in the background?'
          : 'Not able to get a response from AI!',
      )
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
      const chunks: ChatCompletionChunk[] = []
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

        const newChunks: ChatCompletionChunk[] = createChunks(lines)

        // Call the callback function to process the chunk
        newChunks.forEach(contentCallBack)
        chunks.push(...newChunks)

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
        (existing, chunk) => accumulateStep(existing, chunk as unknown as ChatCompletionChunk),
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

export type tyChatCompletion = OpenAI.ChatCompletionCreateParams & {
  reasoning?: {
    effort?: 'high' | 'medium' | 'low'
    max_tokens?: number
    exclude?: boolean
    enabled?: boolean
  }
  provider?: {
    order?: string[]
    allow_fallbacks?: boolean // default: true
    require_parameters?: boolean // default: false
    data_collection?: 'allow' | 'deny' // default: "allow"
    zdr?: boolean
    only?: string[]
    ignore?: string[]
    quantizations?: string[]
    sort?: 'price' | 'throughput'
    max_price?: Record<string, number>
  }
}

function createChunks(lines: string[]) {
  const newChunks: ChatCompletionChunk[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i]!.trim()

    // Only process lines starting with "data: "
    if (line.startsWith('data: ')) {
      const jsonString = line.replace(/^data: /, '').trim()

      if (jsonString && jsonString !== '[DONE]') {
        let jsonChunk: ChatCompletionChunk
        try {
          // Parse the current line into a JSON object
          jsonChunk = JSON.parse(jsonString)
        } catch (err) {
          throw new Error(`Failed to parse chunk; ${jsonString}`, { cause: err })
        }
        newChunks.push(jsonChunk)
      }
    }
  }
  return newChunks
}

export async function createOpenAIRequest(
  apiKey: string,
  config: { selectedModel: string; streamSupport: boolean; endpoint: string; name: string },
  chatMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  schema: Record<string, unknown> | undefined,
  stream: boolean,
  functions: OpenAI.Chat.Completions.ChatCompletionTool[],
  siteUrl?: string,
  maxSchemaIdLength: number = 9, // max length of the schema id (default is 9, because e.g. mistral has that limit)
) {
  const headers: Record<string, string> = generateHeaders(apiKey, config.name, siteUrl)
  if (!config.selectedModel) {
    throw new Error('No AI model was selected for chat completion!')
  }

  const payload: OpenAI.ChatCompletionCreateParams = {
    model: config.selectedModel,
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
    //temperature: 0.0, // deprecated for gpt-5
    stream: stream && config.streamSupport,
    stream_options: { include_usage: true },
    n: 1,
    ...(functions.length > 0 && { tools: functions, tool_choice: 'auto' }),
    // the following comes from openrouter
  }
  if (config.name == 'taskyon' || config.name == 'openrouter.ai') {
    const tyPayload: tyChatCompletion = payload
    // TODO: check models capabilities...  problem right now is that we don't have the correct basURL
    //const models = await availableModels(api.baseURL, apiKey, headers, false)
    //if (models[api.selectedModel]?.supported_parameters?.includes('reasoning')) {
    // we can use reasoning with this model
    tyPayload.reasoning = {
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
    tyPayload.provider = {
      //only: ['GMICloud'],
      // TODO: we need to make this generic. and on certain errors, avoid specific providers...
      // gives back "bad" results..
      ignore: ['GMICloud'],
    }
    return {
      headers,
      payload: tyPayload,
      url: config.endpoint,
      // in case we have the openai api we need to wait for the thinking to finish
      // so we are giving it a lot more time... (almost 5 minutes..)
      // for openai we are not restricted to supabase edge servers, so
      // we can choose any timeout that we want
      // the 115*1000 ms come from the 120s timeout for taskyon.space in the free version..
      timeout: config.name === 'taskyon' ? 115 * 1000 : 5 * 60 * 1000,
    }
  } else
    return {
      headers,
      payload,
      url: config.endpoint,
      // in case we have the openai api we need to wait for the thinking to finish
      // so we are giving it a lot more time... (almost 5 minutes..)
      // for openai we are not restricted to supabase edge servers, so
      // we can choose any timeout that we want
      // the 115*1000 ms come from the 120s timeout for taskyon.space in the free version..
      timeout: 5 * 60 * 1000,
    }
}

export async function getTaskyonCosts(
  siteUrl: string, // to add an indicator to the request which app/site this request is coming from
  anonymousTaskyonKey: string,
  apiKey: string,
  api: apiConfig,
  completionId: string,
  taskid: string,
) {
  const headers = {
    ...(api.name === 'taskyon' ? { apiKey: anonymousTaskyonKey } : {}),
    ...generateHeaders(apiKey, api.name, siteUrl),
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

    console.log('downloading model list')
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
    const raw = (await response.json()) as { data?: Array<Model> } | Array<Model>
    const data = 'data' in raw && raw.data[0]?.id ? raw.data : (raw as Array<Model>)

    // Return the list of models directly
    const models = data.reduce<Record<string, Model>>((acc, m) => {
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
