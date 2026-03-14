import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import type { PeerId, Stream } from '@libp2p/interface'
import { identify } from '@libp2p/identify'
import { enable, prefixLogger } from '@libp2p/logger'
import { ping } from '@libp2p/ping'
import type { Ping } from '@libp2p/ping'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { webTransport } from '@libp2p/webtransport'
import type { Multiaddr } from '@multiformats/multiaddr'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p, type Libp2p } from 'libp2p'
import weald from 'weald'
import {
  PUBSUB_PEER_DISCOVERY,
  SUBNETWORK_PEER_DISCOVERY_EVENT,
  TOPIC_ROUTER_PROTOCOL,
  getRelayDialFallbacks,
} from './constants'
import { deriveDiscoveryTokens, type DiscoverySecretInput } from './discovery'
import { topicRouter, type TopicRouterService } from './topic-router'

type DiscoveryAnnouncement = {
  peerId: string
  multiaddrs: string[]
  publishedAt: number
  subnetworkTokens: string[]
}

type BrowserConnectionLike = {
  id?: string
  direction?: string
  status?: string
  remoteAddr?: { toString?: () => string }
  remotePeer?: { toString?: () => string }
  timeline?: { open?: number; upgraded?: number; close?: number }
}

export type BrowserPubsubMessage = {
  topic: string
  data: Uint8Array
  from?: PeerId | string
  type?: 'signed' | 'unsigned'
  sequenceNumber?: bigint
}

export type BrowserPubsubService = TopicRouterService

export type BrowserLibp2pNode = Libp2p & {
  services: Libp2p['services'] & {
    pubsub: BrowserPubsubService
    ping: Ping
  }
  dialProtocol: (peerId: unknown, protocol: string) => Promise<Stream>
  components?: {
    transportManager?: {
      listen: (addrs: Multiaddr[]) => Promise<void>
    }
  }
}

const logger = prefixLogger('p2p-core')
export const log = logger.forComponent('browser')
const LIBP2P_LOG_NAMESPACES_KEY = 'taskyon.libp2p.logNamespaces'
const DEBUG_NAMESPACES_KEY = 'debug'
const DEFAULT_BROWSER_LOG_NAMESPACES =
  'p2p-core:*,libp2p:*,-libp2p:connection-manager:*,-*:trace'
const VERBOSE_BROWSER_LOG_NAMESPACES = 'p2p-core:*,libp2p:*,-*:trace'
const DISCOVERY_ANNOUNCEMENT_INTERVAL_MS = 10_000
let browserLoggerTransportPatched = false

function describeError(error: unknown) {
  if (error instanceof Error) {
    const cause = 'cause' in error ? (error as Error & { cause?: unknown }).cause : undefined
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause:
        cause instanceof Error
          ? { name: cause.name, message: cause.message, stack: cause.stack }
          : cause,
    }
  }

  return { value: error }
}

function describeConnection(connection: BrowserConnectionLike | undefined | null) {
  if (connection == null) return null

  return {
    id: connection.id,
    direction: connection.direction,
    status: connection.status,
    remotePeer: connection.remotePeer?.toString?.(),
    remoteAddr: connection.remoteAddr?.toString?.(),
    timeline: connection.timeline,
  }
}

function getNodeMultiaddrs(libp2p: BrowserLibp2pNode): string[] {
  return libp2p.getMultiaddrs().map((addr) => addr.toString())
}

function createDiscoveryAnnouncement(
  libp2p: BrowserLibp2pNode,
  subnetworkTokens: string[],
): DiscoveryAnnouncement {
  return {
    peerId: libp2p.peerId.toString(),
    multiaddrs: getNodeMultiaddrs(libp2p),
    publishedAt: Date.now(),
    subnetworkTokens,
  }
}

function encodeDiscoveryAnnouncement(announcement: DiscoveryAnnouncement): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(announcement))
}

function parseDiscoveryAnnouncement(data: Uint8Array): DiscoveryAnnouncement | null {
  try {
    return JSON.parse(new TextDecoder().decode(data)) as DiscoveryAnnouncement
  } catch {
    return null
  }
}

