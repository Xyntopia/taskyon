import { sha256UrlSafeHash } from '../crypto'
import { sleep } from '../utils'
import { taskMarker } from './types'
import type { OnInterruptFunc } from './types'

// Store iframes by a hash id derived from the code
const iframes = new Map<string, HTMLIFrameElement>()

// Create and initialize iframe
function createSandboxedIframe(id: string): Promise<HTMLIFrameElement> {
  console.log('create taskyon iframe worker', id)
  const iframe = document.createElement('iframe')
  iframe.id = id
  iframe.style.display = 'none' // Hide the iframe
  // Restrict permissions to only allow scripts and pop ups
  // we need the pop up permission, so that we can do oauth logins..
  iframe.sandbox.add('allow-scripts', 'allow-popups')
  document.body.appendChild(iframe)

  // Set iframe content to include a message handler for receiving code and params
  const iframeContent = `
<script>
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
window.addEventListener('message', async (event) => {
    const { code, params, sourceURL } = event.data;
    if (code) {
      try {
        const func = new Function("params", "return (" + code + ")(params)\\n//# sourceURL=" + sourceURL);
        const result = await func(params);

        // Post the result back to the parent window
        window.parent.postMessage({ result }, '*');
      } catch (error) {
        window.parent.postMessage({ error: error.message }, '*');
      }
    }
});
// Notify parent that the iframe is ready
window.parent.postMessage({ ready: true }, '*');
//# sourceURL=iframeWorker.js
</script>
`

  // Write the sandboxed script into the iframe
  iframe.srcdoc = iframeContent

  // Return a promise that resolves when the iframe has notified that it is ready
  return new Promise((resolve) => {
    function handleReady(event: MessageEvent) {
      if (event.data.ready && event.source === iframe.contentWindow) {
        // Remove the listener now that the iframe is ready
        window.removeEventListener('message', handleReady)
        resolve(iframe)
      }
    }
    window.addEventListener('message', handleReady)
  })
}

// Singleton iframe instance and an interrupt flag
let interrupted = false

function jsonCopy(reactiveObject: unknown) {
  return JSON.parse(JSON.stringify(reactiveObject))
}

// Function to interrupt the execution
function interruptExecution(id: string, handleMessage: (event: MessageEvent) => void) {
  const iframe = iframes.get(id)
  if (iframe) {
    interrupted = true

    // Remove the function return listener if it exists
    window.removeEventListener('message', handleMessage)

    // Remove the iframe to terminate the script execution
    // TODO: gracefully terminate the iframe. We should be able to stop execution of
    //       a function in an iframe so that we don't loose e.g. oauth access that we've alread had..
    document.body.removeChild(iframe)
    iframes.delete(id)
    // Optionally, you could "reset" the iframe here if needed:
    // iframe.srcdoc = iframe.srcdoc;
  }
}

// Function to execute code in the iframe with parameters
export async function executeCodeInIframe(
  code: string,
  params: Record<string, unknown>,
  sourceURL: string = 'sandboxed-code.js', // TODO: add default source URL for debugging
  onInterrupt: OnInterruptFunc,
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
    function handleMessage(event: MessageEvent) {
      // Ensure the message is coming from the correct iframe
      if (event.source === iframe?.contentWindow) {
        window.removeEventListener('message', handleMessage)
        if (event.data.error) {
          reject(new Error(event.data.error))
        } else {
          resolve(event.data.result)
        }
      }
    }

    // Listen for messages from the iframe
    window.addEventListener('message', handleMessage)

    // Send the code, parameters, and source URL to the iframe for execution
    // we create a deep json copy of the object here, to make
    // sure we dereference reactive objects and everything is json serializable
    // before we send it...
    const sendobj = jsonCopy({ code, params, sourceURL })
    iframe.contentWindow?.postMessage(sendobj, '*')

    // Register the interrupt callback
    onInterrupt((reason) => {
      interruptExecution(id, handleMessage) // Interrupt the execution
      reject(new Error(reason || 'Execution interrupted'))
    })
  })
}
