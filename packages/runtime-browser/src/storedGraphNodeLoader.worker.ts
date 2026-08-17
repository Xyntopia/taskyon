import { loadStoredGraphNodeFiles } from '@taskyon/comp-dag/dagNodeLoader'
import type {
  StoredGraphNodeLoaderRequest,
  StoredGraphNodeLoaderResponse,
} from './storedGraphNodeLoader'

export const handleStoredGraphNodeLoaderRequest = async (
  request: StoredGraphNodeLoaderRequest,
  postMessage: (response: StoredGraphNodeLoaderResponse) => void,
) => {
  if (request.type !== 'load') return
  try {
    postMessage({
      type: 'loaded',
      requestId: request.requestId,
      nodes: await loadStoredGraphNodeFiles(request.files),
    })
  } catch (error) {
    postMessage({
      type: 'load-error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    })
  }
}

if (typeof self !== 'undefined') {
  self.onmessage = (event: MessageEvent<StoredGraphNodeLoaderRequest>) => {
    void handleStoredGraphNodeLoaderRequest(event.data, (response) => {
      ;(self as unknown as Worker).postMessage(response)
    })
  }
}
