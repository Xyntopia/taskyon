import { makeTLSClient, setCryptoImplementation } from '@reclaimprotocol/tls'
import { pureJsCrypto } from '@reclaimprotocol/tls/purejs-crypto'
import { WsProxyCloseCode, WsProxyCloseError } from '@taskyon/taskyon'

// Set up pure JavaScript crypto implementation for browser compatibility
try {
  setCryptoImplementation(pureJsCrypto)
} catch (e) {
  console.warn('[SecureTunnel] Failed to set crypto implementation:', e)
}

export interface TlsConnection {
  write(data: Uint8Array): Promise<void>
  read(): Promise<Uint8Array | null>
  close(): void
}

/**
 * Opens a TLS connection through a WebSocket tunnel.
 *
 * @param tunnelUrl - Base WebSocket URL (e.g., 'ws://localhost:8443' or 'wss://proxy.example.com')
 * @param targetHost - Target hostname to connect to
 * @param targetPort - Target port (default: 443)
 * @returns TlsConnection interface for reading/writing encrypted data
 *
 * The tunnel URL will have host and port appended as query parameters:
 * ws://localhost:8443?host=example.com&port=443
 */
export async function openTlsConnection(
  tunnelUrl: string,
  targetHost: string,
  targetPort: number = 443,
  token: string,
): Promise<TlsConnection> {
  const wsUrl = new URL(tunnelUrl)
  wsUrl.searchParams.set('host', targetHost)
  wsUrl.searchParams.set('port', targetPort.toString())

  const ws = new WebSocket(wsUrl.toString(), [`bearer.${token}`])
  ws.binaryType = 'arraybuffer'

  let isClosed = false
  let closeError: Error | null = null
  let readResolve: ((value: Uint8Array | null) => void) | null = null
  const readQueue: Uint8Array[] = []

  let handshakeResolve: (() => void) | null = null
  let handshakeReject: ((err: Error) => void) | null = null

  const closeConnection = (err?: Error) => {
    if (isClosed) return
    isClosed = true
    closeError = err ?? closeError

    try {
      ws.close()
    } catch {
      /* ignore */
    }

    if (readResolve) {
      // surface null, caller can also check `closeError` if you expose it
      readResolve(null)
      readResolve = null
    }

    if (err && handshakeReject) {
      handshakeReject(err)
      handshakeReject = null
    } else if (handshakeReject) {
      handshakeReject(new Error('Connection closed during handshake'))
      handshakeReject = null
    }
  }

  // Wait for raw WS open or fail
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = () => {
      reject(new Error('WebSocket connection failed'))
    }
    // NOTE: we also handle onclose below to give better errors
  })

  const tls = makeTLSClient({
    host: targetHost,
    verifyServerCertificate: false,
    write({ header, content }) {
      if (ws.readyState === WebSocket.OPEN) {
        const combined = new Uint8Array(header.length + content.length)
        combined.set(header)
        combined.set(content, header.length)
        ws.send(combined)
      }
    },
    onHandshake() {
      if (handshakeResolve) {
        handshakeResolve()
        handshakeResolve = null
        handshakeReject = null
      }
    },
    onApplicationData(plaintext: Uint8Array) {
      if (readResolve) {
        readResolve(plaintext)
        readResolve = null
      } else {
        readQueue.push(plaintext)
      }
    },
    onTlsEnd(error) {
      if (error && handshakeReject) {
        handshakeReject(error)
        handshakeReject = null
      }
      closeConnection(error ?? undefined)
    },
  })

  ws.addEventListener('message', (event) => {
    if (typeof event.data === 'string') return
    const data = new Uint8Array(event.data)
    void tls.handleReceivedBytes(data)
  })

  ws.addEventListener('close', (event) => {
    const { code, reason } = event
    const err = new WsProxyCloseError(code, reason)

    // Optional: log a nicer message based on known codes
    switch (code as WsProxyCloseCode) {
      case WsProxyCloseCode.AuthFailed:
        console.warn('[SecureTunnel] Auth failed in ws-proxy:', reason)
        break
      case WsProxyCloseCode.MissingHost:
      case WsProxyCloseCode.InvalidPort:
      case WsProxyCloseCode.ServiceNotAllowed:
      case WsProxyCloseCode.PortNotAllowed:
      case WsProxyCloseCode.InvalidHostFormat:
      case WsProxyCloseCode.PrivateIpForbidden:
      case WsProxyCloseCode.DnsResolutionFailed:
        console.warn('[SecureTunnel] Target validation failed:', reason)
        break
      case WsProxyCloseCode.TcpConnectionFailed:
        console.warn('[SecureTunnel] TCP connection failed:', reason)
        break
      case WsProxyCloseCode.InternalError:
      default:
        console.warn('[SecureTunnel] Tunnel closed:', code, reason)
        break
    }

    closeConnection(err)
  })

  ws.addEventListener('error', () => {
    const err = new Error('WebSocket error in tunnel')
    closeConnection(err)
  })

  await tls.startHandshake()

  // Wait for TLS handshake OR ws-proxy close error
  await new Promise<void>((resolve, reject) => {
    handshakeResolve = resolve
    handshakeReject = reject
    setTimeout(() => {
      if (handshakeReject) {
        handshakeReject(new Error('TLS handshake timeout'))
        handshakeReject = null
      }
    }, 10000)
  })

  return {
    write: async (data: Uint8Array) => {
      if (isClosed) {
        throw closeError ?? new Error('Connection is closed')
      }
      await tls.write(data)
    },
    read: () => {
      if (readQueue.length > 0) {
        return Promise.resolve(readQueue.shift()!)
      }
      if (isClosed) {
        // If you want to propagate the close error directly:
        if (closeError) {
          return Promise.reject(closeError)
        }
        return Promise.resolve(null)
      }
      return new Promise((resolve) => {
        readResolve = resolve
      })
    },
    close: () => closeConnection(),
  }
}
