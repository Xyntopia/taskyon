// iframeIndex.ts
// Each iframe has its own persistent control channel to the parent
const controlChannel = new MessageChannel()
const controlPort = controlChannel.port1
controlPort.start()

const prefix = `[IFRAME-WORKER]${window.id}`
const style = 'color:#1e90ff;font-weight:bold'
;['log', 'info', 'warn', 'error'].forEach((k) => {
  const orig = console[k] // keep original

  // Prepend "%c[prefix]" + style without a JS wrapper
  console[k] = orig.bind(console, `%c${prefix}`, style)
})

// Expose control port and id for advanced/tool use
// window.__taskyonControlPort = controlPort
// window.toolId = '${id}'

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
      'params',
      `const userFn = (${code});
return userFn(...params);
//# sourceURL=${sourceURL}`,
    )
    const result = await fn(params)
    controlPort.postMessage({ result })
  } catch (err) {
    const message = err && typeof err === 'object' && 'message' in err ? err.message : String(err)
    controlPort.postMessage({ error: message })
  }
}

// Signal readiness and transfer the parent's end of the control channel
window.parent.postMessage({ ready: true }, '*', [controlChannel.port2])
console.log('Iframe runtime initialized and ready', window.id)
