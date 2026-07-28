import { recordConversationHistory, type TaskNode, type TaskyonClient } from '@taskyon/taskyon'
import type { Ref } from 'vue'

export const useConversationHistory = (options: {
  history: Ref<string[]>
  getClient: () => Pick<TaskyonClient['task'], 'get' | 'getIdChain'> | undefined
  onError: (error: unknown) => void
}) => {
  let pendingUpdate = Promise.resolve()

  const enqueue = (update: () => void | Promise<void>) => {
    pendingUpdate = pendingUpdate.then(update).catch(options.onError)
    return pendingUpdate
  }

  const record = (task: TaskNode) =>
    enqueue(async () => {
      const client = options.getClient()
      if (!client) return
      options.history.value = await recordConversationHistory(client, options.history.value, task)
    })

  const remove = (taskId: string) =>
    enqueue(() => {
      options.history.value = options.history.value.filter((id) => id !== taskId)
    })

  const clear = () =>
    enqueue(() => {
      options.history.value = []
    })

  return { record, remove, clear }
}
