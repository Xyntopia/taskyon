// frpBus.ts

import type { ZodType } from 'zod'

/**
 * Functional Reactive Programming (FRP) Bus
 * A simple implementation of an FRP bus using streams and operators.
 * This is a basic implementation and can be extended with more operators as needed.
 */
export type Observer<T> = (value: T) => void | Promise<void>
export type Unsubscribe = () => void

export interface syncStream<T> {
  subscribe: (observer: Observer<T>) => Unsubscribe
}

// we have a separate stream declaration here because we want to
// add async streams later on. and we can do this here as a union.
export type Stream<T> = syncStream<T>

export type frpBus<T> = {
  stream: Stream<T>
  emit: (value: T) => void
}

// Creates a simple stream with an "emit" function
export function createStream<T>(): frpBus<T> {
  const observers: Observer<T>[] = []
  return {
    stream: {
      subscribe: (observer: Observer<T>) => {
        observers.push(observer)
        return (() => {
          const index = observers.indexOf(observer)
          if (index > -1) observers.splice(index, 1)
        }) as Unsubscribe
      },
    },
    emit: (value: T) => {
      // Create a copy to avoid issues if observers unsubscribe during iteration
      ;[...observers].forEach((observer) => void observer(value))
    },
  }
}

export function createDuplexChannel<T>() {
  //export function createStream
  const outS = createStream<T>()
  const inS = createStream<T>()

  const a = {
    send: outS.emit,
    receive: inS.stream.subscribe,
  }

  const b = {
    send: inS.emit,
    receive: outS.stream.subscribe,
  }

  return { a, b }
}

export type DuplexChannel<T> = ReturnType<typeof createDuplexChannel<T>>
export type Port<T> = DuplexChannel<T>['a']

export function MessageChannelBridge<T>(dport: Port<T>, mport: MessagePort) {
  const unsub = dport.receive((msg) => mport.postMessage(msg))
  mport.onmessage = (msg) => dport.send(msg.data)

  const destroy = () => {
    unsub()
    mport.close()
  }

  return { destroy }
}

export function MessageChannelAdapter<T>(port: Port<T>) {
  // we choose port2 as the "outside" port
  const { port1, port2 } = new MessageChannel()

  // incoming message from outside
  port1.onmessage = (msg) => {
    port.send(msg.data)
  }
  port.receive((msg) => port1.postMessage(msg))
  return port2
}

// Operator: transform each value from the source stream
export function map<A, B>(source: Stream<A>, fn: (value: A) => B): Stream<B> {
  const { stream, emit } = createStream<B>()
  void source.subscribe((value) => emit(fn(value)))
  return stream
}

// Operator: filter values based on a predicate
export function filter<A>(source: Stream<A>, predicate: (value: A) => boolean): Stream<A> {
  const { stream, emit } = createStream<A>()
  void source.subscribe((value) => {
    if (predicate(value)) {
      emit(value)
    }
  })
  return stream
}

// make sure we filter for a specific type using Zod schema
export const zodFilter = <T>(source: Stream<unknown>, schema: ZodType<T>) =>
  filter(source as Stream<T>, (value): value is T => {
    const result = schema.safeParse(value)
    if (!result.success) {
      return false
    }
    return true
  })

/**
 * Merges streams of different types into a single stream emitting a union type.
 * Usage: merge(streamA, streamB) → Stream<A | B>
 */
export function merge<T extends unknown[]>(
  ...sources: { [K in keyof T]: Stream<T[K]> }
): Stream<T[number]> {
  const { stream, emit } = createStream<T[number]>()

  sources.forEach((source) => {
    void source.subscribe((value) => emit(value)) // Full type safety
  })

  return stream
}

export function requireSubscribers<T>(source: Stream<T>, min: number = 1): Stream<T> {
  const { stream, emit } = createStream<T>()
  let subscriberCount = 0

  // Subscribe to the source stream
  void source.subscribe((value) => {
    if (subscriberCount < min) {
      throw new Error(`Not enough subscribers: got ${subscriberCount}, need at least ${min}`)
    }
    emit(value)
  })

  return {
    subscribe: (observer: Observer<T>): Unsubscribe => {
      subscriberCount++
      const unsubscribe = stream.subscribe(observer)
      return () => {
        subscriberCount--
        void Promise.resolve(unsubscribe).then((resolvedUnsubscribe) => resolvedUnsubscribe())
      }
    },
  }
}

export function streamProcedureCall<T extends unknown[], R>(timeoutMs?: number) {
  const { stream, emit } = createStream<{
    args: T
    respond: (result: R) => void
  }>()

  const emitFunc: (...args: T) => Promise<R> = (...args) => {
    return new Promise<R>((resolve, reject) => {
      let responded = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      // Set up timeout for default or error
      if (timeoutMs !== undefined) {
        timeout = setTimeout(() => {
          if (!responded) {
            responded = true
            // TODO: add default response here...
            reject(new Error('No response within timeout'))
          }
        }, timeoutMs)
      }
      console.log('Emitting args:', args)
      emit({
        args,
        respond: (result: R) => {
          if (!responded) {
            responded = true
            if (timeout) clearTimeout(timeout)
            resolve(result)
          }
        },
      })
    })
  }

  return { emitFunc, stream: requireSubscribers(stream, 1) }
}

// ---- MessagePort <-> FRP bridge ------------------------------------------

