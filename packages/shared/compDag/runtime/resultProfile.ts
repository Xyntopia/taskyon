import type { ColumnStats, FlattenInput, FlattenOutput, FlattenRunInput } from './types'

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.prototype.toString.call(value) === '[object Object]'
}

const flattenObject = (value: unknown, out: Record<string, unknown>, prefix: string): void => {
  if (!isPlainObject(value)) {
    if (prefix) out[prefix] = value
    return
  }

  for (const [k, child] of Object.entries(value)) {
    const nextPath = prefix ? `${prefix}.${k}` : k
    if (isPlainObject(child)) {
      flattenObject(child, out, nextPath)
      continue
    }
    out[nextPath] = child
  }
}

export const flattenRuns = (input: FlattenInput): FlattenOutput => {
  const includePrefixes = input.options?.includePrefixes ?? true
  const runs = Array.isArray(input.runs) ? input.runs : []
  const keySet = new Set<string>()

  const rows = runs.map((run: FlattenRunInput) => {
    const row: Record<string, unknown> = {}
    const paramsPrefix = includePrefixes ? 'params' : ''
    const outputsPrefix = includePrefixes ? 'outputs' : ''

    flattenObject(run?.params, row, paramsPrefix)
    flattenObject(run?.outputs, row, outputsPrefix)

    for (const key of Object.keys(row)) keySet.add(key)
    return row
  })

  return {
    rows,
    rowCount: rows.length,
    keyCount: keySet.size,
  }
}

const typeBucketOf = (value: unknown): string => {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const stableStringify = (value: unknown): string => {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'number') return `number:${value.toString()}`
  if (typeof value === 'boolean') return `boolean:${value ? 'true' : 'false'}`
  if (typeof value === 'bigint') return `bigint:${value.toString()}`
  if (typeof value === 'string') return `string:${value}`
  if (Array.isArray(value)) return `array:${JSON.stringify(value)}`
  if (isPlainObject(value)) {
    const sorted = Object.fromEntries(
      Object.keys(value)
        .sort((a, b) => a.localeCompare(b))
        .map((k) => [k, value[k]]),
    )
    return `object:${JSON.stringify(sorted)}`
  }
  return `${typeof value}:${Object.prototype.toString.call(value)}`
}

const isArrayInformative = (value: unknown[]): boolean => {
  if (value.length === 0) return false
  const nonNullish = value.filter((x) => x !== null && x !== undefined)
  if (nonNullish.length === 0) return false
  const first = stableStringify(nonNullish[0])
  for (let i = 1; i < nonNullish.length; i += 1) {
    if (stableStringify(nonNullish[i]) !== first) return true
  }
  return false
}

const isInformativeValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return false
  if (Array.isArray(value)) return isArrayInformative(value)
  return true
}

export const profileColumns = (rowsInput: Array<Record<string, unknown>>) => {
  const rows = Array.isArray(rowsInput) ? rowsInput : []
  const columns: Record<string, ColumnStats> = {}
  const distinctValuesByKey = new Map<string, Set<string>>()

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue

    for (const [key, value] of Object.entries(row)) {
      const stat = columns[key] ?? {
        rowsSeen: rows.length,
        presentCount: 0,
        nullCount: 0,
        undefinedCount: 0,
        nonNullCount: 0,
        informativeCount: 0,
        constantLikeCount: 0,
        distinctValueCount: 0,
        allPresentValuesConstant: false,
        typeCounts: {},
        alwaysNullish: false,
        nullishRate: 0,
        presenceRate: 0,
      }

      stat.presentCount += 1
      if (value === null) {
        stat.nullCount += 1
      } else if (value === undefined) {
        stat.undefinedCount += 1
      } else {
        stat.nonNullCount += 1
      }
      if (isInformativeValue(value)) stat.informativeCount += 1
      else stat.constantLikeCount += 1

      const bucket = typeBucketOf(value)
      stat.typeCounts[bucket] = (stat.typeCounts[bucket] ?? 0) + 1
      if (!distinctValuesByKey.has(key)) distinctValuesByKey.set(key, new Set<string>())
      distinctValuesByKey.get(key)!.add(stableStringify(value))
      columns[key] = stat
    }
  }

  for (const [key, stat] of Object.entries(columns)) {
    stat.alwaysNullish = stat.nonNullCount === 0
    stat.nullishRate =
      stat.presentCount > 0 ? (stat.nullCount + stat.undefinedCount) / stat.presentCount : 0
    stat.presenceRate = rows.length > 0 ? stat.presentCount / rows.length : 0
    stat.distinctValueCount = distinctValuesByKey.get(key)?.size ?? 0
    stat.allPresentValuesConstant = stat.presentCount > 0 && stat.distinctValueCount <= 1
  }

  return {
    rowCount: rows.length,
    columnCount: Object.keys(columns).length,
    columns,
  }
}

