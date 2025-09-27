import type { Connection, PeerId } from '@libp2p/interface'
import { multiaddr } from '@multiformats/multiaddr'
import { createStream } from '@taskyon/taskyon'
import { safeYamlDump } from 'src/modules/yamlUtils'
import { CHAT_TOPIC } from './constants'
import { log, startLibp2p } from './libp2p'
import { getAddresses, getPeerDetails, getPeerTypes } from './p2putils'

export type P2pNodeInfo = {
  id: string
  peerCount: number
  peerTypes: ReturnType<typeof getPeerTypes>
  nodeAddressCount: number
  nodeAddresses: string[]
  nodePeerDetails: ReturnType<typeof getPeerDetails>
  connections: Connection[]
  subscribers: PeerId[]
}

export type P2PMessage = {
  type: 'log'
  message: unknown
  topic?: string
}

export const createNode = () => {
  let libp2pP: ReturnType<typeof startLibp2p> | null = null
  let info: Partial<P2pNodeInfo> = {}
  const { emit, stream } = createStream<Partial<P2pNodeInfo>>()
  const activityStream = createStream<P2PMessage>()
  const getPeerId = async () => (await libp2pP)?.peerId.toString()

  const updateInfo = (newInfo: Partial<P2pNodeInfo>) => {
    info = { ...info, ...newInfo }
    emit(info)
  }

  const init = async () => {
    libp2pP = startLibp2p()
    const n = await libp2pP
    void getPeerId().then((id) => {
      if (id) info.id = id
    })

    const syncInfo = () =>
      updateInfo({
        peerCount: n.getConnections().length,
        peerTypes: getPeerTypes(n),
        nodeAddressCount: n.getMultiaddrs().length,
        nodeAddresses: getAddresses(n),
        nodePeerDetails: getPeerDetails(n),
      })
    syncInfo()

    const onConnection = () => {
      updateInfo({ connections: n.getConnections() })
      syncInfo()
    }
    onConnection()
    const onSubscriptionChange = () => {
      updateInfo({ subscribers: n.services.pubsub.getSubscribers(CHAT_TOPIC) })
      syncInfo()
    }
    onSubscriptionChange()

    n.addEventListener('connection:open', onConnection)
    n.addEventListener('connection:close', onConnection)
    n.addEventListener('self:peer:update', ({ detail: { peer } }) => {
      activityStream.emit({ type: 'log', message: `peer updated: ${peer.id.toString()}` })
      updateInfo({ peerTypes: getPeerTypes(n), nodePeerDetails: getPeerDetails(n) })
    })
    n.addEventListener('peer:discovery', (event) => {
      const peer = event.detail
      activityStream.emit({ type: 'log', message: `discovered peer: ${peer.id.toString()}` })
      updateInfo({ peerCount: n.getConnections().length, peerTypes: getPeerTypes(n) })
    })
    n.services.pubsub.addEventListener('subscription-change', onSubscriptionChange)

    /*useEffect(() => {
    const init = async () => {
      if (await libp2p.peerStore.has(peer)) {
        const p = await libp2p.peerStore.get(peer)
        if (p.protocols.length > 0) {
          setIdentified(true)
        }
      }
    }*/
  }

  /*export const getFormattedConnections = (connections: Connection[]) =>
    connections.map((conn) => ({
      peerId: conn.remotePeer,
      protocols: [...new Set(conn.remoteAddr.protoNames())],
    }))*/

  const sendPublicMessage = async (input: string) => {
    if (!libp2pP) throw new Error('Libp2p not initialized')
    const libp2p = await libp2pP
    if (input === '') return

    log(
      `peers in gossip for topic ${CHAT_TOPIC}:`,
      libp2p.services.pubsub.getSubscribers(CHAT_TOPIC).toString(),
    )

    const res = await libp2p.services.pubsub.publish(CHAT_TOPIC, new TextEncoder().encode(input))
    log(
      'sent message to: ',
      res.recipients.map((peerId) => peerId.toString()),
    )
  }

  return {
    init,
    id: getPeerId,
    start: async () => {
      await init()
      activityStream.emit({ type: 'log', message: `Peer started ${await getPeerId()}` })
    },
    stream,
    getInfo: () => info,
    activityStream: activityStream.stream,
    sendPublicMessage,
    connectToPeer: async (addr: string) => {
      const maddr = multiaddr(addr)
      log(`dialling: %a`, multiaddr.toString())
      // Implement peer connection logic
      let connection
      try {
        const p2p = await libp2pP
        if (!p2p) return
        connection = await p2p?.dial(maddr)
        if (connection)
          log(
            'connected to %p on %a',
            connection.remotePeer.toString(),
            connection.remoteAddr.toString(),
          )
        activityStream.emit({
          type: 'log',
          message: `Connected to: ${safeYamlDump(connection)}`,
          topic: CHAT_TOPIC,
        })
        updateInfo({ connections: p2p.getConnections() })
        //connection = await nw.state.value?.connectWith(addr)
      } catch (e) {
        console.error(e)
        connection = 'error on connection'
      }
    },
  }
}

let activeNode: ReturnType<typeof createNode> | null = null
export function getActiveP2pNode(): ReturnType<typeof createNode> {
  if (!activeNode) activeNode = createNode()
  return activeNode
}
