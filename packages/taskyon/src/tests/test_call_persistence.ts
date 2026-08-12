import { createTaskNode, forgeTaskChain } from '../core/createTasks'
import { useTyTaskManager } from '../core/taskManager'
import { getInMemoryDatabase } from '../utils/pglite.api'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export async function testPersistencePreservesVerifiedTaskIds() {
  const taskManager = await useTyTaskManager(
    await getInMemoryDatabase(`task-id-persistence-${Date.now()}`),
    { indexTaskVectors: false },
  )
  const task = await createTaskNode({
    role: 'assistant',
    content: { type: 'message', data: 'content-addressed task' },
  })
  const [persisted] = await taskManager.addTaskNodes([task])

  assert(persisted !== undefined, 'Persistence must return the stored task')
  assert(persisted.id === task.id, 'Persistence must preserve a verified task id exactly')
  assert(
    (await taskManager.getTask(task.id, { contentMode: 'hydrated' }))?.id === task.id,
    'The exact task id must remain addressable after persistence',
  )

  let rejected = false
  try {
    await taskManager.addTaskNodes([{ ...task, id: `wrong-${task.id}` }])
  } catch {
    rejected = true
  }
  assert(rejected, 'Persistence must reject a task whose id does not match its content')

  const [first, second] = await forgeTaskChain([
    [
      { role: 'assistant', content: { type: 'message', data: 'first' } },
      { role: 'assistant', content: { type: 'message', data: 'second' } },
    ],
  ])
  assert(first !== undefined && second !== undefined, 'Expected a complete forged task chain')
  try {
    await taskManager.addTaskNodes([first, { ...second, id: `wrong-${second.id}` }])
  } catch {
    // Expected: validate the complete chain before writing any node.
  }
  assert(
    (await taskManager.getTask(first.id)) === null,
    'A rejected completed chain must not be partially persisted',
  )
}

testPersistencePreservesVerifiedTaskIds.description =
  'Stores completed task nodes unchanged and rejects mismatched content-addressed ids.'
