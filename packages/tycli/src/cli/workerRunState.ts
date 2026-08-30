import type { TyTaskStreamData } from '@taskyon/taskyon'

export const nextWorkerRunSettled = (settled: boolean, stage: TyTaskStreamData['stage']) => {
  if (stage === 'all processed') return true
  if (['queued', 'processing', 'in loop', 'subtasks', 'waiting'].includes(stage)) return false
  return settled
}
