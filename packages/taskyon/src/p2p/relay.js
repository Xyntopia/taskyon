import { createLibp2p } from 'libp2p'
import { autoNAT } from '@libp2p/autonat'
import { identify } from '@libp2p/identify'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { tcp } from '@libp2p/tcp'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'

const PUBSUB_PEER_DISCOVERY = 'browser-peer-discovery'

async function main() {
  // enable('*')
  const libp2p = await createLibp2p({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/9111/ws', '/ip4/0.0.0.0/tcp/9112'],
    },
    transports: [webSockets(), tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      autoNat: autoNAT(),
      relay: circuitRelayServer(),
      pubsub: gossipsub(),
    },
  })

  libp2p.services.pubsub.subscribe(PUBSUB_PEER_DISCOVERY)

  console.log('PeerID: ', libp2p.peerId.toString())
  console.log('Multiaddrs: ', libp2p.getMultiaddrs())
}

main()
