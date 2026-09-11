import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SECURE_FETCH_SMOKE_TARGETS } from './secure-fetch-smoke-targets.ts'

void test('online smoke catalog contains at least 100 unique, supported requests', () => {
  assert.ok(SECURE_FETCH_SMOKE_TARGETS.length >= 100)
  assert.equal(
    new Set(SECURE_FETCH_SMOKE_TARGETS.map(({ name }) => name)).size,
    SECURE_FETCH_SMOKE_TARGETS.length,
  )
  for (const target of SECURE_FETCH_SMOKE_TARGETS) {
    const url = new URL(target.url)
    assert.ok(url.protocol === 'http:' || url.protocol === 'https:')
    assert.ok(!url.port || url.port === '80' || url.port === '443')
  }
})
