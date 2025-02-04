export type LiveCallback<T> = (data: T | null) => void
export function addCallback<T>(
  key: string,
  liveCallbacks: Map<string, Set<LiveCallback<T>>>,
  callback: LiveCallback<T>,
) {
  if (!liveCallbacks.has(key)) {
    liveCallbacks.set(key, new Set())
  }
  liveCallbacks.get(key)!.add(callback)
}
// Map to hold live callbacks.
// Using a Map that stores, for each record ID (as a string), a Set of callback functions.
export function useLiveCallBacks<T>() {
  const liveCallbacks = new Map<string, Set<LiveCallback<T>>>()

  // Helper to trigger callbacks for a given record id.
  const triggerLiveCallbacks = (id: string | number, data: T | null) => {
    const key = id.toString()
    const callbacks = liveCallbacks.get(key)
    if (callbacks) {
      callbacks.forEach((cb) => {
        try {
          cb(data)
        } catch (error) {
          console.error(`Error in live callback for id ${key}:`, error)
        }
      })
    }
  }

  const createDisposeFunction = (key: string, callback: LiveCallback<T>) => () => {
    const callbacks = liveCallbacks.get(key)
    if (callbacks) {
      callbacks.delete(callback)
      if (callbacks.size === 0) {
        liveCallbacks.delete(key)
      }
    }
  }
  return { triggerLiveCallbacks, liveCallbacks, createDisposeFunction }
}
