/**
 * Public entry point for the Taskyon Surrogate Model helpers.
 *
 * The first released piece is the pure-TypeScript Gaussian Process
 * regression engine in `./gaussianProcess.ts`. The IR schema,
 * preprocessing/postprocessing transforms, and the dependency-free
 * JavaScript exporter (see `taskyon-surrogate-model-ir-design-proposal.md`)
 * are intentionally not yet implemented; they will land in
 * subsequent PRs.
 */
export {
  GaussianProcess,
  choSolve,
  choleskyInPlace,
  evaluateCrossKernelMatrix,
  evaluateKernelDiag,
  evaluateKernelMatrix,
  gaussianProcessSerializedSchemaVersion,
  type FromFittedOptions,
  type GaussianProcessFitted,
  type GaussianProcessOptions,
  type GpPrediction,
  type Kernel,
  type PredictOptions,
  type PredictVariance,
  type SerializedGaussianProcessFittedV1,
  type SerializedKernelV1,
} from './gaussianProcess'
