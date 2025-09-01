import {
  WebRTC,
  WebSockets,
  WebSocketsSecure,
  WebTransport,
  Circuit,
  WebRTCDirect,
} from '@multiformats/multiaddr-matcher'
import type { Libp2p } from 'libp2p'

export const bootstrapPeers = [
  'QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  'QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  'QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  'QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
  'QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ',
  'QmZa1sAxajnQjVM8WjWXoMbmPd7NsWhfKsPkErzpm9wGkp',
]

export function getAddresses(libp2p: Libp2p) {
  return libp2p
    .getMultiaddrs()
    .map((ma) => {
      return `<li class="text-sm break-all"><button class="bg-teal-500 hover:bg-teal-700 text-white mx-2" onclick="navigator.clipboard.writeText('${ma.toString()}')">Copy</button>${ma.toString()}</li>`
    })
    .join('')
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
      if (WebRTC.exactMatch(ma)) {
        types['WebRTC']++
      } else if (WebRTCDirect.exactMatch(ma)) {
        types['WebRTC Direct']++
      } else if (WebSockets.exactMatch(ma)) {
        types['WebSockets']++
      } else if (WebSocketsSecure.exactMatch(ma)) {
        types['WebSockets (secure)']++
      } else if (WebTransport.exactMatch(ma)) {
        types['WebTransport']++
      } else if (Circuit.exactMatch(ma)) {
        types['Circuit Relay']++
      } else {
        types['Other']++
        console.info('wat', ma.toString())
      }
    })

  return Object.entries(types)
    .map(([name, count]) => `<li>${name}: ${count}</li>`)
    .join('')
}
export function getPeerDetails(libp2p: Libp2p) {
  return libp2p
    .getPeers()
    .map((peer) => {
      const peerConnections = libp2p.getConnections(peer)

      const nodeType = []

      // detect if this is a bootstrap node
      if (bootstrapPeers.includes(peer.toString())) {
        nodeType.push('bootstrap')
      }

      const relayMultiaddrs = libp2p.getMultiaddrs().filter((ma) => Circuit.exactMatch(ma))
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

      return `<li>
      <span><code>${peer.toString()}</code>${nodeType.length > 0 ? `(${nodeType.join(', ')})` : ''}</span>
      <ul class="pl-6">${peerConnections
        .map((conn) => {
          return `<li class="break-all text-sm"><button class="bg-teal-500 hover:bg-teal-700 text-white px-2 mx-2 rounded focus:outline-none focus:shadow-outline" onclick="navigator.clipboard.writeText('${conn.remoteAddr.toString()}')">Copy</button>${conn.remoteAddr.toString()} </li>`
        })
        .join('')}</ul>
    </li>`
    })
    .join('')
}
