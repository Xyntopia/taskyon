import { createTaskNode } from '../core/createTasks'
import { TaskNode, type partialTaskDraft } from '../types/taskNode'
import { deepCloneWJson, removeKeys } from '@taskyon/common/modules/objHelpers'
import { sleep } from '@taskyon/common/modules/utils'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

function shuffleKeys<T>(obj: T): T {
  const cloned = deepCloneWJson(obj)
  if (Array.isArray(cloned) || cloned === null || typeof cloned !== 'object') return cloned

  const entries = Object.entries(cloned)
  for (let index = entries.length - 1; index > 0; index -= 1) {
    const replacement = Math.floor(Math.random() * (index + 1))
    const current = entries[index]!
    entries[index] = entries[replacement]!
    entries[replacement] = current
  }

  return Object.fromEntries(entries.map(([key, value]) => [key, shuffleKeys(value)])) as T
}

async function expectError(run: () => unknown) {
  try {
    await run()
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
  throw new Error('Expected operation to produce an error')
}

export async function testTaskIdHashing() {
  const testTask: partialTaskDraft = {
    role: 'user',
    name: 'test',
    content: { type: 'message', data: 'test' },
    parentID: undefined,
  }
  const fullTask = await createTaskNode(testTask, { createMeta: 'missing' })
  const cloneTask = deepCloneWJson(testTask)
  delete cloneTask.parentID
  cloneTask.created_at = fullTask.created_at
  const strippedTask = await createTaskNode(cloneTask, { createMeta: 'missing' })
  assert(strippedTask.id === fullTask.id, 'Stripping undefined fields must preserve task identity')

  const noIdTask = removeKeys(fullTask, ['id'])
  await sleep(10)
  const recreatedMissingMeta = await createTaskNode(noIdTask, { createMeta: 'missing' })
  await sleep(10)
  const recreatedDefault = await createTaskNode(noIdTask)
  await sleep(10)
  const updatedTask = await createTaskNode(noIdTask, { createMeta: 'overwrite' })
  const wrongUpdatedId = await expectError(() =>
    createTaskNode({ ...updatedTask, id: fullTask.id }, { createMeta: 'overwrite' }),
  )
  await sleep(10)
  const newlyTimestamped = await createTaskNode(testTask, { createMeta: 'missing' })

  assert(fullTask.id === recreatedMissingMeta.id, 'Missing metadata recreation must be stable')
  assert(fullTask.id === recreatedDefault.id, 'Default recreation must be stable')
  assert(fullTask.id !== newlyTimestamped.id, 'A new creation timestamp must change identity')

  const shuffledTask = removeKeys(shuffleKeys(fullTask), ['id'])
  await sleep(10)
  const shuffledMissingMeta = await createTaskNode(shuffledTask, { createMeta: 'missing' })
  await sleep(10)
  const shuffledDefault = await createTaskNode(shuffledTask)
  const wrongShuffledId = await expectError(() =>
    createTaskNode({ ...shuffledTask, id: newlyTimestamped.id }, { createMeta: 'overwrite' }),
  )

  assert(fullTask.id === shuffledMissingMeta.id, 'Object key order must not affect task identity')
  assert(fullTask.id === shuffledDefault.id, 'Default hashing must ignore object key order')

  return {
    expectedErrors: {
      wrongUpdatedId: wrongUpdatedId.message,
      wrongShuffledId: wrongShuffledId.message,
    },
    testTask,
    fullTask,
    shuffledTask,
  }
}

export const testFileTasksStoreSelfDescribingAttachmentReferences = () => {
  const attachment = {
    hash: `sha256:${'a'.repeat(43)}`,
    name: 'results.csv',
    mediaType: 'text/csv',
    size: 42,
  }
  const current = TaskNode.parse({
    id: 'current-file-task',
    role: 'system',
    content: { type: 'files', data: [attachment] },
  })
  const legacy = TaskNode.parse({
    id: 'legacy-file-task',
    role: 'system',
    content: { type: 'files', data: ['legacy-content-id'] },
  })

  assert(
    current.content.type === 'files' &&
      typeof current.content.data[0] !== 'string' &&
      current.content.data[0]?.name === 'results.csv',
    'Expected new file tasks to retain attachment-local metadata',
  )
  assert(
    legacy.content.type === 'files' && legacy.content.data[0] === 'legacy-content-id',
    'Expected persisted string-only attachment references to remain readable',
  )
}

testFileTasksStoreSelfDescribingAttachmentReferences.description =
  'Stores attachment metadata in new file tasks while preserving legacy hash-only task parsing.'
