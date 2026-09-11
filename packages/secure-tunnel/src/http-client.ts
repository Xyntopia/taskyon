export interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: Uint8Array
}

export interface HttpStreamResponse extends Omit<HttpResponse, 'body'> {
  body: ReadableStream<Uint8Array>
}

const append = (left: Uint8Array, right: Uint8Array) => {
  const combined = new Uint8Array(left.length + right.length)
  combined.set(left)
  combined.set(right, left.length)
  return combined
}

const findSequence = (buffer: Uint8Array, sequence: readonly number[]) => {
  outer: for (let offset = 0; offset <= buffer.length - sequence.length; offset++) {
    for (let index = 0; index < sequence.length; index++) {
      if (buffer[offset + index] !== sequence[index]) continue outer
    }
    return offset
  }
  return -1
}

export function buildHttpRequest(
  method: string,
  urlStr: string,
  headers: Record<string, string>,
  body?: Uint8Array | string,
): Uint8Array {
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(method)) throw new Error('Invalid HTTP method')
  const url = new URL(urlStr)
  const finalHeaders = Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  )
  const port = url.port || (url.protocol === 'http:' ? '80' : '443')
  const defaultPort = url.protocol === 'http:' ? '80' : '443'
  finalHeaders.host ??= port === defaultPort ? url.hostname : `${url.hostname}:${port}`
  finalHeaders['user-agent'] ??= 'taskyon-secure-fetch/1.0'
  finalHeaders.connection ??= 'close'
  finalHeaders['accept-encoding'] = 'identity'

  const bodyBytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
  if (bodyBytes) finalHeaders['content-length'] = String(bodyBytes.length)
  else if (['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
    finalHeaders['content-length'] ??= '0'
  }

  const path = `${url.pathname || '/'}${url.search}`
  const lines = [`${method.toUpperCase()} ${path} HTTP/1.1`]
  for (const [name, value] of Object.entries(finalHeaders)) lines.push(`${name}: ${value}`)
  const head = new TextEncoder().encode(`${lines.join('\r\n')}\r\n\r\n`)
  return bodyBytes ? append(head, bodyBytes) : head
}

const parseHead = (bytes: Uint8Array) => {
  const lines = new TextDecoder().decode(bytes).split('\r\n')
  const statusLine = lines.shift() ?? ''
  const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$/.exec(statusLine)
  if (!match) throw new Error('Invalid HTTP response status line')
  const headers: Record<string, string> = {}
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const name = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value
  }
  return { status: Number(match[1]), statusText: match[2] ?? '', headers }
}

const createBufferedReader = (reader: () => Promise<Uint8Array | null>) => {
  let buffer = new Uint8Array()
  const readMore = async () => {
    const chunk = await reader()
    if (chunk) buffer = append(buffer, chunk)
    return chunk !== null
  }
  const take = (length: number) => {
    const value = buffer.slice(0, length)
    buffer = buffer.slice(length)
    return value
  }
  const ensure = async (length: number) => {
    while (buffer.length < length && (await readMore())) continue
    if (buffer.length < length) throw new Error('Unexpected EOF in HTTP response')
  }
  const readLine = async () => {
    let end = findSequence(buffer, [13, 10])
    while (end < 0) {
      if (!(await readMore())) throw new Error('Unexpected EOF in HTTP response line')
      end = findSequence(buffer, [13, 10])
    }
    const line = new TextDecoder().decode(take(end))
    take(2)
    return line
  }

  return {
    available: () => buffer.length,
    ensure,
    prepend: (bytes: Uint8Array) => {
      buffer = append(bytes, buffer)
    },
    readLine,
    readMore,
    take,
  }
}

const readResponseHead = async (source: ReturnType<typeof createBufferedReader>) => {
  let parsed: ReturnType<typeof parseHead>
  for (;;) {
    await source.ensure(1)
    let headerEnd = -1
    const chunks: Uint8Array[] = []
    while (headerEnd < 0) {
      const available = source.available()
      const bytes = source.take(available)
      chunks.push(bytes)
      const combined = chunks.reduce(append, new Uint8Array())
      if (combined.length > 64 * 1024) throw new Error('HTTP response headers are too large')
      headerEnd = findSequence(combined, [13, 10, 13, 10])
      if (headerEnd >= 0) {
        parsed = parseHead(combined.slice(0, headerEnd))
        const remainder = combined.slice(headerEnd + 4)
        return { parsed, remainder }
      }
      if (!(await source.readMore())) throw new Error('Incomplete response headers')
    }
  }
}

const streamBody = async function* (
  source: ReturnType<typeof createBufferedReader>,
  headers: Record<string, string>,
) {
  const transferEncoding = headers['transfer-encoding']?.toLowerCase()
  const contentLength = headers['content-length']
  if (transferEncoding?.split(',').some((value) => value.trim() === 'chunked')) {
    for (;;) {
      const sizeText = (await source.readLine()).split(';', 1)[0]?.trim() ?? ''
      if (!/^[0-9a-f]+$/i.test(sizeText)) throw new Error('Invalid chunk size')
      const size = Number.parseInt(sizeText, 16)
      if (size === 0) {
        while ((await source.readLine()) !== '') continue
        return
      }
      await source.ensure(size + 2)
      yield source.take(size)
      const terminator = source.take(2)
      if (terminator[0] !== 13 || terminator[1] !== 10) throw new Error('Invalid chunk terminator')
    }
  }
  if (contentLength !== undefined) {
    const length = Number(contentLength)
    if (!Number.isSafeInteger(length) || length < 0) throw new Error('Invalid Content-Length')
    let remaining = length
    while (remaining > 0) {
      if (source.available() === 0 && !(await source.readMore())) {
        throw new Error('Unexpected EOF in HTTP response')
      }
      const chunk = source.take(Math.min(remaining, source.available()))
      remaining -= chunk.length
      yield chunk
    }
    return
  }
  for (;;) {
    if (source.available() > 0) yield source.take(source.available())
    if (!(await source.readMore())) return
  }
}

export async function parseHttpResponseStream(
  reader: () => Promise<Uint8Array | null>,
  onDone: () => void = () => undefined,
): Promise<HttpStreamResponse> {
  const source = createBufferedReader(reader)
  let parsed: ReturnType<typeof parseHead>
  for (;;) {
    const head = await readResponseHead(source)
    parsed = head.parsed
    if (head.remainder.length) source.prepend(head.remainder)
    if (parsed.status < 100 || parsed.status >= 200 || parsed.status === 101) break
  }

  const iterator = streamBody(source, parsed.headers)[Symbol.asyncIterator]()
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    onDone()
  }
  return {
    ...parsed,
    body: new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        try {
          const next = await iterator.next()
          if (next.done) {
            finish()
            controller.close()
          } else controller.enqueue(next.value)
        } catch (error) {
          finish()
          controller.error(error)
        }
      },
      cancel: async () => {
        finish()
        await iterator.return?.()
      },
    }),
  }
}

export async function parseHttpResponse(
  reader: () => Promise<Uint8Array | null>,
): Promise<HttpResponse> {
  const response = await parseHttpResponseStream(reader)
  const body = new Uint8Array(await new Response(response.body).arrayBuffer())
  return { ...response, body }
}
