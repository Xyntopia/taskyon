import { createPortFromTransport, type DuplexTransport } from './frpTransport.ts'
import { createPortFromMessagePort } from './frpBusWeb.ts'

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message)
}

export const testFrpTransportConnectsWithoutRuntimeDependencies = () => {
  const listeners = new Set<(message: number) => void>()
  const sent: string[] = []
  let closed = false
  const transport: DuplexTransport<string, number> = {
    send: (message) => sent.push(message),
    subscribe: (receive) => {
      listeners.add(receive)
      return () => listeners.delete(receive)
    },
    close: () => {
      closed = true
    },
  }
  const connection = createPortFromTransport(transport)
  const received: number[] = []
  const unsubscribe = connection.port.receive((message) => {
    received.push(message)
  })

  connection.port.send('outgoing')
  listeners.forEach((receive) => receive(42))

  assert(sent.length === 1 && sent[0] === 'outgoing', 'Expected transport-bound output.')
  assert(received.length === 1 && received[0] === 42, 'Expected transport-bound input.')
  connection.destroy()
  unsubscribe()
  assert(listeners.size === 0, 'Expected the transport subscription to be removed.')
  assert(closed, 'Expected the transport to close.')
  return { success: true }
}

testFrpTransportConnectsWithoutRuntimeDependencies.description =
  'Connects a structural duplex transport to FRP without browser or sandbox dependencies.'

export const testFrpMessagePortAdapterRoundTrips = async () => {
  const { port1, port2 } = new MessageChannel()
  const connection = createPortFromMessagePort<string, number>(port1)
  const incoming = connection.port.receive.wait({ timeoutMs: 1_000 })
  const outgoing = new Promise<string>((resolve) => {
    port2.onmessage = (event: MessageEvent<string>) => resolve(event.data)
  })
  port2.start()

  port2.postMessage(42)
  connection.port.send('outgoing')

  assert((await incoming) === 42, 'Expected a MessagePort value to enter the FRP port.')
  assert((await outgoing) === 'outgoing', 'Expected an FRP value to enter the MessagePort.')
  connection.destroy()
  port2.close()
  return { success: true }
}

testFrpMessagePortAdapterRoundTrips.description =
  'Keeps native MessagePort behavior in the downstream browser adapter.'
