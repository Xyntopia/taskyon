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

  // Inject a small runner that listens for a port transfer
  iframe.srcdoc = `
<script>
  const pending = new Map()

  let secretId = 0

  const getSecret = (name) => {
    const id = ++secretId
    return new Promise((resolve) => {
      pending.set('getSecret:' + id, resolve)
      port.postMessage({ type: 'getSecret', name, id })
    })
  }

  const setSecret = (name, value) => {
    const id = ++secretId
    return new Promise((resolve) => {
      pending.set('setSecret:' + id, resolve)
      port.postMessage({ type: 'setSecret', name, value, id })
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

    port.onmessage = (e) => {
      const { type, name, value, id } = e.data
      if (type === 'getSecretResult') {
        const resolve = pending.get('getSecret:' + id)
        resolve(value)
        pending.delete('getSecret:' + id)
      } else if (type === 'setSecretResult') {
        const resolve = pending.get('setSecret:' + id)
        resolve()
        pending.delete('setSecret:' + id)
      }
    }

    const { code, args: { params, context }, sourceURL } = e.data
    if (code) {
      try {
        const ctx = {
          ...context,
          getSecret,
          setSecret,
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

// Main executor
export async function executeCodeInIframe(
  code: string,
  args: { params: unknown; context: toolContext },
  sourceURL = 'sandboxed-code.js',
  stopSignal: AbortSignal,
) {
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

    port.onmessage = async (ev) => {
      const { type, name, value } = ev.data

      if (type === 'getSecret') {
        const secret = await args.context.getSecret(name)
        port.postMessage({ type: 'getSecretResult', name, value: secret })
      } else if (type === 'setSecret') {
        args.context.setSecret(name, value)
        port.postMessage({ type: 'setSecretResult', name })
      } else {
        const { result, error } = ev.data
        port.close()
        if (error) reject(new Error(error))
        else resolve(result)
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
