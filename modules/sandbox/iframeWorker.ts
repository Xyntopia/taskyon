import { createSandboxedIframe, iframes, interruptExecution } from './iframeRuntime'

const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

interface ExecuteCodeInIframeSimpleOptions {
  id: string
  code: string
  sourceURL?: string
  stopSignal: AbortSignal
}

interface FinalMessage {
  result?: unknown
  error?: string
}

export async function executeCodeInIframeSimple<R = unknown>(
  options: ExecuteCodeInIframeSimpleOptions,
  ...args: unknown[]
): Promise<R> {
  const { id, code, sourceURL = 'sandboxed-code.js', stopSignal } = options

  let iframeEntry = iframes.get(id)
  if (!iframeEntry) {
    iframeEntry = await createSandboxedIframe(id)
  }

  const { port } = iframeEntry

  return new Promise<R>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      const msg = (event.data ?? {}) as FinalMessage
      port.onmessage = null
      if (typeof msg.error === 'string' && msg.error.length > 0) {
        reject(new Error(msg.error))
      } else {
        resolve(msg.result as R)
      }
    }

    port.onmessage = onMessage
    port.start()

    const payload = deepClone({
      code,
      params: args,
      sourceURL,
    })

    port.postMessage(payload)

    const onAbort = () => {
      interruptExecution(id)
      reject(new Error('Execution interrupted', { cause: stopSignal.reason }))
    }

    if (stopSignal.aborted) {
      onAbort()
      return
    }

    stopSignal.addEventListener('abort', onAbort, { once: true })
  })
}
