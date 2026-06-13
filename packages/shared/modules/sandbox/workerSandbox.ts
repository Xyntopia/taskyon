import type {
  ExecuteInWorkerSandboxOptions,
  WorkerSandboxExecuteRequestEnvelope,
  WorkerSandboxRuntime,
} from './workerSandboxTypes'

export type { ExecuteInWorkerSandboxOptions, WorkerSandboxRpcHandlers } from './workerSandboxTypes'

const isBrowserRuntime = (): boolean =>
  typeof window !== 'undefined' && typeof document !== 'undefined'

const cloneArgs = <T>(value: T): T =>
  typeof structuredClone === 'function'
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T)

async function loadWorkerSandboxRuntime(): Promise<WorkerSandboxRuntime> {
  if (isBrowserRuntime()) {
    const { BrowserWorkerSandboxRuntime } = await import('./browserWorkerSandboxRuntime')
    return new BrowserWorkerSandboxRuntime()
  }
  const { NodeWorkerSandboxRuntime } = await import('./nodeWorkerSandboxRuntime')
  return new NodeWorkerSandboxRuntime()
}

function buildWorkerSandboxRequest(
  options: ExecuteInWorkerSandboxOptions,
  args: unknown[],
): WorkerSandboxExecuteRequestEnvelope {
  return {
    request: {
      kind: 'execute',
      code: options.code,
      args: cloneArgs(args),
      sourceURL: options.sourceURL ?? 'worker-sandbox.js',
    },
    messagePort: options.messagePort,
  }
}

export async function executeInWorkerSandbox<R = unknown>(
  options: ExecuteInWorkerSandboxOptions,
  ...args: unknown[]
): Promise<R> {
  const runtime = await loadWorkerSandboxRuntime()
  return await runtime.execute<R>(buildWorkerSandboxRequest(options, args), options)
}
