import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { createHttpProxyFetch } from './httpProxyFetch'

void test('HTTP proxy fetch selects proxy and direct transports explicitly', async () => {
  const requests: Array<{ url: string; authorization: string | undefined; body: string }> = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      requests.push({
        url: request.url ?? '',
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      response.end('proxied')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert(address && typeof address === 'object')
    const proxyUrl = `http://127.0.0.1:${address.port}/proxy`
    const proxyFetch = createHttpProxyFetch({
      proxyUrl,
      getToken: () => Promise.resolve('test-token'),
    })
    const response = await proxyFetch(
      'https://example.com/resource',
      { method: 'POST', body: 'payload' },
      { policy: 'proxy', proxy: { cacheBust: true, stripHeaders: true } },
    )
    assert.equal(await response.text(), 'proxied')
    const request = requests.at(0)
    assert(request)
    const receivedUrl = new URL(request.url, proxyUrl)
    assert.equal(receivedUrl.searchParams.get('url'), 'https://example.com/resource')
    assert.equal(receivedUrl.searchParams.get('sH'), '1')
    assert(receivedUrl.searchParams.has('cb'))
    assert.equal(request.authorization, 'Bearer test-token')
    assert.equal(request.body, 'payload')

    const direct = await proxyFetch(proxyUrl, undefined, { policy: 'direct' })
    assert.equal(await direct.text(), 'proxied')
    assert.equal(requests.length, 2)
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})

void test('HTTP proxy fetch refreshes a stale settlement key once', async () => {
  let requests = 0
  const refreshValues: boolean[] = []
  const server = createServer((_request, response) => {
    requests += 1
    if (requests === 1) {
      response.statusCode = 401
      response.end('instance_key_mismatch')
      return
    }
    response.end('retried')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    assert(address && typeof address === 'object')
    const proxyFetch = createHttpProxyFetch({
      proxyUrl: `http://127.0.0.1:${address.port}/proxy`,
      getToken: (_target, refreshInstanceKey = false) => {
        refreshValues.push(refreshInstanceKey)
        return Promise.resolve(refreshInstanceKey ? 'fresh-token' : 'stale-token')
      },
    })

    const response = await proxyFetch('https://example.com/')
    assert.equal(await response.text(), 'retried')
    assert.deepEqual(refreshValues, [false, true])
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
