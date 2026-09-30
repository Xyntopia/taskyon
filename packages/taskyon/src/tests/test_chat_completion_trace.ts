import {
  isChatCompletionResponseTracingEnabled,
  isChatCompletionTracingEnabled,
  redactChatCompletionTraceValue,
  setChatCompletionTraceWriter,
} from '../tools/chatCompletionTrace'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testChatCompletionTraceWriterEnablesDiagnosticCallsWithoutPerCallSettings = () => {
  setChatCompletionTraceWriter({ write: () => undefined })
  try {
    assert(
      isChatCompletionTracingEnabled(false),
      'An installed diagnostic writer should trace chat completions without entry-node overrides',
    )
    assert(
      !isChatCompletionResponseTracingEnabled(),
      'The ordinary debug writer should not retain full response content',
    )
  } finally {
    setChatCompletionTraceWriter(undefined)
  }
  setChatCompletionTraceWriter({ captureResponse: true, write: () => undefined })
  try {
    assert(
      isChatCompletionResponseTracingEnabled(),
      'The explicit trace flag should capture responses',
    )
  } finally {
    setChatCompletionTraceWriter(undefined)
  }
  assert(!isChatCompletionTracingEnabled(false), 'Tracing should stop after writer cleanup')
}

export const testChatCompletionTraceRedactsRawResponseChunks = () => {
  const response = redactChatCompletionTraceValue({
    usage: { server_tool_use_details: { web_search_requests: 1 } },
    data: [{ api_key: 'private', text: 'Search result text' }],
  }) as {
    usage: { server_tool_use_details: { web_search_requests: number } }
    data: Array<{ api_key: string; text: string }>
  }
  assert(
    response.usage.server_tool_use_details.web_search_requests === 1,
    'Hosted-search usage must remain visible in the response trace',
  )
  assert(response.data[0]?.api_key === '[[redacted]]', 'Response credentials must be redacted')
  assert(response.data[0]?.text === 'Search result text', 'Ordinary response text must remain')
  const event = redactChatCompletionTraceValue(
    'data: {"api_key":"private","usage":{"server_tool_use_details":{"web_search_requests":1}}}',
  )
  assert(typeof event === 'string' && !event.includes('private'), 'SSE text must redact keys')
  assert(
    typeof event === 'string' && event.includes('web_search_requests'),
    'SSE text must retain search metadata',
  )
  assert(
    redactChatCompletionTraceValue(new Uint8Array([1, 2, 3])) === '[[omitted]]',
    'Binary chunks must not enter text trace files',
  )
}
