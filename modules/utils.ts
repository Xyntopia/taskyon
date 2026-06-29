import { deepEqual } from 'fast-equals'

export function countLeaves(value: unknown): number {
  const seen = new Set<unknown>()
  const stack = [value]
  let count = 0

  while (stack.length) {
    const cur = stack.pop()

    if (cur === null || typeof cur !== 'object') {
      count++
      continue
    }

    if (seen.has(cur)) continue
    seen.add(cur)

    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v)
    } else {
      for (const v of Object.values(cur)) stack.push(v)
    }
  }

  return count
}

export function countElements(arr: unknown): number {
  if (!Array.isArray(arr)) return 1
  let n = 0
  for (const v of arr) n += countElements(v)
  return n
}

export async function copyToClipboard(text: string | undefined): Promise<boolean> {
  if (!text) return false
  try {
    await navigator.clipboard.writeText(text)
    console.log('Copied to clipboard')
    return true
  } catch (err) {
    console.error('Error in copying text: ', err)
    return false
  }
}

export async function copyPngToClipboard(png: Uint8Array) {
  // 1. Narrow to plain ArrayBuffer first
  const viewStart = png.byteOffset
  const viewEnd = viewStart + png.byteLength

  const ab: ArrayBuffer = // <- 👈 explicit type
    (png.buffer as ArrayBuffer) //      remove SAB from union
      .slice(viewStart, viewEnd) //      now ab is only ArrayBuffer

  // 2. Build the Blob
  const blob = new Blob([ab], { type: 'image/png' })

  // 3. Copy to clipboard
  if ('ClipboardItem' in globalThis) {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  } else {
    alert('ClipboardItem not supported in this browser')
  }
}

export function openrouterPricing(price: number | string, digits = 1) {
  if (typeof price === 'string') {
    price = parseFloat(price)
  }
  return price >= 0 ? humanReadablePrice(price, digits) : 'dynamic'
  //return price >= 0 ? price.toPrecision(5) : 'dynamic';
  //return humanReadablePrice(price);
}

export function humanReadablePrice(price: number | string | undefined, digits: number) {
  if (typeof price === 'string') {
    price = parseFloat(price)
  }
  if (price) {
    const precision = price > 1e6 ? (price > 1e3 ? 1 : 3) : 5
    if (price < 0.001) {
      price = parseFloat((price * 1e6).toPrecision(precision))
      return `${price.toFixed(digits)} μ$`
    } else if (price < 1.0) {
      price = parseFloat((price * 1e2).toPrecision(precision))
      return `${price.toFixed(digits)} ¢`
    }
    //return `${Math.round(price * 1e6)} μ$`;
    price = parseFloat(price.toPrecision(precision))
    return `${price.toFixed(digits)} $`
  } else {
    return 'N/A'
  }
}

/**
 * Type describing a generic function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction<ReturnType> = (...args: any[]) => ReturnType

// Async sleep function
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Creates a higher-order function for caching the results of another function, using a Least Recently Used (LRU) policy.
 *
 * @param {number} size The maximum size of the cache.
 * @param {number[]} [ignoreIndices=[]] An array of argument indices to ignore when generating the cache key.
 * @returns {(fn: AnyFunction<ReturnType>) => AnyFunction<ReturnType>} The higher-order function.
 *
 * @example
 *
 * // Example usage with a standalone function
 * const expensiveOperation = (arg1: number, arg2: number): number => {
 * console.log('Expensive operation:', arg1, arg2);
 * return arg1 * arg2;
 * };

 * const cachedExpensiveOperation = lruCache(3)(expensiveOperation);

 * // Call the wrapped function
 * console.log(cachedExpensiveOperation(2, 3));  // Outputs: Expensive operation: 2 3 \n 6
 * console.log(cachedExpensiveOperation(2, 3));  // Outputs: Cache hit: [2,3] \n 6
 */
