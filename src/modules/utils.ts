/**
 * Type describing the method to be decorated.
 *
 * @template ReturnType The return type of the method.
 */
type MethodDescriptor<ReturnType> = {
  value: (...args: any[]) => ReturnType;
};

/**
 * Creates a decorator for caching the results of method calls, using a Least Recently Used (LRU) policy.
 *
 * @template ReturnType The return type of the method.
 * @param {number} size The maximum size of the cache.
 * @param {number[]} [ignoreIndices=[]] An array of argument indices to ignore when generating the cache key.
 * @returns {(target: Record<string, unknown>, name: string | symbol, descriptor: MethodDescriptor<ReturnType>) => MethodDescriptor<ReturnType>} The decorator function.
 *
 * @example
 *
 * // Define a class with a method to be decorated
 * class Calculator {
 *   @lruCache(3)
 *   expensiveOperation(arg1: number, arg2: number): number {
 *     console.log('Expensive operation:', arg1, arg2);
 *     return arg1 * arg2;
 *   }
 * }
 *
 * // Create a new instance of the class
 * const calc = new Calculator();
 *
 * // Call the decorated method
 * console.log(calc.expensiveOperation(2, 3));  // Outputs: Expensive operation: 2 3 \n 6
 * console.log(calc.expensiveOperation(2, 3));  // Outputs: Cache hit: [2,3] \n 6
 */
export function lruCache<ReturnType>(
  size: number,
  ignoreIndices: number[] = []
): (
  target: Record<string, unknown>,
  name: string | symbol,
  descriptor: MethodDescriptor<ReturnType>
) => MethodDescriptor<ReturnType> {
  // The cache for storing method call results.
  const cache = new Map<string, ReturnType>();

  return (
    target: Record<string, unknown>,
    name: string | symbol,
    descriptor: MethodDescriptor<ReturnType>
  ): MethodDescriptor<ReturnType> => {
    // The original method.
    const method = descriptor.value;

    // Override the original method.
    descriptor.value = function (...args: any[]): ReturnType {
      // Generate a cache key, ignoring specified arguments.
      const keyArgs = args.filter((_, index) => !ignoreIndices.includes(index));
      const key = JSON.stringify(keyArgs);
      // Check for a cache hit.
      if (cache.has(key)) {
        console.log('Cache hit:', key);
        return cache.get(key) as ReturnType;
      }

      // Call the original method and cache the result.
      const result: ReturnType = method.apply(this, args);
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

    // Return the updated method descriptor.
    return descriptor;
  };
}
