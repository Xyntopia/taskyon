import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type {
  ExecuteInWorkerSandboxOptions,
  WorkerSandboxExecuteRequestEnvelope,
  WorkerSandboxHostToWorkerMessage,
  WorkerSandboxRuntime,
  WorkerSandboxWorkerToHostMessage,
} from './workerSandboxTypes'

const NODE_WORKER_SANDBOX_RUNNER = fileURLToPath(
  new URL('./nodeWorkerSandboxRunner.mjs', import.meta.url),
)

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

function killChildProcess(child: ChildProcess): void {
  if (child.killed) return
  try {
    child.kill('SIGKILL')
  } catch {
    // ignore
  }
}

export class NodeWorkerSandboxRuntime implements WorkerSandboxRuntime {
  async execute<R = unknown>(
    request: WorkerSandboxExecuteRequestEnvelope,
    options: ExecuteInWorkerSandboxOptions,
  ): Promise<R> {
    const child = spawn(process.execPath, [NODE_WORKER_SANDBOX_RUNNER], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })

    return await new Promise<R>((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        options.stopSignal.removeEventListener('abort', onAbort)
        child.removeListener('message', onMessage)
        child.removeListener('error', onError)
        child.removeListener('exit', onExit)
      }

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        fn()
      }

      const onAbort = () => {
        killChildProcess(child)
        settle(() =>
          reject(new Error('Execution interrupted', { cause: options.stopSignal.reason })),
        )
      }

      const onError = (error: Error) => {
        killChildProcess(child)
        settle(() => reject(error))
      }

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        settle(() =>
          reject(
            new Error(
              `Worker sandbox subprocess exited before sending a result (code=${String(code)}, signal=${String(signal)})`,
            ),
          ),
        )
      }

      const respond = (message: WorkerSandboxHostToWorkerMessage) => {
        child.send(message)
      }

      const onMessage = (message: WorkerSandboxWorkerToHostMessage) => {
        if (!message) return
        if (message.kind === 'result') {
          killChildProcess(child)
          settle(() => resolve(message.result as R))
          return
        }
        if (message.kind === 'error') {
          killChildProcess(child)
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
      child.on('message', onMessage)
      child.on('error', onError)
      child.on('exit', onExit)
      child.send(request.request)
    })
  }
}
