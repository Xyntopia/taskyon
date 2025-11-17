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
