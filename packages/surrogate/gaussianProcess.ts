/**
 * Pure-TypeScript Gaussian Process (GP) regression engine.
 *
 * This is the first surrogate-model predictor targeted by the Taskyon
 * Surrogate Model IR (see `taskyon-surrogate-model-ir-design-proposal.md`).
 *
 * Scope of this file (intentionally narrow for v1):
 *
 *   - Single-output GP regression with a zero prior mean.
 *   - Stationary + composite (sum / product) kernels.
 *   - Exact inference via Cholesky of the training covariance matrix
 *     (Rasmussen & Williams, Algorithm 2.1).
 *   - Marginal log-likelihood so a future in-browser optimizer
 *     (e.g. L-BFGS-B) can be plugged in for training.
 *   - Zero external dependencies; runs in any modern browser, Web
 *     Worker, Node, or Tauri webview.
 *
 * Scope deliberately deferred:
 *
 *   - Hyperparameter optimization (we expose the building blocks
 *     `logMarginalLikelihood` on the fitted GP).
 *   - Multi-output GPs.
 *   - Sparse / inducing-point approximations.
 *   - State-space / dynamic GPs.
 *   - Surrogate IR JSON schema + transforms + JS export
 *     (separate files in `packages/surrogate/`).
 *
 * Browser-trainability notes (in line with Taskyon's plan to fit
 * surrogates on Modelica traces in the browser):
 *
 *   - No Node-specific or WASM-specific APIs. All math is plain
 *     TypeScript with `Math` and `Float64Array`.
 *   - All kernel matrices and the Cholesky factor are stored in
 *     `Float64Array` so the fitted state is `Transferable` across
 *     a `postMessage` boundary to a Web Worker.
 *   - The training covariance matrix is regularized with
 *     `observationNoise * I + addedJitter * I`. `observationNoise`
 *     is part of the model; `addedJitter` is purely numerical
 *     stabilization. The two are tracked separately.
 *   - `toTransferableFitted()` produces an `ArrayBuffer[]` transfer
 *     list so Web Worker handoffs do not allocate copies.
 *
 * The implementation deliberately mirrors two well-known references
 * (because they are correct, not because they are the only options):
 *
 *   - scikit-learn `GaussianProcessRegressor.predict`
 *     (Algorithm 2.1 of Rasmussen & Williams).
 *   - tinygp's `Kernel.evaluate(x1, x2)` API for the kernel layer
 *     (and `DirectSolver` for the Cholesky-based solver).
 *
 * Combined with the deployment-only conventions used by
 * `chi-feng/gp-demo` and the parameter handling used by
 * `friedrich`.
 *
 * Review conformance: this file is structured to satisfy the P0
 * correctness items (#1–#7) and the P1 serialization/semantic
 * items (#8–#12) of `gaussian-process-review-todo.md`.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single stationary or composite kernel, represented as a
 * discriminated union so the kernel layer stays declarative.
 *
 * All kernels are *normalized* (k(x, x) = 1) for the non-trivial
 * stationary kinds, with the outer `signalVariance` scaling the
 * whole kernel.
 *
 * `lengthScales` semantics (see `scaleForDimension`):
 *   - `[]`           : every dimension uses `1` (preserved as a
 *                       documented default for ergonomic calls)
 *   - `[ℓ]`          : every dimension uses `ℓ` (scalar/isotropic)
 *   - `[ℓ₁, …, ℓ_d]` : ARD; one scale per input dimension
 *
 * Any other length is rejected at construction time.
 */
export type Kernel =
  | { kind: 'constant'; value: number }
  | { kind: 'white-noise'; noiseLevel: number }
  | {
      kind: 'rbf'
      lengthScales: readonly number[]
    }
  | {
      kind: 'matern'
      nu: 0.5 | 1.5 | 2.5
      lengthScales: readonly number[]
    }
  | {
      kind: 'rational-quadratic'
      alpha: number
      lengthScales: readonly number[]
    }
  | {
      kind: 'sum'
      operands: readonly Kernel[]
    }
  | {
      kind: 'product'
      operands: readonly Kernel[]
    }

/**
 * The JSON-serializable form of a `Kernel`. Used by `serialize` /
 * `deserialize` so the IR survives a `JSON.stringify` / `JSON.parse`
 * round-trip without losing structural information.
 */
export type SerializedKernelV1 =
  | { kind: 'constant'; value: number }
  | { kind: 'white-noise'; noiseLevel: number }
  | { kind: 'rbf'; lengthScales: number[] }
  | { kind: 'matern'; nu: 0.5 | 1.5 | 2.5; lengthScales: number[] }
  | { kind: 'rational-quadratic'; alpha: number; lengthScales: number[] }
  | { kind: 'sum'; operands: SerializedKernelV1[] }
  | { kind: 'product'; operands: SerializedKernelV1[] }

/** Mode for the variance returned by `predict()`. */
export type PredictVariance = 'none' | 'latent' | 'observation'

/** Options controlling `predict()`. */
export interface PredictOptions {
  /** Default: `'latent'`. */
  variance?: PredictVariance
}

/** Result of a GP prediction. */
export interface GpPrediction {
  readonly mean: Float64Array
  readonly variance?: Float64Array
  /** Which variance mode produced the `variance` field. */
  readonly varianceMode?: PredictVariance
}

/** Options controlling the GP engine instance. */
export interface GaussianProcessOptions {
  /**
   * Multiplicative scale applied to the kernel, i.e. the prior
   * variance of the latent process. Must be finite and > 0.
   * Defaults to 1.
   */
  signalVariance?: number
  /**
   * Observation noise variance, added to the diagonal of the
   * training covariance matrix. Independent of any `white-noise`
   * kernel operand. Defaults to `1e-10`. Must be finite and ≥ 0.
   */
  noiseVariance?: number
  /**
   * Upper bound on the additional *numerical* jitter added to the
   * diagonal when the un-jittered Cholesky fails. The Cholesky is
   * retried with growing jitter until it succeeds or this cap is
   * exceeded. Defaults to `1e-3`.
   *
   * This is purely a stabilization mechanism and is *not* the same
   * as `noiseVariance`; it has no effect on the fitted state's
   * mathematical semantics beyond making the matrix SPD.
   */
  maxJitter?: number
  /**
   * Initial additional jitter injected on the first Cholesky
   * attempt. Defaults to a scale-aware value
   * (`1e-12 * max(1, meanKernelDiag)`).
   */
  initialJitter?: number
}

