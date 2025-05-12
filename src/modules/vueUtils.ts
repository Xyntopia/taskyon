import type { Ref, UnwrapNestedRefs } from 'vue'
import { type ComputedRef, ref, watch, computed, toRefs, reactive } from 'vue'
import type { ZodObject, ZodRawShape } from 'zod'
import { convertZodToJsonSchemaCached } from './taskyon/types'
import type { JsonSchema7Type } from 'zod-to-json-schema'

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

// helper to extract every picked key…
// (union of all keys in all pickKeys arrays)
type PickedKeys<Sources extends readonly unknown[]> = Sources[number] extends {
  pickKeys: infer PK extends readonly PropertyKey[]
}
  ? PK[number]
  : never

// map each picked key to the correct Ref type
// for every key K, find an element with that key in its pickKeys
// then grab its obj[K]
type ReactiveView<Sources extends readonly unknown[]> = {
  [K in PickedKeys<Sources>]: Sources[number] extends {
    obj: infer O
    pickKeys: readonly (infer PK)[]
  }
    ? K extends PK
      ? Ref<O[K & keyof O]>
      : never
    : never
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
export function buildSlimView<
  const Sources extends readonly {
    obj: Record<string, unknown>
    schema: ZodObject<ZodRawShape>
    pickKeys: string[]
  }[],
>(
  sources: Sources,
): {
  mergedSchema: ZodObject<ZodRawShape>
  jsonSchema: JsonSchema7Type
  reactiveView: UnwrapNestedRefs<ReactiveView<Sources>>
} {
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

  // 1) for each source, cast toRefs(obj) to a non‐undefined map
  const allEntries = sources.flatMap(({ obj, pickKeys }) => {
    const refs = toRefs(obj) as { [K in keyof typeof obj]: Ref<(typeof obj)[K]> }
    return pickKeys.map((key) => [key, refs[key]] as const)
  })

  // 2) build + assert into your exact ReactiveView<Sources> shape
  const reactiveView = reactive(
    Object.fromEntries(allEntries) as ReactiveView<Sources>,
    // ← now TS “knows” it exactly matches ReactiveView<Sources>
  )

  return { mergedSchema, jsonSchema, reactiveView }
}
