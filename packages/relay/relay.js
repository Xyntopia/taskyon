import { createLibp2p } from 'libp2p'
import { autoNAT } from '@libp2p/autonat'
import { identify } from '@libp2p/identify'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { tcp } from '@libp2p/tcp'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { enable } from '@libp2p/logger'

enable('libp2p:*')

// Create logger that always outputs to stdout for Docker compatibility
const createStdoutLogger = (name) => {
  const timestamp = () => new Date().toISOString()
  return {
    info: (msg) => console.log(`${timestamp()} [${name}] [INFO] ${msg}`),
    warn: (msg) => console.log(`${timestamp()} [${name}] [WARN] ${msg}`),
    error: (msg) => console.log(`${timestamp()} [${name}] [ERROR] ${msg}`),
  }
}

// Always use stdout logger for Docker compatibility
const log = createStdoutLogger('relay')

const bannedIPs = new Set()
const bannedPeers = new Set()

// Log startup
log.info('=== RELAY SERVER STARTUP ===')
log.info(`Node.js version: ${process.version}`)
log.info('Starting libp2p relay server...')

async function main() {
  const libp2p = await createLibp2p({
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/9111/ws', '/ip4/0.0.0.0/tcp/9112'],
      /*announce: [
        `/ip4/213.199.53.86/tcp/9111/ws/p2p/${YOUR_RELAY_ID}`,
        `/ip4/213.199.53.86/tcp/9112/p2p/${YOUR_RELAY_ID}`,
      ],*/
      //TODO: announce: ['/ip4/213.199.53.86/tcp/9111/ws/p2p/YOUR_RELAY_ID']
    },
    transports: [webSockets(), tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    connectionGater: {
      async denyInboundConnection(maConn) {
        const ip = maConn.remoteAddr.toOptions().host
        log.warn(`Inbound connect attempt from ${ip}`)
        return bannedIPs.has(ip)
      },
    },
    services: {
      identify: identify(),
      autoNat: autoNAT(),
      relay: circuitRelayServer({
        reservations: {
          maxReservations: 50,
          reservationExpiration: 60_000, // 1-minute reservation
          reservationFilter: ({ peerId }) => {
            const str = peerId.toString()
            const deny = bannedPeers.has(str)
            if (deny) log.warn(`Blocking reservation from banned peer ${str}`)
            return !deny
          },
        },
        hopTimeout: 10_000, // 10s per-hop dial
      }),
      pubsub: gossipsub(),
    },
    connectionManager: {
      maxConnections: 200, // overall cap
      minConnections: 5,
      maxIncomingPendingConnections: 50,
      inboundConnectionTimeout: 60_000, // drop idle peers after 1 min
    },
  })

  libp2p.addEventListener('peer:connect', (evt) => {
    log.info(`Peer connected: ${evt.detail.toString()}`)
  })
  libp2p.addEventListener('peer:disconnect', (evt) => {
    log.info(`Peer disconnected: ${evt.detail.toString()}`)
  })

  setInterval(async () => {
    try {
      const s = await libp2p.services.autoNat.getStatus()
      log.info(
        `[AutoNAT poll] reachability=${s.reachability} addr=${s.publicAddr?.toString() ?? '-'}`,
      )
    } catch (e) {
      log.warn(`[AutoNAT poll] failed: ${e.message}`)
    }
  }, 30_000)

  log.info('=== RELAY SERVER READY ===')
  log.info(`PeerID: ${libp2p.peerId.toString()}`)
  log.info(
    `Multiaddrs:\n${libp2p
      .getMultiaddrs()
      .map((addr) => `  ${addr.toString()}`)
      .join('\n')}`,
  )
  log.info('Relay server listening and ready for connections')
  log.info('==============================')
}

main().catch((err) => {
  log.error('=== FATAL ERROR ===')
  log.error('Failed to start relay server:')
  log.error(`Error name: ${err.name}`)
  log.error(`Error message: ${err.message}`)
  log.error(`Error stack: ${err.stack}`)

  if (err.code) {
    log.error(`Error code: ${err.code}`)
  }

  // Check for common import/module errors
  if (err.message.includes('does not provide an export')) {
    log.error('This appears to be an import/export error.')
    log.error('Check that all @libp2p packages are compatible versions.')
  }

  if (err.message.includes('Cannot resolve module')) {
    log.error('This appears to be a missing dependency.')
    log.error('Try running: yarn add @libp2p/peer-id')
  }

  process.exit(1)
})
