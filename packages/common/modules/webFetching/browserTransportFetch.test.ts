import assert from 'node:assert/strict'
import { createServer, type RequestListener } from 'node:http'
import test from 'node:test'
import { createCorsAnywhereFetch } from './browserTransportFetch'

const listen = async (
  onRequest: RequestListener,
): Promise<{ origin: string; close: () => Promise<void> }> => {
  const server = createServer(onRequest)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address && typeof address === 'object')
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () =>
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}

void test('CORS Anywhere fetch prefixes the target URL and preserves the request', async () => {
  let received:
    | { url: string; method: string | undefined; requestedWith: string | undefined; body: string }
    | undefined
  const proxy = await listen((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      received = {
        url: request.url ?? '',
        method: request.method,
        requestedWith: request.headers['x-requested-with']?.toString(),
        body: Buffer.concat(chunks).toString('utf8'),
      }
      response.end('proxied')
    })
  })

  try {
    const fetchThroughCorsProxy = createCorsAnywhereFetch({
      proxyUrl: `${proxy.origin}/cors/`,
    })
    const response = await fetchThroughCorsProxy(
      new Request('https://example.com/document.pdf?version=2', {
        method: 'POST',
        body: 'payload',
      }),
    )

    assert.equal(await response.text(), 'proxied')
    assert.deepEqual(received, {
      url: '/cors/https://example.com/document.pdf?version=2',
      method: 'POST',
      requestedWith: 'Taskyon',
      body: 'payload',
    })
  } finally {
    await proxy.close()
  }
})
