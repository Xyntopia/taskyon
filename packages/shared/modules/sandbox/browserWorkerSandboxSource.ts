const sandboxGlobal = globalThis
const controlChannel = new MessageChannel()
const controlPort = controlChannel.port1
controlPort.start()

const pendingRpc = new Map()
let rpcCounter = 0

function getSandboxId() {
  const value = window['id']
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

const prefix = `[WORKER-SANDBOX]${getSandboxId()}`
const style = 'color:#1e90ff;font-weight:bold'
const originalLog = console.log
const originalInfo = console.info
const originalWarn = console.warn
const originalError = console.error

console.log = originalLog.bind(console, `%c${prefix}`, style)
console.info = originalInfo.bind(console, `%c${prefix}`, style)
console.warn = originalWarn.bind(console, `%c${prefix}`, style)
console.error = originalError.bind(console, `%c${prefix}`, style)

sandboxGlobal.__workerSandboxRpc = (rpcType, ...args) =>
  new Promise((resolve, reject) => {
    const requestId = `rpc-${Date.now()}-${rpcCounter++}`
    pendingRpc.set(requestId, { resolve, reject })
    controlPort.postMessage({
      kind: 'rpc-request',
      requestId,
      rpcType,
      args,
    })
  })

controlPort.onmessage = async (event) => {
  const data = event.data ?? {}

  if (data.kind === 'rpc-result' && typeof data.requestId === 'string') {
    const pending = pendingRpc.get(data.requestId)
    if (!pending) return
    pendingRpc.delete(data.requestId)
    pending.resolve(data.value)
    return
  }

  if (data.kind === 'rpc-error' && typeof data.requestId === 'string') {
    const pending = pendingRpc.get(data.requestId)
    if (!pending) return
    pendingRpc.delete(data.requestId)
    const error = data.error ?? {}
    const message =
      typeof error.message === 'string' && error.message
        ? error.message
        : 'Worker sandbox RPC failed'
    const rpcError = new Error(message)
    if (typeof error.name === 'string' && error.name) rpcError.name = error.name
    if (typeof error.stack === 'string' && error.stack) rpcError.stack = error.stack
    pending.reject(rpcError)
    return
  }

  if (data.kind !== 'execute') return

  const extraPort = event.ports && event.ports[0] ? event.ports[0] : null
  sandboxGlobal.__workerSandboxMessagePort = extraPort
  const code = typeof data.code === 'string' ? data.code : ''
  const args = Array.isArray(data.args) ? data.args : []
  const sourceURL =
    typeof data.sourceURL === 'string' && data.sourceURL.trim().length > 0
      ? data.sourceURL
      : 'sandboxed-code.js'

  if (!code) return

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(
      'args',
      `const userFn = (${code});\nreturn userFn(...args);\n//# sourceURL=${sourceURL}`,
    )
    const result = await fn(args)
    controlPort.postMessage({ kind: 'result', result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const name = error instanceof Error ? error.name : 'Error'
    const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : ''
    controlPort.postMessage({
      kind: 'error',
      error: {
        message,
        name,
        stack,
      },
    })
  }
}

window.parent.postMessage({ ready: true }, '*', [controlChannel.port2])
console.log('Worker sandbox runtime initialized', getSandboxId())
