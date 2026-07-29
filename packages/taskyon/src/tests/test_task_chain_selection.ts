import { findContinuationLeafTaskIds } from '../core/taskChainSelection'
import type { TaskNode } from '../types/taskNode'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

export const testContinuationLeafTraversalUsesLocalTaskIndex = async () => {
  const tasks: TaskNode[] = [
    { id: 'selected', role: 'user', content: { type: 'message', data: 'Selected result' } },
    {
      id: 'branch-a',
      priorID: 'selected',
      role: 'assistant',
      content: { type: 'message', data: 'Branch A' },
    },
    {
      id: 'branch-a-leaf',
      priorID: 'branch-a',
      role: 'assistant',
      content: { type: 'message', data: 'Branch A leaf' },
    },
    {
      id: 'branch-b-leaf',
      priorID: 'selected',
      role: 'assistant',
      content: { type: 'message', data: 'Branch B leaf' },
    },
  ]
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const continuationIdsByPriorId = new Map<string, Set<string>>()
  for (const task of tasks) {
    if (!task.priorID) continue
    const ids = continuationIdsByPriorId.get(task.priorID) ?? new Set<string>()
    ids.add(task.id)
    continuationIdsByPriorId.set(task.priorID, ids)
  }

  const leafIds = await findContinuationLeafTaskIds(
    'selected',
    (id) => Promise.resolve(taskById.get(id) ?? null),
    (id) => Promise.resolve(continuationIdsByPriorId.get(id) ?? new Set()),
  )

  assert(
    JSON.stringify(leafIds.sort()) === JSON.stringify(['branch-a-leaf', 'branch-b-leaf']),
    `Expected both locally derived continuation leaves, got ${JSON.stringify(leafIds)}`,
  )
}

testContinuationLeafTraversalUsesLocalTaskIndex.description =
  'Derives continuation leaves from locally indexed task relationships without a protocol query.'
