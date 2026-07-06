import type { Libp2p } from 'libp2p'
import { multiaddr } from '@multiformats/multiaddr'
import {
  enableVerboseBrowserLibp2pLogs,
  ensureRelayReservation,
  setBrowserLibp2pLogNamespaces,
  startBrowserLibp2p,
} from './browser'
import type { BrowserLibp2pNode } from './browser'
import {
  PRIMARY_RELAY_WS_MULTIADDR,
  PUBSUB_PEER_DISCOVERY,
  SUBNETWORK_PEER_DISCOVERY_EVENT,
} from './constants'
import { deriveDiscoveryTokens, deriveSubnetworkMessageTopic } from './discovery'
import { createStream, type Stream, type Unsubscribe } from '@taskyon/common/modules/frpBus'
import {
  headlessBrowserDiscoveryTestNetwork,
  p2pTestNetworks,
  type P2pTestNetworkFixture,
} from './testNetworks'
import {
  Circuit,
  WebRTC,
  WebRTCDirect,
  WebSockets,
  WebSocketsSecure,
  WebTransport,
} from '@multiformats/multiaddr-matcher'

export type ManagedSubnetwork = {
  id: string
  name: string
  secret: string
  relayAddrs: string[]
  discoveryTokens: string[]
  messageTopic: string
}

export type DiscoveredPeer = {
  id: string
  multiaddrs: string[]
  discoveredAt: string
  matchedToken?: string
}

export type NeighborHealth = {
  peerId: string
  isRelay: boolean
  status: 'online' | 'degraded' | 'offline'
  connectionIds: string[]
  remoteAddrs: string[]
  lastSeenAt: string
  lastPingAt?: string
  lastRttMs?: number
  consecutiveFailures: number
}

export type P2pChatMessage = {
  id: string
  subnetworkId: string
  topic: string
  senderPeerId: string
  body: string
  createdAt: string
}

export type P2pManagerState = {
  busy: boolean
  errorMessage: string
  logs: string
  verboseLogsEnabled: boolean
  nodeId: string
  nodeAddresses: string[]
  peerTypes: Record<string, number>
  peerDetails: Array<{ nodeType: string[]; peerConnections: string[] }>
  connections: Array<{
    id?: string
    remotePeer: string
    remoteAddr: string
  }>
  subscribers: string[]
  discoveredPeers: DiscoveredPeer[]
  neighborHealth: NeighborHealth[]
  activeSubnetworkId: string
  manualDialAddr: string
  subnetworks: ManagedSubnetwork[]
  fixtureNetwork: P2pTestNetworkFixture
  availableTestNetworks: P2pTestNetworkFixture[]
  actions: string[]
}

export type P2pManagerEvent =
  | { type: 'log'; message: string }
  | { type: 'error'; message: string }
  | { type: 'peerDiscovered'; peer: DiscoveredPeer }
  | { type: 'chatMessage'; message: P2pChatMessage }
  | { type: 'stateChanged'; state: P2pManagerState }

export type P2pManagerRuntime = {
  busy: boolean
  errorMessage: string
  activeSubnetworkId: string
  activeSubnetworkName: string
  globalDiscoveryTopic: string
  nodeActive: boolean
}

export type P2pManagerSnapshot = {
  nodeId: string
  nodeAddresses: string[]
  peerTypes: Record<string, number>
  peerDetails: Array<{ nodeType: string[]; peerConnections: string[] }>
  connections: Array<{
    id?: string
    remotePeer: string
    remoteAddr: string
  }>
  subscribers: string[]
  discoveredPeers: DiscoveredPeer[]
  neighborHealth: NeighborHealth[]
  relayAddresses: string[]
  subnetworkTokens: string[]
  logs: string
  runtime: P2pManagerRuntime
  state: P2pManagerState
}

export type P2pManager = {
  getState: () => P2pManagerState
  getSnapshot: () => P2pManagerSnapshot
  stateStream: Stream<P2pManagerSnapshot>
  eventStream: Stream<P2pManagerEvent>
  addSubnetwork: (input?: Partial<ManagedSubnetwork>) => Promise<ManagedSubnetwork>
  updateSubnetwork: (
    id: string,
    patch: Partial<Pick<ManagedSubnetwork, 'name' | 'secret' | 'relayAddrs'>>,
  ) => Promise<void>
  removeSubnetwork: (id: string) => void
  setActiveSubnetwork: (id: string) => void
  joinFixtureNetwork: (fixture?: P2pTestNetworkFixture) => Promise<ManagedSubnetwork>
  start: () => Promise<void>
  restart: () => Promise<void>
  stop: () => Promise<void>
  dialAddress: (addr: string) => Promise<void>
  dialCurrentRelay: () => Promise<void>
  sendChatMessage: (body: string, subnetworkId?: string) => Promise<void>
  setManualDialAddr: (addr: string) => void
  clearLogs: () => void
  setVerboseLogsEnabled: (enabled: boolean) => void
}