/**
 * Fitted-state snapshot. Returned by `toFitted()` (defensive copies
 * of every array and the kernel), `toTransferableFitted()` (also
 * returns an `ArrayBuffer[]` transfer list), and `takeFittedState()`
 * (destructive: empties the live GP).
 *
 * `noiseVariance` is the observation noise (part of the model).
 * `addedJitter` is the numerical stabilization actually used to
 * factor the matrix; it is recorded so the IR can be reproduced
 * exactly, but it does not change the predicted mean.
 */
export interface GaussianProcessFitted {
  readonly dims: number
  readonly xTrain: Float64Array
  readonly yTrain: Float64Array
  /** Lower-triangular Cholesky factor of `K(X, X) + (noiseVariance + addedJitter) I`. */
  readonly cholesky: Float64Array
  /** `cho_solve(L, y)`, precomputed once at fit time. */
  readonly alpha: Float64Array
  /** Observation noise variance (model semantic). */
  readonly noiseVariance: number
  /** Numerical stabilization actually used at fit time. */
  readonly addedJitter: number
  /** Defensive deep-clone of the kernel. */
  readonly kernel: Kernel
  readonly signalVariance: number
}

/**
 * JSON-safe versioned wire format for a fitted GP. The IR
 * `gaussianProcessSerializedSchemaVersion` is the source of truth for
 * the version. Arrays are stored as regular `number[]` (not
 * `Float64Array`) so they survive `JSON.stringify` / `JSON.parse`.
 */
export interface SerializedGaussianProcessFittedV1 {
  readonly version: 1
  readonly dims: number
  readonly xTrain: number[]
  readonly yTrain: number[]
  readonly cholesky: number[]
  readonly alpha: number[]
  readonly noiseVariance: number
  readonly addedJitter: number
  readonly kernel: SerializedKernelV1
  readonly signalVariance: number
}

/** Current wire-format version of `SerializedGaussianProcessFittedV1`. */
export const gaussianProcessSerializedSchemaVersion = 1 as const

/**
 * Options for `GaussianProcess.fromFitted()` and `deserialize()`.
 * The strict checks are O(n) (length, finiteness, diagonal). The
 * optional `verifyCholesky` check is O(n³) and is meant for debug /
 * CI only.
 */
export interface FromFittedOptions {
  /** If true, also reconstruct K = L Lᵀ and check alpha = K⁻¹ y. */
  verifyCholesky?: boolean
  /**
   * If true, throw on the first structural / numerical problem
   * rather than returning a usable but degraded model. Default true.
   */
  strict?: boolean
}

// ---------------------------------------------------------------------------
// Validation utilities
// ---------------------------------------------------------------------------

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`gaussianProcess: ${msg}`)
}

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`gaussianProcess: ${label} must be a positive integer, got ${value}`)
  }
}

/**
 * Validate a single `lengthScales` array against the expected
 * input dimension. Returns nothing on success, throws otherwise.
 *
 * Accepted forms:
 *   - `[]`           : every dimension uses `1`
 *   - `[ℓ]`          : every dimension uses `ℓ` (scalar/isotropic)
 *   - `[ℓ₁, …, ℓ_d]` : ARD, one scale per input dimension
 *
 * Any other length is rejected.
 */
function validateLengthScales(
  lengthScales: readonly number[],
  expectedDims: number | null,
  label: string,
): void {
  if (lengthScales.length === 0) return
  if (lengthScales.length === 1) {
    const v = lengthScales[0]!
    if (!isPositiveFinite(v)) {
      throw new Error(`gaussianProcess: ${label} length scale must be finite and > 0, got ${v}`)
    }
    return
  }
  if (expectedDims !== null && lengthScales.length !== expectedDims) {
    throw new Error(
      `gaussianProcess: ${label} has ${lengthScales.length} length scales but input has ${expectedDims} dimensions`,
    )
  }
  for (let i = 0; i < lengthScales.length; i++) {
    const v = lengthScales[i]!
    if (!isPositiveFinite(v)) {
      throw new Error(
        `gaussianProcess: ${label} length scale at index ${i} must be finite and > 0, got ${v}`,
      )
    }
  }
}

/**
 * Look up the per-dimension scale. Public kernel-evaluator helpers
 * call this after `validateLengthScales` has confirmed the array is
 * either `[ℓ]` (applied to every dim), `[ℓ₁, …, ℓ_d]` (ARD), or `[]`
 * (defaults to 1 per dim).
 *
 * Throws if the array length is unsupported (defensive — callers
 * must pre-validate).
 */
function scaleForDimension(lengthScales: readonly number[], d: number, dims: number): number {
  if (lengthScales.length === 0) return 1
  if (lengthScales.length === 1) return lengthScales[0]!
  assert(
    lengthScales.length === dims,
    `internal: lengthScales length ${lengthScales.length} != dims ${dims}`,
  )
  return lengthScales[d]!
}

/**
 * Recursive kernel validation. `expectedDims` may be `null` for
 * kernels that do not have length scales; the value gets
 * threaded through composite recursion so ARD-vs-dim mismatches
 * are caught.
 *
 * `seen` is a `Set` of object identities for cycle detection.
 * The maximum composite depth is bounded to `64` so a malformed
 * input cannot blow the stack.
 */
const MAX_KERNEL_DEPTH = 64

function validateKernel(kernel: Kernel, expectedDims: number | null, seen: Set<object>): void {
  if (typeof kernel !== 'object' || kernel === null) {
    throw new Error('gaussianProcess: kernel must be a non-null object')
  }
  if (seen.has(kernel)) {
    throw new Error('gaussianProcess: cyclic composite kernel graph detected')
  }
  if (seen.size > MAX_KERNEL_DEPTH) {
    throw new Error(`gaussianProcess: kernel composite depth exceeds ${MAX_KERNEL_DEPTH}`)
  }
  seen.add(kernel)
  try {
    switch (kernel.kind) {
      case 'constant': {
        if (!isNonNegativeFinite(kernel.value)) {
          throw new Error(
            `gaussianProcess: constant kernel value must be finite and >= 0, got ${kernel.value}`,
          )
        }
        return
      }
      case 'white-noise': {
        if (!isNonNegativeFinite(kernel.noiseLevel)) {
          throw new Error(
            `gaussianProcess: white-noise level must be finite and >= 0, got ${kernel.noiseLevel}`,
          )
        }
        return
      }
      case 'rbf': {
        validateLengthScales(kernel.lengthScales, expectedDims, 'rbf')
        return
      }
      case 'matern': {
        if (kernel.nu !== 0.5 && kernel.nu !== 1.5 && kernel.nu !== 2.5) {
          throw new Error(
            `gaussianProcess: matern nu must be 0.5, 1.5, or 2.5, got ${String(kernel.nu)}`,
          )
        }
        validateLengthScales(kernel.lengthScales, expectedDims, 'matern')
        return
      }
      case 'rational-quadratic': {
        if (!isPositiveFinite(kernel.alpha)) {
          throw new Error(
            `gaussianProcess: rational-quadratic alpha must be finite and > 0, got ${kernel.alpha}`,
          )
        }
        validateLengthScales(kernel.lengthScales, expectedDims, 'rational-quadratic')
        return
      }
      case 'sum':
      case 'product': {
        if (kernel.operands.length === 0) {
          throw new Error(`gaussianProcess: ${kernel.kind} kernel must have at least one operand`)
        }
        for (const op of kernel.operands) validateKernel(op, expectedDims, seen)
        return
      }
    }
  } finally {
    seen.delete(kernel)
  }
}

