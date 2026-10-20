import {
  createTaskExecutionProgressState,
  createTaskWorkerStatusState,
  reduceTaskWorkerStatus,
  reduceWorkerProgress,
} from '@taskyon/ui/modules/taskExecutionProgress'
import { createCliWorkerState } from '../../cli'

export const testCliWorkerStateKeepsContinuationsActive = async () => {
  const state = createCliWorkerState()
  const effects = { onFinished: () => undefined, onStateChanged: () => undefined }
  state.startTask()
  state.trackWorkerProgress({ stage: 'processing', taskId: 'synthetic-first' }, effects)
  state.trackWorkerProgress({ stage: 'processed', taskId: 'synthetic-first' }, effects)
  if (state.activeTaskCount() === 0)
    throw new Error('Processing one task must not release the prompt before its continuation.')
  state.trackWorkerProgress({ stage: 'waiting', taskId: 'synthetic-next' }, effects)
  await new Promise((resolve) => setTimeout(resolve, 150))
  if (state.activeTaskCount() === 0)
    throw new Error('Waiting for a continuation must not be mistaken for an idle worker.')
  let settled = false
  const wait = state.waitForWorkerIdle(1000).then(() => {
    settled = true
  })
  await Promise.resolve()
  if (settled) throw new Error('Idle wait must remain attached to the complete worker run.')
  state.trackWorkerProgress({ stage: 'all processed' }, effects)
  await wait
  if (!settled || state.activeTaskCount() !== 0)
    throw new Error('Only the authoritative all-processed event releases the input prompt.')
  state.startTask()
  state.trackWorkerProgress({ stage: 'queued', taskId: 'synthetic-abort' }, effects)
  state.trackWorkerProgress({ stage: 'aborted' }, effects)
  if (state.activeTaskCount() !== 0)
    throw new Error('A global abort must clear terminal worker activity.')
}
testCliWorkerStateKeepsContinuationsActive.description =
  'The real CLI worker state keeps the main prompt closed between tasks and during waiting continuations, leaving approval input available.'

export const testWorkerRunSettlementUsesAllProcessed = () => {
  let state = createTaskWorkerStatusState()

  state = reduceTaskWorkerStatus(state, { stage: 'queued', taskId: 'first' })
  if (state.settled) throw new Error('Queued work must start an unsettled worker run.')

  state = reduceTaskWorkerStatus(state, { stage: 'processed', taskId: 'first' })
  state = reduceTaskWorkerStatus(state, { stage: 'waiting' })
  if (state.settled) throw new Error('A waiting continuation must not settle the worker run.')

  state = reduceTaskWorkerStatus(state, { stage: 'all processed' })
  if (!state.settled) throw new Error('The all processed event must settle the worker run.')

  state = reduceTaskWorkerStatus(state, { stage: 'waiting' })
  if (state.settled) throw new Error('New waiting work must reopen a settled worker run.')

  state = reduceTaskWorkerStatus(state, { stage: 'aborted' })
  if (!state.settled) throw new Error('Aborting the whole worker must settle the run.')

  const progress = reduceWorkerProgress(createTaskExecutionProgressState(), {
    stage: 'waiting',
  })
  if (progress.settled)
    throw new Error('Idless waiting events must also mark the shared progress reducer unsettled.')

  return 'both browser and CLI use the same authoritative worker-state reducer'
}
testWorkerRunSettlementUsesAllProcessed.description =
  'The shared browser/CLI reducer keeps queued and waiting continuations active until settlement or a global abort.'
