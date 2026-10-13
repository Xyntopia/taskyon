import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCachedSecureFetch, type SecureFetchCacheEntry } from './cache.ts'

void test('cache serves fresh responses without another tunnel fetch', async () => {
  const entries = new Map<string, SecureFetchCacheEntry>()
  let calls = 0
  const fetch = createCachedSecureFetch(
    () => {
      calls += 1
      return Promise.resolve(new Response('cached', { headers: { 'cache-control': 'max-age=60' } }))
    },
    {
      get: (url) => Promise.resolve(entries.get(url) ?? null),
      set: (entry) => {
        entries.set(entry.url, entry)
        return Promise.resolve()
      },
      delete: (url) => {
        entries.delete(url)
        return Promise.resolve()
      },
    },
    () => 1_000,
  )
  assert.equal(await (await fetch('https://example.com/data')).text(), 'cached')
  assert.equal(await (await fetch('https://example.com/data')).text(), 'cached')
  assert.equal(calls, 1)
})

void test('cache never stores no-store or explicitly authorized requests', async () => {
  let writes = 0
  const cache = {
    get: () => Promise.resolve(null),
    set: () => {
      writes += 1
      return Promise.resolve()
    },
    delete: () => Promise.resolve(),
  }
  const noStore = createCachedSecureFetch((url) => {
    const href = url instanceof Request ? url.url : url.toString()
    return Promise.resolve(
      new Response('private', {
        headers: { 'cache-control': href.includes('/auth') ? 'max-age=60' : 'no-store' },
      }),
    )
  }, cache)
  await noStore('https://example.com/private')
  await noStore('https://example.com/auth', { headers: { authorization: 'Bearer explicit' } })
  assert.equal(writes, 0)
})

void test('cache varies responses by the headers named by the server', async () => {
  const entries = new Map<string, SecureFetchCacheEntry>()
  let calls = 0
  const fetch = createCachedSecureFetch(
    (_url, init) => {
      calls += 1
      const language = new Headers(init?.headers).get('accept-language') ?? 'default'
      return Promise.resolve(
        new Response(language, {
          headers: { 'cache-control': 'max-age=60', vary: 'Accept-Language' },
        }),
      )
    },
    {
      get: (url) => Promise.resolve(entries.get(url) ?? null),
      set: (entry) => {
        entries.set(entry.url, entry)
        return Promise.resolve()
      },
      delete: (url) => {
        entries.delete(url)
        return Promise.resolve()
      },
    },
    () => 1_000,
  )

  assert.equal(
    await (
      await fetch('https://example.com/data', {
        headers: { 'accept-language': 'de' },
      })
    ).text(),
    'de',
  )
  assert.equal(
    await (
      await fetch('https://example.com/data', {
        headers: { 'accept-language': 'en' },
      })
    ).text(),
    'en',
  )
  assert.equal(calls, 2)
})

void test('cache forwards transport options on a cache miss', async () => {
  let receivedMode: string | undefined
  const fetch = createCachedSecureFetch(
    (_url, _init, options?: { mode: string }) => {
      receivedMode = options?.mode
      return Promise.resolve(new Response('proxied', { headers: { 'cache-control': 'no-store' } }))
    },
    {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    },
  )

  await fetch('https://example.com/data', {}, { mode: 'http-proxy' })
  assert.equal(receivedMode, 'http-proxy')
})

void test('cache returns headers without pulling and skips oversized streams', async () => {
  let reads = 0
  let writes = 0
  const fetch = createCachedSecureFetch(
    () =>
      Promise.resolve().then(
        () =>
          new Response(
            new ReadableStream(
              {
                pull(controller) {
                  if (reads++ < 3) controller.enqueue(new Uint8Array(8))
                  else controller.close()
                },
              },
              { highWaterMark: 0 },
            ),
            { headers: { 'cache-control': 'max-age=60' } },
          ),
      ),
    {
      maxEntryBytes: 16,
      get: () => Promise.resolve().then(() => null),
      set: () =>
        Promise.resolve().then(() => {
          writes++
        }),
      delete: async () => {},
    },
  )
  const response = await fetch('https://example.test/large')
  assert.equal(reads, 0)
  assert.equal((await response.arrayBuffer()).byteLength, 24)
  assert.equal(writes, 0)
})

void test('cache does not store cancelled partial streams', async () => {
  let writes = 0
  let cancelled = false
  const fetch = createCachedSecureFetch(
    () =>
      Promise.resolve().then(
        () =>
          new Response(
            new ReadableStream(
              {
                pull(controller) {
                  controller.enqueue(new Uint8Array([1]))
                },
                cancel() {
                  cancelled = true
                },
              },
              { highWaterMark: 0 },
            ),
            { headers: { 'cache-control': 'max-age=60' } },
          ),
      ),
    {
      get: () => Promise.resolve().then(() => null),
      set: () =>
        Promise.resolve().then(() => {
          writes++
        }),
      delete: async () => {},
    },
  )
  const response = await fetch('https://example.test/cancel')
  const reader = response.body!.getReader()
  await reader.read()
  await reader.cancel()
  assert.equal(writes, 0)
  assert.equal(cancelled, true)
})
