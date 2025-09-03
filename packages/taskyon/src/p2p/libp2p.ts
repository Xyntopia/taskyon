// p2p.ts
// check this link here for an example how to get this going:
//
// we are taking a lot of inspiration frm the follwoing examples:
//
//  https://github.com/libp2p/libp2p-webrtc-guide
//  https://github.com/libp2p/universal-connectivity
//  https://github.com/libp2p/go-libp2p/tree/master/examples/chat-with-rendezvous
//  https://github.com/libp2p/js-libp2p/

// TODO: support this: https://github.com/libp2p/js-libp2p/tree/main/packages/transport-webrtc
//       more specifically:   webrtc-direct https://github.com/libp2p/js-libp2p/tree/main/packages/transport-webrtc#example---webrtc-direct

import type { GossipSub } from '@chainsafe/libp2p-gossipsub'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import type { DelegatedRoutingV1HttpApiClient } from '@helia/delegated-routing-v1-http-api-client'
import { createDelegatedRoutingV1HttpApiClient } from '@helia/delegated-routing-v1-http-api-client'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify } from '@libp2p/identify'
import type { Connection, Message, PeerId, SignedMessage, Libp2p } from '@libp2p/interface'
import { enable, prefixLogger } from '@libp2p/logger'
import { peerIdFromString } from '@libp2p/peer-id'
import { ping } from '@libp2p/ping'
import { pubsubPeerDiscovery } from '@libp2p/pubsub-peer-discovery'
import { webRTC, webRTCDirect } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { webTransport } from '@libp2p/webtransport'
import type { Multiaddr } from '@multiformats/multiaddr'
import { multiaddr } from '@multiformats/multiaddr'
import { createLibp2p } from 'libp2p'
import type { Port } from 'src/modules/frpBus'
import { createDuplexChannel } from 'src/modules/frpBus'
import { BOOTSTRAP_PEER_IDS, CHAT_FILE_TOPIC, CHAT_TOPIC, PUBSUB_PEER_DISCOVERY } from './constants'
import { directMessage } from './direct-message'
import { getAddresses, getPeerDetails, getPeerTypes } from './p2putils'
import { sha256 } from 'multiformats/hashes/sha2'
import { first } from '../utils/objHelpers'

const prefix = `ui`
const logger = prefixLogger(prefix)
const log = logger.forComponent('libp2p')

export const bootstrapList = [
  //'/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  //'/ip4/192.168.188.111/tcp/9111/ws/p2p/12D3KooWKkVyefXaxbCkvQfxctMrQtBrnxrbmWYv6oyHn5ibSbTq',
  //'/ip4/213.199.53.86/tcp/9111/ws/p2p/12D3KooWEa5Fxzb7jrCMTdt4UGycyrCoM2NHLhQCYR1odRzjAx2c',
  //'/dnsaddr/share.taskyon.space/tcp/9111/ws/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/ip4/213.199.53.86/tcp/9111/ws/p2p/12D3KooWSW1HFrSd2kwPzXBvVth5NJ4s3Ydf6VQ5CugPxqZU5Fa3',
  //'/dnsaddr/share.taskyon.space/9111/ws/p2p/12D3KooWSW1HFrSd2kwPzXBvVth5NJ4s3Ydf6VQ5CugPxqZU5Fa3', //'/ip4/127.0.0.1/tcp/9111/ws',
  //'/ip4/127.0.0.1/tcp/9111/ws/p2p/12D3KooWSW1HFrSd2kwPzXBvVth5NJ4s3Ydf6VQ5CugPxqZU5Fa3',
  //'/ip4/127.0.0.1/tcp/9111/ws/p2p/12D3KooWSW1HFrSd2kwPzXBvVth5NJ4s3Ydf6VQ5CugPxqZU5Fa3',
  //'/ip4/127.0.0.1/tcp/9111/ws/p2p/12D3KooWALpzWi4e1mwFEYTGaSJPqjZLfCXohFVXadcFrsRNm95b',
]

// all libp2p debug logs
//localStorage.setItem('debug', 'libp2p:*') // then refresh the page to ensure the libraries can read this when spinning up.
// networking debug logs
//localStorage.setItem('debug', 'libp2p:websockets,libp2p:webtransport,libp2p:kad-dht,libp2p:dialer')

type P2PMessage = {
  type: 'log'
  message: unknown
  topic?: string
}

