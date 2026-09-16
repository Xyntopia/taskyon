import type { TaskyonDirectFallbackRequest } from './providerFetch'
import type { TaskyonDirectFallbackPortMessage } from './workerProtocol'

export const createTaskyonDirectFallbackRequester = (port: MessagePort) => {
  const pending = new Map<string, (approved: boolean) => void>()
  port.onmessage = (event: MessageEvent<TaskyonDirectFallbackPortMessage>) => {
    if (event.data.type !== 'response') return
    pending.get(event.data.id)?.(event.data.approved)
    pending.delete(event.data.id)
  }
  port.start()

  return {
    request: (request: TaskyonDirectFallbackRequest) =>
      new Promise<boolean>((resolve) => {
        const id = crypto.randomUUID()
        pending.set(id, resolve)
        const message: TaskyonDirectFallbackPortMessage = { type: 'request', id, request }
        port.postMessage(message)
      }),
    destroy: () => {
      pending.forEach((resolve) => resolve(false))
      pending.clear()
      port.close()
    },
  }
}

export const startTaskyonDirectFallbackHost = (
  port: MessagePort,
  approve: (request: TaskyonDirectFallbackRequest) => Promise<boolean>,
) => {
  let active = true
  port.onmessage = (event: MessageEvent<TaskyonDirectFallbackPortMessage>) => {
    if (!active || event.data.type !== 'request') return
    const { id, request } = event.data
    void approve(request)
      .then((approved) => {
        if (!active) return
        const message: TaskyonDirectFallbackPortMessage = { type: 'response', id, approved }
        port.postMessage(message)
      })
      .catch(() => {
        if (!active) return
        const message: TaskyonDirectFallbackPortMessage = { type: 'response', id, approved: false }
        port.postMessage(message)
      })
  }
  port.start()
  return () => {
    active = false
    port.close()
  }
}
