import type {
  Connection,
  PeerId,
  Startable,
  Stream,
} from '@libp2p/interface'
import type { ConnectionManager, Registrar } from '@libp2p/interface-internal'
import {
  TypedEventEmitter,
  serviceCapabilities,
  serviceDependencies,
} from '@libp2p/interface'
import { prefixLogger } from '@libp2p/logger'
import { lpStream } from 'it-length-prefixed-stream'
import { streamToDuplex } from './stream'

export type TopicRouterMessageEvent = {
  topic: string
  data: Uint8Array
  from: PeerId | string
  type: 'signed'
  sequenceNumber?: bigint
}

export type TopicRouterSubscriptionChangeEvent = {
  topic: string
  peerId?: PeerId
  subscribers: PeerId[]
}

export type TopicRouterEvents = {
  message: CustomEvent<TopicRouterMessageEvent>
  'subscription-change': CustomEvent<TopicRouterSubscriptionChangeEvent>
}

export type TopicRouterService = TypedEventEmitter<TopicRouterEvents> & {
  subscribe: (topic: string) => void
  unsubscribe: (topic: string) => void
  publish: (topic: string, data: Uint8Array) => Promise<{ recipients: PeerId[] }>
  getSubscribers: (topic: string) => PeerId[]
}

type TopicRouterComponents = {
  peerId: PeerId
  registrar: Registrar
  connectionManager: ConnectionManager
}

type TopicRouterInit = {
  protocol?: string
  discoveryTopic?: string
  seenTtlMs?: number
  maxHops?: number
}

type RouterEnvelope =
  | {
      version: 1
      type: 'subscribe'
      topic: string
      from: string
    }
  | {
      version: 1
      type: 'unsubscribe'
      topic: string
      from: string
    }
  | {
      version: 1
      type: 'broadcast'
      msgId: string
      topic: string
      from: string
      hopsRemaining: number
      data: string
    }

const DEFAULT_PROTOCOL = '/taskyon/topic-router/1.0.0'
const DEFAULT_SEEN_TTL_MS = 120_000
const DEFAULT_MAX_HOPS = 6
const log = prefixLogger('p2p-core').forComponent('topic-router')

function isIgnorableStreamCloseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  return (
    normalized.includes('unexpected eof') ||
    normalized.includes('stream closed while reading') ||
    normalized.includes('stream reset') ||
    normalized.includes('aborted')
  )
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }

  let value = ''
  for (const byte of bytes) value += String.fromCharCode(byte)
  return btoa(value)
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'))
  }

  const decoded = atob(value)
  const bytes = new Uint8Array(decoded.length)
  for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i)
  return bytes
}

function encodeEnvelope(envelope: RouterEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope))
}

function decodeEnvelope(bytes: Uint8Array): RouterEnvelope {
  return JSON.parse(new TextDecoder().decode(bytes)) as RouterEnvelope
}

function createBroadcastEnvelope(
  peerId: PeerId,
  topic: string,
  data: Uint8Array,
  msgId: string,
  hopsRemaining: number,
): Extract<RouterEnvelope, { type: 'broadcast' }> {
  return {
    version: 1,
    type: 'broadcast',
    msgId,
    topic,
    from: peerId.toString(),
    hopsRemaining,
    data: bytesToBase64(data),
  }
}

function decrementHops(
  envelope: Extract<RouterEnvelope, { type: 'broadcast' }>,
): Extract<RouterEnvelope, { type: 'broadcast' }> {
  return {
    ...envelope,
    hopsRemaining: envelope.hopsRemaining - 1,
  }
}

export class TopicRouter extends TypedEventEmitter<TopicRouterEvents> implements Startable {
  readonly [serviceDependencies]: string[] = [
    '@libp2p/identify',
    '@libp2p/connection-encryption',
    '@libp2p/transport',
    '@libp2p/stream-multiplexing',
  ]

  readonly [serviceCapabilities]: string[] = ['@taskyon/topic-router']

