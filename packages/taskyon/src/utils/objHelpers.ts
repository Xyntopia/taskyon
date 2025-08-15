import type { RemoveUndefined } from './tsHelpers'

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
