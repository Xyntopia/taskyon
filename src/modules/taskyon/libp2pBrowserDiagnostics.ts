import { multiaddr, type BrowserPubsubMessage } from '@taskyon/p2p-core'
import { getRelayDialFallbacks } from '../../../packages/taskyon/src/p2p/constants'
import { ensureRelayReservation, startLibp2p } from '../../../packages/taskyon/src/p2p/libp2p'

const TEST_TOPIC = 'taskyon-diagnostics-libp2p-browser-v1'
const DEFAULT_TIMEOUT_MS = 90_000
const HELLO_INTERVAL_MS = 2_000
const CROSS_TAB_ANNOUNCE_INTERVAL_MS = 2_000

type WireMessage = {
  type: 'hello' | 'ack'
  runId: string
  from: string
  toRunId?: string
  at: number
}

export type Libp2pBrowserTestResult = {
  peerId: string
  runId: string
  topic: string
  helloSent: number
  ackSent: number
  helloReceived: number
  ackReceived: number
  remoteHelloFrom: string[]
  remoteAckFrom: string[]
  visibleToPeers: string[]
  elapsedMs: number
}

export type Libp2pBrowserTestStats = {
  helloSent: number
  ackSent: number
  helloReceived: number
  ackReceived: number
}

export type Libp2pBrowserTestSession = {
  resultPromise: Promise<Libp2pBrowserTestResult>
  stop: () => Promise<void>
}

function parseWireMessage(data: Uint8Array): WireMessage | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as Partial<WireMessage>
    if (!parsed || (parsed.type !== 'hello' && parsed.type !== 'ack')) return null
    if (typeof parsed.from !== 'string' || typeof parsed.runId !== 'string') return null
    if (typeof parsed.at !== 'number') return null
    return {
      type: parsed.type,
      runId: parsed.runId,
      from: parsed.from,
      ...(typeof parsed.toRunId === 'string' ? { toRunId: parsed.toRunId } : {}),
      at: parsed.at,
    }
  } catch {
    return null
  }
}