  private readonly components: TopicRouterComponents
  private readonly protocol: string
  private readonly discoveryTopic?: string
  private readonly seenTtlMs: number
  private readonly maxHops: number
  private topologyId?: string
  private readonly localSubscriptions = new Set<string>()
  private readonly peerSubscriptions = new Map<string, Set<string>>()
  private readonly connectedPeers = new Map<string, PeerId>()
  private readonly seenMessages = new Map<string, number>()
  private pruneInterval?: ReturnType<typeof setInterval>
  private stopped = false

  constructor(components: TopicRouterComponents, init: TopicRouterInit = {}) {
    super()
    this.components = components
    this.protocol = init.protocol ?? DEFAULT_PROTOCOL
    this.seenTtlMs = init.seenTtlMs ?? DEFAULT_SEEN_TTL_MS
    this.maxHops = init.maxHops ?? DEFAULT_MAX_HOPS
    if (init.discoveryTopic != null) {
      this.discoveryTopic = init.discoveryTopic
    }
  }

  async start(): Promise<void> {
    this.stopped = false
    this.topologyId = await this.components.registrar.register(this.protocol, {
      onConnect: (peerId) => {
        this.connectedPeers.set(peerId.toString(), peerId)
        void this.syncPeer(peerId)
      },
      onDisconnect: (peerId) => {
        // Topic-router uses short-lived streams, so protocol-level disconnects
        // do not necessarily mean the underlying libp2p connection is gone.
        // We keep subscription state and derive actual reachability from the
        // connection manager when forwarding messages.
        log('protocol disconnect peer=%s retained for reachability re-check', peerId.toString())
      },
    })

    await this.components.registrar.handle(this.protocol, async (stream, connection) => {
      await this.handleIncomingStream(stream, connection)
    })

    if (this.discoveryTopic != null) {
      this.localSubscriptions.add(this.discoveryTopic)
    }

    this.pruneInterval = setInterval(() => {
      this.pruneSeenMessages()
    }, Math.max(5_000, Math.floor(this.seenTtlMs / 2)))
  }

  stop(): void {
    this.stopped = true
    if (this.topologyId != null) {
      this.components.registrar.unregister(this.topologyId)
    }
    if (this.pruneInterval != null) {
      clearInterval(this.pruneInterval)
    }
  }

  subscribe(topic: string): void {
    if (this.stopped) return
    if (this.localSubscriptions.has(topic)) return
    this.localSubscriptions.add(topic)
    log('local subscribe topic=%s connectedPeers=%o', topic, [...this.connectedPeers.keys()])
    this.emitSubscriptionChange(topic)
    void this.broadcastControlMessage({
      version: 1,
      type: 'subscribe',
      topic,
      from: this.components.peerId.toString(),
    })
  }

  unsubscribe(topic: string): void {
    if (this.stopped) return
    if (topic === this.discoveryTopic) return
    if (!this.localSubscriptions.delete(topic)) return
    log('local unsubscribe topic=%s connectedPeers=%o', topic, [...this.connectedPeers.keys()])
    this.emitSubscriptionChange(topic)
    void this.broadcastControlMessage({
      version: 1,
      type: 'unsubscribe',
      topic,
      from: this.components.peerId.toString(),
    })
  }

  getSubscribers(topic: string): PeerId[] {
    const peers: PeerId[] = []
    for (const [peerId, subscriptions] of this.peerSubscriptions.entries()) {
      if (!subscriptions.has(topic)) continue
      const peer = this.getReachablePeer(peerId)
      if (peer != null) peers.push(peer)
    }
    return peers
  }

