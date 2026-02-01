// wsProxyFetch.ts

const DEBUG = true

function log(...args: unknown[]) {
  if (DEBUG) console.log('[secure-fetch-over-ws]', ...args)
}

// TODO: try out alternative library:
//       https://github.com/jawj/subtls/tree/main

log('@reclaimprotocol/tls')
import { setCryptoImplementation, makeTLSClient } from '@reclaimprotocol/tls'
log('and get webcryptoCrypto')
// import { webcryptoCrypto } from '@reclaimprotocol/tls/webcrypto'
// setCryptoImplementation(webcryptoCrypto)

// TODO: why does webcryptoCrypto  not work???
import { pureJsCrypto } from '@reclaimprotocol/tls/purejs-crypto'

// Configure TLS to use WebCrypto in the browser
log('setting TLS crypto impl')
setCryptoImplementation(pureJsCrypto) // Extra debug flag

/* =====================
   Config
===================== */

//const TUNNEL_WS_URL = 'wss://tunnel.example.com'
const TUNNEL_WS_URL = 'ws://127.0.0.1:8443'

/* =====================
   Utils
===================== */

const te = new TextEncoder()
const td = new TextDecoder()

function toU8(data: Uint8Array): Uint8Array {
  return data.buffer instanceof ArrayBuffer ? data : new Uint8Array(data.buffer.slice(0))
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const aa = toU8(a)
  const bb = toU8(b)

  const out = new Uint8Array(aa.length + bb.length)
  out.set(aa, 0)
  out.set(bb, aa.length)
  return out
}

function indexOf(buf: Uint8Array, needleStr: string): number | null {
  const needle = te.encode(needleStr)
  outer: for (let i = 0; i <= buf.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (buf[i + j] !== needle[j]) continue outer
    }
    return i
  }
  return null
}

function waitForOpen(ws: WebSocket): Promise<void> {
  log('waitForOpen: attaching event listeners for', ws.url)
  return new Promise((resolve, reject) => {
    ws.addEventListener(
      'open',
      () => {
        log('WebSocket open to tunnel', ws.url)
        resolve()
      },
      { once: true },
    )
    ws.addEventListener(
      'error',
      (ev) => {
        log('WebSocket error while opening', ev)
        reject(new Error('WebSocket error'))
      },
      { once: true },
    )
  })
}

/* =====================
   TLS over WebSocket
===================== */

type TlsConnection = {
  send(data: Uint8Array): void
  read(): Promise<Uint8Array>
  close(): void
}

async function openTlsConnection(host: string): Promise<TlsConnection> {
  log('openTlsConnection: creating WebSocket to tunnel', TUNNEL_WS_URL, 'for host', host)
  // Pass the target TLS host to the proxy as a query param so the server
  // can know which upstream host to connect to.
  const wsUrl = `${TUNNEL_WS_URL}/?host=${encodeURIComponent(host)}`
  const ws = new WebSocket(wsUrl)
  ws.binaryType = 'arraybuffer'

  log('openTlsConnection: waiting for WebSocket to open')
  await waitForOpen(ws)

  log('openTlsConnection: WebSocket open, setting up TLS client')
  const rxQueue: Uint8Array[] = []
  let pendingRead: ((v: Uint8Array) => void) | null = null

  // Handshake completion gate: we must not send application data
  // before the TLS handshake has fully completed, otherwise
  // makeTLSClient.write will throw "Handshake not done".
  let resolveHandshake: (() => void) | null = null
  const handshakeDone = new Promise<void>((resolve) => {
    resolveHandshake = resolve
  })

  const tls = makeTLSClient({
    host,
    verifyServerCertificate: true,

    write({ header, content }) {
      log(
        'TLS write: sending record(s) over WebSocket',
        'header bytes =',
        header?.byteLength ?? 0,
        'content bytes =',
        content?.byteLength ?? 0,
      )
      ws.send(header)
      if (content && content.length) ws.send(content)
    },

    onHandshake() {
      log('TLS handshake completed for host', host)
      resolveHandshake?.()
    },

    onApplicationData(data) {
      const chunk = toU8(data)
      log('TLS application data received, bytes =', chunk.byteLength)
      if (pendingRead) {
        log('Delivering data to pending reader')
        pendingRead(chunk)
        pendingRead = null
      } else {
        log('Queueing data chunk, queue length before push =', rxQueue.length)
        rxQueue.push(chunk)
      }
    },

    onTlsEnd(err) {
      if (err) log('TLS ended with error:', err)
      else log('TLS ended cleanly for host', host)
      ws.close()
    },
  })

  ws.onmessage = (ev) => {
    const data = new Uint8Array(ev.data)
    log('WebSocket message received, bytes =', data.byteLength)
    void tls.handleReceivedBytes(data)
  }

  ws.onclose = (ev) => {
    log('WebSocket closed', { code: ev.code, reason: ev.reason, wasClean: ev.wasClean })
  }

  ws.onerror = (ev) => {
    log('WebSocket error after open', ev)
  }

  log('openTlsConnection: starting TLS handshake')
  void tls.startHandshake()

  return {
    async send(data: Uint8Array) {
      // Ensure the TLS handshake has fully completed before
      // sending any application data, otherwise makeTLSClient
      // will throw "Handshake not done".
      await handshakeDone
      const d = toU8(data)
      log('TlsConnection.send called, bytes =', d.byteLength)
      await tls.write(d)
    },

    async read(): Promise<Uint8Array> {
      // Also wait for handshake to complete before attempting
      // to read application data.
      await handshakeDone
      if (rxQueue.length) {
        const chunk = rxQueue.shift()!
        log('TlsConnection.read: returning queued chunk, bytes =', chunk.byteLength)
        return chunk
      }
      log('TlsConnection.read: waiting for next chunk')
      return new Promise((res) => (pendingRead = res))
    },

    close() {
      log('TlsConnection.close: closing WebSocket')
      ws.close()
    },
  }
}

