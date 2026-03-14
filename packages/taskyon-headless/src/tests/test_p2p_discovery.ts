import { startNodeLibp2p } from '../../../p2p-core/src/node'
import { startRelayLibp2p } from '../../../p2p-core/src/relay'
import { SUBNETWORK_PEER_DISCOVERY_EVENT } from '../../../p2p-core/src/constants'
import { deriveDiscoveryTokens } from '../../../p2p-core/src/discovery'
import { headlessBrowserDiscoveryTestNetwork } from '../../../p2p-core/src/testNetworks'

function waitForPeerDiscovery(
  node: EventTarget,
  targetPeerId: string,
  timeoutMs: number,
): Promise<{ id: string; multiaddrs: string[]; matchedToken?: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      node.removeEventListener(SUBNETWORK_PEER_DISCOVERY_EVENT, onDiscovery as EventListener)
      reject(new Error(`Timed out waiting for peer discovery: ${targetPeerId}`))
    }, timeoutMs)

    const onDiscovery = (
      event: Event & {
        detail?: {
          id?: string
          multiaddrs?: Array<{ toString: () => string }>
          matchedToken?: string
        }
      },
    ) => {
      if (event.detail?.id !== targetPeerId) {
        return
      }

      clearTimeout(timer)
      node.removeEventListener(SUBNETWORK_PEER_DISCOVERY_EVENT, onDiscovery as EventListener)
      const resolved = {
        id: targetPeerId,
        multiaddrs: (event.detail?.multiaddrs ?? []).map((addr) => addr.toString()),
        ...(event.detail?.matchedToken ? { matchedToken: event.detail.matchedToken } : {}),
      }
      resolve(resolved)
    }

    node.addEventListener(SUBNETWORK_PEER_DISCOVERY_EVENT, onDiscovery as EventListener)
  })
}

function assertNoPeerDiscovery(node: EventTarget, forbiddenPeerIds: string[], windowMs: number) {
  return new Promise<{ ok: true; windowMs: number }>((resolve, reject) => {
    const forbidden = new Set(forbiddenPeerIds)
    const timer = setTimeout(() => {
      node.removeEventListener(SUBNETWORK_PEER_DISCOVERY_EVENT, onDiscovery as EventListener)
      resolve({ ok: true, windowMs })
    }, windowMs)

    const onDiscovery = (
      event: Event & {
        detail?: { id?: string }
      },
    ) => {
      if (!event.detail?.id || !forbidden.has(event.detail.id)) {
        return
      }

      clearTimeout(timer)
      node.removeEventListener(SUBNETWORK_PEER_DISCOVERY_EVENT, onDiscovery as EventListener)
      reject(new Error(`Unexpected peer discovery for non-matching peer: ${event.detail.id}`))
    }

    node.addEventListener(SUBNETWORK_PEER_DISCOVERY_EVENT, onDiscovery as EventListener)
  })
}

export const testNodeDiscoveryThroughLocalRelay = async () => {
  const relay = await startRelayLibp2p({
    logName: 'headless-discovery-relay',
    listenAddrs: ['/ip4/127.0.0.1/tcp/0/ws'],
    autoNatPollMs: 60_000,
  })

  const relayAddr = relay
    .getMultiaddrs()
    .map((addr) => addr.toString())
    .find((addr) => addr.includes('/ws'))

  if (!relayAddr) {
    await relay.stop()
    throw new Error('Relay did not expose a websocket multiaddr for the discovery test')
  }

  const clientA = await startNodeLibp2p({
    relayAddrs: [relayAddr],
    discoveryAnnouncementIntervalMs: 500,
    subnetworkSecrets: ['shared-subnetwork-secret'],
  })
  const clientB = await startNodeLibp2p({
    relayAddrs: [relayAddr],
    discoveryAnnouncementIntervalMs: 500,
    subnetworkSecrets: ['shared-subnetwork-secret'],
  })
  const clientC = await startNodeLibp2p({
    relayAddrs: [relayAddr],
    discoveryAnnouncementIntervalMs: 500,
    subnetworkSecrets: ['different-subnetwork-secret'],
  })

  try {
    const peerA = clientA.peerId.toString()
    const peerB = clientB.peerId.toString()
    const peerC = clientC.peerId.toString()

    const [seenByA, seenByB, hiddenFromA, hiddenFromB, hiddenFromC] = await Promise.all([
      waitForPeerDiscovery(clientA as unknown as EventTarget, peerB, 10_000),
      waitForPeerDiscovery(clientB as unknown as EventTarget, peerA, 10_000),
      assertNoPeerDiscovery(clientA as unknown as EventTarget, [peerC], 2_500),
      assertNoPeerDiscovery(clientB as unknown as EventTarget, [peerC], 2_500),
      assertNoPeerDiscovery(clientC as unknown as EventTarget, [peerA, peerB], 2_500),
    ])

    return {
      relayAddr,
      peerA,
      peerB,
      peerC,
      seenByA,
      seenByB,
      hiddenFromA,
      hiddenFromB,
      hiddenFromC,
    }
  } finally {
    await Promise.allSettled([clientA.stop(), clientB.stop(), clientC.stop(), relay.stop()])
  }
}

testNodeDiscoveryThroughLocalRelay.timeoutMs = 20_000

export const testSharedHeadlessBrowserDiscoveryFixture = async () => {
  const fixture = headlessBrowserDiscoveryTestNetwork
  const tokens = await deriveDiscoveryTokens([fixture.subnetworkSecret])
  const clientA = await startNodeLibp2p({
    relayAddrs: fixture.relayAddrs,
    subnetworkSecrets: [fixture.subnetworkSecret],
    discoveryAnnouncementIntervalMs: 1_000,
  })
  const clientB = await startNodeLibp2p({
    relayAddrs: fixture.relayAddrs,
    subnetworkSecrets: [fixture.subnetworkSecret],
    discoveryAnnouncementIntervalMs: 1_000,
  })

  try {
    const peerA = clientA.peerId.toString()
    const peerB = clientB.peerId.toString()
    const [seenByA, seenByB] = await Promise.all([
      waitForPeerDiscovery(clientA as unknown as EventTarget, peerB, 15_000),
      waitForPeerDiscovery(clientB as unknown as EventTarget, peerA, 15_000),
    ])

    return {
      fixture,
      uiJoinPayload: {
        networkId: fixture.id,
        networkName: fixture.name,
        relayAddrs: fixture.relayAddrs,
        subnetworkSecret: fixture.subnetworkSecret,
        discoveryTokens: tokens,
      },
      peerA,
      peerB,
      seenByA,
      seenByB,
    }
  } finally {
    await Promise.allSettled([clientA.stop(), clientB.stop()])
  }
}

testSharedHeadlessBrowserDiscoveryFixture.timeoutMs = 25_000
