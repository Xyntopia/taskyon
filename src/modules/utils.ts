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
  private _promise: Promise<void> | null = null;

  async lock(): Promise<() => void> {
    let outerResolve: () => void;
    if (!this._promise) {
      this._promise = new Promise<void>((resolve) => {
        outerResolve = resolve;
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

function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

export function deepMerge(
  obj1: Record<string, unknown>,
  obj2: Record<string, unknown>
): Record<string, unknown> {
  const output = Object.assign({}, obj1); // Start with a shallow copy of obj1
  if (isObject(obj1) && isObject(obj2)) {
    Object.keys(obj2).forEach((key) => {
      const obj2Key = obj2[key];
      if (isObject(obj2Key)) {
        const obj1Key = obj1[key];
        if (isObject(obj1Key)) {
          // Recursively call deepMerge only if both obj1[key] and obj2[key] are objects
          output[key] = deepMerge(obj1Key, obj2Key);
        } else {
          // If obj1[key] is not an object, simply assign obj2[key]
          Object.assign(output, { [key]: obj2Key });
        }
      } else {
        // For non-object properties, overwrite with the value from obj2
        Object.assign(output, { [key]: obj2Key });
      }
    });
  }
  return output;
}

export function deepMergeReactive(
  obj1: Record<string, unknown>,
  obj2: Record<string, unknown>
) {
  if (!isObject(obj1) || !isObject(obj2)) {
    throw new Error('Both arguments must be objects.');
  }

  Object.keys(obj2).forEach((key) => {
    const obj2Value = obj2[key];
    if (isObject(obj2Value)) {
      if (!isObject(obj1[key])) {
        // If obj1[key] is not an object, initialize it as an empty object
        obj1[key] = {};
      }
      // Recursively merge objects
      deepMergeReactive(obj1[key] as Record<string, unknown>, obj2Value);
    } else {
      // Assign non-object values directly
      obj1[key] = obj2Value;
    }
  });

  return obj1;
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
      .toString('base64')  // Convert to base64
      .replace(/\+/g, '-') // Convert '+' to '-'
      .replace(/\//g, '_') // Convert '/' to '_'
      .replace(/=/g, '');  // Remove padding '='
}

export function base64UrlDecode(str: string): string {
  // Add removed '=' padding back
  str = str.padEnd(str.length + (4 - str.length % 4) % 4, '=');

  // Convert URL-safe characters back to original
  str = str.replace(/-/g, '+').replace(/_/g, '/');

  return Buffer.from(str, 'base64').toString();
}
