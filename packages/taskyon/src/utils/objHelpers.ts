import { deepEqual } from 'fast-equals'
import type { RemoveUndefined, Thunk } from './tsHelpers'

type Key = string | number | symbol
type Indexable = Record<Key, unknown>

export const getByPath =
  (path: readonly Key[]) =>
  (obj: Indexable): unknown =>
    path.reduce<unknown>(
      (acc, key) => (acc != null && typeof acc === 'object' ? (acc as Indexable)[key] : undefined),
      obj,
    )

export const removeKeys = <T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> => {
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !keys.includes(key as K)),
  ) as Omit<T, K>
}

export function removeUndefinedProperties<T extends object>(obj: T): RemoveUndefined<T, keyof T> {
  return Object.entries(obj).reduce(
    (acc, [key, value]) => {
      if (value !== undefined) {
        ;(acc as Record<string, unknown>)[key] = value
      }
      return acc
    },
    {} as Record<keyof T, unknown>,
  ) as RemoveUndefined<T, keyof T>
}

export function deepCloneWJson<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

type ProxyApi<T, K extends readonly (keyof T)[]> = {
  [P in K[number]]: T[P] extends (...args: infer A) => infer R ? (...args: A) => R : () => T[P]
}

export const createProxyFunction = <F extends (...args: Parameters<F>) => ReturnType<F>>(
  f: Thunk<F>,
) => ((...args: Parameters<F>) => f()(...args)) as F

export function createProxyApi<T extends object, const K extends readonly (keyof T)[]>(
  obj: Thunk<T>,
  names: K,
): ProxyApi<T, K> {
  const api: Partial<Record<keyof T, unknown>> = {}

  for (const key of names) {
    const val = obj()[key]
    if (typeof val === 'function') {
      // Preserve `this` if the method uses it
      api[key] = (...args: unknown[]) => {
        // we have to load obj again here, because it might have changed
        // thats why we have the proxy in the first place!
        const f = obj()[key] as (...args: unknown[]) => unknown
        return f(...args)
      }
    } else {
      api[key] = () => obj()[key]
    }
  }

  return api as ProxyApi<T, K>
}

export async function first<T>(source: AsyncIterable<T> | Iterable<T>): Promise<T | undefined> {
  for await (const item of source) {
    return item
  }
  return undefined
}

export function bigIntToString(obj: unknown): unknown {
  if (obj === null) {
    return obj
  }

  if (typeof obj === 'bigint') {
    return obj.toString()
  }

  if (obj instanceof Map) {
    const result: { [key: string]: unknown } = {}
    obj.forEach((value, key) => {
      result[key] = bigIntToString(value)
    })
    return result
  }

  if (obj instanceof Set) {
    return Array.from(obj).map((item) => bigIntToString(item))
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => bigIntToString(item))
  }

  // this need to be called at the end, becaise Set and Map are also object
  if (typeof obj === 'object') {
    const result: { [key: string]: unknown } = {}
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = bigIntToString((obj as Record<string, unknown>)[key])
      }
    }
    return result
  }

  return obj
}

/**
 * Checks if the given item is an object (excluding null and arrays).
 *
 * @param item - The item to check.
 * @returns True if the item is an object, false otherwise.
 */
function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item)
}

/**
 * Creates a new array that is a union of the elements in arr1 and arr2.
 * Duplicates are removed so that the resulting array contains only unique elements.
 *
 * @param arr1 - The first array.
 * @param arr2 - The second array.
 * @returns A new array with unique elements from both input arrays.
 */
function unionArrays(arr1: unknown[], arr2: unknown[]) {
  const combined = arr1.concat(arr2)
  return combined.filter(
    (item, index) => combined.findIndex((obj) => deepEqual(obj, item)) === index,
  )
}

/**
 * Deeply merges two objects.
 * For objects, it recursively merges their properties.
 * For arrays, it either overwrites (obj1's array is replaced by obj2's) or
 * performs a union (combines arrays without duplicates) based on the strategy specified.
 *
 * @param obj1 - The first object to merge.
 * @param obj2 - The second object to merge.
 * @param arrayMergeStrategy - The strategy for merging arrays: 'overwrite' or 'union'. Defaults to 'overwrite'.
 * @returns The deeply merged object.
 */
