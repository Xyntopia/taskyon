import type { Libp2p } from 'libp2p'
import { createLibp2p } from 'libp2p'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { bootstrap } from '@libp2p/bootstrap'
import { sha256 } from 'multiformats/hashes/sha2'
//import type { PubSub } from '@libp2p/interface-pubsub'
//import { yamux } from '@chainsafe/libp2p-yamux'

// Types
type PeerNetwork = {
  start: () => Promise<void>
  stop: () => Promise<void>
  joinSubnet?: (secret: Uint8Array) => Promise<Subnet>
  getPeerId: () => string
}

type Subnet = {
  publish: (msg: Uint8Array) => Promise<void>
  onMessage: (cb: (from: string, msg: Uint8Array) => void) => void
  getPeers: () => string[]
}

// TODO: add TCP/UDP port for when we run taskyon on a server!
const createNode = () => {
  return createLibp2p({
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    //streamMuxers: [yamux()],
    services: {
      pubsub: gossipsub({
        // Add gossipsub configuration if needed
        allowPublishToZeroTopicPeers: true,
        msgIdFn: (msg) => sha256.digest(msg.data).bytes,
        // Handle the version compatibility issue
        scoreParams: {
          IPColocationFactorThreshold: 10,
        },
      }),
    },
    peerDiscovery: [
      bootstrap({
        list: [
          // Add your bootstrap nodes here
          '/dns4/bootstrap.example.com/tcp/443/wss/p2p/QmNnoo...',
        ],
      }),
    ],
  })
}

// Factory function to create a PeerNetwork
export const createPeerNetwork = async (): Promise<PeerNetwork> => {
  const subnets: Record<string, Subnet> = {}

  const node: Libp2p = await createNode()

  const start = async () => {
    await node.start()
    console.log('Peer started:', getPeerId())
  }

  const stop = async () => {
    if (node) await node.stop()
  }

  const getPeerId = (): string => node?.peerId.toString() || ''

  /*const joinSubnet = async (secret: Uint8Array): Promise<Subnet> => {
    if (!node) throw new Error('Peer not started')

    const topic = await deriveTopic(secret)

    if (!subnets[topic]) {
      subnets[topic] = createSubnet(node, topic)
    }

    return subnets[topic]
  }*/

  return { start, stop, getPeerId }
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