export function lruCache(size: number, ignoreIndices: number[] = []) {
  // The cache for storing function call results.
  const cache = new Map<string, unknown>()

  return <ReturnType>(fn: AnyFunction<ReturnType>): AnyFunction<ReturnType> => {
    return function (...args: unknown[]): ReturnType {
      // Generate a cache key, ignoring specified arguments.
      const keyArgs = args.filter((_, index) => !ignoreIndices.includes(index))
      const key = JSON.stringify(keyArgs)

      // Check for a cache hit.
      if (cache.has(key)) {
        //console.log('Cache hit:', key)
        return cache.get(key) as ReturnType
      }

      // Call the original function and cache the result.
      const result: ReturnType = fn(...args)
      cache.set(key, result)

      // Check the cache size and evict the least recently used item if necessary.
      if (cache.size > size) {
        const oldestKey = Array.from(cache.keys())[0]!
        cache.delete(oldestKey)
        //console.log('Evicted:', oldestKey)
      }

      // Return the result.
      return result
    }
  }
}

type CacheEntry<ReturnType> = {
  value: ReturnType
  timestamp: number
}

export function timeLruCache<ReturnType>(
  size: number,
  maxAge: number, // Maximum age in milliseconds
  ignoreIndices: number[] = [],
): (fn: AnyFunction<ReturnType>) => AnyFunction<ReturnType> {
  // The cache for storing function call results.
  const cache = new Map<string, CacheEntry<ReturnType>>()

  return (fn: AnyFunction<ReturnType>): AnyFunction<ReturnType> => {
    return function (...args: unknown[]): ReturnType {
      // Generate a cache key, ignoring specified arguments.
      const keyArgs = args.filter((_, index) => !ignoreIndices.includes(index))
      const key = JSON.stringify(keyArgs)

      const now = Date.now()

      // Check for a cache hit.
      if (cache.has(key)) {
        const entry = cache.get(key) as CacheEntry<ReturnType>
        const age = now - entry.timestamp

        if (age <= maxAge) {
          //console.log('Cache hit:', key)
          return entry.value
        } else {
          //console.log('Cache expired:', key)
          cache.delete(key) // Remove the expired entry.
        }
      }

      // Call the original function and cache the result.
      const result: ReturnType = fn(...args)
      cache.set(key, { value: result, timestamp: now })

      // Check the cache size and evict the least recently used item if necessary.
      if (cache.size > size) {
        const oldestKey = Array.from(cache.keys())[0]!
        cache.delete(oldestKey)
        console.log('Evicted:', oldestKey)
      }

      // Return the result.
      return result
    }
  }
}

function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item)
}

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

// TODO: add a small test to this :)
// asyncLruCache.ts
export function asyncLruCache(size: number, ignoreIndices: number[] = []) {
  return <TArgs extends unknown[], R>(fn: (...args: TArgs) => R | Promise<R>) => {
    const cache = new Map<string, R>()
    const inFlight = new Map<string, Promise<R>>()

    const makeKey = (args: TArgs) => {
      const keyArgs = args.filter((_, i) => !ignoreIndices.includes(i))
      return JSON.stringify(keyArgs)
    }

    const wrapper = async (...args: TArgs): Promise<R> => {
      const key = makeKey(args)
      if (cache.has(key)) return cache.get(key)!
      if (inFlight.has(key)) return inFlight.get(key)!
      const p = (async () => {
        try {
          const v = (await fn(...args)) as R
          cache.set(key, v)
          if (cache.size > size) {
            const oldestKey = cache.keys().next().value!
            cache.delete(oldestKey)
          }
          return v
        } finally {
          inFlight.delete(key)
        }
      })()
      inFlight.set(key, p)
      return p
    }

    wrapper.clearCache = () => {
      cache.clear()
      inFlight.clear()
    }
    wrapper.invalidate = (...args: TArgs) => {
      const key = makeKey(args)
      cache.delete(key)
      inFlight.delete(key)
    }

    return wrapper
  }
}

