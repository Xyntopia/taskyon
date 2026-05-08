interface ExecuteCodeInIframeSimpleOptions {
  id: string
  code: string
  sourceURL?: string
  stopSignal: AbortSignal
}

export async function executeCodeInIframeSimple<R = unknown>(
  options: ExecuteCodeInIframeSimpleOptions,
  ...args: unknown[]
): Promise<R> {
  const { Worker } = await import('node:worker_threads')
  const { code, sourceURL = 'sandboxed-code.js', stopSignal } = options
  const workerSource = `
    import { parentPort } from 'node:worker_threads';
    parentPort.on('message', async (payload) => {
      try {
        const code = String(payload?.code ?? '');
        const sourceURL = String(payload?.sourceURL ?? 'sandboxed-code.js');
        const params = Array.isArray(payload?.params) ? payload.params : [];
        const fn = new Function(
          'params',
          \`const userFn = (\${code});\\nreturn userFn(...params);\\n//# sourceURL=\${sourceURL}\`,
        );
        const result = await fn(params);
        parentPort.postMessage({ ok: true, result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        parentPort.postMessage({ ok: false, error: message });
      }
    });
  `
  const worker = new Worker(workerSource, { eval: true })
  return await new Promise<R>((resolve, reject) => {
    const cleanup = () => worker.removeAllListeners()
    worker.once('message', (msg: unknown) => {
      cleanup()
      worker.terminate().catch(() => {})
      const payload = (msg ?? {}) as { ok?: boolean; result?: unknown; error?: string }
      if (payload.ok) resolve(payload.result as R)
      else reject(new Error(payload.error || 'Worker execution failed'))
    })
    worker.once('error', (err) => {
      cleanup()
      worker.terminate().catch(() => {})
      reject(err)
    })
    const onAbort = () => {
      cleanup()
      worker.terminate().catch(() => {})
      reject(new Error('Execution interrupted', { cause: stopSignal.reason }))
    }
    if (stopSignal.aborted) {
      onAbort()
      return
    }
    stopSignal.addEventListener('abort', onAbort, { once: true })
    worker.postMessage({
      code,
      params: args,
      sourceURL,
    })
  })
}

