import vm from 'node:vm'
import { executableSandboxRuntimeSource } from './executableSandboxRuntime.js'

const timers = new Map()
let timerCounter = 0

function lockedFunction(fn) {
  Object.setPrototypeOf(fn, null)
  return Object.freeze(fn)
}

const send = lockedFunction((serializedMessage) => process.send?.(JSON.parse(serializedMessage)))
const subscribe = lockedFunction((listener) =>
  process.on('message', (message) => listener(JSON.stringify(message))),
)
const scheduleTimeout = lockedFunction((callback, delay, args) => {
  const id = timerCounter++
  const timer = setTimeout(() => {
    timers.delete(id)
    Reflect.apply(callback, undefined, args)
  }, delay)
  timers.set(id, timer)
  return id
})
const cancelTimeout = lockedFunction((id) => {
  const timer = timers.get(id)
  if (timer === undefined) return
  timers.delete(id)
  clearTimeout(timer)
})
const enqueueMicrotask = lockedFunction((callback) => queueMicrotask(callback))

const sandboxGlobal = Object.create(null)
Object.defineProperties(sandboxGlobal, {
  __bridgeCancelTimeout: { configurable: true, value: cancelTimeout },
  __bridgeEnqueueMicrotask: { configurable: true, value: enqueueMicrotask },
  __bridgeScheduleTimeout: { configurable: true, value: scheduleTimeout },
  __bridgeSend: { configurable: true, value: send },
  __bridgeSubscribe: { configurable: true, value: subscribe },
})

const context = vm.createContext(sandboxGlobal, {
  codeGeneration: { strings: true, wasm: false },
  name: 'taskyon-executable-sandbox',
})

vm.runInContext(
  `(() => {
    const bridgeCancelTimeout = globalThis.__bridgeCancelTimeout;
    const bridgeEnqueueMicrotask = globalThis.__bridgeEnqueueMicrotask;
    const bridgeScheduleTimeout = globalThis.__bridgeScheduleTimeout;
    const bridgeSend = globalThis.__bridgeSend;
    const bridgeSubscribe = globalThis.__bridgeSubscribe;
    delete globalThis.__bridgeCancelTimeout;
    delete globalThis.__bridgeEnqueueMicrotask;
    delete globalThis.__bridgeScheduleTimeout;
    delete globalThis.__bridgeSend;
    delete globalThis.__bridgeSubscribe;

    class SandboxAbortSignal {
      #listeners = new Set();
      aborted = false;
      reason = undefined;
      addEventListener(type, listener) {
        if (type === 'abort') this.#listeners.add(listener);
      }
      removeEventListener(type, listener) {
        if (type === 'abort') this.#listeners.delete(listener);
      }
      dispatch(reason) {
        if (this.aborted) return;
        this.aborted = true;
        this.reason = reason;
        this.#listeners.forEach((listener) => listener.call(this, { type: 'abort' }));
        this.#listeners.clear();
      }
    }
    class SandboxAbortController {
      signal = new SandboxAbortSignal();
      abort(reason) { this.signal.dispatch(reason); }
    }

    Object.defineProperties(globalThis, {
      AbortController: { value: SandboxAbortController },
      clearTimeout: { value: (id) => bridgeCancelTimeout(id) },
      console: { value: Object.freeze({
        log: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      }) },
      process: { configurable: false, value: undefined, writable: false },
      queueMicrotask: { value: (callback) => bridgeEnqueueMicrotask(callback) },
      setTimeout: {
        value: (callback, delay = 0, ...args) => bridgeScheduleTimeout(callback, delay, args),
      },
    });

    ${executableSandboxRuntimeSource}
    const connect = globalThis.onmessage;
    delete globalThis.onmessage;
    const ipcPort = {
      onmessage: null,
      postMessage: (message) => bridgeSend(JSON.stringify(message)),
      start: () => bridgeSubscribe((serializedMessage) => {
        const data = JSON.parse(serializedMessage);
        ipcPort.onmessage?.({ data, ports: [] });
      }),
    };
    connect({ data: { kind: 'connect' }, ports: [ipcPort] });
  })()`,
  context,
  { timeout: 1_000 },
)