type ReconcileOptions = {
  validators?: Record<string, (value: unknown) => boolean>
  preserveUnknownKeys?: boolean
}

export function reconcileWithDefaults<T>(
  stored: unknown,
  defaults: T,
  options: ReconcileOptions = {},
  path: string[] = [],
): T {
  const keyPath = path.join('.')

  if (Array.isArray(defaults)) {
    if (!Array.isArray(stored)) return structuredClone(defaults) as T
    const template = defaults[0]
    if (template === undefined) return stored as T
    return stored.map((item, index) =>
      reconcileWithDefaults(item, template, options, [...path, String(index)]),
    ) as T
  }

  if (isPlainObject(defaults)) {
    const storedObject = isPlainObject(stored) ? stored : {}
    const output: Record<string, unknown> = options.preserveUnknownKeys ? { ...storedObject } : {}
    for (const key of Object.keys(defaults)) {
      output[key] = reconcileWithDefaults(storedObject[key], defaults[key], options, [...path, key])
    }
    return output as T
  }

  const sameType =
    (stored === null && defaults === null) ||
    (stored !== null && defaults !== null && typeof stored === typeof defaults)
  const validator = options.validators?.[keyPath]
  if (sameType && (!validator || validator(stored))) return stored as T

  return structuredClone(defaults) as T
}

// Deep, in-place, strategy-driven merge for Vue3-style reactive objects.
// Focus: readability & control with a small option surface.

type ArrayStrategy =
  | 'overwrite'
  | 'byIndex'
  | 'concat'
  | 'prepend'
  | { kind: 'unionBy'; key: string }
  | { kind: 'mergeBy'; key: string }

type ObjectStrategy = 'merge' | 'overwrite'
type PrimitiveStrategy = 'overwrite' | 'preserve' | 'preferDefined'
type TypeMismatch = 'source' | 'target' | 'error'

export type MergeOptions = {
  arrays?: ArrayStrategy
  objects?: ObjectStrategy
  primitives?: PrimitiveStrategy
  typeMismatch?: TypeMismatch
  cloneOnOverwrite?: boolean
  resolveConflict?: (ctx: {
    path: string
    key: string
    targetVal: unknown
    sourceVal: unknown
  }) => unknown
}

const DEFAULTS: Required<
  Pick<MergeOptions, 'arrays' | 'objects' | 'primitives' | 'typeMismatch' | 'cloneOnOverwrite'>
