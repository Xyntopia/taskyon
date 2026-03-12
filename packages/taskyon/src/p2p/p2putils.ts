import {
  type Libp2p,
  Circuit,
  WebRTC,
  WebRTCDirect,
  WebSockets,
  WebSocketsSecure,
  WebTransport,
} from '@taskyon/p2p-core'

export const bootstrapPeers = [
  '/ip4/127.0.0.1/tcp/9001/ws',
  'QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  'QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  'QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  'QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
  'QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
  'QmZa1sAxajnQjVM8WjWXoMbmPd7NsWhfKsPkErzpm9wGkp',
]

export function getAddresses(libp2p: Libp2p) {
  return libp2p.getMultiaddrs().map((ma) => ma.toString())
}
export function getPeerTypes(libp2p: Libp2p) {
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
      if (WebRTC.exactMatch(maCompat)) {
        types['WebRTC']++
      } else if (WebRTCDirect.exactMatch(maCompat)) {
        types['WebRTC Direct']++
      } else if (WebSockets.exactMatch(maCompat)) {
        types['WebSockets']++
      } else if (WebSocketsSecure.exactMatch(maCompat)) {
        types['WebSockets (secure)']++
      } else if (WebTransport.exactMatch(maCompat)) {
        types['WebTransport']++
      } else if (Circuit.exactMatch(maCompat)) {
        types['Circuit Relay']++
      } else {
        types['Other']++
        console.info('wat', ma.toString())
      }
    })

  return types
}
export function getPeerDetails(libp2p: Libp2p) {
  return libp2p.getPeers().map((peer) => {
    const peerConnections = libp2p.getConnections(peer)

    const nodeType = []

    // detect if this is a bootstrap node
    if (bootstrapPeers.includes(peer.toString())) {
      nodeType.push('bootstrap')
    }

    const relayMultiaddrs = libp2p
      .getMultiaddrs()
      .filter((ma) => Circuit.exactMatch(ma as unknown as Parameters<typeof Circuit.exactMatch>[0]))
    const relayPeers = relayMultiaddrs
      .map((ma) => {
        return ma
          .getComponents()
          .filter(({ name }) => name === 'p2p')
          .map(({ value }) => value)
      })
      .flat()

    // detect if this is a relay we have a reservation on
    if (relayPeers.includes(peer.toString())) {
      nodeType.push('relay')
    }

    return {
      nodeType,
      peerConnections: peerConnections.map((conn) => conn.remoteAddr.toString()),
    }
  })
}
