export type LiveCallback<T> = (data: T | null) => void

// Map to hold live callbacks.
// Using a Map that stores, for each record ID (as a string), a Set of callback functions.
export function useLiveCallBacks<T>() {
  const callbackList = new Map<string | number, Set<LiveCallback<T>>>()

  // Helper to trigger callbacks for a given record id.
  const trigger = (id: string | number, data: T | null) => {
    const key = id.toString()
    const callbacks = callbackList.get(key)
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

  const createDisposeFunction = (key: string | number, callback: LiveCallback<T>) => () => {
    const callbacks = callbackList.get(key)
    if (callbacks) {
      callbacks.delete(callback)
      if (callbacks.size === 0) {
        callbackList.delete(key)
      }
    }
  }

  function add(key: string | number, callback: LiveCallback<T>) {
    if (!callbackList.has(key)) {
      callbackList.set(key, new Set())
    }
    callbackList.get(key)!.add(callback)
  }

  return { trigger, callbackList, createDisposeFunction, add }
}
