export type ChatCompletionTracePayload = {
  taskId: string
  label?: string
  input: unknown
}

export type ChatCompletionTraceOutput = {
  output: unknown
}

export type ChatCompletionTraceWriter = {
  writeInput: (payload: ChatCompletionTracePayload) => Promise<void> | void
  writeOutput: (
    payload: ChatCompletionTracePayload & ChatCompletionTraceOutput,
  ) => Promise<void> | void
}

let traceWriter: ChatCompletionTraceWriter | undefined

export const setChatCompletionTraceWriter = (writer: ChatCompletionTraceWriter | undefined) => {
  traceWriter = writer
}

export const writeChatCompletionTraceInput = async (payload: ChatCompletionTracePayload) => {
  await traceWriter?.writeInput(payload)
}

export const writeChatCompletionTraceOutput = async (
  payload: ChatCompletionTracePayload & ChatCompletionTraceOutput,
) => {
  await traceWriter?.writeOutput(payload)
}
