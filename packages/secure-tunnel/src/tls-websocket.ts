import {
  createRustlsClient,
  type RustlsClient,
  type RustlsClientFactory,
} from '@taskyon/https-tunnel-wasm'
import { WsProxyCloseError } from '@taskyon/common/modules/wsProxyClose'

export interface TunnelConnection {
  write(data: Uint8Array): Promise<void>
  read(): Promise<Uint8Array | null>
  close(): void
}

export type TlsConnection = TunnelConnection

export type WebSocketConstructor = new (url: string, protocols?: string | string[]) => WebSocket
export type TlsMetadata = {
  version: string | undefined
  cipherSuite: string | undefined
}
export const SUPPORTED_TLS_PROTOCOL_VERSIONS = ['TLS1_3', 'TLS1_2'] as const

const openSocket = async (
  tunnelUrl: string,
  targetHost: string,
  targetPort: number,
  token: string,
  WebSocketImpl: WebSocketConstructor,
): Promise<TunnelConnection> => {
  const wsUrl = new URL(tunnelUrl)
  wsUrl.searchParams.set('host', targetHost)
  wsUrl.searchParams.set('port', String(targetPort))
  const ws = new WebSocketImpl(wsUrl.toString(), ['taskyon-tunnel-v1', `bearer.${token}`])
  ws.binaryType = 'arraybuffer'

  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => reject(new Error('WebSocket tunnel connection failed'))
  })

  let closed = false
  let closeError: Error | undefined
  let pending: ((value: Uint8Array | null) => void) | undefined
  const queue: Uint8Array[] = []
  ws.onmessage = (event) => {
    const receive = async () => {
      const bytes =
        event.data instanceof Blob
          ? new Uint8Array(await event.data.arrayBuffer())
          : new Uint8Array(event.data as ArrayBuffer)
      if (pending) {
        const resolve = pending
        pending = undefined
        resolve(bytes)
      } else queue.push(bytes)
    }
    void receive()
  }
  ws.onclose = ({ code, reason }) => {
    closed = true
    if (code !== 1000 && !(code === 4500 && reason === 'tcp closed')) {
      closeError = new WsProxyCloseError(code, reason)
    }
    pending?.(null)
    pending = undefined
  }

  return {
    write: (data) => {
      if (closed || ws.readyState !== 1) {
        return Promise.reject(closeError ?? new Error('Tunnel connection is closed'))
      }
      ws.send(data)
      return Promise.resolve()
    },
    read: async () => {
      const value = queue.shift()
      if (value) return value
      if (closed) {
        if (closeError) throw closeError
        return null
      }
      const received = await new Promise<Uint8Array | null>((resolve) => {
        pending = resolve
      })
      if (received === null && closeError) throw closeError
      return received
    },
    close: () => {
      if (closed) return
      closed = true
      ws.close(1000, 'complete')
      pending?.(null)
      pending = undefined
    },
  }
}

export async function openWebSocketConnection(
  tunnelUrl: string,
  targetHost: string,
  targetPort: number,
  token: string,
  WebSocketImpl: WebSocketConstructor = WebSocket,
): Promise<TunnelConnection> {
  return await openSocket(tunnelUrl, targetHost, targetPort, token, WebSocketImpl)
}

export async function openTlsConnection(
  tunnelUrl: string,
  targetHost: string,
  targetPort: number,
  token: string,
  WebSocketImpl: WebSocketConstructor = WebSocket,
  onHandshake?: (metadata: TlsMetadata) => void,
  createTlsClient: RustlsClientFactory = createRustlsClient,
): Promise<TlsConnection> {
  const socket = await openSocket(tunnelUrl, targetHost, targetPort, token, WebSocketImpl)
  let tls: RustlsClient
  try {
    tls = await createTlsClient(targetHost)
  } catch (error) {
    socket.close()
    throw error
  }

  const plaintext: Uint8Array[] = []
  let readResolve: ((value: Uint8Array | null) => void) | undefined
  let handshakeResolve: (() => void) | undefined
  let handshakeReject: ((error: Error) => void) | undefined
  let handshakeComplete = false
  let ended = false
  let endError: Error | undefined

  const flushTls = async () => {
    const bytes = tls.takeTlsBytes()
    if (bytes.byteLength) await socket.write(bytes)
  }
  const emitPlaintext = () => {
    const bytes = tls.readPlaintext()
    if (!bytes.byteLength) return
    if (readResolve) {
      const resolve = readResolve
      readResolve = undefined
      resolve(bytes)
    } else plaintext.push(bytes)
  }
  const finish = (error?: Error) => {
    if (ended) return
    ended = true
    endError = error
    if (error && !handshakeComplete) handshakeReject?.(error)
    readResolve?.(null)
    readResolve = undefined
  }

  const pump = async () => {
    try {
      for (;;) {
        const bytes = await socket.read()
        if (!bytes) break
        tls.receiveTls(bytes)
        await flushTls()
        if (!handshakeComplete && !tls.isHandshaking()) {
          handshakeComplete = true
          onHandshake?.({
            version: tls.protocolVersion(),
            cipherSuite: tls.cipherSuite(),
          })
          handshakeResolve?.()
        }
        emitPlaintext()
        if (tls.peerClosed()) break
      }
      finish()
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error))
      finish(failure)
    } finally {
      socket.close()
      tls.free()
    }
  }
  void pump()

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('TLS handshake timed out')), 10_000)
    handshakeResolve = () => {
      clearTimeout(timeout)
      resolve()
    }
    handshakeReject = (error) => {
      clearTimeout(timeout)
      reject(error)
    }
    void flushTls().catch(handshakeReject)
  }).catch((error) => {
    socket.close()
    throw error
  })

  return {
    write: async (data) => {
      tls.writePlaintext(data)
      await flushTls()
    },
    read: async () => {
      const value = plaintext.shift()
      if (value) return value
      if (ended) {
        if (endError) throw endError
        return null
      }
      const received = await new Promise<Uint8Array | null>((resolve) => {
        readResolve = resolve
      })
      if (received === null && endError) throw endError
      return received
    },
    close: () => {
      if (ended) {
        socket.close()
        return
      }
      tls.sendCloseNotify()
      void flushTls().finally(() => socket.close())
    },
  }
}
