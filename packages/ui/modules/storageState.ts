import type { TaskyonStorageClient } from '@taskyon/taskyon/api'
import { isReactive, isRef, watch } from 'vue'

const snapshotStorageValue = (value: unknown): unknown => {
  const resolved = isRef(value) ? value.value : value
  if (Array.isArray(resolved)) return resolved.map(snapshotStorageValue)
  if (resolved instanceof Date) return new Date(resolved)
  if (resolved instanceof Uint8Array) return new Uint8Array(resolved)
  if (resolved && typeof resolved === 'object') {
    return Object.fromEntries(
      Object.entries(resolved).map(([key, entry]) => [key, snapshotStorageValue(entry)]),
    )
  }
  return resolved
}

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

  let write = Promise.resolve()
  const stop = watch(
    () =>
      Object.fromEntries(
        Object.entries(state).map(([key, value]) => [key, isRef(value) ? value.value : value]),
      ),
    (value) => {
      const snapshot = snapshotStorageValue(value)
      write = write
        .catch((error) => console.error('Failed to persist state through StorageClient', error))
        .then(async () =>
          storageClient.set({
            ...location,
            value: snapshot,
          }),
        )
        .then(() => undefined)
    },
    { deep: true, flush: 'sync' },
  )
  return { stop, flush: async () => await write }
}