export function deepMerge<A, B>(
  obj1: A,
  obj2: B,
  arrayMergeStrategy: 'overwrite' | 'union' = 'overwrite',
): A & B {
  const output: Record<string, unknown> = Object.assign({}, obj1) // Start with a shallow copy of obj1
  if (isObject(obj1) && isObject(obj2)) {
    Object.keys(obj2).forEach((key) => {
      const obj2Value = obj2[key]
      const obj1Value = obj1[key]
      if (Array.isArray(obj1Value) && Array.isArray(obj2Value)) {
        output[key] = arrayMergeStrategy === 'union' ? unionArrays(obj1Value, obj2Value) : obj2Value
      } else if (isObject(obj2Value)) {
        if (isObject(obj1Value)) {
          // Recursively call deepMerge only if both obj1[key] and obj2[key] are objects
          output[key] = deepMerge(obj1Value, obj2Value, arrayMergeStrategy)
        } else {
          // If obj1[key] is not an object, simply assign obj2[key]
          output[key] = obj2Value
        }
      } else {
        // For non-object properties, overwrite with the value from obj2
        output[key] = obj2Value
      }
    })
  }
  return output as A & B
}

export function deepCopy<T>(item: T): T {
  if (item === null || typeof item !== 'object') {
    // Primitive value (including null and undefined): return as is
    return item
  }

  if (Array.isArray(item)) {
    // Array: create a new array and recursively copy each element
    return item.map((element) => deepCopy(element) as unknown) as unknown as T
  }

  if (isObject(item)) {
    // Object (excluding arrays): create a new object and recursively copy each property
    const copy = {} as Record<string, unknown>
    Object.keys(item).forEach((key) => {
      copy[key] = deepCopy(item[key])
    })
    return copy as T
  }

  // If item is of a type not handled above, return it as is
  return item
}

export const createDeepTransformer = ({
  // Default keyFn gets the original key (string|number|symbol) and its current value
  keyFn = (k) => k,
  // Default valueFn can replace any node; non-objects stop recursion
  valueFn = (v) => v,
}: {
  keyFn?: (key: string | number | symbol, val: unknown) => string | number | symbol
  valueFn?: <T>(val: T) => unknown
} = {}) => {
  const transform = (node: unknown): unknown => {
    // 1) allow valueFn to replace entire node
    const v1 = valueFn(node)

    // 2) stop if primitive / null
    if (v1 == null || typeof v1 !== 'object') return v1

    // 3a) arrays
    if (Array.isArray(v1)) {
      return v1.map(transform)
    }
    // 3b) maps
    if (v1 instanceof Map) {
      const m = new Map()
      v1.forEach((val, key) => {
        const nk = keyFn(key, val)
        m.set(nk, transform(val))
      })
      return m
    }
    // 3c) sets
    if (v1 instanceof Set) {
      return new Set(Array.from(v1).map(transform))
    }
    // 3d) plain objects
    const out: Record<string | number | symbol, unknown> = {}
    for (const [rawKey, val] of Object.entries(v1 as Record<string, unknown>)) {
      const nk = keyFn(rawKey, val)
      out[nk] = transform(val)
    }
    return out
  }

  return transform
}

export function makeTruncateTransformer<T>(
  maxLen: number,
  mode: 'truncate' | 'remove' | 'replace' = 'truncate',
  placeholder = '[truncated]',
): (obj: T) => T {
  return createDeepTransformer({
    valueFn: (val) => {
      if (typeof val === 'string' && val.length > maxLen) {
        if (mode === 'truncate') {
          return (val.slice(0, maxLen) + placeholder) as typeof val
        }
        if (mode === 'replace') {
          return placeholder as typeof val
        }
        if (mode === 'remove') {
          return undefined
        }
      }
      return val
    },
  }) as (obj: T) => T
}

/**
 * Creates an immutable transformer that applies value transformations at
 * specific dot-separated paths within an object.
 *
 * Each rule key is a dot-path (e.g. `"user.profile.name"`). Path segments may
 * refer to object keys, numeric array indices, or `"*"` to apply the rule to
 * all elements of an array.
 *
 * The returned transformer:
 * - Deep-clones the input object using `structuredClone`
 * - Applies each rule to the cloned object in iteration order
 * - Mutates only the clone, never the original input
 *
 * Rule functions receive the current value at the resolved path and:
 * - If they return a value, that value replaces the existing one
 * - If they return `undefined`, the property (or array element) is removed
 *
 * Rules are only applied to existing paths; missing keys or out-of-bounds
 * indices are ignored silently.
 *
 * @param rules A mapping of dot-paths to transformation functions
 * @returns A function that takes an object and returns a transformed clone
 *
 * @example
 * const transform = createDotPathTransformer({
 *   'users.*.age': v => typeof v === 'number' ? v + 1 : v,
 *   'meta.debug': () => undefined, // deletes `meta.debug`
 * })
 *
 * const result = transform(input)
 */
