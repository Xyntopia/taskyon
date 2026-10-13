import { createMediatedFetch } from './webFetching/mediatedFetch'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testMediatedFetchReturnsHeadersWithoutConsumingBody = async () => {
  let reads = 0
  const fetch = createMediatedFetch({
    authorize: () => Promise.resolve(true),
    fetch: () =>
      Promise.resolve(
        new Response(
          new ReadableStream(
            {
              pull(controller) {
                reads++
                controller.enqueue(new Uint8Array([1]))
              },
            },
            { highWaterMark: 0 },
          ),
        ),
      ),
  })
  const response = await fetch('https://example.test/stream')
  assert(reads === 0, 'Fetch consumed the body before returning headers')
  await response.body?.cancel()
}

export const testMediatedFetchAllowsLargeStreamingResponses = async () => {
  let remaining = 17
  const fetch = createMediatedFetch({
    authorize: () => Promise.resolve(true),
    fetch: () =>
      Promise.resolve(
        new Response(
          new ReadableStream(
            {
              pull(controller) {
                if (remaining-- > 0) controller.enqueue(new Uint8Array(1024 * 1024))
                else controller.close()
              },
            },
            { highWaterMark: 0 },
          ),
        ),
      ),
  })
  const response = await fetch('https://example.test/large')
  const reader = response.body!.getReader()
  let size = 0
  for (;;) {
    const next = await reader.read()
    if (next.done) break
    size += next.value.length
  }
  assert(size === 17 * 1024 * 1024, 'Default mediator truncated a large stream')
}

export const testMediatedFetchIdleTimeoutPausesForConsumer = async () => {
  const fetch = createMediatedFetch({
    authorize: () => Promise.resolve(true),
    idleTimeoutMs: 15,
    fetch: () => Promise.resolve(new Response('synthetic')),
  })
  const response = await fetch('https://example.test/progress')
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert((await response.text()) === 'synthetic', 'Consumer backpressure triggered network timeout')
}

export const testMediatedFetchIdleTimeoutAbortsStalledBody = async () => {
  let cancelled = false
  const fetch = createMediatedFetch({
    authorize: () => Promise.resolve(true),
    idleTimeoutMs: 15,
    fetch: () =>
      Promise.resolve(
        new Response(
          new ReadableStream(
            {
              pull: () => new Promise<void>(() => {}),
              cancel: () => {
                cancelled = true
              },
            },
            { highWaterMark: 0 },
          ),
        ),
      ),
  })
  const response = await fetch('https://example.test/stall')
  let rejected = false
  try {
    await response.text()
  } catch {
    rejected = true
  }
  assert(rejected && cancelled, 'Stalled body did not time out and cancel')
}

export const testMediatedFetchEmptyChunksDoNotResetTimeout = async () => {
  let cancelled = false
  const fetch = createMediatedFetch({
    authorize: () => Promise.resolve().then(() => true),
    idleTimeoutMs: 20,
    fetch: () =>
      Promise.resolve().then(
        () =>
          new Response(
            new ReadableStream(
              {
                async pull(controller) {
                  await new Promise((resolve) => setTimeout(resolve, 8))
                  if (!cancelled) controller.enqueue(new Uint8Array())
                },
                cancel() {
                  cancelled = true
                },
              },
              { highWaterMark: 0 },
            ),
          ),
      ),
  })
  const response = await fetch('https://example.test/empty')
  let rejected = false
  try {
    await response.text()
  } catch {
    rejected = true
  }
  assert(rejected && cancelled, 'Empty chunks kept a stalled response alive')
}

export const testMediatedFetchPreservesRequestBody = async () => {
  let received = ''
  const fetch = createMediatedFetch({
    authorize: () => Promise.resolve().then(() => true),
    fetch: async (input, init) => {
      const request = new Request(input, init)
      received = await request.text()
      return new Response('ok')
    },
  })
  const response = await fetch(
    new Request('https://example.test/post', { method: 'POST', body: 'synthetic' }),
  )
  await response.body?.cancel()
  assert(received === 'synthetic', 'Mediation discarded Request body')
}

export const testMediatedFetchProgressOutlivesIdleTimeout = async () => {
  let now = 0
  const timers = new Set<{ at: number; callback: () => void }>()
  const advance = (ms: number) => {
    now += ms
    for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.callback() }
  }
  let chunks = 0
  const fetch = createMediatedFetch({
    authorize: () => Promise.resolve(true), idleTimeoutMs: 40,
    scheduleTimeout: (callback,delay) => {
      const timer = { at: now+delay,callback }
      timers.add(timer)
      return () => { timers.delete(timer) }
    },
    fetch: () => Promise.resolve(new Response(new ReadableStream({
      pull(controller) {
        advance(10)
        if (chunks++ < 8) controller.enqueue(new Uint8Array([1]))
        else controller.close()
      },
    },{ highWaterMark: 0 }))),
  })
  const response = await fetch('https://example.test/progress')
  assert((await response.arrayBuffer()).byteLength === 8 && now > 40,'Progressing response hit an absolute deadline')
  assert(timers.size === 0,'Completed stream retained timeout callbacks')
}

export const testMediatedFetchRetainsExplicitSizeLimits = async () => {
  const fetch = createMediatedFetch({
    authorize: () => Promise.resolve(true),
    maxResponseBytes: 2,
    fetch: () => Promise.resolve(new Response(new Uint8Array([1, 2, 3]))),
  })
  let rejected = false
  try {
    await (await fetch('https://example.test/bounded')).arrayBuffer()
  } catch {
    rejected = true
  }
  assert(rejected, 'Explicit response-size limit was ignored')
}

export const testMediatedFetchHonorsConsumerCancellation = async () => {
  const controller = new AbortController()
  controller.abort(new Error('synthetic cancelled request'))
  const fetch = createMediatedFetch({
    authorize: () => Promise.resolve(true),
    fetch: () => {
      throw new Error('Must not reach network')
    },
  })
  let message = ''
  try {
    await fetch('https://example.test/cancelled', { signal: controller.signal })
  } catch (error) {
    message = error instanceof Error ? error.message : String(error)
  }
  assert(message === 'synthetic cancelled request', 'Pre-aborted request reached the network')
}
