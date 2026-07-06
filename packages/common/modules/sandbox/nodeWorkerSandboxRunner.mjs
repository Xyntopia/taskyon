function serializeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message || 'Unknown error',
      name: error.name || 'Error',
      stack: typeof error.stack === 'string' ? error.stack : '',
    }
  }
  return {
    message: String(error),
    name: 'Error',
    stack: '',
  }
}

const pendingRpc = new Map()
let rpcCounter = 0

globalThis.__workerSandboxMessagePort = null
globalThis.__workerSandboxRpc = (rpcType, ...args) =>
  new Promise((resolve, reject) => {
    const requestId = `rpc-${Date.now()}-${rpcCounter++}`
    pendingRpc.set(requestId, { resolve, reject })
    process.send?.({
      kind: 'rpc-request',
      requestId,
      rpcType,
      args,
    })
  })

process.on('message', async (message) => {
  if (!message || typeof message !== 'object') return

  if (message.kind === 'rpc-result' && typeof message.requestId === 'string') {
    const pending = pendingRpc.get(message.requestId)
    if (!pending) return
    pendingRpc.delete(message.requestId)
    pending.resolve(message.value)
    return
  }

  if (message.kind === 'rpc-error' && typeof message.requestId === 'string') {
    const pending = pendingRpc.get(message.requestId)
    if (!pending) return
    pendingRpc.delete(message.requestId)
    pending.reject(new Error(message.error?.message || 'Worker sandbox RPC failed'))
    return
  }

  if (message.kind !== 'execute') return

  const code = typeof message.code === 'string' ? message.code : ''
  const args = Array.isArray(message.args) ? message.args : []
  const sourceURL =
    typeof message.sourceURL === 'string' && message.sourceURL.trim().length > 0
      ? message.sourceURL
      : 'sandboxed-code.js'

  if (!code) {
    process.send?.({
      kind: 'error',
      error: serializeError(new Error('Missing worker sandbox code')),
    })
    return
  }

  try {
    const fn = new Function(
      'args',
      `const userFn = (${code});\nreturn userFn(...args);\n//# sourceURL=${sourceURL}`,
    )
    const result = await fn(args)
    process.send?.({ kind: 'result', result })
  } catch (error) {
    process.send?.({
      kind: 'error',
      error: serializeError(error),
    })
  }
})