/**
 * Recursive deep-clone of a validated kernel. The result is a
 * structural copy: mutating any field of the source does not
 * affect the clone, and the clone's `operands` arrays are
 * independent of the source's.
 */
function cloneKernel(kernel: Kernel): Kernel {
  switch (kernel.kind) {
    case 'constant':
      return { kind: 'constant', value: kernel.value }
    case 'white-noise':
      return { kind: 'white-noise', noiseLevel: kernel.noiseLevel }
    case 'rbf':
      return { kind: 'rbf', lengthScales: kernel.lengthScales.slice() }
    case 'matern':
      return {
        kind: 'matern',
        nu: kernel.nu,
        lengthScales: kernel.lengthScales.slice(),
      }
    case 'rational-quadratic':
      return {
        kind: 'rational-quadratic',
        alpha: kernel.alpha,
        lengthScales: kernel.lengthScales.slice(),
      }
    case 'sum':
      return { kind: 'sum', operands: kernel.operands.map(cloneKernel) }
    case 'product':
      return { kind: 'product', operands: kernel.operands.map(cloneKernel) }
  }
}

// ---------------------------------------------------------------------------
// Public kernel matrix API
// ---------------------------------------------------------------------------

/**
 * Build the full auto-covariance matrix `K(X, X)` (n × n, row-major)
 * for the supplied kernel.
 *
 * White-noise is included on the diagonal here, since this is the
 * function used to assemble the training covariance.
 */
export function evaluateKernelMatrix(kernel: Kernel, x: Float64Array, xCols: number): Float64Array {
  assertPositiveInt(xCols, 'xCols')
  assert(x.length % xCols === 0, `x.length (${x.length}) must be divisible by xCols (${xCols})`)
  const n = Math.floor(x.length / xCols)
  const seen: Set<object> = new Set()
  validateKernel(kernel, xCols, seen)
  const out = new Float64Array(n * n)
  fillKernelMatrix(kernel, x, x, xCols, out, /* includeWhiteNoiseDiag */ true)
  return out
}

/**
 * Build the cross-covariance matrix `K(X, Y)` (rows indexed by X,
 * columns by Y).
 *
 * White-noise is *never* added (auto-covariance is excluded). This
 * is the function used at predict time for the `K(X, X*)` cross term.
 */
export function evaluateCrossKernelMatrix(
  kernel: Kernel,
  x: Float64Array,
  y: Float64Array,
  xCols: number,
): Float64Array {
  assertPositiveInt(xCols, 'xCols')
  assert(x.length % xCols === 0, `x.length (${x.length}) must be divisible by xCols (${xCols})`)
  assert(y.length % xCols === 0, `y.length (${y.length}) must be divisible by xCols (${xCols})`)
  const n = Math.floor(x.length / xCols)
  const m = Math.floor(y.length / xCols)
  const seen: Set<object> = new Set()
  validateKernel(kernel, xCols, seen)
  const out = new Float64Array(n * m)
  fillKernelMatrix(kernel, x, y, xCols, out, /* includeWhiteNoiseDiag */ false)
  return out
}

/**
 * Compute the kernel's diagonal value `k(x_i, x_i)` for every row
 * of `x`. For a normalized stationary kernel this is `1`; for
 * `white-noise` it is `noiseLevel`; for `constant` it is `value`.
 */
export function evaluateKernelDiag(kernel: Kernel, x: Float64Array, xCols: number): Float64Array {
  assertPositiveInt(xCols, 'xCols')
  assert(x.length % xCols === 0, `x.length (${x.length}) must be divisible by xCols (${xCols})`)
  const seen: Set<object> = new Set()
  validateKernel(kernel, xCols, seen)
  const n = Math.floor(x.length / xCols)
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = evaluateKernelDiagScalar(kernel, x, i, xCols)
  return out
}

// ---------------------------------------------------------------------------
// Internal kernel evaluation (validated hot path)
// ---------------------------------------------------------------------------

/**
 * Fill `out` (row-major) with `K(xa, xb)`. The white-noise kernel
 * contributes `noiseLevel` to `out[i * m + j]` when `xa === xb` and
 * `i === j` and `includeWhiteNoiseDiag`; otherwise 0.
 *
 * Inputs are assumed to be pre-validated (shapes and kernel).
 */
function fillKernelMatrix(
  kernel: Kernel,
  xa: Float64Array,
  xb: Float64Array,
  cols: number,
  out: Float64Array,
  includeWhiteNoiseDiag: boolean,
): void {
  const n = Math.floor(xa.length / cols)
  const m = Math.floor(xb.length / cols)
  const sameBuffer = xa === xb
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const v = evaluateKernelPair(kernel, xa, i, xb, j, cols, sameBuffer)
      out[i * m + j] = v
    }
  }
  // White-noise: add noiseLevel to the diagonal when computing the
  // training covariance. We rely on the caller (buildTrainKernel)
  // to add observation noise + jitter separately, so this entry is
  // only the kernel's own white-noise contribution.
  if (includeWhiteNoiseDiag && sameBuffer) {
    const white = collectWhiteNoiseLevel(kernel)
    if (white > 0) {
      for (let i = 0; i < n; i++) {
        const cur = out[i * n + i] as number
        out[i * n + i] = cur + white
      }
    }
  }
}

