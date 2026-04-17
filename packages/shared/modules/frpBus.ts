// frpBus.ts
import type { z } from 'zod'

/**
 * Functional Reactive Programming (FRP) Bus
 * A simple implementation of an FRP bus using streams and operators.
 * This is a basic implementation and can be extended with more operators as needed.
 */
export type Observer<T> = (value: T) => void | Promise<void>
export type Unsubscribe = () => void

export interface Stream<T> {
  (observer: Observer<T>): Unsubscribe
  unsubscribeAll(this: void): void
  filter(this: void, predicate: (value: T) => boolean): Stream<T>
  narrow<U extends T>(this: void, predicate: (value: T) => value is U): Stream<U>
  map<V>(this: void, fn: (value: T) => V): Stream<V>
  wait(this: void, opts: { timeoutMs?: number; signal?: AbortSignal }): Promise<T>
}

export type frpBus<T> = {
  stream: Stream<T>
  emit: <U extends T>(value: U) => void
}

// Creates a simple stream with an "emit" function
export function createStream<T>(): frpBus<T> {
  const observers: Observer<T>[] = []

  const stream = (observer: Observer<T>): Unsubscribe => {
    observers.push(observer)
    return () => {
      const idx = observers.indexOf(observer)
      if (idx >= 0) observers.splice(idx, 1)
    }
  }

  stream.unsubscribeAll = () => {
    observers.length = 0
  }

  // TODO: if we use a filter like that... how can we make sure, that we unsubscribe from the original
  //       stream, if we unsubscrbe from the new stream (unsub)? we might want to have multiple
  //       streams subscribing on the filtered, so we can't jsut do it from the last "unsub" in the chain...
  //       maybe add an "unsubchain" or something like that?
  stream.narrow = <U extends T>(pred: (m: T) => m is U) => {
    const newStream = createStream<U>()
    /*const unsub = */ stream((v) => {
      if (pred(v)) newStream.emit(v)
    })
    return newStream.stream
  }
  stream.map = <V>(fn: (value: T) => V): Stream<V> => {
    const newStream = createStream<V>()
    stream((v) => newStream.emit(fn(v)))
    return newStream.stream
  }
  stream.filter = stream.narrow<T>
  stream.wait = ((opts) =>
    new Promise<T>((resolve, reject) => {
      if (opts?.signal?.aborted) {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        reject(err)
        return
      }

      let done = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      let unsub: Unsubscribe = () => {}

      const finish = (err?: Error, value?: T) => {
        if (done) return
        done = true
        unsub()
        clearTimeout(timeout)
        opts?.signal?.removeEventListener('abort', onAbort)
        if (err) reject(err)
        else resolve(value!)
      }

      const onAbort = () => {
        const err = new Error('Aborted')
        err.name = 'AbortError'
        finish(err)
      }

      opts?.signal?.addEventListener('abort', onAbort)
      if (opts?.timeoutMs)
        timeout = setTimeout(
          () => finish(new Error(`Timeout after ${opts.timeoutMs}ms`)),
          opts.timeoutMs,
        )

      const observer = (value: T) => finish(undefined, value)
      unsub = stream(observer)
    })) as Stream<T>['wait']

  return {
    stream,
    emit: (v: T) => {
      ;[...observers].forEach((o) => void o(v))
    },
  }
}

// extract stream type frm existing stream
export type extractStreamType<Type> = Type extends Stream<infer X> ? X : never

export type Port<Tx, Rx = Tx> = {
  send: frpBus<Tx>['emit']
  receive: frpBus<Rx>['stream']
  // stricter connect signature: intersection forces compile-time failure when constraints don't hold
  connect: <Tx, Rx extends oTx, oTx, oRx extends Tx>(
    this: Port<Tx, Rx>,
    other: Port<oTx, oRx>,
  ) => Unsubscribe
}

export type DuplexChannel<Tx, Rx> = { x: Port<Tx, Rx>; y: Port<Rx, Tx> }

const connectChannels = <Tx, Rx, oTx, oRx>(x: Port<Tx, Rx>, y: Port<oTx, oRx>): Unsubscribe => {
  const unsubX = x.receive((msg) => y.send(msg as unknown as oTx))
  const unsubY = y.receive((msg) => x.send(msg as unknown as Tx))

  // Return a function that disconnects both subscriptions
  return () => {
    unsubX()
    unsubY()
  }
}

const makePort = <Tx, Rx = Tx>(
  send: frpBus<Tx>['emit'],
  receive: frpBus<Rx>['stream'],
): Port<Tx, Rx> => {
  const self: Port<Tx, Rx> = {
    send,
    receive,
    connect: (other) => connectChannels(self, other),
  }
  return self
}

export const createChannelsFromStreams = <Str1, Str2 = Str1>(
  outS: frpBus<Str1>,
  inS: frpBus<Str2>,
): DuplexChannel<Str1, Str2> => ({
  x: makePort(outS.emit, inS.stream),
  y: makePort(inS.emit, outS.stream),
})

