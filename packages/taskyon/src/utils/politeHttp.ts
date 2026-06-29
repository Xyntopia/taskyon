import type { JSONSchema7 } from 'json-schema'

export const DEFAULT_POLITE_HTTP_MIN_DELAY_MS = 1_000

export const politeHttpPolicySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    minDelayMs: {
      type: 'number',
      default: DEFAULT_POLITE_HTTP_MIN_DELAY_MS,
      description:
        'Minimum delay in milliseconds between local browsing requests to the same origin. Set to 0 only for user-owned/local endpoints.',
    },
  },
  default: {
    minDelayMs: DEFAULT_POLITE_HTTP_MIN_DELAY_MS,
  },
  description: 'Polite local browsing controls applied before HTTP requests.',
} as const satisfies JSONSchema7

export type PoliteHttpPolicy = {
  minDelayMs?: number
}

export function parsePoliteHttpPolicy(value: unknown): PoliteHttpPolicy | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('httpPolicy must be an object when provided.')
  }

  const minDelayMs = 'minDelayMs' in value ? value.minDelayMs : undefined
  if (minDelayMs === undefined) return {}
  if (typeof minDelayMs !== 'number') {
    throw new Error('httpPolicy.minDelayMs must be a number when provided.')
  }
  return { minDelayMs }
}

const nextRequestTimeByOrigin = new Map<string, number>()

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const resolveMinDelayMs = (policy?: PoliteHttpPolicy) => {
  const raw = policy?.minDelayMs ?? DEFAULT_POLITE_HTTP_MIN_DELAY_MS
  if (!Number.isFinite(raw)) return DEFAULT_POLITE_HTTP_MIN_DELAY_MS
  return Math.max(0, Math.trunc(raw))
}

export function parseHttpUrl(value: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http(s) URLs are allowed for local browsing requests: ${value}`)
  }
  return url
}

export async function waitForPoliteHttpTurn(url: string | URL, policy?: PoliteHttpPolicy) {
  const parsed = typeof url === 'string' ? parseHttpUrl(url) : url
  const minDelayMs = resolveMinDelayMs(policy)
  if (minDelayMs <= 0) return

  const origin = parsed.origin
  const now = Date.now()
  const nextRequestTime = nextRequestTimeByOrigin.get(origin) ?? 0
  const waitMs = Math.max(0, nextRequestTime - now)
  nextRequestTimeByOrigin.set(origin, Math.max(now, nextRequestTime) + minDelayMs)
  if (waitMs > 0) await sleep(waitMs)
}

export async function politeFetch(
  input: string | URL,
  init?: RequestInit,
  policy?: PoliteHttpPolicy,
) {
  const url = typeof input === 'string' ? parseHttpUrl(input) : input
  await waitForPoliteHttpTurn(url, policy)
  return await fetch(url, init)
}
