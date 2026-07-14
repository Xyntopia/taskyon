import type { TaskGetter, TaskNode } from '../types/taskNode'

export type TaskChainSelection =
  | {
      method: 'flattened'
      untilTaskID?: string | undefined
      onlyFirstChild?: boolean | undefined
    }
  | {
      method: 'lineage'
      includeSubtaskResults?: 'terminal-visible' | 'none' | undefined
    }

export type TaskChainSelectionAccess = {
  getTask: TaskGetter
  getFlattenedChain: (
    taskId: string,
    maxFollow: number,
    untilTaskID: string | undefined,
    onlyFirstChild: boolean,
  ) => Promise<string[]>
  searchAllDirectChildren: (taskId: string) => Promise<Set<string>>
  findSiblingLeafTasks: (taskId: string) => Promise<string[]>
}

const visibleTerminalContentTypes = new Set<TaskNode['content']['type']>([
  'message',
  'structured',
  'toolresult',
  'error',
])

const isVisibleTerminalTask = (task: TaskNode) => visibleTerminalContentTypes.has(task.content.type)

const normalizeMaxFollow = (maxFollow: number) => {
  if (!Number.isFinite(maxFollow)) return undefined
  const normalized = Math.trunc(maxFollow)
  return normalized > 0 ? normalized : 0
}

const limitTaskIds = (taskIds: string[], maxFollow: number) => {
  const limit = normalizeMaxFollow(maxFollow)
  if (limit === undefined) return taskIds
  if (limit === 0) return []
  return taskIds.slice(-limit)
}

const getRequiredTask = async (taskId: string, getTask: TaskGetter) => {
  const task = await getTask(taskId)
  if (!task) throw new Error(`Task ${taskId} not found while building task chain.`)
  return task
}

const collectLineageIds = async (taskId: string, getTask: TaskGetter) => {
  const newestFirst: string[] = []
  const visited = new Set<string>()
  let currentId: string | undefined = taskId

  while (currentId && !visited.has(currentId)) {
    visited.add(currentId)
    const task = await getRequiredTask(currentId, getTask)
    newestFirst.push(task.id)
    currentId = task.priorID ?? task.parentID
  }

  return newestFirst.reverse()
}

const resolveVisibleTerminalResults = async (
  taskId: string,
  access: TaskChainSelectionAccess,
  visited: ReadonlySet<string> = new Set(),
): Promise<string[]> => {
  if (visited.has(taskId)) return []
  const visitedWithTask = new Set([...visited, taskId])
  const task = await getRequiredTask(taskId, access.getTask)
  if (isVisibleTerminalTask(task)) return [task.id]

  if (task.content.type === 'return' && task.priorID) {
    return await resolveVisibleTerminalResults(task.priorID, access, visitedWithTask)
  }

  const childIds = Array.from(await access.searchAllDirectChildren(task.id))
  const nestedResultIds = await Promise.all(
    childIds.map(async (childId) => {
      const leafIds = await access.findSiblingLeafTasks(childId)
      return await Promise.all(
        leafIds.map((leafId) => resolveVisibleTerminalResults(leafId, access, visitedWithTask)),
      )
    }),
  )
  return Array.from(new Set(nestedResultIds.flat(2)))
}

const collectDirectSubtaskResults = async (taskId: string, access: TaskChainSelectionAccess) => {
  const childIds = Array.from(await access.searchAllDirectChildren(taskId))
  const leafResultIds = await Promise.all(
    childIds.map(async (childId) => {
      const leafIds = await access.findSiblingLeafTasks(childId)
      return await Promise.all(
        leafIds.map((leafId) => resolveVisibleTerminalResults(leafId, access)),
      )
    }),
  )

  return Array.from(new Set(leafResultIds.flat(2)))
}

const addIdOnce = (ids: string[], seen: Set<string>, id: string) => {
  if (seen.has(id)) return
  ids.push(id)
  seen.add(id)
}

const selectLineageIds = async (
  taskId: string,
  access: TaskChainSelectionAccess,
  includeSubtaskResults: 'terminal-visible' | 'none',
) => {
  const selectedIds: string[] = []
  const seen = new Set<string>()

  for (const lineageId of await collectLineageIds(taskId, access.getTask)) {
    addIdOnce(selectedIds, seen, lineageId)
    if (includeSubtaskResults === 'none') continue

    for (const resultId of await collectDirectSubtaskResults(lineageId, access)) {
      addIdOnce(selectedIds, seen, resultId)
    }
  }

  return selectedIds
}

export const selectTaskChainIds = async (
  taskId: string,
  maxFollow: number,
  selection: TaskChainSelection,
  access: TaskChainSelectionAccess,
) => {
  const traversalLimit = normalizeMaxFollow(maxFollow) ?? 1e9

  switch (selection.method) {
    case 'flattened':
      return limitTaskIds(
        await access.getFlattenedChain(
          taskId,
          traversalLimit,
          selection.untilTaskID,
          selection.onlyFirstChild ?? true,
        ),
        maxFollow,
      )
    case 'lineage':
      return limitTaskIds(
        await selectLineageIds(
          taskId,
          access,
          selection.includeSubtaskResults ?? 'terminal-visible',
        ),
        maxFollow,
      )
  }
}
