import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createTaskyonDevCorsProxy,
  isTaskyonDevCorsProxyRequestAllowed,
  rewriteTaskyonDevCorsProxyLocation,
  withoutHttp2HopByHopHeaders,
} from './devCorsProxy'

void test('development proxy route rejects cross-site and unmarked browser requests', () => {
  assert.equal(isTaskyonDevCorsProxyRequestAllowed({}), false)
  assert.equal(
    isTaskyonDevCorsProxyRequestAllowed({
      'x-requested-with': 'Taskyon',
      'sec-fetch-site': 'cross-site',
    }),
    false,
  )
  assert.equal(
    isTaskyonDevCorsProxyRequestAllowed({
      'x-requested-with': 'Taskyon',
      'sec-fetch-site': 'same-origin',
    }),
    true,
  )
})

void test('development proxy route removes HTTP/1 hop-by-hop response headers', () => {
  assert.deepEqual(
    withoutHttp2HopByHopHeaders({
      connection: 'upgrade',
      'content-type': 'text/plain',
      upgrade: 'h2c',
    }),
    { 'content-type': 'text/plain' },
  )
})

void test('development proxy route keeps upstream redirects inside its mounted path', () => {
  assert.equal(
    rewriteTaskyonDevCorsProxyLocation('https://127.0.0.1:9000/https://example.com/document.pdf'),
    'https://127.0.0.1:9000/__taskyon_dev_proxy/https://example.com/document.pdf',
  )
  assert.equal(
    rewriteTaskyonDevCorsProxyLocation('https://accounts.example.com/login'),
    'https://accounts.example.com/login',
  )
})

void test('development CORS proxy requires its private forwarding secret', async () => {
  const proxy = createTaskyonDevCorsProxy({ port: 0, secret: 'expected-secret' })
  const origin = await proxy.start()
  try {
    const response = await fetch(`${origin}/https://example.com/`)
    assert.equal(response.status, 403)
    assert.match(await response.text(), /authorized Taskyon development server/i)
  } finally {
    await proxy.close()
  }
})

void test('development CORS proxy rejects private targets before opening a socket', async () => {
  const proxy = createTaskyonDevCorsProxy({ port: 0, secret: 'expected-secret' })
  const origin = await proxy.start()
  try {
    const response = await fetch(`${origin}/http://127.0.0.1/private`, {
      headers: { 'x-taskyon-dev-proxy-secret': 'expected-secret' },
    })
    assert.equal(response.status, 403)
    assert.match(await response.text(), /private or local target/i)
  } finally {
    await proxy.close()
  }
})

void test('development CORS proxy rejects hostnames resolving to private addresses', async () => {
  const proxy = createTaskyonDevCorsProxy({
    port: 0,
    secret: 'expected-secret',
    resolveHost: () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]),
  })
  const origin = await proxy.start()
  try {
    const response = await fetch(`${origin}/https://public.example/private`, {
      headers: { 'x-taskyon-dev-proxy-secret': 'expected-secret' },
    })
    assert.equal(response.status, 403)
    assert.match(await response.text(), /private or local address/i)
  } finally {
    await proxy.close()
  }
})

void test('development CORS proxy exposes the CORS Anywhere health response', async () => {
  const proxy = createTaskyonDevCorsProxy({ port: 0, secret: 'expected-secret' })
  const origin = await proxy.start()
  try {
    const response = await fetch(`${origin}/iscorsneeded`, {
      headers: { 'x-taskyon-dev-proxy-secret': 'expected-secret' },
    })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'no')
  } finally {
    await proxy.close()
  }
})