function publishDiscoveryAnnouncement(libp2p: BrowserLibp2pNode, subnetworkTokens: string[]) {
  return async () => {
    try {
      await libp2p.services.pubsub.publish(
        PUBSUB_PEER_DISCOVERY,
        encodeDiscoveryAnnouncement(createDiscoveryAnnouncement(libp2p, subnetworkTokens)),
      )
    } catch (error) {
      log.error('failed to publish peer discovery announcement', error)
    }
  }
}

function dispatchPeerDiscovery(
  libp2p: BrowserLibp2pNode,
  peerId: string,
  multiaddrs: Multiaddr[],
  matchedToken?: string,
) {
  const detail = matchedToken
    ? { id: peerId, multiaddrs, matchedToken }
    : { id: peerId, multiaddrs }
  ;(libp2p as unknown as {
    dispatchEvent?: (
      event: CustomEvent<{ id: string; multiaddrs: Multiaddr[]; matchedToken?: string }>,
    ) => void
  }).dispatchEvent?.(
    new CustomEvent(SUBNETWORK_PEER_DISCOVERY_EVENT, {
      detail,
    }),
  )
}

function registerBrowserLifecycleLogging(
  libp2p: BrowserLibp2pNode,
  publishAnnouncement: () => void | Promise<void>,
) {
  const onSelfPeerUpdate = ({ detail: { peer } }: CustomEvent<{ peer: { id: PeerId; addresses: Array<{ multiaddr: Multiaddr }> } }>) => {
    const multiaddrs = peer.addresses.map(({ multiaddr }) => multiaddr.toString())
    log('changed multiaddrs: peer %s multiaddrs: %s', peer.id.toString(), multiaddrs.join(', '))
    void publishAnnouncement()
  }

  const onConnectionOpen = (event: CustomEvent<BrowserConnectionLike>) => {
    log('connection opened: %o', describeConnection(event.detail))
    log('current self multiaddrs: %o', getNodeMultiaddrs(libp2p))
    void publishAnnouncement()
  }

  const onConnectionClose = (event: CustomEvent<BrowserConnectionLike>) => {
    log('connection closed: %o', describeConnection(event.detail))
  }

  libp2p.addEventListener('self:peer:update', onSelfPeerUpdate as EventListener)
  libp2p.addEventListener('connection:open', onConnectionOpen as EventListener)
  libp2p.addEventListener('connection:close', onConnectionClose as EventListener)

  return () => {
    libp2p.removeEventListener('self:peer:update', onSelfPeerUpdate as EventListener)
    libp2p.removeEventListener('connection:open', onConnectionOpen as EventListener)
    libp2p.removeEventListener('connection:close', onConnectionClose as EventListener)
  }
}

function registerPeerDiscoverySubscription(libp2p: BrowserLibp2pNode, subnetworkTokens: Set<string>) {
  const onTopicRouterMessage = (event: CustomEvent<BrowserPubsubMessage>) => {
    if (event.detail.topic !== PUBSUB_PEER_DISCOVERY) {
      return
    }

    const announcement = parseDiscoveryAnnouncement(event.detail.data)
    if (announcement == null || announcement.peerId === libp2p.peerId.toString()) {
      return
    }

    const matchedToken =
      announcement.subnetworkTokens.find((token) => subnetworkTokens.has(token)) ?? null
    if (subnetworkTokens.size > 0 && matchedToken == null) {
      return
    }

    const multiaddrs = announcement.multiaddrs.map((addr) => multiaddr(addr))
    log('peer discovered %o', multiaddrs.map((addr) => addr.toString()))

    if (libp2p.getConnections().some((connection) => connection.remotePeer.toString() === announcement.peerId)) {
      log('already connected to peer %s, skipping discovery dial', announcement.peerId)
      return
    }

    dispatchPeerDiscovery(libp2p, announcement.peerId, multiaddrs, matchedToken ?? undefined)
    void dialDiscoveredMaddrs(libp2p, multiaddrs)
  }

  libp2p.services.pubsub.addEventListener('message', onTopicRouterMessage)
  return () => libp2p.services.pubsub.removeEventListener('message', onTopicRouterMessage)
}