> = {
  arrays: 'overwrite',
  objects: 'merge',
  primitives: 'overwrite',
  typeMismatch: 'source',
  cloneOnOverwrite: true,
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const cloneShallow = <T>(v: T, enable: boolean): T => {
  if (!enable) return v
  if (Array.isArray(v)) return v.slice() as T
  if (isPlainObject(v)) return { ...v }
  return v
}

/**
 * Deeply merges two plain objects in-place, with fine-grained control over how arrays,
 * objects, and primitives are combined.
 *
 * This function mutates `target` reactively (safe for Vue 3 proxies) and supports
 * multiple merge strategies for different value types. Useful when you need
 * predictable merging rules instead of generic "deep merge everything" behavior.
 *
 * ## Strategies
 * - **Arrays** (`arrays`):
 *    - `'overwrite'` — replace the entire array reference  (default).
 *    - `'byIndex'`   — merge arrays index-by-index.
 *    - `'concat'`    — append all items from source to target.
 *    - `'prepend'`   — prepend all items from source to target.
 *    - `{ kind: 'unionBy', key }` — concatenate arrays and deduplicate by object property `key`.
 *    - `{ kind: 'mergeBy', key }` — merge objects in arrays matching on property `key`.
 *
 * - **Objects** (`objects`):
 *    - `'merge'` — recursively merge properties (default).
 *    - `'overwrite'` — replace object reference entirely.
 *
 * - **Primitives** (`primitives`):
 *    - `'overwrite'` — replace value from source (default).
 *    - `'preserve'` — keep target value, ignore source.
 *    - `'preferDefined'` — replace only if source is not `undefined`.
 *
 * - **Type Mismatches** (`typeMismatch`):
 *    - `'source'` — replace with source value (default).
 *    - `'target'` — keep target value.
 *    - `'error'`  — throw on mismatched types.
 *
 * - **Cloning** (`cloneOnOverwrite`):
 *    - `true` — shallow-clone arrays/objects when overwriting (default).
 *    - `false` — re-use references directly.
 *
 * - **Conflict Hook** (`resolveConflict`):
 *    - `(ctx) => unknown` — custom resolution for specific keys/paths; return `undefined`
 *      to fall back to strategy logic.
 *
 * @template A - Type of target object
 * @template B - Type of source object
 * @param target - The object to merge into (will be mutated).
 * @param source - The object to merge from.
 * @param opts - MergeOptions controlling per-type merge behavior.
 * @returns The merged `target` object (typed as `A & B`).
 * @throws If either argument is not a plain object, or on type mismatch when `typeMismatch` is `'error'`.
 *
 * @example
 * // Overwrite arrays, merge objects, overwrite primitives
 * deepMergeReactive(a, b, { arrays: 'overwrite', objects: 'merge', primitives: 'overwrite' })
 *
 * @example
 * // Merge arrays by 'id', keep target value on mismatches
 * deepMergeReactive(a, b, { arrays: { kind: 'mergeBy', key: 'id' }, typeMismatch: 'target' })
 */
export function deepMergeReactive<
  A extends Record<string, unknown>,
  B extends Record<string, unknown>,
>(target: A, source: B, opts: MergeOptions = {}): A & B {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    throw new Error('Both arguments must be plain objects.')
  }
  mergeObject(target, source, { ...DEFAULTS, ...opts }, '')
  return target as A & B
}

function mergeObject(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  o: Required<typeof DEFAULTS> & MergeOptions,
  path: string,
) {
  for (const [key, sVal] of Object.entries(source)) {
    const tVal = target[key]
    const here = path ? `${path}.${key}` : key

    // Custom resolver first
    if (o.resolveConflict) {
      const decided = o.resolveConflict({ path: here, key, targetVal: tVal, sourceVal: sVal })
      if (decided !== undefined) {
        target[key] = decided
        continue
      }
    }

    const tArr = Array.isArray(tVal),
      sArr = Array.isArray(sVal)
    const tObj = isPlainObject(tVal),
      sObj = isPlainObject(sVal)

    if (tVal === undefined) {
      target[key] = cloneShallow(sVal, o.cloneOnOverwrite)
      continue
    }

    // Arrays first
    if (tArr && sArr) {
      target[key] = mergeArrays(tVal as unknown[], sVal as unknown[], o, here)
      continue
    }

    // Plain objects next
    if (tObj && sObj) {
      if ((o.objects ?? DEFAULTS.objects) === 'merge') {
        mergeObject(tVal, sVal, o, here)
      } else {
        target[key] = cloneShallow(sVal, o.cloneOnOverwrite)
      }
      continue
    }

    // Both primitives
    if (!tArr && !sArr && !tObj && !sObj) {
      const p = o.primitives ?? DEFAULTS.primitives
      target[key] =
        p === 'preserve' ? tVal : p === 'preferDefined' ? (sVal === undefined ? tVal : sVal) : sVal // overwrite
      continue
    }

    // Type mismatch
    const mm = o.typeMismatch ?? DEFAULTS.typeMismatch
    if (mm === 'source') target[key] = cloneShallow(sVal, o.cloneOnOverwrite)
    else if (mm === 'target') {
      /* keep tVal */
    } else throw new Error(`Type mismatch at ${here}`)
  }
}

