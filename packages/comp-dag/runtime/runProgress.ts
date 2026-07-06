export const LONG_RUN_WARNING_THRESHOLD_MS = 2 * 60 * 1000
export const LONG_RUN_CHECK_INTERVAL_MS = 10 * 1000
export const LONG_RUN_MIN_SAMPLES = 2

export type RunStatusPhase =
  | 'idle'
  | 'validating'
  | 'planning'
  | 'probing'
  | 'running'
  | 'awaiting_confirmation'
  | 'stopping'
  | 'stopped'
  | 'finalizing'
  | 'done'
  | 'error'

export type ProgressPhase =
  | 'idle'
  | 'validating'
  | 'building'
  | 'running'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'stopped'

export const progressPhaseFromStatusPhase = (phase: RunStatusPhase): ProgressPhase =>
  phase === 'planning'
    ? 'building'
    : phase === 'probing'
      ? 'running'
      : phase === 'stopping'
        ? 'running'
        : phase === 'awaiting_confirmation'
          ? 'running'
          : phase

export const computePercent = (completed: number, total: number): number => {
  const denom = total > 0 ? total : 1
  return Math.min(100, Math.max(0, (completed / denom) * 100))
}

export const totalRowsForEta = (plannedRows: number, totalCombos: number, budgetMaxRows: number | null) => {
  const uncappedTotalRows = plannedRows > 0 ? plannedRows : totalCombos
  return budgetMaxRows != null ? Math.min(uncappedTotalRows, budgetMaxRows) : uncappedTotalRows
}

export const remainingRowsForEta = (completedRows: number, totalRows: number): number =>
  Math.max(0, totalRows - Math.max(0, Math.min(completedRows, totalRows)))

