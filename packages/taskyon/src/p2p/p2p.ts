import type { Libp2p } from 'libp2p'
import { createLibp2p } from 'libp2p'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { bootstrap } from '@libp2p/bootstrap'
import { sha256 } from 'multiformats/hashes/sha2'

// Types
type PeerNetwork = {
  start: () => Promise<void>
  stop: () => Promise<void>
  joinSubnet: (secret: Uint8Array) => Promise<Subnet>
  getPeerId: () => string
}

type Subnet = {
  publish: (msg: Uint8Array) => Promise<void>
  onMessage: (cb: (from: string, msg: Uint8Array) => void) => void
  getPeers: () => string[]
}

// Factory function to create a PeerNetwork
export const createPeerNetwork = (): PeerNetwork => {
  let libp2p: Libp2p | null = null
  const subnets: Record<string, Subnet> = {}

  const start = async () => {
    libp2p = await createLibp2p({
      transports: [webSockets()],
      connectionEncryption: [noise()],
      pubsub: gossipsub(),
      peerDiscovery: [
        bootstrap({
          list: [
            // Add your bootstrap nodes here
            '/dns4/bootstrap.example.com/tcp/443/wss/p2p/QmNnoo...',
          ],
        }),
      ],
    })

    await libp2p.start()
    console.log('Peer started:', getPeerId())
  }

  const stop = async () => {
    if (libp2p) await libp2p.stop()
    libp2p = null
  }

  const getPeerId = (): string => libp2p?.peerId.toString() || ''

  const joinSubnet = async (secret: Uint8Array): Promise<Subnet> => {
    if (!libp2p) throw new Error('Peer not started')

    const topic = await deriveTopic(secret)

    if (!subnets[topic]) {
      subnets[topic] = createSubnet(libp2p, topic)
    }

    return subnets[topic]
  }

  return { start, stop, joinSubnet, getPeerId }
}

// Factory function to create a Subnet
const createSubnet = (libp2p: Libp2p, topic: string): Subnet => {
  let messageCallback: ((from: string, msg: Uint8Array) => void) | null = null

  // Subscribe to topic
  libp2p.pubsub.subscribe(topic)
  libp2p.pubsub.addEventListener('message', (event) => {
    if (event.detail.topic === topic && messageCallback) {
      messageCallback(event.detail.from, event.detail.data)
    }
  })

  const publish = async (msg: Uint8Array) => {
    await libp2p.pubsub.publish(topic, msg)
  }

  const onMessage = (cb: (from: string, msg: Uint8Array) => void) => {
    messageCallback = cb
  }

  const getPeers = () => libp2p.pubsub.getSubscribers(topic) || []

  return { publish, onMessage, getPeers }
}

// Helper to derive topic from secret
const deriveTopic = async (secret: Uint8Array): Promise<string> => {
  const hash = await sha256.digest(secret)
  return `subnet-${hash.toString().slice(0, 16)}`
}

// Test function
export const testPeerNetwork = async () => {
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
}

// Run test
testPeerNetwork().catch(console.error)
