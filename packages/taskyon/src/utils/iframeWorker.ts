import z from 'zod'
import { sleep } from './asyncUtils'
import type { toolContext } from '../types/toolApi'
import { taskMarker } from '../types/tools'

// Store iframe + its dedicated MessagePort by toolId
const iframes = new Map<string, { iframe: HTMLIFrameElement; port: MessagePort }>()

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

// Main executor
export async function executeCodeInIframe(
  code: string,
  args: { params: unknown; context: toolContext },
  sourceURL = 'sandboxed-code.js',
  stopSignal: AbortSignal,
) {
  const rpcs = ['getSecret', 'setSecret'] as const

  const toolId = args.context.toolId
  let iframeEntry = iframes.get(toolId)

  // Lazy initialize iframe + control port
  if (!iframeEntry || interrupted) {
    iframeEntry = await createSandboxedIframe(toolId)
    iframes.set(toolId, iframeEntry)
    interrupted = false
    // Add a delay to ensure iframe is fully ready. Its ok, because we normally do this only once here...
    await sleep(100)
  }

  const { port } = iframeEntry

  return new Promise((resolve, reject) => {
    // Handler for messages coming from the iframe over the persistent control port
    const onMessage = async (ev: MessageEvent) => {
      const msg = portMessageSchema.parse(ev.data)

      // 3) RPC calls during iframe task execution..
      if ('type' in msg && (rpcs as readonly string[]).includes(msg.type)) {
        const fnName = msg.type as keyof toolContext
        const fn = args.context[fnName] as (..._args: unknown[]) => unknown

        // Use the transferred port for this RPC call
        const rpcPort = ev.ports && ev.ports[0]
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
        if (msg.error) reject(new Error(msg.error))
        else resolve(msg.result)
      }
    }

    // Wire up the handler for this execution.
    // Assumption: only one active execution per iframe/toolId at a time.
    port.onmessage = onMessage
    port.start()

    // 2) send code + (optional) extra port to iframe over the persistent control port
    const payload = JSON.parse(
      JSON.stringify({
        code,
        args: {
          params: args.params,
          context: { taskChain: args.context.taskChain, toolId },
        },
        sourceURL,
        rpcs,
      }),
    )

    const transfer: Transferable[] = []
    if (args.context.messagePort) {
      transfer.push(args.context.messagePort)
    }

    // Send the work request to the iframe
    // iframe.contentWindow // sanity check (can be removed if not needed)
    port.postMessage(payload, transfer)

    // 3) wire up abort
    const onAbort = () => {
      console.log('Interrupting iframe execution for', toolId)
      interruptExecution(toolId)
      reject(new Error('Execution interrupted', { cause: stopSignal.reason }))
    }

    if (stopSignal.aborted) {
      onAbort()
      return
    }

    stopSignal.addEventListener('abort', onAbort, { once: true })
  })
}
