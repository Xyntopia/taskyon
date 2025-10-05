//import equal from 'fast-deep-equal/es6';
import { deepEqual } from 'fast-equals'
import { Buffer } from 'buffer'
import { safeYamlDump } from '../../packages/taskyon/src/utils/yamlUtils'
import type { AnyFunction } from '../../packages/taskyon/src/utils/tsHelpers'

export function copyToClipboard(text: string | undefined) {
  if (text)
    navigator.clipboard
      .writeText(text)
      .then(() => {
        console.log('Copied to clipboard')
      })
      .catch((err) => {
        console.error('Error in copying text: ', err)
      })
}

/**
 * Convert any thrown value into a short, customer-friendly string.
 *
 * Priority: message → HTTP hints → meta fields → one-level cause.
 * Handles Array-style causes (e.g. ["403 Forbidden: …"]) by promoting
 * them to the top of the output.
 * Designed for production UI logs (no stack traces, YAML only).
 */
export function humanizeError(errorInput: unknown): string {
  const seenObjects = new WeakSet<object>()
  const lines: string[] = []

  /* ---------- helpers --------------------------------------------------- */
  const toYaml = (val: unknown): string =>
    typeof val === 'string' ? val : safeYamlDump(val).trim()

  const append = (line: unknown): void => {
    if (typeof line === 'string' && line.trim() && !lines.includes(line.trim())) {
      lines.push(line.trim())
    }
  }

  const appendArray = (arr: unknown[]): void => {
    for (const element of arr) append(element)
  }

  /* ---------- main walker ----------------------------------------------- */
  const traverse = (value: unknown, level = 0): void => {
    if (value == null) return

    const valueType = typeof value

    // primitives (string | number | boolean | bigint | symbol)
    if (valueType !== 'object' && valueType !== 'function') {
      append(toYaml(value))
      return
    }

    // avoid infinite recursion
    if (seenObjects.has(value as object)) return
    seenObjects.add(value as object)

    // arrays: treat each entry as its own message
    if (Array.isArray(value)) {
      appendArray(value)
      return
    }

    const obj = value as Record<string, unknown>

    /* #1 message fields */
    const message =
      typeof obj.message === 'string'
        ? obj.message
        : typeof obj.msg === 'string'
          ? obj.msg
          : undefined
    if (message) append(message)

    /* #2 HTTP hints */
    if (typeof obj.status === 'number') {
      const statusText =
        typeof obj.statusText === 'string' && obj.statusText ? ` ${obj.statusText}` : ''
      append(`${obj.status}${statusText}`)
    }
    if (typeof obj.url === 'string' && obj.url) append(`URL: ${obj.url}`)

    /* #3 data/body helpers */
    const dataCandidate =
      (typeof obj.response === 'object' && obj.response
        ? (obj.response as Record<string, unknown>).data
        : undefined) ??
      obj.data ??
      (obj as { body?: unknown }).body ??
      (obj as { responseBody?: unknown }).responseBody
    if (dataCandidate !== undefined)
      append(`Data: ${toYaml(dataCandidate)}`)

      /* #4 meta fields */
    ;(['code', 'errno', 'name'] as const).forEach((key) => {
      const val = obj[key]
      if (typeof val === 'string' && val) append(`${key}=${val}`)
    })

    /* #5 cause (descend one level) */
    if (level === 0) {
      const causeKeys = ['cause', 'originalError', 'inner', 'error'] as const
      for (const key of causeKeys) {
        const causeVal = obj[key]
        if (causeVal === undefined) continue

        // Promote array causes so they’re shown first
        if (Array.isArray(causeVal)) {
          appendArray(causeVal)
        } else {
          append('Caused by →')
          traverse(causeVal, level + 1)
        }
        break // handle only the first found cause
      }
    }
  }

  traverse(errorInput)
  return lines.join('\n')
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

// Helper function for in-memory storage
const createMemoryStorage = () => {
  const memoryStorage = new Map<string, string>()
  return {
    setItem: memoryStorage.set.bind(memoryStorage),
    getItem: (key: string) => memoryStorage.get(key) || null,
  }
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

// Dynamically assign the storage methods
const storage =
  process.env.MODE === 'ssr' || typeof localStorage === 'undefined'
    ? createMemoryStorage()
    : localStorage

// The cache for storing function call results.
function saveToLocalStorage<ReturnType>(key: string, cache: Map<string, CacheEntry<ReturnType>>) {
  const serializedCache = JSON.stringify(Array.from(cache.entries()))
  storage.setItem(key, serializedCache)
}

function loadFromLocalStorage<ReturnType>(key: string): Map<string, CacheEntry<ReturnType>> {
  const serializedCache = storage.getItem(key)
  if (serializedCache) {
    const parsedCache = JSON.parse(serializedCache) as [string, CacheEntry<ReturnType>][]
    return new Map(parsedCache)
  }
  return new Map()
}

export function asyncTimeLruCache(
  size: number,
  maxAge: number, // Maximum age in milliseconds
  useLocalStorage = false,
  storageKey = 'asyncTimeLruCache',
  lazyUpdate = false,
  ignoreIndices: number[] = [],
) {
  return <F extends (...args: Parameters<F>) => ReturnType<F> | Promise<ReturnType<F>>>(fn: F) => {
    const cache = useLocalStorage
      ? loadFromLocalStorage<ReturnType<F>>(storageKey)
      : new Map<string, CacheEntry<ReturnType<F>>>()

    const updateCache = (key: string, result: ReturnType<F>, now: number) => {
      cache.set(key, { value: result, timestamp: now })
      // Check the cache size and evict the least recently used item if necessary.
      if (cache.size > size) {
        const oldestKey = Array.from(cache.keys())[0]!
        cache.delete(oldestKey)
        console.log('Evicted:', oldestKey)
      }
      if (useLocalStorage) {
        saveToLocalStorage(storageKey, cache)
      }
    }

    return async (...args: Parameters<F> & unknown[]): Promise<ReturnType<F>> => {
      // Generate a cache key, ignoring specified arguments.
      const keyArgs = args.filter((_, index) => !ignoreIndices.includes(index))
      const key = JSON.stringify(keyArgs)

      const now = Date.now()

      // Check for a cache hit.
      const entry = cache.get(key)
      if (entry) {
        const age = now - entry.timestamp

        if (age <= maxAge) {
          //console.log('Cache hit:', key)
          return entry.value
        } else {
          //console.log('Cache expired:', key)
          if (lazyUpdate) {
            // Start updating the cache in the background
            Promise.resolve(fn(...args))
              .then((result: ReturnType<F>) => updateCache(key, result, now))
              .catch(console.error)
            // Return the stale value
            return entry.value
          }
        }
      }

      // Call the original function and cache the result if lazyUpdate is false or cache miss occurs.
      const result = await fn(...args)
      updateCache(key, result, now)

      // Return the result.
      return result
    }
  }
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

/*function uuidToBigInt(uuid: string) {
  // Remove dashes and decode hex to a Buffer
  const buffer = Buffer.from(uuid.replace(/-/g, ''), 'hex');

  let bigint = BigInt(0);

  // Iterate over each byte in the buffer and shift it into the BigInt
  for (const byte of buffer) {
    bigint = (bigint << BigInt(8)) + BigInt(byte);
  }

  return bigint;
}*/

export function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64') // Convert to base64
    .replace(/\+/g, '-') // Convert '+' to '-'
    .replace(/\//g, '_') // Convert '/' to '_'
    .replace(/=/g, '') // Remove padding '='
}

export function base64UrlDecode(str: string): string {
  // Add removed '=' padding back
  str = str.padEnd(str.length + ((4 - (str.length % 4)) % 4), '=')

  // Convert URL-safe characters back to original
  str = str.replace(/-/g, '+').replace(/_/g, '/')

  return Buffer.from(str, 'base64').toString()
}

export function createAsyncQueue<T>() {
  let queue: T[] = []
  let resolveWaitingPop: ((value: T) => void) | undefined

  function push(item: T) {
    queue.push(item)
    if (resolveWaitingPop) {
      const shiftedItem = queue.shift()
      if (shiftedItem !== undefined) {
        resolveWaitingPop(shiftedItem)
      }
      resolveWaitingPop = undefined
    }
  }

  function count() {
    return queue.length
  }

  function pop(signal?: AbortSignal): Promise<T> {
    // if there’s already an item, just return it immediately
    const shiftedItem = queue.shift()
    if (shiftedItem !== undefined) {
      return Promise.resolve(shiftedItem)
    }

    // otherwise we wait, but allow aborting
    return new Promise<T>((resolve, reject) => {
      // if already aborted
      if (signal?.aborted) {
        return reject(new DOMException('Pop aborted', 'AbortError'))
      }

      // cleanup helper
      const cleanup = () => {
        // only clear if it’s still our resolver
        if (resolveWaitingPop === onValue) {
          resolveWaitingPop = undefined
        }
        signal?.removeEventListener('abort', onAbort)
      }

      const onValue = (value: T) => {
        cleanup()
        resolve(value)
      }

      const onAbort = () => {
        cleanup()
        console.log('aborting async queue pop')
        reject(new DOMException('Pop aborted', 'AbortError'))
      }

      // install our resolver
      resolveWaitingPop = onValue
      // listen for abort
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  function clear() {
    const oldQueue = queue
    queue = []
    return oldQueue
  }

  return { push, pop, count, clear }
}
export type AsyncQueue<T> = ReturnType<typeof createAsyncQueue<T>>

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

export async function fileToBase64(file: File): Promise<string> {
  console.log('convert file to base 64', file)
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        // TODO: it used to be like this and work:  no idea, why this is suddenly not alowd anymore, with
        // this error:
        //   840:28  error  'reader.result' may use Object's default stringification format ('[object Object]') when stringified  @typescript-eslint/no-base-to-string
        //const base64String = reader.result?.toString().split(',')[1]
        const base64String = reader.result.split(',')[1]
        if (base64String) {
          resolve(base64String)
        } else {
          reject(new Error('Failed to convert file to base64'))
        }
      }
    }
    reader.onerror = () => {
      reject(new Error('FileReader error'))
    }
  })
}

export function isEmpty(obj: object): boolean {
  for (const prop in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, prop)) {
      return false
    }
  }

  return true
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
