import {
  createDuplexChannel,
  type Port,
  type Unsubscribe,
} from '../../shared/modules/frpBus'
import {
  createP2pManager,
  type CreateP2pManagerOptions,
  type ManagedSubnetwork,
  type P2pChatMessage,
  type P2pManager,
  type P2pManagerEvent,
  type P2pManagerSnapshot,
} from './p2pManager'

export type P2pBusCommand =
  | { type: 'p2p.start' }
  | { type: 'p2p.restart' }
  | { type: 'p2p.stop' }
  | { type: 'p2p.joinFixtureNetwork' }
  | { type: 'p2p.setActiveSubnetwork'; id: string }
  | { type: 'p2p.addSubnetwork'; input?: Partial<ManagedSubnetwork> }
  | {
      type: 'p2p.updateSubnetwork'
      id: string
      patch: Partial<Pick<ManagedSubnetwork, 'name' | 'secret' | 'relayAddrs'>>
    }
  | { type: 'p2p.removeSubnetwork'; id: string }
  | { type: 'p2p.setManualDialAddr'; addr: string }
  | { type: 'p2p.dialCurrentRelay' }
  | { type: 'p2p.dialAddress'; addr: string }
  | { type: 'p2p.clearLogs' }
  | { type: 'p2p.setVerboseLogsEnabled'; enabled: boolean }
  | { type: 'p2p.chat.send'; body: string; subnetworkId?: string }

export type P2pBusEvent =
  | { type: 'p2p.state'; snapshot: P2pManagerSnapshot }
  | { type: 'p2p.log'; message: string }
  | { type: 'p2p.error'; message: string }
  | { type: 'p2p.chat.message'; message: P2pChatMessage }

export type P2pBus = {
  port: Port<P2pBusCommand, P2pBusEvent>
  manager: P2pManager
  destroy: () => void
}

function forwardManagerEvent(
  event: P2pManagerEvent,
  emit: (event: P2pBusEvent) => void,
) {
  switch (event.type) {
    case 'log':
      emit({ type: 'p2p.log', message: event.message })
      break
    case 'error':
      emit({ type: 'p2p.error', message: event.message })
      break
    case 'chatMessage':
      emit({ type: 'p2p.chat.message', message: event.message })
      break
    default:
      break
  }
}

export function createP2pBus(
  options: CreateP2pManagerOptions & {
    manager?: P2pManager
  } = {},
): P2pBus {
  const manager = options.manager ?? createP2pManager(options)
  const { x: port, y: internalPort } = createDuplexChannel<P2pBusCommand, P2pBusEvent>()

  const unsubs: Unsubscribe[] = []

  unsubs.push(
    manager.stateStream((snapshot) => {
      internalPort.send({ type: 'p2p.state', snapshot })
    }),
  )
  unsubs.push(
    manager.eventStream((event) => {
      forwardManagerEvent(event, internalPort.send)
    }),
  )
  unsubs.push(
    internalPort.receive((command) => {
      switch (command.type) {
        case 'p2p.start':
          void manager.start()
          break
        case 'p2p.restart':
          void manager.restart()
          break
        case 'p2p.stop':
          void manager.stop()
          break
        case 'p2p.joinFixtureNetwork':
          void manager.joinFixtureNetwork()
          break
        case 'p2p.setActiveSubnetwork':
          manager.setActiveSubnetwork(command.id)
          break
        case 'p2p.addSubnetwork':
          void manager.addSubnetwork(command.input)
          break
        case 'p2p.updateSubnetwork':
          void manager.updateSubnetwork(command.id, command.patch)
          break
        case 'p2p.removeSubnetwork':
          manager.removeSubnetwork(command.id)
          break
        case 'p2p.setManualDialAddr':
          manager.setManualDialAddr(command.addr)
          break
        case 'p2p.dialCurrentRelay':
          void manager.dialCurrentRelay()
          break
        case 'p2p.dialAddress':
          void manager.dialAddress(command.addr)
          break
        case 'p2p.clearLogs':
          manager.clearLogs()
          break
        case 'p2p.setVerboseLogsEnabled':
          manager.setVerboseLogsEnabled(command.enabled)
          break
        case 'p2p.chat.send':
          void manager.sendChatMessage(command.body, command.subnetworkId)
          break
      }
    }),
  )

  internalPort.send({ type: 'p2p.state', snapshot: manager.getSnapshot() })

  return {
    port,
    manager,
    destroy: () => {
      unsubs.forEach((unsub) => unsub())
    },
  }
}
