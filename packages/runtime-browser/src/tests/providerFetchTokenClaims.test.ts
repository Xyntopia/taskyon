import assert from 'node:assert/strict'
import { createServer, type RequestListener } from 'node:http'
import test from 'node:test'
import { createTaskyonProviderFetchWithTokenGetter } from '../providerFetch'

const listen = async (
  onRequest: RequestListener,
): Promise<{ origin: string; close: () => Promise<void> }> => {
  const server = createServer(onRequest)
  server.on('upgrade', (_request, socket) => socket.destroy())
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

void test('Provider fetch mints a destination-scoped tunnel token per request', async () => {
  const mintedRequests: {
    service?: unknown
    claims?: unknown
    authorization?: string
  }[] = []
  const tokenService = await listen((request, response) => {
    if (request.url === '/settlement-public-key') {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          cnf: { jwk: { kty: 'OKP', crv: 'Ed25519', x: 'A'.repeat(43) } },
        }),
      )
      return
    }
    if (request.url === '/mint' && request.method === 'POST') {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          requests?: { service?: unknown; claims?: unknown }[]
        }
        mintedRequests.push({
          ...body.requests?.[0],
          authorization: request.headers.authorization,
        })
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ tokens: ['fixture-token'] }))
      })
      return
    }
    response.statusCode = 404
    response.end()
  })

  const tunnelUrl = `${tokenService.origin.replace(/^http/, 'ws')}/ws-proxy`
  let authToken = 'fixture-auth-1'
  const providerFetch = createTaskyonProviderFetchWithTokenGetter(
    { kind: 'secure-wss', tunnelUrl, tokenServiceBaseUrl: tokenService.origin },
    () => authToken,
  )

  try {
    await providerFetch('https://target.example/one').catch(() => undefined)
    authToken = 'fixture-auth-2'
    await providerFetch('http://other.example/two').catch(() => undefined)

    assert.equal(mintedRequests.length, 2)
    assert.equal(mintedRequests[0]?.service, 'web_tunnel')
    assert.deepEqual(mintedRequests[0]?.claims, {
      destination: { host: 'target.example', port: 443 },
    })
    assert.equal(mintedRequests[0]?.authorization, 'Bearer fixture-auth-1')
    assert.equal(mintedRequests[1]?.service, 'web_tunnel')
    assert.deepEqual(mintedRequests[1]?.claims, {
      destination: { host: 'other.example', port: 80 },
    })
    assert.equal(mintedRequests[1]?.authorization, 'Bearer fixture-auth-2')
  } finally {
    await tokenService.close()
  }
})
