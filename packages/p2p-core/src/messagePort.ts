import { createDuplexChannel, type Port, type Unsubscribe } from '@taskyon/protocol'
import { lpStream } from 'it-length-prefixed-stream'

import { streamToDuplex, type Libp2pStreamLike } from './stream'

export type Libp2pMessageCodec<TSend, TReceive> = {
  encode(value: TSend): Uint8Array
  decode(bytes: Uint8Array): TReceive
}

export type Libp2pMessagePortCloseResult =
  | { reason: 'local' | 'remote' }
  | { reason: 'error'; error: Error }

export type Libp2pMessagePort<TSend, TReceive> = {
  port: Port<TSend, TReceive>
  closed: Promise<Libp2pMessagePortCloseResult>
  close(): Promise<void>
}

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error('The peer stream failed.')

const isRemoteClose = (value: unknown): boolean => {
  if (
    value instanceof Error &&
    'code' in value &&
    value.code === 'ERR_UNEXPECTED_EOF'
  ) {
    return true
  }
  const message = toError(value).message.toLowerCase()
  return (
    message.includes('eof') ||
    message.includes('end of input') ||
    message.includes('closed') ||
    message.includes('aborted')
  )
}

export function createLibp2pMessagePort<TSend, TReceive>(
  stream: Libp2pStreamLike,
  codec: Libp2pMessageCodec<TSend, TReceive>,
  limits: { maxMessageBytes: number; maxPendingMessages: number },
): Libp2pMessagePort<TSend, TReceive> {
  if (!Number.isSafeInteger(limits.maxMessageBytes) || limits.maxMessageBytes < 1) {
    throw new RangeError('maxMessageBytes must be a positive safe integer.')
  }
  if (!Number.isSafeInteger(limits.maxPendingMessages) || limits.maxPendingMessages < 1) {
    throw new RangeError('maxPendingMessages must be a positive safe integer.')
  }

  const framed = lpStream(streamToDuplex(stream), { maxDataLength: limits.maxMessageBytes })
  const { x: port, y: transportPort } = createDuplexChannel<TSend, TReceive>()
  const pending: Uint8Array[] = []
  let writing = false
  let finished = false
  let unsubscribeOutgoing: Unsubscribe = () => undefined
  let resolveClosed: (result: Libp2pMessagePortCloseResult) => void = () => undefined
  const closed = new Promise<Libp2pMessagePortCloseResult>((resolve) => {
    resolveClosed = resolve
  })

  const finish = (result: Libp2pMessagePortCloseResult) => {
    if (finished) return
    finished = true
    pending.length = 0
    unsubscribeOutgoing()
    resolveClosed(result)
  }

  const closeStream = async () => {
    try {
      await stream.close()
    } catch {
      // A concurrent remote close is already represented by `closed`.
    }
  }

  const fail = (error: unknown) => {
    finish({ reason: 'error', error: toError(error) })
    void closeStream()
  }

  const writePending = async () => {
    if (writing || finished) return
    writing = true
    try {
      while (!finished && pending.length > 0) {
        const next = pending.shift()
        if (next) await framed.write(next)
      }
    } catch (error) {
      if (!finished) fail(error)
    } finally {
      writing = false
    }
  }

  unsubscribeOutgoing = transportPort.receive((message) => {
    if (finished) return
    try {
      const bytes = codec.encode(message)
      if (bytes.byteLength > limits.maxMessageBytes) {
        fail(new RangeError('Encoded peer message exceeds maxMessageBytes.'))
        return
      }
      if (pending.length + (writing ? 1 : 0) >= limits.maxPendingMessages) {
        fail(new Error('Peer message queue exceeded maxPendingMessages.'))
        return
      }
      pending.push(bytes)
      void writePending()
    } catch (error) {
      fail(error)
    }
  })

  void (async () => {
    try {
      while (!finished) {
        const frame = await framed.read()
        transportPort.send(codec.decode(frame.subarray()))
      }
    } catch (error) {
      if (!finished) {
        if (isRemoteClose(error)) finish({ reason: 'remote' })
        else fail(error)
      }
    }
  })()

  return {
    port,
    closed,
    close: async () => {
      if (finished) return
      finish({ reason: 'local' })
      await closeStream()
    },
  }
}
