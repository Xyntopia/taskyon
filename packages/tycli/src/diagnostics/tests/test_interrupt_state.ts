import { hasInterruptibleWorkerActivity } from '../../cli/interruptState'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testInterruptStateTreatsBackgroundWorkersAsActive = () => {
  assert(
    hasInterruptibleWorkerActivity({
      waitingForTask: false,
      activeWorkerTaskCount: 2,
      hasWorkerProcessing: false,
    }),
    'Expected background worker tasks to route Ctrl-C to task interruption.',
  )

  assert(
    hasInterruptibleWorkerActivity({
      waitingForTask: false,
      activeWorkerTaskCount: 0,
      hasWorkerProcessing: true,
    }),
    'Expected worker processing without a task id to route Ctrl-C to task interruption.',
  )

  assert(
    !hasInterruptibleWorkerActivity({
      waitingForTask: false,
      activeWorkerTaskCount: 0,
      hasWorkerProcessing: false,
    }),
    'Expected idle CLI state to keep the normal quit prompt path.',
  )
}

testInterruptStateTreatsBackgroundWorkersAsActive.description =
  'Routes Ctrl-C to task interruption whenever foreground or background worker activity exists.'
