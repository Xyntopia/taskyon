import {
  type BrowserLibp2pNode,
  connectToMultiaddr,
  ensureRelayReservation,
  enableVerboseBrowserLibp2pLogs,
  log,
  msgIdFnStrictNoSign,
  setBrowserLibp2pLogNamespaces,
  startBrowserLibp2p,
} from '@taskyon/p2p-core/browser'

export {
  connectToMultiaddr,
  ensureRelayReservation,
  enableVerboseBrowserLibp2pLogs,
  log,
  msgIdFnStrictNoSign,
  setBrowserLibp2pLogNamespaces,
}

export async function startLibp2p(): Promise<BrowserLibp2pNode> {
  return await startBrowserLibp2p()
}

export type libP2pNode = BrowserLibp2pNode
