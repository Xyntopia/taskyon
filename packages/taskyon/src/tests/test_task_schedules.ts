import { canonicalHash } from '@taskyon/common/modules/canonicalHash'
import {
  advanceTaskSchedule,
  claimDueTaskSchedule,
  createTaskScheduleRunner,
  isTaskScheduleDue,
  nextScheduleRun,
  saveTaskSchedule,
  type TaskSchedule,
  type TaskScheduleStorage,
} from '../core/taskSchedules'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const now = Date.parse('2026-10-22T12:00:00.000Z')

const schedule = (overrides: Partial<TaskSchedule> = {}): TaskSchedule => ({
  id: 'schedule-1',
  taskId: 'task-1',
  label: 'Daily report',
  cadence: { every: 1, unit: 'days' },
  nextRunAt: new Date(now - 60_000).toISOString(),
  runWhenOpened: true,
  enabled: true,
  createdAt: new Date(now - 86_400_000).toISOString(),
  ...overrides,
})

const createFakeStorage = () => {
  const values = new Map<string, unknown>()
  const hashOf = (value: unknown) => canonicalHash(value)
  const storage = {
    list: () =>
      Promise.resolve({
        rows: [...values.entries()].map(([id, data]) => ({ id, data })),
      }),
    get: ({ id }: { namespace: string; id: string }) =>
      Promise.resolve({
        value: values.get(id) ?? null,
        contentHash: values.has(id) ? hashOf(values.get(id)) : null,
      }),
    set: ({ id, value }: { namespace: string; id: string; value: unknown }) => {
      values.set(id, value)
      return Promise.resolve()
    },
    setIfUnchanged: ({
      id,
      expectedContentHash,
      value,
    }: {
      namespace: string
      id: string
      expectedContentHash: string | null
      value: unknown
    }) => {
      const currentHash = values.has(id) ? hashOf(values.get(id)) : null
      if (currentHash !== expectedContentHash)
        return Promise.resolve({ written: false, currentContentHash: currentHash })
      values.set(id, value)
      return Promise.resolve({ written: true, currentContentHash: hashOf(value) })
    },
    delete: ({ id }: { namespace: string; id: string }) => {
      values.delete(id)
      return Promise.resolve()
    },
  }
  return { storage: storage as unknown as TaskScheduleStorage, values }
}

export const testTaskScheduleCadenceAdvancesRunTimes = () => {
  assert(
    nextScheduleRun(now, { every: 5, unit: 'hours' }) === now + 5 * 3_600_000,
    'Expected an hourly schedule to advance in hours',
  )
  assert(
    nextScheduleRun(now, { every: 2, unit: 'weeks' }) === now + 2 * 604_800_000,
    'Expected a weekly schedule to advance in weeks',
  )
  const endOfJanuary = Date.parse('2026-01-31T12:00:00.000Z')
  const nextMonth = new Date(nextScheduleRun(endOfJanuary, { every: 1, unit: 'months' }))
  assert(
    nextMonth.getUTCMonth() === 1 && nextMonth.getUTCDate() === 28,
    `Expected a monthly schedule to clamp to the end of February, got ${nextMonth.toISOString()}`,
  )
}

testTaskScheduleCadenceAdvancesRunTimes.description =
  'Advances hourly, weekly and calendar-month schedule run times.'

export const testTaskScheduleClaimsRunOnce = async () => {
  const { storage } = createFakeStorage()
  const due = schedule()
  await saveTaskSchedule(storage, due)

  const first = await claimDueTaskSchedule(storage, due, now)
  const second = await claimDueTaskSchedule(storage, due, now)

  assert(first !== undefined, 'Expected the first device to claim the due run')
  assert(second === undefined, 'Expected the second device to lose the claim')
  assert(first.lastRunAt === new Date(now).toISOString(), 'Expected the claim to record the run')
  assert(
    Date.parse(first.nextRunAt) === nextScheduleRun(now, due.cadence),
    'Expected the claim to advance the next run',
  )
  assert(!isTaskScheduleDue(first, now), 'Expected the claimed schedule to stop being due')
}

testTaskScheduleClaimsRunOnce.description =
  'Claims a due schedule once so connected devices do not run it twice.'

export const testTaskScheduleCatchUpCollapsesMissedRuns = async () => {
  const { storage } = createFakeStorage()
  const overdue = schedule({ nextRunAt: new Date(now - 3 * 86_400_000).toISOString() })
  await saveTaskSchedule(storage, overdue)

  const claimed = await claimDueTaskSchedule(storage, overdue, now)

  assert(claimed !== undefined, 'Expected an overdue schedule to be claimed')
  assert(
    Date.parse(claimed.nextRunAt) === nextScheduleRun(now, overdue.cadence),
    'Expected a single catch-up run and a next run after now',
  )
}

testTaskScheduleCatchUpCollapsesMissedRuns.description =
  'Collapses missed occurrences into one catch-up run and advances past now.'

export const testTaskScheduleRunnerRespectsRunWhenOpened = async () => {
  const { storage } = createFakeStorage()
  const opened = schedule({ id: 'opened', taskId: 'task-open', runWhenOpened: true })
  const timerOnly = schedule({ id: 'timer', taskId: 'task-timer', runWhenOpened: false })
  await saveTaskSchedule(storage, opened)
  await saveTaskSchedule(storage, timerOnly)
  const executed: string[] = []
  const runner = createTaskScheduleRunner({
    storage,
    now: () => now,
    execute: (claimed) => {
      executed.push(claimed.taskId)
      return Promise.resolve()
    },
  })

  await runner.runDue('opened')
  assert(
    JSON.stringify(executed) === JSON.stringify(['task-open']),
    `Expected only the run-when-opened schedule, got ${JSON.stringify(executed)}`,
  )

  await runner.runDue('timer')
  assert(
    JSON.stringify(executed) === JSON.stringify(['task-open', 'task-timer']),
    `Expected the timer run to execute the remaining schedule, got ${JSON.stringify(executed)}`,
  )

  await runner.runDue('timer')
  assert(executed.length === 2, 'Expected claimed schedules not to run again')
}

testTaskScheduleRunnerRespectsRunWhenOpened.description =
  'Runs overdue schedules on open only when opted in, then processes the rest on the timer.'

export const testTaskScheduleAdvanceKeepsDisabledSchedulesIdle = async () => {
  const { storage } = createFakeStorage()
  const disabled = schedule({ enabled: false })
  await saveTaskSchedule(storage, disabled)
  const executed: string[] = []
  const runner = createTaskScheduleRunner({
    storage,
    now: () => now,
    execute: (claimed) => {
      executed.push(claimed.taskId)
      return Promise.resolve()
    },
  })

  await runner.runDue('timer')
  assert(executed.length === 0, 'Expected disabled schedules not to run')
  assert(
    advanceTaskSchedule(disabled, now).nextRunAt !== disabled.nextRunAt,
    'Expected advancing a disabled schedule to remain a pure time update',
  )
}

testTaskScheduleAdvanceKeepsDisabledSchedulesIdle.description =
  'Leaves disabled schedules unclaimed while keeping advancement deterministic.'
