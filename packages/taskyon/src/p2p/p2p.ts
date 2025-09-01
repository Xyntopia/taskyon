// p2p.ts
// check this link here for an example how to get this going:
//  https://github.com/libp2p/libp2p-webrtc-guide
//  https://github.com/libp2p/universal-connectivity

import type { Libp2p } from 'libp2p'
import { createLibp2p } from 'libp2p'
import { identify } from '@libp2p/identify'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { multiaddr } from '@multiformats/multiaddr'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { webTransport } from '@libp2p/webtransport'
import { webRTC } from '@libp2p/webrtc'
import { enable, disable } from '@libp2p/logger'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { getPeerTypes, getAddresses, getPeerDetails } from './p2putils'
import { bootstrap } from '@libp2p/bootstrap'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'

export const PUBSUB_PEER_DISCOVERY = 'browser-peer-discovery'

// Types
type PeerNetwork = {
  start: () => Promise<void>
  stop: () => Promise<void>
  joinSubnet?: (secret: Uint8Array) => Promise<Subnet>
  getPeerId: () => string | undefined
}

interface libp2pNetwork extends PeerNetwork {
  connectWith: (addr: string) => Promise<void>
  info: () => Record<string, unknown>
  loggingCtl: (enableLogging: boolean) => void
}

type Subnet = {
  publish: (msg: Uint8Array) => Promise<void>
  onMessage: (cb: (from: string, msg: Uint8Array) => void) => void
  getPeers: () => string[]
}

