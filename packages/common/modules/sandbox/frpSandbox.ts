import {
  createPortClient,
  createPortServer,
  parseProtocolMessage,
  type FrpProtocolDefinition,
  type ProtocolClient,
  type ProtocolMessage,
  type ProtocolServerHandlers,
} from '../frpBus.ts'
import { createPortFromTransport } from '../frpTransport.ts'
import type { ExecutableSandbox, SandboxChannel } from './executableSandbox.ts'
import type { ZodType } from 'zod'

export async function connectFrpSandboxService<
  const TProtocol extends FrpProtocolDefinition<
    Record<string, unknown>,
    Record<string, unknown>,
    ZodType | undefined
  >,
>(options: {
  sandbox: ExecutableSandbox
  protocol: TProtocol
  installerSource: string
  installerArgs?: readonly unknown[] | undefined
  signal?: AbortSignal | undefined
}): Promise<{ client: ProtocolClient<TProtocol>; destroy(): void }> {
  const channel = await options.sandbox.openChannel(
    options.installerSource,
    options.installerArgs,
    { signal: options.signal },
  )
  const protocolChannel = {
    send: (message: ProtocolMessage<TProtocol>) => channel.send(message),
    subscribe: (receive: (message: ProtocolMessage<TProtocol>) => void) =>
      channel.subscribe((message) => {
        try {
          receive(parseProtocolMessage(options.protocol, message))
        } catch (error) {
          console.warn('Ignoring an invalid sandbox service message.', error)
        }
      }),
    close: () => channel.close(),
  }
  const connection = createPortFromTransport<
    ProtocolMessage<TProtocol>,
    ProtocolMessage<TProtocol>
  >(protocolChannel)
  return {
    client: createPortClient(connection.port, options.protocol),
    destroy: () => connection.destroy(),
  }
}

export async function serveFrpSandboxCapability<
  const TProtocol extends FrpProtocolDefinition<
    Record<string, unknown>,
    Record<string, unknown>,
    ZodType | undefined
  >,
>(options: {
  sandbox: ExecutableSandbox
  protocol: TProtocol
  handlers: ProtocolServerHandlers<TProtocol>
  signal?: AbortSignal | undefined
}): Promise<{ channel: SandboxChannel; destroy(): void }> {
  const channel = await options.sandbox.openChannel('() => undefined', [], {
    signal: options.signal,
  })
  const protocolTransport = {
    send: (message: ProtocolMessage<TProtocol>) => channel.send(message),
    subscribe: (receive: (message: ProtocolMessage<TProtocol>) => void) =>
      channel.subscribe((message) => {
        try {
          receive(parseProtocolMessage(options.protocol, message))
        } catch (error) {
          console.warn('Ignoring an invalid sandbox capability message.', error)
        }
      }),
    close: () => channel.close(),
  }
  const connection = createPortFromTransport(protocolTransport)
  const unsubscribe = createPortServer(connection.port, options.protocol, options.handlers)
  return {
    channel,
    destroy: () => {
      unsubscribe()
      connection.destroy()
    },
  }
}

export function createSandboxProtocolClient(
  port: {
    postMessage(message: unknown): void
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
    removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void
    start(): void
  },
  service: string,
  signal: AbortSignal,
) {
  let requestCounter = 0
  const call = (command: string, payload: Record<string, unknown> = {}) => {
    const requestId = `${service}-${Date.now()}-${requestCounter++}`
    const responseType = `${service}.${command}Response`
    return new Promise<unknown>((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener('abort', abort)
        port.removeEventListener('message', receive)
      }
      const abort = () => {
        cleanup()
        const error = new Error(String(signal.reason ?? 'Protocol request cancelled'))
        error.name = 'AbortError'
        reject(error)
      }
      const receive = (event: { data: unknown }) => {
        const message = event.data
        if (typeof message !== 'object' || message === null) return
        if (!('type' in message) || !('requestId' in message)) return
        if (message.type !== responseType || message.requestId !== requestId) return
        cleanup()
        if ('error' in message && message.error) {
          const remote = message.error
          const error = new Error(
            typeof remote === 'object' && remote !== null && 'message' in remote
              ? String(remote.message)
              : 'Remote protocol request failed',
          )
          if (typeof remote === 'object' && remote !== null) {
            if ('name' in remote && typeof remote.name === 'string') error.name = remote.name
            if ('stack' in remote && typeof remote.stack === 'string') error.stack = remote.stack
          }
          reject(error)
          return
        }
        resolve('result' in message ? message.result : undefined)
      }
      if (signal.aborted) {
        abort()
        return
      }
      port.addEventListener('message', receive)
      signal.addEventListener('abort', abort, { once: true })
      port.postMessage({ ...payload, type: `${service}.${command}Request`, requestId })
    })
  }
  port.start()
  return { call }
}
