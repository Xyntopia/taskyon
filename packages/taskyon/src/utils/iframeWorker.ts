import z from 'zod'
import { sleep } from './asyncUtils'
import type { toolContext } from '../types/toolApi'
import { taskMarker } from '../types/tools'

// Store iframe + its dedicated MessagePort by toolId / id
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
    // Inject a small runner that:
    //  1. Creates a MessageChannel
    //  2. Sends one port to the parent as "ready"
    //  3. Listens on the other port for work (code execution requests)
    iframe.srcdoc = `
<script>
  // core RPC maker over dedicated channel:
  const makeChannelInvoker = (port, reqType) => (...args) => {
    const chan = new MessageChannel()
    return new Promise((resolve, reject) => {
      chan.port1.onmessage = (e) => {
        const msg = e.data
        if (msg && msg.type === 'error') {
          reject(new Error(msg.error || 'Unknown RPC error'))
        } else if (msg && msg.type === 'result') {
          resolve(msg.value)
        } else {
          reject(new Error('Unexpected RPC response: ' + JSON.stringify(msg)))
        }
        chan.port1.close()
      }
      port.postMessage(
        { type: reqType, args },
        [chan.port2]
      )
    })
  }

  // TODO: automatically add these functions from a central spot in
  //       our codebase, so that we don't have to maintain them here...
  function toolCall(f) {
    return {
      role: 'function',
      name: f.name,
      content: {
        type: 'functioncall',
        data: f,
      },
    }
  }

  function makeTaskResult(tasks) {
    return {
      taskResultMarker: "${taskMarker}",
      taskChainList: tasks,
    }
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
    }
  }

  // Each iframe has its own persistent control channel to the parent
  const controlChannel = new MessageChannel()
  const controlPort = controlChannel.port1
  controlPort.start()

  window.toolId = "${id}"

  // Listen on the controlPort for "execute code" messages from the parent
  controlPort.onmessage = async (e) => {
    // If the parent sends an extra MessagePort (e.g. for streaming),
    // it will arrive here as e.ports[0]
    const messagePort = e.ports && e.ports[0] ? e.ports[0] : null

    const { code, args: { params, context }, rpcs, sourceURL } = e.data

    // we need to re-instantiate our rpcs on every function call
    // as they rely on specific message channels
    // this is partially done for security reasons. But it also makes
    // our functions dynamic in the sense that we can define new
    // rpc calls for every tool execution...
    const rpcdefs = rpcs.reduce((p, c) => {
      p[c] = makeChannelInvoker(controlPort, c)
      return p
    }, {})

    if (code) {
      try {
        const ctx = {
          ...context,
          ...rpcdefs,
          messagePort,
          // Placeholder for stop signal it isn't needed in the iframe worker as we
          // can simply destroy the iframe from the parent...
          stopSignal: new AbortController().signal,
        }
        const func = new Function(
          "params",
          "context",
          "return (" + code + ")(params, context)\\n//# sourceURL=" + sourceURL
        )
        // TODO: add an optional debugger to the function itself
        // debugger;
        const result = await func(params, ctx)
        // Post the result back to the parent window via the control port
        controlPort.postMessage({ result })
      } catch (err) {
        controlPort.postMessage({ error: err?.message || String(err) })
      }
    }
  }

  // signal readiness immediately and transfer the parent's end of the control channel
  window.parent.postMessage({ ready: true }, '*', [controlChannel.port2])
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

interface ExecuteInIframeCoreOptions<C, R> {
  id: string
  code: string
  args: { params: unknown; context: C }
  sourceURL?: string
  stopSignal: AbortSignal
  preparePayload: (input: {
    code: string
    args: { params: unknown; context: C }
    sourceURL: string
  }) => { payload: unknown; transfer: Transferable[] }
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
async function executeInIframeCore<C = unknown, R = unknown>(
  options: ExecuteInIframeCoreOptions<C, R>,
): Promise<R> {
  const { id, code, args, stopSignal, preparePayload, handleMessage } = options
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

    const { payload, transfer } = preparePayload({ code, args, sourceURL })

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

/**
 * Simple iframe executor:
 *  - caller provides `id` manually
 *  - no toolContext, no RPC handling, no extra ports
 */
export function executeCodeInIframeSimple<R = unknown>(
  id: string,
  code: string,
  args: { params: unknown; context?: unknown } = { params: undefined, context: {} },
  sourceURL = 'sandboxed-code.js',
  stopSignal: AbortSignal,
): Promise<R> {
  const context = args.context ?? {}

  return executeInIframeCore<typeof context, R>({
    id,
    code,
    args: { params: args.params, context },
    sourceURL,
    stopSignal,
    preparePayload: ({ code, args, sourceURL }) => {
      const payload = deepClone({
        code,
        args,
        sourceURL,
        // No RPCs for the simple API
        rpcs: [] as string[],
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

// ---------- TOOL-AWARE PUBLIC API ----------

/**
 * Tool-aware executor: same semantics as the original `executeCodeInIframe`,
 * now implemented on top of `executeInIframeCore`.
 */
export function executeCodeInIframe(
  code: string,
  args: { params: unknown; context: toolContext },
  sourceURL = 'sandboxed-code.js',
  stopSignal: AbortSignal,
) {
  const rpcs = ['getSecret', 'setSecret'] as const

  const { toolId, taskChain, messagePort } = args.context

  // For the iframe, we only pass taskChain + toolId as context.
  // Other toolContext functions are only used on the host side for RPC handling.
  const iframeContext = { taskChain, toolId }

  return executeInIframeCore<typeof iframeContext, unknown>({
    id: toolId,
    code,
    args: { params: args.params, context: iframeContext },
    sourceURL,
    stopSignal,
    preparePayload: ({ code, args, sourceURL }) => {
      const payload = deepClone({
        code,
        args,
        sourceURL,
        rpcs,
      })

      const transfer: Transferable[] = []
      if (messagePort) {
        transfer.push(messagePort)
      }

      return { payload, transfer }
    },
    handleMessage: async ({ event, port, resolve, reject }) => {
      const msg = portMessageSchema.parse(event.data)

      // 3) RPC calls during iframe task execution..
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

      // 4) Final sandbox result
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
