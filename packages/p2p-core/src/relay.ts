import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { autoNAT } from '@libp2p/autonat'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import { enable } from '@libp2p/logger'
import { ping } from '@libp2p/ping'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import type { PeerId } from '@libp2p/interface'
import { createLibp2p, type Libp2p } from 'libp2p'
import { PUBSUB_PEER_DISCOVERY, TOPIC_ROUTER_PROTOCOL } from './constants'
import { topicRouter, type TopicRouterService } from './topic-router'

type RelayAutoNatStatus = {
  reachability: string
  publicAddr?: { toString: () => string }
}

type RelayAutoNatService = {
  getStatus?: () => Promise<RelayAutoNatStatus>
}

type RelayConnectionLike = {
  id?: string
  direction?: string
  status?: string
  remotePeer?: { toString?: () => string }
  timeline?: { open?: number; upgraded?: number; close?: number }
  remoteAddr?: {
    toOptions?: () => { host?: string }
    nodeAddress?: () => { address?: string }
    toString?: () => string
  }
}

type RelayConnectionEventLike = {
  detail?: RelayConnectionLike
}

export type RelayStartOptions = {
  logName?: string
  listenAddrs?: string[]
  maxReservations?: number
  reservationExpirationMs?: number
  hopTimeoutMs?: number
  maxConnections?: number
  minConnections?: number
  maxIncomingPendingConnections?: number
  inboundConnectionTimeoutMs?: number
  autoNatPollMs?: number
}

type RelayLibp2pNode = Libp2p & {
  services: Libp2p['services'] & {
    pubsub: TopicRouterService
  }
}

type ResolvedRelayStartOptions = {
  logName: string
  listenAddrs: string[]
  maxReservations: number
  reservationExpirationMs: number
  hopTimeoutMs: number
  maxConnections: number
  minConnections: number
  maxIncomingPendingConnections: number
  inboundConnectionTimeoutMs: number
  autoNatPollMs: number
}

export const createStdoutLogger = (name: string) => {
  const timestamp = () => new Date().toISOString()
  return {
    info: (msg: string) => console.log(`${timestamp()} [${name}] [INFO] ${msg}`),
    warn: (msg: string) => console.log(`${timestamp()} [${name}] [WARN] ${msg}`),
    error: (msg: string) => console.log(`${timestamp()} [${name}] [ERROR] ${msg}`),
  }
}