export const createDuplexChannel = <Str1, Str2 = Str1>(): DuplexChannel<Str1, Str2> =>
  createChannelsFromStreams(createStream<Str1>(), createStream<Str2>())

export function MessageChannelBridge<Tx, Rx = Tx>(dport: Port<Tx, Rx>, mport: MessagePort) {
  const unsub = dport.receive((msg) => mport.postMessage(msg))
  mport.onmessage = (msg) => dport.send(msg.data)

  const destroy = () => {
    unsub()
    mport.close()
  }

  return { destroy }
}

/* TODO: adapt this by createing a port which
export function portMap<A, B>(
  source: Port<A>,
  fnIn: (value: A) => B,
  fnOut: (value: B) => A,
): { port: Port<B>; destroy: () => void } {
  const { a: inner, b: outer } = createDuplexChannel<B>()

  // Upstream ➜ child (apply the filter)
  const unsubUp = source.receive((m) => {
    inner.send(fnIn(m)) // safe: guard proved it’s TChild
  })

  // Child ➜ upstream (no filtering needed)
  const unsubDown = inner.receive((m) => source.send(fnOut(m)))

  const destroy = () => {
    unsubUp()
    unsubDown()
  }

  return { port: outer, destroy }
}*/

export function mapPort<pTx, pRx, cTx extends pTx, cRx extends pRx>(
  port: Port<pTx, pRx>,
  transformTx: (msg: pTx) => cTx,
  transformRx: (msg: pRx) => cRx,
): { port: Port<cTx, cRx>; destroy: () => void } {
  const { x: filtered, y: internal } = createDuplexChannel<cTx, cRx>()

  // Upstream ➜ child (apply the filter)
  const unsubUp = port.receive((m) => {
    internal.send(transformRx(m)) // safe: guard proved it’s TChild
  })

  // Child ➜ upstream (no filtering needed)
  const unsubDown = internal.receive((m) => {
    port.send(transformTx(m)) // safe: guard proved it’s TChild
  })

  const destroy = () => {
    unsubUp()
    unsubDown()
  }

  return { port: filtered, destroy }
}

export function createPortFilter<pTx, pRx, cTx extends pTx, cRx extends pRx>(
  port: Port<pTx, pRx>,
  filterTx: (msg: pTx) => msg is cTx,
  filterRx: (msg: pRx) => msg is cRx,
): { port: Port<cTx, cRx>; destroy: () => void } {
  const { x: filtered, y: internal } = createDuplexChannel<cTx, cRx>()

  // Upstream ➜ child (apply the filter)
  const unsubUp = port.receive((m) => {
    if (filterRx(m)) internal.send(m) // safe: guard proved it’s TChild
  })

  // Child ➜ upstream (no filtering needed)
  const unsubDown = internal.receive((m) => {
    if (filterTx(m)) port.send(m) // safe: guard proved it’s TChild
  })

  const destroy = () => {
    unsubUp()
    unsubDown()
  }

  return { port: filtered, destroy }
}

// lets through messages which are in a  list of types...
export function createTypeFilteredPort<
  pTx, // Parent Transmit type
  pRx extends { type: string }, // Parent Receive type (the superset union)
  K extends pRx['type'], // An array of keys from the union's 'type' property
>(
  parent: Port<pTx, pRx>,
  allowedTypes: readonly K[],
): { port: Port<pTx, Extract<pRx, { type: K }>>; destroy: () => void } {
  // Use a Set for efficient O(1) lookups inside the guard.
  const typeSet = new Set(allowedTypes)

  // Define the new, narrower child message type using TypeScript's Extract utility.
  // This extracts all members from the `pRx` union whose `type` property matches one
  // of the strings in the `allowedTypes` array (`T[number]`).
  type cRx = Extract<pRx, { type: K }>
  // Reuse the generic filtered-port helper with a custom type guard.
  return createPortFilter(
    parent,
    (msg): msg is pTx => true,
    (msg): msg is cRx => typeSet.has(msg.type as K),
  )
}

/** Generic message → handler router (sync or async) */
export function createPortApi<
  R,
  Schema extends z.ZodType<{ type: string }>, // your Zod schema
  Msg extends z.infer<Schema>, // union type + discriminator
  Tx,
  Rx = Tx,
>(
  port: Port<Tx, Rx>,
  schema: Schema,
  handlers: {
    [K in Msg['type']]?: (m: Extract<Msg, { type: K }>) => R | Promise<R>
  },
  defaultHandler?: (m: unknown) => void,
  errorHandler?: (m: unknown) => void,
) {
  port.receive((raw) => {
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      console.error('Invalid message:', parsed.error, raw)
      return
    }

    const msg = parsed.data as Msg
    const handle = handlers[msg.type as Msg['type']]
    if (!handle) {
      if (defaultHandler) defaultHandler(msg)
      return
    }

    // 1️⃣ Re-narrow the union to the specific variant for this handler
    type Specific = Extract<Msg, { type: typeof msg.type }>

    // 2️⃣ Call the handler; Promise.resolve normalises sync/async, catch logs errors
    void Promise.resolve(handle(msg as Specific)).catch((error) => {
      if (errorHandler) errorHandler(error)
    })
  })
}

