import type { JSONSchema7 } from 'json-schema'
import { createDeepTransformer, normalizeFalsyValues } from './objHelpers'
import { asyncLruCache, reconcileWithDefaults } from './utils'
import { jsonSchemaToYamlString } from './yamlUtils'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testAsyncLruCacheCachesResolvedValues = async () => {
  let calls = 0
  const cached = asyncLruCache(2)((value: string) => {
    calls += 1
    return `${value}:${calls}`
  })

  const first = await cached('alpha')
  const second = await cached('alpha')

  assert(first === 'alpha:1', `Unexpected first value: ${first}`)
  assert(second === first, `Expected cached second value, got ${second}`)
  assert(calls === 1, `Expected one underlying call, got ${calls}`)
  return { calls, first, second }
}

export const testAsyncLruCacheDeduplicatesInFlightCalls = async () => {
  let calls = 0
  const cached = asyncLruCache(2)(async (value: string) => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 1))
    return `${value}:${calls}`
  })

  const [first, second] = await Promise.all([cached('alpha'), cached('alpha')])

  assert(first === second, `Expected shared in-flight result, got ${first} and ${second}`)
  assert(calls === 1, `Expected one underlying call, got ${calls}`)
  return { calls, first, second }
}

export const testAsyncLruCacheInvalidatesEntries = async () => {
  let calls = 0
  const cached = asyncLruCache(2)((value: string) => {
    calls += 1
    return `${value}:${calls}`
  })

  const first = await cached('alpha')
  cached.invalidate('alpha')
  const second = await cached('alpha')

  assert(first === 'alpha:1', `Unexpected first value: ${first}`)
  assert(second === 'alpha:2', `Expected recomputed value after invalidation, got ${second}`)
  assert(calls === 2, `Expected two underlying calls, got ${calls}`)
  return { calls, first, second }
}

export const testAsyncLruCacheClearCacheRemovesEntries = async () => {
  let calls = 0
  const cached = asyncLruCache(2)((value: string) => {
    calls += 1
    return `${value}:${calls}`
  })

  const first = await cached('alpha')
  cached.clearCache()
  const second = await cached('alpha')

  assert(first === 'alpha:1', `Unexpected first value: ${first}`)
  assert(second === 'alpha:2', `Expected recomputed value after clearCache, got ${second}`)
  assert(calls === 2, `Expected two underlying calls, got ${calls}`)
  return { calls, first, second }
}

testAsyncLruCacheCachesResolvedValues.description = 'Caches resolved async values by argument key.'
testAsyncLruCacheDeduplicatesInFlightCalls.description =
  'Shares one in-flight promise for concurrent identical calls.'
testAsyncLruCacheInvalidatesEntries.description =
  'Recomputes an entry after invalidate() removes its key.'
testAsyncLruCacheClearCacheRemovesEntries.description =
  'Recomputes cached entries after clearCache().'

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((value, index) => structurallyEqual(value, right[index]))
  }
  if (
    !left ||
    !right ||
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    Object.getPrototypeOf(left) !== Object.prototype ||
    Object.getPrototypeOf(right) !== Object.prototype
  ) {
    return false
  }

  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every(
    (key) =>
      Object.hasOwn(rightRecord, key) && structurallyEqual(leftRecord[key], rightRecord[key]),
  )
}

