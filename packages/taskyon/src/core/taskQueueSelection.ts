import type { TaskNode } from '../types/taskNode'
import type { TyTaskStreamData } from './taskWorker'

const pendingStages = new Set<TyTaskStreamData['stage']>(['queued', 'waiting'])
const activeStages = new Set<TyTaskStreamData['stage']>([
  'processing',
  'in loop',
  'subtasks',
  'tool progress',
])

export type TaskQueueBranch = {
  tasks: readonly TaskNode[]
  pendingTasks: TaskNode[]
  activeTasks: TaskNode[]
}

const taskCreatedAt = (task: TaskNode) => task.created_at ?? 0

export const getTaskQueueLabel = (task: TaskNode): string => {
  if (task.name) return task.name
  if (task.content.type === 'message') {
    const lines = task.content.data
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    return lines[0] === 'Task objective:' ? (lines[1] ?? lines[0]) : (lines[0] ?? 'Queued task')
  }
  return task.content.type === 'functioncall' ? task.content.data.name : task.content.type
}

export const selectSiblingTaskChain = (lineage: readonly TaskNode[]): TaskNode[] => {
  const selectedTask = lineage.at(-1)
  if (!selectedTask) return []
  return lineage.filter((task) => task.parentID === selectedTask.parentID)
}

export const selectChildTaskChains = (
  parentId: string,
  tasks: Iterable<TaskNode>,
): TaskNode[][] => {
  const childTasks = [...tasks].filter((task) => task.parentID === parentId)
  const taskById = new Map(childTasks.map((task) => [task.id, task]))
  const nextByPriorId = new Map<string, TaskNode[]>()
  for (const task of childTasks) {
    if (!task.priorID) continue
    const nextTasks = nextByPriorId.get(task.priorID) ?? []
    nextTasks.push(task)
    nextByPriorId.set(task.priorID, nextTasks)
  }

  return childTasks
    .filter((task) => !task.priorID || !taskById.has(task.priorID))
    .sort((left, right) => taskCreatedAt(left) - taskCreatedAt(right))
    .map((root) => {
      const chain: TaskNode[] = []
      const visited = new Set<string>()
      let current: TaskNode | undefined = root
      while (current && !visited.has(current.id)) {
        visited.add(current.id)
        chain.push(current)
        current = nextByPriorId
          .get(current.id)
          ?.toSorted((left, right) => taskCreatedAt(left) - taskCreatedAt(right))
          .at(-1)
      }
      return chain
    })
}

export const selectTaskQueueBranches = (
  taskChains: readonly (readonly TaskNode[])[],
  stageByTaskId: ReadonlyMap<string, TyTaskStreamData['stage']>,
): TaskQueueBranch[] => {
  const uniqueChains = new Map<string, readonly TaskNode[]>()
  for (const tasks of taskChains) {
    const rootId = tasks[0]?.id
    if (rootId) uniqueChains.set(rootId, tasks)
  }

  return [...uniqueChains.values()]
    .map((tasks) => ({
      tasks,
      pendingTasks: tasks.filter((task) => {
        const stage = stageByTaskId.get(task.id)
        return stage !== undefined && pendingStages.has(stage)
      }),
      activeTasks: tasks.filter((task) => {
        const stage = stageByTaskId.get(task.id)
        return stage !== undefined && activeStages.has(stage)
      }),
    }))
    .filter((branch) => branch.pendingTasks.length > 0 || branch.activeTasks.length > 0)
}
