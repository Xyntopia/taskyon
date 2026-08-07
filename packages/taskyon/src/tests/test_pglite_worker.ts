import { LeaderChangedError } from '@electric-sql/pglite/worker'
import { initializePGliteWorker } from '../utils/pglite.api'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function pglite_workerRetriesInterruptedInitialization() {
  let attempts = 0
  let cleanups = 0
  const database = await initializePGliteWorker(() => {
    attempts += 1
    return {
      ready:
        attempts < 3
          ? Promise.reject(new LeaderChangedError())
          : Promise.resolve({ status: 'ready' }),
      cleanup: () => {
        cleanups += 1
      },
    }
  }, [0, 0])

  assert(database.status === 'ready', 'The stable worker attempt must be returned')
  assert(attempts === 3, `Expected three initialization attempts, received ${attempts}`)
  assert(cleanups === 2, `Expected failed workers to be terminated, received ${cleanups}`)
}

pglite_workerRetriesInterruptedInitialization.description =
  'PGlite initialization recovers when multi-tab leader election interrupts an in-flight startup operation.'

export async function pglite_workerDoesNotRetryUnrelatedFailures() {
  let attempts = 0
  let cleanups = 0
  let received: unknown
  try {
    await initializePGliteWorker(() => {
      attempts += 1
      return {
        ready: Promise.reject(new Error('database is corrupt')),
        cleanup: () => {
          cleanups += 1
        },
      }
    })
  } catch (error) {
    received = error
  }

  assert(received instanceof Error, 'The original database failure must be propagated')
  assert(attempts === 1, `Unrelated failures must not retry, received ${attempts} attempts`)
  assert(cleanups === 1, 'A failed worker must be terminated before propagating its error')
}

pglite_workerDoesNotRetryUnrelatedFailures.description =
  'PGlite startup retries only leader-election interruptions and preserves unrelated database failures.'
