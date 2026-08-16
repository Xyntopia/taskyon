import { build } from 'esbuild'
import {
  createBundledDagNodeArtifactCompiler,
  DAG_RUN_CODE_COMPILER_VERSION,
  type DagPackageArtifactResolver,
} from './dagModuleCompiler.ts'
import { createEsbuildDagModuleBundler } from './dagModuleEsbuild.ts'

export const createNodeDagRunCodeArtifactCompiler = (packages: DagPackageArtifactResolver) =>
  createBundledDagNodeArtifactCompiler({
    compilerAbi: `${DAG_RUN_CODE_COMPILER_VERSION}-esbuild-0.28.1`,
    bundle: createEsbuildDagModuleBundler({ build }),
    packages,
  })
