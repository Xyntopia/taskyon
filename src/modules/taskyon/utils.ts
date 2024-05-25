import equal from 'fast-deep-equal/es6';

/**
 * Type describing a generic function.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction<ReturnType> = (...args: any[]) => ReturnType;

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

// Async sleep function
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function lruCache<ReturnType>(
  size: number,
  ignoreIndices: number[] = []
): (fn: AnyFunction<ReturnType>) => AnyFunction<ReturnType> {
  // The cache for storing function call results.
  const cache = new Map<string, ReturnType>();

  return (fn: AnyFunction<ReturnType>): AnyFunction<ReturnType> => {
    return function (...args: unknown[]): ReturnType {
      // Generate a cache key, ignoring specified arguments.
      const keyArgs = args.filter((_, index) => !ignoreIndices.includes(index));
      const key = JSON.stringify(keyArgs);

      // Check for a cache hit.
      if (cache.has(key)) {
        console.log('Cache hit:', key);
        return cache.get(key) as ReturnType;
      }

      // Call the original function and cache the result.
      const result: ReturnType = fn(...args);
      cache.set(key, result);

      // Check the cache size and evict the least recently used item if necessary.
      if (cache.size > size) {
        const oldestKey = Array.from(cache.keys())[0];
        cache.delete(oldestKey);
        console.log('Evicted:', oldestKey);
      }

      // Return the result.
      return result;
    };
  };
}

type CacheEntry<ReturnType> = {
  value: ReturnType;
  timestamp: number;
};

export function timeLruCache<ReturnType>(
  size: number,
  maxAge: number, // Maximum age in milliseconds
  ignoreIndices: number[] = []
): (fn: AnyFunction<ReturnType>) => AnyFunction<ReturnType> {
  // The cache for storing function call results.
  const cache = new Map<string, CacheEntry<ReturnType>>();

  return (fn: AnyFunction<ReturnType>): AnyFunction<ReturnType> => {
    return function (...args: unknown[]): ReturnType {
      // Generate a cache key, ignoring specified arguments.
      const keyArgs = args.filter((_, index) => !ignoreIndices.includes(index));
      const key = JSON.stringify(keyArgs);

      const now = Date.now();

      // Check for a cache hit.
      if (cache.has(key)) {
        const entry = cache.get(key) as CacheEntry<ReturnType>;
        const age = now - entry.timestamp;

        if (age <= maxAge) {
          console.log('Cache hit:', key);
          return entry.value;
        } else {
          console.log('Cache expired:', key);
          cache.delete(key); // Remove the expired entry.
        }
      }

      // Call the original function and cache the result.
      const result: ReturnType = fn(...args);
      cache.set(key, { value: result, timestamp: now });

      // Check the cache size and evict the least recently used item if necessary.
      if (cache.size > size) {
        const oldestKey = Array.from(cache.keys())[0];
        cache.delete(oldestKey);
        console.log('Evicted:', oldestKey);
      }

      // Return the result.
      return result;
    };
  };
}

type asyncCacheEntry<ReturnType> = {
  value: Promise<ReturnType>;
  timestamp: number;
};

export function asyncTimeLruCache<ReturnType>(
  size: number,
  maxAge: number, // Maximum age in milliseconds
  ignoreIndices: number[] = []
): (fn: AnyFunction<Promise<ReturnType>>) => AnyFunction<Promise<ReturnType>> {
  // The cache for storing function call results.
  const cache = new Map<string, asyncCacheEntry<ReturnType>>();

  return (
    fn: AnyFunction<Promise<ReturnType>>
  ): AnyFunction<Promise<ReturnType>> => {
    return async function (...args: unknown[]): Promise<ReturnType> {
      // Generate a cache key, ignoring specified arguments.
      const keyArgs = args.filter((_, index) => !ignoreIndices.includes(index));
      const key = JSON.stringify(keyArgs);

      const now = Date.now();

      // Check for a cache hit.
      if (cache.has(key)) {
        const entry = cache.get(key) as asyncCacheEntry<ReturnType>;
        const age = now - entry.timestamp;

        if (age <= maxAge) {
          //console.log('Cache hit:', key);
          return entry.value;
        } else {
          //console.log('Cache expired:', key);
          cache.delete(key); // Remove the expired entry.
        }
      }

      // Call the original function and cache the result.
      const result = fn(...args);
      cache.set(key, { value: result, timestamp: now });

      // Check the cache size and evict the least recently used item if necessary.
      if (cache.size > size) {
        const oldestKey = Array.from(cache.keys())[0];
        cache.delete(oldestKey);
        console.log('Evicted:', oldestKey);
      }

      // Return the result.
      return result;
    };
  };
}

export function asyncLruCache<ReturnType>(
  size: number,
  ignoreIndices: number[] = []
): (fn: AnyFunction<Promise<ReturnType>>) => AnyFunction<Promise<ReturnType>> {
  // The cache for storing function call results.
  const cache = new Map<string, Promise<ReturnType>>();

  return (
    fn: AnyFunction<Promise<ReturnType>>
  ): AnyFunction<Promise<ReturnType>> => {
    return async function (...args: unknown[]): Promise<ReturnType> {
      // Generate a cache key, ignoring specified arguments.
      const keyArgs = args.filter((_, index) => !ignoreIndices.includes(index));
      const key = JSON.stringify(keyArgs);

      // Check for a cache hit.
      if (cache.has(key)) {
        console.log('Cache hit:', key);
        return cache.get(key) as Promise<ReturnType>;
      }

      // Call the original function and cache the result.
      const result = fn(...args);
      cache.set(key, result);

      // Check the cache size and evict the least recently used item if necessary.
      if (cache.size > size) {
        const oldestKey = Array.from(cache.keys())[0];
        cache.delete(oldestKey);
        console.log('Evicted:', oldestKey);
      }

      // Return the result.
      return result;
    };
  };
}

export class Lock {
  //TODO: the function which is returned to resolve the promise
  //      should be a callable object and automatically resolve
  //      when it is destroyed for example when running out of scope
  //      in a function...
  private _promise: Promise<void> | null = null;

  async lock(): Promise<() => void> {
    let outerResolve: () => void;
    if (!this._promise) {
      this._promise = new Promise<void>((resolve) => {
        outerResolve = () => {
          console.log('unlock!');
          resolve();
        };
      });

      return () => {
        if (outerResolve) {
          outerResolve();
          this._promise = null;
        }
      };
    } else {
      console.log('waiting for unlock to relock');
      await this._promise; // Wait for the lock to be released
      return this.lock(); // Re-attempt to acquire the lock
    }
  }

  async waitForUnlock(): Promise<void> {
    if (this._promise) {
      await this._promise;
    }
  }
}

/**
 * Checks if the given item is an object (excluding null and arrays).
 *
 * @param item - The item to check.
 * @returns True if the item is an object, false otherwise.
 */
