import { spawn } from 'node:child_process'
import { serializeRemoteError } from '../remoteError.ts'
import { denoWorkerSandboxRunnerSource } from './denoWorkerSandboxRunnerSource.ts'
import type { SandboxTransport } from './executableSandbox.ts'
import type { SandboxRuntimeToHostMessage } from './workerSandboxTypes.ts'

export function createDenoSandboxTransport(options: {
  maxOldSpaceSizeMb?: number | undefined
}): SandboxTransport {
  const child = spawn(
    process.env.TASKYON_DENO_PATH ?? 'deno',
    [
      'eval',
      '--no-config',
      '--unstable-worker-options',
      `--v8-flags=--max-old-space-size=${options.maxOldSpaceSizeMb ?? 128},--wasm-max-mem-pages=8192`,
      denoWorkerSandboxRunnerSource,
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
  const listeners = new Set<(message: SandboxRuntimeToHostMessage) => void>()
  const emit = (message: SandboxRuntimeToHostMessage) =>
    listeners.forEach((listener) => listener(message))
  const fail = (error: unknown) =>
    emit({ kind: 'runtime-error', error: serializeRemoteError(error) })
  let outputBuffer = ''
  let stderr = ''

  child.on('error', (error) => {
    if ('code' in error && error.code === 'ENOENT') {
      fail(new Error('Deno sandbox requires Deno on PATH or TASKYON_DENO_PATH to identify it'))
      return
    }
    fail(error)
  })
  child.on('exit', (code, signal) => {
    fail(
      new Error(
        `Deno sandbox exited (code=${String(code)}, signal=${String(signal)})${stderr ? `: ${stderr.trim()}` : ''}`,
      ),
    )
  })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    outputBuffer += chunk
    for (;;) {
      const newline = outputBuffer.indexOf('\n')
      if (newline < 0) break
      const line = outputBuffer.slice(0, newline)
      outputBuffer = outputBuffer.slice(newline + 1)
      if (line.trim()) emit(JSON.parse(line) as SandboxRuntimeToHostMessage)
    }
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < 64 * 1024) stderr += chunk
  })

  return {
    send: (message) => {
      if (!child.stdin.writable) throw new Error('Deno sandbox process is not writable')
      child.stdin.write(`${JSON.stringify(message)}\n`)
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
