import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createCachedSecureFetch, type SecureFetchCacheEntry } from './cache.ts'

void test('cache serves fresh responses without another tunnel fetch', async () => {
  const entries = new Map<string, SecureFetchCacheEntry>()
  let calls = 0
  const fetch = createCachedSecureFetch(
    async () => {
      calls += 1
      return new Response('cached', { headers: { 'cache-control': 'max-age=60' } })
    },
    {
      get: async (url) => entries.get(url) ?? null,
      set: async (entry) => {
        entries.set(entry.url, entry)
      },
      delete: async (url) => {
        entries.delete(url)
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
    get: async () => null,
    set: async () => {
      writes += 1
    },
    delete: async () => undefined,
  }
  const noStore = createCachedSecureFetch(
    async (url) =>
      new Response('private', {
        headers: { 'cache-control': String(url).includes('/auth') ? 'max-age=60' : 'no-store' },
      }),
    cache,
  )
  await noStore('https://example.com/private')
  await noStore('https://example.com/auth', { headers: { authorization: 'Bearer explicit' } })
  assert.equal(writes, 0)
})

void test('cache varies responses by the headers named by the server', async () => {
  const entries = new Map<string, SecureFetchCacheEntry>()
  let calls = 0
  const fetch = createCachedSecureFetch(
    async (_url, init) => {
      calls += 1
      const language = new Headers(init?.headers).get('accept-language') ?? 'default'
      return new Response(language, {
        headers: { 'cache-control': 'max-age=60', vary: 'Accept-Language' },
      })
    },
    {
      get: async (url) => entries.get(url) ?? null,
      set: async (entry) => {
        entries.set(entry.url, entry)
      },
      delete: async (url) => {
        entries.delete(url)
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
    async (_url, _init, options?: { mode: string }) => {
      receivedMode = options?.mode
      return new Response('proxied', { headers: { 'cache-control': 'no-store' } })
    },
    {
      get: async () => null,
      set: async () => undefined,
      delete: async () => undefined,
    },
  )

  await fetch('https://example.com/data', {}, { mode: 'http-proxy' })
  assert.equal(receivedMode, 'http-proxy')
})
