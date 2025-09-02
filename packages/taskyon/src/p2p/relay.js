import { createLibp2p } from 'libp2p'
import { autoNAT } from '@libp2p/autonat'
import { identify } from '@libp2p/identify'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'
import { webSockets } from '@libp2p/websockets'
import { tcp } from '@libp2p/tcp'
import { circuitRelayServer } from '@libp2p/circuit-relay-v2'
import { createEd25519PeerId } from '@libp2p/peer-id-factory'
import { peerIdFromBytes } from '@libp2p/peer-id'
import { promises as fs } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// https://docs.libp2p.io/concepts/security/dos-mitigation/
// https://libp2p.github.io/js-libp2p/interfaces/_libp2p_circuit-relay-v2.CircuitRelayServerInit.html

// Create logger that always outputs to stdout for Docker compatibility
const createStdoutLogger = (name) => {
  const timestamp = () => new Date().toISOString()
  return {
    info: (...args) => console.log(`${timestamp()} [${name}] [INFO]`, ...args),
    warn: (...args) => console.log(`${timestamp()} [${name}] [WARN]`, ...args),
    error: (...args) => console.log(`${timestamp()} [${name}] [ERROR]`, ...args),
  }
}

// Always use stdout logger for Docker compatibility
const log = createStdoutLogger('relay')

const bannedIPs = new Set()
const bannedPeers = new Set()

// Log startup
log.info('=== RELAY SERVER STARTUP ===')
log.info('Node.js version: %s', process.version)
log.info('Starting libp2p relay server...')

// Cache directory for storing peer ID
const CACHE_DIR = process.env.XDG_CACHE_HOME || join(homedir(), '.cache')
const PEER_ID_CACHE_DIR = join(CACHE_DIR, 'libp2p-relay')
const PEER_ID_FILE = join(PEER_ID_CACHE_DIR, 'peer-id.json')

log.info('Cache configuration:')
log.info('  - XDG_CACHE_HOME: %s', process.env.XDG_CACHE_HOME || 'not set')
log.info('  - Cache dir: %s', CACHE_DIR)
log.info('  - Peer ID cache: %s', PEER_ID_CACHE_DIR)

async function ensureCacheDir() {
  try {
    log.info('Creating cache directory if needed: %s', PEER_ID_CACHE_DIR)
    await fs.mkdir(PEER_ID_CACHE_DIR, { recursive: true })
    log.info('✅ Cache directory ready')
  } catch (err) {
    log.error('❌ Failed to create cache directory: %s', err.message)
    throw err
  }
}

async function loadOrCreatePeerId() {
  log.info('=== PEER ID INITIALIZATION ===')
  log.info('Cache directory: %s', PEER_ID_CACHE_DIR)
  log.info('Peer ID cache file: %s', PEER_ID_FILE)

  await ensureCacheDir()
  log.info('Cache directory ready')

  try {
    // Try to load existing peer ID
    log.info('Attempting to load existing peer ID from cache...')
    const data = await fs.readFile(PEER_ID_FILE, 'utf8')
    const peerIdData = JSON.parse(data)

    log.info('✅ Found existing peer ID in cache')
    log.info('  - Peer ID: %s', peerIdData.id)
    log.info('  - Created at: %s', peerIdData.createdAt)
    log.info(
      '  - Private key length: %d bytes',
      Buffer.from(peerIdData.privateKey, 'base64').length,
    )

    // Reconstruct peer ID from private key bytes
    const privateKeyBytes = Buffer.from(peerIdData.privateKey, 'base64')
    const peerId = await peerIdFromBytes(privateKeyBytes)

    log.info('✅ Successfully loaded peer ID from cache')
    log.info('  - Verified peer ID: %s', peerId.toString())
    log.info('=== PEER ID READY (EXISTING) ===')
    return peerId
  } catch (err) {
    if (err.code === 'ENOENT') {
      log.info('❌ No existing peer ID found in cache')
    } else {
      log.warn('❌ Error loading peer ID from cache: %s', err.message)
    }

    log.info('Creating new Ed25519 peer ID...')
    // Create new peer ID using the factory function
    const peerId = await createEd25519PeerId()

    log.info('✅ New peer ID generated')
    log.info('  - Peer ID: %s', peerId.toString())
    log.info('  - Type: Ed25519')
    log.info('  - Private key length: %d bytes', peerId.privateKey.byteLength)

    // Save it to cache
    const peerIdData = {
      id: peerId.toString(),
      privateKey: Buffer.from(peerId.privateKey).toString('base64'),
      publicKey: Buffer.from(peerId.publicKey).toString('base64'),
      createdAt: new Date().toISOString(),
    }

    try {
      log.info('Saving new peer ID to cache...')
      await fs.writeFile(PEER_ID_FILE, JSON.stringify(peerIdData, null, 2))
      log.info('✅ Successfully saved new peer ID to cache')
    } catch (saveErr) {
      log.error('❌ Failed to save peer ID to cache: %s', saveErr.message)
    }

    log.info('=== PEER ID READY (NEW) ===')
    return peerId
  }
}

async function main() {
  const peerId = await loadOrCreatePeerId()

  log.info('=== LIBP2P INITIALIZATION ===')
  log.info('Using Peer ID: %s', peerId.toString())

  const libp2p = await createLibp2p({
    peerId, // Use our persistent peer ID
    addresses: {
      listen: ['/ip4/0.0.0.0/tcp/9111/ws', '/ip4/0.0.0.0/tcp/9112'],
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

  log.info('=== RELAY SERVER READY ===')
  log.info('PeerID: %s', libp2p.peerId.toString())
  log.info('Peer ID cached at: %s', PEER_ID_FILE)
  log.info('Multiaddrs: %j', libp2p.getMultiaddrs())
  log.info('Relay server listening and ready for connections')
  log.info('==============================')
}

main().catch((err) => {
  log.error('=== FATAL ERROR ===')
  log.error('Failed to start relay server:')
  log.error('Error name: %s', err.name)
  log.error('Error message: %s', err.message)
  log.error('Error stack: %s', err.stack)

  if (err.code) {
    log.error('Error code: %s', err.code)
  }

  // Check for common import/module errors
  if (err.message.includes('does not provide an export')) {
    log.error('This appears to be an import/export error.')
    log.error('Check that all @libp2p packages are compatible versions.')
  }

  if (err.message.includes('Cannot resolve module')) {
    log.error('This appears to be a missing dependency.')
    log.error('Try running: yarn add @libp2p/peer-id-factory')
  }

  process.exit(1)
})
