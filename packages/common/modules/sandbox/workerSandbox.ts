import {
  createExecutableSandboxClient,
  type ExecutableSandbox,
  type SandboxTransport,
} from './executableSandbox.ts'
import type {
  ExecuteInWorkerSandboxOptions,
  SandboxReusePolicy,
  SandboxRuntimeKind,
} from './workerSandboxTypes.ts'

export type { ExecuteInWorkerSandboxOptions, SandboxExecuteOptions } from './workerSandboxTypes.ts'
export type { ExecutableSandbox, SandboxTransport } from './executableSandbox.ts'
export type { SandboxReusePolicy } from './workerSandboxTypes.ts'

const retainedSandboxes = new Map<string, Promise<ExecutableSandbox>>()

function retainedSandboxKey(
  kind: SandboxRuntimeKind,
  id: string,
  reuse: Exclude<SandboxReusePolicy, { mode: 'disposable' }>,
): string {
  const identity = reuse.mode === 'immutable' ? reuse.contentId : reuse.key
  if (!identity) throw new Error(`Sandbox ${reuse.mode} identity is required for ${id}`)
  return `${kind}:${reuse.mode}:${identity}`
}

const isBrowserRuntime = () => typeof window !== 'undefined' && typeof document !== 'undefined'

function runtimeKind(options: {
  browserRuntime?: ExecuteInWorkerSandboxOptions['browserRuntime'] | undefined
  nodeRuntime?: ExecuteInWorkerSandboxOptions['nodeRuntime'] | undefined
}): SandboxRuntimeKind {
  if (!isBrowserRuntime()) return options.nodeRuntime ?? 'node'
  return options.browserRuntime === 'worker' ? 'worker' : 'iframe'
}

async function createTransport(
  kind: SandboxRuntimeKind,
  id: string,
  options: { maxOldSpaceSizeMb?: number | undefined },
): Promise<SandboxTransport> {
  if (kind === 'iframe') {
    const { createBrowserIframeSandboxTransport } = await import('./browserWorkerSandboxRuntime.ts')
    return await createBrowserIframeSandboxTransport(id)
  }
  if (kind === 'worker') {
    const { createBrowserWorkerSandboxTransport } =
      await import('./browserNativeWorkerSandboxRuntime.ts')
    return createBrowserWorkerSandboxTransport()
  }
  if (kind === 'deno') {
    const denoRuntimeModule = './denoWorkerSandboxRuntime.ts'
    const { createDenoSandboxTransport } = (await import(/* @vite-ignore */ denoRuntimeModule)) as {
      createDenoSandboxTransport: (options: {
        maxOldSpaceSizeMb?: number | undefined
      }) => SandboxTransport
    }
    return createDenoSandboxTransport(options)
  }
  const nodeRuntimeModule = './nodeWorkerSandboxRuntime.ts'
  const { createNodeSandboxTransport } = (await import(/* @vite-ignore */ nodeRuntimeModule)) as {
    createNodeSandboxTransport: (options: {
      maxOldSpaceSizeMb?: number | undefined
    }) => SandboxTransport
  }
  return createNodeSandboxTransport(options)
}

export async function createExecutableSandbox(options: {
  id: string
  browserRuntime?: 'iframe' | 'worker'
  nodeRuntime?: 'node' | 'deno'
  maxOldSpaceSizeMb?: number
  reuse?: SandboxReusePolicy
}): Promise<ExecutableSandbox> {
  const kind = runtimeKind(options)
  const reuse = options.reuse ?? { mode: 'affinity', key: options.id }
  const key = reuse.mode === 'disposable' ? undefined : retainedSandboxKey(kind, options.id, reuse)
  const create = async () => {
    const transport = await createTransport(kind, options.id, options)
    return createExecutableSandboxClient(transport, {
      onTerminate: () => {
        if (key) retainedSandboxes.delete(key)
      },
    })
  }
  if (reuse.mode === 'disposable') return await create()
  if (!key) throw new Error('Retained sandbox identity was not created')

  const existing = retainedSandboxes.get(key)
  if (existing) return await existing
  const sandbox = create().catch((error) => {
    retainedSandboxes.delete(key)
    throw error
  })
  retainedSandboxes.set(key, sandbox)
  return await sandbox
}

export async function terminateExecutableSandbox(options: {
  id: string
  browserRuntime?: 'iframe' | 'worker'
  nodeRuntime?: 'node' | 'deno'
  reuse?: Exclude<SandboxReusePolicy, { mode: 'disposable' }>
}): Promise<void> {
  const reuse = options.reuse ?? { mode: 'affinity', key: options.id }
  const key = retainedSandboxKey(runtimeKind(options), options.id, reuse)
  const sandbox = retainedSandboxes.get(key)
  if (!sandbox) return
  ;(await sandbox).terminate()
}

export async function executeInWorkerSandbox<R = unknown>(
  options: ExecuteInWorkerSandboxOptions,
  ...args: unknown[]
): Promise<R> {
  const sandbox = await createExecutableSandbox(options)
  try {
    return await sandbox.execute<R>(options.code, args, {
      signal: options.stopSignal,
      sourceURL: options.sourceURL,
      maxExecutionMs: options.maxExecutionMs,
      maxOutputBytes: options.maxOutputBytes,
    })
  } finally {
    if (options.reuse?.mode === 'disposable') sandbox.terminate()
  }
}