  async publish(topic: string, data: Uint8Array): Promise<{ recipients: PeerId[] }> {
    if (this.stopped) {
      return { recipients: [] }
    }
    const msgId = this.createMessageId(topic, data)
    this.seenMessages.set(msgId, Date.now())

    if (this.localSubscriptions.has(topic)) {
      this.dispatchEvent(
        new CustomEvent('message', {
          detail: {
            topic,
            data,
            from: this.components.peerId,
            type: 'signed',
          },
        }),
      )
    }

    log(
      'publish topic=%s bytes=%d local=%s recipients=%o',
      topic,
      data.byteLength,
      this.localSubscriptions.has(topic),
      this.getPropagationTargets().map((peer) => peer.toString()),
    )

    const recipients = await this.forwardEnvelope(
      createBroadcastEnvelope(this.components.peerId, topic, data, msgId, this.maxHops),
      this.getPropagationTargets(),
    )

    return { recipients }
  }

  private async syncPeer(peerId: PeerId): Promise<void> {
    const peerKey = peerId.toString()
    if (!this.peerSubscriptions.has(peerKey)) {
      this.peerSubscriptions.set(peerKey, new Set())
    }

    for (const topic of this.localSubscriptions) {
      await this.sendEnvelope(peerId, {
        version: 1,
        type: 'subscribe',
        topic,
        from: this.components.peerId.toString(),
      })
    }
  }

  private async handleIncomingStream(stream: Stream, connection: Connection): Promise<void> {
    const io = lpStream(streamToDuplex(stream))

    try {
      const message = await io.read({ signal: AbortSignal.timeout(10_000) })
      const envelope = decodeEnvelope(message.subarray())
      await this.handleEnvelope(envelope, connection.remotePeer)
    } finally {
      try {
        await stream.close({ signal: AbortSignal.timeout(2_000) })
      } catch {
        // ignore close races on one-shot streams
      }
    }
  }

  private async handleEnvelope(envelope: RouterEnvelope, sourcePeer: PeerId): Promise<void> {
    const sourceKey = sourcePeer.toString()
    this.connectedPeers.set(sourceKey, sourcePeer)

    switch (envelope.type) {
      case 'subscribe': {
        this.updatePeerSubscription(sourceKey, envelope.topic, true)
        log('remote subscribe peer=%s topic=%s', sourceKey, envelope.topic)
        this.emitSubscriptionChange(envelope.topic, sourcePeer)
        break
      }
      case 'unsubscribe': {
        if (!this.updatePeerSubscription(sourceKey, envelope.topic, false)) return
        log('remote unsubscribe peer=%s topic=%s', sourceKey, envelope.topic)
        this.emitSubscriptionChange(envelope.topic, sourcePeer)
        break
      }
      case 'broadcast': {
        if (this.seenMessages.has(envelope.msgId)) return
        this.seenMessages.set(envelope.msgId, Date.now())
        log(
          'broadcast received topic=%s from=%s sourcePeer=%s hopsRemaining=%d local=%s forwardTargets=%o',
          envelope.topic,
          envelope.from,
          sourceKey,
          envelope.hopsRemaining,
          this.localSubscriptions.has(envelope.topic),
          this.getPropagationTargets(sourceKey).map((peer) => peer.toString()),
        )

        const data = base64ToBytes(envelope.data)
        if (this.localSubscriptions.has(envelope.topic)) {
          this.dispatchEvent(
            new CustomEvent('message', {
              detail: {
                topic: envelope.topic,
                data,
                // Preserve the original sender across relay hops so higher-level
                // protocols can attribute and validate messages correctly.
                from: envelope.from,
                type: 'signed',
              },
            }),
          )
        }

        if (envelope.hopsRemaining <= 0) return
        await this.forwardEnvelope(decrementHops(envelope), this.getPropagationTargets(sourceKey))
        break
      }
      default: {
        break
      }
    }
  }

  private emitSubscriptionChange(topic?: string, peerId?: PeerId) {
    const targetTopic = topic ?? this.discoveryTopic ?? ''
    this.dispatchEvent(
      new CustomEvent('subscription-change', {
        detail: {
          topic: targetTopic,
          peerId,
          subscribers: this.getSubscribers(targetTopic),
        },
      }),
    )
  }