function collectWhiteNoiseLevel(kernel: Kernel): number {
  switch (kernel.kind) {
    case 'white-noise':
      return kernel.noiseLevel
    case 'sum':
    case 'product': {
      // For a product, white noise contributions from a sum
      // operand are NOT added unless the *other* operand is 1 on the
      // diagonal. For a stationary (k(x,x) = 1) operand this is
      // true. We approximate the common case (sum of stationary
      // kernels + optional white noise) by summing white noise
      // levels for sums and skipping them for products.
      if (kernel.kind === 'sum') {
        let s = 0
        for (const op of kernel.operands) s += collectWhiteNoiseLevel(op)
        return s
      }
      return 0
    }
    default:
      return 0
  }
}

/**
 * Evaluate `kernel(xa[i], xb[j])` for two *valid* rows. Assumes
 * the kernel has been validated. Returns the value with `white-noise`
 * and `sum/product` composition honored.
 */
function evaluateKernelPair(
  kernel: Kernel,
  xa: Float64Array,
  i: number,
  xb: Float64Array,
  j: number,
  cols: number,
  sameBuffer: boolean,
): number {
  switch (kernel.kind) {
    case 'constant':
      return kernel.value
    case 'white-noise':
      // White noise is 0 except on the training diagonal. The
      // diagonal contribution is added by the caller, so this
      // function always returns 0 here.
      return 0
    case 'rbf':
      return EXP(-0.5 * ardSquaredDistance(xa, i, xb, j, cols, kernel.lengthScales))
    case 'matern': {
      const r2 = ardSquaredDistance(xa, i, xb, j, cols, kernel.lengthScales)
      if (r2 === 0) return 1
      const r = SQRT(r2)
      if (kernel.nu === 0.5) return EXP(-r)
      if (kernel.nu === 1.5) {
        const t = SQRT3 * r
        return (1 + t) * EXP(-t)
      }
      // nu === 2.5
      const t5 = SQRT5 * r
      return (1 + t5 + (t5 * t5) / 3) * EXP(-t5)
    }
    case 'rational-quadratic': {
      const r2 = ardSquaredDistance(xa, i, xb, j, cols, kernel.lengthScales)
      return Math.pow(1 + r2 / (2 * kernel.alpha), -kernel.alpha)
    }
    case 'sum': {
      let s = 0
      for (const op of kernel.operands) {
        s += evaluateKernelPair(op, xa, i, xb, j, cols, sameBuffer)
      }
      return s
    }
    case 'product': {
      let p = 1
      for (const op of kernel.operands) {
        p *= evaluateKernelPair(op, xa, i, xb, j, cols, sameBuffer)
      }
      return p
    }
  }
}

function evaluateKernelDiagScalar(
  kernel: Kernel,
  x: Float64Array,
  i: number,
  cols: number,
): number {
  switch (kernel.kind) {
    case 'constant':
      return kernel.value
    case 'white-noise':
      return kernel.noiseLevel
    case 'rbf':
    case 'matern':
      return 1
    case 'rational-quadratic':
      return 1
    case 'sum': {
      let s = 0
      for (const op of kernel.operands) s += evaluateKernelDiagScalar(op, x, i, cols)
      return s
    }
    case 'product': {
      let p = 1
      for (const op of kernel.operands) p *= evaluateKernelDiagScalar(op, x, i, cols)
      return p
    }
  }
}

const SQRT = Math.sqrt
const EXP = Math.exp
const SQRT3 = Math.sqrt(3)
const SQRT5 = Math.sqrt(5)

function ardSquaredDistance(
  xa: Float64Array,
  i: number,
  xb: Float64Array,
  j: number,
  cols: number,
  lengthScales: readonly number[],
): number {
  let s = 0
  const baseI = i * cols
  const baseJ = j * cols
  for (let d = 0; d < cols; d++) {
    const scale = scaleForDimension(lengthScales, d, cols)
    const diff = (xa[baseI + d] ?? 0) - (xb[baseJ + d] ?? 0)
    const r = diff / scale
    s += r * r
  }
  return s
}

// ---------------------------------------------------------------------------
// Public linear algebra
// ---------------------------------------------------------------------------

/**
 * In-place Cholesky factorization. Returns `true` on success and
 * overwrites `A` with its lower-triangular factor `L`. Returns
 * `false` if the matrix is not positive-definite, including the
 * case of any `NaN` / `Infinity` entry.
 */
export function choleskyInPlace(A: Float64Array, n: number): boolean {
  if (!Number.isInteger(n) || n <= 0) return false
  if (A.length < n * n) return false
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      const aij = A[i * n + j] as number
      if (!Number.isFinite(aij)) return false
      let sum = aij
      for (let k = 0; k < j; k++) {
        const aik = A[i * n + k] as number
        const ajk = A[j * n + k] as number
        if (!Number.isFinite(aik) || !Number.isFinite(ajk)) return false
        sum -= aik * ajk
      }
      if (i === j) {
        if (!Number.isFinite(sum) || sum <= 0) return false
        A[i * n + i] = SQRT(sum)
      } else {
        const diag = A[j * n + j] as number
        if (!Number.isFinite(diag) || diag <= 0) return false
        A[i * n + j] = sum / diag
      }
    }
    for (let j = i + 1; j < n; j++) A[i * n + j] = 0
  }
  return true
}

/**
 * Solve `K x = b` via the lower Cholesky factor `L` (with
 * `K = L Lᵀ`). Returns a new `Float64Array`. Throws if `L` or
 * `b` contain non-finite values, or if any diagonal is non-positive.
 */
export function choSolve(L: Float64Array, y: Float64Array, n: number): Float64Array {
  assertPositiveInt(n, 'n')
  assert(L.length >= n * n, `L.length (${L.length}) must be >= n * n (${n * n})`)
  assert(y.length === n, `y.length (${y.length}) must equal n (${n})`)
  for (let i = 0; i < n; i++) {
    const li = L[i * n + i] as number
    assert(
      Number.isFinite(li) && li > 0,
      `cholesky diagonal at (${i},${i}) must be finite and > 0, got ${li}`,
    )
  }
  const out = new Float64Array(y)
  lowerSolveInPlace(L, out, n)
  lowerTransposeSolveInPlace(L, out, n)
  return out
}

function lowerSolveInPlace(L: Float64Array, b: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    let s = b[i] as number
    for (let k = 0; k < i; k++) s -= (L[i * n + k] as number) * (b[k] as number)
    b[i] = s / (L[i * n + i] as number)
  }
}

