import { deepMerge } from '../utils/objHelpers'
import { canonicalHash } from '@taskyon/common/modules/canonicalHash'

export const storageValueContentHash = (value: unknown): string => canonicalHash(value)

const objectEntries = (value: unknown): [string, unknown][] | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return Object.entries(value)
}

export const storageQueryMatches = (value: unknown, query: unknown): boolean => {
  if (query === undefined) return true
  if (Object.is(value, query)) return true
  if (query === null || value === null) return query === value
  if (Array.isArray(query)) {
    if (!Array.isArray(value)) return false
    return query.every((queryItem) =>
      value.some((valueItem) => storageQueryMatches(valueItem, queryItem)),
    )
  }
  const queryEntries = objectEntries(query)
  if (!queryEntries) return value === query
  const valueEntries = objectEntries(value)
  if (!valueEntries) return false
  const valueMap = new Map(valueEntries)
  return queryEntries.every(
    ([key, queryValue]) => valueMap.has(key) && storageQueryMatches(valueMap.get(key), queryValue),
  )
}

export const mergeStorageRecord = (
  current: unknown,
  next: unknown,
  strategy: 'shallow_merge' | 'replace' | 'deepmerge' | 'native_shallow' = 'replace',
) => {
  if (strategy === 'replace') return next
  const currentEntries = objectEntries(current)
  const nextEntries = objectEntries(next)
  if (!currentEntries || !nextEntries) return next
  const currentObject = Object.fromEntries(currentEntries)
  const nextObject = Object.fromEntries(nextEntries)
  return strategy === 'deepmerge'
    ? deepMerge(currentObject, nextObject, 'overwrite')
    : { ...currentObject, ...nextObject }
}