function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
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
  const combined = arr1.concat(arr2);
  return combined.filter(
    (item, index) => combined.findIndex((obj) => equal(obj, item)) === index
  );
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
  arrayMergeStrategy: 'overwrite' | 'union' = 'overwrite'
): A & B {
  const output: Record<string, unknown> = Object.assign({}, obj1); // Start with a shallow copy of obj1
  if (isObject(obj1) && isObject(obj2)) {
    Object.keys(obj2).forEach((key) => {
      const obj2Value = obj2[key];
      const obj1Value = obj1[key];
      if (Array.isArray(obj1Value) && Array.isArray(obj2Value)) {
        output[key] =
          arrayMergeStrategy === 'union'
            ? unionArrays(obj1Value, obj2Value)
            : obj2Value;
      } else if (isObject(obj2Value)) {
        if (isObject(obj1Value)) {
          // Recursively call deepMerge only if both obj1[key] and obj2[key] are objects
          output[key] = deepMerge(obj1Value, obj2Value, arrayMergeStrategy);
        } else {
          // If obj1[key] is not an object, simply assign obj2[key]
          output[key] = obj2Value;
        }
      } else {
        // For non-object properties, overwrite with the value from obj2
        output[key] = obj2Value;
      }
    });
  }
  return output as A & B;
}

/**
 * Deeply merges two objects reactively.
 * Unlike `deepMerge`, this function modifies `obj1` directly, providing a reactive merge.
 * Supports 'overwrite' and 'additive' strategies for non-object properties.
 *
 * @param obj1 - The first object to merge (will be modified).
 * @param obj2 - The second object to merge.
 * @param mergeStrategy - The strategy for merging: 'overwrite' or 'additive'.
 * @returns The deeply merged object.
 * @throws If either argument is not an object.
 */
