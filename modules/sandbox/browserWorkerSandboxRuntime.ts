import * as rawSandboxSource from './browserWorkerSandboxSource?raw'
import { createBrowserSandboxFrame } from './browserSandboxDomHost'
import type {
  ExecuteInWorkerSandboxOptions,
  WorkerSandboxExecuteRequestEnvelope,
  WorkerSandboxHostToWorkerMessage,
  WorkerSandboxRuntime,
  WorkerSandboxWorkerToHostMessage,
} from './workerSandboxTypes'

const browserWorkerSandboxSource = rawSandboxSource.default ?? rawSandboxSource

type BrowserSandboxEntry = {
  iframe: HTMLIFrameElement
  port: MessagePort
}

const browserSandboxFrames = new Map<string, BrowserSandboxEntry>()

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function serializeError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message || 'Unknown error',
      name: error.name || 'Error',
      stack: typeof error.stack === 'string' ? error.stack : '',
    }
  }
  return {
    message: String(error),
    name: 'Error',
  }
}

async function createBrowserSandbox(
  id: string,
): Promise<{ iframe: HTMLIFrameElement; port: MessagePort }> {
  const iframe = createBrowserSandboxFrame({
    id,
    sandboxTokens: ['allow-scripts', 'allow-popups', 'allow-popups-to-escape-sandbox'],
  })

  iframe.srcdoc = `<script>\nwindow.id = "${id}";\n${browserWorkerSandboxSource}\n//# sourceURL=BWS_${id}\n</script>`

  const ready = await new Promise<{ iframe: HTMLIFrameElement; port: MessagePort }>((resolve) => {
    const onReady = (event: MessageEvent) => {
      if (!event.data?.ready || event.source !== iframe.contentWindow) return
      const [port] = event.ports || []
      if (!port) return
      window.removeEventListener('message', onReady)
      port.start()
      browserSandboxFrames.set(id, { iframe, port })
      resolve({ iframe, port })
    }
    window.addEventListener('message', onReady)
  })

  await sleep(100)
  return ready
}

function destroyBrowserSandbox(id: string): void {
  const entry = browserSandboxFrames.get(id)
  if (!entry) return
  try {
    entry.port.close()
  } catch {
    // ignore
  }
  document.body.removeChild(entry.iframe)
  browserSandboxFrames.delete(id)
}

export class BrowserWorkerSandboxRuntime implements WorkerSandboxRuntime {
  async execute<R = unknown>(
    request: WorkerSandboxExecuteRequestEnvelope,
    options: ExecuteInWorkerSandboxOptions,
  ): Promise<R> {
    let entry = browserSandboxFrames.get(options.id)
    if (!entry) {
      entry = await createBrowserSandbox(options.id)
    }

    const { port } = entry
    return await new Promise<R>((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        port.onmessage = null
        options.stopSignal.removeEventListener('abort', onAbort)
      }

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        fn()
      }

      const onAbort = () => {
        destroyBrowserSandbox(options.id)
        settle(() =>
          reject(new Error('Execution interrupted', { cause: options.stopSignal.reason })),
        )
      }

      const respond = (message: WorkerSandboxHostToWorkerMessage) => {
        port.postMessage(message)
      }

      port.onmessage = (event: MessageEvent<WorkerSandboxWorkerToHostMessage>) => {
        const message = event.data
        if (!message) return
        if (message.kind === 'result') {
          settle(() => resolve(message.result as R))
          return
        }
        if (message.kind === 'error') {
          settle(() => reject(new Error(message.error.message || 'Worker sandbox failed')))
          return
        }
        if (message.kind !== 'rpc-request') return

        const handler = options.rpcHandlers?.[message.rpcType]
        if (typeof handler !== 'function') {
          respond({
            kind: 'rpc-error',
            requestId: message.requestId,
            error: {
              message: `Worker sandbox RPC "${message.rpcType}" not found`,
              name: 'Error',
            },
          })
          return
        }

        void Promise.resolve(handler(...message.args))
          .then((value) => {
            respond({
              kind: 'rpc-result',
              requestId: message.requestId,
              value,
            })
          })
          .catch((error: unknown) => {
            respond({
              kind: 'rpc-error',
              requestId: message.requestId,
              error: serializeError(error),
            })
          })
      }

      if (options.stopSignal.aborted) {
        onAbort()
        return
      }

      options.stopSignal.addEventListener('abort', onAbort, { once: true })
      const transfer = request.messagePort ? [request.messagePort] : []
      port.start()
      port.postMessage(request.request, transfer)
    })
  }
}
