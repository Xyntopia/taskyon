type MethodDescriptor<ReturnType> = {
  value: (...args: any[]) => ReturnType;
};

function lruCache<ReturnType>(
  size: number,
  ignoreIndices: number[] = []
): (
  target: Record<string, unknown>,
  name: string | symbol,
  descriptor: MethodDescriptor<ReturnType>
) => MethodDescriptor<ReturnType> {
  const cache = new Map<string, ReturnType>();

  return (
    target: Record<string, unknown>,
    name: string | symbol,
    descriptor: MethodDescriptor<ReturnType>
  ): MethodDescriptor<ReturnType> => {
    const method = descriptor.value;

    descriptor.value = function (...args: any[]): ReturnType {
      const keyArgs = args.filter((_, index) => !ignoreIndices.includes(index));
      const key = JSON.stringify(keyArgs);
      if (cache.has(key)) {
        console.log('Cache hit:', key);
        return cache.get(key) as ReturnType;
      }

      const result: ReturnType = method.apply(this, args);
      cache.set(key, result);

      if (cache.size > size) {
        const oldestKey = Array.from(cache.keys())[0];
        cache.delete(oldestKey);
        console.log('Evicted:', oldestKey);
      }

      return result;
    };

    return descriptor;
  };
}