// Types
type PeerNetwork = {
  start: () => Promise<void>
  stop: () => Promise<void>
  joinSubnet?: (secret: Uint8Array) => Promise<Subnet>
  getPeerId: () => string | undefined
  port: Port<P2PMessage, P2PMessage>
}

interface libp2pNetwork extends PeerNetwork {
  connectWith: (addr: string) => Promise<unknown>
  info: () => Record<string, unknown>
  enableLogging: (enableLogging: boolean) => void
}

type Subnet = {
  publish: (msg: Uint8Array) => Promise<void>
  onMessage: (cb: (from: string, msg: Uint8Array) => void) => void
  getPeers: () => string[]
}

// TODO: add TCP/UDP port for when we run taskyon on a server!
const createNode = async () => {
  const delegatedClient = createDelegatedRoutingV1HttpApiClient('https://delegated-ipfs.dev')
  const relayListenAddrs = await getRelayListenAddrs(delegatedClient)
  log('starting libp2p with relayListenAddrs: %o', relayListenAddrs)

  return createLibp2p({
    addresses: {
      listen: [
        // 👇 Required to create circuit relay reservations in order to hole punch browser-to-browser WebRTC connections
        //'/p2p-circuit',
        // 👇 Listen for webRTC connection
        '/webrtc',
        ...relayListenAddrs,
        // '/ip4/0.0.0.0/tcp/9111/ws',
      ],
    },
    transports: [
      webSockets(),
      webTransport(),
      // 👇 Required to estalbish connections with peers supporting WebRTC-direct, e.g. the Rust-peer
      webRTCDirect(),
      /*webRTC({
        rtcConfiguration: {
          iceServers: [
            {
              urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
            },
          ],
        },
      }),*/
      webRTC(),
      circuitRelayTransport(),
    ],
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
      /*bootstrap({
        timeout: 1,
        list: bootstrapList,
      }),*/
      pubsubPeerDiscovery({
        interval: 10_000,
        topics: [PUBSUB_PEER_DISCOVERY],
        listenOnly: false,
      }),
    ],
    services: {
      pubsub: gossipsub({
        allowPublishToZeroTopicPeers: true,
        msgIdFn: msgIdFnStrictNoSign,
        ignoreDuplicatePublishError: true,
      }),
      // Delegated routing helps us discover the ephemeral multiaddrs of the dedicated go and rust bootstrap peers
      // This relies on the public delegated routing endpoint https://docs.ipfs.tech/concepts/public-utilities/#delegated-routing
      delegatedRouting: () => delegatedClient,
      identify: identify(),
      //autoNat: autoNAT(),
      directMessage: directMessage(),
      ping: ping(),
    },
  })
}

