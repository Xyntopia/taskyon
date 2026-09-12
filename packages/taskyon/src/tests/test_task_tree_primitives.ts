import { walkTaskLineage, addTaskRelation, removeTaskRelation } from '../utils/taskTree'
import { createTaskRecordHydrator } from '../utils/taskRecords'
import { taskNodeToRecord } from '../core/createTasks'
import type { TaskNode } from '../types/taskNode'

export const testSharedLineageWalker = () => {
  const walk = walkTaskLineage('leaf')
  if (walk.next().value !== 'leaf') throw new Error('Must begin at the selected task.')
  if (walk.next({ id: 'leaf', priorID: 'prior', parentID: 'parent' }).value !== 'prior')
    throw new Error('A prior link must take precedence over the parent.')
  if (walk.next({ id: 'prior', parentID: 'parent' }).value !== 'parent')
    throw new Error('Must follow the parent when there is no prior link.')
  const missing = walk.next(undefined)
  if (!missing.done || missing.value !== 'missing')
    throw new Error('Missing data must be explicit.')
  const cycle = walkTaskLineage('cycle')
  cycle.next()
  const stopped = cycle.next({ id: 'cycle', priorID: 'cycle' })
  if (!stopped.done || stopped.value !== 'cycle') throw new Error('Cycles must terminate.')
}
testSharedLineageWalker.description =
  'Shares lineage edge precedence and termination without prescribing synchronous or asynchronous reads.'

export const testSharedTaskRelationIndex = () => {
  const index = new Map<string, Set<string>>()
  addTaskRelation(index, 'parent', 'a')
  addTaskRelation(index, 'parent', 'b')
  addTaskRelation(index, 'parent', 'a')
  if (index.get('parent')?.size !== 2) throw new Error('Relation index must deduplicate IDs.')
  removeTaskRelation(index, 'parent', 'a')
  if (!index.get('parent')?.has('b')) throw new Error('Removing one relation removed another.')
  removeTaskRelation(index, 'parent', 'b')
  if (index.has('parent')) throw new Error('Empty index entries must be removed.')
}
testSharedTaskRelationIndex.description =
  'Uses the same relation index maintenance for core and client caches.'

export const testSharedTaskRecordHydration = async () => {
  const task: TaskNode = {
    id: 'task',
    role: 'assistant',
    content: { type: 'message', data: 'Answer' },
  }
  const record = taskNodeToRecord(task)
  let reads = 0
  const hydrator = createTaskRecordHydrator(() => {
    reads++
    return Promise.resolve({ id: record.contentRef, content: task.content })
  }, 2)
  await hydrator.hydrate(record)
  const second = await hydrator.hydrate({ ...record, id: 'another-occurrence' })
  if (reads !== 1 || second.id !== 'another-occurrence')
    throw new Error('Content cache must preserve occurrence identity.')
  hydrator.clear()
  await hydrator.hydrate(record)
  if (Number(reads) !== 2) throw new Error('Clearing hydration cache must force another read.')
}
testSharedTaskRecordHydration.description =
  'Shares verified hydration while keeping the content cache scoped to its owner.'
