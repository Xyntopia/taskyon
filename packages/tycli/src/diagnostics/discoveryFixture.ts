import { deriveDiscoveryTokens } from '../../../p2p-core/src/discovery'
import { startNodeLibp2p } from '../../../p2p-core/src/node'
import { SUBNETWORK_PEER_DISCOVERY_EVENT } from '../../../p2p-core/src/constants'
import { headlessBrowserDiscoveryTestNetwork } from '../../../p2p-core/src/testNetworks'

type RunningNode = Awaited<ReturnType<typeof startNodeLibp2p>>

function timestamp() {
  return new Date().toISOString()
}

function log(message: string, data?: unknown) {
  if (data === undefined) {
    console.log(`[${timestamp()}] [tycli-diagnostics] ${message}`)
    return
  }
  console.log(`[${timestamp()}] [tycli-diagnostics] ${message}`, data)
}

function attachDiscoveryLogging(label: string, node: RunningNode) {
  const peerId = node.peerId.toString()
  ;(node as unknown as EventTarget).addEventListener(SUBNETWORK_PEER_DISCOVERY_EVENT, ((
    event: Event & {
      detail?: {
        id?: string
        matchedToken?: string
        multiaddrs?: Array<{ toString: () => string }>
      }
    },
  ) => {
    log(`${label} discovered peer`, {
      self: peerId,
      peer: event.detail?.id,
      matchedToken: event.detail?.matchedToken,
      multiaddrs: (event.detail?.multiaddrs ?? []).map((addr) => addr.toString()),
    })
  }) as EventListener)
}

async function main() {
  const fixture = headlessBrowserDiscoveryTestNetwork
  const discoveryTokens = await deriveDiscoveryTokens([fixture.subnetworkSecret])

  log('starting persistent shared discovery fixture')
  log('fixture', {
    ...fixture,
    discoveryTokens,
  })

  const nodeA = await startNodeLibp2p({
    relayAddrs: fixture.relayAddrs,
    subnetworkSecrets: [fixture.subnetworkSecret],
    discoveryAnnouncementIntervalMs: 1_000,
  })
  const nodeB = await startNodeLibp2p({
    relayAddrs: fixture.relayAddrs,
    subnetworkSecrets: [fixture.subnetworkSecret],
    discoveryAnnouncementIntervalMs: 1_000,
  })

  attachDiscoveryLogging('nodeA', nodeA)
  attachDiscoveryLogging('nodeB', nodeB)

  log('nodes online', {
    nodeA: nodeA.peerId.toString(),
    nodeB: nodeB.peerId.toString(),
    relayAddrs: fixture.relayAddrs,
  })

  log('browser join instructions', {
    route: '/p2p',
    action: 'Click "Join Test Network", then "Start Discovery"',
    networkId: fixture.id,
    networkName: fixture.name,
    relayAddrs: fixture.relayAddrs,
    subnetworkSecret: fixture.subnetworkSecret,
    discoveryTokens,
  })

  const stop = async () => {
    log('stopping persistent discovery fixture')
    await Promise.allSettled([nodeA.stop(), nodeB.stop()])
    process.exit(0)
  }

  process.once('SIGINT', () => {
    void stop()
  })
  process.once('SIGTERM', () => {
    void stop()
  })

  log('fixture is running; press Ctrl+C to stop')
  await new Promise(() => {
    // Keep the process alive until SIGINT/SIGTERM.
  })
}

await main()