function mergeArrays(
  a: unknown[],
  b: unknown[],
  o: Required<typeof DEFAULTS> & MergeOptions,
  path: string,
): unknown[] {
  const strat = o.arrays ?? DEFAULTS.arrays

  if (strat === 'overwrite') return o.cloneOnOverwrite ? b.slice() : b
  if (strat === 'concat') return a.concat(b)
  if (strat === 'prepend') return b.concat(a)

  if (typeof strat === 'object' && strat.kind === 'unionBy') {
    const seen = new Set<unknown>()
    const out: unknown[] = []
    for (const it of a.concat(b)) {
      const id = isPlainObject(it) ? it[strat.key] : it
      if (!seen.has(id)) {
        seen.add(id)
        out.push(it)
      }
    }
    a.splice(0, a.length, ...out)
    return a
  }

  if (typeof strat === 'object' && strat.kind === 'mergeBy') {
    const idx = new Map<unknown, number>()
    for (let i = 0; i < a.length; i++) {
      const it = a[i]
      if (isPlainObject(it)) idx.set(it[strat.key], i)
    }
    for (const s of b) {
      if (isPlainObject(s)) {
        const k = s[strat.key]
        const pos = idx.get(k)
        if (pos != null && isPlainObject(a[pos])) {
          mergeObject(a[pos], s, o, `${path}[${pos}]`)
        } else {
          a.push(cloneShallow(s, o.cloneOnOverwrite))
        }
      } else {
        a.push(cloneShallow(s, o.cloneOnOverwrite))
      }
    }
    return a
  }

  // byIndex (default)
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    const v1 = a[i],
      v2 = b[i]
    if (v2 === undefined) continue
    const tArr = Array.isArray(v1),
      sArr = Array.isArray(v2)
    const tObj = isPlainObject(v1),
      sObj = isPlainObject(v2)
    if (tArr && sArr) a[i] = mergeArrays(v1 as unknown[], v2 as unknown[], o, `${path}[${i}]`)
    else if (tObj && sObj) mergeObject(v1, v2, o, `${path}[${i}]`)
    else a[i] = v2
  }
  return a
}

export function createLruCache<K, V>(maxSize: number) {
  const map = new Map<K, V>()

  function set(key: K, value: V) {
    if (map.has(key)) {
      // If key exists, remove it first so it gets reinserted at the end (most recently used)
      map.delete(key)
    } else if (map.size >= maxSize) {
      // Remove the least recently used (first item in insertion order)
      const firstKey = map.keys().next().value
      if (firstKey !== undefined) {
        map.delete(firstKey)
      }
    }
    map.set(key, value) // Insert at the end (most recently used)
  }

  function get(key: K): V | undefined {
    if (!map.has(key)) return undefined
    // Move key to end (most recently used)
    const value = map.get(key)!
    map.delete(key)
    map.set(key, value)
    return value
  }

  function has(key: K): boolean {
    return map.has(key)
  }

  function deleteKey(key: K): boolean {
    return map.delete(key)
  }

  function clear() {
    map.clear()
  }

  function size() {
    return map.size
  }

  function keys(): K[] {
    return Array.from(map.keys())
  }

  function values(): V[] {
    return Array.from(map.values())
  }

  return { set, get, has, delete: deleteKey, clear, size, keys, values }
}

// Define the LRU cache type
export type LruCache<K, V> = ReturnType<typeof createLruCache<K, V>>

