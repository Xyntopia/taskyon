import z from 'zod'
import { sha256UrlSafeHash } from '../crypto'
import { sleep } from '../utils'
import type { toolContext } from './types'
import { taskMarker } from './types'

// Store iframes by a hash id derived from the code
const iframes = new Map<string, HTMLIFrameElement>()

// Create and initialize iframe
async function createSandboxedIframe(id: string): Promise<HTMLIFrameElement> {
  console.log('create taskyon iframe worker', id)
  const iframe = document.createElement('iframe')
  iframe.id = id
  iframe.style.display = 'none'
  iframe.sandbox.add('allow-scripts', 'allow-popups', 'allow-popups-to-escape-sandbox')
  document.body.appendChild(iframe)

  try {
    // Inject a small runner that listens for a port transfer
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

  window.taskyonId = "${id}"

  window.addEventListener('message', async (e) => {
    const port = e.ports[0]
    const { code, args: { params, context }, rpcs, sourceURL } = e.data

    // we need to re-instantiate our rpcs on every function call
    // as they rely on specific message channels
    // this is partially done for security reasons. But it also makes
    // our functions dynamic...
    const rpcdefs = rpcs.reduce((p,c)=>{p[c] = makeChannelInvoker(port, c); return p},{})

    if (code) {
      try {
        const ctx = {
          ...context,
          ...rpcdefs,
          // Placeholder for stop signal it isn't needed in the iframe worker as we
          // can simply destroy the iframe from the parent...
          stopSignal: new AbortController().signal,
        }
        const func = new Function("params", "context", "return (" + code + ")(params, context)\\n//# sourceURL=" + sourceURL);
        const result = await func(params, ctx)
        // Post the result back to the parent window
        port.postMessage({ result })
      } catch (err) {
        port.postMessage({ error: err?.message || String(err) })
      }
    }
  })
  // signal readiness immediately
  window.parent.postMessage({ ready: true }, '*')
  //# sourceURL=iframeWorker.js

</script>`
  } catch (error: unknown) {
    throw new Error(
      `Iframe worker code contains errors: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    )
  }

  // wait for the ready ping
  return new Promise((resolve) => {
    function onReady(ev: MessageEvent) {
      if (ev.data.ready && ev.source === iframe.contentWindow) {
        window.removeEventListener('message', onReady)
        resolve(iframe)
      }
    }
    window.addEventListener('message', onReady)
  })
}

// Interrupt logic (same as before)
let interrupted = false
function interruptExecution(id: string, port: MessagePort) {
  const iframe = iframes.get(id)
  if (!iframe) return
  interrupted = true
  port.close()
  // Remove the iframe to terminate the script execution
  // TODO: gracefully terminate the iframe. We should be able to stop execution of
  //       a function in an iframe so that we don't loose e.g. oauth access that we've alread had..
  document.body.removeChild(iframe)
  iframes.delete(id)
  // Optionally, you could "reset" the iframe here if needed:
  // iframe.srcdoc = iframe.srcdoc;
}

// Deep‐copy helper
function jsonCopy(obj: unknown) {
  return JSON.parse(JSON.stringify(obj))
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
  const rpcs = ['getSecret', 'setSecret']

  const id = sourceURL + (await sha256UrlSafeHash(code))
  let iframe = iframes.get(id)
  // Lazy initialize iframe
  if (!iframe || interrupted) {
    iframe = await createSandboxedIframe(id)
    iframes.set(id, iframe)
    // Add a delay to ensure iframe is fully ready. Its ok, because we normally do this only once here...
    await sleep(100)
  }

  return new Promise((resolve, reject) => {
    // 1) create a fresh channel
    const channel = new MessageChannel()
    const port = channel.port1

    port.onmessage = async (ev: MessageEvent) => {
      const msg = portMessageSchema.parse(ev.data)

      // 3) RPC calls during iframe task execution..
      if ('type' in msg && rpcs.includes(msg.type)) {
        const fnName = msg.type as keyof toolContext
        const fn = args.context[fnName] as (...args: unknown[]) => unknown
        // Use the transferred port for this RPC call
        const rpcPort = ev.ports && ev.ports[0]
        if (!rpcPort) {
          // Defensive: If no port, send error back on main port
          port.postMessage({ type: `${msg.type}Error`, error: 'No response port provided for RPC' })
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
        port.close()
        if (msg.error) reject(new Error(msg.error))
        else resolve(msg.result)
      }
    }

    // 2) send code + port2 to iframe
    // Send the code, parameters, and source URL to the iframe for execution
    // we create a deep json copy of the object here, to make
    // sure we dereference reactive objects and everything is json serializable
    // before we send it...
    const payload = jsonCopy({
      code,
      args: {
        params: args.params,
        context: { taskChain: args.context.taskChain },
      },
      sourceURL,
      rpcs,
    })
    iframe.contentWindow!.postMessage(payload, '*', [channel.port2])

    // 3) wire up abort
    stopSignal.addEventListener('abort', () => {
      console.log('Interrupting iframe execution for', id)
      interruptExecution(id, port)
      reject(new Error('Execution interrupted', { cause: stopSignal.reason }))
    })
  })
}