export function deepMergeReactive<A, B>(
  obj1: A,
  obj2: B,
  mergeStrategy: 'overwrite' | 'additive'
): A & B {
  if (!isObject(obj1) || !isObject(obj2)) {
    throw new Error('Both arguments must be objects.');
  }

  const obj1AsRecord = obj1 as unknown as Record<string, unknown>;

  for (const [key, obj2Value] of Object.entries(obj2)) {
    const obj1Value = obj1AsRecord[key];
    if (!(key in obj1AsRecord)) {
      obj1AsRecord[key] = obj2Value;
    } else if (isObject(obj2Value) && isObject(obj1Value)) {
      deepMergeReactive(obj1Value, obj2Value, mergeStrategy);
    } else if (Array.isArray(obj2Value) && Array.isArray(obj1Value)) {
      obj1AsRecord[key] = mergeArraysReactive(
        obj1Value,
        obj2Value,
        mergeStrategy
      );
    } else if (mergeStrategy === 'overwrite') {
      // if the key exists, and one of the objects isn't an array or object
      // In 'overwrite' mode, assign non-object values directly
      // as we iterate through obj2, we know this value always exists...
      obj1AsRecord[key] = obj2Value;
    }
  }

  return obj1AsRecord as A & B;
}

/**
 * Merges two reactive arrays based on the specified strategy.
 * Elements are merged element-wise with support for 'overwrite' and 'additive' strategies.
 *
 * @param arr1 - The first array.
 * @param arr2 - The second array.
 * @param mergeStrategy - The strategy for merging: 'overwrite' or 'additive'.
 * @returns The merged array.
 */
function mergeArraysReactive(
  arr1: unknown[],
  arr2: unknown[],
  mergeStrategy: 'overwrite' | 'additive'
): unknown[] {
  for (let i = 0; i < arr1.length || i < arr2.length; i++) {
    const element1 = arr1[i];
    const element2 = arr2[i];

    if (isObject(element1) && isObject(element2)) {
      arr1[i] = deepMergeReactive(element1, element2, mergeStrategy);
    } else if (Array.isArray(element1) && Array.isArray(element2)) {
      arr1[i] = mergeArraysReactive(
        element1 as unknown[],
        element2 as unknown[],
        mergeStrategy
      );
    } else if (element1 === undefined && element2 !== undefined) {
      arr1.push(element2);
    } else if (element2 !== undefined && mergeStrategy === 'overwrite') {
      arr1[i] = element2;
    }
  }

  return arr1;
}

export function deepCopy<T>(item: T): T {
  if (item === null || typeof item !== 'object') {
    // Primitive value (including null and undefined): return as is
    return item;
  }

  if (Array.isArray(item)) {
    // Array: create a new array and recursively copy each element
    return item.map((element) => deepCopy(element) as unknown) as unknown as T;
  }

  if (isObject(item)) {
    // Object (excluding arrays): create a new object and recursively copy each property
    const copy = {} as Record<string, unknown>;
    Object.keys(item).forEach((key) => {
      copy[key] = deepCopy(item[key]);
    });
    return copy as T;
  }

  // If item is of a type not handled above, return it as is
  return item;
}

export function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64') // Convert to base64
    .replace(/\+/g, '-') // Convert '+' to '-'
    .replace(/\//g, '_') // Convert '/' to '_'
    .replace(/=/g, ''); // Remove padding '='
}

export function base64UrlDecode(str: string): string {
  // Add removed '=' padding back
  str = str.padEnd(str.length + ((4 - (str.length % 4)) % 4), '=');

  // Convert URL-safe characters back to original
  str = str.replace(/-/g, '+').replace(/_/g, '/');

  return Buffer.from(str, 'base64').toString();
}

export class AsyncQueue<T> {
  private queue: T[] = [];
  private resolveWaitingPop?: (value: T) => void;

  push(item: T) {
    this.queue.push(item);
    if (this.resolveWaitingPop) {
      // Since TypeScript now expects queue.shift() to always return a T,
      // we need to assure it's not called on an empty array.
      // The logic ensures it's never empty at this point, but TypeScript doesn't know that.
      const shiftedItem = this.queue.shift();
      if (shiftedItem !== undefined) {
        this.resolveWaitingPop(shiftedItem);
      }
      this.resolveWaitingPop = undefined;
    }
  }

  count() {
    return this.queue.length;
  }

  async pop(): Promise<T> {
    const shiftedItem = this.queue.shift();
    if (shiftedItem !== undefined) {
      return shiftedItem;
    } else {
      return new Promise<T>((resolve) => {
        this.resolveWaitingPop = resolve;
      });
    }
  }

  clear() {
    const oldQueue = this.queue;
    this.queue = [];
    return oldQueue;
  }
}

export function bigIntToString(obj: unknown): unknown {
  if (obj === null) {
    return obj;
  }

  if (typeof obj === 'bigint') {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => bigIntToString(item));
  }

  if (typeof obj === 'object') {
    const result: { [key: string]: unknown } = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = bigIntToString((obj as Record<string, unknown>)[key]);
      }
    }
    return result;
  }

  return obj;
}
