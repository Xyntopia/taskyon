const controlChannel = new MessageChannel()
const controlPort = controlChannel.port1
controlPort.start()

const prefix = `[IFRAME-WORKER]${window.id}`
const style = 'color:#1e90ff;font-weight:bold'
;['log', 'info', 'warn', 'error'].forEach((k) => {
  const orig = console[k]
  console[k] = orig.bind(console, `%c${prefix}`, style)
})

controlPort.onmessage = async (e) => {
  const extraPort = e.ports && e.ports[0] ? e.ports[0] : null
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
      `const userFn = (${code});\nreturn userFn(...params);\n//# sourceURL=${sourceURL}`,
    )
    const result = await fn(params)
    controlPort.postMessage({ result })
  } catch (err) {
    const message = err && typeof err === 'object' && 'message' in err ? err.message : String(err)
    controlPort.postMessage({ error: message })
  }
}

window.parent.postMessage({ ready: true }, '*', [controlChannel.port2])
console.log('Iframe runtime initialized and ready', window.id)
