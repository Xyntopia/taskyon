import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { enable, prefixLogger } from '@libp2p/logger'
import { ping } from '@libp2p/ping'
import type { Ping } from '@libp2p/ping'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import type { PeerId } from '@libp2p/interface'
import type { Multiaddr } from '@multiformats/multiaddr'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p, type Libp2p } from 'libp2p'
import {
  PUBSUB_PEER_DISCOVERY,
  SUBNETWORK_PEER_DISCOVERY_EVENT,
  TOPIC_ROUTER_PROTOCOL,
} from './constants'
import { deriveDiscoveryTokens, type DiscoverySecretInput } from './discovery'
import { topicRouter, type TopicRouterService } from './topic-router'

type DiscoveryAnnouncement = {
  peerId: string
  multiaddrs: string[]
  publishedAt: number
  subnetworkTokens: string[]
}

export type NodePubsubMessage = {
  topic: string
  data: Uint8Array
  from?: PeerId | string
  type?: 'signed' | 'unsigned'
  sequenceNumber?: bigint
}

export type NodePubsubService = TopicRouterService

export type NodeLibp2pNode = Libp2p & {
  services: Libp2p['services'] & {
    pubsub: NodePubsubService
    ping: Ping
  }
}

export type StartNodeLibp2pOptions = {
  listenAddrs?: string[]
  relayAddrs?: string[]
  logNamespaces?: string
  discoveryAnnouncementIntervalMs?: number
  subnetworkSecrets?: DiscoverySecretInput[]
}

const logger = prefixLogger('p2p-core')
export const nodeLog = logger.forComponent('node')

function getNodeMultiaddrs(libp2p: NodeLibp2pNode): string[] {
  return libp2p.getMultiaddrs().map((addr) => addr.toString())
}

function createDiscoveryAnnouncement(
  libp2p: NodeLibp2pNode,
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

function dispatchPeerDiscovery(
  libp2p: NodeLibp2pNode,
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

function registerPeerDiscoverySubscription(libp2p: NodeLibp2pNode, subnetworkTokens: Set<string>) {
  const onTopicRouterMessage = (event: CustomEvent<NodePubsubMessage>) => {
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

    const addrs = announcement.multiaddrs
      .map((addr) => {
        try {
          return multiaddr(addr)
        } catch {
          return null
        }
      })
      .filter((addr): addr is Multiaddr => addr != null)

    dispatchPeerDiscovery(libp2p, announcement.peerId, addrs, matchedToken ?? undefined)
  }

  libp2p.services.pubsub.addEventListener('message', onTopicRouterMessage)
  return () => libp2p.services.pubsub.removeEventListener('message', onTopicRouterMessage)
}

function registerAnnouncementTriggers(libp2p: NodeLibp2pNode, publish: () => Promise<void>) {
  const onSelfUpdate = () => {
    void publish()
  }
  const onConnectionOpen = () => {
    void publish()
  }

  libp2p.addEventListener('self:peer:update', onSelfUpdate)
  libp2p.addEventListener('connection:open', onConnectionOpen)

  return () => {
    libp2p.removeEventListener('self:peer:update', onSelfUpdate)
    libp2p.removeEventListener('connection:open', onConnectionOpen)
  }
}

export async function startNodeLibp2p(
  opts: StartNodeLibp2pOptions = {},
): Promise<NodeLibp2pNode> {
  const {
    listenAddrs = [],
    relayAddrs = [],
    logNamespaces = 'p2p-core:*,-*:trace',
    discoveryAnnouncementIntervalMs = 2_000,
    subnetworkSecrets = [],
  } = opts

  enable(logNamespaces)
  const subnetworkTokens = new Set(await deriveDiscoveryTokens(subnetworkSecrets))

  const libp2p = (await createLibp2p({
    addresses: {
      listen: listenAddrs,
    },
    transports: [tcp(), webSockets()],
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
    },
  } as unknown as Parameters<typeof createLibp2p>[0])) as NodeLibp2pNode

  const publishSelfAnnouncement = async () => {
    await libp2p.services.pubsub.publish(
      PUBSUB_PEER_DISCOVERY,
      encodeDiscoveryAnnouncement(createDiscoveryAnnouncement(libp2p, [...subnetworkTokens])),
    )
  }

  const unregisterDiscovery = registerPeerDiscoverySubscription(libp2p, subnetworkTokens)
  const unregisterTriggers = registerAnnouncementTriggers(libp2p, publishSelfAnnouncement)
  const announcementTimer = setInterval(() => {
    void publishSelfAnnouncement()
  }, discoveryAnnouncementIntervalMs)

  const originalStop = libp2p.stop.bind(libp2p)
  libp2p.stop = async () => {
    clearInterval(announcementTimer)
    unregisterDiscovery()
    unregisterTriggers()
    await originalStop()
  }

  for (const relayAddr of relayAddrs) {
    await libp2p.dial(multiaddr(relayAddr))
  }

  await publishSelfAnnouncement()
  return libp2p
}
