export type CacheEntry<ReturnType> = {
  value: ReturnType
  timestamp: number
}

// Helper function for in-memory storage
const createMemoryStorage = () => {
  const memoryStorage = new Map<string, string>()
  return {
    setItem: memoryStorage.set.bind(memoryStorage),
    getItem: (key: string) => memoryStorage.get(key) || null,
  }
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