export type CreateP2pManagerOptions = {
  startNode?: (opts: { subnetworkSecrets: string[] }) => Promise<BrowserLibp2pNode>
}

const DEFAULT_BROWSER_LOG_NAMESPACES = 'p2p-core:*,libp2p:*,-libp2p:connection-manager:*,-*:trace'
const DISCOVERED_PEER_TTL_MS = 20_000
const NEIGHBOR_PING_INTERVAL_MS = 5_000
const NEIGHBOR_OFFLINE_TTL_MS = 60_000

function getAddresses(libp2p: Libp2p) {
  return libp2p.getMultiaddrs().map((ma) => ma.toString())
}

function getPeerTypes(libp2p: Libp2p) {
  const types = {
    'Circuit Relay': 0,
    WebRTC: 0,
    'WebRTC Direct': 0,
    WebSockets: 0,
    'WebSockets (secure)': 0,
    WebTransport: 0,
    Other: 0,
  }

  libp2p
    .getConnections()
    .map((conn) => conn.remoteAddr)
    .forEach((ma) => {
      const maCompat = ma as unknown as Parameters<typeof WebRTC.exactMatch>[0]
      if (WebRTC.exactMatch(maCompat)) types.WebRTC += 1
      else if (WebRTCDirect.exactMatch(maCompat)) types['WebRTC Direct'] += 1
      else if (WebSockets.exactMatch(maCompat)) types.WebSockets += 1
      else if (WebSocketsSecure.exactMatch(maCompat)) types['WebSockets (secure)'] += 1
      else if (WebTransport.exactMatch(maCompat)) types.WebTransport += 1
      else if (Circuit.exactMatch(maCompat)) types['Circuit Relay'] += 1
      else types.Other += 1
    })

  return types
}

function getPeerDetails(libp2p: Libp2p) {
  return libp2p.getPeers().map((peer) => {
    const peerConnections = libp2p.getConnections(peer)

    const nodeType: string[] = []
    const relayMultiaddrs = libp2p
      .getMultiaddrs()
      .filter((ma) => Circuit.exactMatch(ma as unknown as Parameters<typeof Circuit.exactMatch>[0]))
    const relayPeers = relayMultiaddrs
      .map((ma) =>
        ma
          .getComponents()
          .filter(({ name }) => name === 'p2p')
          .map(({ value }) => value),
      )
      .flat()

    if (relayPeers.includes(peer.toString())) {
      nodeType.push('relay')
    }

    return {
      nodeType,
      peerConnections: peerConnections.map((conn) => conn.remoteAddr.toString()),
    }
  })
}

function getRelayPeerIds(libp2p: Libp2p) {
  return new Set(
    libp2p
      .getMultiaddrs()
      .filter((ma) => Circuit.exactMatch(ma as unknown as Parameters<typeof Circuit.exactMatch>[0]))
      .flatMap((ma) =>
        ma
          .getComponents()
          .filter(({ name }) => name === 'p2p')
          .map(({ value }) => String(value)),
      ),
  )
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function makeSubnetwork(input?: Partial<ManagedSubnetwork>): ManagedSubnetwork {
  return {
    id: input?.id ?? crypto.randomUUID(),
    name: input?.name ?? 'Unnamed Network',
    secret: input?.secret ?? '',
    relayAddrs: input?.relayAddrs ?? [PRIMARY_RELAY_WS_MULTIADDR],
    discoveryTokens: input?.discoveryTokens ?? [],
    messageTopic: input?.messageTopic ?? '',
  }
}

function formatLogLine(message: string) {
  return `[${new Date().toISOString()}] ${message}`
}

function encodeChatMessage(message: P2pChatMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(message))
}

