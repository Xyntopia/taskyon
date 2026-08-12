import type { TaskNode } from '../../../taskyon/src/types/taskNode'

export const TYCLI_ACTIVE_TASK_WAIT_TIMEOUT_MS = 25 * 60 * 60_000

export const isInteractiveTaskResult = (task: TaskNode) =>
  task.content.type === 'message' || task.content.type === 'error'
