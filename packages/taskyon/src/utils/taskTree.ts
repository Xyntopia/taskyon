import type { TaskNode } from '../types/taskNode'

/** The caller supplies each record, so cached reads stay synchronous and remote reads can await. */
export function* walkTaskLineage(
  taskId: string,
): Generator<
  string,
  'root' | 'missing' | 'cycle',
  Pick<TaskNode, 'id' | 'priorID' | 'parentID'> | null | undefined
> {
  const visited = new Set<string>()
  let cursor: string | undefined = taskId
  while (cursor) {
    if (visited.has(cursor)) return 'cycle'
    visited.add(cursor)
    const record: Pick<TaskNode, 'id' | 'priorID' | 'parentID'> | null | undefined = yield cursor
    if (!record) return 'missing'
    cursor = record.priorID ?? record.parentID
  }
  return 'root'
}

export const addTaskRelation = (
  index: Map<string, Set<string>>,
  relatedId: string | undefined,
  taskId: string,
) => {
  if (!relatedId) return
  const ids = index.get(relatedId) ?? new Set<string>()
  ids.add(taskId)
  index.set(relatedId, ids)
}

export const removeTaskRelation = (
  index: Map<string, Set<string>>,
  relatedId: string | undefined,
  taskId: string,
) => {
  if (!relatedId) return
  const ids = index.get(relatedId)
  if (!ids) return
  ids.delete(taskId)
  if (!ids.size) index.delete(relatedId)
}
