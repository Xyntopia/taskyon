// serializeObject.ts
import { stringify as yamlStringify } from 'yaml'

export type SerializationFormat = 'json' | 'yaml'

export type PrimitivePolicy =
  | 'value' // show actual primitive values (default)
  | 'type' // replace with e.g. "<number>", "<string>"
  | 'placeholder' // replace with "[value omitted]"

export interface SerializeOptions {
  /**
   * Output format for the final string.
   * - 'json' → pretty JSON
   * - 'yaml' → YAML via `yaml` package
   */
  format?: SerializationFormat

  /** Max object/array nesting depth to expand. Default: 4 */
  maxDepth?: number

  /** Max number of items to show per array. Default: 10 */
  maxArrayLength?: number

  /** Max number of keys to show per object. Default: 20 */
  maxObjectKeys?: number

  /**
   * How to represent primitives (string/number/boolean/null, Date, etc.).
   * Default: 'value'
   */
  primitivePolicy?: PrimitivePolicy

  /**
   * Max length of string values. Longer strings will be truncated with "…".
   * Set to Infinity to disable. Default: 200
   */
  maxStringLength?: number

  /** Indentation in spaces for pretty-printing. Default: 2 */
  indent?: number

  /**
   * Whether to add metadata fields (like "__omittedKeys") when truncating.
   * Default: true
   */
  includeTruncationMeta?: boolean

  /**
   * Detect arrays where every item is the same primitive value and include
   * a compact summary with that constant value and total length.
   * Default: true
   */
  detectConstantArrayValues?: boolean
}

/**
 * Safely serialize any JS value into a truncated, LLM-friendly string.
 * Handles:
 *  - Max depth
 *  - Max array length
 *  - Max keys per object
 *  - Circular references
 *  - JSON or YAML output
 */
export function serializeObject(value: unknown, options: SerializeOptions = {}): string {
  const resolved: Required<SerializeOptions> = {
    format: options.format ?? 'json',
    maxDepth: options.maxDepth ?? 4,
    maxArrayLength: options.maxArrayLength ?? 10,
    maxObjectKeys: options.maxObjectKeys ?? 20,
    primitivePolicy: options.primitivePolicy ?? 'value',
    maxStringLength: options.maxStringLength ?? 200,
    indent: options.indent ?? 2,
    includeTruncationMeta: options.includeTruncationMeta ?? true,
    detectConstantArrayValues: options.detectConstantArrayValues ?? true,
  }

  const seen = new WeakSet<object>()

  function summarize(v: unknown, depth: number): unknown {
    // Primitives
    if (
      v === null ||
      typeof v === 'number' ||
      typeof v === 'boolean' ||
      typeof v === 'string' ||
      typeof v === 'bigint' ||
      typeof v === 'symbol' ||
      typeof v === 'undefined'
    ) {
      return summarizePrimitive(v)
    }

    // Date, RegExp, Error, etc.
    if (v instanceof Date) {
      return summarizePrimitive(v.toISOString())
    }

    if (v instanceof RegExp) {
      return summarizePrimitive(v.toString())
    }

    if (v instanceof Error) {
      return summarizePrimitive(`${v.name}: ${v.message}`)
    }

    // Functions
    if (typeof v === 'function') {
      return summarizePrimitive('[Function]')
    }

    // Objects / Arrays
    if (typeof v === 'object' && v !== null) {
      if (seen.has(v)) {
        return '[Circular]'
      }
      seen.add(v)

      if (depth >= resolved.maxDepth) {
        return '[Max depth reached]'
      }

      if (Array.isArray(v)) {
        return summarizeArray(v, depth)
      }

      return summarizeObject(v as Record<string, unknown>, depth)
    }

    // Fallback
    return summarizePrimitive(JSON.stringify(v))
  }

  function summarizePrimitive(v: unknown): unknown {
    const policy = resolved.primitivePolicy

    if (policy === 'placeholder') {
      return '[value omitted]'
    }

    if (policy === 'type') {
      const t = v === null ? 'null' : typeof v
      return `<${t}>`
    }

    // 'value' policy
    if (typeof v === 'string') {
      if (v.length > resolved.maxStringLength) {
        return v.slice(0, resolved.maxStringLength) + '… (truncated)'
      }
      return v
    }

    if (typeof v === 'bigint') {
      return `${v.toString()}n`
    }

    if (typeof v === 'symbol') {
      return v.toString()
    }

    // number | boolean | null | undefined or anything else
    return v
  }

  function summarizeArray(arr: unknown[], depth: number): unknown {
    const len = arr.length

    if (resolved.detectConstantArrayValues) {
      const constantValue = getConstantPrimitiveArrayValue(arr)
      if (constantValue.isConstant) {
        return {
          __arrayType: 'constant',
          __length: len,
          __value: summarizePrimitive(constantValue.value),
        }
      }
    }

    const limit = resolved.maxArrayLength
    const result: unknown[] = []

    const count = Math.min(len, limit)
    for (let i = 0; i < count; i++) {
      result.push(summarize(arr[i], depth + 1))
    }

    if (len > limit && resolved.includeTruncationMeta) {
      result.push({ __omittedItems: len - limit })
    }

    return result
  }

  function getConstantPrimitiveArrayValue(
    arr: unknown[],
  ): { isConstant: true; value: unknown } | { isConstant: false } {
    if (arr.length === 0) {
      return { isConstant: false }
    }

    const first = arr[0]
    if (!isPrimitiveValue(first)) {
      return { isConstant: false }
    }

    for (let i = 1; i < arr.length; i++) {
      if (!Object.is(arr[i], first)) {
        return { isConstant: false }
      }
    }

    return { isConstant: true, value: first }
  }

  function isPrimitiveValue(v: unknown): boolean {
    return v === null || (typeof v !== 'object' && typeof v !== 'function')
  }

  function summarizeObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
    const keys = Object.keys(obj)
    const limit = resolved.maxObjectKeys
    const result: Record<string, unknown> = {}

    const count = Math.min(keys.length, limit)
    for (let i = 0; i < count; i++) {
      const key = keys[i]!
      result[key] = summarize(obj[key], depth + 1)
    }

    if (keys.length > limit && resolved.includeTruncationMeta) {
      result['__omittedKeys'] = keys.length - limit
    }

    return result
  }

  const summarized = summarize(value, 0)

  if (resolved.format === 'yaml') {
    // YAML output
    return yamlStringify(summarized)
  }

  // JSON output
  return JSON.stringify(summarized, null, resolved.indent)
}
