import z from 'zod'
import { sleep } from './asyncUtils'
import type { toolContext } from '../types/toolApi'
import { taskMarker } from '../types/tools'

// Store iframe + its dedicated MessagePort by id / toolId
const iframes = new Map<string, { iframe: HTMLIFrameElement; port: MessagePort }>()

// Small helper for JSON-based deep cloning to keep payloads structured-clone-safe
const deepClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

// TODO: can we use iframebridge here?

// Create and initialize iframe and its control MessagePort
async function createSandboxedIframe(
  id: string,
): Promise<{ iframe: HTMLIFrameElement; port: MessagePort }> {
  console.log('create taskyon iframe worker', id)
  const iframe = document.createElement('iframe')
  iframe.id = id
  iframe.style.display = 'none'
  iframe.sandbox.add('allow-scripts', 'allow-popups', 'allow-popups-to-escape-sandbox')
  document.body.appendChild(iframe)

  try {
    // Minimal runner:
    //  - set up a dedicated control channel to the parent
    //  - expose controlPort & optional extra messagePort on window
    //  - expect { code, params, sourceURL } messages
    //  - execute userFn(...params) and post { result } or { error }
    iframe.srcdoc = `
<script>
  // Each iframe has its own persistent control channel to the parent
  const controlChannel = new MessageChannel()
  const controlPort = controlChannel.port1
  controlPort.start()

  // Expose control port and id for advanced/tool use
  // window.__taskyonControlPort = controlPort
  window.toolId = "${id}"

  // Listen on the controlPort for "execute code" messages from the parent
  controlPort.onmessage = async (e) => {
    // Optional extra MessagePort (e.g., for streaming)
    const extraPort = e.ports && e.ports[0] ? e.ports[0] : null
    // TODO: get rid of this and only use it as an argument to the user function?
    if (extraPort) {
      window.__taskyonMessagePort = extraPort
    }

    const data = e.data || {}
    const code = data.code
    const params = Array.isArray(data.params) ? data.params : []
    const sourceURL = data.sourceURL || 'sandboxed-code.js'

    if (!code) return

    try {
      const fn = new Function(
        "params",
        "const userFn = (" + code + ");" +
        "return userFn(...params);\\n" +
        "//# sourceURL=" + sourceURL
      )
      const result = await fn(params)
      controlPort.postMessage({ result })
    } catch (err) {
      const message = err && err.message ? err.message : String(err)
      controlPort.postMessage({ error: message })
    }
  }

  // Signal readiness and transfer the parent's end of the control channel
  window.parent.postMessage({ ready: true }, "*", [controlChannel.port2])
  // debugger;
  //# sourceURL=iframeWorker${id.slice(0, 5)}.js
</script>`
  } catch (error: unknown) {
    throw new Error(
      `Iframe worker code contains errors: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    )
  }

  // wait for the ready ping and capture the transferred MessagePort
  return new Promise((resolve) => {
    function onReady(ev: MessageEvent) {
      if (ev.data && ev.data.ready && ev.source === iframe.contentWindow) {
        const [port] = ev.ports || []
        if (!port) {
          console.error('Iframe ready message did not include a MessagePort')
          return
        }
        window.removeEventListener('message', onReady)
        port.start()
        resolve({ iframe, port })
      }
    }
    window.addEventListener('message', onReady)
  })
}

// Interrupt logic
let interrupted = false
function interruptExecution(id: string) {
  const entry = iframes.get(id)
  if (!entry) return

  const { iframe, port } = entry
  interrupted = true

  // Close the control port
  try {
    port.close()
  } catch {
    // ignore
  }

  // Remove the iframe to terminate the script execution
  // TODO: gracefully terminate the iframe. We should be able to stop execution of
  //       a function in an iframe so that we don't loose e.g. oauth access that we've alread had..
  document.body.removeChild(iframe)
  iframes.delete(id)
}

// 1) Define schemas for the two message “shapes”
const rpcMessageSchema = z.object({
  type: z.string(),
  args: z.array(z.unknown()).optional(),
})
const finalMessageSchema = z.object({
  result: z.unknown().optional(),
  error: z.string().optional(),
})
const portMessageSchema = z.union([rpcMessageSchema, finalMessageSchema])

// ---------- CORE EXECUTION PRIMITIVE ----------

interface ExecuteInIframeCoreOptions<R> {
  id: string
  code: string
  params: unknown[]
  sourceURL?: string
  stopSignal: AbortSignal
  preparePayload: (input: { code: string; params: unknown[]; sourceURL: string }) => {
    payload: unknown
    transfer: Transferable[]
  }
  handleMessage: (input: {
    event: MessageEvent
    port: MessagePort
    resolve: (value: R) => void
    reject: (reason: unknown) => void
  }) => void | Promise<void>
}

/**
 * Core, reusable iframe execution function.
 * All DOM / Map side-effects are contained here; message semantics are injected via hooks.
 */
async function executeInIframeCore<R = unknown>(
  options: ExecuteInIframeCoreOptions<R>,
): Promise<R> {
  const { id, code, params, stopSignal, preparePayload, handleMessage } = options
  const sourceURL = options.sourceURL ?? 'sandboxed-code.js'

  let iframeEntry = iframes.get(id)

  // Lazy initialize iframe + control port
  if (!iframeEntry || interrupted) {
    iframeEntry = await createSandboxedIframe(id)
    iframes.set(id, iframeEntry)
    interrupted = false
    // Add a delay to ensure iframe is fully ready. Its ok, because we normally do this only once here...
    await sleep(100)
  }

  const { port } = iframeEntry

  return new Promise<R>((resolve, reject) => {
    const onMessage = (event: MessageEvent) => {
      Promise.resolve(
        handleMessage({
          event,
          port,
          resolve,
          reject,
        }),
      ).catch(reject)
    }

    // Wire up the handler for this execution.
    // Assumption: only one active execution per iframe/id at a time.
    port.onmessage = onMessage
    port.start()

    const { payload, transfer } = preparePayload({ code, params, sourceURL })

    // Send the work request to the iframe
    port.postMessage(payload, transfer)

    const onAbort = () => {
      console.log('Interrupting iframe execution for', id)
      interruptExecution(id)
      reject(new Error('Execution interrupted', { cause: stopSignal.reason }))
    }

    if (stopSignal.aborted) {
      onAbort()
      return
    }

    stopSignal.addEventListener('abort', onAbort, { once: true })
  })
}

// ---------- SIMPLE PUBLIC API ----------

interface ExecuteCodeInIframeSimpleOptions {
  id: string
  code: string // user function as a string: e.g. `(a, b, ctx) => { ... }`
  sourceURL?: string
  stopSignal: AbortSignal
}

/**
 * Simple iframe executor:
 *  - caller provides `id` manually
 *  - no toolContext, no RPC handling, no extra ports
 *  - accepts a variadic list of arguments, passed *positionally* to the user function.
 *
 * Example:
 *   const code = `(a, b, ctx, c) => { ... }`
 *   const result = await executeCodeInIframeSimple(
 *     { id: 'my-id', code, sourceURL: 'my-src.js', stopSignal },
 *     1, 2, { some: 'context' }, 3,
 *   )
 *
 * Inside the iframe:
 *   params === [1, 2, { some: 'context' }, 3]
 *   userFn(...params) is called, so a=1, b=2, ctx={...}, c=3
 */
export function executeCodeInIframeSimple<R = unknown>(
  options: ExecuteCodeInIframeSimpleOptions,
  ...args: unknown[]
): Promise<R> {
  const { id, code, sourceURL = 'sandboxed-code.js', stopSignal } = options

  return executeInIframeCore<R>({
    id,
    code,
    params: args, // positional arguments for userFn(...params) in the iframe
    sourceURL,
    stopSignal,
    preparePayload: ({ code, params, sourceURL }) => {
      const payload = deepClone({
        code,
        params,
        sourceURL,
      })
      const transfer: Transferable[] = []
      return { payload, transfer }
    },
    handleMessage: ({ event, port, resolve, reject }) => {
      const msg = finalMessageSchema.parse(event.data)
      // Keep the control port open for future executions, just detach the handler
      port.onmessage = null
      if (msg.error) {
        reject(new Error(msg.error))
      } else {
        resolve(msg.result as R)
      }
    },
  })
}

// ---------- TOOL-AWARE PUBLIC API (ORIGINAL BEHAVIOR) ----------

/**
 * Tool-aware executor: same external semantics as the original `executeCodeInIframe`.
 * Internally, it:
 *  - wraps the user function with tool/RPC helpers
 *  - calls the minimal iframe runner via `executeInIframeCore`
 */
export function executeCodeInIframe(
  code: string,
  args: { params: unknown; context: toolContext },
  sourceURL = 'sandboxed-code.js',
  stopSignal: AbortSignal,
) {
  const rpcs = ['getSecret', 'setSecret'] as const

  const { toolId, taskChain, messagePort } = args.context

  // Base context that is clone-safe (no ports, no functions)
  const baseContext = { taskChain, toolId }

  // Wrap user code with tool/RPC/context functionality.
  // The final function signature in the iframe is:
  //   (params, baseContext) => userFn(params, ctx)
  // where ctx = { ...baseContext, ...rpcContext, messagePort }
  const wrappedCode = `
    (function () {
      const userFn = ${code};

      const makeChannelInvoker = (reqType) => (...fnArgs) => {
        const chan = new MessageChannel();
        return new Promise((resolve, reject) => {
          chan.port1.onmessage = (e) => {
            const msg = e.data;
            if (msg && msg.type === 'error') {
              reject(new Error(msg.error || 'Unknown RPC error'));
            } else if (msg && msg.type === 'result') {
              resolve(msg.value);
            } else {
              reject(new Error('Unexpected RPC response: ' + JSON.stringify(msg)));
            }
            chan.port1.close();
          };
          if (!window.__taskyonControlPort) {
            reject(new Error('RPC control port not available'));
            return;
          }
          window.__taskyonControlPort.postMessage(
            { type: reqType, args: fnArgs },
            [chan.port2]
          );
        });
      };

      function toolCall(f) {
        return {
          role: 'function',
          name: f.name,
          content: {
            type: 'functioncall',
            data: f,
          },
        };
      }

      function makeTaskResult(tasks) {
        return {
          taskResultMarker: "${taskMarker}",
          taskChainList: tasks,
        };
      }

      function createChatCompletionTask(args) {
        return {
          role: 'function',
          content: {
            type: 'functioncall',
            data: {
              name: 'chatCompletion',
              arguments: args ?? {},
            },
          },
        };
      }

      const rpcContext = {
        getSecret: makeChannelInvoker('getSecret'),
        setSecret: makeChannelInvoker('setSecret'),
      };

      return async function (params, baseContext) {
        const ctx = {
          ...(baseContext || {}),
          ...rpcContext,
          // messagePort is provided via the extra transferable port and exposed by the runner
          messagePort: window.__taskyonMessagePort || null,
          toolCall,
          makeTaskResult,
          createChatCompletionTask,
        };
        return userFn(params, ctx);
      };
    })()
  `

  return executeInIframeCore<unknown>({
    id: toolId,
    code: wrappedCode,
    // The runner will call userFn(...params) where:
    //   params[0] === original params
    //   params[1] === baseContext
    params: [args.params, baseContext],
    sourceURL,
    stopSignal,
    preparePayload: ({ code, params, sourceURL }) => {
      const payload = deepClone({
        code,
        params,
        sourceURL,
      })

      const transfer: Transferable[] = []
      if (messagePort) {
        transfer.push(messagePort)
      }

      return { payload, transfer }
    },
    handleMessage: async ({ event, port, resolve, reject }) => {
      const msg = portMessageSchema.parse(event.data)

      // RPC calls during iframe task execution
      if ('type' in msg && (rpcs as readonly string[]).includes(msg.type)) {
        const fnName = msg.type as keyof toolContext
        const fn = args.context[fnName] as (..._args: unknown[]) => unknown

        // Use the transferred port for this RPC call
        const rpcPort = event.ports && event.ports[0]
        if (!rpcPort) {
          // Defensive: If no port, send error back on main port
          port.postMessage({
            type: `${msg.type} Error`,
            error: 'No response port provided for RPC',
          })
          return
        }

        if (typeof fn === 'function') {
          try {
            const fnargs = msg.args ?? []
            const res = await fn(...fnargs)
            rpcPort.postMessage({ type: 'result', value: res })
          } catch (err) {
            rpcPort.postMessage({
              type: 'error',
              error: err instanceof Error ? err.message : String(err),
            })
          } finally {
            rpcPort.close()
          }
        } else {
          rpcPort.postMessage({ type: 'error', error: `RPC "${msg.type}" not found` })
          rpcPort.close()
        }
        return
      }

      // Final sandbox result
      if ('result' in msg || 'error' in msg) {
        // We keep the control port open for future executions, just detach the handler
        port.onmessage = null
        if (msg.error) {
          reject(new Error(msg.error))
        } else {
          resolve(msg.result)
        }
      }
    },
  })
}