/* =====================
   HTTP/1.1
===================== */

function buildHttpRequest(
  method: string,
  url: URL,
  headers: Record<string, string>,
  body?: Uint8Array,
): Uint8Array {
  log('buildHttpRequest:', { method, url: url.toString() })
  const lines: string[] = []

  lines.push(`${method} ${url.pathname + url.search || '/'} HTTP/1.1`)
  lines.push(`Host: ${url.host}`)

  for (const [k, v] of Object.entries(headers)) {
    lines.push(`${k}: ${v}`)
  }

  if (body) lines.push(`Content-Length: ${body.byteLength}`)

  lines.push('', '')

  const head = te.encode(lines.join('\r\n'))
  return body ? concat(head, body) : head
}

async function readHttpResponse(read: () => Promise<Uint8Array>) {
  let buf: Uint8Array = new Uint8Array(0)

  log('readHttpResponse: reading until headers complete')

  while (indexOf(buf, '\r\n\r\n') === null) {
    const chunk = await read()
    log('readHttpResponse: received chunk while waiting for headers, bytes =', chunk.byteLength)
    buf = concat(buf, chunk)
  }

  const headerEnd = indexOf(buf, '\r\n\r\n')!
  const headerText = td.decode(buf.slice(0, headerEnd))
  let rest: Uint8Array = buf.slice(headerEnd + 4)

  log('readHttpResponse: raw headers =\n' + headerText)

  const lines = headerText.split('\r\n')
  if (!lines[0]) throw new Error('Invalid HTTP response')

  const [, status, ...statusText] = lines[0].split(' ')

  const headers: Record<string, string> = {}
  for (const l of lines.slice(1)) {
    const i = l.indexOf(':')
    if (i > 0) {
      headers[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim()
    }
  }

  const len = headers['content-length'] ? Number.parseInt(headers['content-length'], 10) : null

  log('readHttpResponse: parsed status/header', {
    status: Number(status),
    statusText: statusText.join(' '),
    contentLength: len,
  })

  while (len !== null && rest.length < len) {
    const chunk = await read()
    log('readHttpResponse: reading body chunk, bytes =', chunk.byteLength)
    rest = concat(rest, chunk)
  }

  const body = len !== null ? rest.slice(0, len) : rest

  log('readHttpResponse: body complete, bytes =', body.byteLength)

  return {
    status: Number(status),
    statusText: statusText.join(' '),
    headers,
    body,
  }
}

/* =====================
   secureFetch
===================== */

const connCache = new Map<string, Promise<TlsConnection>>()

export async function secureFetch(
  urlStr: string,
  opts: {
    method?: string
    headers?: Record<string, string>
    body?: Uint8Array | string
  } = {},
) {
  log('secureFetch called with', { urlStr, opts })
  const url = new URL(urlStr)
  if (url.protocol !== 'https:') throw new Error('https only')

  const key = url.hostname
  if (!connCache.has(key)) {
    log('secureFetch: no cached connection for host, opening new TLS connection', key)
    connCache.set(key, openTlsConnection(url.hostname))
  } else {
    log('secureFetch: reusing cached connection for host', key)
  }

  const conn = await connCache.get(key)!
  log('secureFetch: got TLS connection, building HTTP request')
  if (typeof opts.body === 'string') {
    log('secureFetch: body is string, length =', opts.body.length)
  }
  const body = typeof opts.body === 'string' ? te.encode(opts.body) : opts.body

  const req = buildHttpRequest(opts.method || 'GET', url, opts.headers || {}, body)

  log('secureFetch: sending HTTP request bytes =', req.byteLength)
  conn.send(req)

  log('secureFetch: waiting for HTTP response')
  const res = await readHttpResponse(() => conn.read())

  log('secureFetch: response received', { status: res.status, statusText: res.statusText })

  return {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,

    arrayBuffer() {
      log('secureFetch.arrayBuffer called')
      return res.body.buffer.slice(0)
    },

    text() {
      log('secureFetch.text called')
      return td.decode(res.body)
    },

    json() {
      log('secureFetch.json called')
      return JSON.parse(td.decode(res.body))
    },
  }
}

/* =====================
   Simple test
===================== */

export async function testSecureProxyFetch() {
  log('selfTest: starting')
  const start = performance.now()

  try {
    const res = await secureFetch('https://example.com/')
    const text = res.text()

    const result = {
      ok: res.status === 200,
      status: res.status,
      bytes: text.length,
      durationMs: Math.round(performance.now() - start),
      sample: text.slice(0, 120),
    }

    log('selfTest: completed', result)
    return result
  } catch (err) {
    log('selfTest: error', err)
    throw err
  }
}
