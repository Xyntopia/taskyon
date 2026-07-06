export function createLruCache<K, V>(maxSize: number) {
  const map = new Map<K, V>()

  function set(key: K, value: V) {
    if (map.has(key)) {
      map.delete(key)
    } else if (map.size >= maxSize) {
      const firstKey = map.keys().next().value
      if (firstKey !== undefined) {
        map.delete(firstKey)
      }
    }
    map.set(key, value)
  }

  function get(key: K): V | undefined {
    if (!map.has(key)) return undefined
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

export type LruCache<K, V> = ReturnType<typeof createLruCache<K, V>>
