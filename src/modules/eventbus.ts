export type Listener<T> = (data: T) => void

export interface EventBusOptions {
  debug?: boolean
  asyncDispatch?: boolean
}

export function createEventBus<Events extends Record<string, unknown>>(
  options: EventBusOptions = {},
) {
  const listeners: { [K in keyof Events]?: Listener<Events[K]>[] } = {}

  const subscribe = <K extends keyof Events>(
    event: K,
    listener: Listener<Events[K]>,
  ): (() => void) => {
    if (!listeners[event]) {
      listeners[event] = []
    }
    listeners[event]!.push(listener)
    if (options.debug) {
      console.debug(`Subscribed to event "${String(event)}"`)
    }
    return () => {
      listeners[event] = listeners[event]!.filter((l) => l !== listener)
      if (options.debug) {
        console.debug(`Unsubscribed from event "${String(event)}"`)
      }
    }
  }

  const once = <K extends keyof Events>(event: K, listener: Listener<Events[K]>): (() => void) => {
    const wrapped: Listener<Events[K]> = (data: Events[K]) => {
      listener(data)
      unsubscribe()
    }
    const unsubscribe = subscribe(event, wrapped)
    return unsubscribe
  }

  const publish = <K extends keyof Events>(event: K, data: Events[K]): void => {
    if (options.debug) {
      console.debug(`Publishing event "${String(event)}" with data:`, data)
    }
    const eventListeners = listeners[event]
    if (eventListeners) {
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
      if (options.asyncDispatch) {
        setTimeout(dispatch, 0)
      } else {
        dispatch()
      }
    }
  }

  return { subscribe, once, publish }
}
