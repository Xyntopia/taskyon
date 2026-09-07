export type StepTimingEvent = {
  step: string
  phase: 'started' | 'completed' | 'failed'
  durationMs: number
}

/** Report before awaiting work, so a stalled operation remains identifiable. */
export const createStepTimer =
  (report?: (event: StepTimingEvent) => void, now: () => number = () => performance.now()) =>
  async <T>(step: string, operation: () => T | Promise<T>): Promise<T> => {
    const started = now()
    report?.({ step, phase: 'started', durationMs: 0 })
    let phase: 'completed' | 'failed' = 'failed'
    try {
      const value = await operation()
      phase = 'completed'
      return value
    } finally {
      report?.({ step, phase, durationMs: now() - started })
    }
  }
