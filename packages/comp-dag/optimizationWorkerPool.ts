import type { EnvironmentWorkerLike } from '@taskyon/common/modules/environmentWorker'

export type OptimizationWorkerStats = {
  workerCount: number
  busyWorkers: number
  queuedTasks: number
}

type EstimateDurationTask = {
  id: number
  type: 'estimateDuration'
  avgMsPerRow: number
  totalRows: number
}

type EstimateDurationResult = {
  id: number
  ok: true
  totalMs: number
}

type WorkerErrorResult = {
  id: number
  ok: false
  error: string
}

type PendingTask = {
  task: EstimateDurationTask
  resolve: (value: number) => void
  reject: (error: unknown) => void
}

type WorkerSlot = {
  worker: EnvironmentWorkerLike<EstimateDurationTask, EstimateDurationResult | WorkerErrorResult>
  busy: boolean
  activeTaskId: number | null
}

export class OptimizationWorkerPool {
  private readonly createWorker: () => EnvironmentWorkerLike<
    EstimateDurationTask,
    EstimateDurationResult | WorkerErrorResult
  >
  private readonly workerDebugLabel: string
  private slots: WorkerSlot[] = []
  private queue: PendingTask[] = []
  private pendingById = new Map<number, PendingTask>()
  private taskId = 0

  constructor(args: {
    createWorker: () => EnvironmentWorkerLike<
      EstimateDurationTask,
      EstimateDurationResult | WorkerErrorResult
    >
    workerDebugLabel?: string
  }) {
    this.createWorker = args.createWorker
    this.workerDebugLabel = args.workerDebugLabel ?? '(custom-worker-factory)'
  }

  ensureSize(count: number) {
    const target = Math.max(1, Math.floor(count))

    while (this.slots.length < target) {
      const worker = this.createWorker()
      console.info('[COMP-DAG][optimizationWorkerPool] spawned ETA worker', {
        workerUrl: this.workerDebugLabel,
        slotIndex: this.slots.length,
      })
      const slot: WorkerSlot = { worker, busy: false, activeTaskId: null }
      worker.onmessage = (event: MessageEvent<EstimateDurationResult | WorkerErrorResult>) => {
        const data = event.data
        if (!data || typeof data.id !== 'number') return

        const pending = this.pendingById.get(data.id)
        if (!pending) {
          if (slot.activeTaskId === data.id) {
            slot.activeTaskId = null
            slot.busy = false
            this.pump()
          }
          return
        }

        this.pendingById.delete(data.id)
        slot.activeTaskId = null
        slot.busy = false

        if (data.ok) pending.resolve(data.totalMs)
        else pending.reject(new Error(data.error))

        this.pump()
      }
      worker.onerror = (event) => {
        console.error('[COMP-DAG][optimizationWorkerPool] ETA worker error', {
          workerUrl: this.workerDebugLabel,
          slotActiveTaskId: slot.activeTaskId,
          message: event.message,
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        })
        const activeTaskId = slot.activeTaskId
        if (activeTaskId != null) {
          const pending = this.pendingById.get(activeTaskId)
          if (pending) {
            this.pendingById.delete(activeTaskId)
            pending.reject(new Error('Optimization ETA worker failed'))
          }
        }
        slot.activeTaskId = null
        slot.busy = false
        this.pump()
      }
      this.slots.push(slot)
    }

    while (this.slots.length > target) {
      const slot = this.slots.pop()
      if (!slot) break
      const activeTaskId = slot.activeTaskId
      if (activeTaskId != null) {
        const pending = this.pendingById.get(activeTaskId)
        if (pending) {
          this.pendingById.delete(activeTaskId)
          pending.reject(new Error('Optimization ETA worker was terminated'))
        }
      }
      slot.activeTaskId = null
      slot.busy = false
      slot.worker.terminate()
      console.info('[COMP-DAG][optimizationWorkerPool] terminated ETA worker', {
        workerUrl: this.workerDebugLabel,
      })
    }
  }

  stats(): OptimizationWorkerStats {
    const busyWorkers = this.slots.filter((s) => s.busy).length
    return {
      workerCount: this.slots.length,
      busyWorkers,
      queuedTasks: this.queue.length,
    }
  }

  estimateDuration(avgMsPerRow: number, totalRows: number): Promise<number> {
    const task: EstimateDurationTask = {
      id: ++this.taskId,
      type: 'estimateDuration',
      avgMsPerRow,
      totalRows,
    }

    return new Promise<number>((resolve, reject) => {
      this.queue.push({ task, resolve, reject })
      this.pump()
    })
  }

  destroy() {
    for (const pending of this.pendingById.values()) {
      pending.reject(new Error('Optimization ETA worker pool destroyed'))
    }
    for (const queued of this.queue) {
      queued.reject(new Error('Optimization ETA worker pool destroyed'))
    }
    for (const slot of this.slots) {
      slot.activeTaskId = null
      slot.busy = false
      slot.worker.terminate()
    }
    this.slots = []
    this.queue = []
    this.pendingById.clear()
  }

  private pump() {
    for (const slot of this.slots) {
      if (slot.busy) continue
      const next = this.queue.shift()
      if (!next) break
      slot.busy = true
      slot.activeTaskId = next.task.id
      this.pendingById.set(next.task.id, next)
      slot.worker.postMessage(next.task)
    }
  }
}
