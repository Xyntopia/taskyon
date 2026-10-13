import assert from 'node:assert/strict'
import { test } from 'node:test'
import { WsProxyCloseCode, WsProxyCloseError } from '@taskyon/common/modules/wsProxyClose'
import { openWebSocketConnection, type WebSocketConstructor } from './tls-websocket.ts'

class FakeWebSocket {
  static readonly instances: FakeWebSocket[] = []

  readyState = 0
  binaryType = 'blob'
  onopen?: () => void
  onerror?: () => void
  onmessage?: (event: { data: ArrayBuffer }) => void
  onclose?: (event: { code: number; reason: string }) => void

  constructor() {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => {
      this.readyState = 1
      this.onopen?.()
    })
  }

  send(_data: Uint8Array) {}

  close() {
    this.readyState = 3
    queueMicrotask(() => this.onclose?.({ code: 1000, reason: 'complete' }))
  }
}

void test('Tunnel write keeps the server close code when the close event lags the socket state', async () => {
  const connection = await openWebSocketConnection(
    'ws://127.0.0.1:1/ws-proxy',
    'target.example',
    80,
    'fixture-token',
    FakeWebSocket as unknown as WebSocketConstructor,
  )
  const socket = FakeWebSocket.instances.at(-1)
  assert(socket)

  // The socket leaves OPEN before the close event is dispatched, as the browser WebSocket
  // implementation does when it receives a close frame.
  socket.readyState = 2
  queueMicrotask(() => {
    socket.readyState = 3
    socket.onclose?.({ code: WsProxyCloseCode.InternalError, reason: 'tunnel setup failed' })
  })

  await assert.rejects(
    () => connection.write(new Uint8Array([1])),
    (error: unknown) => {
      assert.ok(
        error instanceof WsProxyCloseError,
        `expected WsProxyCloseError, got ${String(error)}`,
      )
      assert.equal(error.code, WsProxyCloseCode.InternalError)
      assert.equal(error.reason, 'tunnel setup failed')
      return true
    },
  )
})
