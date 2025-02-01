import { type ComputedRef, ref, watch, computed } from 'vue'

export function asyncComputed<T>(getter: () => Promise<T>, initialValue: T): ComputedRef<T> {
  const state = ref<T>(initialValue)
  const evaluate = async () => {
    state.value = await getter()
  }
  watch(getter, evaluate, { immediate: true })
  return computed(() => state.value) // Wrap in computed for write protection
}