  private async broadcastControlMessage(envelope: Extract<RouterEnvelope, { type: 'subscribe' | 'unsubscribe' }>) {
    if (this.stopped) return
    await this.forwardEnvelope(envelope, this.getPropagationTargets())
  }

  private async forwardEnvelope(envelope: RouterEnvelope, peers: PeerId[]): Promise<PeerId[]> {
    if (this.stopped) return []
    const delivered: PeerId[] = []
    for (const peerId of peers) {
      const sent = await this.sendEnvelope(peerId, envelope)
      if (sent) delivered.push(peerId)
    }
    return delivered
  }

  private pruneSeenMessages() {
    const cutoff = Date.now() - this.seenTtlMs
    for (const [msgId, seenAt] of this.seenMessages.entries()) {
      if (seenAt < cutoff) this.seenMessages.delete(msgId)
    }
  }

  private updatePeerSubscription(peerId: string, topic: string, isSubscribed: boolean): boolean {
    const existing = this.peerSubscriptions.get(peerId)
    if (!isSubscribed && existing == null) {
      return false
    }

    const subscriptions = existing ?? new Set<string>()
    if (isSubscribed) {
      subscriptions.add(topic)
      this.peerSubscriptions.set(peerId, subscriptions)
      return true
    }

    subscriptions.delete(topic)
    if (subscriptions.size === 0) {
      this.peerSubscriptions.delete(peerId)
    } else {
      this.peerSubscriptions.set(peerId, subscriptions)
    }
    return true
  }

  private async sendEnvelope(peerId: PeerId, envelope: RouterEnvelope): Promise<boolean> {
    if (this.stopped) return false
    try {
      const connection = await this.components.connectionManager.openConnection(peerId, {
        signal: AbortSignal.timeout(5_000),
      })
      if (connection == null) {
        return false
      }

      const stream = await connection.newStream(this.protocol, {
        negotiateFully: false,
        signal: AbortSignal.timeout(5_000),
      })
      const io = lpStream(streamToDuplex(stream))
      await io.write(encodeEnvelope(envelope), { signal: AbortSignal.timeout(5_000) })
      await stream.close({ signal: AbortSignal.timeout(2_000) })
      log('send envelope ok type=%s peer=%s', envelope.type, peerId.toString())
      return true
    } catch (error) {
      if (this.stopped || isIgnorableStreamCloseError(error)) {
        log('send envelope ignored during shutdown type=%s peer=%s', envelope.type, peerId.toString())
        return false
      }
      log(
        'send envelope failed type=%s peer=%s error=%s',
        envelope.type,
        peerId.toString(),
        error instanceof Error ? error.message : String(error),
      )
      return false
    }
  }

  private createMessageId(topic: string, data: Uint8Array): string {
    const random =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    return `${this.components.peerId.toString()}:${topic}:${Date.now()}:${data.byteLength}:${random}`
  }

  private getReachablePeer(peerId: string): PeerId | undefined {
    const knownPeer = this.connectedPeers.get(peerId)
    if (knownPeer != null && this.components.connectionManager.getConnections(knownPeer).length > 0) {
      return knownPeer
    }

    const connection = this.components.connectionManager
      .getConnections()
      .find((entry) => entry.remotePeer.toString() === peerId)

    if (connection != null) {
      this.connectedPeers.set(peerId, connection.remotePeer)
      return connection.remotePeer
    }

    return undefined
  }

  private getPropagationTargets(excludePeerId?: string): PeerId[] {
    const peers = new Map<string, PeerId>()
    for (const connection of this.components.connectionManager.getConnections()) {
      const peerId = connection.remotePeer.toString()
      if (peerId === excludePeerId) continue
      peers.set(peerId, connection.remotePeer)
    }
    return [...peers.values()]
  }
}

export function topicRouter(init: TopicRouterInit = {}) {
  return (components: TopicRouterComponents): TopicRouterService => {
    return new TopicRouter(components, init) as TopicRouterService
  }
}
