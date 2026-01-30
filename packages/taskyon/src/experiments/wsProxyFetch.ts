// secure-fetch-over-ws.ts
import { createTlsClient } from '@reclaimprotocol/tls'

/* =====================
   Config
===================== */

const TUNNEL_WS_URL = 'wss://tunnel.example.com'

/* =====================
   Utils
===================== */

const te = new TextEncoder()
const td = new TextDecoder()

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
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

function waitFor(obj: any, ev: string, ms: number) {
  return new Promise<void>((res) => obj.addEventListener(ev, () => res(), { once: true }))
}

/* =====================
   TLS over WebSocket
===================== */

async function openTlsConnection(host: string, port = 443) {
  const ws = new WebSocket(TUNNEL_WS_URL)
  ws.binaryType = 'arraybuffer'

  await waitFor(ws, 'open', 10_000)

  // OPTIONAL: tunnel control message
  // ws.send(JSON.stringify({ host, port }));

  let onHandshakeDone!: () => void
  let onHandshakeErr!: (e: any) => void

  const handshake = new Promise<void>((res, rej) => {
    onHandshakeDone = res
    onHandshakeErr = rej
  })

  const rxQueue: Uint8Array[] = []
  let pendingRead: ((v: Uint8Array) => void) | null = null

  const tls = createTlsClient({
    serverName: host,
    write(data: Uint8Array) {
      ws.send(data)
    },
    onData(data: Uint8Array) {
      if (pendingRead) {
        pendingRead(data)
        pendingRead = null
      } else {
        rxQueue.push(data)
      }
    },
    onHandshakeDone() {
      onHandshakeDone()
    },
    onError(err: any) {
      onHandshakeErr(err)
    },
  })

  ws.onmessage = (ev) => tls.receive(new Uint8Array(ev.data))
  ws.onerror = (e) => onHandshakeErr(e)

  tls.startHandshake()
  await handshake

  return {
    send(data: Uint8Array) {
      tls.send(data)
    },
    read(): Promise<Uint8Array> {
      if (rxQueue.length) return Promise.resolve(rxQueue.shift()!)
      return new Promise((res) => (pendingRead = res))
    },
    close() {
      tls.close()
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
  let buf = new Uint8Array(0)

  while (indexOf(buf, '\r\n\r\n') === null) {
    buf = concat(buf, await read())
  }

  const headerEnd = indexOf(buf, '\r\n\r\n')!
  const headerText = td.decode(buf.slice(0, headerEnd))
  let rest = buf.slice(headerEnd + 4)

  const lines = headerText.split('\r\n')
  const [_, status, ...statusText] = lines[0].split(' ')

  const headers: Record<string, string> = {}
  for (const l of lines.slice(1)) {
    const i = l.indexOf(':')
    headers[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim()
  }

  const len = headers['content-length'] ? parseInt(headers['content-length'], 10) : null

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

const connCache = new Map<string, any>()

export async function secureFetch(urlStr: string, opts: any = {}) {
  const url = new URL(urlStr)
  if (url.protocol !== 'https:') throw new Error('https only')

  const key = `${url.hostname}:${url.port || 443}`
  if (!connCache.has(key)) {
    connCache.set(key, openTlsConnection(url.hostname, Number(url.port) || 443))
  }

  const conn = await connCache.get(key)

  const body = typeof opts.body === 'string' ? te.encode(opts.body) : opts.body

  const req = buildHttpRequest(opts.method || 'GET', url, opts.headers || {}, body)

  conn.send(req)
  const res = await readHttpResponse(conn.read)

  return {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
    async arrayBuffer() {
      return res.body.buffer.slice(0)
    },
    async text() {
      return td.decode(res.body)
    },
    async json() {
      return JSON.parse(td.decode(res.body))
    },
  }
}

/* =====================
   Simple test function
===================== */

export async function selfTest() {
  const start = performance.now()

  const res = await secureFetch('https://example.com/')
  const text = await res.text()

  return {
    ok: res.status === 200,
    status: res.status,
    bytes: text.length,
    durationMs: Math.round(performance.now() - start),
    sample: text.slice(0, 120),
  }
}