function lowerTransposeSolveInPlace(L: Float64Array, b: Float64Array, n: number): void {
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i] as number
    for (let k = i + 1; k < n; k++) s -= (L[k * n + i] as number) * (b[k] as number)
    b[i] = s / (L[i * n + i] as number)
  }
}

// ---------------------------------------------------------------------------
// Serialization codec
// ---------------------------------------------------------------------------

function serializeKernel(kernel: Kernel): SerializedKernelV1 {
  switch (kernel.kind) {
    case 'constant':
      return { kind: 'constant', value: kernel.value }
    case 'white-noise':
      return { kind: 'white-noise', noiseLevel: kernel.noiseLevel }
    case 'rbf':
      return { kind: 'rbf', lengthScales: kernel.lengthScales.slice() }
    case 'matern':
      return {
        kind: 'matern',
        nu: kernel.nu,
        lengthScales: kernel.lengthScales.slice(),
      }
    case 'rational-quadratic':
      return {
        kind: 'rational-quadratic',
        alpha: kernel.alpha,
        lengthScales: kernel.lengthScales.slice(),
      }
    case 'sum':
      return { kind: 'sum', operands: kernel.operands.map(serializeKernel) }
    case 'product':
      return { kind: 'product', operands: kernel.operands.map(serializeKernel) }
  }
}

function deserializeKernel(serialized: SerializedKernelV1): Kernel {
  switch (serialized.kind) {
    case 'constant':
      return { kind: 'constant', value: serialized.value }
    case 'white-noise':
      return { kind: 'white-noise', noiseLevel: serialized.noiseLevel }
    case 'rbf':
      return { kind: 'rbf', lengthScales: serialized.lengthScales.slice() }
    case 'matern':
      return {
        kind: 'matern',
        nu: serialized.nu,
        lengthScales: serialized.lengthScales.slice(),
      }
    case 'rational-quadratic':
      return {
        kind: 'rational-quadratic',
        alpha: serialized.alpha,
        lengthScales: serialized.lengthScales.slice(),
      }
    case 'sum':
      return { kind: 'sum', operands: serialized.operands.map(deserializeKernel) }
    case 'product':
      return { kind: 'product', operands: serialized.operands.map(deserializeKernel) }
  }
}

// ---------------------------------------------------------------------------
// Public API: the GaussianProcess class
// ---------------------------------------------------------------------------

/**
 * A Gaussian Process regression engine.
 *
 * Lifecycle:
 *
 *   1. Construct with a `Kernel` (and optional signal/noise config).
 *      The kernel is recursively validated and deep-cloned.
 *   2. `fit(X, y)` to learn the posterior (Cholesky + alpha).
 *   3. `predict(X)` to query the posterior.
 *   4. Snapshot via `toFitted()` (defensive), `toTransferableFitted()`
 *      (zero-copy across a `postMessage` boundary), or
 *      `takeFittedState()` (destructive, leaves the GP empty).
 *
 * The engine is single-output (one target per input row). It is
 * fully self-contained: no module-level state, no async, no
 * workers. Designed to be drop-in usable inside a Web Worker; the
 * fitted `Float64Array`s are `Transferable` across `postMessage`.
 */
export class GaussianProcess {
  #kernel: Kernel
  #signalVariance: number
  #noiseVariance: number
  #maxJitter: number
  #initialJitter: number

  #dims = 0
  #xTrain: Float64Array | null = null
  #yTrain: Float64Array | null = null
  #cholesky: Float64Array | null = null
  #alpha: Float64Array | null = null
  #addedJitter = 0
  #fitted = false
  #detached = false

