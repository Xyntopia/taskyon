import { createConversationPersistQueue } from '../../cli/conversationPersistence'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testConversationPersistenceCoalescesQueuedSnapshots = async () => {
  const persisted: string[] = []
  let releaseFirstPersist: (() => void) | undefined
  const firstPersistStarted = new Promise<void>((resolve) => {
    releaseFirstPersist = resolve
  })
  let callCount = 0
  const queue = createConversationPersistQueue(async (leafId) => {
    callCount += 1
    persisted.push(leafId)
    if (callCount === 1) await firstPersistStarted
  })

  queue.request('first')
  await Promise.resolve()
  queue.request('obsolete-a')
  queue.request('obsolete-b')
  queue.request('latest')
  releaseFirstPersist?.()
  await queue.flush()

  assert(
    persisted.join(',') === 'first,latest',
    `Expected only the active and latest snapshots, got ${persisted.join(',')}`,
  )
}

testConversationPersistenceCoalescesQueuedSnapshots.description =
  'Conversation persistence coalesces worker-event bursts so shutdown writes only the latest pending task-chain snapshot.'
