import { executableSandboxRuntimeSource } from './executableSandboxRuntime.js'
import { createBrowserSandboxFrame } from './browserSandboxDomHost'
import type { SandboxTransport } from './executableSandbox'
import type { SandboxRuntimeToHostMessage } from './workerSandboxTypes'

const READY_TIMEOUT_MS = 10_000

export async function createBrowserIframeSandboxTransport(id: string): Promise<SandboxTransport> {
  const iframe = createBrowserSandboxFrame({
    id,
    sandboxTokens: ['allow-scripts', 'allow-popups', 'allow-popups-to-escape-sandbox'],
  })
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
  iframe.srcdoc = `<script>\n${executableSandboxRuntimeSource}\n//# sourceURL=BWS_${sourceId}\n</script>`
  const port = await portPromise

  const listeners = new Set<(message: SandboxRuntimeToHostMessage) => void>()
  port.onmessage = (event: MessageEvent<SandboxRuntimeToHostMessage>) => {
    listeners.forEach((listener) => listener(event.data))
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
