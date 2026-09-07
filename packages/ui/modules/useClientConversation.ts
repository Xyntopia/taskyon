import type { TaskyonClient } from '@taskyon/taskyon/api'
import { computed, onScopeDispose, ref, watch } from 'vue'

export const useClientConversation = (
  getClient: () => TaskyonClient | undefined,
  getId: () => string | undefined,
) => {
  const revision = ref(0)
  const error = ref('')
  const loading = ref(false)
  let version = 0
  let unsubscribe: (() => void) | undefined
  let release: (() => void) | undefined
  const refresh = async () => {
    const client = getClient()
    const id = getId()
    const current = ++version
    error.value = ''
    loading.value = !!id
    if (!client || !id) {
      loading.value = false
      return
    }
    try {
      await client.taskModel.loadLineage(id)
      if (current !== version) return
      loading.value = false
      await client.taskModel.discover(id)
    } catch {
      if (current === version) error.value = 'Some conversation data is unavailable.'
    } finally {
      if (current === version) loading.value = false
    }
  }
  watch(
    getClient,
    (client) => {
      unsubscribe?.()
      unsubscribe = client?.taskModel.subscribe(() => revision.value++)
      revision.value++
    },
    { immediate: true },
  )
  watch(
    [getClient, getId],
    ([client, id]) => {
      release?.()
      release = id ? client?.taskModel.retain(id) : undefined
      void refresh()
    },
    { immediate: true },
  )
  onScopeDispose(() => {
    version++
    unsubscribe?.()
    release?.()
  })
  const tasks = computed(() => {
    void revision.value
    const id = getId()
    return id ? (getClient()?.taskModel.selection(id) ?? []) : []
  })
  return { tasks, error, loading, refresh }
}
