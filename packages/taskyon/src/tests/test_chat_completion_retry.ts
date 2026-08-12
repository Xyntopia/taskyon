import { APICallError, RetryError } from 'ai'
import { convertTaskNodesToOpenAIChat } from '../tools/chatCompletion/context'
import { classifyStreamingFailure } from '../tools/chatCompletion/streamResult'
import {
  CHAT_COMPLETION_RETRY_DELAY_TOOL_NAME,
  CHAT_COMPLETION_RETRY_MAX_DELAY_MS,
  CHAT_COMPLETION_RETRY_WINDOW_MS,
  buildNextChatCompletionRetry,
  chatCompletionRetryDelayTool,
  createChatCompletionRetryDelayTool,
} from '../tools/chatCompletionRetryTool'
import { resolveAgentToolCatalog } from '../tools/toolTools'
import { createSubtasksResult, type ToolProgress } from '../types/toolApi'
import type { TaskNode } from '../types/taskNode'
import { FunctionCall } from '../types/tools'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

export const testChatCompletionRetryUsesSdkRetryability = () => {
  const retryable = new APICallError({
    message: 'service unavailable',
    url: 'https://provider.invalid',
    requestBodyValues: {},
    statusCode: 503,
  })
  const exhausted = new RetryError({
    message: 'Failed after 3 attempts',
    reason: 'maxRetriesExceeded',
    errors: [retryable],
  })
  const permanent = new APICallError({
    message: 'invalid request',
    url: 'https://provider.invalid',
    requestBodyValues: {},
    statusCode: 400,
  })

  assert(
    classifyStreamingFailure(exhausted, false).shortReason === 'transient provider failure',
    'Expected an exhausted retryable SDK error to enter visible recovery',
  )
  assert(
    classifyStreamingFailure(permanent, false).shortReason === 'failed',
    'Expected a permanent SDK error not to enter long-lived recovery',
  )
}

testChatCompletionRetryUsesSdkRetryability.description =
  'Uses the AI SDK retryability contract before falling back to provider error text.'

export const testChatCompletionRetryBackoffCapsAndExpires = () => {
  const startedAt = 1_000_000
  let state = buildNextChatCompletionRetry(undefined, startedAt)
  const delays: number[] = []

  for (let retryNumber = 1; retryNumber <= 12; retryNumber += 1) {
    if (!state) throw new Error(`Expected retry ${retryNumber}`)
    const currentState = state
    delays.push(currentState.retryAt - (retryNumber === 1 ? startedAt : currentState.scheduledAt))
    state = buildNextChatCompletionRetry(currentState, currentState.retryAt)
  }

  assert(
    JSON.stringify(delays.slice(0, 6)) ===
      JSON.stringify([5_000, 10_000, 20_000, 40_000, 80_000, 160_000]),
    `Unexpected exponential delays: ${JSON.stringify(delays)}`,
  )
  assert(
    delays.every((delay) => delay <= CHAT_COMPLETION_RETRY_MAX_DELAY_MS),
    'Expected every delay to respect the one-hour cap',
  )
  assert(
    state?.retryDeadlineAt === startedAt + CHAT_COMPLETION_RETRY_WINDOW_MS,
    'Expected every retry to preserve the first failure deadline',
  )
  assert(
    buildNextChatCompletionRetry(state, state!.retryDeadlineAt) === undefined,
    'Expected no retry after the 24-hour deadline',
  )
}

testChatCompletionRetryBackoffCapsAndExpires.description =
  'Doubles explicit retry delays from five seconds to one hour and stops after 24 hours.'

export const testChatCompletionRetryDelayReportsProgressAndReplaysExactCall = async () => {
  let now = 10_000
  const progress: ToolProgress[] = []
  const originalArguments = {
    model: 'gpt-5.6-luna',
    allowedTools: ['taskPlanner'],
    prependSystemPrompts: ['stable instructions'],
  }
  const retryArguments = {
    retryNumber: 1,
    scheduledAt: now,
    retryAt: now + 65_000,
    retryStartedAt: now,
    retryDeadlineAt: now + CHAT_COMPLETION_RETRY_WINDOW_MS,
    timeoutMs: 125_000,
  }
  const tasks: TaskNode[] = [
    {
      id: 'chat-call',
      role: 'function',
      created_at: 1,
      content: {
        type: 'functioncall',
        data: { name: 'chatCompletion', arguments: originalArguments },
      },
    },
    {
      id: 'provider-error',
      role: 'system',
      parentID: 'chat-call',
      created_at: 2,
      label: ['chatCompletion:transient-provider-failure'],
      content: { type: 'error', data: 'Provider unavailable.' },
    },
    {
      id: 'retry-delay',
      role: 'function',
      parentID: 'chat-call',
      priorID: 'provider-error',
      created_at: 3,
      content: {
        type: 'functioncall',
        data: {
          name: CHAT_COMPLETION_RETRY_DELAY_TOOL_NAME,
          arguments: retryArguments,
        },
      },
    },
  ]
  const tool = createChatCompletionRetryDelayTool({
    now: () => now,
    wait: (durationMs) => {
      now += durationMs
      return Promise.resolve()
    },
  })

  const result = await tool.function!(retryArguments, {
    getExecutionTaskChain: () => Promise.resolve(tasks),
    createSubtasksResult,
    getSecret: () => Promise.resolve(null),
    setSecret: () => Promise.resolve(),
    stopSignal: new AbortController().signal,
    toolId: 'retry-delay',
    reportProgress: (event) => {
      progress.push(event)
      return Promise.resolve()
    },
  })

  assert(progress.length >= 3, 'Expected immediate, intermediate, and final progress')
  assert(
    progress[0]?.message.includes('1m 5s') && progress.at(-1)?.message.includes('Retrying now'),
    `Unexpected retry progress: ${JSON.stringify(progress)}`,
  )
  assert(result && typeof result === 'object' && 'taskChainList' in result, 'Expected subtasks')
  const nextTask = result.taskChainList[0]?.[0]
  assert(nextTask?.content.type === 'functioncall', 'Expected another explicit function call')
  const nextCall = FunctionCall.safeParse(nextTask.content.data)
  assert(nextCall.success, 'Expected a valid chatCompletion function call')
  assert(nextCall.data.name === 'chatCompletion', 'Expected chatCompletion to retry')
  assert(
    JSON.stringify(nextCall.data.arguments) === JSON.stringify(originalArguments),
    'Expected the retry to preserve the exact original chatCompletion arguments',
  )
}

