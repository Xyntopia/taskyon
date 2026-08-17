import type { Hash } from '@taskyon/comp-dag/caching'
import type { SavedStoredGraphNode, StoredGraphNodeFile } from '@taskyon/comp-dag/dagNodeLoader'

export type StoredGraphNodeLoaderRequest = {
  type: 'load'
  requestId: number
  files: readonly StoredGraphNodeFile[]
}

export type StoredGraphNodeLoaderResponse =
  | {
      type: 'loaded'
      requestId: number
      nodes: Record<Hash, SavedStoredGraphNode>
    }
  | { type: 'load-error'; requestId: number; message: string; stack?: string }

const isResponse = (value: unknown): value is StoredGraphNodeLoaderResponse => {
  if (!value || typeof value !== 'object') return false
  const type = Reflect.get(value, 'type')
  const requestId = Reflect.get(value, 'requestId')
  if (!Number.isInteger(requestId)) return false
  if (type === 'loaded') return typeof Reflect.get(value, 'nodes') === 'object'
  return type === 'load-error' && typeof Reflect.get(value, 'message') === 'string'
}

export const createBrowserStoredGraphNodeLoader = (
  onLoad?: (event: { fileCount: number; durationMs: number }) => void,
) => {
  let worker: Worker | undefined
  let requestId = 0
  const pending = new Map<
    number,
    {
      resolve: (nodes: Record<Hash, SavedStoredGraphNode>) => void
      reject: (error: Error) => void
      fileCount: number
      startedAt: number
    }
  >()
  const rejectPending = (error: Error) => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  const requireWorker = () => {
    if (worker) return worker
    worker = new Worker(new URL('./storedGraphNodeLoader.worker.ts', import.meta.url), {
      type: 'module',
      name: 'taskyon-stored-graph-node-loader',
    })
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (!isResponse(event.data)) return
      const request = pending.get(event.data.requestId)
      if (!request) return
      pending.delete(event.data.requestId)
      if (event.data.type === 'loaded') {
        onLoad?.({
          fileCount: request.fileCount,
          durationMs: performance.now() - request.startedAt,
        })
        request.resolve(event.data.nodes)
      } else {
        const error = new Error(event.data.message)
        if (event.data.stack) error.stack = event.data.stack
        request.reject(error)
      }
    }
    worker.onerror = (event) => {
      rejectPending(new Error(event.message || 'The stored graph node loader worker failed.'))
      worker?.terminate()
      worker = undefined
    }
    return worker
  }
  return {
    load: (files: readonly StoredGraphNodeFile[]) =>
      new Promise<Record<Hash, SavedStoredGraphNode>>((resolve, reject) => {
        const id = ++requestId
        pending.set(id, {
          resolve,
          reject,
          fileCount: files.length,
          startedAt: performance.now(),
        })
        requireWorker().postMessage({ type: 'load', requestId: id, files })
      }),
    stop: () => {
      rejectPending(new Error('The stored graph node loader worker was stopped.'))
      worker?.terminate()
      worker = undefined
    },
  }
}
