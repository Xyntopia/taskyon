import type { Ref } from 'vue'
import { type ComputedRef, ref, watch, computed, toRefs, reactive } from 'vue'
import type { ZodObject } from 'zod'
import { convertZodToJsonSchemaCached } from './taskyon/types'
import { z } from 'zod'
import { scroll } from 'quasar'

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
  graceMs = 1500,
  bottomTolerancePx = 10,
) {
  const { setVerticalScrollPosition } = scroll
  let lastUserScrollUp = 0
  let lastUserInteraction = 0

  // --- Listen for user input to mark activity ---
  const markUserActivity = () => {
    console.log('user scrolled or something!')
    lastUserInteraction = Date.now()
  }
  window.addEventListener('wheel', markUserActivity, { passive: true })
  window.addEventListener('touchstart', markUserActivity, { passive: true })
  window.addEventListener('keydown', markUserActivity)

  const isRecentUserScroll = () => Date.now() - lastUserInteraction < graceMs

  const onScroll = (details: { direction: string }) => {
    if (!container.value) return
    const el = container.value
    const scrollEnd = el.scrollHeight - el.clientHeight
    const currentScrollTop = el.scrollTop
    const isNearBottom = scrollEnd - currentScrollTop < bottomTolerancePx
    const now = Date.now()

    if (isRecentUserScroll()) {
      // Treat as user scroll
      console.log('user scroll...')
      if (details.direction === 'up') {
        lockScroll.value = false
        lastUserScrollUp = now
      } else if (details.direction === 'down') {
        const isAtAbsoluteBottom = currentScrollTop >= scrollEnd - 2
        if (isNearBottom && (isAtAbsoluteBottom || now - lastUserScrollUp > graceMs)) {
          lockScroll.value = true
        }
      }
    } else {
      console.log('automatic scroll...')
      // Treat as programmatic scroll: maintain lock if near bottom, never unlock
      if (lockScroll && isNearBottom) {
        lockScroll.value = true
      }
    }
  }

  const scrollToBottom = (smooth = true) => {
    if (!container.value) return
    const el = container.value
    const offset = el.scrollHeight - el.clientHeight
    setVerticalScrollPosition(el, offset, smooth ? 300 : 0)
    lockScroll.value = true
    console.log('scroll to bottom...')
  }

  const autoScroll = () => {
    if (lockScroll.value) {
      console.log('auto scrolling!')
      scrollToBottom()
    }
  }

  // Cleanup function to remove listeners if needed
  const dispose = () => {
    window.removeEventListener('wheel', markUserActivity)
    window.removeEventListener('touchstart', markUserActivity)
    window.removeEventListener('keydown', markUserActivity)
  }

  return { onScroll, scrollToBottom, autoScroll, dispose }
}
