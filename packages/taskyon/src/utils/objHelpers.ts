import { deepEqual } from 'fast-equals'
import type { RemoveUndefined, Thunk } from './tsHelpers'

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
