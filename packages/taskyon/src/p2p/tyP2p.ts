import {
  multiaddr,
  streamToDuplex,
  type BrowserPubsubMessage,
  type PeerId,
} from '@taskyon/p2p-core'
import * as lp from 'it-length-prefixed'
import map from 'it-map'
import { pipe } from 'it-pipe'
import {
  CHAT_FILE_TOPIC,
  CHAT_TOPIC,
  FILE_EXCHANGE_PROTOCOL,
  PUBSUB_PEER_DISCOVERY,
} from './constants'
import type { libP2pNode } from './libp2p'
import { log, startLibp2p } from './libp2p'
import { getAddresses, getPeerDetails, getPeerTypes } from './p2putils'
import { createStream } from '@taskyon/common/modules/frpBus'

export type P2pNodeInfo = {
  id: string
  peerCount: number
  peerTypes: ReturnType<typeof getPeerTypes>
  nodeAddressCount: number
  nodeAddresses: string[]
  nodePeerDetails: ReturnType<typeof getPeerDetails>
  connections: Array<{
    id: string
    remotePeer: { toString: () => string }
    remoteAddr: { toString: () => string }
  }>
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

type p2pOptions = { chatTopic: string }

export const createNode = () => {
  let libp2pP: Promise<libP2pNode> | null = null
  let startPromise: Promise<void> | null = null
  let started = false
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
    const onSelfPeerUpdate = ({
      detail: { peer },
    }: {
      detail: { peer: { id: { toString: () => string } } }
    }) => {
      activityStream.emit({ type: 'log', message: `peer updated: ${peer.id.toString()}` })
      updateInfo({ peerTypes: getPeerTypes(n), nodePeerDetails: getPeerDetails(n) })
    }
    const onPeerDiscovery = (event: { detail: { id: { toString: () => string } } }) => {
      const peer = event.detail
      activityStream.emit({ type: 'log', message: `discovered peer: ${peer.id.toString()}` })
      updateInfo({ peerCount: n.getConnections().length, peerTypes: getPeerTypes(n) })
    }

    n.addEventListener('connection:open', onConnection)
    n.addEventListener('connection:close', onConnection)
    n.addEventListener('self:peer:update', onSelfPeerUpdate)
    n.addEventListener('peer:discovery', onPeerDiscovery)
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

    const chat = useUniversalChat(n, options.chatTopic)
    const cleanup = async () => {
      n.removeEventListener('connection:open', onConnection)
      n.removeEventListener('connection:close', onConnection)
      n.removeEventListener('self:peer:update', onSelfPeerUpdate)
      n.removeEventListener('peer:discovery', onPeerDiscovery)
      n.services.pubsub.removeEventListener('subscription-change', onSubscriptionChange)
      await chat.cleanup()
    }

    return { ...chat, cleanup }
  }

  /*export const getFormattedConnections = (connections: Connection[]) =>
    connections.map((conn) => ({
      peerId: conn.remotePeer,
      protocols: [...new Set(conn.remoteAddr.protoNames())],
  }))*/

  const messageStream = createStream<ChatMessage>()
  const start = async (options: p2pOptions) => {
    if (started) return
    if (startPromise) return startPromise

    startPromise = (async () => {
      ctx = await init(options)
      ctx.messageStream.stream(messageStream.emit)
      started = true
      activityStream.emit({ type: 'log', message: `Peer started ${await getPeerId()}` })
    })()

    try {
      await startPromise
    } finally {
      startPromise = null
    }
  }

  const stop = async () => {
    if (!started && !ctx) return
    await ctx?.cleanup()
    ctx = null
    started = false
    activityStream.emit({ type: 'log', message: 'Peer chat handlers stopped' })
  }

  return {
    sendPublicMessage: (input: string) => ctx?.sendPublicMessage(input),
    id: getPeerId,
    messageStream: messageStream.stream,
    start,
    stop,
    stream,
    getInfo: () => info,
    activityStream: activityStream.stream,
    connectToPeer: async (addr: string) => {
      activityStream.emit({ type: 'log', message: `Dial requested: ${addr}` })
      let maddr
      try {
        maddr = multiaddr(addr)
      } catch (e) {
        activityStream.emit({
          type: 'log',
          message: `Invalid multiaddr: ${addr} (${e instanceof Error ? e.message : String(e)})`,
        })
        return
      }
      log(`dialling: %a`, maddr.toString())
      let connection
      try {
        if (!started) {
          activityStream.emit({
            type: 'log',
            message: `libp2p not started - starting with default topic "${CHAT_TOPIC}"`,
          })
          await (startPromise ?? Promise.resolve(start({ chatTopic: CHAT_TOPIC })))
        }
        const p2p = await libp2pP
        if (!p2p) {
          activityStream.emit({
            type: 'log',
            message: 'Cannot dial: libp2p is not started yet',
          })
          return
        }
        const normalizedTarget = maddr.toString()
        const alreadyConnected = p2p
          .getConnections()
          .some((conn) => conn.remoteAddr.toString().startsWith(normalizedTarget))
        if (alreadyConnected) {
          activityStream.emit({
            type: 'log',
            message: `Already connected: ${normalizedTarget}`,
          })
          return
        }
        connection = await p2p?.dial(maddr)
        if (connection)
          log(
            'connected to %p on %a',
            connection.remotePeer.toString(),
            connection.remoteAddr.toString(),
          )
        activityStream.emit({
          type: 'log',
          message: `Connected to peer=${connection?.remotePeer?.toString?.() ?? 'unknown'} addr=${
            connection?.remoteAddr?.toString?.() ?? 'unknown'
          }`,
        })
        updateInfo({ connections: p2p.getConnections() })
        //connection = await nw.state.value?.connectWith(addr)
      } catch (e) {
        console.error(e)
        activityStream.emit({
          type: 'log',
          message: `Connection error: ${e instanceof Error ? e.message : String(e)}`,
        })
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
      res.recipients.map((peerId: { toString: () => string }) => peerId.toString()),
    )
  }

  const messageCB = (evt: CustomEvent<BrowserPubsubMessage>) => {
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
        console.error(`Unexpected event %o on topic router topic: ${topic}`, evt)
      }
    }
  }

  const chatMessageCB = (
    evt: CustomEvent<BrowserPubsubMessage>,
    topic: string,
    data: Uint8Array,
  ) => {
    const msg = new TextDecoder().decode(data)
    log(`chat message received: ${topic}: ${msg}`)

    // Append signed messages, otherwise discard
    if (evt.detail.type === 'signed' && evt.detail.from != null) {
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

  const chatFileMessageCB = async (
    evt: CustomEvent<BrowserPubsubMessage>,
    topic: string,
    data: Uint8Array,
  ) => {
    const newChatFileMessage = (id: string, body: Uint8Array) => {
      return `File: ${id} (${body.length} bytes)`
    }
    const fileId = new TextDecoder().decode(data)

    // if the message isn't signed, discard it.
    if (evt.detail.type !== 'signed') {
      return
    }
    if (evt.detail.from == null) {
      return
    }
    const senderPeerId = evt.detail.from

    try {
      const stream = await libp2p.dialProtocol(senderPeerId, FILE_EXCHANGE_PROTOCOL)
      pipe(
        [new TextEncoder().encode(fileId)],
        (source) => lp.encode(source),
        streamToDuplex(stream),
        (source) => lp.decode(source),
        function (source) {
          for (const data of source as unknown as Iterable<{ subarray: () => Uint8Array }>) {
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

  libp2p.services.pubsub.addEventListener('message', messageCB)
  const files = new Map<string, ChatFile>()
  void libp2p.handle(FILE_EXCHANGE_PROTOCOL, (stream: unknown) => {
    const io = stream as {
      source: AsyncIterable<Uint8Array>
      sink: (source: AsyncIterable<Uint8Array>) => Promise<void>
    }
    void pipe(
      io.source,
      (source) => lp.decode(source),
      (source) =>
        map(source, (msg) => {
          const fileId = new TextDecoder().decode(msg.subarray())
          const file = files.get(fileId)!
          return file.body
        }),
      (source) => lp.encode(source),
      io.sink,
    )
  })

  let cleanedUp = false
  const cleanup = async () => {
    if (cleanedUp) return
    cleanedUp = true
    libp2p.services.pubsub.removeEventListener('message', messageCB)
    libp2p.services.pubsub.unsubscribe(chatTopic)
    libp2p.services.pubsub.unsubscribe(CHAT_FILE_TOPIC)
    await libp2p.unhandle(FILE_EXCHANGE_PROTOCOL)
  }

  return { sendPublicMessage, messageStream, cleanup }
}

let activeNode: ReturnType<typeof createNode> | null = null
export function getActiveP2pNode(): ReturnType<typeof createNode> {
  if (!activeNode) activeNode = createNode()
  return activeNode
}
