import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_SANDBOX_FETCH_TRANSPORT, resolveSandboxFetchTransport } from './mediatedFetch.ts'

void test('sandbox fetch uses the secure WSS transport by default', () => {
  assert.equal(DEFAULT_SANDBOX_FETCH_TRANSPORT, 'wss')
  assert.equal(resolveSandboxFetchTransport(DEFAULT_SANDBOX_FETCH_TRANSPORT, 'default'), 'wss')
  assert.equal(resolveSandboxFetchTransport(DEFAULT_SANDBOX_FETCH_TRANSPORT, 'proxy'), 'wss')
  assert.equal(resolveSandboxFetchTransport('custom-proxy', 'default'), 'custom-proxy')
  assert.equal(resolveSandboxFetchTransport('direct', 'proxy'), 'direct')
  assert.equal(resolveSandboxFetchTransport('wss', 'direct'), 'direct')
})
