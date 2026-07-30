import type { TaskyonStorageClient } from '@taskyon/taskyon/api'
import { computed, isReactive, isRef, toRaw, watch } from 'vue'

const applyStoredState = (state: Record<string, unknown>, stored: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(stored)) {
    const target = state[key]
    if (isRef(target)) target.value = value
    else if (isReactive(target) && value && typeof value === 'object') {
      Object.assign(target as Record<string, unknown>, value)
    } else state[key] = value
  }
}

export const syncStateWithStorageClient = async (
  storageClient: TaskyonStorageClient,
  location: { namespace: string; id: string },
  state: Record<string, unknown>,
) => {
  const stored = await storageClient.get(location)
  if (stored.value && typeof stored.value === 'object' && !Array.isArray(stored.value)) {
    applyStoredState(state, stored.value as Record<string, unknown>)
  }

  const snapshot = computed(() => {
    const values: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(toRaw(state))) {
      values[key] = toRaw(isRef(value) ? value.value : value)
    }
    return values
  })
  let write = Promise.resolve()
  const stop = watch(
    snapshot,
    (value) => {
      write = write
        .catch((error) => console.error('Failed to persist state through StorageClient', error))
        .then(async () => storageClient.set({ ...location, value }))
        .then(() => undefined)
    },
    { deep: true },
  )
  return { stop, flush: async () => await write }
}
