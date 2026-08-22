import type { createStorageClient } from '@taskyon/taskyon/api'
import { createTaskNode, createMarkdownTaskDocument } from '@taskyon/taskyon'
import {
  createConversationPersistQueue,
  createConversationPersistence,
} from '../../cli/conversationPersistence'
import type { TaskNode } from '@taskyon/taskyon'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const task = (id: string): TaskNode => ({
  id,
  role: 'user',
  content: { type: 'message', data: id },
})

export const testConversationPersistencePreservesQueuedTaskNodes = async () => {
  const persisted: string[] = []
  let releaseFirstPersist: (() => void) | undefined
  const firstPersistStarted = new Promise<void>((resolve) => {
    releaseFirstPersist = resolve
  })
  let callCount = 0
  const queue = createConversationPersistQueue(async (taskNode) => {
    callCount += 1
    persisted.push(taskNode.id)
    if (callCount === 1) await firstPersistStarted
  })

  queue.request(task('first'))
  await Promise.resolve()
  queue.request(task('second'))
  queue.request(task('third'))
  queue.request(task('latest'))
  releaseFirstPersist?.()
  await queue.flush()

  assert(
    persisted.join(',') === 'first,second,third,latest',
    `Expected every task node to be persisted, got ${persisted.join(',')}`,
  )
}

testConversationPersistencePreservesQueuedTaskNodes.description =
  'Conversation persistence preserves every streamed task node instead of dropping worker-event bursts.'

export const testConversationPersistenceWaitsForTaskLinks = async () => {
  const root = await createTaskNode(
    { role: 'user', content: { type: 'message', data: 'Archive root' } },
    { createMeta: 'missing' },
  )
  const child = await createTaskNode(
    {
      role: 'assistant',
      parentID: root.id,
      content: { type: 'message', data: 'Archive child' },
    },
    { createMeta: 'missing' },
  )
  let bytes = new Uint8Array()
  const storageClient = {
    appendBlob: ({
      id,
      data,
      expectedSize,
      contentType,
    }: {
      id: string
      data: Uint8Array
      expectedSize: number
      contentType?: string
    }) => {
      assert(expectedSize === bytes.byteLength, 'Expected append writes to use the current blob size.')
      const next = new Uint8Array(bytes.byteLength + data.byteLength)
      next.set(bytes)
      next.set(data, bytes.byteLength)
      bytes = next
      return Promise.resolve({
        id,
        size: bytes.byteLength,
        modifiedAt: new Date().toISOString(),
        ...(contentType ? { contentType } : {}),
      })
    },
    setBlob: () =>
      Promise.reject(new Error('Markdown persistence should append rather than replace the blob.')),
  } as unknown as ReturnType<typeof createStorageClient>

  const persistence = await createConversationPersistence({
    storageClient,
    startedAt: new Date('2026-01-01T00:00:00.000Z'),
  })
  await persistence.persist(child)
  assert(bytes.byteLength === 0, 'Expected a child task to wait for its missing parent.')
  await persistence.persist(root)
  await persistence.flush(true)

  const imported = await createMarkdownTaskDocument(new TextDecoder().decode(bytes))
  assert(imported.tasks.length === 2, 'Expected both streamed tasks in the Markdown archive.')
  assert(
    imported.tasks[1]?.parentID === root.id,
    'Expected the streamed child to retain its parent link.',
  )
}

testConversationPersistenceWaitsForTaskLinks.description =
  'Holds child tasks until their persisted parent links exist, then appends a valid Markdown archive.'
