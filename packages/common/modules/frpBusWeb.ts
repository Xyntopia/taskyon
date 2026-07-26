import { createStream, type Port, type Stream, type Unsubscribe } from './frpBus.ts'
import { createPortFromTransport } from './frpTransport.ts'

export function MessageChannelBridge<Tx, Rx = Tx>(port: Port<Tx, Rx>, messagePort: MessagePort) {
  const unsubscribe = port.receive((message) => messagePort.postMessage(message))
  messagePort.onmessage = (event) => port.send(event.data)
  messagePort.start()
  return {
    destroy: () => {
      unsubscribe()
      messagePort.close()
    },
  }
}

export function createPortFromMessagePort<TSend, TReceive = TSend>(
  messagePort: MessagePort,
): { port: Port<TSend, TReceive>; destroy(): void } {
  return createPortFromTransport({
    send: (message: TSend) => messagePort.postMessage(message),
    subscribe: (receive: (message: TReceive) => void) => {
      const listener = (event: MessageEvent<TReceive>) => receive(event.data)
      messagePort.addEventListener('message', listener)
      messagePort.start()
      return () => messagePort.removeEventListener('message', listener)
    },
    close: () => messagePort.close(),
  })
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

export type IframeMultiPlexer<I extends string | number | symbol = string> = ReturnType<
  typeof createIframeMux<I>
>

export function createUnavailableIframeMux<I extends string | number | symbol = string>(
  reason = 'Iframe message bridging is not available in this runtime.',
): IframeMultiPlexer<I> {
  const { stream: all$ } = createStream<BusMsg<I>>()
  const fail = () => {
    throw new Error(reason)
  }

  return {
    all$,
    send: fail,
    attachIframe: fail,
    detachId: () => {},
    gc: () => {},
    destroy: () => {
      all$.unsubscribeAll()
    },
  }
}
