/**
 * Type describing a generic function.
 */
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
    return function (...args: any[]): ReturnType {
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
    return function (...args: any[]): ReturnType {
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
    return async function (...args: any[]): Promise<ReturnType> {
      // Generate a cache key, ignoring specified arguments.
      const keyArgs = args.filter((_, index) => !ignoreIndices.includes(index));
      const key = JSON.stringify(keyArgs);

      const now = Date.now();

      // Check for a cache hit.
      if (cache.has(key)) {
        const entry = cache.get(key) as asyncCacheEntry<ReturnType>;
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