export function testReconcileWithDefaults() {
  const diagnostics: Array<{
    name: string
    status: 'PASS' | 'FAIL'
    expected?: unknown
    actual?: unknown
  }> = []
  const summary = { total: 0, passed: 0, failed: 0 }

  const runTest = (
    name: string,
    stored: unknown,
    defaults: unknown,
    expected: unknown,
    options?: Parameters<typeof reconcileWithDefaults>[2],
  ) => {
    summary.total += 1
    const actual = reconcileWithDefaults(stored, defaults, options)
    const passed = structurallyEqual(actual, expected)

    if (passed) {
      summary.passed += 1
      diagnostics.push({ name, status: 'PASS' })
    } else {
      summary.failed += 1
      diagnostics.push({ name, status: 'FAIL', expected, actual })
    }

    assert(
      passed,
      `FAIL: ${name} | Expected: ${JSON.stringify(expected)} | Got: ${JSON.stringify(actual)}`,
    )
  }

  const defaultSettings = {
    theme: 'dark',
    fontSize: 14,
    features: { beta: false, notifications: true },
    tags: ['default-tag'],
    user: null,
  }

  runTest(
    'Should keep stored values when types match',
    { theme: 'light', features: { beta: true, notifications: true } },
    defaultSettings,
    {
      theme: 'light',
      fontSize: 14,
      features: { beta: true, notifications: true },
      tags: ['default-tag'],
      user: null,
    },
  )
  runTest('Should use default value on type mismatch', { fontSize: '16' }, defaultSettings, {
    theme: 'dark',
    fontSize: 14,
    features: { beta: false, notifications: true },
    tags: ['default-tag'],
    user: null,
  })
  runTest(
    'Should correctly handle null type mismatch',
    { user: { name: 'test' } },
    defaultSettings,
    defaultSettings,
  )
  runTest(
    'Should drop unknown keys by default',
    { theme: 'light', unknownKey: 'drop' },
    defaultSettings,
    {
      ...defaultSettings,
      theme: 'light',
    },
  )
  runTest(
    'Should preserve unknown keys when requested',
    {
      theme: 'light',
      unknownKey: 'keep',
      features: { beta: true, extraFeature: 'also-kept' },
    },
    defaultSettings,
    {
      ...defaultSettings,
      theme: 'light',
      features: { beta: true, notifications: true, extraFeature: 'also-kept' },
      unknownKey: 'keep',
    },
    { preserveUnknownKeys: true },
  )
  runTest(
    'Should reconcile array elements based on default template',
    { tags: ['user-tag', 123, 'another-tag'] },
    { tags: ['string-template'] },
    { tags: ['user-tag', 'string-template', 'another-tag'] },
  )
  runTest(
    'Should accept stored array if default array is empty',
    { list: [1, 2, 'a'] },
    { list: [] },
    { list: [1, 2, 'a'] },
  )
  runTest(
    'Should keep value when it passes validation',
    { theme: 'light' },
    defaultSettings,
    { ...defaultSettings, theme: 'light' },
    { validators: { theme: (value) => value === 'light' || value === 'dark' } },
  )
  runTest(
    'Should use default value when validation fails',
    { theme: 'blue' },
    defaultSettings,
    defaultSettings,
    { validators: { theme: (value) => value === 'light' || value === 'dark' } },
  )

  return { summary, diagnostics }
}

export function testCreateDeepTansformer() {
  const robustKeys = createDeepTransformer({
    keyFn: (key) =>
      String(key)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ''),
  })
  const transformed = robustKeys({
    'Foo-Bar': 1,
    Nested_Key: { 'Inner Map': 2 },
    arr: [{ 'X-Y': 3 }],
  })
  const expected = { foobar: 1, nestedkey: { innermap: 2 }, arr: [{ xy: 3 }] }
  assert(JSON.stringify(transformed) === JSON.stringify(expected), 'Deep key transform failed')

  const normalized = normalizeFalsyValues()({
    a: 'no',
    b: 'yes',
    c: 0,
    d: 'OK',
    nested: ['n/a', 'Y'],
  })
  const expectedNormalized = {
    a: false,
    b: 'yes',
    c: false,
    d: 'OK',
    nested: [false, 'Y'],
  }
  assert(
    JSON.stringify(normalized) === JSON.stringify(expectedNormalized),
    'Falsy-value normalization failed',
  )
  return { transformed, normalized }
}

export function testJsonSchemaToYaml() {
  const schema: JSONSchema7 = {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', description: 'identifier' },
      count: { type: 'number', default: 0, description: 'counter' },
      tags: { type: 'array', items: { type: 'string' }, description: 'labels' },
      meta: {
        type: 'object',
        properties: {
          flag: { type: 'boolean' },
          tier: { enum: ['free', 'pro', 'enterprise'], description: 'user tier' },
        },
        description: 'metadata',
      },
    },
  }
  const postfix = ' (optional)'
  const out = jsonSchemaToYamlString(schema, postfix)
  const expected = `\
# identifier
id: string
# counter${postfix}
count: number
# labels${postfix}
tags:
  type: array
  items: string
# metadata${postfix}
meta:
  flag: boolean
  # user tier${postfix}
  tier: free|pro|enterprise
`

  assert(out.trim() === expected.trim(), 'YAML output does not match the expected snapshot')
  return { out }
}