// TODO: add TCP/UDP port for when we run taskyon on a server!
const createNode = () =>
  createLibp2p({
    addresses: {
      listen: [
        // 👇 Required to create circuit relay reservations in order to hole punch browser-to-browser WebRTC connections
        '/p2p-circuit',
        // 👇 Listen for webRTC connection
        '/webrtc',
      ],
    },
    transports: [webSockets(), webTransport(), webRTC(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    // backup if we have a version mismatch: @ts-expect-error libp2p-yamux type mismatch
    // right now we solve this issue by adding {"resolutions": { "@libp2p/interface": "2.11.0"}
    // to our package.json. which makes libp2p use the correct yamu version.
    streamMuxers: [yamux()],
    connectionGater: {
      // Allow private addresses for local testing
      denyDialMultiaddr: () => false,
    },
    peerDiscovery: [
      bootstrap({
        list: [''],
      }),
      pubsubPeerDiscovery({
        interval: 10_000,
        topics: [PUBSUB_PEER_DISCOVERY],
      }),
    ],
    services: {
      pubsub: gossipsub(),
      identify: identify(),
    },
  })

// Factory function to create a PeerNetwork
export const createPeerNetwork = async (): Promise<libp2pNetwork> => {
  //const subnets: Record<string, Subnet> = {}
  const node: Libp2p = await createNode()

  node.addEventListener(
    'peer:discovery',
    (evt) =>
      // because a void return is expected we can't use the async function directly.....
      void (async (evt) => {
        // Encapsulate the peer ID to ensure dialing succeeds
        // Should be removed once https://github.com/libp2p/js-libp2p/issues/3239 is resolved.
        const maddrs = evt.detail.multiaddrs.map((ma) =>
          ma.encapsulate(`/p2p/${evt.detail.id.toString()}`),
        )
        console.log(
          `Discovered new peer (${evt.detail.id.toString()}). Dialling:`,
          maddrs.map((ma) => ma.toString()),
        )
        try {
          await node.dial(maddrs)
        } catch (err) {
          console.error(`Failed to dial peer (${evt.detail.id.toString()}):`, err)
        }
      })(evt),
  )

  node.addEventListener('peer:connect', (event) => console.log(event))
  node.addEventListener('peer:disconnect', (event) => console.log(event))

  const connectWith = async (addr: string) => {
    const maddr = multiaddr(addr)

    console.log(maddr)
    try {
      await node.dial(maddr)
    } catch (e) {
      console.log(e)
    }
  }

  const loggingCtl = (enableLogging: boolean) => {
    if (enableLogging) enable('*,*:debug')
    else disable()
  }

  const start = async () => {
    await node.start()
    console.log('Peer started:', getPeerId())
  }

  const stop = async () => {
    if (node) await node.stop()
  }

  const getPeerId = () => node?.peerId.toString() || undefined

  const info = () => ({
    peerCount: node.getConnections().length,
    peerTypes: getPeerTypes(node),
    nodeAddressCount: node.getMultiaddrs().length,
    nodeAddresses: getAddresses(node),
    nodePeerDetails: getPeerDetails(node),
  })

  /*const joinSubnet = async (secret: Uint8Array): Promise<Subnet> => {
    if (!node) throw new Error('Peer not started')

    const topic = await deriveTopic(secret)

    if (!subnets[topic]) {
      subnets[topic] = createSubnet(node, topic)
    }

    return subnets[topic]
  }*/

  return { start, stop, getPeerId, connectWith, loggingCtl, info }
}

// Factory function to create a Subnet
/*const createSubnet = (libp2p: Libp2p, topic: string): Subnet => {
  let messageCallback: ((from: string, msg: Uint8Array) => void) | null = null

  // Get pubsub service - use any to bypass type checking issues
  const pubsub = libp2p.services.pubsub as PubSub

  // Subscribe to topic
  pubsub.subscribe(topic)

  // Handle incoming messages
  pubsub.addEventListener('message', (event) => {
    const message = event.detail
    if (message.topic === topic && messageCallback) {
      // Handle the from field which might be a PeerId or undefined
      const fromId = message.from
        ? typeof message.from === 'string'
          ? message.from
          : message.from.toString()
        : 'unknown'
      messageCallback(fromId, message.data)
    }
  })

  const publish = async (msg: Uint8Array) => {
    await pubsub.publish(topic, msg)
  }

  const onMessage = (cb: (from: string, msg: Uint8Array) => void) => {
    messageCallback = cb
  }

  const getPeers = () => {
    try {
      const peers = pubsub.getSubscribers ? pubsub.getSubscribers(topic) : []
      return Array.isArray(peers)
        ? peers.map((peer: any) => (typeof peer === 'string' ? peer : peer.toString()))
        : []
    } catch (error) {
      console.warn('Error getting peers:', error)
      return []
    }
  }

  return { publish, onMessage, getPeers }
}*/

// Helper to derive topic from secret
/*const deriveTopic = async (secret: Uint8Array): Promise<string> => {
  const hash = await sha256.digest(secret)
  // Fixed: properly convert hash bytes to hex string
  const hashHex = Array.from(hash.bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `subnet-${hashHex.slice(0, 16)}`
}*/

// Test function
/*export const testPeerNetwork = async () => {
  const secret = new TextEncoder().encode('my-secret-password')

  // Create two peer networks (simulating separate browser tabs)
  const peer1 = createPeerNetwork()
  const peer2 = createPeerNetwork()

  await peer1.start()
  await peer2.start()

  const subnet1 = await peer1.joinSubnet(secret)
  const subnet2 = await peer2.joinSubnet(secret)

  // Setup message handlers
  subnet1.onMessage((from, msg) => {
    console.log(`Peer1 received from ${from}: ${new TextDecoder().decode(msg)}`)
  })

  subnet2.onMessage((from, msg) => {
    console.log(`Peer2 received from ${from}: ${new TextDecoder().decode(msg)}`)
  })

  // Test messaging
  await subnet1.publish(new TextEncoder().encode('Hello from Peer1'))
  await subnet2.publish(new TextEncoder().encode('Hello from Peer2'))

  // Check peer discovery
  setTimeout(() => {
    console.log('Peer1 sees peers:', subnet1.getPeers())
    console.log('Peer2 sees peers:', subnet2.getPeers())
  }, 2000)
}*/

// Run test
//testPeerNetwork().catch(console.error)
