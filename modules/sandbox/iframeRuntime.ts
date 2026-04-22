import * as mod from './iframeRuntimeIndex?raw'

const iframeRuntimeString = mod.default ?? mod

export const iframes = new Map<string, { iframe: HTMLIFrameElement; port: MessagePort }>()

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function createSandboxedIframe(
  id: string,
): Promise<{ iframe: HTMLIFrameElement; port: MessagePort }> {
  const iframe = document.createElement('iframe')
  iframe.id = id
  iframe.style.display = 'none'
  iframe.sandbox.add('allow-scripts', 'allow-popups', 'allow-popups-to-escape-sandbox')
  document.body.appendChild(iframe)

  try {
    iframe.srcdoc = `<script>\n  window.id = "${id}";\n  ${iframeRuntimeString}\n  //# sourceURL=IW_${id}\n</script>`
  } catch (error: unknown) {
    throw new Error(
      `Iframe worker code contains errors: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    )
  }

  const ready = await new Promise<{ iframe: HTMLIFrameElement; port: MessagePort }>((resolve) => {
    function onReady(ev: MessageEvent) {
      if (ev.data && ev.data.ready && ev.source === iframe.contentWindow) {
        const [port] = ev.ports || []
        if (!port) return
        window.removeEventListener('message', onReady)
        port.start()
        iframes.set(id, { iframe, port })
        resolve({ iframe, port })
      }
    }
    window.addEventListener('message', onReady)
  })

  await sleep(100)
  return ready
}

export function interruptExecution(id: string) {
  const entry = iframes.get(id)
  if (!entry) return

  const { iframe, port } = entry

  try {
    port.close()
  } catch {
    // ignore
  }

  document.body.removeChild(iframe)
  iframes.delete(id)
}
