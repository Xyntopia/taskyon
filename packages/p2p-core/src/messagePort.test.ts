import assert from 'node:assert/strict'
import test from 'node:test'

import type { Libp2pStreamLike } from './stream.ts'
import { createLibp2pMessagePort } from './messagePort.ts'

const textCodec = {
  encode: (value: string) => new TextEncoder().encode(value),
  decode: (bytes: Uint8Array) => new TextDecoder().decode(bytes),
}

function createByteQueue() {
  const values: Uint8Array[] = []
  const readers: Array<(result: IteratorResult<Uint8Array>) => void> = []
  let closed = false

  const push = (value: Uint8Array) => {
    const reader = readers.shift()
    if (reader) reader({ done: false, value })
    else values.push(value)
  }
  const close = () => {
    closed = true
    readers.splice(0).forEach((reader) => reader({ done: true, value: undefined }))
  }
  const source: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]: () => ({
      next: () => {
        const value = values.shift()
        if (value) return Promise.resolve({ done: false as const, value })
        if (closed) return Promise.resolve({ done: true as const, value: undefined })
        return new Promise((resolve) => readers.push(resolve))
      },
    }),
  }
  return { push, close, source }
}

function createStreamPair(): [Libp2pStreamLike, Libp2pStreamLike] {
  const incomingA = createByteQueue()
  const incomingB = createByteQueue()
  const endpoint = (
    incoming: ReturnType<typeof createByteQueue>,
    outgoing: ReturnType<typeof createByteQueue>,
  ): Libp2pStreamLike => ({
    [Symbol.asyncIterator]: () => incoming.source[Symbol.asyncIterator](),
    send: (bytes) => {
      outgoing.push(bytes.subarray())
      return true
    },
    onDrain: async () => undefined,
    close: async () => outgoing.close(),
  })
  return [endpoint(incomingA, incomingB), endpoint(incomingB, incomingA)]
}

test('carries typed messages in both directions and reports local closure', async () => {
  const [streamA, streamB] = createStreamPair()
  const a = createLibp2pMessagePort(streamA, textCodec, {
    maxMessageBytes: 64,
    maxPendingMessages: 4,
  })
  const b = createLibp2pMessagePort(streamB, textCodec, {
    maxMessageBytes: 64,
    maxPendingMessages: 4,
  })

  const fromA = b.port.receive.wait({ timeoutMs: 1_000 })
  const fromB = a.port.receive.wait({ timeoutMs: 1_000 })
  a.port.send('alpha')
  b.port.send('beta')

  assert.equal(await fromA, 'alpha')
  assert.equal(await fromB, 'beta')
  await a.close()
  assert.deepEqual(await a.closed, { reason: 'local' })
  assert.deepEqual(await b.closed, { reason: 'remote' })
})

test('fails closed when a received frame exceeds its configured limit', async () => {
  const [streamA, streamB] = createStreamPair()
  const a = createLibp2pMessagePort(streamA, textCodec, {
    maxMessageBytes: 64,
    maxPendingMessages: 4,
  })
  const b = createLibp2pMessagePort(streamB, textCodec, {
    maxMessageBytes: 4,
    maxPendingMessages: 4,
  })

  a.port.send('too-large')

  assert.equal((await b.closed).reason, 'error')
  await a.close()
})

test('closes instead of growing an unbounded outgoing queue', async () => {
  const [streamA] = createStreamPair()
  let releaseWrite: (() => void) | undefined
  const blocked: Libp2pStreamLike = {
    ...streamA,
    send: () => false,
    onDrain: () => new Promise<void>((resolve) => (releaseWrite = resolve)),
  }
  const port = createLibp2pMessagePort(blocked, textCodec, {
    maxMessageBytes: 64,
    maxPendingMessages: 1,
  })

  port.port.send('one')
  port.port.send('two')

  assert.equal((await port.closed).reason, 'error')
  releaseWrite?.()
})