/**
 * Merges streams of different types into a single stream emitting a union type.
 * Usage: merge(streamA, streamB) → Stream<A | B>
 */
export function merge<T extends unknown[]>(
  ...sources: { [K in keyof T]: Stream<T[K]> }
): Stream<T[number]> {
  const { stream, emit } = createStream<T[number]>()

  sources.forEach((source) => {
    void source((value) => emit(value)) // Full type safety
  })

  return stream
}

export function requireSubscribers<T>(source: Stream<T>, min: number = 1): Stream<T> {
  const { stream, emit } = createStream<T>()
  let subscriberCount = 0

  // Subscribe to the source stream
  void source((value) => {
    if (subscriberCount < min) {
      throw new Error(`Not enough subscribers: got ${subscriberCount}, need at least ${min}`)
    }
    emit(value)
  })

  const subscribe = (observer: Observer<T>) => {
    subscriberCount++
    const unsubscribe = stream(observer)
    return () => {
      subscriberCount--
      void Promise.resolve(unsubscribe).then((resolvedUnsubscribe) => resolvedUnsubscribe())
    }
  }
  subscribe.unsubscribeAll = () => {
    stream.unsubscribeAll()
    subscriberCount = 0
  }
  subscribe.narrow = stream.narrow
  subscribe.filter = stream.narrow<T>
  subscribe.wait = stream.wait
  subscribe.map = stream.map

  return subscribe
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
  const unsub: Unsubscribe | Promise<Unsubscribe> = stream((v) => {
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
  const unsub: Unsubscribe = stream((v) => {
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

// TODO: add a "bus" to the iframe...
/**
 * Create a multiplexer for bidirectional messaging between the host window
 * and multiple managed iframes. Each iframe is registered under an identifier,
 * and incoming `postMessage` events are routed to a typed stream keyed by id.
 *
 * Features:
 * - `attachIframe(id, iframe, origin?)`: register an iframe with a unique id.
 *   - Tracks the iframe with a `WeakRef`, cleaned up automatically if removed.
 *   - Determines expected origin from the iframe's `src` unless overridden.
 * - `send(id, msg)`: post a message to the iframe associated with `id`.
 *   - Messages are dropped if the iframe is disconnected or garbage collected.
 * - `all$`: a reactive stream of all incoming messages of the form `{ id, payload }`.
 * - Automatic garbage collection:
 *   - Uses `WeakRef` + `WeakMap` to avoid leaks.
 *   - Periodically sweeps stale entries after `sweepEvery` attaches.
 *   - Falls back to manual `gc()` to force a sweep.
 * - `detachId(id)`: manually detach an iframe by id.
 * - `destroy()`: stop listening to window `message` events and clear state.
 *
 * Notes:
 * - `winToId` is a `WeakMap` → iframe window references do not prevent GC.
 * - Origins:
 *   - If the iframe has `srcdoc` or `about:srcdoc`, origin is `"null"` and messages
 *     are sent with target `"*"`.
 *   - Otherwise the origin is inferred from the iframe `src` or overridden via `origin`.
 *
 * @param sweepEvery number of iframe attaches before scheduling a GC sweep (default: 5).
 * @returns API object: `{ all$, send, attachIframe, detachId, gc, destroy }`.
 */
export function createIframeMux<I extends string | number | symbol = string>(sweepEvery = 5) {
  const { stream: all$, emit } = createStream<BusMsg<I>>()
  const messageHost: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> =
    typeof window !== 'undefined' ? window : new EventTarget()

  const winToId = new WeakMap<Window, I>()
  const idToEntry = new Map<I, Entry>()
  let attachCountSinceSweep = 0

  const onMessage = (ev: MessageEvent) => {
    const id = winToId.get(ev.source as Window)
    if (!id) return
    emit({ id, payload: ev.data })
  }
  messageHost.addEventListener('message', onMessage as EventListener)

  const attachIframe = (id: I, iframe: HTMLIFrameElement, origin?: string) => {
    const win = iframe.contentWindow
    if (!win) throw new Error('iframe has no contentWindow')

    winToId.set(win, id)

    // Infer origin unless caller overrides. srcdoc/about:srcdoc => "null"
    const hrefBase = typeof window !== 'undefined' ? window.location.href : 'http://localhost/'
    const inferred =
      iframe.src && iframe.src !== 'about:srcdoc' ? new URL(iframe.src, hrefBase).origin : 'null'

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
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(sweep, { timeout: 200 })
    } else {
      setTimeout(sweep, 0)
    }
  }

  const gc = sweep

  const destroy = () => {
    messageHost.removeEventListener('message', onMessage as EventListener)
    idToEntry.clear()
    // WeakMaps auto-GC
  }

  return { all$, send, attachIframe, detachId, gc, destroy }
}

export type IframeMultiPlexer<I extends string | number | symbol = string> = ReturnType<
  typeof createIframeMux<I>
>
