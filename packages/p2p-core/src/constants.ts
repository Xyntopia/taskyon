export const CHAT_TOPIC = 'universal-connectivity'
export const CHAT_FILE_TOPIC = 'universal-connectivity-file'
export const PUBSUB_PEER_DISCOVERY = 'universal-connectivity-browser-peer-discovery'
export const SUBNETWORK_PEER_DISCOVERY_EVENT = 'taskyon:subnetwork-discovery'
export const FILE_EXCHANGE_PROTOCOL = '/universal-connectivity-file/1'
export const TOPIC_ROUTER_PROTOCOL = '/taskyon/topic-router/1.0.0'

export const CIRCUIT_RELAY_CODE = 290

export const MIME_TEXT_PLAIN = 'text/plain'

export const LOCALHOST_RELAY_WS_MULTIADDR = '/ip4/127.0.0.1/tcp/9111/ws'

// Primary relay endpoint from deployment (see cloud/contabo_services.nix nginx vhost)
export const PRIMARY_RELAY_WS_MULTIADDR = '/dns4/relay.taskyon.space/tcp/443/wss'

const RELAY_ADDRS_STORAGE_KEY = 'taskyon.relayAddrs'

// Do not auto-bootstrap any relay during local testing unless explicitly configured.
export const RELAY_DIAL_FALLBACKS: string[] = []

function parseRelayAddrList(value: string | null | undefined): string[] {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return []
  }

  return value
    .split(',')
    .map((addr) => addr.trim())
    .filter(Boolean)
}

function readStoredRelayAddrs(): string[] {
  if (typeof globalThis.localStorage?.getItem !== 'function') {
    return []
  }

  return parseRelayAddrList(globalThis.localStorage.getItem(RELAY_ADDRS_STORAGE_KEY))
}

function readGlobalRelayAddrs(): string[] {
  const value = (
    globalThis as typeof globalThis & {
      __TASKYON_RELAY_ADDRS__?: string[] | string
    }
  ).__TASKYON_RELAY_ADDRS__

  if (Array.isArray(value)) {
    return value.map((addr) => addr.trim()).filter(Boolean)
  }

  return parseRelayAddrList(value)
}

export function getRelayDialFallbacks(): string[] {
  const stored = readStoredRelayAddrs()
  if (stored.length > 0) {
    return stored
  }

  const fromGlobal = readGlobalRelayAddrs()
  return fromGlobal.length > 0 ? fromGlobal : RELAY_DIAL_FALLBACKS
}
