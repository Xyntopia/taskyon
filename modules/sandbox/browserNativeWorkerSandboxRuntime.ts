import type {
  ExecuteInWorkerSandboxOptions,
  WorkerSandboxExecuteRequestEnvelope,
  WorkerSandboxHostToWorkerMessage,
  WorkerSandboxRuntime,
  WorkerSandboxWorkerToHostMessage,
} from './workerSandboxTypes'

const workerSource = `
const pendingRpc = new Map();
let rpcCounter = 0;

function serializeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message || 'Unknown error',
      name: error.name || 'Error',
      stack: typeof error.stack === 'string' ? error.stack : '',
    };
  }
  return { message: String(error), name: 'Error', stack: '' };
}

globalThis.__workerSandboxMessagePort = null;
globalThis.__workerSandboxRpc = (rpcType, ...args) =>
  new Promise((resolve, reject) => {
    const requestId = 'rpc-' + Date.now() + '-' + rpcCounter++;
    pendingRpc.set(requestId, { resolve, reject });
    globalThis.postMessage({ kind: 'rpc-request', requestId, rpcType, args });
  });

globalThis.onmessage = async (event) => {
  const message = event.data || {};

  if (message.kind === 'rpc-result' && typeof message.requestId === 'string') {
    const pending = pendingRpc.get(message.requestId);
    if (!pending) return;
    pendingRpc.delete(message.requestId);
    pending.resolve(message.value);
    return;
  }

  if (message.kind === 'rpc-error' && typeof message.requestId === 'string') {
    const pending = pendingRpc.get(message.requestId);
    if (!pending) return;
    pendingRpc.delete(message.requestId);
    pending.reject(new Error(message.error?.message || 'Worker sandbox RPC failed'));
    return;
  }

  if (message.kind !== 'execute') return;

  globalThis.__workerSandboxMessagePort = event.ports && event.ports[0] ? event.ports[0] : null;
  const code = typeof message.code === 'string' ? message.code : '';
  const args = Array.isArray(message.args) ? message.args : [];
  const sourceURL =
    typeof message.sourceURL === 'string' && message.sourceURL.trim().length > 0
      ? message.sourceURL
      : 'sandboxed-code.js';

  if (!code) {
    globalThis.postMessage({
      kind: 'error',
      error: serializeError(new Error('Missing worker sandbox code')),
    });
    return;
  }

  try {
    const fn = new Function(
      'args',
      'const userFn = (' + code + ');\\nreturn userFn(...args);\\n//# sourceURL=' + sourceURL,
    );
    const result = await fn(args);
    globalThis.postMessage({ kind: 'result', result });
  } catch (error) {
    globalThis.postMessage({ kind: 'error', error: serializeError(error) });
  }
};
`

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

function hydrateError(error: {
  message: string | undefined
  name?: string | undefined
  stack?: string | undefined
}): Error {
  const hydrated = new Error(error.message || 'Worker sandbox failed')
  if (typeof error.name === 'string' && error.name) hydrated.name = error.name
  if (typeof error.stack === 'string' && error.stack) hydrated.stack = error.stack
  return hydrated
}

export class BrowserNativeWorkerSandboxRuntime implements WorkerSandboxRuntime {
  async execute<R = unknown>(
    request: WorkerSandboxExecuteRequestEnvelope,
    options: ExecuteInWorkerSandboxOptions,
  ): Promise<R> {
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }))
    const worker = new Worker(url)

    return await new Promise<R>((resolve, reject) => {
      let settled = false

      const cleanup = () => {
        worker.onmessage = null
        worker.onerror = null
        options.stopSignal.removeEventListener('abort', onAbort)
        worker.terminate()
        URL.revokeObjectURL(url)
      }

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        cleanup()
        fn()
      }

      const onAbort = () => {
        settle(() =>
          reject(new Error('Execution interrupted', { cause: options.stopSignal.reason })),
        )
      }

      const respond = (message: WorkerSandboxHostToWorkerMessage) => {
        worker.postMessage(message)
      }

      worker.onerror = (event) => {
        settle(() => reject(new Error(event.message || 'Worker sandbox failed')))
      }

      worker.onmessage = (event: MessageEvent<WorkerSandboxWorkerToHostMessage>) => {
        const message = event.data
        if (!message) return
        if (message.kind === 'result') {
          settle(() => resolve(message.result as R))
          return
        }
        if (message.kind === 'error') {
          settle(() => reject(hydrateError(message.error)))
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
      worker.postMessage(request.request, transfer)
    })
  }
}
