import { z } from 'zod'
import type { TaskyonStorageClient } from '../api/storageProtocol'

export const TASK_SCHEDULE_NAMESPACE = 'taskyon/ui-state/v1/task-schedules'

export const taskScheduleCadence = z.object({
  every: z.number().int().positive(),
  unit: z.enum(['hours', 'days', 'weeks', 'months']),
})
export type TaskScheduleCadence = z.infer<typeof taskScheduleCadence>

export const taskSchedule = z.object({
  id: z.string(),
  taskId: z.string(),
  label: z.string().optional(),
  cadence: taskScheduleCadence,
  nextRunAt: z.string(),
  lastRunAt: z.string().optional(),
  runWhenOpened: z.boolean().default(false),
  enabled: z.boolean().default(true),
  createdAt: z.string(),
})
export type TaskSchedule = z.output<typeof taskSchedule>
export type TaskScheduleInput = z.input<typeof taskSchedule>

export type TaskScheduleStorage = Pick<
  TaskyonStorageClient,
  'list' | 'get' | 'set' | 'setIfUnchanged' | 'delete'
>

const UNIT_MS = {
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
} as const

export const nextScheduleRun = (fromMs: number, cadence: TaskScheduleCadence) => {
  if (cadence.unit === 'months') {
    const date = new Date(fromMs)
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth() + cadence.every
    const day = date.getUTCDate()
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
    return Date.UTC(
      year,
      month,
      Math.min(day, lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    )
  }
  return fromMs + cadence.every * UNIT_MS[cadence.unit]
}

export const isTaskScheduleDue = (schedule: TaskSchedule, nowMs: number) =>
  schedule.enabled && Date.parse(schedule.nextRunAt) <= nowMs

export const advanceTaskSchedule = (schedule: TaskSchedule, nowMs: number): TaskSchedule => ({
  ...schedule,
  lastRunAt: new Date(nowMs).toISOString(),
  nextRunAt: new Date(nextScheduleRun(nowMs, schedule.cadence)).toISOString(),
})

export const loadTaskSchedules = async (storage: TaskScheduleStorage) => {
  const { rows } = await storage.list({ namespace: TASK_SCHEDULE_NAMESPACE })
  return rows.flatMap((row) => {
    const parsed = taskSchedule.safeParse(row.data)
    return parsed.success ? [parsed.data] : []
  })
}

export const saveTaskSchedule = async (
  storage: TaskScheduleStorage,
  input: TaskScheduleInput,
) => {
  const schedule = taskSchedule.parse(input)
  await storage.set({ namespace: TASK_SCHEDULE_NAMESPACE, id: schedule.id, value: schedule })
  return schedule
}

export const removeTaskSchedule = async (storage: TaskScheduleStorage, id: string) => {
  await storage.delete({ namespace: TASK_SCHEDULE_NAMESPACE, id })
}

export const claimDueTaskSchedule = async (
  storage: TaskScheduleStorage,
  schedule: TaskSchedule,
  nowMs: number,
) => {
  if (!isTaskScheduleDue(schedule, nowMs)) return undefined
  const current = await storage.get({ namespace: TASK_SCHEDULE_NAMESPACE, id: schedule.id })
  if (current.value === null) return undefined
  const parsed = taskSchedule.safeParse(current.value)
  if (!parsed.success || !isTaskScheduleDue(parsed.data, nowMs)) return undefined
  const next = advanceTaskSchedule(parsed.data, nowMs)
  const result = await storage.setIfUnchanged({
    namespace: TASK_SCHEDULE_NAMESPACE,
    id: schedule.id,
    expectedContentHash: current.contentHash,
    value: next,
  })
  return result.written ? next : undefined
}

const runClaimedSchedule = async (
  deps: {
    execute: (schedule: TaskSchedule) => Promise<void>
    onError?: (error: unknown) => void
  },
  storage: TaskScheduleStorage,
  schedule: TaskSchedule,
  nowMs: number,
) => {
  if (!isTaskScheduleDue(schedule, nowMs)) return
  const claimed = await claimDueTaskSchedule(storage, schedule, nowMs)
  if (!claimed) return
  try {
    await deps.execute(claimed)
  } catch (error) {
    deps.onError?.(error)
  }
}

export const createTaskScheduleRunner = (deps: {
  storage: TaskScheduleStorage
  execute: (schedule: TaskSchedule) => Promise<void>
  now?: () => number
  intervalMs?: number
  onError?: (error: unknown) => void
}) => {
  let timer: ReturnType<typeof setInterval> | undefined
  let running = false

  const runDue = async (mode: 'opened' | 'timer') => {
    if (running) return
    running = true
    try {
      const nowMs = (deps.now ?? Date.now)()
      for (const schedule of await loadTaskSchedules(deps.storage)) {
        if (mode === 'opened' && !schedule.runWhenOpened) continue
        await runClaimedSchedule(deps, deps.storage, schedule, nowMs)
      }
    } catch (error) {
      deps.onError?.(error)
    } finally {
      running = false
    }
  }

  return {
    runDue,
    start: () => {
      void runDue('opened')
      timer ??= setInterval(() => void runDue('timer'), deps.intervalMs ?? 60_000)
    },
    stop: () => {
      if (timer) clearInterval(timer)
      timer = undefined
    },
  }
}
