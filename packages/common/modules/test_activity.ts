import { createActivityTracker, runActivity } from './activity.ts'

export const testActivityTrackerReportsConcurrentWorkAndFailureRecovery = async () => {
  let now = 100
  let sequence = 0
  const tracker = createActivityTracker({
    now: () => (now += 10),
    createId: () => `activity-${(sequence += 1)}`,
    recentLimit: 3,
  })
  const snapshots: number[] = []
  tracker.state((state) => {
    snapshots.push(state.running.length)
  })

  const first = tracker.start({ label: 'Compile graph', category: 'compiler' })
  const second = tracker.start({ label: 'Load repository', category: 'storage' })
  first.progress('Compiling node 1 of 2', { completed: 1, total: 2 })
  second.complete()
  first.fail(new Error('Compiler stopped'))

  if (snapshots.join(',') !== '1,2,2,1,0') {
    throw new Error(`Unexpected activity lifecycle: ${snapshots.join(',')}`)
  }
  if (tracker.getState().status !== 'error' || tracker.getState().recent[0]?.status !== 'error') {
    throw new Error('Expected the latest failed activity to keep the tracker red.')
  }
  tracker.acknowledgeFailure()
  if (tracker.getState().status !== 'idle') {
    throw new Error('Expected acknowledging a failure to restore idle status.')
  }

  const value = await runActivity(
    tracker,
    { label: 'Reload graph', category: 'compiler' },
    (activity) => {
      activity.progress('Loaded graph revision')
      return Promise.resolve(42)
    },
  )
  if (value !== 42 || tracker.getState().status !== 'success') {
    throw new Error('Expected successful work to return its value and clear a previous failure.')
  }
  return { events: snapshots.length, recent: tracker.getState().recent.length }
}

testActivityTrackerReportsConcurrentWorkAndFailureRecovery.description =
  'Activity streams track concurrent progress, failure acknowledgement, and later recovery.'
