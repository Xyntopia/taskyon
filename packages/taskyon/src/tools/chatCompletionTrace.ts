import type { ProviderRequestTrace } from '../types/chatCompletion'

export type ChatCompletionTraceRecord = {
  taskId: string
  label?: string
  providerRequest: ProviderRequestTrace
}

export type ChatCompletionTraceWriter = {
  write: (record: ChatCompletionTraceRecord) => Promise<void> | void
}

let traceWriter: ChatCompletionTraceWriter | undefined

export const setChatCompletionTraceWriter = (writer: ChatCompletionTraceWriter | undefined) => {
  traceWriter = writer
}

const sensitiveKey = /authorization|cookie|api[-_]?key|token|secret|password|credential/i
const omittedPayloadKey = /file_data|image_url|input_audio|audio|image|file/i
const safeRequestHeaders = new Set(['accept', 'content-type', 'user-agent'])
const safeResponseHeaders = new Set([
  'content-type',
  'retry-after',
  'x-request-id',
  'x-oai-request-id',
  'cf-ray',
])
const maxRecordedTextLength = 20_000

const redactText = (value: string) =>
  value
    .replace(/(bearer)\s+[^\s,;]+/gi, '$1 [[redacted]]')
    .replace(/(api[-_]?key|token|secret|password|cookie|session)=([^\s,;]+)/gi, '$1=[[redacted]]')

const truncate = (value: string) => {
  const redacted = redactText(value)
  return redacted.length > maxRecordedTextLength
    ? `${redacted.slice(0, maxRecordedTextLength)}\n[[truncated ${redacted.length - maxRecordedTextLength} chars]]`
    : redacted
}

const redactValue = (value: unknown, key?: string): unknown => {
  if (key && sensitiveKey.test(key)) return '[[redacted]]'
  if (key && omittedPayloadKey.test(key)) return '[[omitted]]'
  if (typeof value === 'string') return truncate(value)
  if (Array.isArray(value)) return value.map((item) => redactValue(item))
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      redactValue(entryValue, entryKey),
    ]),
  )
}

const safeHeaders = (headers: Headers, allowed: Set<string>) =>
  Object.fromEntries(
    [...headers.entries()].flatMap(([key, value]) =>
      allowed.has(key.toLowerCase()) && !sensitiveKey.test(key) ? [[key, value]] : [],
    ),
  )

const readRecordedBody = async (request: Request) => {
  const text = await request.clone().text()
  if (!text) return undefined
  try {
    return redactValue(JSON.parse(text))
  } catch {
    return redactValue(text)
  }
}

const readErrorBody = async (response: Response) => {
  const text = await response.clone().text()
  if (!text) return undefined
  try {
    return redactValue(JSON.parse(text))
  } catch {
    return redactValue(text)
  }
}

export const createChatCompletionRecordingFetch =
  (providerRequest: ProviderRequestTrace, fetchImpl: typeof fetch): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init)
    const attempt: ProviderRequestTrace['attempts'][number] = {
      method: request.method,
      url: request.url,
      requestHeaders: safeHeaders(request.headers, safeRequestHeaders),
      ...(request.method === 'GET' || request.method === 'HEAD'
        ? {}
        : { requestBody: await readRecordedBody(request) }),
    }
    providerRequest.attempts.push(attempt)

    try {
      const response = await fetchImpl(input, init)
      const requestId =
        response.headers.get('x-request-id') ??
        response.headers.get('x-oai-request-id') ??
        undefined
      attempt.response = {
        status: response.status,
        headers: safeHeaders(response.headers, safeResponseHeaders),
        ...(requestId ? { requestId } : {}),
        ...(!response.ok ? { errorBody: await readErrorBody(response) } : {}),
      }
      return response
    } catch (error) {
      attempt.error = {
        ...(error instanceof Error ? { name: error.name } : {}),
        message: truncate(error instanceof Error ? error.message : String(error)),
      }
      throw error
    }
  }

export const writeChatCompletionTrace = async (record: ChatCompletionTraceRecord) => {
  await traceWriter?.write(record)
}
