import { serializeRemoteError } from '../remoteError'
import { createBrowserSandboxFrame } from './browserSandboxDomHost'
import type { SandboxTransport } from './executableSandbox'
import { executableSandboxRuntimeSource } from './executableSandboxRuntime.js'
import type { SandboxRuntimeToHostMessage } from './workerSandboxTypes'

const READY_TIMEOUT_MS = 10_000

const iframeBootstrapSource = (runtimeSource: string) => `
const runtimeUrl = URL.createObjectURL(
  new Blob([${JSON.stringify(runtimeSource)}], { type: 'application/javascript' }),
);
const worker = new Worker(runtimeUrl);
URL.revokeObjectURL(runtimeUrl);
const hostChannel = new MessageChannel();
const workerChannel = new MessageChannel();
hostChannel.port1.onmessage = (event) => workerChannel.port1.postMessage(event.data);
workerChannel.port1.onmessage = (event) => hostChannel.port1.postMessage(event.data);
hostChannel.port1.start();
workerChannel.port1.start();
worker.onerror = (event) => hostChannel.port1.postMessage({
  kind: 'runtime-error',
  error: { message: event.message || 'Sandbox worker failed', name: 'Error', stack: '' },
});
worker.postMessage({ kind: 'connect' }, [workerChannel.port2]);
window.parent.postMessage({ ready: true }, '*', [hostChannel.port2]);
`

export async function createBrowserIframeSandboxTransport(id: string): Promise<SandboxTransport> {
  const iframe = createBrowserSandboxFrame({ id, sandboxTokens: ['allow-scripts'] })
  const sourceId = id.replace(/[^A-Za-z0-9_.:-]/g, '_')
  const portPromise = new Promise<MessagePort>((resolve, reject) => {
    const onReady = (event: MessageEvent) => {
      if (!event.data?.ready || event.source !== iframe.contentWindow) return
      const [readyPort] = event.ports || []
      if (!readyPort) return
      clearTimeout(timeout)
      window.removeEventListener('message', onReady)
      resolve(readyPort)
    }
    const timeout = window.setTimeout(() => {
      window.removeEventListener('message', onReady)
      iframe.remove()
      reject(new Error(`Browser sandbox did not become ready within ${READY_TIMEOUT_MS}ms`))
    }, READY_TIMEOUT_MS)
    window.addEventListener('message', onReady)
  })
  const csp = [
    "default-src 'none'",
    "connect-src 'none'",
    "img-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    'worker-src blob:',
    "script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:",
  ].join('; ')
  iframe.srcdoc = `<meta http-equiv="Content-Security-Policy" content="${csp}"><script>\n${iframeBootstrapSource(executableSandboxRuntimeSource)}\n//# sourceURL=BWS_${sourceId}\n</script>`
  const port = await portPromise

  const listeners = new Set<(message: SandboxRuntimeToHostMessage) => void>()
  port.onmessage = (event: MessageEvent<SandboxRuntimeToHostMessage>) => {
    listeners.forEach((listener) => listener(event.data))
  }
  port.onmessageerror = () => {
    const message: SandboxRuntimeToHostMessage = {
      kind: 'runtime-error',
      error: serializeRemoteError(new Error('Browser sandbox returned an invalid message')),
    }
    listeners.forEach((listener) => listener(message))
  }
  port.start()

  return {
    send: (message) => port.postMessage(message),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    terminate: () => {
      listeners.clear()
      port.close()
      iframe.remove()
    },
  }
}
