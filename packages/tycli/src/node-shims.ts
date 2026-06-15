import {
  MessageChannel as NodeMessageChannel,
  MessagePort as NodeMessagePort,
  Worker as NodeWorker,
} from 'node:worker_threads'
import { accessSync, constants as fsConstants } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const verbose = process.env.TASKYON_CLI_VERBOSE === '1' || process.env.TASKYON_CLI_VERBOSE === 'true'

if (!verbose) {
  console.log = () => {}
  console.info = () => {}
  console.debug = () => {}
  console.warn = () => {}
}

type WorkerListener = (event: { data: unknown }) => void

const fileExists = (path: string) => {
  try {
    accessSync(path, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

const toWorkerUrl = (specifier: string | URL) => {
  const url = typeof specifier === 'string' ? new URL(specifier, import.meta.url) : specifier
  if (url.protocol !== 'file:') return url.href

  const filePath = fileURLToPath(url)
  if (fileExists(filePath)) return url.href

  if (filePath.endsWith('.ts')) {
    const cjsPath = filePath.slice(0, -3) + '.cjs'
    if (fileExists(cjsPath)) return pathToFileURL(cjsPath).href
  }

  return url.href
}

const createWorkerBootstrap = (workerUrl: string) => `
  import { parentPort } from 'node:worker_threads'

  const messageListeners = new Set()
  globalThis.self = globalThis
  globalThis.postMessage = (value) => parentPort?.postMessage(value)
  globalThis.addEventListener = (type, listener) => {
    if (type === 'message' && typeof listener === 'function') {
      messageListeners.add(listener)
    }
  }
  globalThis.removeEventListener = (type, listener) => {
    if (type === 'message' && typeof listener === 'function') {
      messageListeners.delete(listener)
    }
  }

  parentPort?.on('message', (data) => {
    const event = { data }
    if (typeof globalThis.onmessage === 'function') {
      globalThis.onmessage(event)
    }
    for (const listener of messageListeners) {
      listener(event)
    }
  })

  await import(${JSON.stringify(workerUrl)})
`

class BrowserCompatibleWorker {
  private readonly worker: NodeWorker
  private readonly listeners = new Map<WorkerListener, (data: unknown) => void>()
  onmessage: WorkerListener | null = null

  constructor(specifier: string | URL, options?: { type?: 'module' | 'classic'; name?: string }) {
    const workerUrl = toWorkerUrl(specifier)
    this.worker = new NodeWorker(createWorkerBootstrap(workerUrl), {
      eval: true,
      name: options?.name,
      type: options?.type === 'classic' ? 'commonjs' : 'module',
    })

    this.worker.on('message', (data) => {
      const event = { data }
      this.onmessage?.(event)
    })
  }

  postMessage(value: unknown) {
    this.worker.postMessage(value)
  }

  terminate() {
    return this.worker.terminate()
  }

  addEventListener(type: string, listener: WorkerListener) {
    if (type !== 'message') return
    const wrapped = (data: unknown) => listener({ data })
    this.listeners.set(listener, wrapped)
    this.worker.on('message', wrapped)
  }

  removeEventListener(type: string, listener: WorkerListener) {
    if (type !== 'message') return
    const wrapped = this.listeners.get(listener)
    if (!wrapped) return
    this.worker.off('message', wrapped)
    this.listeners.delete(listener)
  }
}

if (typeof globalThis.MessageChannel === 'undefined') {
  globalThis.MessageChannel = NodeMessageChannel as typeof MessageChannel
}

if (typeof globalThis.MessagePort === 'undefined') {
  globalThis.MessagePort = NodeMessagePort as typeof MessagePort
}

if (typeof globalThis.Worker === 'undefined') {
  globalThis.Worker = BrowserCompatibleWorker as typeof Worker
}

export {}
