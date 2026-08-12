import { findContinuationLeafTaskIds, selectTaskChainIdSelection } from '../core/taskChainSelection'
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

export const testLineageSelectionReportsImportedSubtaskProvenance = async () => {
  const tasks: TaskNode[] = [
    { id: 'root', role: 'user', content: { type: 'message', data: 'Root task' } },
    {
      id: 'planner',
      role: 'function',
      priorID: 'root',
      content: { type: 'functioncall', data: { name: 'taskPlanner', arguments: {} } },
    },
    {
      id: 'subtask-input',
      role: 'user',
      parentID: 'planner',
      content: { type: 'message', data: 'Delegated input' },
    },
    {
      id: 'subtask-intermediate',
      role: 'function',
      parentID: 'planner',
      priorID: 'subtask-input',
      content: { type: 'functioncall', data: { name: 'work', arguments: {} } },
    },
    {
      id: 'subtask-result',
      role: 'assistant',
      parentID: 'planner',
      priorID: 'subtask-intermediate',
      content: { type: 'message', data: 'Delegated result' },
    },
    {
      id: 'continue',
      role: 'user',
      priorID: 'planner',
      content: { type: 'message', data: 'Continue' },
    },
  ]
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const nextByPriorId = new Map<string, Set<string>>()
  for (const task of tasks) {
    if (!task.priorID) continue
    const nextIds = nextByPriorId.get(task.priorID) ?? new Set<string>()
    nextIds.add(task.id)
    nextByPriorId.set(task.priorID, nextIds)
  }
  const selection = await selectTaskChainIdSelection(
    'continue',
    1e9,
    { method: 'lineage' },
    {
      getTask: (id) => Promise.resolve(taskById.get(id) ?? null),
      getFlattenedChain: () => Promise.resolve([]),
      searchAllDirectChildren: (id) =>
        Promise.resolve(
          new Set(
            tasks.filter((task) => task.parentID === id && !task.priorID).map(({ id }) => id),
          ),
        ),
      findSiblingLeafTasks: (id) =>
        findContinuationLeafTaskIds(
          id,
          (taskId) => Promise.resolve(taskById.get(taskId) ?? null),
          (taskId) => Promise.resolve(nextByPriorId.get(taskId) ?? new Set()),
        ),
    },
  )

  assert(
    JSON.stringify(selection.taskIds) ===
      JSON.stringify(['root', 'planner', 'subtask-input', 'subtask-result', 'continue']),
    `Unexpected selected tasks: ${JSON.stringify(selection.taskIds)}`,
  )
  assert(
    JSON.stringify(selection.includedSubtaskTaskIds) ===
      JSON.stringify(['subtask-input', 'subtask-result']),
    `Expected explicit imported-subtask provenance, got ${JSON.stringify(selection.includedSubtaskTaskIds)}`,
  )
}

testLineageSelectionReportsImportedSubtaskProvenance.description =
  'Returns imported subtask inputs and terminal results as explicit selection provenance.'
