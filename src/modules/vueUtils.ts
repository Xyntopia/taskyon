import { scroll } from 'quasar'
import type { Ref } from 'vue'
import { computed, type ComputedRef, reactive, ref, toRefs, watch } from 'vue'
import { z } from 'zod'

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

type JsonSchemaObject = {
  type?: string
  properties?: Record<string, unknown>
  required?: string[]
}

type SingleSource<O extends Record<string, unknown>> = {
  obj: O
  schema: JsonSchemaObject
  pickKeys: Array<keyof O & string>
}

export function buildSlimView<O extends Record<string, unknown>, S extends SingleSource<O>[]>(
  ...sources: S
) {
  const mergedJsonSchema: JsonSchemaObject = sources.reduce(
    (acc, { schema, pickKeys }) => {
      const srcProps = schema.properties ?? {}
      const srcRequired = Array.isArray(schema.required) ? schema.required : []

      const pickedProps: Record<string, unknown> = {}
      const pickedRequired: string[] = []

      pickKeys.forEach((key) => {
        if (key in srcProps) {
          pickedProps[key] = srcProps[key]
          if (srcRequired.includes(key)) {
            pickedRequired.push(key)
          }
        }
      })

      const accProps = acc.properties ?? {}
      const accRequired = Array.isArray(acc.required) ? acc.required : []

      return {
        ...acc,
        type: 'object',
        properties: {
          ...accProps,
          ...pickedProps,
        },
        required: [...accRequired, ...pickedRequired.filter((key) => !accRequired.includes(key))],
      }
    },
    { type: 'object', properties: {}, required: [] } as JsonSchemaObject,
  )

  const jsonSchema = mergedJsonSchema

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

  return { jsonSchema, reactiveView }
}

export function testBuildSlimView() {
  // Setup reactive source objects
  const obj1 = reactive({ a: 1, b: 'hello', c: true })
  const obj2 = reactive({ d: 42, e: 'world' })

  // Zod schemas for testing, converted to JSON Schema just before usage
  const zodSchema1 = z.object({ a: z.number(), b: z.string(), c: z.boolean() })
  const zodSchema2 = z.object({ d: z.number(), e: z.string() })

  const jsonSchema1 = z.toJSONSchema(zodSchema1, { unrepresentable: 'any' })
  const jsonSchema2 = z.toJSONSchema(zodSchema2, { unrepresentable: 'any' })

  // Invocation using JSON Schemas
  const { jsonSchema, reactiveView } = buildSlimView(
    {
      obj: obj1,
      schema: jsonSchema1,
      pickKeys: ['a', 'c'],
    },
    {
      obj: obj2,
      schema: jsonSchema2,
      pickKeys: ['d'],
    },
  )

  // 1) jsonSchema should describe exactly the picked keys
  console.assert(
    typeof jsonSchema === 'object' && jsonSchema !== null && jsonSchema.type === 'object',
    'jsonSchema is not a valid object schema',
  )

  const properties = jsonSchema.properties ?? {}
  console.assert('a' in properties, 'jsonSchema missing property "a"')
  console.assert('c' in properties, 'jsonSchema missing property "c"')
  console.assert('d' in properties, 'jsonSchema missing property "d"')
  console.assert(!('b' in properties), 'jsonSchema should not contain unpicked property "b"')
  console.assert(!('e' in properties), 'jsonSchema should not contain unpicked property "e"')
  console.log('✔ jsonSchema properties match picked keys')

  const required = Array.isArray(jsonSchema.required) ? jsonSchema.required : []
  console.assert(required.includes('a'), '"a" should be required')
  console.assert(required.includes('c'), '"c" should be required')
  console.assert(required.includes('d'), '"d" should be required')
  console.log('✔ jsonSchema required keys look correct')

  // 2) reactiveView initial values
  console.assert(reactiveView.a === 1, 'reactiveView.a ≠ 1')
  console.assert(reactiveView.c === true, 'reactiveView.c ≠ true')
  console.assert(reactiveView.d === 42, 'reactiveView.d ≠ 42')
  console.log('✔ reactiveView initial values OK')

  // 3) reactive updates propagate from view to sources
  reactiveView.a = 99
  console.assert(obj1.a === 99, 'obj1.a did not update from reactiveView.a')
  reactiveView.d = 123
  console.assert(obj2.d === 123, 'obj2.d did not update from reactiveView.d')
  console.log('✔ updates propagate view → source')

  // 4) reactive updates propagate from sources to view
  obj1.c = false
  obj2.d = 777
  console.assert(reactiveView.c === false, 'reactiveView.c did not update from obj1.c')
  console.assert(reactiveView.d === 777, 'reactiveView.d did not update from obj2.d')
  console.log('✔ updates propagate source → view')

  // 5) second scenario: additional source with overlapping and optional keys
  const obj3 = reactive({ a: 5, f: 'extra' as string | undefined })
  const zodSchema3 = z.object({ a: z.number(), f: z.string().optional() })
  const jsonSchema3 = z.toJSONSchema(zodSchema3, { unrepresentable: 'any' })

  const { jsonSchema: jsonSchemaScenario2, reactiveView: reactiveView2 } = buildSlimView(
    {
      obj: obj1,
      schema: jsonSchema1,
      pickKeys: ['a'],
    },
    {
      obj: obj3,
      schema: jsonSchema3,
      pickKeys: ['f'],
    },
  )

  const properties2 = jsonSchemaScenario2.properties ?? {}
  console.assert('a' in properties2, 'scenario2: missing "a" in json schema')
  console.assert('f' in properties2, 'scenario2: missing "f" in json schema')

  reactiveView2.a = 200
  console.assert(obj1.a === 200, 'scenario2: obj1.a did not update from reactiveView2.a')
  obj3.f = 'updated'
  console.assert(
    reactiveView2.f === 'updated',
    'scenario2: reactiveView2.f did not update from obj3.f',
  )
  console.log('✔ scenario 2 (overlapping / optional) behaves correctly')

  console.log('✅ All tests passed!')
}

