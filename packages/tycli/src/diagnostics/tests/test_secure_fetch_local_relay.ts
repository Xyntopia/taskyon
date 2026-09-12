import { createServer } from 'node:http'
import { connect, type Socket } from 'node:net'
import { secureFetch, type WebSocketConstructor } from '@taskyon/secure-tunnel'
import { createNodeRustlsClientFactory } from '@taskyon/https-tunnel-wasm/node'
import { WebSocket, WebSocketServer } from 'ws'

const allowedDestinations = new Set(['example.com:80', 'example.com:443'])

const closeSocket = (socket: Socket | undefined) => {
  if (socket && !socket.destroyed) socket.destroy()
}

export const testSecureFetchRustTlsThroughLocalRelay = async () => {
  const server = createServer()
  const webSockets = new WebSocketServer({ noServer: true })
  server.on('upgrade', (request, socket, head) => {
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      webSockets.emit('connection', webSocket, request)
    })
  })
  webSockets.on('connection', (webSocket, request) => {
    const url = new URL(request.url ?? '/', 'ws://127.0.0.1')
    const host = url.searchParams.get('host') ?? ''
    const port = Number(url.searchParams.get('port'))
    const protocols = new Set(
      (request.headers['sec-websocket-protocol'] ?? '').split(',').map((value) => value.trim()),
    )
    if (
      !protocols.has('taskyon-tunnel-v1') ||
      !protocols.has('bearer.synthetic') ||
      !allowedDestinations.has(`${host}:${port}`)
    ) {
      webSocket.close(4401, 'unauthorized synthetic relay request')
      return
    }

    const target = connect(port, host)
    target.on('data', (bytes) => webSocket.send(bytes))
    target.on('end', () => webSocket.close(4500, 'tcp closed'))
    target.on('error', () => webSocket.close(4500, 'tcp error'))
    webSocket.on('message', (bytes) => target.write(Buffer.from(bytes as ArrayBuffer)))
    webSocket.on('close', () => closeSocket(target))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Local relay did not bind')
    const tunnelUrl = `ws://127.0.0.1:${address.port}/tunnel`
    const tlsClientFactory = await createNodeRustlsClientFactory()
    const webSocket = WebSocket as unknown as WebSocketConstructor
    const fetchThroughRelay = (url: string) =>
      secureFetch(url, {
        tunnelUrl,
        tunnelToken: 'synthetic',
        tlsClientFactory,
        webSocket,
      })

    const [httpResponse, httpsResponse] = await Promise.all([
      fetchThroughRelay('http://example.com/'),
      fetchThroughRelay('https://example.com/'),
    ])
    const [httpBody, httpsBody] = await Promise.all([httpResponse.text(), httpsResponse.text()])
    if (httpResponse.status !== 200 || !httpBody.includes('Example Domain')) {
      throw new Error(`Rust tunnel HTTP check failed with status ${httpResponse.status}`)
    }
    if (httpsResponse.status !== 200 || !httpsBody.includes('Example Domain')) {
      throw new Error(`Rust tunnel HTTPS check failed with status ${httpsResponse.status}`)
    }
    return { http: httpResponse.status, https: httpsResponse.status, rustTls: true }
  } finally {
    for (const webSocket of webSockets.clients) webSocket.terminate()
    webSockets.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}

testSecureFetchRustTlsThroughLocalRelay.description =
  'Fetches HTTP and HTTPS through a test-only local WebSocket relay, terminating HTTPS in Rustls WASM.'
