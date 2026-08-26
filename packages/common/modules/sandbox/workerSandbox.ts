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

type RetainedSandbox = {
  sandbox: Promise<ExecutableSandbox>
  activeUses: number
  lastUsed: number
}

const retainedSandboxes = new Map<string, RetainedSandbox>()
const maxRetainedImmutableSandboxes = 8
let sandboxUseSequence = 0

const evictIdleImmutableSandboxes = async () => {
  const immutable = [...retainedSandboxes.entries()].filter(([key]) => key.includes(':immutable:'))
  const excess = immutable.length - maxRetainedImmutableSandboxes
  if (excess <= 0) return
  const idle = immutable
    .filter(([, entry]) => entry.activeUses === 0)
    .sort(([, left], [, right]) => left.lastUsed - right.lastUsed)
    .slice(0, excess)
  await Promise.all(
    idle.map(async ([key, entry]) => {
      if (retainedSandboxes.get(key) !== entry || entry.activeUses > 0) return
      retainedSandboxes.delete(key)
      ;(await entry.sandbox).terminate('Idle sandbox evicted from the bounded pool')
    }),
  )
}

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

const getRetainedSandbox = async (
  options: {
    id: string
    browserRuntime?: 'iframe' | 'worker'
    nodeRuntime?: 'node' | 'deno'
    maxOldSpaceSizeMb?: number
    reuse: Exclude<SandboxReusePolicy, { mode: 'disposable' }>
  },
  reserve: boolean,
): Promise<{ sandbox: ExecutableSandbox; entry: RetainedSandbox }> => {
  const kind = runtimeKind(options)
  const key = retainedSandboxKey(kind, options.id, options.reuse)
  const existing = retainedSandboxes.get(key)
  if (existing) {
    existing.activeUses += reserve ? 1 : 0
    existing.lastUsed = ++sandboxUseSequence
    return { sandbox: await existing.sandbox, entry: existing }
  }

  const create = async () => {
    const transport = await createTransport(kind, options.id, options)
    return createExecutableSandboxClient(transport, {
      onTerminate: () => retainedSandboxes.delete(key),
    })
  }
  const sandbox = create().catch((error) => {
    retainedSandboxes.delete(key)
    throw error
  })
  const entry = {
    sandbox,
    activeUses: reserve ? 1 : 0,
    lastUsed: ++sandboxUseSequence,
  }
  retainedSandboxes.set(key, entry)
  if (!reserve) void evictIdleImmutableSandboxes()
  return { sandbox: await sandbox, entry }
}

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
  const reuse = options.reuse ?? { mode: 'affinity', key: options.id }
  if (reuse.mode === 'disposable') {
    const transport = await createTransport(runtimeKind(options), options.id, options)
    return createExecutableSandboxClient(transport)
  }
  return (await getRetainedSandbox({ ...options, reuse }, false)).sandbox
}

export async function acquireExecutableSandbox(options: {
  id: string
  browserRuntime?: 'iframe' | 'worker'
  nodeRuntime?: 'node' | 'deno'
  maxOldSpaceSizeMb?: number
  reuse: Exclude<SandboxReusePolicy, { mode: 'disposable' }>
}): Promise<{ sandbox: ExecutableSandbox; release: () => void }> {
  const { sandbox, entry } = await getRetainedSandbox(options, true)
  entry.lastUsed = ++sandboxUseSequence
  let released = false
  return {
    sandbox,
    release: () => {
      if (released) return
      released = true
      entry.activeUses = Math.max(0, entry.activeUses - 1)
      entry.lastUsed = ++sandboxUseSequence
      void evictIdleImmutableSandboxes()
    },
  }
}

export async function terminateExecutableSandbox(options: {
  id: string
  browserRuntime?: 'iframe' | 'worker'
  nodeRuntime?: 'node' | 'deno'
  reuse?: Exclude<SandboxReusePolicy, { mode: 'disposable' }>
}): Promise<void> {
  const reuse = options.reuse ?? { mode: 'affinity', key: options.id }
  const key = retainedSandboxKey(runtimeKind(options), options.id, reuse)
  const entry = retainedSandboxes.get(key)
  if (!entry) return
  ;(await entry.sandbox).terminate()
}

export async function terminateRetainedExecutableSandboxes(): Promise<void> {
  const sandboxes = [...retainedSandboxes.values()]
  retainedSandboxes.clear()
  await Promise.all(sandboxes.map(async ({ sandbox }) => (await sandbox).terminate()))
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
