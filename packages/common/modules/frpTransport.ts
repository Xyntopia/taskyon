import { createDuplexChannel, type Port } from './frpBus.ts'

export type DuplexTransport<TSend, TReceive> = {
  send(message: TSend): void
  subscribe(receive: (message: TReceive) => void): () => void
  close?(): void
}

export function createPortFromTransport<TSend, TReceive = TSend>(
  transport: DuplexTransport<TSend, TReceive>,
): { port: Port<TSend, TReceive>; destroy(): void } {
  const { x: port, y: transportPort } = createDuplexChannel<TSend, TReceive>()
  const unsubscribeIncoming = transport.subscribe((message) => transportPort.send(message))
  const unsubscribeOutgoing = transportPort.receive((message) => transport.send(message))
  return {
    port,
    destroy: () => {
      unsubscribeIncoming()
      unsubscribeOutgoing()
      transport.close?.()
    },
  }
}
