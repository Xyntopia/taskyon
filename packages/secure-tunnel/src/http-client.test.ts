import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildHttpRequest, parseHttpResponse, parseHttpResponseStream } from './http-client.ts'
import { SUPPORTED_TLS_PROTOCOL_VERSIONS } from './tls-websocket.ts'

void test('TLS policy allows only TLS 1.2 and 1.3', () => {
  assert.deepEqual(SUPPORTED_TLS_PROTOCOL_VERSIONS, ['TLS1_3', 'TLS1_2'])
})

const readerFrom = (chunks: readonly string[]) => {
  const encoded = chunks.map((chunk) => new TextEncoder().encode(chunk))
  return async () => encoded.shift() ?? null
}

void test('buildHttpRequest uses the effective Host header and closes one-shot tunnels', () => {
  const request = new TextDecoder().decode(
    buildHttpRequest('GET', 'https://example.com/path?q=1', {}, undefined),
  )
  assert.match(request, /^GET \/path\?q=1 HTTP\/1\.1\r\n/)
  assert.match(request, /\r\nhost: example\.com\r\n/)
  assert.match(request, /\r\nconnection: close\r\n/)
  assert.match(request, /\r\naccept-encoding: identity\r\n/)
})

void test('buildHttpRequest rejects request-line injection through the method', () => {
  assert.throws(() => buildHttpRequest('GET\r\nX-Injected: yes', 'https://example.com/', {}))
})

void test('parseHttpResponse handles fragmented chunked bodies and chunk extensions', async () => {
  const response = await parseHttpResponse(
    readerFrom([
      'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/plain\r\n\r\n4;foo=bar\r\nWi',
      'ki\r\n5\r\nped',
      'ia\r\n0\r\nX-Trailer: value\r\n\r\n',
    ]),
  )
  assert.equal(new TextDecoder().decode(response.body), 'Wikipedia')
})

void test('parseHttpResponse skips informational responses', async () => {
  const response = await parseHttpResponse(
    readerFrom(['HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok']),
  )
  assert.equal(response.status, 200)
  assert.equal(new TextDecoder().decode(response.body), 'ok')
})

void test('parseHttpResponseStream returns after headers and streams later chunks', async () => {
  let release: (() => void) | undefined
  const later = new Promise<void>((resolve) => {
    release = resolve
  })
  let index = 0
  const chunks = [
    new TextEncoder().encode('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nfirst\r\n'),
    new TextEncoder().encode('6\r\nsecond\r\n0\r\n\r\n'),
  ]
  const response = await parseHttpResponseStream(async () => {
    if (index === 1) await later
    return chunks[index++] ?? null
  })
  assert.equal(response.status, 200)
  release?.()
  assert.equal(await new Response(response.body).text(), 'firstsecond')
})
