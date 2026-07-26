export {}

import { defineFrpServiceProtocol } from './frpBus.ts'
import { createSandboxProtocolClient, serveFrpSandboxCapability } from './sandbox/frpSandbox.ts'
import { createExecutableSandbox } from './sandbox/workerSandbox'
import { z } from 'zod'

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
  const createProtocolClientSource = createSandboxProtocolClient.toString()
  return `
async (request) => {
  if (!sandboxApi.port) throw new Error('Environment worker protocol port is unavailable');
  const client = (${createProtocolClientSource})(
    sandboxApi.port,
    'environmentWorker',
    sandboxApi.signal,
  );
  return await client.call('handleRequest', { request });
}
`.trim()
}

const environmentWorkerProtocol = defineFrpServiceProtocol({
  service: 'environmentWorker',
  version: '1',
  commands: {
    handleRequest: {
      request: z.object({ request: z.unknown() }),
      response: z.array(z.unknown()),
    },
  },
})

export const createEnvironmentWorker = <Request, Response>(
  options: EnvironmentWorkerOptions<Request, Response>,
): EnvironmentWorkerLike<Request, Response> => {
  if (hasBrowserRuntime() && options.browserRuntime === 'worker' && options.createBrowserWorker) {
    return options.createBrowserWorker() as EnvironmentWorkerLike<Request, Response>
  }

  let terminated = false
  const activeRuns = new Set<AbortController>()
  const workerId = options.id ?? `environment-worker-${Date.now()}-${environmentWorkerRunCounter++}`
  const sandbox = createExecutableSandbox({
    id: workerId,
    ...(options.browserRuntime === undefined ? {} : { browserRuntime: options.browserRuntime }),
  })

  const local: EnvironmentWorkerLike<Request, Response> = {
    onmessage: null,
    onerror: null,
    postMessage(request, transfer) {
      void transfer
      if (terminated) return
      queueMicrotask(() => {
        const controller = new AbortController()
        activeRuns.add(controller)

        void sandbox
          .then(async (executable) => {
            const capability = await serveFrpSandboxCapability({
              sandbox: executable,
              protocol: environmentWorkerProtocol,
              signal: controller.signal,
              handlers: {
                environmentWorker: {
                  handleRequest: async ({ request: sandboxRequest }) => {
                    const responses: Response[] = []
                    await options.handleRequest(sandboxRequest as Request, (response) => {
                      responses.push(response)
                    })
                    return responses
                  },
                },
              },
            })
            try {
              return await executable.execute<Response[]>(buildSandboxBridgeCode(), [request], {
                signal: controller.signal,
                sourceURL: `${workerId}.environment-worker.js`,
                channel: capability.channel,
              })
            } finally {
              capability.destroy()
            }
          })
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
      void sandbox.then((executable) => executable.terminate('Environment worker terminated'))
    },
  }
  return local
}