function ensureVisibleBrowserLoggerTransport() {
  if (browserLoggerTransportPatched || typeof globalThis.console?.log !== 'function') return

  const consoleLog = globalThis.console.log.bind(globalThis.console)
  ;(weald as unknown as { log?: (...args: unknown[]) => void }).log = consoleLog
  browserLoggerTransportPatched = true
}

function getStoredBrowserLogNamespaces() {
  if (typeof globalThis.localStorage?.getItem !== 'function') return null
  const value =
    globalThis.localStorage.getItem(LIBP2P_LOG_NAMESPACES_KEY) ??
    globalThis.localStorage.getItem(DEBUG_NAMESPACES_KEY)
  return value && value.trim() ? value : null
}

export function setBrowserLibp2pLogNamespaces(namespaces: string, opts: { persist?: boolean } = {}) {
  const persist = opts.persist ?? true
  const trimmed = namespaces.trim()
  ensureVisibleBrowserLoggerTransport()
  enable(trimmed)
  if (persist && typeof globalThis.localStorage?.setItem === 'function') {
    globalThis.localStorage.setItem(LIBP2P_LOG_NAMESPACES_KEY, trimmed)
    // Standard debug key used by libp2p/debug examples and tooling.
    globalThis.localStorage.setItem(DEBUG_NAMESPACES_KEY, trimmed)
  }
  if (persist && typeof globalThis.sessionStorage?.setItem === 'function') {
    globalThis.sessionStorage.setItem(DEBUG_NAMESPACES_KEY, trimmed)
  }
  return trimmed
}

export function enableVerboseBrowserLibp2pLogs(opts: { persist?: boolean } = {}) {
  return setBrowserLibp2pLogNamespaces(VERBOSE_BROWSER_LOG_NAMESPACES, opts)
}

