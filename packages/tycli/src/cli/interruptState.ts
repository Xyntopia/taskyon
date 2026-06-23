export type WorkerActivityState = {
  activeWorkerTaskCount: number
  hasWorkerProcessing: boolean
  waitingForTask: boolean
}

export function hasInterruptibleWorkerActivity(state: WorkerActivityState) {
  return state.waitingForTask || state.activeWorkerTaskCount > 0 || state.hasWorkerProcessing
}
