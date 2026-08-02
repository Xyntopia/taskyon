import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { serializeRemoteError } from '../remoteError.ts'
import type { SandboxTransport } from './executableSandbox.ts'
import type { SandboxRuntimeToHostMessage } from './workerSandboxTypes.ts'

const NODE_WORKER_SANDBOX_RUNNER = fileURLToPath(
  new URL('./nodeWorkerSandboxRunner.mjs', import.meta.url),
)
const EXECUTABLE_SANDBOX_RUNTIME = fileURLToPath(
  new URL('./executableSandboxRuntime.js', import.meta.url),
)
const SANDBOX_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  VUE_ROUTER_BASE: '/',
  VUE_ROUTER_MODE: 'history',
}

export function createNodeSandboxTransport(options: {
  maxOldSpaceSizeMb?: number | undefined
}): SandboxTransport {
  const child = spawn(
    process.execPath,
    [
      '--experimental-permission',
      `--allow-fs-read=${NODE_WORKER_SANDBOX_RUNNER}`,
      `--allow-fs-read=${EXECUTABLE_SANDBOX_RUNTIME}`,
      `--max-old-space-size=${options.maxOldSpaceSizeMb ?? 128}`,
      NODE_WORKER_SANDBOX_RUNNER,
    ],
    {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'] as const,
      env: SANDBOX_ENV,
      detached: process.platform !== 'win32',
    },
  )
  const listeners = new Set<(message: SandboxRuntimeToHostMessage) => void>()
  const emit = (message: SandboxRuntimeToHostMessage) =>
    listeners.forEach((listener) => listener(message))
  const fail = (error: unknown) =>
    emit({ kind: 'runtime-error', error: serializeRemoteError(error) })

  child.on('message', (message) => emit(message as SandboxRuntimeToHostMessage))
  child.on('error', fail)
  child.on('exit', (code, signal) => {
    fail(
      new Error(
        `Worker sandbox subprocess exited (code=${String(code)}, signal=${String(signal)})`,
      ),
    )
  })

  return {
    send: (message) => {
      if (!child.connected) throw new Error('Node sandbox process is not connected')
      child.send(message, (error) => {
        if (error) fail(error)
      })
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    terminate: () => {
      listeners.clear()
      if (!child.killed) child.kill('SIGKILL')
    },
  }
}
