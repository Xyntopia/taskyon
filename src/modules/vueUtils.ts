import { type ComputedRef, ref, watch, computed, toRefs, reactive } from 'vue'
import type { ZodObject, ZodRawShape } from 'zod'
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

/**
 * buildSlimView()
 *
 * @param sources
 *   Array of { obj, schema, pickKeys } tuples:
 *    - obj: a Vue reactive object
 *    - schema: a Zod.object() matching the shape of `obj`
 *    - pickKeys: subset of keys (must exist in both obj & schema)
 *
 * @returns
 *   {
 *     mergedSchema: ZodObject,     // merged Zod schema of all picks
 *     jsonSchema: any,             // JSON-Schema generated from mergedSchema
 *     reactiveView: Record<string, any> // Vue reactive view of all picks
 *   }
 */
export function buildSlimView<TObj extends object, TS extends ZodRawShape>(
  sources: Array<{
    obj: TObj
    schema: ZodObject<TS>
    pickKeys: Array<Extract<keyof TS, keyof TObj>>
  }>,
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
  const jsonSchema = convertZodToJsonSchemaCached(mergedSchema)

  // 3. build the Vue reactive view by pulling each picked ref
  const entries = sources.flatMap(({ obj, pickKeys }) =>
    pickKeys.map((key) => [key as string, toRefs(obj)[key]] as const),
  )
  const reactiveView = reactive(Object.fromEntries(entries))

  return { mergedSchema, jsonSchema, reactiveView }
}
