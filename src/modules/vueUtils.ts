import { type ComputedRef, ref, watch, computed } from 'vue'

export function asyncComputed<T>(
  getter: () => Promise<T>,
  initialValue: T,
  dependencies?: Parameters<typeof watch>[0], // Explicitly track these
): ComputedRef<T> {
  const state = ref<T>(initialValue)

  watch(
    dependencies ?? getter,
    async () => {
      state.value = await getter()
    },
    { immediate: true },
  )

  return computed(() => state.value) // Read-only computed value
}