  constructor(kernel: Kernel, opts: GaussianProcessOptions = {}) {
    // Recursive validation first. We don't yet know the input
    // dimension, so lengthScales are checked for shape only (not
    // against an expected dim); the second pass during `fit()`
    // cross-checks ARD length against the actual `xCols`.
    const seen: Set<object> = new Set()
    validateKernel(kernel, null, seen)
    this.#kernel = cloneKernel(kernel)
    this.#signalVariance = opts.signalVariance ?? 1
    this.#noiseVariance = opts.noiseVariance ?? 1e-10
    this.#maxJitter = opts.maxJitter ?? 1e-3
    this.#initialJitter = opts.initialJitter ?? 0
    assert(
      isPositiveFinite(this.#signalVariance),
      `signalVariance must be finite and > 0, got ${this.#signalVariance}`,
    )
    assert(
      isNonNegativeFinite(this.#noiseVariance),
      `noiseVariance must be finite and >= 0, got ${this.#noiseVariance}`,
    )
    assert(
      isPositiveFinite(this.#maxJitter),
      `maxJitter must be finite and > 0, got ${this.#maxJitter}`,
    )
    assert(
      isNonNegativeFinite(this.#initialJitter),
      `initialJitter must be finite and >= 0, got ${this.#initialJitter}`,
    )
  }

  /** Read-only access to a deep-cloned copy of the kernel. */
  get kernel(): Kernel {
    return cloneKernel(this.#kernel)
  }

  /** `true` after a successful `fit()` and not yet `takeFittedState()`-d. */
  get isFitted(): boolean {
    return this.#fitted
  }

  /**
   * Fit the GP to `(X, y)`. `X` is a row-major `n × d` matrix
   * stored in a `Float64Array`; `y` is a length-`n` `Float64Array`.
   *
   * On return, the Cholesky factor of `K(X, X) + (σ²_n + jitter) I`
   * and `alpha = K⁻¹ y` are stored internally. The fitted jitter is
   * the smallest jitter that made the Cholesky succeed; it is
   * tracked separately from the observation noise.
   *
   * Throws on Cholesky failure past `maxJitter`, on a kernel/ARDS
   * mismatch, or on `takeFittedState()` having moved the state out.
   */
  fit(x: Float64Array, y: Float64Array, xCols: number): this {
    assert(!this.#detached, 'fit: GP state has been taken; this instance is empty')
    assertPositiveInt(xCols, 'xCols')
    assert(x.length % xCols === 0, `x.length (${x.length}) must be divisible by xCols (${xCols})`)
    const n = Math.floor(x.length / xCols)
    assert(n > 0, 'fit: need at least one training row')
    assert(y.length === n, `y.length (${y.length}) must equal n (${n})`)

    // Re-validate the kernel against the actual input dimension so
    // ARD-length mismatches are caught here rather than later.
    const seen: Set<object> = new Set()
    validateKernel(this.#kernel, xCols, seen)

    // Build the noise-free training covariance once and reuse it
    // across jitter retries (P2 #18). The K matrix here is the
    // *full* training covariance, i.e. `signalVariance * k(X, X)`
    // (plus any white-noise kernel contribution already folded in
    // by `evaluateKernelMatrix`). The predict path uses the same
    // scaling so the Cholesky factor and the cross-covariance
    // solve are consistent.
    const K = evaluateKernelMatrix(this.#kernel, x, xCols)
    for (let i = 0; i < n * n; i++) K[i] = (K[i] as number) * this.#signalVariance

    // Decide the initial addedJitter. The default is a scale-aware
    // value (1e-12 * mean diagonal) so the Cholesky starts in a
    // stable regime even for normalized kernels.
    let addedJitter = this.#initialJitter
    if (addedJitter === 0) {
      let diagSum = 0
      for (let i = 0; i < n; i++) diagSum += K[i * n + i] as number
      const meanDiag = n > 0 ? diagSum / n : 1
      addedJitter = 1e-12 * Math.max(1, meanDiag)
    }

    // Working buffer for the factor. Rebuilt per attempt; we copy
    // K (which is small relative to total work) to keep the loop
    // body straightforward and avoid the O(n^2) zero-cost
    // optimizations that hurt readability.
    const L = new Float64Array(n * n)
    let ok = false
    let attempts = 0
    while (addedJitter <= this.#maxJitter) {
      attempts++
      L.set(K)
      for (let i = 0; i < n; i++)
        L[i * n + i] = (L[i * n + i] as number) + this.#noiseVariance + addedJitter
      if (choleskyInPlace(L, n)) {
        ok = true
        break
      }
      // 0 -> initial; else 10x. This is robust to the case where
      // noiseVariance is already > maxJitter (P0 #1 bug #2): we
      // still escalate *addedJitter* from 0, not from noiseVariance.
      addedJitter =
        addedJitter === 0
          ? this.#initialJitter || 1e-12
          : Math.min(addedJitter * 10, this.#maxJitter)
    }
    if (!ok) {
      throw new Error(
        `gaussianProcess.fit: Cholesky failed after ${attempts} attempt(s) at maxJitter=${this.#maxJitter}; ` +
          `check the kernel, the conditioning of X, or increase maxJitter`,
      )
    }

    const alpha = new Float64Array(y)
    lowerSolveInPlace(L, alpha, n)
    lowerTransposeSolveInPlace(L, alpha, n)
    for (let i = 0; i < n; i++) {
      const a = alpha[i] as number
      assert(Number.isFinite(a), `alpha[${i}] is non-finite: ${a}`)
    }

    this.#dims = xCols
    this.#xTrain = new Float64Array(x) // snapshot
    this.#yTrain = new Float64Array(y)
    this.#cholesky = L
    this.#alpha = alpha
    this.#addedJitter = addedJitter
    this.#fitted = true
    return this
  }

  /**
   * Predict at new inputs. Returns `{ mean, variance? }`.
   *
   * `variance` mode:
   *   - `'none'`        : only the mean
   *   - `'latent'`      : GPML Algorithm 2.1 variance of `f*`
   *                       (default)
   *   - `'observation'` : latent variance + observation noise; this
   *                       is the variance of `y*` for a new
   *                       observation
   *
   * Numerical contract (Algorithm 2.1, in-place triangular solves
   * with a reused scratch buffer; P2 #19):
   *
   *   - Predicted mean is `K(X*, X) α` (zero prior).
   *   - Predicted variance is `clamp(k(x*, x*) - ‖L⁻¹ k(X, x*)‖², 0)`
   *     in 'latent' mode, plus `noiseVariance` in 'observation' mode.
   *   - Negative variances beyond a scale-aware round-off tolerance
   *     are reported as an error (P1 #12).
   */
  predict(xTest: Float64Array, xCols: number, opts: PredictOptions = {}): GpPrediction {
    assert(!this.#detached, 'predict: GP state has been taken; this instance is empty')
    assert(this.#fitted, 'predict: call fit() first')
    assert(
      this.#xTrain && this.#yTrain && this.#cholesky && this.#alpha,
      'predict: internal state missing',
    )
    assertPositiveInt(xCols, 'xCols')
    assert(
      xCols === this.#dims,
      `predict: xCols (${xCols}) must match training dims (${this.#dims})`,
    )
    assert(
      xTest.length % xCols === 0,
      `xTest.length (${xTest.length}) must be divisible by xCols (${xCols})`,
    )

    const varianceMode: PredictVariance = opts.variance ?? 'latent'
    assert(
      varianceMode === 'none' || varianceMode === 'latent' || varianceMode === 'observation',
      `predict: variance must be 'none' | 'latent' | 'observation', got ${String(opts.variance)}`,
    )

    const xTrain = this.#xTrain
    const L = this.#cholesky
    const alpha = this.#alpha
    const n = this.#yTrain.length
    const m = Math.floor(xTest.length / xCols)
    const wantVariance = varianceMode !== 'none'

    // Reusable per-test-row scratch. For the mean-only path the
    // `kStar` buffer is reused across rows; for the variance path
    // we also do the triangular solve in place (P2 #19) so the
    // only allocation here is the output arrays.
    const kStar = new Float64Array(n)

    const mean = new Float64Array(m)
    const variance = wantVariance ? new Float64Array(m) : undefined

    for (let i = 0; i < m; i++) {
      // 1. k(X, x*) — cross-covariance, no white-noise added.
      //    We write directly into the reusable kStar scratch.
      for (let j = 0; j < n; j++) {
        kStar[j] = this.#signalVariance * kernelCrossEntry(this.#kernel, xTrain, j, xTest, i, xCols)
      }
      // 2. mean = kStar · alpha
      let s = 0
      for (let j = 0; j < n; j++) s += (kStar[j] as number) * (alpha[j] as number)
      mean[i] = s

      if (variance) {
        // 3. v = L⁻¹ kStar in place. kStar is scratch and will be
        //    overwritten on the next test row, so we can mutate it.
        lowerSolveInPlace(L, kStar, n)
        // 4. ‖v‖²
        let vnorm2 = 0
        for (let j = 0; j < n; j++) {
          const vj = kStar[j] as number
          vnorm2 += vj * vj
        }
        // 5. base variance = k(x*, x*) * signalVariance
        const baseVar =
          this.#signalVariance * evaluateKernelDiagScalar(this.#kernel, xTest, i, xCols)
        // 6. latent variance = baseVar - vnorm2, then observation
        //    = + noiseVariance. Tolerance: 64 * eps * max(1, base,
        //    vnorm) is the standard round-off budget for one
        //    subtraction of two positive numbers (P1 #12).
        const raw = baseVar - vnorm2
        const tolerance = 64 * Number.EPSILON * Math.max(1, Math.abs(baseVar), Math.abs(vnorm2))
        if (raw < -tolerance) {
          throw new Error(
            `gaussianProcess.predict: predicted latent variance at row ${i} is ${raw}, ` +
              `which is more negative than the round-off tolerance ${tolerance}; ` +
              `this usually indicates corrupt fitted state or a kernel inconsistent with the data`,
          )
        }
        const latent = raw < 0 ? 0 : raw
        const observation = latent + this.#noiseVariance
        variance[i] = varianceMode === 'observation' ? observation : latent
      }
    }
    if (variance) {
      return { mean, variance, varianceMode }
    }
    return { mean, varianceMode: 'none' }
  }

  /**
   * Marginal log-likelihood of the training data under the current
   * kernel / hyperparameters. Throws if the GP has not been fit.
   *
   *   log p(y|X) = -½ yᵀ α - Σ log diag(L) - (n/2) log(2π)
   */
  logMarginalLikelihood(): number {
    assert(
      !this.#detached,
      'logMarginalLikelihood: GP state has been taken; this instance is empty',
    )
    if (!this.#fitted || !this.#cholesky || !this.#alpha || !this.#yTrain) {
      throw new Error(
        'gaussianProcess.logMarginalLikelihood: GP must be fit() before calling this method',
      )
    }
    const n = this.#yTrain.length
    const L = this.#cholesky
    const alpha = this.#alpha
    const y = this.#yTrain

    let quad = 0
    let logDet = 0
    for (let i = 0; i < n; i++) {
      quad += (y[i] as number) * (alpha[i] as number)
      logDet += Math.log(L[i * n + i] as number)
    }
    return -0.5 * quad - logDet - (n / 2) * Math.log(2 * Math.PI)
  }

  /**
   * Snapshot the fitted state with *defensive copies* of every
   * array and the kernel. Mutating the returned snapshot never
   * affects the live GP.
   */
  toFitted(): GaussianProcessFitted {
    this.#assertLiveAndFitted('toFitted')
    return {
      dims: this.#dims,
      xTrain: new Float64Array(this.#xTrain!),
      yTrain: new Float64Array(this.#yTrain!),
      cholesky: new Float64Array(this.#cholesky!),
      alpha: new Float64Array(this.#alpha!),
      noiseVariance: this.#noiseVariance,
      addedJitter: this.#addedJitter,
      kernel: cloneKernel(this.#kernel),
      signalVariance: this.#signalVariance,
    }
  }

  /**
   * Snapshot the fitted state and return a `postMessage` transfer
   * list. After this call, the `fitted` object's `Float64Array`
   * buffers are owned by the caller; passing them through a
   * `postMessage(... , transfer)` will move them in O(1). The live
   * GP is not affected (we copy first, then return the transfer
   * list of those copies).
   */
  toTransferableFitted(): { fitted: GaussianProcessFitted; transfer: ArrayBuffer[] } {
    const fitted = this.toFitted()
    return {
      fitted,
      transfer: [
        fitted.xTrain.buffer as ArrayBuffer,
        fitted.yTrain.buffer as ArrayBuffer,
        fitted.cholesky.buffer as ArrayBuffer,
        fitted.alpha.buffer as ArrayBuffer,
      ],
    }
  }

  /**
   * Destructive: move the fitted state out of this GP and into a
   * fresh snapshot. After this call the GP is empty (`isFitted` is
   * `false`) and any further `predict` / `logMarginalLikelihood` /
   * `fit` (without re-fitting) will throw clearly.
   *
   * The returned `Float64Array` buffers are the *internal* ones,
   * transferred in O(1) to the caller.
   */
  takeFittedState(): GaussianProcessFitted {
    this.#assertLiveAndFitted('takeFittedState')
    const fitted: GaussianProcessFitted = {
      dims: this.#dims,
      xTrain: this.#xTrain!,
      yTrain: this.#yTrain!,
      cholesky: this.#cholesky!,
      alpha: this.#alpha!,
      noiseVariance: this.#noiseVariance,
      addedJitter: this.#addedJitter,
      kernel: this.#kernel,
      signalVariance: this.#signalVariance,
    }
    this.#xTrain = null
    this.#yTrain = null
    this.#cholesky = null
    this.#alpha = null
    this.#addedJitter = 0
    this.#dims = 0
    this.#fitted = false
    this.#detached = true
    return fitted
  }

  /**
   * Encode the fitted state as a JSON-safe object. Use
   * `GaussianProcess.deserialize()` to reconstruct.
   */
  serialize(): SerializedGaussianProcessFittedV1 {
    this.#assertLiveAndFitted('serialize')
    return {
      version: gaussianProcessSerializedSchemaVersion,
      dims: this.#dims,
      xTrain: Array.from(this.#xTrain!),
      yTrain: Array.from(this.#yTrain!),
      cholesky: Array.from(this.#cholesky!),
      alpha: Array.from(this.#alpha!),
      noiseVariance: this.#noiseVariance,
      addedJitter: this.#addedJitter,
      kernel: serializeKernel(this.#kernel),
      signalVariance: this.#signalVariance,
    }
  }

  /**
   * Reconstruct a fitted GP from a snapshot produced by `toFitted()`,
   * `toTransferableFitted()`, or `takeFittedState()`. Validates the
   * snapshot structurally (P0 #7) before trusting it.
   *
   * `verifyCholesky: true` additionally reconstructs `K = L Lᵀ` and
   * checks `alpha = K⁻¹ y` against `y`. This is O(n³) and intended
   * for debug / CI.
   */
  static fromFitted(fitted: GaussianProcessFitted, opts: FromFittedOptions = {}): GaussianProcess {
    const strict = opts.strict ?? true
    const errors: string[] = []
    const collect = (msg: string) => {
      if (strict) throw new Error(`gaussianProcess.fromFitted: ${msg}`)
      else errors.push(msg)
    }

    // dims
    if (!Number.isInteger(fitted.dims) || fitted.dims <= 0) {
      collect(`dims must be a positive integer, got ${fitted.dims}`)
    }
    // array finiteness
    const checkArray = (arr: Float64Array | null, name: string, length: number) => {
      if (!(arr instanceof Float64Array)) {
        collect(`${name} must be a Float64Array`)
        return
      }
      if (arr.length !== length) {
        collect(`${name}.length (${arr.length}) must equal ${length}`)
        return
      }
      for (let i = 0; i < arr.length; i++) {
        if (!Number.isFinite(arr[i] as number)) {
          collect(`${name}[${i}] is non-finite: ${arr[i]}`)
          return
        }
      }
    }
    const n = fitted.yTrain.length
    if (!Number.isInteger(n) || n <= 0) {
      collect(`yTrain.length (${n}) must be a positive integer`)
    }
    if (errors.length === 0) {
      checkArray(fitted.xTrain, 'xTrain', n * fitted.dims)
      checkArray(fitted.yTrain, 'yTrain', n)
      checkArray(fitted.cholesky, 'cholesky', n * n)
      checkArray(fitted.alpha, 'alpha', n)
      // diagonal of cholesky must be > 0
      for (let i = 0; i < n; i++) {
        const d = fitted.cholesky[i * n + i] as number
        if (!(Number.isFinite(d) && d > 0)) {
          collect(`cholesky[${i},${i}] must be finite and > 0, got ${d}`)
        }
      }
    }
    // noise / jitter / signal variance
    if (!isNonNegativeFinite(fitted.noiseVariance)) {
      collect(`noiseVariance must be finite and >= 0, got ${fitted.noiseVariance}`)
    }
    if (!isNonNegativeFinite(fitted.addedJitter)) {
      collect(`addedJitter must be finite and >= 0, got ${fitted.addedJitter}`)
    }
    if (!isPositiveFinite(fitted.signalVariance)) {
      collect(`signalVariance must be finite and > 0, got ${fitted.signalVariance}`)
    }
    // kernel
    const seen: Set<object> = new Set()
    try {
      validateKernel(fitted.kernel, fitted.dims, seen)
    } catch (e) {
      collect((e as Error).message)
    }
    if (!strict && errors.length > 0) {
      throw new Error(`gaussianProcess.fromFitted (lenient): ${errors.join('; ')}`)
    }
    if (strict && errors.length > 0) {
      // already threw above
    }

    // optional O(n^3) verification
    if (opts.verifyCholesky) {
      const n2 = fitted.yTrain.length
      // L Lᵀ ≈ K (where K is built from xTrain / kernel)
      const K = new Float64Array(n2 * n2)
      fillKernelMatrix(fitted.kernel, fitted.xTrain, fitted.xTrain, fitted.dims, K, true)
      for (let i = 0; i < n2; i++)
        K[i * n2 + i] = (K[i * n2 + i] as number) + fitted.noiseVariance + fitted.addedJitter
      for (let i = 0; i < n2; i++) {
        for (let j = 0; j < n2; j++) {
          let s = 0
          for (let k = 0; k < n2; k++)
            s += (fitted.cholesky[i * n2 + k] as number) * (fitted.cholesky[j * n2 + k] as number)
          if (Math.abs(s - (K[i * n2 + j] as number)) > 1e-6) {
            throw new Error(
              `gaussianProcess.fromFitted (verifyCholesky): L Lᵀ mismatch at (${i},${j}): ` +
                `expected ${K[i * n2 + j]}, got ${s}`,
            )
          }
        }
      }
      // K alpha should equal y
      for (let i = 0; i < n2; i++) {
        let s = 0
        for (let j = 0; j < n2; j++) s += (K[i * n2 + j] as number) * (fitted.alpha[j] as number)
        if (Math.abs(s - (fitted.yTrain[i] as number)) > 1e-6) {
          throw new Error(
            `gaussianProcess.fromFitted (verifyCholesky): K alpha mismatch at row ${i}: ` +
              `expected ${fitted.yTrain[i]}, got ${s}`,
          )
        }
      }
    }

    const gp = new GaussianProcess(fitted.kernel, {
      signalVariance: fitted.signalVariance,
      noiseVariance: fitted.noiseVariance,
    })
    gp.#dims = fitted.dims
    gp.#xTrain = new Float64Array(fitted.xTrain)
    gp.#yTrain = new Float64Array(fitted.yTrain)
    gp.#cholesky = new Float64Array(fitted.cholesky)
    gp.#alpha = new Float64Array(fitted.alpha)
    gp.#addedJitter = fitted.addedJitter
    gp.#fitted = true
    return gp
  }

  /**
   * Reconstruct a fitted GP from a `SerializedGaussianProcessFittedV1`
   * (typically produced by `serialize()` and `JSON.parse`d).
   * Throws on unknown schema version.
   */
  static deserialize(serialized: SerializedGaussianProcessFittedV1): GaussianProcess {
    if (serialized.version !== gaussianProcessSerializedSchemaVersion) {
      throw new Error(
        `gaussianProcess.deserialize: unknown schema version ${String(serialized.version)}, ` +
          `expected ${String(gaussianProcessSerializedSchemaVersion)}`,
      )
    }
    // Reuse fromFitted by converting the regular arrays into
    // Float64Arrays. The arrays are already validated as regular
    // `number[]` by the TS type; we run the same strict checks.
    return GaussianProcess.fromFitted({
      dims: serialized.dims,
      xTrain: Float64Array.from(serialized.xTrain),
      yTrain: Float64Array.from(serialized.yTrain),
      cholesky: Float64Array.from(serialized.cholesky),
      alpha: Float64Array.from(serialized.alpha),
      noiseVariance: serialized.noiseVariance,
      addedJitter: serialized.addedJitter,
      kernel: deserializeKernel(serialized.kernel),
      signalVariance: serialized.signalVariance,
    })
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  #assertLiveAndFitted(method: string): void {
    assert(!this.#detached, `${method}: GP state has been taken; this instance is empty`)
    if (!this.#fitted || !this.#xTrain || !this.#yTrain || !this.#cholesky || !this.#alpha) {
      throw new Error(`gaussianProcess.${method}: GP must be fit() first`)
    }
  }
}

/**
 * Cross-covariance entry `kernel(xa[i], xb[j])` for a validated
 * kernel. Returns 0 for white noise; sum/product composition is
 * honored. Used only at predict time.
 */
function kernelCrossEntry(
  kernel: Kernel,
  xa: Float64Array,
  i: number,
  xb: Float64Array,
  j: number,
  cols: number,
): number {
  // Cross-covariance: same code as the auto-cov case (with
  // `sameBuffer = xa === xb`), since the white-noise diagonal
  // handling is done by the caller.
  return evaluateKernelPair(kernel, xa, i, xb, j, cols, xa === xb)
}