function parseChatMessage(data: Uint8Array): P2pChatMessage | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data)) as Partial<P2pChatMessage>
    if (
      typeof parsed?.id !== 'string' ||
      typeof parsed?.subnetworkId !== 'string' ||
      typeof parsed?.topic !== 'string' ||
      typeof parsed?.senderPeerId !== 'string' ||
      typeof parsed?.body !== 'string' ||
      typeof parsed?.createdAt !== 'string'
    ) {
      return null
    }
    return parsed as P2pChatMessage
  } catch {
    return null
  }
}

export function createP2pManager(options: CreateP2pManagerOptions = {}): P2pManager {
  const startNode =
    options.startNode ??
    (async ({ subnetworkSecrets }: { subnetworkSecrets: string[] }) =>
      await startBrowserLibp2p({ subnetworkSecrets }))

  const stateUpdates = createStream<P2pManagerSnapshot>()
  const events = createStream<P2pManagerEvent>()
  let node: BrowserLibp2pNode | null = null
  let cleanupFns: Unsubscribe[] = []
  let pingInterval: ReturnType<typeof setInterval> | null = null
  let pruneInterval: ReturnType<typeof setInterval> | null = null

  const state: P2pManagerState = {
    busy: false,
    errorMessage: '',
    logs: '',
    verboseLogsEnabled: false,
    nodeId: '',
    nodeAddresses: [],
    peerTypes: {},
    peerDetails: [],
    connections: [],
    subscribers: [],
    discoveredPeers: [],
    neighborHealth: [],
    activeSubnetworkId: headlessBrowserDiscoveryTestNetwork.id,
    manualDialAddr: PRIMARY_RELAY_WS_MULTIADDR,
    subnetworks: [
      makeSubnetwork({
        id: headlessBrowserDiscoveryTestNetwork.id,
        name: headlessBrowserDiscoveryTestNetwork.name,
        secret: headlessBrowserDiscoveryTestNetwork.subnetworkSecret,
        relayAddrs: [...headlessBrowserDiscoveryTestNetwork.relayAddrs],
        messageTopic: '',
      }),
    ],
    fixtureNetwork: headlessBrowserDiscoveryTestNetwork,
    availableTestNetworks: p2pTestNetworks,
    actions: [
      'addSubnetwork',
      'updateSubnetwork',
      'removeSubnetwork',
      'setActiveSubnetwork',
      'joinFixtureNetwork',
      'start',
      'restart',
      'stop',
      'dialAddress',
      'dialCurrentRelay',
      'sendChatMessage',
      'setManualDialAddr',
      'setVerboseLogsEnabled',
      'clearLogs',
    ],
  }

  const activeSubnetwork = () =>
    state.subnetworks.find((network) => network.id === state.activeSubnetworkId) ?? null

  const getState = () => clone(state)

  const getSnapshot = (): P2pManagerSnapshot => ({
    nodeId: state.nodeId,
    nodeAddresses: [...state.nodeAddresses],
    peerTypes: clone(state.peerTypes),
    peerDetails: clone(state.peerDetails),
    connections: clone(state.connections),
    subscribers: [...state.subscribers],
    discoveredPeers: clone(state.discoveredPeers),
    neighborHealth: clone(state.neighborHealth),
    relayAddresses: [...(activeSubnetwork()?.relayAddrs ?? [])],
    subnetworkTokens: [...(activeSubnetwork()?.discoveryTokens ?? [])],
    logs: state.logs,
    runtime: {
      busy: state.busy,
      errorMessage: state.errorMessage,
      activeSubnetworkId: state.activeSubnetworkId,
      activeSubnetworkName: activeSubnetwork()?.name ?? '',
      globalDiscoveryTopic: PUBSUB_PEER_DISCOVERY,
      nodeActive: !!node,
    },
    state: getState(),
  })

  const emitState = () => {
    const snapshot = getSnapshot()
    stateUpdates.emit(snapshot)
    events.emit({ type: 'stateChanged', state: snapshot.state })
  }

  const emitError = (message: string) => {
    state.errorMessage = message
    events.emit({ type: 'error', message })
    appendLog(`error: ${message}`)
  }

  const appendLog = (message: string) => {
    const line = formatLogLine(message)
    state.logs = state.logs ? `${state.logs}\n${line}` : line
    events.emit({ type: 'log', message: line })
    emitState()
  }

  const nowIso = () => new Date().toISOString()

  const upsertNeighbor = (
    peerId: string,
    patch: Partial<NeighborHealth> & Pick<NeighborHealth, 'peerId' | 'isRelay' | 'lastSeenAt'>,
  ) => {
    const existingIndex = state.neighborHealth.findIndex((entry) => entry.peerId === peerId)
    const next: NeighborHealth = {
      peerId,
      isRelay: patch.isRelay,
      status: patch.status ?? 'online',
      connectionIds: patch.connectionIds ?? [],
      remoteAddrs: patch.remoteAddrs ?? [],
      lastSeenAt: patch.lastSeenAt,
      consecutiveFailures: patch.consecutiveFailures ?? 0,
      ...(patch.lastPingAt ? { lastPingAt: patch.lastPingAt } : {}),
      ...(patch.lastRttMs !== undefined ? { lastRttMs: patch.lastRttMs } : {}),
    }

    if (existingIndex >= 0) {
      const previous = state.neighborHealth[existingIndex]
      state.neighborHealth.splice(existingIndex, 1, {
        ...previous,
        ...next,
        connectionIds: patch.connectionIds ?? previous?.connectionIds ?? [],
        remoteAddrs: patch.remoteAddrs ?? previous?.remoteAddrs ?? [],
        lastSeenAt: patch.lastSeenAt ?? previous?.lastSeenAt ?? next.lastSeenAt,
        isRelay: patch.isRelay ?? previous?.isRelay ?? next.isRelay,
      })
      return
    }

    state.neighborHealth.unshift(next)
  }

  const syncNeighborHealthFromConnections = () => {
    if (!node) {
      state.neighborHealth = []
      return
    }

    const relayPeerIds = getRelayPeerIds(node)
    const connectionsByPeer = new Map<
      string,
      {
        peerId: string
        isRelay: boolean
        connectionIds: string[]
        remoteAddrs: string[]
      }
    >()

    for (const connection of node.getConnections()) {
      const peerId = connection.remotePeer.toString()
      const existing = connectionsByPeer.get(peerId) ?? {
        peerId,
        isRelay: relayPeerIds.has(peerId),
        connectionIds: [],
        remoteAddrs: [],
      }
      if (connection.id) existing.connectionIds.push(connection.id)
      existing.remoteAddrs.push(connection.remoteAddr.toString())
      connectionsByPeer.set(peerId, existing)
    }

    const seenAt = nowIso()
    for (const [peerId, entry] of connectionsByPeer.entries()) {
      const previous = state.neighborHealth.find((item) => item.peerId === peerId)
      upsertNeighbor(peerId, {
        peerId,
        isRelay: entry.isRelay,
        status: previous?.status === 'degraded' ? 'degraded' : 'online',
        connectionIds: [...new Set(entry.connectionIds)],
        remoteAddrs: [...new Set(entry.remoteAddrs)],
        lastSeenAt: seenAt,
        consecutiveFailures: previous?.consecutiveFailures ?? 0,
        ...(previous?.lastPingAt ? { lastPingAt: previous.lastPingAt } : {}),
        ...(previous?.lastRttMs !== undefined ? { lastRttMs: previous.lastRttMs } : {}),
      })
    }

    for (const neighbor of state.neighborHealth) {
      if (connectionsByPeer.has(neighbor.peerId)) continue
      neighbor.status = 'offline'
      neighbor.connectionIds = []
      neighbor.remoteAddrs = []
    }
  }

  const pruneStaleState = () => {
    const now = Date.now()
    const previousDiscoveredCount = state.discoveredPeers.length
    const previousNeighborCount = state.neighborHealth.length
    state.discoveredPeers = state.discoveredPeers.filter((peer) => {
      return now - new Date(peer.discoveredAt).getTime() <= DISCOVERED_PEER_TTL_MS
    })
    state.neighborHealth = state.neighborHealth.filter((neighbor) => {
      if (neighbor.status !== 'offline') return true
      return now - new Date(neighbor.lastSeenAt).getTime() <= NEIGHBOR_OFFLINE_TTL_MS
    })
    if (
      state.discoveredPeers.length !== previousDiscoveredCount ||
      state.neighborHealth.length !== previousNeighborCount
    ) {
      emitState()
    }
  }

  const pingImmediateNeighbors = async () => {
    if (!node) return

    const uniquePeers = new Map(
      node
        .getConnections()
        .map((connection) => [connection.remotePeer.toString(), connection.remotePeer]),
    )

    for (const [peerId, remotePeer] of uniquePeers.entries()) {
      try {
        const rttMs = await node.services.ping.ping(remotePeer, {
          signal: AbortSignal.timeout(4_000),
        })
        const previous = state.neighborHealth.find((entry) => entry.peerId === peerId)
        upsertNeighbor(peerId, {
          peerId,
          isRelay: previous?.isRelay ?? false,
          status: 'online',
          lastSeenAt: nowIso(),
          lastPingAt: nowIso(),
          lastRttMs: rttMs,
          consecutiveFailures: 0,
          connectionIds: previous?.connectionIds ?? [],
          remoteAddrs: previous?.remoteAddrs ?? [],
        })
      } catch {
        const previous = state.neighborHealth.find((entry) => entry.peerId === peerId)
        upsertNeighbor(peerId, {
          peerId,
          isRelay: previous?.isRelay ?? false,
          status: 'degraded',
          lastSeenAt: previous?.lastSeenAt ?? nowIso(),
          ...(previous?.lastPingAt ? { lastPingAt: previous.lastPingAt } : {}),
          ...(previous?.lastRttMs !== undefined ? { lastRttMs: previous.lastRttMs } : {}),
          consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
          connectionIds: previous?.connectionIds ?? [],
          remoteAddrs: previous?.remoteAddrs ?? [],
        })
      }
    }

    emitState()
  }

  const stopMaintenanceLoops = () => {
    if (pingInterval != null) clearInterval(pingInterval)
    if (pruneInterval != null) clearInterval(pruneInterval)
    pingInterval = null
    pruneInterval = null
  }

  const startMaintenanceLoops = () => {
    stopMaintenanceLoops()
    pingInterval = setInterval(() => {
      void pingImmediateNeighbors()
    }, NEIGHBOR_PING_INTERVAL_MS)
    pruneInterval = setInterval(() => {
      pruneStaleState()
    }, 5_000)
  }

  const applyLibp2pLoggingMode = (verbose: boolean) => {
    const namespaces = verbose
      ? enableVerboseBrowserLibp2pLogs({ persist: false })
      : setBrowserLibp2pLogNamespaces(DEFAULT_BROWSER_LOG_NAMESPACES, { persist: false })
    appendLog(`libp2p logger namespaces set: ${namespaces}`)
  }

  const refreshNodeInfo = () => {
    if (!node) {
      state.nodeId = ''
      state.nodeAddresses = []
      state.peerTypes = {}
      state.peerDetails = []
      state.connections = []
      state.subscribers = []
      emitState()
      return
    }

    state.nodeId = node.peerId.toString()
    state.nodeAddresses = getAddresses(node)
    state.peerTypes = getPeerTypes(node)
    state.peerDetails = getPeerDetails(node)
    state.connections = node.getConnections().map((connection) => ({
      id: connection.id,
      remotePeer: connection.remotePeer.toString(),
      remoteAddr: connection.remoteAddr.toString(),
    }))
    state.subscribers = node.services.pubsub
      .getSubscribers(PUBSUB_PEER_DISCOVERY)
      .map((peerId) => peerId.toString())
    syncNeighborHealthFromConnections()
    emitState()
  }

  const addOrUpdateDiscoveredPeer = (detail: {
    id: string
    matchedToken?: string
    multiaddrs?: Array<{ toString: () => string }>
  }) => {
    const nextPeer: DiscoveredPeer = {
      id: detail.id,
      multiaddrs: (detail.multiaddrs ?? []).map((addr) => addr.toString()),
      discoveredAt: new Date().toISOString(),
      ...(detail.matchedToken ? { matchedToken: detail.matchedToken } : {}),
    }
    const existingIndex = state.discoveredPeers.findIndex((peer) => peer.id === detail.id)
    if (existingIndex >= 0) state.discoveredPeers.splice(existingIndex, 1, nextPeer)
    else state.discoveredPeers.unshift(nextPeer)
    events.emit({ type: 'peerDiscovered', peer: clone(nextPeer) })
    emitState()
  }

  const teardownListeners = () => {
    cleanupFns.forEach((cleanup) => cleanup())
    cleanupFns = []
  }

  const attachNodeListeners = (libp2pNode: BrowserLibp2pNode) => {
    const onConnectionOpen = () => refreshNodeInfo()
    const onConnectionClose = () => refreshNodeInfo()
    const onSelfPeerUpdate = () => refreshNodeInfo()
    const onSubscriptionChange = () => refreshNodeInfo()
    const onPeerDiscovery = (
      event: Event & {
        detail?: {
          id: string
          matchedToken?: string
          multiaddrs?: Array<{ toString: () => string }>
        }
      },
    ) => {
      if (!event.detail || typeof event.detail.id !== 'string') return
      addOrUpdateDiscoveredPeer(event.detail)
      appendLog(`discovered matching peer ${event.detail.id}`)
    }
    const onPubsubMessage = (
      event: Event & {
        detail?: {
          topic?: string
          data?: Uint8Array
        }
      },
    ) => {
      const currentNetwork = activeSubnetwork()
      if (
        !currentNetwork?.messageTopic ||
        event.detail?.topic !== currentNetwork.messageTopic ||
        !(event.detail?.data instanceof Uint8Array)
      ) {
        return
      }

      const message = parseChatMessage(event.detail.data)
      if (!message) return
      events.emit({ type: 'chatMessage', message })
    }

    libp2pNode.addEventListener('connection:open', onConnectionOpen as EventListener)
    libp2pNode.addEventListener('connection:close', onConnectionClose as EventListener)
    libp2pNode.addEventListener('self:peer:update', onSelfPeerUpdate as EventListener)
    ;(libp2pNode as unknown as EventTarget).addEventListener(
      SUBNETWORK_PEER_DISCOVERY_EVENT,
      onPeerDiscovery as EventListener,
    )
    libp2pNode.services.pubsub.addEventListener('subscription-change', onSubscriptionChange)
    libp2pNode.services.pubsub.addEventListener('message', onPubsubMessage as EventListener)

    cleanupFns.push(() =>
      libp2pNode.removeEventListener('connection:open', onConnectionOpen as EventListener),
    )
    cleanupFns.push(() =>
      libp2pNode.removeEventListener('connection:close', onConnectionClose as EventListener),
    )
    cleanupFns.push(() =>
      libp2pNode.removeEventListener('self:peer:update', onSelfPeerUpdate as EventListener),
    )
    cleanupFns.push(() =>
      (libp2pNode as unknown as EventTarget).removeEventListener(
        SUBNETWORK_PEER_DISCOVERY_EVENT,
        onPeerDiscovery as EventListener,
      ),
    )
    cleanupFns.push(() =>
      libp2pNode.services.pubsub.removeEventListener('subscription-change', onSubscriptionChange),
    )
    cleanupFns.push(() =>
      libp2pNode.services.pubsub.removeEventListener('message', onPubsubMessage as EventListener),
    )
  }

  const syncSubnetworkTokens = async () => {
    for (const network of state.subnetworks) {
      network.discoveryTokens = await deriveDiscoveryTokens(network.secret ? [network.secret] : [])
      network.messageTopic = network.secret
        ? await deriveSubnetworkMessageTopic(network.secret)
        : ''
    }
    emitState()
  }

  const stop = async () => {
    if (!node) return
    stopMaintenanceLoops()
    teardownListeners()
    const current = node
    node = null
    await current.stop()
    state.discoveredPeers = []
    refreshNodeInfo()
    appendLog('stopped discovery node')
  }

  const start = async () => {
    const network = activeSubnetwork()
    if (!network || state.busy) return
    state.busy = true
    state.errorMessage = ''
    emitState()
    try {
      await syncSubnetworkTokens()
      await stop()
      state.discoveredPeers = []
      state.neighborHealth = []
      appendLog(`starting discovery for subnetwork "${network.name}"`)
      node = await startNode({ subnetworkSecrets: network.secret ? [network.secret] : [] })
      attachNodeListeners(node)
      startMaintenanceLoops()
      if (network.messageTopic) {
        node.services.pubsub.subscribe(network.messageTopic)
      }
      refreshNodeInfo()

      for (const relayAddr of network.relayAddrs) {
        if (!relayAddr.trim()) continue
        appendLog(`dialing relay ${relayAddr}`)
        const conn = await node.dial(multiaddr(relayAddr))
        await ensureRelayReservation(node, multiaddr(conn.remoteAddr.toString()))
      }
      refreshNodeInfo()
    } catch (error) {
      emitError(error instanceof Error ? error.message : String(error))
    } finally {
      state.busy = false
      emitState()
    }
  }

  const restart = async () => {
    await start()
  }

  const dialAddress = async (addr: string) => {
    if (!node || !addr.trim()) return
    appendLog(`manual dial ${addr}`)
    const conn = await node.dial(multiaddr(addr))
    await ensureRelayReservation(node, multiaddr(conn.remoteAddr.toString()))
    refreshNodeInfo()
  }

  const dialCurrentRelay = async () => {
    const relayAddr = activeSubnetwork()?.relayAddrs[0] ?? ''
    await dialAddress(relayAddr)
  }

  const sendChatMessage = async (body: string, subnetworkId?: string) => {
    if (!node) return
    const network =
      state.subnetworks.find((entry) => entry.id === (subnetworkId ?? state.activeSubnetworkId)) ??
      null
    if (!network?.messageTopic || !body.trim()) return

    const message: P2pChatMessage = {
      id: crypto.randomUUID(),
      subnetworkId: network.id,
      topic: network.messageTopic,
      senderPeerId: node.peerId.toString(),
      body: body.trim(),
      createdAt: nowIso(),
    }

    await node.services.pubsub.publish(network.messageTopic, encodeChatMessage(message))
  }

  const setManualDialAddr = (addr: string) => {
    state.manualDialAddr = addr
    emitState()
  }

  const setActiveSubnetwork = (id: string) => {
    state.activeSubnetworkId = id
    const network = activeSubnetwork()
    if (network?.relayAddrs[0]) state.manualDialAddr = network.relayAddrs[0]
    emitState()
  }

  const addSubnetwork = async (input?: Partial<ManagedSubnetwork>) => {
    const network = makeSubnetwork(input)
    network.discoveryTokens = await deriveDiscoveryTokens(network.secret ? [network.secret] : [])
    state.subnetworks.push(network)
    setActiveSubnetwork(network.id)
    emitState()
    return clone(network)
  }

  const updateSubnetwork = async (
    id: string,
    patch: Partial<Pick<ManagedSubnetwork, 'name' | 'secret' | 'relayAddrs'>>,
  ) => {
    const network = state.subnetworks.find((entry) => entry.id === id)
    if (!network) return
    if (patch.name !== undefined) network.name = patch.name
    if (patch.secret !== undefined) network.secret = patch.secret
    if (patch.relayAddrs !== undefined) network.relayAddrs = [...patch.relayAddrs]
    network.discoveryTokens = await deriveDiscoveryTokens(network.secret ? [network.secret] : [])
    network.messageTopic = network.secret ? await deriveSubnetworkMessageTopic(network.secret) : ''
    emitState()
  }

  const removeSubnetwork = (id: string) => {
    const next = state.subnetworks.filter((network) => network.id !== id)
    state.subnetworks = next
    if (!next.find((network) => network.id === state.activeSubnetworkId)) {
      state.activeSubnetworkId = next[0]?.id ?? ''
    }
    emitState()
  }

  const joinFixtureNetwork = async (
    fixture: P2pTestNetworkFixture = headlessBrowserDiscoveryTestNetwork,
  ) => {
    const existing = state.subnetworks.find((network) => network.id === fixture.id)
    if (existing) {
      await updateSubnetwork(existing.id, {
        name: fixture.name,
        secret: fixture.subnetworkSecret,
        relayAddrs: [...fixture.relayAddrs],
      })
      setActiveSubnetwork(existing.id)
      return clone(existing)
    }
    return await addSubnetwork({
      id: fixture.id,
      name: fixture.name,
      secret: fixture.subnetworkSecret,
      relayAddrs: [...fixture.relayAddrs],
    })
  }

  const clearLogs = () => {
    state.logs = ''
    emitState()
  }

  const setVerboseLogsEnabled = (enabled: boolean) => {
    state.verboseLogsEnabled = enabled
    emitState()
    applyLibp2pLoggingMode(enabled)
  }

  void syncSubnetworkTokens()
  applyLibp2pLoggingMode(state.verboseLogsEnabled)
  emitState()

  return {
    getState,
    getSnapshot,
    stateStream: stateUpdates.stream,
    eventStream: events.stream,
    addSubnetwork,
    updateSubnetwork,
    removeSubnetwork,
    setActiveSubnetwork,
    joinFixtureNetwork,
    start,
    restart,
    stop,
    dialAddress,
    dialCurrentRelay,
    sendChatMessage,
    setManualDialAddr,
    clearLogs,
    setVerboseLogsEnabled,
  }
}
