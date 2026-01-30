// secure-fetch-over-ws.ts
import { makeTLSClient } from '@reclaimprotocol/tls'

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
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true })
    ws.addEventListener('error', () => reject(new Error('WebSocket error')), { once: true })
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
  const ws = new WebSocket(TUNNEL_WS_URL)
  ws.binaryType = 'arraybuffer'

  await waitForOpen(ws)

  const rxQueue: Uint8Array[] = []
  let pendingRead: ((v: Uint8Array) => void) | null = null

  const tls = makeTLSClient({
    host,
    verifyServerCertificate: true,

    write({ header, content }) {
      ws.send(header)
      if (content && content.length) ws.send(content)
    },

    onHandshake() {},

    onApplicationData(data) {
      const chunk = toU8(data)
      if (pendingRead) {
        pendingRead(chunk)
        pendingRead = null
      } else {
        rxQueue.push(chunk)
      }
    },

    onTlsEnd(err) {
      if (err) console.error('TLS ended:', err)
      ws.close()
    },
  })

  ws.onmessage = (ev) => {
    void tls.handleReceivedBytes(new Uint8Array(ev.data))
  }

  void tls.startHandshake()

  return {
    send(data: Uint8Array) {
      void tls.write(toU8(data))
    },

    read(): Promise<Uint8Array> {
      if (rxQueue.length) return Promise.resolve(rxQueue.shift()!)
      return new Promise((res) => (pendingRead = res))
    },

    close() {
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

  while (indexOf(buf, '\r\n\r\n') === null) {
    buf = concat(buf, await read())
  }

  const headerEnd = indexOf(buf, '\r\n\r\n')!
  const headerText = td.decode(buf.slice(0, headerEnd))
  let rest: Uint8Array = buf.slice(headerEnd + 4)

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

  while (len !== null && rest.length < len) {
    rest = concat(rest, await read())
  }

  return {
    status: Number(status),
    statusText: statusText.join(' '),
    headers,
    body: len !== null ? rest.slice(0, len) : rest,
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
  const url = new URL(urlStr)
  if (url.protocol !== 'https:') throw new Error('https only')

  const key = url.hostname
  if (!connCache.has(key)) {
    connCache.set(key, openTlsConnection(url.hostname))
  }

  const conn = await connCache.get(key)!

  const body = typeof opts.body === 'string' ? te.encode(opts.body) : opts.body

  const req = buildHttpRequest(opts.method || 'GET', url, opts.headers || {}, body)

  conn.send(req)

  const res = await readHttpResponse(() => conn.read())

  return {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,

    arrayBuffer() {
      return res.body.buffer.slice(0)
    },

    text() {
      return td.decode(res.body)
    },

    json() {
      return JSON.parse(td.decode(res.body))
    },
  }
}

/* =====================
   Simple test
===================== */

export async function selfTest() {
  const start = performance.now()

  const res = await secureFetch('https://example.com/')
  const text = res.text()

  return {
    ok: res.status === 200,
    status: res.status,
    bytes: text.length,
    durationMs: Math.round(performance.now() - start),
    sample: text.slice(0, 120),
  }
}