export function createScrollManager(
  container: Ref<HTMLElement | undefined>,
  lockScroll: Ref<boolean>,
  selector: string,
  bottomTolerancePx = 30,
) {
  const { setVerticalScrollPosition } = scroll

  // --- Internal state ---
  let rafId: number | null = null
  const minUnlockOffset = 5 // px before we really unlock
  const buttonHideTolerancePx = 30 // px range near edges where buttons consider us "at" top/bottom
  const showTopButtons = ref(false)
  const showBottomButtons = ref(true)

  // --- Core scroll ---
  const scrollToBottom = (smooth = true) => {
    if (!container.value) return
    const el = container.value
    const offset = el.scrollHeight - el.clientHeight

    lockScroll.value = true

    setVerticalScrollPosition(el, offset, smooth ? 100 : 0)
  }

  // --- Auto scroll scheduling (rAF based) ---
  const requestAutoScroll = () => {
    if (!lockScroll.value) return
    if (rafId != null) cancelAnimationFrame(rafId)

    rafId = requestAnimationFrame(() => {
      rafId = null
      // no smooth for auto scroll → prevents drift
      scrollToBottom(false)
    })
  }

  // --- Scroll listener ---
  const onScroll = (details: { direction: string; position: { top: number } }) => {
    const el = container.value
    if (!el) return

    const scrollEnd = el.scrollHeight - el.clientHeight
    const diff = scrollEnd - details.position.top

    const atTopForButtons = details.position.top <= buttonHideTolerancePx
    const atBottomForButtons = diff <= buttonHideTolerancePx

    showTopButtons.value = !atTopForButtons
    showBottomButtons.value = !atBottomForButtons

    if (details.direction === 'up' && diff > minUnlockOffset) lockScroll.value = false
    else if (details.direction === 'down' && diff < bottomTolerancePx) lockScroll.value = true
  }

  // --- Public API ---
  const cancel = () => {
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function getMessageElements(): HTMLElement[] {
    const con = container.value
    if (!con) return []
    return Array.from(con.querySelectorAll<HTMLElement>(selector))
  }

  function scrollToTop() {
    // manual navigation should always unlock bottom-lock & cancel auto-scroll
    cancel()
    lockScroll.value = false

    const con = container.value
    if (!con) return
    con.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function scrollToNext() {
    // manual navigation should always unlock bottom-lock & cancel auto-scroll
    cancel()
    lockScroll.value = false

    const cont = container.value
    if (!cont) return

    const containerRect = cont.getBoundingClientRect()
    const messages = getMessageElements()

    let next: HTMLElement | null = null
    let nextOffset = Infinity

    for (const el of messages) {
      const rect = el.getBoundingClientRect()
      const offset = rect.top - containerRect.top // distance from top of scroll area

      // we want the first message clearly below the current viewport start
      if (offset > 8 && offset < nextOffset) {
        next = el
        nextOffset = offset
      }
    }

    if (next) {
      next.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function scrollToPrev() {
    // manual navigation should always unlock bottom-lock & cancel auto-scroll
    cancel()
    lockScroll.value = false

    const con = container.value
    if (!con) return

    const containerRect = con.getBoundingClientRect()
    const messages = getMessageElements()

    let prev: HTMLElement | null = null
    let prevOffset = -Infinity

    for (const el of messages) {
      const rect = el.getBoundingClientRect()
      const offset = rect.top - containerRect.top

      // we want the last message clearly above the current viewport start
      if (offset < -8 && offset > prevOffset) {
        prev = el
        prevOffset = offset
      }
    }

    if (prev) {
      prev.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return {
    onScroll,
    scrollToBottom, // manual call, smooth param preserved
    autoScroll: requestAutoScroll, // scheduled auto scroll
    cancel,
    scrollToTop,
    scrollToNext,
    scrollToPrev,
    showTopButtons,
    showBottomButtons,
  }
}