// Factory function to create a PeerNetwork
export const createPeerNetwork = async (): Promise<libp2pNetwork> => {
  //enable('ui*,libp2p*,-libp2p:connection-manager*,-*:trace')
  //enable('ui*,libp2p*')
  enable('ui*,libp2p*,-libp2p:connection-manager*,-*:trace')

  const enableLogging = (enableLogging: boolean) => {
    log('enable logging', enableLogging)
    //if (enableLogging) enable('*,*:debug')
    //else disable()
  }
  // enable logging by default..
  enableLogging(true)

  //const subnets: Record<string, Subnet> = {}
  const node: Libp2p = await createNode()
  const { x: inside, y: outside } = createDuplexChannel<P2PMessage, P2PMessage>()

  //node.addEventListener('')

  node.addEventListener(
    'peer:discovery',
    (evt) =>
      // because a void return is expected we can't use the async function directly.....
      void (async (evt) => {
        const { multiaddrs, id } = evt.detail
        // Encapsulate the peer ID to ensure dialing succeeds
        // Should be removed once https://github.com/libp2p/js-libp2p/issues/3239 is resolved.
        const maddrs = multiaddrs.map((ma) => ma.encapsulate(`/p2p/${id.toString()}`))
        if (node.getConnections(id)?.length > 0) {
          log(`Already connected to peer %s. Will not try dialling`, id)
          return
        }
        console.log(
          `Discovered new peer (${evt.detail.id.toString()}). Dialling:`,
          maddrs.map((ma) => ma.toString()),
        )

        inside.send({
          type: 'log',
          message: evt.detail,
          topic: 'peer:discovery',
        })
        await dialWebRTCMaddrs(node, multiaddrs)
      })(evt),
  )

  // libp2p list of events:
  // https://libp2p.github.io/js-libp2p/interfaces/_libp2p_interface.Libp2pEvents.html
  node.addEventListener('peer:connect', (event) =>
    inside.send({ type: 'log', message: event.detail, topic: 'peer:connect' }),
  )
  node.addEventListener('peer:disconnect', (event) =>
    inside.send({ type: 'log', message: event.detail, topic: 'peer:disconnect' }),
  )
  node.addEventListener('self:peer:update', ({ detail: { peer } }) => {
    const multiaddrs = peer.addresses.map(({ multiaddr }) => multiaddr)
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    log(`changed multiaddrs: peer ${peer.id.toString()} multiaddrs: ${multiaddrs}`)
  })

  const connectWith = async (addr: string) => {
    const maddr = multiaddr(addr)

    return await node.dial(maddr)
  }

  const start = async () => {
    await node.start()
    inside.send({ type: 'log', message: `Peer started ${getPeerId()}` })
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

  ;(node.services.pubsub as GossipSub).subscribe(CHAT_TOPIC)
  ;(node.services.pubsub as GossipSub).subscribe(CHAT_FILE_TOPIC)

  return { start, stop, getPeerId, connectWith, enableLogging, info, port: outside }
}

// message IDs are used to dedupe inbound messages
// every agent in network should use the same message id function
// messages could be perceived as duplicate if this isnt added (as opposed to rust peer which has unique message ids)
async function msgIdFnStrictNoSign(msg: Message): Promise<Uint8Array> {
  const enc = new TextEncoder()

  const signedMessage = msg as SignedMessage
  const encodedSeqNum = enc.encode(signedMessage.sequenceNumber.toString())
  return await sha256.encode(encodedSeqNum)
}

// Function which dials one maddr at a time to avoid establishing multiple connections to the same peer
async function dialWebRTCMaddrs(libp2p: Libp2p, multiaddrs: Multiaddr[]): Promise<void> {
  // Filter webrtc (browser-to-browser) multiaddrs
  const webRTCMadrs = multiaddrs.filter((maddr) => maddr.protoNames().includes('webrtc'))
  log(`dialling WebRTC multiaddrs: %o`, webRTCMadrs)

  for (const addr of webRTCMadrs) {
    try {
      log(`attempting to dial webrtc multiaddr: %o`, addr)
      await libp2p.dial(addr)
      return // if we succeed dialing the peer, no need to try another address
    } catch (error) {
      log.error(`failed to dial webrtc multiaddr: %o`, addr, error)
    }
  }
}

export const connectToMultiaddr = (libp2p: Libp2p) => async (multiaddr: Multiaddr) => {
  log(`dialling: %a`, multiaddr)
  try {
    const conn = await libp2p.dial(multiaddr)
    log('connected to %p on %a', conn.remotePeer, conn.remoteAddr)
    return conn
  } catch (e) {
    console.error(e)
    throw e
  }
}

// Function which resolves PeerIDs of rust/go bootstrap nodes to multiaddrs dialable from the browser
// Returns both the dialable multiaddrs in addition to the relay
async function getRelayListenAddrs(client: DelegatedRoutingV1HttpApiClient): Promise<string[]> {
  const peers = await Promise.all(
    BOOTSTRAP_PEER_IDS.map((peerId) => first(client.getPeers(peerIdFromString(peerId)))),
  )

  const relayListenAddrs = []
  for (const p of peers) {
    if (p && p.Addrs.length > 0) {
      for (const maddr of p.Addrs) {
        const protos = maddr.protoNames()
        // Note: narrowing to Secure WebSockets and IP4 addresses to avoid potential issues with ipv6
        // https://github.com/libp2p/js-libp2p/issues/2977
        if (protos.includes('tls') && protos.includes('ws')) {
          if (maddr.nodeAddress().address === '127.0.0.1') continue // skip loopback
          relayListenAddrs.push(getRelayListenAddr(maddr, p.ID))
        }
      }
    }
  }
  return relayListenAddrs
}

// Constructs a multiaddr string representing the circuit relay v2 listen address for a relayed connection to the given peer.
const getRelayListenAddr = (maddr: Multiaddr, peer: PeerId): string =>
  `${maddr.toString()}/p2p/${peer.toString()}/p2p-circuit`

export const getFormattedConnections = (connections: Connection[]) =>
  connections.map((conn) => ({
    peerId: conn.remotePeer,
    protocols: [...new Set(conn.remoteAddr.protoNames())],
  }))
