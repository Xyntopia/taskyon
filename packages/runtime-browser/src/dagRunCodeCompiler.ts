import { DAG_RUN_CODE_COMPILER_VERSION } from '@taskyon/comp-dag/dagModuleCompiler'
import {
  createDagPackageArtifactResolver,
  parseDagRuntimePackageManifest,
} from '@taskyon/comp-dag/dagPackageArtifact'
import type {
  DagCompiledNodeArtifact,
  DagResolvedPackage,
  DagRunCodeArtifactCompiler,
  DagRunCodeCompilerInput,
} from '@taskyon/comp-dag/designRepositorySnapshot'

type CompileResponse =
  | {
      type: 'compiled'
      requestId: number
      artifact: Omit<DagCompiledNodeArtifact, 'cacheId'>
    }
  | { type: 'compile-error'; requestId: number; message: string; stack?: string }

const isCompileResponse = (value: unknown): value is CompileResponse => {
  if (!value || typeof value !== 'object') return false
  const type = Reflect.get(value, 'type')
  const requestId = Reflect.get(value, 'requestId')
  if (!Number.isInteger(requestId)) return false
  if (type === 'compiled') return typeof Reflect.get(value, 'artifact') === 'object'
  return type === 'compile-error' && typeof Reflect.get(value, 'message') === 'string'
}

const fetchText = async (path: string) => {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Could not load DAG runtime artifact ${path}: HTTP ${response.status}.`)
  }
  return await response.text()
}

const fetchJson = async (path: string): Promise<unknown> => JSON.parse(await fetchText(path))

export const createBrowserDagRunCodeCompiler = () => {
  let worker: Worker | undefined
  let requestId = 0
  const pending = new Map<
    number,
    {
      resolve: (artifact: Omit<DagCompiledNodeArtifact, 'cacheId'>) => void
      reject: (error: Error) => void
    }
  >()
  const packageResolver = createDagPackageArtifactResolver({
    manifest: async () =>
      parseDagRuntimePackageManifest(await fetchJson('/dag-runtime-packages/manifest.json')),
    loadSource: fetchText,
  })

  const rejectPending = (error: Error) => {
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  const requireWorker = () => {
    if (worker) return worker
    worker = new Worker(new URL('./dagRunCodeCompiler.worker.ts', import.meta.url), {
      type: 'module',
      name: 'taskyon-dag-compiler',
    })
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (!isCompileResponse(event.data)) return
      const request = pending.get(event.data.requestId)
      if (!request) return
      pending.delete(event.data.requestId)
      if (event.data.type === 'compiled') request.resolve(event.data.artifact)
      else {
        const error = new Error(event.data.message)
        if (event.data.stack) error.stack = event.data.stack
        request.reject(error)
      }
    }
    worker.onerror = (event) => {
      rejectPending(new Error(event.message || 'The DAG compiler worker failed.'))
      worker?.terminate()
      worker = undefined
    }
    return worker
  }
  const compile = (input: DagRunCodeCompilerInput, packages: readonly DagResolvedPackage[]) =>
    new Promise<Omit<DagCompiledNodeArtifact, 'cacheId'>>((resolve, reject) => {
      const id = ++requestId
      pending.set(id, { resolve, reject })
      requireWorker().postMessage({ type: 'compile', requestId: id, input, packages })
    })
  const compiler: DagRunCodeArtifactCompiler = {
    compilerAbi: `${DAG_RUN_CODE_COMPILER_VERSION}-esbuild-0.28.1`,
    resolvePackages: async (lock) => await packageResolver.resolve(lock?.packages ?? {}),
    compile,
  }

  return {
    compiler,
    stop: () => {
      rejectPending(new Error('The DAG compiler worker was stopped.'))
      worker?.terminate()
      worker = undefined
    },
  }
}
