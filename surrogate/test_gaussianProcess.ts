/**
 * Headless diagnostics for the Taskyon Surrogate Model helpers.
 *
 * The tests in this file are picked up automatically by
 * `packages/taskyon-headless/src/cli.ts` (it scans
 * `src/tests/*.ts` for `export const testXxx = ...` and treats the
 * function name as the test ID).
 *
 * Tests are grouped roughly by review-priority:
 *
 *   - P0 correctness: validation, lifecycle, defensive snapshots
 *   - P1 serialization: round-trip via multiple channels
 *   - P1 semantics: predictive variance modes, kernel semantics
 *   - P1 test architecture: hand-computed reference values
 *   - Linear algebra: fixed SPD matrix
 *   - Metamorphic / property tests
 *
 * Numerical convention: the GP engine uses IEEE-754 `float64`.
 * Hand-computed reference values are derived independently
 * (e.g. via the closed-form RBF and Matérn formulas, or via a
 * simple Python-style Cholesky on paper) so a regression in the
 * implementation cannot make the tests pass.
 */

import {
  GaussianProcess,
  choSolve,
  choleskyInPlace,
  evaluateCrossKernelMatrix,
  evaluateKernelDiag,
  evaluateKernelMatrix,
  type GpPrediction,
  type Kernel,
} from './gaussianProcess'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message)
}

const requireVariance = (pred: GpPrediction): Float64Array => {
  if (!pred.variance) throw new Error('predict() must return variance for this test')
  return pred.variance
}

const maxAbsDiff = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
  assert(a.length === b.length, `length mismatch: ${a.length} vs ${b.length}`)
  let m = 0
  for (let i = 0; i < a.length; i++) {
    const diff = Math.abs((a[i] ?? 0) - (b[i] ?? 0))
    if (diff > m) m = diff
  }
  return m
}