export function createDotPathTransformer(
  rules: Record<string, (currentValue: unknown) => unknown>,
) {
  return function <T>(obj: T): T {
    const clone: T = structuredClone(obj)

    const applyAtPath = (root: unknown, path: string[], fn: (val: unknown) => unknown): void => {
      if (path.length === 0) return
      const [head, ...rest] = path
      if (head == null) return

      if (Array.isArray(root)) {
        if (head === '*') {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          root.forEach((item, _idx) => applyAtPath(item, rest, fn))
        } else {
          const idx = Number(head)
          if (!Number.isNaN(idx) && idx in root) {
            if (rest.length === 0) {
              const newVal = fn(root[idx])
              if (newVal === undefined) {
                root.splice(idx, 1)
              } else {
                root[idx] = newVal
              }
            } else {
              applyAtPath(root[idx], rest, fn)
            }
          }
        }
        return
      }

      if (root && typeof root === 'object') {
        const record = root as Record<string, unknown>
        if (head in record) {
          if (rest.length === 0) {
            const newVal = fn(record[head])
            if (newVal === undefined) {
              delete record[head]
            } else {
              record[head] = newVal
            }
          } else {
            applyAtPath(record[head], rest, fn)
          }
        }
      }
    }

    for (const [path, fn] of Object.entries(rules)) {
      applyAtPath(clone as unknown, path.split('.'), fn)
    }

    return clone
  }
}

// Define the set of "falsy" values
const falsyValues: Set<unknown> = new Set([
  'no',
  'n/a',
  'na',
  'nan',
  'n',
  'false',
  false,
  '0',
  0,
  '{}',
  {},
  'null',
  null,
  'undefined',
  undefined,
  'disabled',
])

// this function "normalizes" boolean-like input this makes our llm structured
// response parsing more robust.
// TODO: can we use zods "stringbool" for this? https://v4.zod.dev/api#stringbool
export const normalizeFalsyValues = (normalizer: unknown = false): ((node: unknown) => unknown) =>
  createDeepTransformer({
    valueFn: (value) => {
      if (typeof value === 'string') {
        const lowerCaseValue = value.toLowerCase()
        if (falsyValues.has(lowerCaseValue)) {
          return normalizer // Normalize falsy values to "undefined"
        }
      } else if (typeof value === 'boolean') {
        return value ? value : normalizer // Convert boolean false to "undefined"
      } else if (falsyValues.has(value)) {
        return normalizer // Convert null, undefined, or falsy values
      }
      return value // Return unchanged if no conversion needed
    },
  })

export function pickProperties(obj: object, keys: string[]) {
  return Object.fromEntries(Object.entries(obj).filter(([key]) => keys.includes(key)))
}

export function isEmpty(obj: object): boolean {
  for (const prop in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, prop)) {
      return false
    }
  }

  return true
}

/**
 * Make anything JSON-serialisable.
 * – Preserves Error details (name, message, stack, cause, enumerables)
 * – Breaks cycles (→ "[Circular]")
 * – Stringifies BigInt / functions / symbols
 * – Returns a *plain* value, not a string.
 *
 * Drop-in replacement for the longer `serializeForJson`.
 */
export function serializeForJson(value: unknown): unknown {
  const seen = new WeakSet<object>()

  const replacer = (_key: string, val: unknown): unknown => {
    /* BigInt → string ---------------------------------------------------- */
    if (typeof val === 'bigint') return val.toString()

    /* Functions / symbols ---------------------------------------------- */
    if (typeof val === 'function') return `[Function ${val.name || 'anonymous'}]`
    if (typeof val === 'symbol') return val.toString()

    /* Error objects ----------------------------------------------------- */
    if (val instanceof Error) {
      const { name, message, stack, cause, ...rest } = val
      return { name, message, stack, cause, ...rest }
    }

    /* Circular refs ----------------------------------------------------- */
    if (typeof val === 'object' && val !== null) {
      if (seen.has(val)) return '[Circular]'
      seen.add(val)
    }

    return val // leave everything else as-is
  }

  // stringify → parse to end up with plain JSON-safe data
  return JSON.parse(JSON.stringify(value, replacer))
}
