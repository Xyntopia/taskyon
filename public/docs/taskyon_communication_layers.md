# FIRST SKETCH ABOUT TASKYON COMMUNCATION LAYERS

TODO: this is NEITHER complete NOR 100% correct!!!!!

Below is a “bigger-picture” sketch that folds the answers you just gave into one coherent, future-proof layout. Everything is expressed as _layers_ so you can swap pieces out later without rewriting the whole stack.

---

## 0 · Constraints recap

| Axis                 | What we must respect                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| **Security**         | Defend against XSS; both first- and third-party code may run in tool iframes.         |
| **Multiplicity**     | Many **tool-iframes** (code) and many **message-iframes** (UI) can coexist.           |
| **State**            | Canonical store lives in the **parent**; tools get controlled access through `ctx`.   |
| **Bus**              | A simple FRP bus already lives in the parent and is used elsewhere.                   |
| **Browser features** | Modern browsers only; `MessageChannel`, SharedArrayBuffer etc. are fine.              |
| **Dev DX**           | Source-maps in iframes, no special debugger plumbing needed.                          |
| **Long term**        | Iframes are the safety boundary; workers/WASM are optional add-ons, not replacements. |

---

## 1 · Three explicit layers

```
┌──────────────┐     MessagePort    ┌──────────────┐
│  Parent      │◀──────────────────▶│  Tool iframe │  (N of these)
│  (Core Bus)  │                    └──────────────┘
│              │
│   ^  ^  ^    │  postMessage       ┌──────────────┐
│   |  |  |    └──────────────────▶ │ Message i/f  │  (M of these)
└───┴──┴──┴─────────────────────────┴──────────────┘
```

1. **Parent (core)**
   - Owns the FRP bus, global state, secret store.
   - Spawns both kinds of iframe and brokers messages between them.

2. **Tool-iframe(s)** – _code sandbox_
   - Gets a `context` object that speaks to the parent by **MessagePort**, not `window.parent`.
   - May also expose a limited FRP stream inside the sandbox for local use.

3. **Message-iframe(s)** – _display sandbox_
   - Receives raw HTML/MD to render.
   - Gets a single trusted helper (`TaskyonUI.send(name, payload)`) so it can emit **UI events** to the parent.
   - No direct access to any RPC API.

---

## 2 · Wire it up with dedicated **MessageChannels**

### Creation handshake

```ts
// Parent creates tool iframe
const toolFrame = document.createElement('iframe')
toolFrame.sandbox = 'allow-scripts'
// …set src, append, etc.

// Create a channel
const { port1: coreSide, port2: toolSide } = new MessageChannel()

// Pass one end into the iframe
toolFrame.addEventListener('load', () => {
  toolFrame.contentWindow!.postMessage({ type: 'init-port' }, '*', [toolSide])
})

// Register it
registerToolPort(toolId, coreSide)
```

Inside the **tool** boot code you do:

```ts
window.addEventListener('message', (ev) => {
  if (ev.data?.type === 'init-port' && ev.ports[0]) {
    const port = ev.ports[0]
    port.start() // needed in some browsers
    exposeContext(port) // build your ctx around this port
  }
})
```

No other frame ever receives that port, so the attack surface is one end-to-one end.

---

## 3 · FRP-bus ↔︎ port adapter (“Bridge”)

```ts
// parent-side
function bridgePortToBus(toolId: string, port: MessagePort) {
  // port → bus
  port.onmessage = ({ data }) => bus.next({ source: 'tool', toolId, ...data })

  // bus → port   (filter by toolId & capability)
  bus.pipe(filter((e) => e.destTool === toolId)).subscribe((e) => port.postMessage(e))
}
```

On the tool side you can expose a tiny FRP shim:

```ts
import { Subject } from 'light-frp' // hypothetical

export function exposeContext(port: MessagePort) {
  const incoming$ = new Subject()
  port.onmessage = (ev) => incoming$.next(ev.data)

  return {
    bus: {
      publish: (msg) => port.postMessage(msg),
      stream: incoming$.asObservable(),
    },
    waitForUiEvent: (name, signal) =>
      incoming$
        .pipe(
          filter((m) => m.type === 'ui' && m.name === name),
          take(1),
          abortable(signal),
        )
        .toPromise(),
  }
}
```

That single helper replaces the explicit `window.addEventListener('message', …)` you used in the OAuth example, so tools become **frame-location agnostic**.

---

## 4 · How UI events flow

1. Message-iframe posts

   ```js
   parent.postMessage({ type: 'ui', toolId: 'gitlab', name: 'oauth-init' }, '*')
   ```

2. Parent receives it and pushes `bus.next({type:'ui', toolId, name, …})`.
3. `bridgePortToBus` sees that, checks capability, forwards down the port for _that tool_.
4. Tool-iframe’s `waitForUiEvent('oauth-init')` resolves.

If later you want _tool → UI_ notifications (progress bars etc.) just publish a bus message with `{destUiFrame: frameId, ...}` and let the parent forward it symmetrically.

---

## 5 · Security hardening checklist

| Frame       | Suggested `sandbox` flags                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Tool**    | `allow-scripts allow-modals` _(omit `allow-same-origin`, `allow-top-navigation`)_                                         |
| **Message** | `allow-scripts` only. Content is same-origin `about:blank`.                                                               |
| **Parent**  | Validates every message structure, drops unknown fields, enforces capability manifest before putting anything on the bus. |

_Cap abilities later:_ because everything funnels through the parent bus, adding a manifest is just a gate in `bridgePortToBus`.

---

## 6 · Optional niceties

- **MessagePort pooling** – reuse `port1/port2` pairs if tool iframes come and go quickly.
- **SharedArrayBuffer** – if you need ultra-low latency streaming later, parent can `postMessage` a SAB to a tool once and both sides work on the same ring-buffer.
- **Service Worker** – parent can expose a cache API via the port so tools cache assets without hitting main-thread `localStorage`.
- **Dev UX** – let tools call `ctx.debug(msg)`; the parent just pipes it into its console with a tool-id prefix.

---

### Why we stay with iframes

- **Web Workers** isolate JS, but the DOM bridge still needs postMessage, and they _cannot_ load arbitrary third-party HTML safely.
- **WASM** runs code safely but must still surface a UI somewhere; the moment you write HTML you need a container anyway.
- **Isolates** (V8 isolates / Realms proposal) aren’t widely shipped; iframe sandbox is battle-tested today.

---

## TL;DR

- Give **every tool-iframe its own MessagePort**; wrap that in your existing FRP bus bridge.
- Message-iframes stay “dumb”: they just `postMessage` UI events upward.
- Parent is the sole switchboard, forwarding events to the correct tool port after validation.
- Tools get a tiny `ctx.bus` or `waitForUiEvent` helper so they never touch the global window, making their code identical whether it lives inside or outside an iframe.

This retains your XSS guardrails, scales to many parallel tools & UIs, and keeps future features (cap-manifest, caching, streaming) as bolt-ons—no rewrites needed.