export async function startBrowserLibp2p(opts: {
  additionalServices?: Record<string, unknown>
  logNamespaces?: string
  subnetworkSecrets?: DiscoverySecretInput[]
} = {}): Promise<BrowserLibp2pNode> {
  const { additionalServices = {}, logNamespaces, subnetworkSecrets = [] } = opts
  const namespaces = logNamespaces ?? getStoredBrowserLogNamespaces() ?? DEFAULT_BROWSER_LOG_NAMESPACES
  ensureVisibleBrowserLoggerTransport()
  enable(namespaces)
  log('libp2p logger namespaces active: %s', namespaces)
  const subnetworkTokens = new Set(await deriveDiscoveryTokens(subnetworkSecrets))

  const relayListenAddrs: string[] = []
  log('starting libp2p with relayListenAddrs: %o', relayListenAddrs)

  const libp2p = (await createLibp2p({
    addresses: {
      listen: ['/webrtc', ...relayListenAddrs],
    },
    transports: [webTransport(), webSockets(), webRTC(), webRTCDirect(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    connectionGater: {
      denyDialMultiaddr: () => false,
    },
    services: {
      pubsub: topicRouter({
        protocol: TOPIC_ROUTER_PROTOCOL,
        discoveryTopic: PUBSUB_PEER_DISCOVERY,
      }) as unknown,
      identify: identify(),
      ping: ping(),
      ...additionalServices,
    },
  } as unknown as Parameters<typeof createLibp2p>[0])) as BrowserLibp2pNode

  const publishSelfAnnouncement = publishDiscoveryAnnouncement(libp2p, [...subnetworkTokens])
  const unregisterLifecycleLogging = registerBrowserLifecycleLogging(libp2p, publishSelfAnnouncement)
  const unregisterDiscovery = registerPeerDiscoverySubscription(libp2p, subnetworkTokens)

  void dialRelayFallbacks(libp2p)
  void publishSelfAnnouncement()
  const announcementTimer = setInterval(() => {
    void publishSelfAnnouncement()
  }, DISCOVERY_ANNOUNCEMENT_INTERVAL_MS)

  const originalStop = libp2p.stop.bind(libp2p)
  libp2p.stop = async () => {
    clearInterval(announcementTimer)
    unregisterLifecycleLogging()
    unregisterDiscovery()
    await originalStop()
  }

  return libp2p
}

export function msgIdFnStrictNoSign(msg: BrowserPubsubMessage) {
  return msg.data
}

async function dialDiscoveredMaddrs(libp2p: BrowserLibp2pNode, multiaddrs: Multiaddr[]) {
  const dialable = prioritizedDialableMultiaddrs(multiaddrs)
  log(`dialling discovered multiaddrs: %o`, dialable)

  for (const addr of dialable) {
    try {
      log(`attempting to dial discovered multiaddr: %o`, addr)
      await libp2p.dial(addr)
      return
    } catch (error) {
      log.error(`failed to dial discovered multiaddr: %o`, addr, error)
    }
  }
}

function prioritizedDialableMultiaddrs(multiaddrs: Multiaddr[]) {
  const scoring: Array<{ score: number; addr: Multiaddr }> = []
  for (const addr of multiaddrs) {
    const protos = addr.getComponents().map((component) => component.name)
    if (protos.includes('webrtc')) scoring.push({ score: 100, addr })
    else if (protos.includes('webtransport')) scoring.push({ score: 90, addr })
    else if (protos.includes('wss')) scoring.push({ score: 80, addr })
    else if (protos.includes('ws')) scoring.push({ score: 70, addr })
    else if (protos.includes('p2p-circuit')) scoring.push({ score: 60, addr })
  }
  return scoring.sort((a, b) => b.score - a.score).map((entry) => entry.addr)
}

async function dialRelayFallbacks(libp2p: BrowserLibp2pNode) {
  const relayDialFallbacks = getRelayDialFallbacks()
  log('startup relay candidates: %o', relayDialFallbacks)

  for (const addrString of relayDialFallbacks) {
    if (libp2p.getConnections().length > 0) {
      log('startup relay dial skipped: already connected')
      return
    }

    try {
      const addr = multiaddr(addrString)
      log('startup relay dial attempt: %a', addr)
      log(
        'startup relay dial context: peerId=%s relay=%s selfAddrs=%o',
        libp2p.peerId.toString(),
        addrString,
        getNodeMultiaddrs(libp2p),
      )
      const conn = await libp2p.dial(addr)
      await ensureRelayReservation(libp2p, multiaddr(conn.remoteAddr.toString()))
      log(
        'startup relay dial connected: %o',
        {
          addr: addrString,
          connection: describeConnection(conn as BrowserConnectionLike),
          selfAddrs: getNodeMultiaddrs(libp2p),
        },
      )
      return
    } catch (error) {
      log.error(
        'startup relay dial failed for %s with details %o',
        addrString,
        {
          error: describeError(error),
          selfAddrs: getNodeMultiaddrs(libp2p),
          existingConnections: libp2p.getConnections().map((connection) =>
            describeConnection(connection as BrowserConnectionLike),
          ),
        },
      )
    }
  }
}

export async function ensureRelayReservation(
  libp2p: BrowserLibp2pNode,
  relayAddr: Multiaddr,
): Promise<boolean> {
  const transportManager = libp2p.components?.transportManager
  if (transportManager == null) {
    log.error('transport manager unavailable, cannot reserve relay slot on %a', relayAddr)
    return false
  }

  const listenAddr = relayAddr.encapsulate('/p2p-circuit')
  try {
    log('requesting relay reservation via listen on %a', listenAddr)
    await transportManager.listen([listenAddr])
    log(
      'relay reservation requested on %a; self multiaddrs are now %o',
      listenAddr,
      getNodeMultiaddrs(libp2p),
    )
    return true
  } catch (error) {
    log.error(
      'failed to reserve relay slot on %a with details %o',
      listenAddr,
      {
        error: describeError(error),
        selfAddrs: getNodeMultiaddrs(libp2p),
      },
    )
    return false
  }
}

export const connectToMultiaddr =
  (libp2p: BrowserLibp2pNode) =>
  async (addr: Multiaddr): Promise<unknown> => {
    log(`dialling: %a`, addr)
    try {
      const conn = await libp2p.dial(addr)
      await ensureRelayReservation(libp2p, multiaddr(conn.remoteAddr.toString()))
      log('connected to %p on %a', conn.remotePeer, conn.remoteAddr)
      return conn
    } catch (e) {
      console.error(e)
      throw e
    }
  }
