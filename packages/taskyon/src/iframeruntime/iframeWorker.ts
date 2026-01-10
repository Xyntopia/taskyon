import iframeRuntimeString from './iframeIndex.js?raw'

// Store iframe + its dedicated MessagePort by id / toolId
export const iframes = new Map<string, { iframe: HTMLIFrameElement; port: MessagePort }>()

// TODO: can we use iframebridge here?

// Create and initialize iframe and its control MessagePort
export async function createSandboxedIframe(
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
    iframe.srcdoc = `<script>
  window.id = "${id}";
  ${iframeRuntimeString}
  //# sourceURL=IW_${id}
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
        console.log('Iframe worker ready', id)
        window.removeEventListener('message', onReady)
        port.start()
        iframes.set(id, { iframe, port })
        resolve({ iframe, port })
      }
    }
    window.addEventListener('message', onReady)
  })
}

// Interrupt logic
export function interruptExecution(id: string) {
  const entry = iframes.get(id)
  if (!entry) return

  const { iframe, port } = entry

  // Close the control port
  try {
    port?.close()
  } catch {
    // ignore
  }

  // Remove the iframe to terminate the script execution
  // TODO: gracefully terminate the iframe. We should be able to stop execution of
  //       a function in an iframe so that we don't loose e.g. oauth access that we've alread had..
  document.body.removeChild(iframe)
  iframes.delete(id)
}
