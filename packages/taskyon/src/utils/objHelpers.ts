import type { RemoveUndefined, Thunk } from './tsHelpers'

export const removeKeys = <T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> => {
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !keys.includes(key as K)),
  ) as Omit<T, K>
}

export function removeUndefinedProperties<T extends object>(obj: T): RemoveUndefined<T, keyof T> {
  return Object.entries(obj).reduce(
    (acc, [key, value]) => {
      if (value !== undefined) {
        ;(acc as Record<string, unknown>)[key] = value
      }
      return acc
    },
    {} as Record<keyof T, unknown>,
  ) as RemoveUndefined<T, keyof T>
}

export function deepCloneWJson<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

type ProxyApi<T, K extends readonly (keyof T)[]> = {
  [P in K[number]]: T[P] extends (...args: infer A) => infer R ? (...args: A) => R : () => T[P]
}

export function createProxyApi<T extends object, const K extends readonly (keyof T)[]>(
  obj: Thunk<T>,
  names: K,
): ProxyApi<T, K> {
  const api: Partial<Record<keyof T, unknown>> = {}

  for (const key of names) {
    const val = obj()[key]
    if (typeof val === 'function') {
      // Preserve `this` if the method uses it
      api[key] = (...args: unknown[]) => {
        const o = obj()
        const fn = o[key] as unknown as (...a: unknown[]) => unknown
        return fn.apply(o, args)
      }
    } else {
      api[key] = () => obj()[key]
    }
  }

  return api as ProxyApi<T, K>
}
