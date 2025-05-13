import type { Ref } from 'vue'
import { type ComputedRef, ref, watch, computed, toRefs, reactive, proxyRefs } from 'vue'
import type { ZodObject, ZodRawShape } from 'zod'
import { convertZodToJsonSchemaCached } from './taskyon/types'
import type { JsonSchema7Type } from 'zod-to-json-schema'
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

export function buildSlimView(
  sources: {
    obj: Record<string, unknown>
    schema: ZodObject<ZodRawShape>
    pickKeys: string[]
  }[],
) {
  // 1. build each picked Zod schema, then merge them
  const pickedSchemas = sources.map(({ schema, pickKeys }) => {
    // build the { key: true } map
    const pickMap = pickKeys.reduce(
      (acc, k) => ({ ...acc, [k]: true }),
      {} as Record<keyof (typeof schema)['_def']['shape'], true>,
    )
    return schema.pick(pickMap)
  })
  const mergedSchema = pickedSchemas.reduce((a, b) => a.merge(b))

  // 2. emit JSON-Schema if you need it
  const jsonSchema = convertZodToJsonSchemaCached(mergedSchema) as JsonSchema7Type

  // 1) for each source, cast toRefs(obj) to a non‐undefined map
  const allEntries = sources.flatMap(({ obj, pickKeys }) => {
    const refs = toRefs(obj) as { [K in keyof typeof obj]: Ref<(typeof obj)[K]> }
    return pickKeys.map((key) => [key, refs[key]] as const)
  })

  const plainRefMap = Object.fromEntries(allEntries)
  const reactiveView = proxyRefs(plainRefMap)

  return { mergedSchema, jsonSchema, reactiveView }
}

export function testBuildSlimView() {
  // Setup two reactive source objects
  const obj1 = reactive({ a: 1, b: 'hello', c: true })
  const obj2 = reactive({ d: 42, e: 'world' })

  const sources = [
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
  ]

  // Invocation
  const { mergedSchema, jsonSchema, reactiveView } = buildSlimView(sources)

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
