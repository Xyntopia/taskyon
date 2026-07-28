import type { TaskyonClient } from '../api'
import type { TaskNode } from '../types/taskNode'
import { generateTaskKeyWords } from './taskUtils'

type ConversationHistoryTaskClient = Pick<TaskyonClient['task'], 'get' | 'getIdChain'>
type ConversationTitleTaskClient = Pick<TaskyonClient['task'], 'get' | 'getChain'>

const MAX_CONVERSATION_HISTORY = 50

const containsChildOf = async (
  client: ConversationHistoryTaskClient,
  history: readonly string[],
  taskId: string,
) => {
  const tasks = await Promise.all(history.map((id) => client.get({ id })))
  return tasks.some((task) => task?.priorID === taskId || task?.parentID === taskId)
}

export const recordConversationHistory = async (
  client: ConversationHistoryTaskClient,
  history: readonly string[],
  task: TaskNode,
): Promise<string[]> => {
  if (history[0] === task.id) return [...history]
  if (await containsChildOf(client, history, task.id)) return [...history]

  const chainIds = await client.getIdChain({ id: task.id, maxFollow: MAX_CONVERSATION_HISTORY })
  const obsoleteIds = new Set([
    ...chainIds.slice(0, -1),
    ...(task.priorID ? [task.priorID] : []),
    ...(task.parentID ? [task.parentID] : []),
  ])

  return [task.id, ...history.filter((id) => id !== task.id && !obsoleteIds.has(id))].slice(
    0,
    MAX_CONVERSATION_HISTORY,
  )
}

export const resolveConversationTitle = async (
  client: ConversationTitleTaskClient,
  taskId: string,
): Promise<string | undefined> => {
  const task = await client.get({ id: taskId })
  if (!task) return undefined

  const taskChain = await client.getChain({ id: taskId })
  const existingName = taskChain.findLast(({ name }) => !!name?.trim())?.name?.trim()
  if (existingName) return existingName

  const [generatedName] = await generateTaskKeyWords(task, taskChain, {
    mode: 'first-words',
    maxWords: 4,
  })
  return generatedName
}
