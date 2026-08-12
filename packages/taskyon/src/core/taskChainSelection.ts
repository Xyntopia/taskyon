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

export const findContinuationLeafTaskIds = async (
  taskId: string,
  getTask: TaskGetter,
  findNextTaskIds: (taskId: string) => Promise<ReadonlySet<string>>,
): Promise<string[]> => {
  const pending = [taskId]
  const visited = new Set<string>()
  const leafIds: string[] = []

  while (pending.length > 0) {
    const currentId = pending.pop()
    if (!currentId || visited.has(currentId)) continue
    visited.add(currentId)
    if (!(await getTask(currentId))) continue

    const nextIds = await findNextTaskIds(currentId)
    if (nextIds.size === 0) leafIds.push(currentId)
    else pending.push(...nextIds)
  }

  return leafIds
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

const limitTaskIdSelection = (
  selection: { taskIds: string[]; includedSubtaskTaskIds: string[] },
  maxFollow: number,
) => {
  const taskIds = limitTaskIds(selection.taskIds, maxFollow)
  const retainedTaskIds = new Set(taskIds)
  return {
    taskIds,
    includedSubtaskTaskIds: selection.includedSubtaskTaskIds.filter((id) =>
      retainedTaskIds.has(id),
    ),
  }
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

const collectBranchInputIds = async (
  parentTaskId: string,
  leafIds: readonly string[],
  access: TaskChainSelectionAccess,
) => {
  const inputIds: string[] = []
  for (const leafId of leafIds) {
    let currentId: string | undefined = leafId
    const newestFirst: string[] = []
    const visited = new Set<string>()
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId)
      const task = await getRequiredTask(currentId, access.getTask)
      if (task.parentID !== parentTaskId) break
      if (task.role === 'user' && task.content.type === 'message') newestFirst.push(task.id)
      currentId = task.priorID
    }
    inputIds.push(...newestFirst.reverse())
  }
  return Array.from(new Set(inputIds))
}

const collectDirectSubtaskTasks = async (taskId: string, access: TaskChainSelectionAccess) => {
  const childIds = Array.from(await access.searchAllDirectChildren(taskId))
  const branchHandoffs = await Promise.all(
    childIds.map(async (childId) => {
      const leafIds = await access.findSiblingLeafTasks(childId)
      const resultIds = await Promise.all(
        leafIds.map((leafId) => resolveVisibleTerminalResults(leafId, access)),
      )
      return [...(await collectBranchInputIds(taskId, leafIds, access)), ...resultIds.flat()]
    }),
  )

  return Array.from(new Set(branchHandoffs.flat()))
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
  const includedSubtaskTaskIds: string[] = []
  const seen = new Set<string>()
  const includedSubtaskSeen = new Set<string>()

  const lineageIds = await collectLineageIds(taskId, access.getTask)
  for (const [index, lineageId] of lineageIds.entries()) {
    addIdOnce(selectedIds, seen, lineageId)
    if (includeSubtaskResults === 'none') continue

    const nextLineageTaskId = lineageIds[index + 1]
    const nextLineageTask = nextLineageTaskId
      ? await getRequiredTask(nextLineageTaskId, access.getTask)
      : undefined
    if (nextLineageTask?.parentID === lineageId) continue

    for (const subtaskTaskId of await collectDirectSubtaskTasks(lineageId, access)) {
      addIdOnce(selectedIds, seen, subtaskTaskId)
      addIdOnce(includedSubtaskTaskIds, includedSubtaskSeen, subtaskTaskId)
    }
  }

  return { taskIds: selectedIds, includedSubtaskTaskIds }
}

export const selectTaskChainIdSelection = async (
  taskId: string,
  maxFollow: number,
  selection: TaskChainSelection,
  access: TaskChainSelectionAccess,
) => {
  const traversalLimit = normalizeMaxFollow(maxFollow) ?? 1e9

  switch (selection.method) {
    case 'flattened':
      return limitTaskIdSelection(
        {
          taskIds: await access.getFlattenedChain(
            taskId,
            traversalLimit,
            selection.untilTaskID,
            selection.onlyFirstChild ?? true,
          ),
          includedSubtaskTaskIds: [],
        },
        maxFollow,
      )
    case 'lineage':
      return limitTaskIdSelection(
        await selectLineageIds(
          taskId,
          access,
          selection.includeSubtaskResults ?? 'terminal-visible',
        ),
        maxFollow,
      )
  }
}

export const selectTaskChainIds = async (
  taskId: string,
  maxFollow: number,
  selection: TaskChainSelection,
  access: TaskChainSelectionAccess,
) => (await selectTaskChainIdSelection(taskId, maxFollow, selection, access)).taskIds