function describeRelayConnection(connection: RelayConnectionLike | undefined | null) {
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

function resolveRelayStartOptions(opts: RelayStartOptions): ResolvedRelayStartOptions {
  return {
    logName: opts.logName ?? 'relay',
    listenAddrs: opts.listenAddrs ?? ['/ip4/0.0.0.0/tcp/9111/ws', '/ip4/0.0.0.0/tcp/9112'],
    maxReservations: opts.maxReservations ?? 50,
    reservationExpirationMs: opts.reservationExpirationMs ?? 60_000,
    hopTimeoutMs: opts.hopTimeoutMs ?? 10_000,
    maxConnections: opts.maxConnections ?? 200,
    minConnections: opts.minConnections ?? 5,
    maxIncomingPendingConnections: opts.maxIncomingPendingConnections ?? 50,
    inboundConnectionTimeoutMs: opts.inboundConnectionTimeoutMs ?? 60_000,
    autoNatPollMs: opts.autoNatPollMs ?? 30_000,
  }
}

function extractRemoteHost(maConn: RelayConnectionLike): string | null {
  const addr = maConn?.remoteAddr
  if (!addr) return null

  if (typeof addr.toOptions === 'function') {
    const options = addr.toOptions()
    if (typeof options?.host === 'string' && options.host.length > 0) return options.host
  }

  if (typeof addr.nodeAddress === 'function') {
    const options = addr.nodeAddress()
    if (typeof options?.address === 'string' && options.address.length > 0) return options.address
  }

  if (typeof addr.toString === 'function') {
    const value = addr.toString()
    const match = value.match(/^\/(?:ip4|ip6|dns4|dns6|dnsaddr)\/([^/]+)/)
    if (match?.[1]) return match[1]
  }

  return null
}

function logRelayStartup(log: ReturnType<typeof createStdoutLogger>) {
  log.info('=== RELAY SERVER STARTUP ===')
  log.info(`Node.js version: ${process.version}`)
  log.info('Starting libp2p relay server...')
}

function logRelayReady(log: ReturnType<typeof createStdoutLogger>, libp2p: Libp2p) {
  log.info('=== RELAY SERVER READY ===')
  log.info(`PeerID: ${libp2p.peerId.toString()}`)
  log.info(`Multiaddrs:\n${libp2p
    .getMultiaddrs()
    .map((addr) => `  ${addr.toString()}`)
    .join('\n')}`)
  log.info('Relay server listening and ready for connections')
  log.info('==============================')
}

function registerRelayLifecycleLogging(
  libp2p: RelayLibp2pNode,
  log: ReturnType<typeof createStdoutLogger>,
) {
  libp2p.addEventListener('peer:connect', (evt: { detail?: { toString?: () => string } }) => {
    log.info(`Peer connected: ${evt?.detail?.toString?.() ?? 'unknown'}`)
  })
  libp2p.addEventListener('peer:disconnect', (evt: { detail?: { toString?: () => string } }) => {
    log.info(`Peer disconnected: ${evt?.detail?.toString?.() ?? 'unknown'}`)
  })
  libp2p.addEventListener('connection:open', (evt: RelayConnectionEventLike) => {
    log.info(`Connection opened: ${JSON.stringify(describeRelayConnection(evt.detail))}`)
  })
  libp2p.addEventListener('connection:close', (evt: RelayConnectionEventLike) => {
    log.info(`Connection closed: ${JSON.stringify(describeRelayConnection(evt.detail))}`)
  })
  libp2p.addEventListener(
    'self:peer:update',
    (evt: { detail?: { peer?: { addresses?: Array<{ multiaddr?: { toString?: () => string } }> } } }) => {
      const addrs =
        evt.detail?.peer?.addresses?.map((entry) => entry.multiaddr?.toString?.()).filter(Boolean) ?? []
      log.info(`Self peer update: advertised multiaddrs=${addrs.join(', ')}`)
    },
  )
}

function startAutoNatPolling(
  libp2p: RelayLibp2pNode,
  log: ReturnType<typeof createStdoutLogger>,
  autoNatPollMs: number,
) {
  return setInterval(() => {
    void (async () => {
      try {
        const autoNat = libp2p.services.autoNat as RelayAutoNatService | undefined
        const getStatus = autoNat?.getStatus
        if (typeof getStatus !== 'function') {
          return
        }
        const status = await getStatus.call(autoNat)
        log.info(
          `[AutoNAT poll] reachability=${status.reachability} addr=${status.publicAddr?.toString() ?? '-'}`,
        )
      } catch (error) {
        log.warn(`[AutoNAT poll] failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })()
  }, autoNatPollMs)
}

export async function startRelayLibp2p(opts: RelayStartOptions = {}): Promise<Libp2p> {
  const {
    logName,
    listenAddrs,
    maxReservations,
    reservationExpirationMs,
    hopTimeoutMs,
    maxConnections,
    minConnections,
    maxIncomingPendingConnections,
    inboundConnectionTimeoutMs,
    autoNatPollMs,
  } = resolveRelayStartOptions(opts)

  enable('libp2p:*')

  const log = createStdoutLogger(logName)
  const bannedIPs = new Set<string>()
  const bannedPeers = new Set<string>()
  logRelayStartup(log)

  const libp2p = (await createLibp2p(({
    addresses: {
      listen: listenAddrs,
    },
    transports: [webSockets(), tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    connectionGater: {
      denyInboundConnection(maConn: RelayConnectionLike) {
        const host = extractRemoteHost(maConn)
        if (!host) {
          log.warn('Inbound connect attempt from unknown host (allowing)')
          return false
        }
        log.warn(`Inbound connect attempt from ${host}`)
        return bannedIPs.has(host)
      },
    },
    services: {
      pubsub: topicRouter({
        protocol: TOPIC_ROUTER_PROTOCOL,
        discoveryTopic: PUBSUB_PEER_DISCOVERY,
      }) as unknown,
      identify: identify(),
      ping: ping(),
      autoNat: autoNAT(),
      relay: circuitRelayServer({
        reservations: {
          maxReservations,
          reservationExpiration: reservationExpirationMs,
          reservationFilter: ({ peerId }: { peerId: { toString: () => string } }) => {
            const str = peerId.toString()
            const deny = bannedPeers.has(str)
            if (deny) log.warn(`Blocking reservation from banned peer ${str}`)
            return !deny
          },
        },
        hopTimeout: hopTimeoutMs,
      } as unknown as Parameters<typeof circuitRelayServer>[0]),
    },
    connectionManager: {
      maxConnections,
      minConnections,
      maxIncomingPendingConnections,
      inboundConnectionTimeout: inboundConnectionTimeoutMs,
    },
  }) as unknown as Parameters<typeof createLibp2p>[0])) as RelayLibp2pNode

  registerRelayLifecycleLogging(libp2p, log)

  log.info(`Topic router ready on discovery topic ${PUBSUB_PEER_DISCOVERY}`)
  startAutoNatPolling(libp2p, log, autoNatPollMs)
  logRelayReady(log, libp2p)

  return libp2p
}
