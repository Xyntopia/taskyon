export type Listener<T> = (data: T) => void

export interface EventBusOptions {
  debug?: boolean
  asyncDispatch?: boolean
}

export class EventBus<Events extends Record<string, unknown>> {
  private listeners: { [K in keyof Events]?: Listener<Events[K]>[] } = {}
  private options: EventBusOptions

  constructor(options: EventBusOptions = {}) {
    this.options = options
  }

  subscribe<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event]!.push(listener)
    if (this.options.debug) {
      console.debug(`Subscribed to event "${String(event)}"`)
    }
    return () => {
      this.listeners[event] = this.listeners[event]!.filter((l) => l !== listener)
      if (this.options.debug) {
        console.debug(`Unsubscribed from event "${String(event)}"`)
      }
    }
  }

  once<K extends keyof Events>(event: K, listener: Listener<Events[K]>): () => void {
    const wrapped: Listener<Events[K]> = (data: Events[K]) => {
      listener(data)
      unsubscribe()
    }
    const unsubscribe = this.subscribe(event, wrapped)
    return unsubscribe
  }

  publish<K extends keyof Events>(event: K, data: Events[K]): void {
    const eventListeners = this.listeners[event]
    if (this.options.debug) {
      console.debug(`Publishing event "${String(event)}" with data:`, data)
    }
    if (eventListeners) {
      // Copy listeners in case one unsubscribes during execution.
      const listenersCopy = eventListeners.slice()
      const dispatch = () => {
        listenersCopy.forEach((listener) => {
          try {
            listener(data)
          } catch (err) {
            console.error(`Error in listener for event "${String(event)}":`, err)
          }
        })
      }
      if (this.options.asyncDispatch) {
        setTimeout(dispatch, 0)
      } else {
        dispatch()
      }
    }
  }
}
