import { nextWorkerRunSettled } from '../../cli/workerRunState'

export const testWorkerRunSettlementUsesAllProcessed = () => {
  let settled = false

  settled = nextWorkerRunSettled(settled, 'queued')
  settled = nextWorkerRunSettled(settled, 'waiting')
  if (settled) throw new Error('A waiting continuation must not settle the worker run.')

  settled = nextWorkerRunSettled(settled, 'processed')
  if (settled) throw new Error('A processed task must not settle the complete worker run.')

  settled = nextWorkerRunSettled(settled, 'all processed')
  if (!settled) throw new Error('The all processed event must settle the worker run.')

  settled = nextWorkerRunSettled(settled, 'waiting')
  if (settled) throw new Error('New waiting work must reopen a settled worker run.')

  return 'worker run settlement follows authoritative all-processed events'
}

testWorkerRunSettlementUsesAllProcessed.description =
  'Keeps waiting continuations active until the worker reports all tasks processed.'
