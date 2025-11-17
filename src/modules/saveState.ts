import type { Ref } from 'vue'
import { computed, watch } from 'vue'

export function syncRefsWithLocalStorage(key: string, refs: Record<string, Ref<unknown>>) {
  // Load saved state if available
  const savedRaw = localStorage.getItem(key)
  if (savedRaw) {
    try {
      const saved = JSON.parse(savedRaw)
      for (const k in refs) {
        if (k in saved) {
          // assign saved value to the ref
          refs[k]!.value = saved[k as keyof typeof saved]
        }
      }
    } catch {
      /* ignore parse errors */
    }
  }

  // Wrap the refs into a computed POJO of plain values.
  // This computed *depends* on each ref.value, so it updates when any ref changes.
  const wrapped = computed(() => {
    const out: Record<string, unknown> = {}
    for (const k in refs) {
      out[k] = refs[k]!.value
    }
    return out
  })

  // Watch the computed wrapper and persist the plain object to localStorage.
  watch(
    wrapped,
    (newVals) => {
      try {
        localStorage.setItem(key, JSON.stringify(newVals))
      } catch (e) {
        console.error('Failed to save state to localStorage', e)
      }
    },
    { deep: true },
  )
}
