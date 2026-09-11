import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createNodeRustlsClientFactory } from './node.ts'

void test('Rustls WASM instantiates and emits a ClientHello', async () => {
  const createClient = await createNodeRustlsClientFactory()
  const client = await createClient('example.com')

  assert.equal(client.isHandshaking(), true)
  assert.ok(client.takeTlsBytes().byteLength > 0)
  client.free()
})

void test('Rustls WASM rejects an invalid server name', async () => {
  const createClient = await createNodeRustlsClientFactory()

  await assert.rejects(() => createClient('not a valid host'))
})
