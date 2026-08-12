import type { JSONSchema7 } from 'json-schema'
import type { TaskNode } from '../types/taskNode'
import { createTool, toolCall, type ToolProgress } from '../types/toolApi'

export const CHAT_COMPLETION_RETRY_DELAY_TOOL_NAME = 'chatCompletionRetryDelay'
export const CHAT_COMPLETION_RETRY_WINDOW_MS = 24 * 60 * 60_000
export const CHAT_COMPLETION_RETRY_MAX_DELAY_MS = 60 * 60_000
const CHAT_COMPLETION_RETRY_INITIAL_DELAY_MS = 5_000
const CHAT_COMPLETION_RETRY_TIMEOUT_GRACE_MS = 60_000

export type ChatCompletionRetryState = {
  retryNumber: number
  scheduledAt: number
  retryAt: number
  retryStartedAt: number
  retryDeadlineAt: number
}

const readFiniteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const parseRetryState = (value: Record<string, unknown>): ChatCompletionRetryState | undefined => {
  const retryNumber = readFiniteNumber(value.retryNumber)
  const scheduledAt = readFiniteNumber(value.scheduledAt)
  const retryAt = readFiniteNumber(value.retryAt)
  const retryStartedAt = readFiniteNumber(value.retryStartedAt)
  const retryDeadlineAt = readFiniteNumber(value.retryDeadlineAt)
  if (
    retryNumber === undefined ||
    scheduledAt === undefined ||
    retryAt === undefined ||
    retryStartedAt === undefined ||
    retryDeadlineAt === undefined
  ) {
    return undefined
  }
  return { retryNumber, scheduledAt, retryAt, retryStartedAt, retryDeadlineAt }
}

export const findLatestChatCompletionRetry = (taskChain: readonly TaskNode[]) => {
  const retryTask = taskChain.findLast(
    (task) =>
      task.content.type === 'functioncall' &&
      task.content.data.name === CHAT_COMPLETION_RETRY_DELAY_TOOL_NAME,
  )
  return retryTask?.content.type === 'functioncall'
    ? parseRetryState(retryTask.content.data.arguments)
    : undefined
}

export const buildNextChatCompletionRetry = (
  previous: ChatCompletionRetryState | undefined,
  now: number,
): ChatCompletionRetryState | undefined => {
  const retryStartedAt = previous?.retryStartedAt ?? now
  const retryDeadlineAt =
    previous?.retryDeadlineAt ?? retryStartedAt + CHAT_COMPLETION_RETRY_WINDOW_MS
  if (now >= retryDeadlineAt) return undefined

  const retryNumber = (previous?.retryNumber ?? 0) + 1
  const exponentialDelay = CHAT_COMPLETION_RETRY_INITIAL_DELAY_MS * 2 ** (retryNumber - 1)
  return {
    retryNumber,
    scheduledAt: now,
    retryAt: Math.min(
      now + Math.min(exponentialDelay, CHAT_COMPLETION_RETRY_MAX_DELAY_MS),
      retryDeadlineAt,
    ),
    retryStartedAt,
    retryDeadlineAt,
  }
}

const formatDuration = (durationMs: number) => {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours > 0 ? `${hours}h` : '', minutes > 0 ? `${minutes}m` : '', `${seconds}s`]
    .filter(Boolean)
    .join(' ')
}

const nextProgressIntervalMs = (remainingMs: number) => {
  if (remainingMs > 5 * 60_000) return 60_000
  if (remainingMs > 60_000) return 10_000
  return 1_000
}

const waitDefault = (durationMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Chat completion retry stopped.', 'AbortError'))
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, durationMs)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Chat completion retry stopped.', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })

const reportCountdown = async (
  state: ChatCompletionRetryState,
  now: number,
  reportProgress: ((progress: ToolProgress) => Promise<void>) | undefined,
) => {
  const total = Math.max(1, state.retryAt - state.scheduledAt)
  const remaining = Math.max(0, state.retryAt - now)
  await reportProgress?.({
    kind: 'status',
    message:
      remaining > 0
        ? `Waiting ${formatDuration(remaining)} before chat completion retry ${state.retryNumber}.`
        : `Retrying now (chat completion retry ${state.retryNumber}).`,
    completed: Math.min(total, Math.max(0, total - remaining)),
    total,
  })
}

const findLatestChatCompletionCall = (taskChain: readonly TaskNode[]) =>
  taskChain.findLast(
    (task) => task.content.type === 'functioncall' && task.content.data.name === 'chatCompletion',
  )

export const createChatCompletionRetryDelayTool = (dependencies?: {
  now?: () => number
  wait?: (durationMs: number, signal: AbortSignal) => Promise<void>
}) => {
  const now = dependencies?.now ?? Date.now
  const wait = dependencies?.wait ?? waitDefault
  return createTool({
    name: CHAT_COMPLETION_RETRY_DELAY_TOOL_NAME,
    description:
      'Wait visibly before Taskyon retries a transiently failed chat completion. This tool is scheduled automatically.',
    longDescription:
      'This hidden workflow capability preserves retry state in visible tasks, reports a countdown through progress events, respects cancellation, and then replays the most recent failed chat-completion arguments. Agents should not select it directly.',
    renderOptions: { hideChat: false, hideLlm: true, hideVector: true },
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        retryNumber: {
          type: 'integer',
          minimum: 1,
          description: 'One-based explicit retry number.',
        },
        scheduledAt: {
          type: 'number',
          description: 'Unix epoch milliseconds when this retry was scheduled.',
        },
        retryAt: {
          type: 'number',
          description: 'Unix epoch milliseconds when the next attempt may begin.',
        },
        retryStartedAt: {
          type: 'number',
          description: 'Unix epoch milliseconds when explicit retry handling began.',
        },
        retryDeadlineAt: {
          type: 'number',
          description: 'Unix epoch milliseconds after which retrying must stop.',
        },
        timeoutMs: {
          type: 'number',
          minimum: 1,
          description: 'Timeout assigned to the replayed chat-completion call.',
        },
      },
      required: [
        'retryNumber',
        'scheduledAt',
        'retryAt',
        'retryStartedAt',
        'retryDeadlineAt',
        'timeoutMs',
      ],
    } as const satisfies JSONSchema7,
    function: async (args, context) => {
      const state = parseRetryState(args)
      if (!state) throw new Error('Invalid chat completion retry state.')
      const taskChain = await context.getExecutionTaskChain()
      const failedCall = findLatestChatCompletionCall(taskChain)
      if (failedCall?.content.type !== 'functioncall') {
        throw new Error('No failed chatCompletion call was found for retry.')
      }

      await reportCountdown(state, now(), context.reportProgress)
      while (now() < state.retryAt) {
        const remaining = state.retryAt - now()
        await wait(Math.min(remaining, nextProgressIntervalMs(remaining)), context.stopSignal)
        await reportCountdown(state, now(), context.reportProgress)
      }

      return context.createSubtasksResult([
        toolCall({ name: 'chatCompletion', arguments: failedCall.content.data.arguments }),
      ])
    },
  })
}

export const chatCompletionRetryDelayTool = createChatCompletionRetryDelayTool()

export const buildChatCompletionRetryDelayTask = (state: ChatCompletionRetryState) =>
  toolCall({
    name: CHAT_COMPLETION_RETRY_DELAY_TOOL_NAME,
    arguments: {
      ...state,
      timeoutMs: state.retryAt - state.scheduledAt + CHAT_COMPLETION_RETRY_TIMEOUT_GRACE_MS,
    },
  })
