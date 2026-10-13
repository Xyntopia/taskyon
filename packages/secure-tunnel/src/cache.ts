export const DEFAULT_FETCH_CACHE_ENTRY_BYTES = 16 * 1024 * 1024

export type SecureFetchCacheEntry = {
  url: string
  status: number
  statusText: string
  headers: [string, string][]
  body: Uint8Array
  vary?: [string, string][]
  storedAt: number
  expiresAt: number
}

export type SecureFetchCache = {
  maxEntryBytes?: number
  get(url: string): Promise<SecureFetchCacheEntry | null>
  set(entry: SecureFetchCacheEntry): Promise<void>
  delete(url: string): Promise<void>
}

const cacheDirectives = (headers: Headers) =>
  new Map(
    (headers.get('cache-control') ?? '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .map((value) => {
        const [name, raw] = value.split('=', 2)
        return [name!, raw?.replace(/^"|"$/g, '')]
      }),
  )

const expiry = (headers: Headers, now: number) => {
  const directives = cacheDirectives(headers)
  if (directives.has('no-store') || headers.get('vary')?.trim() === '*') return
  if (directives.has('no-cache')) return now
  const maxAge = Number(directives.get('max-age'))
  if (Number.isFinite(maxAge) && maxAge >= 0) return now + maxAge * 1000
  const expires = Date.parse(headers.get('expires') ?? '')
  return Number.isFinite(expires) ? expires : undefined
}

const toResponse = (entry: SecureFetchCacheEntry) =>
  new Response(entry.body.slice().buffer, {
    status: entry.status,
    statusText: entry.statusText,
    headers: entry.headers,
  })

const varyValues = (headers: Headers, requestHeaders: Headers) =>
  (headers.get('vary') ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
    .map((name): [string, string] => [name, requestHeaders.get(name) ?? ''])

const matchesVary = (entry: SecureFetchCacheEntry, requestHeaders: Headers) =>
  (entry.vary ?? []).every(([name, value]) => requestHeaders.get(name) === value)

export const createCachedSecureFetch =
  <FetchOptions = never>(
    fetchImpl: (
      input: RequestInfo | URL,
      init?: RequestInit,
      options?: FetchOptions,
    ) => Promise<Response>,
    cache: SecureFetchCache,
    now: () => number = Date.now,
  ) =>
  async (input: RequestInfo | URL, init: RequestInit = {}, fetchOptions?: FetchOptions) => {
    const request = input instanceof Request ? input : undefined
    const url = new URL(input instanceof Request ? input.url : input).href
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase()
    const requestHeaders = new Headers(init.headers ?? request?.headers)
    const cacheableRequest =
      (method === 'GET' || method === 'HEAD') &&
      !requestHeaders.has('authorization') &&
      !requestHeaders.has('cookie') &&
      init.cache !== 'no-store'
    const candidate = cacheableRequest ? await cache.get(url) : null
    const cached = candidate && matchesVary(candidate, requestHeaders) ? candidate : null
    if (
      cached &&
      init.cache !== 'reload' &&
      init.cache !== 'no-cache' &&
      cached.expiresAt > now()
    ) {
      return toResponse(cached)
    }

    const conditionalHeaders = new Headers(requestHeaders)
    if (cached) {
      const cachedHeaders = new Headers(cached.headers)
      const etag = cachedHeaders.get('etag')
      const modified = cachedHeaders.get('last-modified')
      if (etag) conditionalHeaders.set('if-none-match', etag)
      if (modified) conditionalHeaders.set('if-modified-since', modified)
    }
    const response = await fetchImpl(
      request ?? url,
      { ...init, headers: conditionalHeaders },
      fetchOptions,
    )
    if (response.status === 304 && cached) {
      const headers = new Headers(cached.headers)
      response.headers.forEach((value, name) => headers.set(name, value))
      const expiresAt = expiry(headers, now()) ?? cached.expiresAt
      const refreshed = { ...cached, headers: [...headers.entries()], storedAt: now(), expiresAt }
      await cache.set(refreshed)
      return toResponse(refreshed)
    }
    const expiresAt = cacheableRequest ? expiry(response.headers, now()) : undefined
    if (expiresAt === undefined) {
      if (cached) await cache.delete(url)
      return response
    }
    const limit = cache.maxEntryBytes ?? DEFAULT_FETCH_CACHE_ENTRY_BYTES
    const reader = response.body?.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    let cacheable = true
    const store = async () => {
      if (!cacheable) return
      const body = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.length
      }
      chunks.length = 0
      await cache
        .set({
          url,
          status: response.status,
          statusText: response.statusText,
          headers: [...response.headers.entries()],
          body,
          vary: varyValues(response.headers, requestHeaders),
          storedAt: now(),
          expiresAt,
        })
        .catch(() => undefined)
    }
    if (!reader) {
      await store()
      return response
    }
    const body = new ReadableStream(
      {
        async pull(controller) {
          try {
            const chunk = await reader.read()
            if (chunk.done) {
              await store()
              reader.releaseLock()
              controller.close()
              return
            }
            size += chunk.value.length
            if (size > limit) {
              cacheable = false
              chunks.length = 0
            }
            if (cacheable) chunks.push(chunk.value.slice())
            controller.enqueue(chunk.value)
          } catch (error) {
            cacheable = false
            chunks.length = 0
            await reader.cancel(error).catch(() => undefined)
            reader.releaseLock()
            controller.error(error)
          }
        },
        async cancel(reason) {
          cacheable = false
          chunks.length = 0
          await reader.cancel(reason)
          reader.releaseLock()
        },
      },
      { highWaterMark: 0 },
    )
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
