// error.ts
import { safeYamlDump } from '../yamlUtils'

interface SerializedError {
  name: string
  message: string
  stack?: string // optional, not `string | undefined`
  cause?: SerializableError
  errors?: SerializableError[]
  // allow arbitrary custom props
  [key: string]: unknown
}

interface SerializedNonError {
  nonError: true
  value: unknown
}

type SerializableError = SerializedError | SerializedNonError

// ----- Serialize -----

/**
 * Recursively converts Errors into plain objects with enumerable properties,
 * while leaving primitives and normal objects matching the original structure.
 */
export function serializeError(value: unknown, seen = new WeakSet<object>()): unknown {
  // 1. Pass through primitives (string, number, boolean, null, undefined)
  if (value === null || typeof value !== 'object') {
    return value
  }

  // 2. Prevent infinite loops via Circular References
  if (seen.has(value)) {
    return '[Circular]'
  }
  seen.add(value)

  // 3. Handle Arrays (recurse into elements)
  if (Array.isArray(value)) {
    return value.map((item) => serializeError(item, seen))
  }

  // 4. Handle Error Objects
  if (value instanceof Error) {
    const errorCopy: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    }

    if (value.stack) {
      errorCopy.stack = value.stack
    }

    // Double-cast allows us to treat the Error as a generic dictionary
    // satisfying strict TS checks.
    const rawError = value as unknown as Record<string, unknown>

    // Handle 'cause'
    if ('cause' in value) {
      errorCopy.cause = serializeError(rawError.cause, seen)
    }

    // Handle 'errors' (AggregateError)
    if ('errors' in value && Array.isArray(rawError.errors)) {
      errorCopy.errors = rawError.errors.map((e) => serializeError(e, seen))
    }

    // Copy all other own enumerable properties (custom fields)
    for (const key of Object.keys(value)) {
      if (['name', 'message', 'stack', 'cause', 'errors'].includes(key)) {
        continue
      }
      errorCopy[key] = serializeError(rawError[key], seen)
    }

    return errorCopy
  }

  // 5. Handle Plain Objects (recurse into values)
  const plainObj: Record<string, unknown> = {}
  const sourceObj = value as Record<string, unknown>

  for (const key of Object.keys(sourceObj)) {
    plainObj[key] = serializeError(sourceObj[key], seen)
  }

  return plainObj
}

/**
 * Convert any thrown value into a short, customer-friendly string.
 *
 * Priority: message → HTTP hints → meta fields → nested causes (up to depth 5).
 * Handles Array-style causes (e.g. ["403 Forbidden: …"]) by promoting
 * them to the top of the output.
 * Designed for production UI logs (no stack traces, YAML only).
 */
export function humanizeError(errorInput: unknown): string {
  // console.log('serialized error:', serializeError(errorInput)) // debug if needed
  const seenObjects = new WeakSet<object>()
  const lines: string[] = []

  // Prevent infinite recursion, but allow enough depth for:
  // WrapperError -> CauseObj -> APIError -> InnerDetails
  const MAX_DEPTH = 5

  /* ---------- helpers --------------------------------------------------- */
  const toYaml = (val: unknown): string =>
    typeof val === 'string' ? val : safeYamlDump(val).trim()

  const append = (line: unknown): void => {
    if (typeof line === 'string' && line.trim() && !lines.includes(line.trim())) {
      lines.push(line.trim())
    }
  }

  const appendArray = (arr: unknown[]): void => {
    for (const element of arr) append(element)
  }

  /* ---------- main walker ----------------------------------------------- */
  const traverse = (value: unknown, level = 0): void => {
    if (value == null || level >= MAX_DEPTH) return

    const valueType = typeof value

    // primitives (string | number | boolean | bigint | symbol)
    if (valueType !== 'object' && valueType !== 'function') {
      append(toYaml(value))
      return
    }

    // avoid infinite recursion in graph cycles
    if (seenObjects.has(value as object)) return
    seenObjects.add(value as object)

    // arrays: treat each entry as its own message
    if (Array.isArray(value)) {
      appendArray(value)
      return
    }

    const obj = value as Record<string, unknown>

    /* #1 message fields */
    const message =
      typeof obj.message === 'string'
        ? obj.message
        : typeof obj.msg === 'string'
          ? obj.msg
          : undefined
    if (message) append(message)

    /* #2 HTTP hints */
    if (typeof obj.status === 'number') {
      const statusText =
        typeof obj.statusText === 'string' && obj.statusText ? ` ${obj.statusText}` : ''
      append(`${obj.status}${statusText}`)
    }
    if (typeof obj.url === 'string' && obj.url) append(`URL: ${obj.url}`)

    /* #3 data/body helpers */
    // Expanded to include 'requestBodyValues' for AI SDK errors
    const dataCandidate =
      (typeof obj.response === 'object' && obj.response
        ? (obj.response as Record<string, unknown>).data
        : undefined) ??
      obj.data ??
      (obj as { body?: unknown }).body ??
      (obj as { responseBody?: unknown }).responseBody ??
      (obj as { requestBodyValues?: unknown }).requestBodyValues

    if (dataCandidate !== undefined) {
      append(`Data: ${toYaml(dataCandidate)}`)
    }

    /* #4 meta fields */
    ;(['code', 'errno', 'name'] as const).forEach((key) => {
      const val = obj[key]
      if (typeof val === 'string' && val) append(`${key}=${val}`)
    })

    /* #5 cause (descend deeper) */
    if (level < MAX_DEPTH) {
      const causeKeys = ['cause', 'originalError', 'inner', 'error'] as const
      for (const key of causeKeys) {
        const causeVal = obj[key]
        if (causeVal === undefined) continue

        // Promote array causes so they’re shown first/inline
        if (Array.isArray(causeVal)) {
          appendArray(causeVal)
        } else {
          // Verify the cause isn't empty/useless before appending the arrow
          // (Though checking 'seenObjects' here is tricky, we rely on traverse)
          append('Caused by →')
          traverse(causeVal, level + 1)
        }
        break // handle only the first found cause path to avoid tree explosion
      }
    }
  }

  traverse(errorInput)
  return lines.join('\n')
}
