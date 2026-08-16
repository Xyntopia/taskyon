import { createStream, type Stream } from './frpBus.ts'

export type ActivityStatus = 'running' | 'success' | 'error'

export type ActivityEntry = {
  id: string
  label: string
  category: string
  status: ActivityStatus
  message?: string
  completed?: number
  total?: number
  startedAtMs: number
  finishedAtMs?: number
  error?: string
}

export type ActivityState = {
  status: 'idle' | ActivityStatus
  running: readonly ActivityEntry[]
  recent: readonly ActivityEntry[]
}

export type ActivityHandle = {
  id: string
  progress: (message: string, progress?: { completed?: number; total?: number }) => void
  complete: (message?: string) => void
  fail: (error: unknown) => void
}

const describeError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown activity failure'
  }
}

export const createActivityTracker = (options?: {
  now?: () => number
  createId?: () => string
  recentLimit?: number
}) => {
  const now = options?.now ?? Date.now
  const createId =
    options?.createId ??
    (() => globalThis.crypto?.randomUUID?.() ?? `${now()}-${Math.random().toString(36).slice(2)}`)
  const recentLimit = options?.recentLimit ?? 20
  const stateBus = createStream<ActivityState>()
  const eventBus = createStream<ActivityEntry>()
  let running: ActivityEntry[] = []
  let recent: ActivityEntry[] = []
  let failureAcknowledged = false

  const getState = (): ActivityState => ({
    status:
      running.length > 0
        ? 'running'
        : recent[0]?.status === 'error' && !failureAcknowledged
          ? 'error'
          : recent[0]?.status === 'success'
            ? 'success'
            : 'idle',
    running,
    recent,
  })
  const publish = (entry: ActivityEntry) => {
    eventBus.emit(entry)
    stateBus.emit(getState())
  }
  const finish = (id: string, status: Exclude<ActivityStatus, 'running'>, detail?: string) => {
    const entry = running.find((candidate) => candidate.id === id)
    if (!entry) return
    running = running.filter((candidate) => candidate.id !== id)
    const finished: ActivityEntry = {
      ...entry,
      status,
      finishedAtMs: now(),
      ...(status === 'error' && detail !== undefined ? { error: detail } : {}),
      ...(status === 'success' && detail !== undefined ? { message: detail } : {}),
    }
    recent = [finished, ...recent].slice(0, recentLimit)
    failureAcknowledged = status === 'success'
    publish(finished)
  }

  return {
    state: stateBus.stream,
    events: eventBus.stream,
    getState,
    start: (input: { label: string; category: string }): ActivityHandle => {
      const entry: ActivityEntry = {
        id: createId(),
        label: input.label,
        category: input.category,
        status: 'running',
        startedAtMs: now(),
      }
      running = [...running, entry]
      failureAcknowledged = false
      publish(entry)
      return {
        id: entry.id,
        progress: (message, progress) => {
          running = running.map((candidate) =>
            candidate.id === entry.id ? { ...candidate, message, ...progress } : candidate,
          )
          const updated = running.find((candidate) => candidate.id === entry.id)
          if (updated) publish(updated)
        },
        complete: (message) => finish(entry.id, 'success', message),
        fail: (error) => finish(entry.id, 'error', describeError(error)),
      }
    },
    acknowledgeFailure: () => {
      failureAcknowledged = true
      stateBus.emit(getState())
    },
  }
}

export type ActivityTracker = ReturnType<typeof createActivityTracker>

export const runActivity = async <T>(
  tracker: ActivityTracker,
  input: { label: string; category: string },
  run: (activity: ActivityHandle) => Promise<T>,
): Promise<T> => {
  const activity = tracker.start(input)
  try {
    const result = await run(activity)
    activity.complete()
    return result
  } catch (error) {
    activity.fail(error)
    throw error
  }
}

export type ActivityStream = Stream<ActivityState>