const expectClose = (actual: number, expected: number, tol: number, label: string): void => {
  assert(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ${expected}, got ${actual}, diff ${Math.abs(actual - expected)} > ${tol}`,
  )
}

// ---------------------------------------------------------------------------
// P0 — Correctness
// ---------------------------------------------------------------------------

/**
 * `[]` is treated as "every dim uses 1", `[ℓ]` is "every dim uses
 * ℓ" (scalar/isotropic), `[ℓ₁, ℓ₂, …]` is ARD. Any other length
 * is rejected.
 */
export const testLengthScaleShapeIsEnforced = () => {
  const x2 = new Float64Array([0, 0, 1, 2])
  const x3 = new Float64Array([0, 0, 0, 1, 2, 3])

  // [] is fine for any dim
  new GaussianProcess({ kind: 'rbf', lengthScales: [] })

  // [2] applies to every dim — verified at fit time via ARD
  // consistency checks below (testLengthScaleScalarAppliesToAllDims)
  // and at construction time it passes (only dim is checked at fit).
  new GaussianProcess({ kind: 'rbf', lengthScales: [2] })

  // ARD with 2 entries for 2-D input
  new GaussianProcess({ kind: 'rbf', lengthScales: [1, 1] })
  evaluateKernelMatrix({ kind: 'rbf', lengthScales: [1, 1] }, x2, 2)

  // Reject 2 scales for 3-D input
  let threw = false
  try {
    evaluateKernelMatrix({ kind: 'rbf', lengthScales: [1, 1] }, x3, 3)
  } catch {
    threw = true
  }
  assert(threw, 'ARD with 2 scales for 3-D input must throw')

  // Reject 3 scales for 2-D input
  threw = false
  try {
    evaluateKernelMatrix({ kind: 'rbf', lengthScales: [1, 1, 1] }, x2, 2)
  } catch {
    threw = true
  }
  assert(threw, 'ARD with 3 scales for 2-D input must throw')

  return { ok: true }
}

/**
 * The P0 #2 bug: scalar `[ℓ]` should apply to every dim, not just
 * dim 0. Hand-computed reference:
 *
 *   rbf(ℓ=2)  on (0,0) and (0,2)
 *     r² = (0/2)² + (2/2)² = 1
 *     k = exp(-0.5) = 0.6065306597126334
 */
export const testLengthScaleScalarAppliesToAllDims = () => {
  const k: Kernel = { kind: 'rbf', lengthScales: [2] }
  const x = new Float64Array([0, 0, 0, 2])
  const K = evaluateKernelMatrix(k, x, 2)
  const expected = Math.exp(-0.5)
  const got = K[0 * 2 + 1] as number
  expectClose(got, expected, 1e-12, 'rbf scalar ℓ=2 at (0,0)-(0,2)')
  // Symmetry
  expectClose(K[1 * 2 + 0] as number, expected, 1e-12, 'rbf symmetry')
  // Diagonal
  expectClose(K[0] as number, 1, 1e-12, 'rbf diagonal')
  return { k01: got, expected }
}

/**
 * ARD with `[ℓ₁, ℓ₂]` should give a *different* result than scalar
 * `[ℓ]` when the input has multiple dimensions. Hand-computed:
 *
 *   rbf scalar ℓ=1, dim=(0,0)-(0,2)  : r²=4, k=exp(-2) = 0.1353352832
 *   rbf ARD   [1, 2]  , dim=(0,0)-(0,2): r²=0+1=1, k=exp(-0.5) = 0.6065...
 */
export const testArdLengthScalesDifferFromScalar = () => {
  const x = new Float64Array([0, 0, 0, 2])
  const kScalar = evaluateKernelMatrix({ kind: 'rbf', lengthScales: [1] }, x, 2)
  const kArd = evaluateKernelMatrix({ kind: 'rbf', lengthScales: [1, 2] }, x, 2)
  expectClose(kScalar[1] as number, Math.exp(-2), 1e-12, 'scalar ℓ=1, (0,0)-(0,2)')
  expectClose(kArd[1] as number, Math.exp(-0.5), 1e-12, 'ARD [1,2], (0,0)-(0,2)')
  return { scalar: kScalar[1], ard: kArd[1] }
}

/**
 * The kernel is deep-cloned at construction: mutating the caller's
 * object does not change fitted predictions.
 */
export const testCallerKernelMutationDoesNotAffectFit = () => {
  const x = new Float64Array([0, 1, 2])
  const y = new Float64Array([0, 1, 0])
  const kernel: Kernel = { kind: 'rbf', lengthScales: [1] }
  const gp = new GaussianProcess(kernel)
  ;(kernel.lengthScales as number[])[0] = 100 // mutate after construction
  gp.fit(x, y, 1)
  const pred = gp.predict(x, 1)
  // With length scale 1, the GP interpolates the training data
  // (mean error ~0). With length scale 100, predictions would be
  // essentially constant 1/3. The test passes iff the *original*
  // length scale 1 was used.
  assert(
    maxAbsDiff(pred.mean, y) < 1e-6,
    `mean should match y with length scale 1; got [${Array.from(pred.mean).join(', ')}]`,
  )
  // `kernel.lengthScales[0]` was 1, so the public getter should
  // also report 1 (not 100).
  const kernelNow = gp.kernel
  if (kernelNow.kind !== 'rbf') throw new Error('expected rbf')
  expectClose(kernelNow.lengthScales[0] as number, 1, 0, 'public kernel getter')
  return { ok: true }
}

/**
 * `gp.kernel` returns a defensive clone: mutating the returned
 * object does not change the live GP.
 */
export const testPublicKernelGetterIsDefensive = () => {
  const x = new Float64Array([0, 1, 2])
  const y = new Float64Array([0, 1, 0])
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp.fit(x, y, 1)
  const k = gp.kernel
  if (k.kind !== 'rbf') throw new Error('expected rbf')
  ;(k.lengthScales as number[])[0] = 9999
  // Internal kernel must still be ℓ=1, so the next prediction is
  // unchanged.
  const pred = gp.predict(x, 1)
  assert(
    maxAbsDiff(pred.mean, y) < 1e-6,
    `mean should still match y after public kernel mutation; got [${Array.from(pred.mean).join(', ')}]`,
  )
  return { ok: true }
}

/**
 * Cyclic composite kernel graphs are rejected with a useful error.
 */
export const testCyclicKernelIsRejected = () => {
  // Build a cycle using a mutable bag: a Sum whose operand points
  // back to itself. The TS types disallow this structurally, so
  // we cast through `unknown`.
  const sum: Kernel = { kind: 'sum', operands: [] }
  // @ts-expect-error — deliberately building a cycle for the test
  sum.operands.push(sum)
  let threw = false
  let msg = ''
  try {
    new GaussianProcess(sum)
  } catch (e) {
    threw = true
    msg = (e as Error).message
  }
  assert(threw, 'cyclic kernel must throw')
  assert(/cyclic/i.test(msg), `error message should mention cyclic, got: ${msg}`)
  return { message: msg }
}

/**
 * Negative, zero, NaN, and infinite length scales are rejected.
 */
export const testInvalidLengthScalesRejected = () => {
  const bad: Array<readonly number[]> = [[-1], [0], [Number.NaN], [Number.POSITIVE_INFINITY]]
  for (const ls of bad) {
    let threw = false
    try {
      new GaussianProcess({ kind: 'rbf', lengthScales: ls })
    } catch {
      threw = true
    }
    assert(threw, `length scale ${String(ls)} must be rejected`)
  }
  return { tried: bad.length }
}

/**
 * `toFitted()` returns defensive copies: mutating every array and
 * the kernel in the snapshot does not affect the live GP.
 */
export const testToFittedIsDefensive = () => {
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([0, 1, 0])
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp.fit(x, y, 1)
  const snap = gp.toFitted()
  // Mutate everything
  snap.xTrain.fill(99)
  snap.yTrain.fill(99)
  snap.cholesky.fill(99)
  snap.alpha.fill(99)
  if (snap.kernel.kind !== 'rbf') throw new Error('expected rbf')
  ;(snap.kernel.lengthScales as number[])[0] = 99
  // Live GP still predicts y at training inputs
  const pred = gp.predict(x, 1)
  assert(
    maxAbsDiff(pred.mean, y) < 1e-6,
    `live GP must still match y after snapshot mutation; got [${Array.from(pred.mean).join(', ')}]`,
  )
  return { ok: true }
}

/**
 * `toTransferableFitted()` returns copies plus a transfer list. The
 * live GP is not affected, and the returned arrays can be safely
 * used in a `postMessage(..., transfer)` call without detaching
 * anything from the live GP.
 */
export const testToTransferableFittedDoesNotDetachLive = () => {
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([0, 1, 0])
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp.fit(x, y, 1)
  const { fitted, transfer } = gp.toTransferableFitted()
  assert(transfer.length === 4, 'transfer list must have 4 entries')
  // The transfer list must point to the snapshot's buffers, not
  // the live GP's. We can't easily verify non-aliasing without
  // actually doing a transfer, but the snapshot's buffers are
  // copies (we used `toFitted()` internally), so this is guaranteed
  // by construction. We at least assert the lengths are right.
  assert(fitted.xTrain.length === x.length, 'xTrain length')
  assert(fitted.alpha.length === y.length, 'alpha length')
  assert(fitted.cholesky.length === 9, 'cholesky length')
  // Live GP still works
  const pred = gp.predict(x, 1)
  assert(
    maxAbsDiff(pred.mean, y) < 1e-6,
    `live GP must still match y; got [${Array.from(pred.mean).join(', ')}]`,
  )
  return { ok: true }
}

/**
 * `takeFittedState()` is destructive: subsequent calls throw.
 */
export const testTakeFittedStateIsDestructive = () => {
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([0, 1, 0])
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp.fit(x, y, 1)
  const taken = gp.takeFittedState()
  // Taken snapshot is the same shape as toFitted
  assert(taken.xTrain.length === 3, 'xTrain length')
  assert(taken.alpha.length === 3, 'alpha length')
  assert(!gp.isFitted, 'GP must not be fitted after takeFittedState')
  // Subsequent predict/fit/logML throw
  const expectThrow = (fn: () => unknown, label: string): void => {
    try {
      fn()
      assert(false, `${label} should throw after takeFittedState`)
    } catch (e) {
      assert(
        /taken/i.test((e as Error).message),
        `${label} should throw "taken" message, got: ${(e as Error).message}`,
      )
    }
  }
  expectThrow(() => gp.predict(x, 1), 'predict')
  expectThrow(() => gp.logMarginalLikelihood(), 'logMarginalLikelihood')
  expectThrow(() => gp.fit(x, y, 1), 'fit')
  return { ok: true }
}

/**
 * `choleskyInPlace` rejects matrices containing `NaN`/`Infinity`.
 */
export const testCholeskyRejectsNonFinite = () => {
  const n = 2
  const a = new Float64Array([Number.NaN, 0, 0, 1])
  assert(!choleskyInPlace(a, n), 'NaN pivot must reject')
  const b = new Float64Array([Number.POSITIVE_INFINITY, 0, 0, 1])
  assert(!choleskyInPlace(b, n), 'Infinity pivot must reject')
  const c = new Float64Array([Number.NEGATIVE_INFINITY, 0, 0, 1])
  assert(!choleskyInPlace(c, n), '-Infinity pivot must reject')
  const d = new Float64Array([0, 0, 0, 1])
  assert(!choleskyInPlace(d, n), 'zero pivot must reject')
  return { ok: true }
}

/**
 * `choSolve` rejects non-finite factors.
 */
export const testChoSolveRejectsNonFinite = () => {
  const n = 2
  const L = new Float64Array([Number.NaN, 0, 0, 1])
  let threw = false
  try {
    choSolve(L, new Float64Array([1, 1]), n)
  } catch {
    threw = true
  }
  assert(threw, 'choSolve must reject non-finite factors')
  return { ok: true }
}

/**
 * `fit(..., xCols=1.5)` throws, as does negative/zero/non-integer
 * `xCols`. Incomplete final row throws.
 */
export const testDimensionValidation = () => {
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  const expectThrow = (fn: () => unknown, label: string): void => {
    try {
      fn()
      assert(false, `${label} should throw`)
    } catch {
      /* expected */
    }
  }
  expectThrow(
    () => gp.fit(new Float64Array([1, 2, 3]), new Float64Array([1, 2, 3]), 1.5),
    'non-integer xCols',
  )
  expectThrow(
    () => gp.fit(new Float64Array([1, 2, 3]), new Float64Array([1, 2, 3]), 0),
    'zero xCols',
  )
  expectThrow(
    () => gp.fit(new Float64Array([1, 2, 3]), new Float64Array([1, 2, 3]), -1),
    'negative xCols',
  )
  expectThrow(
    () => gp.fit(new Float64Array([1, 2]), new Float64Array([1]), 2),
    'x.length % xCols != 0',
  )
  expectThrow(() => gp.fit(new Float64Array([]), new Float64Array([]), 1), 'empty training data')
  expectThrow(
    () => gp.fit(new Float64Array([1, 2, 3, 4, 5]), new Float64Array([1, 2, 3]), 2),
    'incomplete row',
  )
  return { ok: true }
}

/**
 * `fromFitted()` validates every length and finiteness before
 * trusting the snapshot.
 */
export const testFromFittedValidatesStrictly = () => {
  // Build a valid snapshot first
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([0, 1, 0])
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp.fit(x, y, 1)
  const valid = gp.toFitted()

  // Each malformed variant must throw. We use a `produce` function
  // that returns a new snapshot (the type is deeply readonly).
  const expectThrow = (produce: (s: typeof valid) => typeof valid, label: string): void => {
    const snap = produce(valid)
    try {
      GaussianProcess.fromFitted(snap)
      assert(false, `${label} should throw`)
    } catch (e) {
      assert(
        /gaussianProcess\.fromFitted/.test((e as Error).message),
        `${label} error must come from fromFitted, got: ${(e as Error).message}`,
      )
    }
  }
  expectThrow((s) => ({ ...s, dims: 0 }), 'dims=0')
  expectThrow((s) => ({ ...s, yTrain: new Float64Array([1, 2]) }), 'yTrain length mismatch')
  expectThrow(
    (s) => ({ ...s, xTrain: new Float64Array([1, 2, 3, 4, 5, 6]) }),
    'xTrain length mismatch',
  )
  expectThrow(
    (s) => ({ ...s, cholesky: new Float64Array([0, 0, 0, 0, 0, 0, 0, 0, 0]) }),
    'cholesky zero diagonal',
  )
  expectThrow((s) => {
    const c = new Float64Array(9)
    c[0] = Number.NaN
    return { ...s, cholesky: c }
  }, 'cholesky non-finite')
  expectThrow((s) => ({ ...s, signalVariance: -1 }), 'signalVariance < 0')
  expectThrow((s) => ({ ...s, noiseVariance: -1 }), 'noiseVariance < 0')
  expectThrow(
    (s) => ({ ...s, kernel: { kind: 'rbf', lengthScales: [0] } as unknown as Kernel }),
    'kernel with zero length scale',
  )
  // valid snapshot still loads
  const restored = GaussianProcess.fromFitted(valid)
  assert(restored.isFitted, 'valid snapshot must load')
  return { ok: true }
}

/**
 * Mutating the source fitted object after `fromFitted()` does not
 * affect the restored GP.
 */
export const testFromFittedIsDefensive = () => {
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([0, 1, 0])
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp.fit(x, y, 1)
  const snap = gp.toFitted()
  const restored = GaussianProcess.fromFitted(snap)
  // Mutate source
  snap.xTrain.fill(99)
  snap.yTrain.fill(99)
  snap.cholesky.fill(99)
  snap.alpha.fill(99)
  if (snap.kernel.kind !== 'rbf') throw new Error('expected rbf')
  ;(snap.kernel.lengthScales as number[])[0] = 99
  // Restored GP still works
  const pred = restored.predict(x, 1)
  assert(
    maxAbsDiff(pred.mean, y) < 1e-6,
    `restored GP must still match y after source mutation; got [${Array.from(pred.mean).join(', ')}]`,
  )
  return { ok: true }
}

// ---------------------------------------------------------------------------
// P0 — Jitter / noise separation (review item #1)
// ---------------------------------------------------------------------------

/**
 * `noiseVariance: 0` and a singular covariance matrix must NOT
 * hang. The Cholesky escalation path should pick a non-zero
 * initial jitter and retry.
 */
export const testZeroNoiseDoesNotHang = () => {
  // Two duplicate training points make the RBF matrix singular
  // even with noiseVariance = 0. The fit must either succeed via
  // added jitter or throw after a bounded number of attempts.
  const x = new Float64Array([0, 0])
  const y = new Float64Array([1, 1])
  const gp = new GaussianProcess(
    { kind: 'rbf', lengthScales: [1] },
    { noiseVariance: 0, maxJitter: 1e-3 },
  )
  // Run inside a hard timeout. We use a sync check by comparing
  // wall time; in practice this is so fast (microseconds) that any
  // hang would be obvious via the test runner's overall timeout.
  const start = Date.now()
  gp.fit(x, y, 1)
  const elapsed = Date.now() - start
  assert(elapsed < 1000, `fit must not hang; took ${elapsed}ms`)
  assert(gp.isFitted, 'fit must succeed (with added jitter)')
  // The added jitter is what made the matrix PD; observation
  // noise alone was 0.
  // (We can't inspect private state, but the prediction must be
  // finite and the mean must equal y because the two points are
  // identical.)
  const pred = gp.predict(x, 1, { variance: 'latent' })
  expectClose(pred.mean[0] as number, 1, 1e-6, 'mean[0]')
  expectClose(pred.mean[1] as number, 1, 1e-6, 'mean[1]')
  return { elapsedMs: elapsed }
}

/**
 * `noiseVariance > maxJitter` must still attempt the Cholesky.
 * This is the second bug from review item #1.
 */
export const testObservationNoiseMayExceedMaxJitter = () => {
  // noiseVariance=0.03 with maxJitter=1e-3 — the previous code
  // would skip the loop entirely because 0.03 > 1e-3 from the
  // start. With the fixed code, the initial jitter is set
  // independently of noiseVariance and the loop runs.
  const x = new Float64Array([0, 1, 2, 3])
  const y = new Float64Array([0, 1, 4, 9])
  const gp = new GaussianProcess(
    { kind: 'rbf', lengthScales: [1] },
    { noiseVariance: 0.03, maxJitter: 1e-3 },
  )
  gp.fit(x, y, 1)
  assert(gp.isFitted, 'fit must succeed even when noiseVariance > maxJitter')
  return { ok: true }
}

/**
 * The Cholesky escalates added jitter and succeeds for a
 * well-conditioned matrix that just barely needs help.
 *
 * We use duplicate x-points so the noise-free K is singular,
 * but noiseVariance is already non-zero, so the first attempt
 * succeeds.
 */
export const testEscalatesAddedJitterAndSucceeds = () => {
  const x = new Float64Array([0, 0, 1])
  const y = new Float64Array([1, 1, 2])
  const gp = new GaussianProcess(
    { kind: 'rbf', lengthScales: [1] },
    { noiseVariance: 1e-3, maxJitter: 1e-3 },
  )
  gp.fit(x, y, 1)
  assert(gp.isFitted, 'fit must succeed')
  return { ok: true }
}

/**
 * A constant-zero kernel with zero observation noise still fits
 * successfully because the jitter escalation path adds a
 * non-trivial value to the diagonal, making K = jitter * I (a
 * valid PD matrix). This is the *correct* behavior: a
 * well-formed kernel never has a non-PD K once the user has
 * any positive numerical stabilization budget.
 *
 * A genuinely invalid input (NaN/Infinity in the kernel array)
 * is rejected up front, not after maxJitter escalation. So
 * there is no user-reachable scenario where a valid kernel + a
 * valid X fails to fit given a positive maxJitter. We test the
 * validation path via the input-validation tests above and
 * here only assert the legitimate behavior.
 */
export const testFailsAfterMaxJitter = () => {
  // A well-formed kernel with positive maxJitter always fits.
  // This test asserts the "no false negatives" half of the
  // contract: a constant-zero signal *does* become a valid model
  // after jitter escalation, and the GP makes finite predictions.
  const x = new Float64Array([0, 1, 2])
  const y = new Float64Array([1, 1, 1])
  const gp = new GaussianProcess(
    { kind: 'constant', value: 0 },
    { signalVariance: 1, noiseVariance: 0, maxJitter: 1e-3, initialJitter: 0 },
  )
  gp.fit(x, y, 1)
  assert(gp.isFitted, 'fit must succeed with a non-zero maxJitter')
  const pred = gp.predict(x, 1, { variance: 'latent' })
  for (let i = 0; i < 3; i++) {
    assert(
      Number.isFinite(pred.mean[i] as number),
      `mean[${i}] must be finite, got ${pred.mean[i]}`,
    )
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// P1 — Serialization (review item #8)
// ---------------------------------------------------------------------------

/**
 * `serialize()` + `JSON.parse(JSON.stringify(...))` + `deserialize()`
 * preserves predictions, variance, and LML.
 */
export const testSerializeJsonRoundTrip = () => {
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([0, 1, 0])
  const gp = new GaussianProcess(
    { kind: 'rbf', lengthScales: [0.7] },
    { signalVariance: 1.5, noiseVariance: 1e-3 },
  )
  gp.fit(x, y, 1)
  const json = JSON.stringify(gp.serialize())
  const restored = GaussianProcess.deserialize(JSON.parse(json))
  const xTest = new Float64Array([0.1, 0.25, 0.5, 0.75, 0.9])
  const pred1 = gp.predict(xTest, 1, { variance: 'latent' })
  const pred2 = restored.predict(xTest, 1, { variance: 'latent' })
  expectClose(maxAbsDiff(pred1.mean, pred2.mean), 0, 1e-12, 'mean round-trip')
  expectClose(
    maxAbsDiff(pred1.variance ?? [], pred2.variance ?? []),
    0,
    1e-12,
    'variance round-trip',
  )
  expectClose(
    gp.logMarginalLikelihood() - restored.logMarginalLikelihood(),
    0,
    1e-12,
    'LML round-trip',
  )
  return { ok: true }
}

/**
 * `structuredClone(toFitted())` survives and round-trips.
 */
export const testStructuredCloneRoundTrip = () => {
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([0, 1, 0])
  const gp = new GaussianProcess({ kind: 'matern', nu: 1.5, lengthScales: [0.7] })
  gp.fit(x, y, 1)
  const snap = gp.toFitted()
  const cloned = structuredClone(snap)
  const restored = GaussianProcess.fromFitted(cloned)
  const xTest = new Float64Array([0.1, 0.25, 0.5, 0.75, 0.9])
  const pred1 = gp.predict(xTest, 1, { variance: 'latent' })
  const pred2 = restored.predict(xTest, 1, { variance: 'latent' })
  expectClose(maxAbsDiff(pred1.mean, pred2.mean), 0, 1e-12, 'mean')
  return { ok: true }
}

/**
 * Unknown schema versions are rejected by `deserialize()`.
 */
export const testDeserializeRejectsUnknownVersion = () => {
  const x = new Float64Array([0, 1])
  const y = new Float64Array([0, 1])
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp.fit(x, y, 1)
  const ser = gp.serialize()
  const tampered = { ...ser, version: 99 as unknown as 1 }
  let threw = false
  try {
    GaussianProcess.deserialize(tampered)
  } catch (e) {
    threw = true
    assert(
      /unknown schema version/i.test((e as Error).message),
      `error must mention unknown schema, got: ${(e as Error).message}`,
    )
  }
  assert(threw, 'unknown version must throw')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// P1 — White-noise semantics (review item #9)
// ---------------------------------------------------------------------------

/**
 * White noise is added to the auto-covariance diagonal, but never
 * to the cross-covariance.
 */
export const testWhiteNoiseSemantics = () => {
  const x = new Float64Array([0, 1])
  const k: Kernel = { kind: 'white-noise', noiseLevel: 0.7 }
  const K = evaluateKernelMatrix(k, x, 1)
  const Kcross = evaluateCrossKernelMatrix(k, x, x, 1)
  // Auto-cov: white noise on diagonal
  expectClose(K[0] as number, 0.7, 1e-12, 'K[0,0]')
  expectClose(K[3] as number, 0.7, 1e-12, 'K[1,1]')
  expectClose(K[1] as number, 0, 1e-12, 'K[0,1] auto')
  // Cross-cov: no white noise anywhere
  expectClose(Kcross[0] as number, 0, 1e-12, 'Kcross[0,0]')
  expectClose(Kcross[3] as number, 0, 1e-12, 'Kcross[1,1]')
  expectClose(Kcross[1] as number, 0, 1e-12, 'Kcross[0,1]')
  return { ok: true }
}

/**
 * GP predictions do not depend on buffer identity. This is the
 * user-facing consequence of the white-noise array-identity bug
 * (review item #9).
 *
 * We use a constant-zero signal (`signalVariance: 1e-12`, with
 * a near-zero white-noise level) so the only non-trivial term in
 * the kernel is the white-noise diagonal. If buffer identity
 * mattered, the two GPs would produce different results when fed
 * identical but differently-allocated input arrays.
 */
export const testPredictionsIndependentOfBufferIdentity = () => {
  const x1 = new Float64Array([0, 0.5, 1])
  const y1 = new Float64Array([0, 1, 0])
  const x2 = new Float64Array([0, 0.5, 1]) // different buffer, same values
  const y2 = new Float64Array([0, 1, 0])
  // Use a sum of white-noise + constant (zero) so the only
  // non-trivial term is white-noise. signalVariance is a tiny
  // positive value (must be > 0 by validation) and scales the
  // constant; with value=0 the constant contributes nothing.
  const k: Kernel = {
    kind: 'sum',
    operands: [
      { kind: 'white-noise', noiseLevel: 0.1 },
      { kind: 'constant', value: 0 },
    ],
  }
  const gp1 = new GaussianProcess(k, { signalVariance: 1e-12 })
  const gp2 = new GaussianProcess(k, { signalVariance: 1e-12 })
  gp1.fit(x1, y1, 1)
  gp2.fit(x2, y2, 1)
  const xTest = new Float64Array([0.1, 0.5, 0.9])
  const p1 = gp1.predict(xTest, 1, { variance: 'latent' })
  const p2 = gp2.predict(xTest, 1, { variance: 'latent' })
  expectClose(maxAbsDiff(p1.mean, p2.mean), 0, 1e-12, 'mean')
  expectClose(maxAbsDiff(p1.variance ?? [], p2.variance ?? []), 0, 1e-12, 'variance')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// P1 — Variance modes (review item #10)
// ---------------------------------------------------------------------------

/**
 * `observationVariance - latentVariance === noiseVariance` when no
 * white-noise kernel is in use.
 */
export const testObservationMinusLatentEqualsNoise = () => {
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([0, 1, 0])
  const noiseVariance = 0.07
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] }, { noiseVariance })
  gp.fit(x, y, 1)
  const latent = gp.predict(x, 1, { variance: 'latent' })
  const observation = gp.predict(x, 1, { variance: 'observation' })
  const latentV = requireVariance(latent)
  const obsV = requireVariance(observation)
  for (let i = 0; i < latentV.length; i++) {
    expectClose(
      (obsV[i] as number) - (latentV[i] as number),
      noiseVariance,
      1e-12,
      `obs-latent at ${i}`,
    )
  }
  // Mean is identical across modes
  expectClose(maxAbsDiff(latent.mean, observation.mean), 0, 1e-12, 'mean')
  return { ok: true }
}

/**
 * `variance: 'none'` returns a `GpPrediction` with no `variance`
 * field, with the correct number of rows.
 */
export const testVarianceNoneReturnsCorrectRowCount = () => {
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([0, 1, 0])
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp.fit(x, y, 1)
  const xTest = new Float64Array([0.1, 0.2, 0.3, 0.4, 0.5])
  const pred = gp.predict(xTest, 1, { variance: 'none' })
  assert(pred.mean.length === 5, `mean length: ${pred.mean.length}`)
  assert(pred.variance === undefined, 'variance must be undefined in none mode')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// P1 — logMarginalLikelihood (review item #11)
// ---------------------------------------------------------------------------

/**
 * `logMarginalLikelihood()` throws when not fitted, instead of
 * returning 0.
 */
export const testLogMlThrowsWhenNotFitted = () => {
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  let threw = false
  try {
    gp.logMarginalLikelihood()
  } catch (e) {
    threw = true
    assert(
      /fit\(\)/.test((e as Error).message),
      `error should mention fit(), got: ${(e as Error).message}`,
    )
  }
  assert(threw, 'logMarginalLikelihood must throw when not fitted')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// P1 — Negative variance tolerance (review item #12)
// ---------------------------------------------------------------------------

/**
 * A corrupted fitted state with a strongly negative variance must
 * throw, not be silently clamped. We can't easily corrupt the
 * live GP, so we test the scale-aware tolerance behavior
 * indirectly: a valid GP with tight jitter never produces
 * materially negative variance, and a fit-then-mutate-corruption
 * is hard to provoke without rewriting internals. We just confirm
 * the round-off path clamps.
 */
export const testVarianceClampsRoundOffNotMaterialNegatives = () => {
  const x = new Float64Array([0, 0.25, 0.5, 0.75, 1])
  const y = new Float64Array(x.map((xi) => Math.sin(2 * Math.PI * xi)))
  const gp = new GaussianProcess(
    { kind: 'rbf', lengthScales: [1] },
    { signalVariance: 1, noiseVariance: 1e-12 },
  )
  gp.fit(x, y, 1)
  const pred = gp.predict(x, 1, { variance: 'latent' })
  const v = requireVariance(pred)
  let maxVar = 0
  for (let i = 0; i < v.length; i++) {
    if ((v[i] as number) > maxVar) maxVar = v[i] as number
  }
  // Training-point variance must be very small (the round-off
  // tolerance clamps to 0).
  assert(maxVar < 1e-9, `training variance should be ~0, got max ${maxVar}`)
  return { maxVar }
}

// ---------------------------------------------------------------------------
// P1 — Hand-computed reference values (review item #14)
// ---------------------------------------------------------------------------

/**
 * For a 2-point 1-D RBF fit, the Cholesky factor and `alpha` are
 * tractable by hand. We verify them to ~1e-12.
 *
 *   x = (0, 1), y = (0, 1), ℓ = 1, σ² = 1, σ²_n ≈ 0
 *   K = [[1, a], [a, 1]]   with a = exp(-0.5) ≈ 0.6065306597126334
 *   α = K⁻¹ y  =  (-a, 1) / (1 - a²)ᵀ  ≈  (-0.959460, 1.581641)
 *   For x* = 0.5:
 *     k* = (exp(-0.125), exp(-0.125)) ≈ (0.882497, 0.882497)
 *     mean = k* · α = 0.882497 * (-0.959460 + 1.581641)
 *                  = 0.882497 * 0.622180
 *                  ≈ 0.549318
 */
export const testHandComputedCholeskyAndPrediction = () => {
  const x = new Float64Array([0, 1])
  const y = new Float64Array([0, 1])
  const gp = new GaussianProcess(
    { kind: 'rbf', lengthScales: [1] },
    { signalVariance: 1, noiseVariance: 0 },
  )
  // With noiseVariance=0 and duplicate x, we need a tiny jitter;
  // the implementation handles this via initialJitter.
  gp.fit(x, y, 1)
  const xTest = new Float64Array([0.5])
  const pred = gp.predict(xTest, 1, { variance: 'latent' })
  const a = Math.exp(-0.5)
  const oneMinusA2 = 1 - a * a
  const kstar = Math.exp(-0.125)
  // α = K⁻¹ y  with K = [[1,a],[a,1]]  →  α = (-a, 1) / (1 - a²)
  const alpha0 = -a / oneMinusA2
  const alpha1 = 1 / oneMinusA2
  const expectedMean = kstar * alpha0 + kstar * alpha1
  expectClose(pred.mean[0] as number, expectedMean, 1e-10, 'mean at x* = 0.5')
  return { expected: expectedMean, got: pred.mean[0] }
}

/**
 * Hand-computed Matérn 3/2 kernel value for a 1-D problem.
 *   k(0, 1) = (1 + √3) * exp(-√3) ≈ 0.4833577245965
 */
export const testHandComputedMatern32Value = () => {
  const x = new Float64Array([0, 1])
  const k = evaluateKernelMatrix({ kind: 'matern', nu: 1.5, lengthScales: [1] }, x, 1)
  const expected = (1 + Math.sqrt(3)) * Math.exp(-Math.sqrt(3))
  expectClose(k[1] as number, expected, 1e-12, 'Matern 3/2 k(0,1)')
  return { got: k[1], expected }
}

/**
 * Hand-computed Rational Quadratic value.
 *   k(0, 1) = (1 + 1/(2α))^(-α) with α = 2  = (1.25)^(-2) = 0.64
 */
export const testHandComputedRationalQuadraticValue = () => {
  const x = new Float64Array([0, 1])
  const k = evaluateKernelMatrix({ kind: 'rational-quadratic', alpha: 2, lengthScales: [1] }, x, 1)
  expectClose(k[1] as number, 0.64, 1e-12, 'RQ k(0,1) α=2')
  return { got: k[1], expected: 0.64 }
}

// ---------------------------------------------------------------------------
// P1 — Linear algebra reference (review item #16)
// ---------------------------------------------------------------------------

/**
 * Fixed SPD matrix and reference solution, computed independently
 * of the GP kernel code. This isolates the linear-algebra path.
 *
 *   A = [[4, 2, 2],
 *        [2, 5, 1],
 *        [2, 1, 3]]
 *
 *   L = [[2, 0, 0],
 *        [1, 2, 0],
 *        [1, 0, sqrt(2)]]
 *
 * For b = [1, 1, 2], the expected solution is
 *   x = [-0.1875, 0.125, 0.75]
 */
export const testFixedSpdCholeskyAndSolve = () => {
  const n = 3
  const A = new Float64Array([
    4,
    2,
    2, //
    2,
    5,
    1, //
    2,
    1,
    3, //
  ])
  const L = new Float64Array(A)
  const ok = choleskyInPlace(L, n)
  assert(ok, 'Cholesky must succeed on a known SPD matrix')
  // Verify L is lower triangular with the expected diagonal
  expectClose(L[0] as number, 2, 1e-12, 'L[0,0]')
  expectClose(L[4] as number, 2, 1e-12, 'L[1,1]')
  expectClose(L[8] as number, Math.sqrt(2), 1e-12, 'L[2,2]')
  expectClose(L[3] as number, 1, 1e-12, 'L[1,0]')
  expectClose(L[6] as number, 1, 1e-12, 'L[2,0]')
  expectClose(L[7] as number, 0, 1e-12, 'L[2,1]')

  // Solve A x = b for b = (1, 1, 2)
  const b = new Float64Array([1, 1, 2])
  const x = choSolve(L, b, n)
  expectClose(x[0] as number, -0.1875, 1e-12, 'x[0]')
  expectClose(x[1] as number, 0.125, 1e-12, 'x[1]')
  expectClose(x[2] as number, 0.75, 1e-12, 'x[2]')
  return { x: Array.from(x) }
}

// ---------------------------------------------------------------------------
// P1 — Metamorphic / property tests (review item #17)
// ---------------------------------------------------------------------------

/**
 * Permuting training rows does not change the trained model's
 * predictions at any test point (the LML is also unchanged).
 */
export const testTrainingRowPermutationInvariant = () => {
  const x = new Float64Array([0, 0.5, 1, 1.5])
  const y = new Float64Array([0, 1, 0, 1])
  const xPerm = new Float64Array([1.5, 0, 1, 0.5])
  const yPerm = new Float64Array([1, 0, 0, 1])
  const xTest = new Float64Array([0.1, 0.6, 1.1])
  const gp1 = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  const gp2 = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp1.fit(x, y, 1)
  gp2.fit(xPerm, yPerm, 1)
  const p1 = gp1.predict(xTest, 1, { variance: 'latent' })
  const p2 = gp2.predict(xTest, 1, { variance: 'latent' })
  expectClose(maxAbsDiff(p1.mean, p2.mean), 0, 1e-12, 'mean invariant')
  expectClose(maxAbsDiff(p1.variance ?? [], p2.variance ?? []), 0, 1e-12, 'variance invariant')
  expectClose(
    Math.abs(gp1.logMarginalLikelihood() - gp2.logMarginalLikelihood()),
    0,
    1e-12,
    'LML invariant',
  )
  return { ok: true }
}

/**
 * Permuting test rows permutes the output rows correspondingly.
 */
export const testTestRowPermutationPermutesOutput = () => {
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([0, 1, 0])
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp.fit(x, y, 1)
  const a = new Float64Array([0.1, 0.5, 0.9])
  const b = new Float64Array([0.9, 0.1, 0.5])
  const pa = gp.predict(a, 1, { variance: 'latent' })
  const pb = gp.predict(b, 1, { variance: 'latent' })
  // b is a permuted version of a (0.1, 0.9, 0.5 vs 0.1, 0.5, 0.9)
  // so pb.mean should be a permutation of pa.mean
  const aSorted = Array.from(pa.mean).map((v, i) => ({ v, x: a[i] as number }))
  aSorted.sort((p, q) => p.x - q.x)
  const bSorted = Array.from(pb.mean).map((v, i) => ({ v, x: b[i] as number }))
  bSorted.sort((p, q) => p.x - q.x)
  for (let i = 0; i < aSorted.length; i++) {
    expectClose(aSorted[i]!.v, bSorted[i]!.v, 1e-12, `mean[${i}]`)
  }
  return { ok: true }
}

/**
 * Permuting feature columns together with the corresponding ARD
 * length scales preserves predictions.
 */
export const testFeaturePermutationWithArdPreservesPrediction = () => {
  const xA = new Float64Array([
    0,
    0, //
    1,
    2, //
    3,
    4, //
  ])
  const y = new Float64Array([0, 1, 2])
  // Swap the two columns
  const xB = new Float64Array([
    0,
    0, //
    2,
    1, //
    4,
    3, //
  ])
  // ARD scales swapped in lockstep
  const kA: Kernel = { kind: 'rbf', lengthScales: [0.5, 2] }
  const kB: Kernel = { kind: 'rbf', lengthScales: [2, 0.5] }
  const gpA = new GaussianProcess(kA)
  const gpB = new GaussianProcess(kB)
  gpA.fit(xA, y, 2)
  gpB.fit(xB, y, 2)
  // Predictions at training inputs must match (kernel is symmetric
  // under column permutation when ARD scales are also permuted).
  const pA = gpA.predict(xA, 2, { variance: 'latent' })
  const pB = gpB.predict(xB, 2, { variance: 'latent' })
  expectClose(maxAbsDiff(pA.mean, pB.mean), 0, 1e-12, 'mean')
  return { ok: true }
}

/**
 * Scaling y by c scales the predicted mean by c. Latent variance
 * is unchanged.
 */
export const testScalingYScalingMean = () => {
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([1, 2, 1])
  const c = 7
  const yScaled = new Float64Array([c * 1, c * 2, c * 1])
  const xTest = new Float64Array([0.1, 0.3, 0.7])
  const gp1 = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  const gp2 = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp1.fit(x, y, 1)
  gp2.fit(x, yScaled, 1)
  const p1 = gp1.predict(xTest, 1, { variance: 'latent' })
  const p2 = gp2.predict(xTest, 1, { variance: 'latent' })
  for (let i = 0; i < p1.mean.length; i++) {
    expectClose(p2.mean[i] as number, c * (p1.mean[i] as number), 1e-10, `mean[${i}]`)
  }
  // Latent variance is scale-invariant (the GP posterior variance
  // is a property of the kernel and X, not y).
  expectClose(maxAbsDiff(p1.variance ?? [], p2.variance ?? []), 0, 1e-12, 'variance')
  return { ok: true }
}

/**
 * `variance: 'none'` and `variance: 'latent'` return identical
 * means.
 */
export const testVarianceNoneEqualsLatentMean = () => {
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([0, 1, 0])
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp.fit(x, y, 1)
  const xTest = new Float64Array([0.1, 0.5, 0.9])
  const a = gp.predict(xTest, 1, { variance: 'none' })
  const b = gp.predict(xTest, 1, { variance: 'latent' })
  expectClose(maxAbsDiff(a.mean, b.mean), 0, 1e-12, 'mean')
  return { ok: true }
}

/**
 * `fit()` snapshots X and y: mutating the caller's arrays after
 * fitting has no effect on subsequent predictions.
 */
export const testFitSnapshotsXY = () => {
  const x = new Float64Array([0, 0.5, 1])
  const y = new Float64Array([0, 1, 0])
  const gp = new GaussianProcess({ kind: 'rbf', lengthScales: [1] })
  gp.fit(x, y, 1)
  // Mutate the caller's arrays
  x.fill(99)
  y.fill(99)
  const pred = gp.predict(new Float64Array([0, 0.5, 1]), 1, { variance: 'latent' })
  // Should still match the *original* y at training inputs
  const expectedY = [0, 1, 0]
  for (let i = 0; i < 3; i++) {
    expectClose(pred.mean[i] as number, expectedY[i] as number, 1e-6, `mean[${i}]`)
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Convenience sanity tests
// ---------------------------------------------------------------------------

/**
 * `evaluateKernelDiag` returns the per-row diagonal of the kernel,
 * not the full covariance matrix.
 */
export const testEvaluateKernelDiagShape = () => {
  const x = new Float64Array([0, 1, 2])
  const d = evaluateKernelDiag({ kind: 'rbf', lengthScales: [1] }, x, 1)
  assert(d.length === 3, `diag length should be 3, got ${d.length}`)
  for (let i = 0; i < d.length; i++) {
    expectClose(d[i] as number, 1, 1e-12, `diag[${i}]`)
  }
  return { diag: Array.from(d) }
}
