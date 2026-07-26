import { executableSandboxRuntimeSource } from './executableSandboxRuntime.js'
import { serializeRemoteError } from '../remoteError'
import type { SandboxTransport } from './executableSandbox'
import type { SandboxRuntimeToHostMessage } from './workerSandboxTypes'

export function createBrowserWorkerSandboxTransport(): SandboxTransport {
  const url = URL.createObjectURL(
    new Blob([executableSandboxRuntimeSource], { type: 'text/javascript' }),
  )
  const worker = new Worker(url)
  const channel = new MessageChannel()
  const listeners = new Set<(message: SandboxRuntimeToHostMessage) => void>()

  channel.port1.onmessage = (event: MessageEvent<SandboxRuntimeToHostMessage>) => {
    listeners.forEach((listener) => listener(event.data))
  }
  channel.port1.start()
  worker.onerror = (event) => {
    const message: SandboxRuntimeToHostMessage = {
      kind: 'runtime-error',
      error: serializeRemoteError(new Error(event.message || 'Worker sandbox failed')),
    }
    listeners.forEach((listener) => listener(message))
  }
  worker.postMessage({ kind: 'connect' }, [channel.port2])

  return {
    send: (message) => channel.port1.postMessage(message),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    terminate: () => {
      listeners.clear()
      channel.port1.close()
      worker.terminate()
      URL.revokeObjectURL(url)
    },
  }
}