export async function startLibp2pBrowserMessageExchangeTest(opts?: {
  timeoutMs?: number
  onLog?: (message: string) => void
  onStats?: (stats: Libp2pBrowserTestStats) => void
  relayAddrs?: string[]
  keepRunningAfterSuccess?: boolean
}): Promise<Libp2pBrowserTestSession> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const onLog = opts?.onLog ?? (() => {})
  const onStats = opts?.onStats ?? (() => {})
  const relayAddrs = opts?.relayAddrs ?? getRelayDialFallbacks()
  const keepRunningAfterSuccess = opts?.keepRunningAfterSuccess ?? false
  const startedAt = Date.now()

  const node = await startLibp2p()
  const peerId = node.peerId.toString()
  const runId = `${peerId.slice(0, 12)}-${Date.now().toString(36)}-${Math.random()
    .toString(16)
    .slice(2, 8)}`

  let helloSent = 0
  let ackSent = 0
  let helloReceived = 0
  let ackReceived = 0
  const remoteHelloFrom = new Set<string>()
  const remoteAckFrom = new Set<string>()
  const visibleToPeers = new Set<string>()
  const emitStats = () => onStats({ helloSent, ackSent, helloReceived, ackReceived })

  let done = false
  let successPublished = false
  let cleanedUp = false
  let settle: ((value: Libp2pBrowserTestResult) => void) | null = null
  let fail: ((reason?: unknown) => void) | null = null
  const donePromise = new Promise<Libp2pBrowserTestResult>((resolve, reject) => {
    settle = resolve
    fail = reject
  })
  const dialedPeers = new Set<string>()
  let crossTab: BroadcastChannel | null = null
  let crossTabAnnounceInterval: ReturnType<typeof setInterval> | null = null

  const describeSubscribers = () =>
    node.services.pubsub
      .getSubscribers(TEST_TOPIC)
      .map((subscriber) => subscriber.toString())
      .join(', ')

  const maybeFinish = () => {
    if (done) return
    if (helloSent < 1) return
    if (remoteHelloFrom.size < 1) return
    if (remoteAckFrom.size < 1) return
    successPublished = true
    const result = {
      peerId,
      runId,
      topic: TEST_TOPIC,
      helloSent,
      ackSent,
      helloReceived,
      ackReceived,
      remoteHelloFrom: [...remoteHelloFrom],
      remoteAckFrom: [...remoteAckFrom],
      visibleToPeers: [...visibleToPeers],
      elapsedMs: Date.now() - startedAt,
    }
    settle?.(result)
    onLog(`[test] success: ${JSON.stringify(result)}`)
    if (!keepRunningAfterSuccess) {
      done = true
    }
  }

  const publish = async (message: WireMessage) => {
    const subscribers = describeSubscribers()
    const recipients = await node.services.pubsub.publish(
      TEST_TOPIC,
      new TextEncoder().encode(JSON.stringify(message)),
    )
    onLog(
      `[pubsub] sent ${message.type} to ${
        recipients.recipients.map((p: { toString: () => string }) => p.toString()).join(', ') ||
        '0 peers'
      } (known subscribers: ${subscribers || '0'})`,
    )
  }

  const onMessage = (evt: CustomEvent<BrowserPubsubMessage>) => {
    if (done) return
    if (evt.detail.topic !== TEST_TOPIC) {
      return
    }
    if (evt.detail.type !== 'signed') {
      onLog(`[pubsub] ignored inbound message on ${TEST_TOPIC}: unsigned`)
      return
    }
    if (evt.detail.from == null) {
      onLog(`[pubsub] ignored inbound message on ${TEST_TOPIC}: missing from`)
      return
    }

    const from = evt.detail.from.toString()
    if (from === peerId) {
      onLog(`[pubsub] ignored local echo on ${TEST_TOPIC}`)
      return
    }

    const payload = parseWireMessage(evt.detail.data)
    onLog(
      `[pubsub] inbound topic=${evt.detail.topic} from=${from} bytes=${evt.detail.data.byteLength} parsed=${
        payload
          ? `${payload.type} runId=${payload.runId} toRunId=${payload.toRunId ?? '-'}`
          : 'invalid'
      }`,
    )
    if (!payload) {
      onLog(`[pubsub] ignored inbound message on ${TEST_TOPIC}: invalid payload`)
      return
    }
    if (payload.from !== from) {
      onLog(
        `[pubsub] ignored inbound message on ${TEST_TOPIC}: payload.from=${payload.from} did not match event.from=${from}`,
      )
      return
    }

    if (payload.type === 'hello') {
      remoteHelloFrom.add(from)
      helloReceived += 1
      emitStats()
      onLog(`[pubsub] received hello from ${from}`)
      void publish({
        type: 'ack',
        runId,
        from: peerId,
        toRunId: payload.runId,
        at: Date.now(),
      }).catch((error: unknown) => {
        onLog(
          `[pubsub] failed to publish ack: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      })
      ackSent += 1
      emitStats()
    }

    if (payload.type === 'ack' && payload.toRunId === runId) {
      remoteAckFrom.add(from)
      visibleToPeers.add(from)
      ackReceived += 1
      emitStats()
      onLog(`[pubsub] received ack from ${from}`)
      onLog(
        `[visibility] confirmed by ${from}: it heard that peer ${peerId} run ${runId} is online on ${TEST_TOPIC}`,
      )
    }

    maybeFinish()
  }

  const onSubscriptionChange = () => {
    onLog(`[pubsub] subscribers for ${TEST_TOPIC}: ${describeSubscribers() || '0'}`)
  }

  const interval = setInterval(() => {
    void publish({
      type: 'hello',
      runId,
      from: peerId,
      at: Date.now(),
    }).catch((error: unknown) => {
      onLog(
        `[pubsub] failed to publish hello: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    helloSent += 1
    emitStats()
    maybeFinish()
  }, HELLO_INTERVAL_MS)

  const timeout = setTimeout(() => {
    if (done || successPublished) return
    done = true
    fail?.(
      new Error(
        `Timed out after ${timeoutMs}ms waiting for browser-to-browser handshake. helloSent=${helloSent}, remoteHelloFrom=${[
          ...remoteHelloFrom,
        ].join(',')}, remoteAckFrom=${[...remoteAckFrom].join(',')}`,
      ),
    )
  }, timeoutMs)

  const tryRelayDial = async () => {
    for (const addr of relayAddrs) {
      const alreadyConnected = node
        .getConnections()
        .some((conn) => conn.remoteAddr.toString().startsWith(addr))
      if (alreadyConnected) {
        onLog(`[relay] already connected ${addr}`)
        return
      }
      try {
        onLog(`[relay] dial attempt ${addr}`)
        const conn = await node.dial(multiaddr(addr))
        const reserved = await ensureRelayReservation(node, multiaddr(conn.remoteAddr.toString()))
        onLog(`[relay] reservation ${reserved ? 'ok' : 'failed'} via ${conn.remoteAddr.toString()}`)
        onLog(`[relay] connected ${conn.remotePeer.toString()} via ${conn.remoteAddr.toString()}`)
        return
      } catch (error) {
        onLog(
          `[relay] dial failed ${addr}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    onLog('[relay] no relay dial succeeded - continuing with peer discovery')
  }

  const dialPeerThroughConnectedRelays = async (targetPeerId: string) => {
    if (targetPeerId === peerId || dialedPeers.has(targetPeerId)) return
    dialedPeers.add(targetPeerId)
    for (const conn of node.getConnections()) {
      const relayPeerId = conn.remotePeer.toString()
      const relayAddr = conn.remoteAddr.toString()
      const relayBase = relayAddr.split('/p2p/')[0]
      const circuitAddr = `${relayBase}/p2p/${relayPeerId}/p2p-circuit/p2p/${targetPeerId}`
      try {
        onLog(`[relay-circuit] dial attempt ${targetPeerId} via ${relayPeerId}`)
        const c = await node.dial(multiaddr(circuitAddr))
        onLog(
          `[relay-circuit] connected to ${c.remotePeer.toString()} via ${c.remoteAddr.toString()}`,
        )
        return
      } catch (error) {
        onLog(
          `[relay-circuit] dial failed ${targetPeerId} via ${relayPeerId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }
  }

  const cleanup = async () => {
    if (cleanedUp) return
    cleanedUp = true
    done = true
    clearInterval(interval)
    if (crossTabAnnounceInterval != null) {
      clearInterval(crossTabAnnounceInterval)
    }
    clearTimeout(timeout)
    try {
      crossTab?.close()
    } catch {
      // noop
    }
    node.services.pubsub.removeEventListener('message', onMessage)
    node.services.pubsub.removeEventListener('subscription-change', onSubscriptionChange)
    try {
      node.services.pubsub.unsubscribe(TEST_TOPIC)
    } catch {
      // noop
    }
    try {
      await node.stop()
    } catch {
      // noop
    }
  }

  try {
    await tryRelayDial()
    node.services.pubsub.subscribe(TEST_TOPIC)
    node.services.pubsub.addEventListener('message', onMessage)
    node.services.pubsub.addEventListener('subscription-change', onSubscriptionChange)
    crossTab = new BroadcastChannel('taskyon-libp2p-browser-diagnostics-v1')
    crossTab.onmessage = (event: MessageEvent<unknown>) => {
      const payload = event.data
      if (
        payload &&
        typeof payload === 'object' &&
        'type' in payload &&
        payload.type === 'announce' &&
        'peerId' in payload &&
        typeof payload.peerId === 'string'
      ) {
        onLog(
          `[cross-tab] received announce for peer=${payload.peerId}${
            'runId' in payload && typeof payload.runId === 'string' ? ` runId=${payload.runId}` : ''
          }`,
        )
        void dialPeerThroughConnectedRelays(payload.peerId)
      }
    }
    const announceSelf = () => {
      crossTab?.postMessage({ type: 'announce', peerId, runId })
      onLog(`[cross-tab] announced peer=${peerId} runId=${runId}`)
    }
    announceSelf()
    crossTabAnnounceInterval = setInterval(announceSelf, CROSS_TAB_ANNOUNCE_INTERVAL_MS)
    onLog(`[libp2p] started peer ${peerId}`)
    onLog(`[libp2p] subscribed topic ${TEST_TOPIC}`)
    onLog(`[pubsub] subscribers for ${TEST_TOPIC}: ${describeSubscribers() || '0'}`)
    await publish({
      type: 'hello',
      runId,
      from: peerId,
      at: Date.now(),
    })
    helloSent += 1
    emitStats()
    maybeFinish()

    return {
      resultPromise: donePromise,
      stop: cleanup,
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export async function runLibp2pBrowserMessageExchangeTest(opts?: {
  timeoutMs?: number
  onLog?: (message: string) => void
  onStats?: (stats: Libp2pBrowserTestStats) => void
  relayAddrs?: string[]
}): Promise<Libp2pBrowserTestResult> {
  const session = await startLibp2pBrowserMessageExchangeTest(opts)
  try {
    return await session.resultPromise
  } finally {
    await session.stop()
  }
}
