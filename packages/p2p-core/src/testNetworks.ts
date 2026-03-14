export type P2pTestNetworkFixture = {
  id: string
  name: string
  description: string
  relayAddrs: string[]
  subnetworkSecret: string
}

export const headlessBrowserDiscoveryTestNetwork: P2pTestNetworkFixture = {
  id: 'headless-browser-discovery-v1',
  name: 'Headless Discovery Test',
  description:
    'Shared discovery test network used by the browser playground and the headless diagnostics harness.',
  relayAddrs: ['/dns4/relay.taskyon.space/tcp/443/wss'],
  subnetworkSecret: 'taskyon-headless-browser-discovery-v1',
}

export const p2pTestNetworks = [headlessBrowserDiscoveryTestNetwork]
