export function installExecutableSandboxRuntime() {
  const executions = new Map()
  const installedModules = new Map()
  const channels = new Map()
  let controlPort = null

  for (const name of [
    'EventSource',
    'SharedWorker',
    'WebSocket',
    'Worker',
    'XMLHttpRequest',
    'importScripts',
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(globalThis, name, {
        configurable: false,
        value: undefined,
        writable: false,
      })
    }
  }
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: undefined,
    writable: false,
  })

  function serializeError(error) {
    const normalized = error instanceof Error ? error : new Error(String(error))
    return {
      message: normalized.message || 'Unknown error',
      name: normalized.name || 'Error',
      stack: typeof normalized.stack === 'string' ? normalized.stack : '',
    }
  }

  function createSandboxApi(message, signal) {
    const channel = message.channelId ? channels.get(message.channelId) : undefined
    if (message.channelId && !channel) {
      throw new Error(`Sandbox channel "${message.channelId}" is not open`)
    }
    return Object.freeze({
      signal,
      port: channel?.port,
    })
  }

  function cancelExecution(executionId, reason) {
    executions.get(executionId)?.abort(reason)
  }

  function finishExecution(executionId) {
    executions.delete(executionId)
  }

  async function execute(message) {
    const controller = new AbortController()
    executions.set(message.requestId, controller)
    try {
      const sandboxApi = createSandboxApi(message, controller.signal)
      const installed = message.moduleId ? installedModules.get(message.moduleId) : undefined
      if (message.moduleId && !installed) {
        throw new Error(`Sandbox module "${message.moduleId}" is not installed`)
      }
      const dynamic = message.code
        ? new Function(
            'args',
            'sandboxApi',
            `const userFn = (${message.code});\nreturn userFn(...args);\n//# sourceURL=${message.sourceURL}`,
          )
        : undefined
      const result = installed
        ? await installed.fn(...message.args, sandboxApi)
        : await dynamic(message.args, sandboxApi)
      if (controller.signal.aborted) {
        controlPort?.postMessage({
          kind: 'cancelled',
          requestId: message.requestId,
          reason: String(controller.signal.reason || 'Execution cancelled'),
        })
      } else {
        controlPort?.postMessage({ kind: 'result', requestId: message.requestId, result })
      }
    } catch (error) {
      controlPort?.postMessage({
        kind: 'error',
        requestId: message.requestId,
        error: serializeError(error),
      })
    } finally {
      finishExecution(message.requestId)
    }
  }

  function install(message) {
    try {
      const existing = installedModules.get(message.moduleId)
      if (existing && existing.source !== message.code) {
        throw new Error(`Sandbox module "${message.moduleId}" is immutable and already installed`)
      }
      if (!existing) {
        const fn = new Function(`return (${message.code});\n//# sourceURL=${message.sourceURL}`)()
        if (typeof fn !== 'function') throw new Error('Installed sandbox module must be a function')
        installedModules.set(message.moduleId, { source: message.code, fn })
      }
      controlPort?.postMessage({ kind: 'result', requestId: message.requestId })
    } catch (error) {
      controlPort?.postMessage({
        kind: 'error',
        requestId: message.requestId,
        error: serializeError(error),
      })
    }
  }

  function createVirtualChannel(channelId) {
    const listeners = new Set()
    const port = {
      onmessage: null,
      postMessage: (payload) =>
        controlPort?.postMessage({ kind: 'channel-message', channelId, payload }),
      addEventListener: (type, listener) => {
        if (type === 'message') listeners.add(listener)
      },
      removeEventListener: (type, listener) => {
        if (type === 'message') listeners.delete(listener)
      },
      start: () => undefined,
      close: () => {
        channels.delete(channelId)
        controlPort?.postMessage({ kind: 'channel-close', channelId })
      },
    }
    channels.set(channelId, {
      port,
      receive: (payload) => {
        const event = { data: payload }
        port.onmessage?.(event)
        listeners.forEach((listener) => listener(event))
      },
    })
    return port
  }

  async function openChannel(message) {
    const controller = new AbortController()
    executions.set(message.requestId, controller)
    try {
      const port = createVirtualChannel(message.channelId)
      const sandboxApi = createSandboxApi(message, controller.signal)
      const installer = new Function(
        'args',
        'sandboxApi',
        `const userFn = (${message.installerCode});\nreturn userFn(...args);\n//# sourceURL=${message.sourceURL}`,
      )
      await installer([port, ...message.args], sandboxApi)
      controlPort?.postMessage({ kind: 'result', requestId: message.requestId })
    } catch (error) {
      channels.delete(message.channelId)
      controlPort?.postMessage({
        kind: 'error',
        requestId: message.requestId,
        error: serializeError(error),
      })
    } finally {
      finishExecution(message.requestId)
    }
  }

  function connect(port) {
    if (controlPort) throw new Error('Sandbox control port is already connected')
    controlPort = port
    controlPort.onmessage = (event) => {
      const message = event.data ?? {}
      if (message.kind === 'cancel') {
        cancelExecution(message.requestId, message.reason)
      } else if (message.kind === 'channel-message') {
        channels.get(message.channelId)?.receive(message.payload)
      } else if (message.kind === 'channel-close') {
        channels.delete(message.channelId)
      } else if (message.kind === 'install') {
        install(message)
      } else if (message.kind === 'open-channel') {
        void openChannel(message)
      } else if (message.kind === 'execute') {
        void execute(message)
      }
    }
    controlPort.start()
  }

  if (typeof window !== 'undefined' && window.parent) {
    const controlChannel = new MessageChannel()
    connect(controlChannel.port1)
    window.parent.postMessage({ ready: true }, '*', [controlChannel.port2])
  } else if (typeof process !== 'undefined' && typeof process.send === 'function') {
    const ipcPort = {
      onmessage: null,
      postMessage: (message) => process.send?.(message),
      start: () => undefined,
    }
    process.on('message', (data) => ipcPort.onmessage?.({ data, ports: [] }))
    connect(ipcPort)
  } else {
    globalThis.onmessage = (event) => {
      if (event.data?.kind !== 'connect') return
      const [port] = event.ports || []
      if (port) connect(port)
    }
  }
}

export const executableSandboxRuntimeSource = `(${installExecutableSandboxRuntime.toString()})()`