testChatCompletionRetryDelayReportsProgressAndReplaysExactCall.description =
  'Reports a cross-runtime countdown and replays the exact failed chatCompletion call.'

export const testChatCompletionRetryDelayStopsImmediatelyWhenCancelled = async () => {
  const now = 10_000
  const stopController = new AbortController()
  stopController.abort()
  const tool = createChatCompletionRetryDelayTool({ now: () => now })
  const args = {
    retryNumber: 1,
    scheduledAt: now,
    retryAt: now + 5_000,
    retryStartedAt: now,
    retryDeadlineAt: now + CHAT_COMPLETION_RETRY_WINDOW_MS,
    timeoutMs: 65_000,
  }
  const tasks: TaskNode[] = [
    {
      id: 'chat-call',
      role: 'function',
      created_at: 1,
      content: {
        type: 'functioncall',
        data: { name: 'chatCompletion', arguments: { model: 'gpt-5.6-luna' } },
      },
    },
  ]

  try {
    await tool.function!(args, {
      getExecutionTaskChain: () => Promise.resolve(tasks),
      createSubtasksResult,
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      stopSignal: stopController.signal,
      toolId: 'retry-delay',
    })
    throw new Error('Expected cancellation to stop the retry delay')
  } catch (error) {
    assert(
      error instanceof DOMException && error.name === 'AbortError',
      `Expected AbortError, got ${String(error)}`,
    )
  }
}

testChatCompletionRetryDelayStopsImmediatelyWhenCancelled.description =
  'Stops a pending explicit retry immediately when the user cancels the task.'

export const testChatCompletionRetryDelayIsVisibleButExcludedFromModelContext = async () => {
  const tasks: TaskNode[] = [
    {
      id: 'provider-error',
      role: 'system',
      created_at: 1,
      content: { type: 'error', data: 'Provider unavailable; retrying in 5 seconds.' },
    },
    {
      id: 'retry-delay',
      role: 'function',
      priorID: 'provider-error',
      created_at: 2,
      content: {
        type: 'functioncall',
        data: {
          name: CHAT_COMPLETION_RETRY_DELAY_TOOL_NAME,
          arguments: {
            retryNumber: 1,
            scheduledAt: 10_000,
            retryAt: 15_000,
            retryStartedAt: 10_000,
            retryDeadlineAt: 10_000 + CHAT_COMPLETION_RETRY_WINDOW_MS,
            timeoutMs: 65_000,
          },
        },
      },
    },
  ]
  const messages = await convertTaskNodesToOpenAIChat(tasks, undefined, false, false, {
    [CHAT_COMPLETION_RETRY_DELAY_TOOL_NAME]: chatCompletionRetryDelayTool,
  })
  const rendered = JSON.stringify(messages)

  assert(rendered.includes('Provider unavailable'), 'Expected the provider error in model context')
  assert(
    !rendered.includes(CHAT_COMPLETION_RETRY_DELAY_TOOL_NAME) && !rendered.includes('retryNumber'),
    'Expected the internal delay call to stay out of model context',
  )
  assert(
    chatCompletionRetryDelayTool.renderOptions?.hideChat === false,
    'Expected the retry delay to remain visible in the user chat',
  )
}

testChatCompletionRetryDelayIsVisibleButExcludedFromModelContext.description =
  'Keeps the visible provider error while excluding internal delay bookkeeping from later prompts.'

export const testChatCompletionRetryDelayIsNotAgentSelectable = () => {
  const catalog = resolveAgentToolCatalog({
    [CHAT_COMPLETION_RETRY_DELAY_TOOL_NAME]: chatCompletionRetryDelayTool,
  })

  assert(catalog.length === 0, 'Expected the internal retry delay not to appear in tool search')
}

testChatCompletionRetryDelayIsNotAgentSelectable.description =
  'Prevents the model from selecting the internal retry scheduler as an ordinary agent tool.'