export function makeSerializable(value: unknown, depth = 5): unknown {
  if (depth <= 0) {
    return '[Max Depth Reached]' // Return a placeholder when the max depth is reached
  }

  if (value instanceof Error) {
    // Handle Error objects
    return Object.fromEntries(
      Object.getOwnPropertyNames(value).map((key) => [
        key,
        makeSerializable((value as unknown as Record<string, unknown>)[key], depth - 1),
      ]),
    )
  }

  if (value instanceof Map) {
    // Convert Map to an object
    return Object.fromEntries(
      Array.from(value.entries()).map(([k, v]) => [k, makeSerializable(v, depth - 1)]),
    )
  }

  if (value instanceof Set) {
    // Convert Set to an array
    return Array.from(value).map((v) => makeSerializable(v, depth - 1))
  }

  if (Array.isArray(value)) {
    // Recursively handle arrays
    return value.map((v) => makeSerializable(v, depth - 1))
  }

  if (typeof value === 'object' && value !== null) {
    // Recursively handle plain objects
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        makeSerializable(v, depth - 1),
      ]),
    )
  }

  // Return primitives and other serializable values as-is
  return value
}
// Helper functions for encoding/decoding
export function encodeVector(vector: Float32Array): string {
  // Convert Float32Array to ArrayBuffer
  const buffer = vector.buffer
  // Convert ArrayBuffer to Base64
  const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
  return base64
}
export function decodeVector(base64String: string): Float32Array {
  // Convert Base64 to ArrayBuffer
  const binaryString = atob(base64String)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  // Convert ArrayBuffer back to Float32Array
  return new Float32Array(bytes.buffer)
}

export function clearBrowserCaches() {
  if ('caches' in window) {
    void caches.keys().then((keys) => {
      keys.forEach((key) => {
        void caches.delete(key)
      })
    })
  }
}

export function clearServiceWorkers() {
  if ('serviceWorker' in navigator) {
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      registrations.forEach((registration) => {
        void registration.unregister()
      })
    })
  }
}

export function clearCookies() {
  document.cookie.split(';').forEach((cookie) => {
    const name = cookie.split('=')[0]!.trim()
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
  })
}

export const getEnvironmentInfo = () => {
  const publishDateUTC = process.env.PUBLISH_DATE as unknown as string
  return {
    publishDate: {
      utc: publishDateUTC,
      local: new Date(String(publishDateUTC)).toLocaleString(),
    },
    isBrowser: typeof window !== 'undefined' && typeof window.document !== 'undefined',
    isNode:
      typeof process !== 'undefined' && process.versions != null && process.versions.node != null,
    os: (() => {
      if (typeof process !== 'undefined' && process.platform) {
        return process.platform // e.g., 'win32', 'darwin', 'linux'
      }
      if (typeof navigator !== 'undefined' && navigator.userAgent) {
        return navigator.userAgent
      }
      return 'Unknown'
    })(),
    isMobile: typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent),
    nodeVersion:
      typeof process !== 'undefined' && process.versions?.node ? process.versions.node : null,
    browserUserAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    browserAppVersion: typeof navigator !== 'undefined' ? navigator.appVersion : null,
    browserPlatform: typeof navigator !== 'undefined' ? navigator.platform : null,
    hasWebAssembly: typeof WebAssembly !== 'undefined',
    supportsServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    supportsES6: (() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        new Function('(a = 0) => a')
        return true
      } catch {
        return false
      }
    })(),
    timezone: typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: typeof navigator !== 'undefined' ? navigator.language : null,
    memoryUsage: (() => {
      interface PerformanceMemory {
        usedJSHeapSize: number
        totalJSHeapSize: number
        jsHeapSizeLimit: number
      }
      if (
        typeof performance !== 'undefined' &&
        (performance as { memory?: PerformanceMemory }).memory
      ) {
        return JSON.stringify((performance as unknown as { memory: PerformanceMemory }).memory)
      }
      if (typeof process !== 'undefined' && process.memoryUsage) {
        return process.memoryUsage()
      }
      return null
    })(),
    screenResolution: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : null,
    supportsBigInt: typeof BigInt !== 'undefined',
    supportsFetch: typeof fetch !== 'undefined',
  }
}
export function hexToRgb(hex: string): string {
  const bigint = parseInt(hex.slice(1), 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `${r}, ${g}, ${b}`
}
