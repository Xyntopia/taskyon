import { makeTLSClient, setCryptoImplementation } from '@reclaimprotocol/tls'
import { pureJsCrypto } from '@reclaimprotocol/tls/purejs-crypto'
import { WsProxyCloseCode, WsProxyCloseError } from '@taskyon/common/modules/wsProxyClose'

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
  // ---- NEW: connection id for clearer logs ----
  const connId = Math.random().toString(36).slice(2, 8)
  const logPrefix = `[SecureTunnel conn=${connId} host=${targetHost}:${targetPort}]`

  console.log(`${logPrefix} creating WebSocket`, { tunnelUrl })

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

    console.log(`${logPrefix} closeConnection called`, {
      hasError: !!err,
      error: err?.message,
    })

    try {
      ws.close()
    } catch {
      /* ignore */
    }

    if (readResolve) {
      console.log(`${logPrefix} resolving pending read with null due to close`)
      readResolve(null)
      readResolve = null
    }

    if (err && handshakeReject) {
      console.log(`${logPrefix} rejecting handshake due to error in closeConnection`, {
        error: err.message,
      })
      handshakeReject(err)
      handshakeReject = null
      handshakeResolve = null
    } else if (handshakeReject) {
      console.log(`${logPrefix} rejecting handshake: connection closed during handshake`)
      handshakeReject(new Error('Connection closed during handshake'))
      handshakeReject = null
      handshakeResolve = null
    }
  }

  // Wait for raw WS open or fail
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      console.log(`${logPrefix} WebSocket onopen`)
      resolve()
    }
    ws.onerror = (ev) => {
      console.warn(`${logPrefix} WebSocket onerror`, ev)
      reject(new Error('WebSocket connection failed'))
    }
  })

  console.log(`${logPrefix} WebSocket open, creating TLS client`)

  const tls = makeTLSClient({
    host: targetHost,
    verifyServerCertificate: false,
    write({ header, content }) {
      if (ws.readyState === WebSocket.OPEN) {
        const combined = new Uint8Array(header.length + content.length)
        combined.set(header)
        combined.set(content, header.length)
        console.log(`${logPrefix} TLS write: sending ${combined.length} bytes over WebSocket`)
        ws.send(combined)
      } else {
        console.warn(`${logPrefix} TLS write attempted but WebSocket not OPEN`, {
          readyState: ws.readyState,
        })
      }
    },
    onHandshake() {
      console.log(`${logPrefix} TLS onHandshake fired`)
      if (handshakeResolve) {
        handshakeResolve()
        handshakeResolve = null
        handshakeReject = null
      } else {
        console.warn(`${logPrefix} TLS onHandshake fired but no handshakeResolve set`)
      }
    },
    onApplicationData(plaintext: Uint8Array) {
      console.log(`${logPrefix} TLS onApplicationData: received ${plaintext.length} bytes`)
      if (readResolve) {
        const resolver = readResolve
        readResolve = null
        resolver(plaintext)
      } else {
        readQueue.push(plaintext)
      }
    },
    onTlsEnd(error) {
      console.log(`${logPrefix} TLS onTlsEnd`, { error: error?.message })
      if (error && handshakeReject) {
        console.log(`${logPrefix} rejecting handshake from onTlsEnd`, { error: error.message })
        handshakeReject(error)
        handshakeReject = null
        handshakeResolve = null
      }
      closeConnection(error ?? undefined)
    },
  })

  ws.addEventListener('message', (event) => {
    if (typeof event.data === 'string') {
      console.log(`${logPrefix} WebSocket message (string) ignored, length=${event.data.length}`)
      return
    }
    const data = new Uint8Array(event.data as ArrayBuffer)
    console.log(`${logPrefix} WebSocket message: ${data.length} bytes, passing to TLS`)
    void tls.handleReceivedBytes(data)
  })

  ws.addEventListener('close', (event) => {
    const { code, reason, wasClean } = event
    console.log(`${logPrefix} WebSocket close event`, { code, reason, wasClean })

    // If this is your "normal" tcp-closed-after-response code,
    // do NOT always treat it as a hard error.
    if (code === 4500 && reason === 'tcp closed') {
      console.log(`${logPrefix} treating code=4500, reason="tcp closed" as normal close`)
      closeConnection() // no error
      return
    }

    const err = new WsProxyCloseError(code, reason)

    switch (code as WsProxyCloseCode) {
      case WsProxyCloseCode.AuthFailed:
        console.warn(`${logPrefix} Auth failed in ws-proxy:`, reason)
        break
      case WsProxyCloseCode.MissingHost:
      case WsProxyCloseCode.InvalidPort:
      case WsProxyCloseCode.ServiceNotAllowed:
      case WsProxyCloseCode.PortNotAllowed:
      case WsProxyCloseCode.InvalidHostFormat:
      case WsProxyCloseCode.PrivateIpForbidden:
      case WsProxyCloseCode.DnsResolutionFailed:
        console.warn(`${logPrefix} Target validation failed:`, reason)
        break
      case WsProxyCloseCode.TcpConnectionFailed:
        console.warn(`${logPrefix} TCP connection failed:`, reason)
        break
      case WsProxyCloseCode.InternalError:
      default:
        console.warn(`${logPrefix} Tunnel closed:`, code, reason)
        break
    }

    closeConnection(err)
  })

  ws.addEventListener('error', (ev) => {
    console.warn(`${logPrefix} WebSocket error event`, ev)
    const err = new Error('WebSocket error in tunnel')
    closeConnection(err)
  })

  // Wait for TLS handshake to complete (or timeout/fail)
  console.log(`${logPrefix} starting TLS handshake`)

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (handshakeReject) {
        console.warn(`${logPrefix} TLS handshake timeout reached (10s)`)
        // Reject AND close the connection
        const err = new Error('TLS handshake timeout')
        handshakeReject(err)
        // closeConnection will be invoked from handshakeReject below
      }
    }, 30000)

    handshakeResolve = () => {
      console.log(`${logPrefix} handshakeResolve invoked`)
      clearTimeout(timeoutId)
      resolve()
      handshakeResolve = null
      handshakeReject = null
    }

    handshakeReject = (err: Error) => {
      console.warn(`${logPrefix} handshakeReject invoked`, { error: err.message })
      clearTimeout(timeoutId)
      // Ensure tunnel is closed as well
      closeConnection(err)
      reject(err)
      handshakeResolve = null
      handshakeReject = null
    }

    void tls.startHandshake().catch((err) => {
      console.warn(`${logPrefix} tls.startHandshake() threw/rejected`, { error: err.message })
      if (handshakeReject) {
        handshakeReject(err)
      }
    })
  })

  console.log(`${logPrefix} TLS handshake completed successfully`)

  return {
    write: async (data: Uint8Array) => {
      console.log(`${logPrefix} write() called with ${data.length} bytes`)
      if (isClosed) {
        console.warn(`${logPrefix} write() called but connection already closed`, {
          error: closeError?.message,
        })
        throw closeError ?? new Error('Connection is closed')
      }
      await tls.write(data)
    },
    read: (): Promise<Uint8Array | null> => {
      if (readQueue.length > 0) {
        const chunk = readQueue.shift()
        console.log(`${logPrefix} read() returning queued chunk ${chunk ? chunk.length : 0} bytes`)
        return Promise.resolve(chunk ?? null)
      }
      if (isClosed) {
        if (closeError) {
          console.warn(`${logPrefix} read() called after close with error`, {
            error: closeError.message,
          })
          return Promise.reject(closeError)
        }
        console.log(`${logPrefix} read() called after normal close -> null`)
        return Promise.resolve(null)
      }
      console.log(`${logPrefix} read() waiting for data`)
      return new Promise<Uint8Array | null>((resolve) => {
        readResolve = (val: Uint8Array | null) => {
          console.log(
            `${logPrefix} read() resolver invoked with ${val ? `${val.length} bytes` : 'null'}`,
          )
          resolve(val)
        }
      })
    },
    close: () => {
      console.log(`${logPrefix} manual close() called`)
      closeConnection()
    },
  }
}
