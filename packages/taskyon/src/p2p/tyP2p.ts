import type { Connection, Message, PeerId } from '@libp2p/interface'
import { multiaddr } from '@multiformats/multiaddr'
import * as lp from 'it-length-prefixed'
import map from 'it-map'
import { pipe } from 'it-pipe'
import { safeYamlDump } from '../utils/yamlUtils'
import { CHAT_FILE_TOPIC, FILE_EXCHANGE_PROTOCOL, PUBSUB_PEER_DISCOVERY } from './constants'
import type { libP2pNode } from './libp2p'
import { log, startLibp2p } from './libp2p'
import { getAddresses, getPeerDetails, getPeerTypes } from './p2putils'
import { createStream } from '../utils/frpBus'

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

export interface ChatMessage {
  msgId: string
  msg: string
  fileObjectUrl: string | undefined
  peerId: string
  read: boolean
  receivedAt: number
}

export interface ChatFile {
  id: string
  body: Uint8Array
  sender: string
}

export interface DirectMessages {
  [peerId: string]: ChatMessage[]
}

type p2pOptions = { chatTopic: string }

export const createNode = () => {
  let libp2pP: Promise<libP2pNode> | null = null
  let info: Partial<P2pNodeInfo> = {}
  const { emit, stream } = createStream<Partial<P2pNodeInfo>>()
  const activityStream = createStream<P2PMessage>()
  const getPeerId = async () => (await libp2pP)?.peerId.toString()

  const updateInfo = (newInfo: Partial<P2pNodeInfo>) => {
    info = { ...info, ...newInfo }
    emit(info)
  }

  let ctx = null as Awaited<ReturnType<typeof init>> | null

  const init = async (options: p2pOptions) => {
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
      updateInfo({ subscribers: n.services.pubsub.getSubscribers(options.chatTopic) })
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

    return { ...useUniversalChat(n, options.chatTopic) }
  }

  /*export const getFormattedConnections = (connections: Connection[]) =>
    connections.map((conn) => ({
      peerId: conn.remotePeer,
      protocols: [...new Set(conn.remoteAddr.protoNames())],
  }))*/

  const messageStream = createStream<ChatMessage>()

  return {
    sendPublicMessage: (input: string) => ctx?.sendPublicMessage(input),
    id: getPeerId,
    messageStream: messageStream.stream,
    start: async (options: p2pOptions) => {
      ctx = await init(options)
      ctx.messageStream.stream(messageStream.emit)
      activityStream.emit({ type: 'log', message: `Peer started ${await getPeerId()}` })
    },
    stream,
    getInfo: () => info,
    activityStream: activityStream.stream,
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

const useUniversalChat = (libp2p: libP2pNode, chatTopic: string) => {
  libp2p.services.pubsub.subscribe(chatTopic)
  libp2p.services.pubsub.subscribe(CHAT_FILE_TOPIC)

  const messageStream = createStream<ChatMessage>()
  const sendPublicMessage = async (input: string) => {
    if (input === '') return

    log(
      `peers in gossip for topic ${chatTopic}:`,
      libp2p.services.pubsub.getSubscribers(chatTopic).toString(),
    )

    const res = await libp2p.services.pubsub.publish(chatTopic, new TextEncoder().encode(input))
    log(
      'sent message to: ',
      res.recipients.map((peerId) => peerId.toString()),
    )
  }

  const messageCB = (evt: CustomEvent<Message>) => {
    // FIXME: Why does 'from' not exist on type 'Message'?
    const { topic, data } = evt.detail

    switch (topic) {
      case chatTopic: {
        chatMessageCB(evt, topic, data)
        break
      }
      case CHAT_FILE_TOPIC: {
        void chatFileMessageCB(evt, topic, data)
        break
      }
      case PUBSUB_PEER_DISCOVERY: {
        break
      }
      default: {
        console.error(`Unexpected event %o on gossipsub topic: ${topic}`, evt)
      }
    }
  }

  const chatMessageCB = (evt: CustomEvent<Message>, topic: string, data: Uint8Array) => {
    const msg = new TextDecoder().decode(data)
    log(`chat message received: ${topic}: ${msg}`)

    // Append signed messages, otherwise discard
    if (evt.detail.type === 'signed') {
      messageStream.emit({
        msgId: crypto.randomUUID(),
        msg,
        fileObjectUrl: undefined,
        peerId: evt.detail.from.toString(),
        read: false,
        receivedAt: Date.now(),
      })
    }
  }

  const chatFileMessageCB = async (evt: CustomEvent<Message>, topic: string, data: Uint8Array) => {
    const newChatFileMessage = (id: string, body: Uint8Array) => {
      return `File: ${id} (${body.length} bytes)`
    }
    const fileId = new TextDecoder().decode(data)

    // if the message isn't signed, discard it.
    if (evt.detail.type !== 'signed') {
      return
    }
    const senderPeerId = evt.detail.from

    try {
      const stream = await libp2p.dialProtocol(senderPeerId, FILE_EXCHANGE_PROTOCOL)
      await pipe(
        [new TextEncoder().encode(fileId)],
        (source) => lp.encode(source),
        stream,
        (source) => lp.decode(source),
        async function (source) {
          for await (const data of source) {
            const body: Uint8Array = data.subarray()
            log(`chat file message request_response: response received: size:${body.length}`)

            messageStream.emit({
              msgId: crypto.randomUUID(),
              msg: newChatFileMessage(fileId, body),
              fileObjectUrl: window.URL.createObjectURL(new Blob([new Uint8Array(body)])),
              peerId: senderPeerId.toString(),
              read: false,
              receivedAt: Date.now(),
            })
          }
        },
      )
    } catch (e) {
      console.error(e)
    }
  }

  // TODO: hook this up to a custom messagebus?
  libp2p.services.pubsub.addEventListener('message', messageCB)
  const files = new Map<string, ChatFile>()
  void libp2p.handle(FILE_EXCHANGE_PROTOCOL, ({ stream }) => {
    void pipe(
      stream.source,
      (source) => lp.decode(source),
      (source) =>
        map(source, (msg) => {
          const fileId = new TextDecoder().decode(msg.subarray())
          const file = files.get(fileId)!
          return file.body
        }),
      (source) => lp.encode(source),
      stream.sink,
    )
  })

  // TODO: on exit/cleanup
  /*return () => {
      ;(async () => {
        // Cleanup handlers 👇
        libp2p.services.pubsub.removeEventListener('message', messageCB)
        await libp2p.unhandle(FILE_EXCHANGE_PROTOCOL)
      })()
    }*/

  return { sendPublicMessage, messageStream }
}

let activeNode: ReturnType<typeof createNode> | null = null
export function getActiveP2pNode(): ReturnType<typeof createNode> {
  if (!activeNode) activeNode = createNode()
  return activeNode
}
