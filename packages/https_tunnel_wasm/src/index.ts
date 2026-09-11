import init, { TlsClient } from '../pkg/https_tunnel_wasm.js'

export interface RustlsClient {
  receiveTls(bytes: Uint8Array): void
  takeTlsBytes(): Uint8Array
  writePlaintext(bytes: Uint8Array): void
  readPlaintext(): Uint8Array
  isHandshaking(): boolean
  peerClosed(): boolean
  protocolVersion(): string | undefined
  cipherSuite(): string | undefined
  sendCloseNotify(): void
  free(): void
}

export type RustlsClientFactory = (host: string) => Promise<RustlsClient>

export const createRustlsClient: RustlsClientFactory = async (host) => {
  await init()
  return new TlsClient(host)
}
