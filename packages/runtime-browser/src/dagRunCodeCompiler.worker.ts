import {
  createBundledDagNodeArtifactCompiler,
  DAG_RUN_CODE_COMPILER_VERSION,
} from '@taskyon/comp-dag/dagModuleCompiler'
import { createEsbuildDagModuleBundler } from '@taskyon/comp-dag/dagModuleEsbuild'
import {
  createDagPackageArtifactResolver,
  parseDagRuntimePackageManifest,
} from '@taskyon/comp-dag/dagPackageArtifact'
import type {
  DagResolvedPackage,
  DagRunCodeCompilerInput,
} from '@taskyon/comp-dag/designRepositorySnapshot'
import { build, initialize } from 'esbuild-wasm'
import wasmUrl from 'esbuild-wasm/esbuild.wasm?url'

type CompileRequest = {
  type: 'compile'
  requestId: number
  input: DagRunCodeCompilerInput
  packages: readonly DagResolvedPackage[]
}

const fetchText = async (path: string) => {
  const response = await fetch(path)
  if (!response.ok) {
    throw new Error(`Could not load DAG runtime artifact ${path}: HTTP ${response.status}.`)
  }
  return await response.text()
}

const fetchJson = async (path: string): Promise<unknown> => JSON.parse(await fetchText(path))

const runtimePackages = createDagPackageArtifactResolver({
  manifest: async () =>
    parseDagRuntimePackageManifest(await fetchJson('/dag-runtime-packages/manifest.json')),
  loadSource: fetchText,
})

let initialized: Promise<void> | undefined
const initializeBundler = () =>
  (initialized ??= initialize({ wasmURL: wasmUrl, worker: false }).then(() => undefined))

const bundleWithEsbuild = createEsbuildDagModuleBundler({ build })
const bundle = async (request: Parameters<typeof bundleWithEsbuild>[0]) => {
  await initializeBundler()
  return await bundleWithEsbuild(request)
}

const compiler = createBundledDagNodeArtifactCompiler({
  compilerAbi: `${DAG_RUN_CODE_COMPILER_VERSION}-esbuild-0.28.1`,
  bundle,
  packages: runtimePackages,
})

self.onmessage = (event: MessageEvent<CompileRequest>) => {
  if (event.data.type !== 'compile') return
  void compiler
    .compile(event.data.input, event.data.packages)
    .then((artifact) =>
      self.postMessage({ type: 'compiled', requestId: event.data.requestId, artifact }),
    )
    .catch((error: unknown) =>
      self.postMessage({
        type: 'compile-error',
        requestId: event.data.requestId,
        message: error instanceof Error ? error.message : String(error),
        ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
      }),
    )
}
