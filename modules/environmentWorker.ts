export {}

import { executeInWorkerSandbox } from './sandbox/workerSandbox'

export type EnvironmentWorkerLike<Request, Response> = {
  onmessage: ((event: MessageEvent<Response>) => void) | null
  onerror: ((event: ErrorEvent) => void) | null
  postMessage: (request: Request, transfer?: Transferable[]) => void
  terminate: () => void
}

type EnvironmentWorkerOptions<Request, Response> = {
  id?: string
  browserRuntime?: 'iframe' | 'worker'
  createBrowserWorker?: () => Worker
  handleRequest: (
    request: Request,
    postMessage: (response: Response) => void,
  ) => void | Promise<void>
}

let environmentWorkerRunCounter = 0

const hasBrowserRuntime = (): boolean =>
  typeof window !== 'undefined' && typeof document !== 'undefined'

const makeMessageEvent = <T>(data: T): MessageEvent<T> => {
  if (typeof MessageEvent !== 'undefined') return new MessageEvent('message', { data })
  return { data } as MessageEvent<T>
}

const makeErrorEvent = (error: unknown): ErrorEvent => {
  const message = error instanceof Error ? error.message : String(error)
  if (typeof ErrorEvent !== 'undefined') return new ErrorEvent('error', { message })
  return { message, error } as ErrorEvent
}

const buildSandboxBridgeCode = (): string => {
  return `
async (request) => {
  return await globalThis.__workerSandboxRpc('environmentWorker:handleRequest', request);
}
`.trim()
}

export const createEnvironmentWorker = <Request, Response>(
  options: EnvironmentWorkerOptions<Request, Response>,
): EnvironmentWorkerLike<Request, Response> => {
  if (hasBrowserRuntime() && options.browserRuntime === 'worker' && options.createBrowserWorker) {
    return options.createBrowserWorker() as EnvironmentWorkerLike<Request, Response>
  }

  let terminated = false
  const activeRuns = new Set<AbortController>()
  const workerId = options.id ?? `environment-worker-${Date.now()}-${environmentWorkerRunCounter++}`

  const local: EnvironmentWorkerLike<Request, Response> = {
    onmessage: null,
    onerror: null,
    postMessage(request, _transfer) {
      if (terminated) return
      queueMicrotask(() => {
        const controller = new AbortController()
        activeRuns.add(controller)

        void executeInWorkerSandbox<Response[]>(
          {
            id: `${workerId}-${environmentWorkerRunCounter++}`,
            code: buildSandboxBridgeCode(),
            sourceURL: `${workerId}.environment-worker.js`,
            stopSignal: controller.signal,
            browserRuntime: options.browserRuntime,
            rpcHandlers: {
              'environmentWorker:handleRequest': async (sandboxRequest) => {
                const responses: Response[] = []
                await options.handleRequest(sandboxRequest as Request, (response) => {
                  responses.push(response)
                })
                return responses
              },
            },
          },
          request,
        )
          .then((responses) => {
            if (terminated) return
            for (const response of responses) {
              local.onmessage?.(makeMessageEvent(response))
            }
          })
          .catch((error) => {
            if (!terminated) local.onerror?.(makeErrorEvent(error))
          })
          .finally(() => {
            activeRuns.delete(controller)
          })
      })
    },
    terminate() {
      terminated = true
      for (const controller of activeRuns) {
        controller.abort('Environment worker terminated')
      }
      activeRuns.clear()
    },
  }
  return local
}
