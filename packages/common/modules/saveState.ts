import type { Ref } from 'vue'
import { computed, watch } from 'vue'

export function syncRefsWithLocalStorage(
  key: string,
  refs: Record<string, Ref<unknown>>,
  options: { debounceMs?: number } = {},
) {
  const savedRaw = localStorage.getItem(key)
  if (savedRaw) {
    try {
      const saved = JSON.parse(savedRaw) as Record<string, unknown>
      for (const name in refs) {
        if (name in saved) refs[name]!.value = saved[name]
      }
    } catch {
      // Ignore invalid state left by a previous browser session.
    }
  }

  const values = computed(() =>
    Object.fromEntries(Object.entries(refs).map(([name, value]) => [name, value.value])),
  )
  let debounceHandle: ReturnType<typeof setTimeout> | undefined
  watch(
    values,
    (nextValues) => {
      const persist = () => {
        try {
          localStorage.setItem(key, JSON.stringify(nextValues))
        } catch (error) {
          console.error('Failed to save state to localStorage', error)
        }
      }
      if (!options.debounceMs) {
        persist()
        return
      }
      clearTimeout(debounceHandle)
      debounceHandle = setTimeout(persist, options.debounceMs)
    },
    { deep: true },
  )
}
