import { safeYamlDump } from './yamlUtils'

/**
 * Convert any thrown value into a short, customer-friendly string.
 *
 * Priority: message → HTTP hints → meta fields → one-level cause.
 * Handles Array-style causes (e.g. ["403 Forbidden: …"]) by promoting
 * them to the top of the output.
 * Designed for production UI logs (no stack traces, YAML only).
 */
export function humanizeError(errorInput: unknown): string {
  const seenObjects = new WeakSet<object>()
  const lines: string[] = []

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
    if (value == null) return

    const valueType = typeof value

    // primitives (string | number | boolean | bigint | symbol)
    if (valueType !== 'object' && valueType !== 'function') {
      append(toYaml(value))
      return
    }

    // avoid infinite recursion
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
    const dataCandidate =
      (typeof obj.response === 'object' && obj.response
        ? (obj.response as Record<string, unknown>).data
        : undefined) ??
      obj.data ??
      (obj as { body?: unknown }).body ??
      (obj as { responseBody?: unknown }).responseBody
    if (dataCandidate !== undefined)
      append(`Data: ${toYaml(dataCandidate)}`)

      /* #4 meta fields */
    ;(['code', 'errno', 'name'] as const).forEach((key) => {
      const val = obj[key]
      if (typeof val === 'string' && val) append(`${key}=${val}`)
    })

    /* #5 cause (descend one level) */
    if (level === 0) {
      const causeKeys = ['cause', 'originalError', 'inner', 'error'] as const
      for (const key of causeKeys) {
        const causeVal = obj[key]
        if (causeVal === undefined) continue

        // Promote array causes so they’re shown first
        if (Array.isArray(causeVal)) {
          appendArray(causeVal)
        } else {
          append('Caused by →')
          traverse(causeVal, level + 1)
        }
        break // handle only the first found cause
      }
    }
  }

  traverse(errorInput)
  return lines.join('\n')
}
