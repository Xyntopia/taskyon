export * from './constants'
export * from './browser'
export * from './relay'
export * from './stream'
export * from './topic-router'

export type { Libp2p } from 'libp2p'
export {
  TypedEventEmitter,
  serviceCapabilities,
  serviceDependencies,
} from '@libp2p/interface'
export type {
  Connection,
  PeerId,
  Startable,
  Stream,
} from '@libp2p/interface'
export type { ConnectionManager, Registrar } from '@libp2p/interface-internal'
export { multiaddr } from '@multiformats/multiaddr'
export type { Multiaddr } from '@multiformats/multiaddr'
export {
  Circuit,
  WebRTC,
  WebRTCDirect,
  WebSockets,
  WebSocketsSecure,
  WebTransport,
} from '@multiformats/multiaddr-matcher'