export interface PortBridge<T> {
  /** Stream that mirrors everything coming from the external port */
  stream: Stream<T>
  /** Post into the bus (will also be forwarded to the external port) */
  emit: (value: T) => void
  /** Give this to the iframe (or whatever) */
  port: MessagePort
  /** Cleanup listener, subscription & ports */
  destroy: () => void
}

/**
 * Creates a MessageChannel and wires one side into a new FRP stream.
 * - Anything the iframe posts arrives on `stream`
 * - Anything you `emit` (or any subscriber emits back into this stream) is posted out to the iframe
 */
export function createMessagePortBridge<T>(): PortBridge<T> {
  const { stream, emit } = createStream<T>()
  const { port1, port2 } = new MessageChannel()

  // Internal (hidden) side
  port2.start()
  const onMsg = (e: MessageEvent<T>) => emit(e.data)
  port2.addEventListener('message', onMsg)

  // Forward stream values out to the external side
  const unsub: Unsubscribe | Promise<Unsubscribe> = stream.subscribe((v) => {
    // Structured clone is required; assume T is cloneable.
    port2.postMessage(v)
  })

  const destroy = () => {
    unsub()
    port2.removeEventListener('message', onMsg)
    port1.close()
    port2.close()
  }

  return { stream, emit, port: port1, destroy }
}

export function createMessagePortAdapter<T>(stream: Stream<T>) {
  const { port1, port2 } = new MessageChannel()

  // Internal (hidden) side
  port2.start()
  // Forward stream values out to the external side
  const unsub: Unsubscribe = stream.subscribe((v) => {
    // Structured clone is required; assume T is cloneable.
    port2.postMessage(v)
  })

  const destroy = () => {
    unsub()
    port1.close()
    port2.close()
  }

  return { port: port1, destroy }
}

// ---- Simple IFrame <-> FRP adapter ---------------------------------------

export function iframeBridge(
  iframe: HTMLIFrameElement,
  origin: string | null = null, // pass null to skip origin check
) {
  const win = iframe.contentWindow
  if (!win) throw new Error('iframe has no contentWindow')

  const inferred = iframe.src ? new URL(iframe.src, window.location.href).origin : 'null' // about:srcdoc
  const expectedOrigin = origin === undefined ? inferred : origin
  const checkOrigin = expectedOrigin !== null

  const { stream, emit } = createStream<unknown>()

  const onMessage = (ev: MessageEvent<unknown>) => {
    if (ev.source !== win) return
    if (checkOrigin && ev.origin !== expectedOrigin) return
    emit(ev.data)
  }
  window.addEventListener('message', onMessage)

  const post = (msg: unknown) => {
    // If iframe navigated, silently drop
    if (iframe.contentWindow === win) {
      win.postMessage(msg, expectedOrigin ?? '*')
    }
  }

  const destroy = () => window.removeEventListener('message', onMessage)

  return { stream, emit: post, destroy }
}

// ---- IFrame Multiplexer --------------------------------------------------

export type BusMsg<I extends string | number | symbol = string> = { id: I; payload: unknown }

export type TaskMessageStream = Stream<BusMsg>

interface Entry {
  ref: WeakRef<HTMLIFrameElement>
  post: (m: unknown) => void
}

export function createIframeMux<I extends string | number | symbol = string>(sweepEvery = 5) {
  const { stream: all$, emit } = createStream<BusMsg<I>>()

  const winToId = new WeakMap<Window, I>()
  const idToEntry = new Map<I, Entry>()
  let attachCountSinceSweep = 0

  const onMessage = (ev: MessageEvent) => {
    const id = winToId.get(ev.source as Window)
    if (!id) return
    emit({ id, payload: ev.data })
  }
  window.addEventListener('message', onMessage)

  const attachIframe = (id: I, iframe: HTMLIFrameElement, origin?: string) => {
    const win = iframe.contentWindow
    if (!win) throw new Error('iframe has no contentWindow')

    winToId.set(win, id)

    // Infer origin unless caller overrides. srcdoc/about:srcdoc => "null"
    const inferred =
      iframe.src && iframe.src !== 'about:srcdoc'
        ? new URL(iframe.src, window.location.href).origin
        : 'null'

    const expected = origin ?? inferred
    const postTarget = expected === 'null' ? '*' : expected

    const entry: Entry = {
      ref: new WeakRef(iframe),
      post: (msg: unknown) => {
        const el = entry.ref.deref()
        if (!el || el.contentWindow !== win) return // silently drop
        win.postMessage(msg, postTarget)
      },
    }

    idToEntry.set(id, entry)

    if (++attachCountSinceSweep >= sweepEvery) {
      attachCountSinceSweep = 0
      scheduleSweep()
    }
  }

  const send = (id: I, msg: unknown) => {
    const e = idToEntry.get(id)
    if (!e) return
    const el = e.ref.deref()
    if (!el || !el.isConnected) {
      detachId(id)
      return
    }
    e.post(msg)
  }

  const detachId = (id: I) => {
    idToEntry.delete(id)
    // winToId is a WeakMap → GC will clean it up
  }

  const sweep = () => {
    for (const [id, e] of idToEntry) {
      const el = e.ref.deref()
      if (!el || !el.isConnected) detachId(id)
    }
  }

  const scheduleSweep = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(sweep, { timeout: 200 })
    } else {
      setTimeout(sweep, 0)
    }
  }

  const gc = sweep

  const destroy = () => {
    window.removeEventListener('message', onMessage)
    idToEntry.clear()
    // WeakMaps auto-GC
  }

  return { all$, send, attachIframe, detachId, gc, destroy }
}
