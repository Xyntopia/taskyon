import { scroll } from 'quasar'
import type { Ref } from 'vue'
import { computed, type ComputedRef, reactive, ref, toRefs, watch } from 'vue'
import type { ZodObject } from 'zod'
import { z } from 'zod'
import { convertZodToJsonSchemaCached } from './taskyon/types'

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

type SingleSource<O extends Record<string, unknown>> = {
  obj: O
  schema: ZodObject
  pickKeys: Array<keyof O & string>
}

export function buildSlimView<O extends Record<string, unknown>, S extends SingleSource<O>[]>(
  ...sources: S
) {
  // — your runtime code stays exactly the same —
  const pickedSchemas = sources.map(({ schema, pickKeys }) => {
    const pickedSchema = pickKeys.reduce<typeof schema.shape>((acc, k) => {
      acc[k] = schema.shape[k]
      return acc
    }, {})
    return z.object(pickedSchema)
  })
  const mergedSchema = pickedSchemas.reduce((a, b) => z.object({ ...a.shape, ...b.shape }))
  const jsonSchema = convertZodToJsonSchemaCached(mergedSchema, { unrepresentable: 'any' })

  const plainRefMap = sources.reduce(
    (acc, { obj, pickKeys }) => {
      const refs = toRefs(obj)
      pickKeys.forEach((key) => {
        acc[key] = refs[key]
      })
      return acc
    },
    {} as Record<string, unknown>,
  )

  // 4) assert the map really has the shape we typed above
  const reactiveView = reactive(plainRefMap) as {
    [K in S[number]['pickKeys'][number] & string]: {
      [I in keyof S]: K extends S[I]['pickKeys'][number] ? S[I]['obj'][K] : never
    }[number]
  }

  return { mergedSchema, jsonSchema, reactiveView }
}

export function testBuildSlimView() {
  // Setup two reactive source objects
  const obj1 = reactive({ a: 1, b: 'hello', c: true })
  const obj2 = reactive({ d: 42, e: 'world' })

  // Invocation
  const { mergedSchema, jsonSchema, reactiveView } = buildSlimView(
    {
      obj: obj1,
      schema: z.object({ a: z.number(), b: z.string(), c: z.boolean() }),
      pickKeys: ['a', 'c'],
    },
    {
      obj: obj2,
      schema: z.object({ d: z.number(), e: z.string() }),
      pickKeys: ['d'],
    },
  )

  // 1) mergedSchema should accept {a, c, d}
  try {
    mergedSchema.parse({ a: 10, c: false, d: 100 })
    console.log('✔ mergedSchema.parse works')
  } catch (e) {
    console.error('✖ mergedSchema.parse failed:', e)
  }

  // 2) jsonSchema should at least be an object
  console.assert(
    typeof jsonSchema === 'object' && jsonSchema !== null,
    'jsonSchema is not an object',
  )

  console.log(reactiveView.a)

  // 3) reactiveView initial values
  console.assert(reactiveView.a === 1, 'reactiveView.a ≠ 1')
  console.assert(reactiveView.c === true, 'reactiveView.c ≠ true')
  console.assert(reactiveView.d === 42, 'reactiveView.d ≠ 42')
  console.log('✔ reactiveView initial values OK')

  // 4) reactive updates propagate
  if (reactiveView.a) reactiveView.a = 99
  console.assert(obj1.a === 99, 'obj1.a did not update from reactiveView.a')
  if (reactiveView.d) reactiveView.d = 123
  console.assert(obj2.d === 123, 'obj2.d did not update from reactiveView.d')
  console.log('✔ updates propagate bi-directionally')

  console.log('✅ All tests passed!')
}

export function createScrollManager(
  container: Ref<HTMLElement | undefined>,
  lockScroll: Ref<boolean>,
  bottomTolerancePx = 30,
) {
  const { setVerticalScrollPosition } = scroll

  // --- Internal state ---
  let rafId: number | null = null
  const minUnlockOffset = 5 // px before we really unlock

  // --- Core scroll ---
  const scrollToBottom = (smooth = true) => {
    if (!container.value) {
      console.log('[scroll] scrollToBottom: no container')
      return
    }
    const el = container.value
    const offset = el.scrollHeight - el.clientHeight

    lockScroll.value = true
    console.log(`[scroll] scrollToBottom: to=${offset}, smooth=${smooth}`)

    setVerticalScrollPosition(el, offset, smooth ? 100 : 0)
  }

  // --- Auto scroll scheduling (rAF based) ---
  const requestAutoScroll = () => {
    if (!lockScroll.value) {
      console.log('[scroll] autoScroll skipped: lockScroll=false')
      return
    }

    if (rafId != null) {
      console.log('[scroll] autoScroll rescheduled (rAF reset)')
      cancelAnimationFrame(rafId)
    }

    rafId = requestAnimationFrame(() => {
      rafId = null
      console.log('[scroll] autoScroll executing')
      // no smooth for auto scroll → prevents drift
      scrollToBottom(false)
    })
  }

  // --- Scroll listener ---
  const onScroll = (details: { direction: string; position: { top: number } }) => {
    const el = container.value
    if (!el) {
      console.log('[scroll] onScroll: no container')
      return
    }

    const scrollEnd = el.scrollHeight - el.clientHeight
    const diff = scrollEnd - details.position.top

    console.log(`[scroll] onScroll: dir=${details.direction}, diff=${diff}`)

    if (details.direction === 'up' && diff > minUnlockOffset) {
      if (lockScroll.value) {
        console.log('[scroll] unlock scroll (user scrolled up)')
      }
      lockScroll.value = false
    } else if (details.direction === 'down' && diff < bottomTolerancePx) {
      if (!lockScroll.value) {
        console.log('[scroll] re-lock scroll (near bottom)')
      }
      lockScroll.value = true
    }
  }

  // --- Public API ---
  const cancel = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      console.log('[scroll] cancel pending autoScroll (rAF cleared)')
      rafId = null
    }
  }

  return {
    onScroll,
    scrollToBottom, // manual call, smooth param preserved
    autoScroll: requestAutoScroll, // scheduled auto scroll
    cancel,
  }
}
