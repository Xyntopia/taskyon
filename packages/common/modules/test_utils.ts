import { asyncLruCache } from './utils'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testAsyncLruCacheCachesResolvedValues = async () => {
  let calls = 0
  const cached = asyncLruCache(2)((value: string) => {
    calls += 1
    return `${value}:${calls}`
  })

  const first = await cached('alpha')
  const second = await cached('alpha')

  assert(first === 'alpha:1', `Unexpected first value: ${first}`)
  assert(second === first, `Expected cached second value, got ${second}`)
  assert(calls === 1, `Expected one underlying call, got ${calls}`)
  return { calls, first, second }
}

export const testAsyncLruCacheDeduplicatesInFlightCalls = async () => {
  let calls = 0
  const cached = asyncLruCache(2)(async (value: string) => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 1))
    return `${value}:${calls}`
  })

  const [first, second] = await Promise.all([cached('alpha'), cached('alpha')])

  assert(first === second, `Expected shared in-flight result, got ${first} and ${second}`)
  assert(calls === 1, `Expected one underlying call, got ${calls}`)
  return { calls, first, second }
}

export const testAsyncLruCacheInvalidatesEntries = async () => {
  let calls = 0
  const cached = asyncLruCache(2)((value: string) => {
    calls += 1
    return `${value}:${calls}`
  })

  const first = await cached('alpha')
  cached.invalidate('alpha')
  const second = await cached('alpha')

  assert(first === 'alpha:1', `Unexpected first value: ${first}`)
  assert(second === 'alpha:2', `Expected recomputed value after invalidation, got ${second}`)
  assert(calls === 2, `Expected two underlying calls, got ${calls}`)
  return { calls, first, second }
}

export const testAsyncLruCacheClearCacheRemovesEntries = async () => {
  let calls = 0
  const cached = asyncLruCache(2)((value: string) => {
    calls += 1
    return `${value}:${calls}`
  })

  const first = await cached('alpha')
  cached.clearCache()
  const second = await cached('alpha')

  assert(first === 'alpha:1', `Unexpected first value: ${first}`)
  assert(second === 'alpha:2', `Expected recomputed value after clearCache, got ${second}`)
  assert(calls === 2, `Expected two underlying calls, got ${calls}`)
  return { calls, first, second }
}

testAsyncLruCacheCachesResolvedValues.description = 'Caches resolved async values by argument key.'
testAsyncLruCacheDeduplicatesInFlightCalls.description =
  'Shares one in-flight promise for concurrent identical calls.'
testAsyncLruCacheInvalidatesEntries.description =
  'Recomputes an entry after invalidate() removes its key.'
testAsyncLruCacheClearCacheRemovesEntries.description =
  'Recomputes cached entries after clearCache().'
