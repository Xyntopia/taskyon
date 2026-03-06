const simulateModel = (params, context, model) => {
  // -----------------------------------------------------------------------------------------------
  // Logging
  //
  // Functional style: the solver does not own global logging state.
  // If you want logs, provide `context.log(msg, ...details)`.
  // The sandbox wrapper can implement context.log by forwarding to postMessage.
  // -----------------------------------------------------------------------------------------------
  const log = (...args) => {
    try {
      if (context && typeof context.log === 'function') {
        context.log(...args)
      }
    } catch {
      /* empty */
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Existing solver implementation
  // -----------------------------------------------------------------------------------------------
  const meta = model.meta || {}

  const stateNames = (meta.states || []).map((s) => s.name)
  const algebraicNames = (meta.algebraics || []).map((a) => a.name)
  const solverAlgebraicNames = Array.isArray(meta.solverAlgebraics)
    ? meta.solverAlgebraics.filter((n) => typeof n === 'string')
    : algebraicNames.slice()
  const inputNames = (meta.inputs || []).map((u) => u.name)
  const conditionNames = (meta.conditions || []).map((c) => c.name)

  const sanitizeVariableMeta = (vars) =>
    (Array.isArray(vars) ? vars : [])
      .map((v) => {
        const name = typeof v?.name === 'string' ? v.name : ''
        if (!name) return null
        const unit = typeof v?.unit === 'string' ? v.unit.trim() : ''
        return unit ? { name, unit } : { name }
      })
      .filter((v) => v !== null)

  const stateVariables = sanitizeVariableMeta(meta.states)
  const algebraicVariables = sanitizeVariableMeta(meta.algebraics)
  const inputVariables = sanitizeVariableMeta(meta.inputs)
  const conditionVariables = sanitizeVariableMeta(meta.conditions)

  const nx = Array.isArray(model.x0) ? model.x0.length : 0
  const ny = Array.isArray(model.y0) ? model.y0.length : 0
  const nu = inputNames.length

  const haveEvents =
    typeof model.evalConditions === 'function' && typeof model.applyResets === 'function'
  const haveEventIndicators = typeof model.evalEventIndicators === 'function'
  const haveAlgebraicEval = typeof model.evalAlgebraics === 'function'

  const x0_model = Array.isArray(model.x0) ? model.x0.slice() : new Array(nx).fill(0)
  const y0_model = Array.isArray(model.y0) ? model.y0.slice() : new Array(ny).fill(0)

  let c0 = Array.isArray(model.c0) ? model.c0.slice() : null
  if (!c0 && haveEvents) {
    try {
      const cProbe = model.evalConditions(0, x0_model, y0_model, new Array(nu).fill(0), null)
      if (Array.isArray(cProbe)) c0 = cProbe.slice()
    } catch {
      /* empty */
    }
  }
  if (!c0) c0 = new Array(conditionNames.length).fill(false)

  // ---------- Linear solver ----------
  function solveLinearSystem(A, b) {
    const n = A.length
    if (n === 0) return []
    const M = A.map((r) => r.slice())
    const x = b.slice()
    const pivotTol = 1e-12

    for (let k = 0; k < n; k++) {
      let maxRow = k
      let maxVal = Math.abs(M[k][k])
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(M[i][k])
        if (v > maxVal) {
          maxVal = v
          maxRow = i
        }
      }
      if (maxVal <= pivotTol) {
        M[k][k] = M[k][k] >= 0 ? pivotTol : -pivotTol
      }

      if (maxRow !== k) {
        ;[M[k], M[maxRow]] = [M[maxRow], M[k]]
        ;[x[k], x[maxRow]] = [x[maxRow], x[k]]
      }

      for (let i = k + 1; i < n; i++) {
        const f = M[i][k] / M[k][k]
        x[i] -= f * x[k]
        for (let j = k; j < n; j++) {
          M[i][j] -= f * M[k][j]
        }
      }
    }

    for (let i = n - 1; i >= 0; i--) {
      let s = x[i]
      for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]
      const diag = Math.abs(M[i][i]) <= pivotTol ? (M[i][i] >= 0 ? pivotTol : -pivotTol) : M[i][i]
      x[i] = s / diag
    }

    return x
  }

  function solveDampedLeastSquares(J, r, lambda) {
    const m = J.length
    if (m === 0) return []
    const n = Array.isArray(J[0]) ? J[0].length : 0
    if (n === 0) return []
    const A = Array.from({ length: n }, () => new Array(n).fill(0))
    const b = new Array(n).fill(0)

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0
        for (let k = 0; k < m; k++) s += J[k][i] * J[k][j]
        if (i === j) s += lambda
        A[i][j] = s
      }
      let rhs = 0
      for (let k = 0; k < m; k++) rhs += J[k][i] * r[k]
      b[i] = -rhs
    }

    return solveLinearSystem(A, b)
  }

  function regularizeGuessVector(values, newtonOpts) {
    const minAbs = Number.isFinite(newtonOpts?.initialGuessMinAbs)
      ? Math.max(0, Math.abs(newtonOpts.initialGuessMinAbs))
      : 1e-9
    if (!Array.isArray(values) || minAbs <= 0) return Array.isArray(values) ? values.slice() : []
    return values.map((raw) => {
      const v = Number(raw)
      if (!Number.isFinite(v)) return minAbs
      if (v === 0) return minAbs
      if (Math.abs(v) < minAbs) return v < 0 ? -minAbs : minAbs
      return v
    })
  }

  // ---------- Newton solver ----------
  function newtonSolve(residualFn, z0, newtonOpts, trace) {
    const maxIter = Number.isFinite(newtonOpts?.maxIter) ? newtonOpts.maxIter : 12
    const tol = Number.isFinite(newtonOpts?.tol) ? newtonOpts.tol : 1e-8
    const epsBase = Number.isFinite(newtonOpts?.epsBase) ? newtonOpts.epsBase : 1e-6
    const lambda = Number.isFinite(newtonOpts?.lambda) ? Math.max(0, newtonOpts.lambda) : 1e-6
    const maxUpdateFactor = Number.isFinite(newtonOpts?.maxUpdateFactor)
      ? Math.max(0, newtonOpts.maxUpdateFactor)
      : 5
    const lineSearchBackoff = Number.isFinite(newtonOpts?.lineSearchBackoff)
      ? Math.min(0.95, Math.max(0.1, newtonOpts.lineSearchBackoff))
      : 0.5
    const lineSearchMinAlpha = Number.isFinite(newtonOpts?.lineSearchMinAlpha)
      ? Math.min(1, Math.max(1e-4, newtonOpts.lineSearchMinAlpha))
      : 1 / 64
    const lineSearchAcceptRatio = Number.isFinite(newtonOpts?.lineSearchAcceptRatio)
      ? Math.max(0, newtonOpts.lineSearchAcceptRatio)
      : 0.999

    const n = z0.length
    let z = regularizeGuessVector(z0, newtonOpts)
    const residualInfNorm = (arr) => {
      let v = 0
      for (let i = 0; i < arr.length; i++) {
        const ai = arr[i]
        if (!Number.isFinite(ai)) return Number.POSITIVE_INFINITY
        v = Math.max(v, Math.abs(ai))
      }
      return v
    }

    let lastResidualNorm = Number.POSITIVE_INFINITY
    for (let iter = 0; iter < maxIter; iter++) {
      let r
      try {
        r = residualFn(z)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw new Error(
          `Residual evaluation failed (stage=${trace?.stage || 'unknown'}, iter=${iter}, t=${Number(trace?.t).toPrecision(8)}): ${msg}`,
        )
      }
      if (!Array.isArray(r) || r.length !== n) {
        // Allow over/under-determined systems (m != n) by solving in least-squares sense.
        // We only require an array residual.
        if (!Array.isArray(r)) {
          throw new Error(
            `Residual shape invalid (stage=${trace?.stage || 'unknown'}, iter=${iter}): expected array, got non-array`,
          )
        }
      }
      const m = r.length
      if (m === 0) {
        throw new Error(
          `Residual shape invalid (stage=${trace?.stage || 'unknown'}, iter=${iter}): empty residual vector`,
        )
      }
      for (let i = 0; i < n; i++) {
        if (i < m && !Number.isFinite(r[i])) {
          throw new Error(
            `Residual non-finite at index=${i} (stage=${trace?.stage || 'unknown'}, iter=${iter}, t=${Number(trace?.t).toPrecision(8)}): ${String(r[i])}`,
          )
        }
      }
      for (let i = n; i < m; i++) {
        if (!Number.isFinite(r[i])) {
          throw new Error(
            `Residual non-finite at index=${i} (stage=${trace?.stage || 'unknown'}, iter=${iter}, t=${Number(trace?.t).toPrecision(8)}): ${String(r[i])}`,
          )
        }
      }

      const maxAbs = residualInfNorm(r)
      lastResidualNorm = maxAbs
      if (maxAbs < tol) return z

      const J = Array.from({ length: m }, () => new Array(n).fill(0))

      for (let j = 0; j < n; j++) {
        const zj = z[j]
        const eps = epsBase * (1 + Math.abs(zj))
        z[j] = zj + eps
        let rp
        try {
          rp = residualFn(z)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          throw new Error(
            `Residual Jacobian probe failed (stage=${trace?.stage || 'unknown'}, iter=${iter}, col=${j}, t=${Number(trace?.t).toPrecision(8)}): ${msg}`,
          )
        }
        z[j] = zj
        if (!Array.isArray(rp) || rp.length !== m) {
          throw new Error(
            `Jacobian probe shape invalid (stage=${trace?.stage || 'unknown'}, iter=${iter}, col=${j}): expected ${m}, got ${
              Array.isArray(rp) ? rp.length : 'non-array'
            }`,
          )
        }
        for (let i = 0; i < m; i++) {
          J[i][j] = (rp[i] - r[i]) / eps
          if (!Number.isFinite(J[i][j])) {
            throw new Error(
              `Jacobian non-finite at (row=${i}, col=${j}) (stage=${trace?.stage || 'unknown'}, iter=${iter}, t=${Number(trace?.t).toPrecision(8)})`,
            )
          }
        }
      }

      let delta
      // Use damped least-squares for both square and rectangular systems.
      // This is robust for over-determined DAEs (m > n) that arise from expanded libraries.
      delta = solveDampedLeastSquares(J, r, lambda)
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(delta[i])) {
          throw new Error(
            `Newton update non-finite at index=${i} (stage=${trace?.stage || 'unknown'}, iter=${iter}, t=${Number(trace?.t).toPrecision(8)})`,
          )
        }
        if (maxUpdateFactor > 0) {
          const maxAbsDelta = maxUpdateFactor * (1 + Math.abs(z[i]))
          if (Math.abs(delta[i]) > maxAbsDelta) {
            delta[i] = delta[i] < 0 ? -maxAbsDelta : maxAbsDelta
          }
        }
      }

      let accepted = false
      let alpha = 1
      while (alpha >= lineSearchMinAlpha) {
        const zCand = new Array(n)
        for (let i = 0; i < n; i++) zCand[i] = z[i] + alpha * delta[i]
        let rCand
        try {
          rCand = residualFn(zCand)
        } catch {
          rCand = null
        }
        if (Array.isArray(rCand) && rCand.length === m) {
          const maxAbsCand = residualInfNorm(rCand)
          if (
            Number.isFinite(maxAbsCand) &&
            (maxAbsCand < tol || maxAbsCand <= maxAbs * lineSearchAcceptRatio)
          ) {
            z = zCand
            accepted = true
            break
          }
        }
        alpha *= lineSearchBackoff
      }
      if (!accepted) {
        throw new Error(
          `Newton line search failed to reduce residual (stage=${trace?.stage || 'unknown'}, iter=${iter}, t=${Number(trace?.t).toPrecision(8)})`,
        )
      }
    }

    throw new Error(
      `Newton failed to converge within maxIter=${maxIter} (stage=${trace?.stage || 'unknown'}, t=${Number(trace?.t).toPrecision(8)}, residualInfNorm=${lastResidualNorm})`,
    )
  }

  // ---------- Backward-Euler-like stage ----------
  function implicitStage(tStage, xBase, yGuess, u, dtStage, pOverride, newtonOpts, stageName) {
    const z0 = regularizeGuessVector(xBase.concat(yGuess), newtonOpts)

    function residual(z) {
      const xS = z.slice(0, nx)
      const yS = z.slice(nx)

      const xDot = new Array(nx)
      for (let i = 0; i < nx; i++) {
        xDot[i] = (xS[i] - xBase[i]) / dtStage
      }

      return model.residual(tStage, xS, xDot, yS, u, pOverride)
    }

    const sol = newtonSolve(residual, z0, newtonOpts, { stage: stageName, t: tStage })
    return {
      x: sol.slice(0, nx),
      y: sol.slice(nx),
    }
  }

  // ---------- SDIRK-2 (Alexander) ----------
  function sdirk2Step(t, x, y, u, dt, pOverride, newtonOpts) {
    const gamma = 1 - 1 / Math.sqrt(2)

    // ---- Stage 1 ----
    const stage1 = implicitStage(
      t + gamma * dt,
      x,
      y,
      u,
      gamma * dt,
      pOverride,
      newtonOpts,
      'sdirk2_stage1',
    )

    // ---- Stage 2 ----
    const z0 = regularizeGuessVector(stage1.x.concat(stage1.y), newtonOpts)

    function residualStage2(z) {
      const x2 = z.slice(0, nx)
      const y2 = z.slice(nx)

      const xDot = new Array(nx)
      for (let i = 0; i < nx; i++) {
        xDot[i] =
          ((x2[i] - x[i]) / dt - ((1 - gamma) * (stage1.x[i] - x[i])) / (gamma * dt)) / gamma
      }

      return model.residual(t + dt, x2, xDot, y2, u, pOverride)
    }

    const sol2 = newtonSolve(residualStage2, z0, newtonOpts, {
      stage: 'sdirk2_stage2',
      t: t + dt,
    })

    return {
      x: sol2.slice(0, nx),
      y: sol2.slice(nx),
    }
  }

  // ---------- IRK4 (Gauss-Legendre, 2-stage) ----------
  function irk4Step(t, x, y, u, dt, pOverride, newtonOpts) {
    const sqrt3 = Math.sqrt(3)
    const c1 = 0.5 - sqrt3 / 6
    const c2 = 0.5 + sqrt3 / 6
    const a11 = 0.25
    const a12 = 0.25 - sqrt3 / 6
    const a21 = 0.25 + sqrt3 / 6
    const a22 = 0.25
    const detA = a11 * a22 - a12 * a21

    const z0 = regularizeGuessVector(x.concat(y).concat(x).concat(y), newtonOpts)

    function unpack(z) {
      const i0 = 0
      const i1 = nx
      const i2 = i1 + ny
      const i3 = i2 + nx
      const i4 = i3 + ny
      return {
        x1: z.slice(i0, i1),
        y1: z.slice(i1, i2),
        x2: z.slice(i2, i3),
        y2: z.slice(i3, i4),
      }
    }

    function stageDerivativesFromStates(x1, x2) {
      const k1 = new Array(nx)
      const k2 = new Array(nx)
      for (let i = 0; i < nx; i++) {
        const d1 = (x1[i] - x[i]) / dt
        const d2 = (x2[i] - x[i]) / dt
        k1[i] = (a22 * d1 - a12 * d2) / detA
        k2[i] = (-a21 * d1 + a11 * d2) / detA
      }
      return { k1, k2 }
    }

    function residualStages(z) {
      const { x1, y1, x2, y2 } = unpack(z)
      const { k1, k2 } = stageDerivativesFromStates(x1, x2)
      const r1 = model.residual(t + c1 * dt, x1, k1, y1, u, pOverride)
      const r2 = model.residual(t + c2 * dt, x2, k2, y2, u, pOverride)
      return r1.concat(r2)
    }

    const sol = newtonSolve(residualStages, z0, newtonOpts, {
      stage: 'irk4_stages',
      t: t + dt,
    })
    const { x2, y2, x1 } = unpack(sol)
    const { k1, k2 } = stageDerivativesFromStates(x1, x2)

    const xNext = new Array(nx)
    for (let i = 0; i < nx; i++) xNext[i] = x[i] + dt * 0.5 * (k1[i] + k2[i])

    return {
      x: xNext,
      y: y2.slice(),
    }
  }

  // ---------- Explicit RK4 (for ODE-like systems) ----------
  function solveFlowAtState(tEval, xEval, yGuess, xDotGuess, u, pOverride, newtonOpts, stageName) {
    const z0 = regularizeGuessVector(xDotGuess.concat(yGuess), newtonOpts)
    function residual(z) {
      const xDotS = z.slice(0, nx)
      const yS = z.slice(nx)
      return model.residual(tEval, xEval, xDotS, yS, u, pOverride)
    }
    const sol = newtonSolve(residual, z0, newtonOpts, { stage: stageName, t: tEval })
    return {
      xDot: sol.slice(0, nx),
      y: sol.slice(nx),
    }
  }

  function rk4Step(t, x, y, u, dt, pOverride, newtonOpts, xDotPrev) {
    const xDotSeed =
      Array.isArray(xDotPrev) && xDotPrev.length === nx ? xDotPrev.slice() : new Array(nx).fill(0)

    const s1 = solveFlowAtState(t, x, y, xDotSeed, u, pOverride, newtonOpts, 'rk4_stage1')
    const x2 = new Array(nx)
    for (let i = 0; i < nx; i++) x2[i] = x[i] + 0.5 * dt * s1.xDot[i]

    const s2 = solveFlowAtState(
      t + 0.5 * dt,
      x2,
      s1.y,
      s1.xDot,
      u,
      pOverride,
      newtonOpts,
      'rk4_stage2',
    )
    const x3 = new Array(nx)
    for (let i = 0; i < nx; i++) x3[i] = x[i] + 0.5 * dt * s2.xDot[i]

    const s3 = solveFlowAtState(
      t + 0.5 * dt,
      x3,
      s2.y,
      s2.xDot,
      u,
      pOverride,
      newtonOpts,
      'rk4_stage3',
    )
    const x4 = new Array(nx)
    for (let i = 0; i < nx; i++) x4[i] = x[i] + dt * s3.xDot[i]

    const s4 = solveFlowAtState(t + dt, x4, s3.y, s3.xDot, u, pOverride, newtonOpts, 'rk4_stage4')

    const xNext = new Array(nx)
    for (let i = 0; i < nx; i++) {
      xNext[i] = x[i] + (dt / 6) * (s1.xDot[i] + 2 * s2.xDot[i] + 2 * s3.xDot[i] + s4.xDot[i])
    }

    return {
      x: xNext,
      y: s4.y.slice(),
      xDot: s4.xDot.slice(),
    }
  }

  // ---------- Explicit RK45 (Dormand-Prince 5(4)) ----------
  function rk45Step(t, x, y, u, dt, pOverride, newtonOpts, xDotPrev) {
    const xDotSeed =
      Array.isArray(xDotPrev) && xDotPrev.length === nx ? xDotPrev.slice() : new Array(nx).fill(0)

    const s1 = solveFlowAtState(t, x, y, xDotSeed, u, pOverride, newtonOpts, 'rk45_stage1')

    const x2 = new Array(nx)
    for (let i = 0; i < nx; i++) x2[i] = x[i] + dt * ((1 / 5) * s1.xDot[i])
    const s2 = solveFlowAtState(
      t + dt * (1 / 5),
      x2,
      s1.y,
      s1.xDot,
      u,
      pOverride,
      newtonOpts,
      'rk45_stage2',
    )

    const x3 = new Array(nx)
    for (let i = 0; i < nx; i++) x3[i] = x[i] + dt * ((3 / 40) * s1.xDot[i] + (9 / 40) * s2.xDot[i])
    const s3 = solveFlowAtState(
      t + dt * (3 / 10),
      x3,
      s2.y,
      s2.xDot,
      u,
      pOverride,
      newtonOpts,
      'rk45_stage3',
    )

    const x4 = new Array(nx)
    for (let i = 0; i < nx; i++) {
      x4[i] = x[i] + dt * ((44 / 45) * s1.xDot[i] + (-56 / 15) * s2.xDot[i] + (32 / 9) * s3.xDot[i])
    }
    const s4 = solveFlowAtState(
      t + dt * (4 / 5),
      x4,
      s3.y,
      s3.xDot,
      u,
      pOverride,
      newtonOpts,
      'rk45_stage4',
    )

    const x5 = new Array(nx)
    for (let i = 0; i < nx; i++) {
      x5[i] =
        x[i] +
        dt *
          ((19372 / 6561) * s1.xDot[i] +
            (-25360 / 2187) * s2.xDot[i] +
            (64448 / 6561) * s3.xDot[i] +
            (-212 / 729) * s4.xDot[i])
    }
    const s5 = solveFlowAtState(
      t + dt * (8 / 9),
      x5,
      s4.y,
      s4.xDot,
      u,
      pOverride,
      newtonOpts,
      'rk45_stage5',
    )

    const x6 = new Array(nx)
    for (let i = 0; i < nx; i++) {
      x6[i] =
        x[i] +
        dt *
          ((9017 / 3168) * s1.xDot[i] +
            (-355 / 33) * s2.xDot[i] +
            (46732 / 5247) * s3.xDot[i] +
            (49 / 176) * s4.xDot[i] +
            (-5103 / 18656) * s5.xDot[i])
    }
    const s6 = solveFlowAtState(t + dt, x6, s5.y, s5.xDot, u, pOverride, newtonOpts, 'rk45_stage6')

    const x7 = new Array(nx)
    for (let i = 0; i < nx; i++) {
      x7[i] =
        x[i] +
        dt *
          ((35 / 384) * s1.xDot[i] +
            (500 / 1113) * s3.xDot[i] +
            (125 / 192) * s4.xDot[i] +
            (-2187 / 6784) * s5.xDot[i] +
            (11 / 84) * s6.xDot[i])
    }
    const s7 = solveFlowAtState(t + dt, x7, s6.y, s6.xDot, u, pOverride, newtonOpts, 'rk45_stage7')

    const x5th = x7
    const x4th = new Array(nx)
    for (let i = 0; i < nx; i++) {
      x4th[i] =
        x[i] +
        dt *
          ((5179 / 57600) * s1.xDot[i] +
            (7571 / 16695) * s3.xDot[i] +
            (393 / 640) * s4.xDot[i] +
            (-92097 / 339200) * s5.xDot[i] +
            (187 / 2100) * s6.xDot[i] +
            (1 / 40) * s7.xDot[i])
    }

    return {
      x: x5th.slice(),
      y: s7.y.slice(),
      xDot: s7.xDot.slice(),
      xEmbedded: x4th,
    }
  }
  // ---------- Simulation ----------
  function simulate(t0, tf, dt, opts) {
    opts = opts || {}
    const pOverride = opts.pOverride || null

    // solver options (merged with schema defaults)
    const solverOptions = Object.assign(
      {
        timeIntegrator: 'sdirk2',
        captureFailureState: false,
        newtonTol: 1e-8,
        newtonMaxIter: 12,
        jacEpsBase: 1e-6,
        initialGuessMinAbs: 1e-9,
        newtonLambda: 1e-6,
        maxUpdateFactor: 5,
        lineSearchBackoff: 0.5,
        lineSearchMinAlpha: 0.015625,
        lineSearchAcceptRatio: 0.999,
        initRetryCount: 5,
        initRetryMinAbsBase: 1e-9,
        initRetryLambdaScale: 100,
        initRetryMaxIterScale: 2,
        enableEventLocalization: true,
        eventTolTime: dt / 1024,
        maxEventBisectionIter: 40,
        eventIterationMaxIter: 8,
        maxEventsPerMacroStep: 16,
        rk45AbsTol: 1e-6,
        rk45RelTol: 1e-4,
        rk45Safety: 0.9,
        rk45MinFactor: 0.2,
        rk45MaxFactor: 5,
        rk45MinDt: dt / 1e6,
        adaptiveSubsteps: true,
        maxSubstepDepth: 6,
        minSubstepDt: dt / 128,
        includeEventSamples: true,
        eventSampleDedupTol: 0,
      },
      opts.solverOptions || {},
    )

    const newtonOpts = {
      tol: solverOptions.newtonTol,
      maxIter: solverOptions.newtonMaxIter,
      epsBase: solverOptions.jacEpsBase,
      initialGuessMinAbs: solverOptions.initialGuessMinAbs,
      lambda: solverOptions.newtonLambda,
      maxUpdateFactor: solverOptions.maxUpdateFactor,
      lineSearchBackoff: solverOptions.lineSearchBackoff,
      lineSearchMinAlpha: solverOptions.lineSearchMinAlpha,
      lineSearchAcceptRatio: solverOptions.lineSearchAcceptRatio,
    }
    const selectedIntegrator = String(
      solverOptions.timeIntegrator ?? solverOptions.integrator ?? 'sdirk2',
    ).toLowerCase()
    const useIrk4 = selectedIntegrator === 'irk4' || selectedIntegrator === 'gauss_legendre_irk4'
    const useRk4 = selectedIntegrator === 'rk4'
    const useRk45 = selectedIntegrator === 'rk45' || selectedIntegrator === 'dopri54'
    const stepperName = useIrk4 ? 'irk4' : useRk4 ? 'rk4' : useRk45 ? 'rk45' : 'sdirk2'
    const captureFailureState = Boolean(
      solverOptions.captureFailureState ?? opts.captureFailureState ?? false,
    )
    const initializeConsistently = Boolean(solverOptions.initializeConsistently ?? true)
    const adaptiveSubsteps = Boolean(solverOptions.adaptiveSubsteps ?? true)
    const includeEventSamples = Boolean(solverOptions.includeEventSamples ?? true)
    const eventSampleDedupTol = Number.isFinite(solverOptions.eventSampleDedupTol)
      ? Math.max(0, Number(solverOptions.eventSampleDedupTol))
      : 0
    const maxSubstepDepth = Number.isFinite(solverOptions.maxSubstepDepth)
      ? Math.max(0, Math.floor(solverOptions.maxSubstepDepth))
      : 6
    const minSubstepDt = Number.isFinite(solverOptions.minSubstepDt)
      ? Math.max(1e-9, solverOptions.minSubstepDt)
      : Math.max(1e-9, dt / 128)
    const enableEventLocalization = Boolean(solverOptions.enableEventLocalization ?? true)
    const eventTolTime = Number.isFinite(solverOptions.eventTolTime)
      ? Math.max(1e-12, solverOptions.eventTolTime)
      : Math.max(1e-9, dt / 1024)
    const maxEventBisectionIter = Number.isFinite(solverOptions.maxEventBisectionIter)
      ? Math.max(1, Math.floor(solverOptions.maxEventBisectionIter))
      : 40
    const eventIterationMaxIter = Number.isFinite(solverOptions.eventIterationMaxIter)
      ? Math.max(1, Math.floor(solverOptions.eventIterationMaxIter))
      : 8
    const maxEventsPerMacroStep = Number.isFinite(solverOptions.maxEventsPerMacroStep)
      ? Math.max(1, Math.floor(solverOptions.maxEventsPerMacroStep))
      : 16
    const rk45AbsTol = Number.isFinite(solverOptions.rk45AbsTol)
      ? Math.max(1e-14, solverOptions.rk45AbsTol)
      : 1e-6
    const rk45RelTol = Number.isFinite(solverOptions.rk45RelTol)
      ? Math.max(1e-14, solverOptions.rk45RelTol)
      : 1e-4
    const rk45Safety = Number.isFinite(solverOptions.rk45Safety)
      ? Math.min(0.99, Math.max(0.1, solverOptions.rk45Safety))
      : 0.9
    const rk45MinFactor = Number.isFinite(solverOptions.rk45MinFactor)
      ? Math.min(1, Math.max(0.01, solverOptions.rk45MinFactor))
      : 0.2
    const rk45MaxFactor = Number.isFinite(solverOptions.rk45MaxFactor)
      ? Math.max(1, solverOptions.rk45MaxFactor)
      : 5
    const rk45MinDt = Number.isFinite(solverOptions.rk45MinDt)
      ? Math.max(1e-14, solverOptions.rk45MinDt)
      : Math.max(1e-12, dt / 1e6)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const f_u = typeof opts.f_u === 'function' ? opts.f_u : (_t) => new Array(nu).fill(0)

    const nSteps = Math.max(1, Math.floor((tf - t0) / dt))
    const tArr = []
    const xArr = []
    const yArr = []
    const yOutArr = []
    const uArr = []
    const cArr = []
    const zArr = []
    const eventLog = []
    const solverStats = {
      runCount: 1,
      macroStepCount: 0,
      flowStepCalls: 0,
      rk45Attempts: 0,
      rk45Accepted: 0,
      rk45Rejected: 0,
      adaptiveRetryCount: 0,
      adaptiveSplitCount: 0,
      eventLocalizationCalls: 0,
      eventBisectionIterations: 0,
      eventIterationPasses: 0,
      eventCount: 0,
      eventSampleCount: 0,
      eventSampleSkippedDuplicates: 0,
      initAttempts: 0,
      initFailures: 0,
    }
    let stopReason = null
    let stopError = null
    let stopStack = null
    let stopDetails = null

    let t = t0
    let x = (opts.x0 || x0_model).slice()
    let y = y0_model.slice()
    let c = c0.slice()
    let xDotPrev = new Array(nx).fill(0)

    if (initializeConsistently) {
      const u0 = f_u(t) || new Array(nu).fill(0)
      const retryCount = Number.isFinite(solverOptions.initRetryCount)
        ? Math.max(1, Math.floor(solverOptions.initRetryCount))
        : 5
      const minAbsBase = Number.isFinite(solverOptions.initRetryMinAbsBase)
        ? Math.max(0, Math.abs(solverOptions.initRetryMinAbsBase))
        : 1e-9
      const lambdaScale = Number.isFinite(solverOptions.initRetryLambdaScale)
        ? Math.max(1, solverOptions.initRetryLambdaScale)
        : 100
      const maxIterScale = Number.isFinite(solverOptions.initRetryMaxIterScale)
        ? Math.max(1, solverOptions.initRetryMaxIterScale)
        : 2

      const initErrors = []
      let initSolved = false
      for (let attempt = 0; attempt < retryCount; attempt++) {
        solverStats.initAttempts += 1
        const minAbs = Math.max(minAbsBase, Math.pow(10, attempt - 9))
        const attemptOpts = Object.assign({}, newtonOpts, {
          initialGuessMinAbs:
            attempt === 0
              ? newtonOpts.initialGuessMinAbs
              : Math.max(minAbs, newtonOpts.initialGuessMinAbs || 0),
          lambda:
            attempt === 0
              ? newtonOpts.lambda
              : Math.max(
                  newtonOpts.lambda || 0,
                  (newtonOpts.lambda || 1e-6) * Math.pow(lambdaScale, attempt),
                ),
          maxIter:
            attempt === 0
              ? newtonOpts.maxIter
              : Math.max(
                  newtonOpts.maxIter || 12,
                  Math.floor((newtonOpts.maxIter || 12) * maxIterScale),
                ),
        })
        const yGuess = attempt === 0 ? y.slice() : regularizeGuessVector(y.slice(), attemptOpts)
        const xDotGuess =
          attempt === 0 ? xDotPrev.slice() : regularizeGuessVector(xDotPrev.slice(), attemptOpts)
        try {
          const init = solveFlowAtState(
            t,
            x,
            yGuess,
            xDotGuess,
            u0,
            pOverride,
            attemptOpts,
            `initial_consistent_state_attempt_${attempt + 1}`,
          )
          if (Array.isArray(init.y) && init.y.length === ny) y = init.y.slice()
          if (Array.isArray(init.xDot) && init.xDot.length === nx) xDotPrev = init.xDot.slice()
          initSolved = true
          break
        } catch (e) {
          solverStats.initFailures += 1
          const msg = (e && e.message) || String(e)
          initErrors.push(
            `attempt=${attempt + 1}, minAbs=${attemptOpts.initialGuessMinAbs}, lambda=${attemptOpts.lambda}, maxIter=${attemptOpts.maxIter}, error=${msg}`,
          )
        }
      }
      if (!initSolved) {
        const tailErrors = initErrors.slice(-3).join(' | ')
        log('Consistent initialization failed after retries', { initErrors })
        throw new Error(
          `Consistent initialization failed (stage=initial_consistent_state, t=${Number(t).toPrecision(8)}): ${tailErrors}`,
        )
      }

      if (haveEvents) {
        try {
          const cInit = model.evalConditions(t, x, y, u0, pOverride)
          if (Array.isArray(cInit)) c = cInit.slice()
        } catch {
          /* empty */
        }
      }
    }

    function conditionsChanged(cPrev, cNext) {
      const n = Math.max(
        Array.isArray(cPrev) ? cPrev.length : 0,
        Array.isArray(cNext) ? cNext.length : 0,
      )
      for (let i = 0; i < n; i++) {
        if (Boolean(cPrev?.[i]) !== Boolean(cNext?.[i])) return true
      }
      return false
    }

    function evalConditionsSafe(tLocal, xLocal, yLocal, uLocal, fallback) {
      if (!haveEvents) return Array.isArray(fallback) ? fallback.slice() : []
      try {
        const ce = model.evalConditions(tLocal, xLocal, yLocal, uLocal, pOverride)
        if (Array.isArray(ce)) return ce.slice()
      } catch (e) {
        log(`evalConditions threw at t=${tLocal}`, {
          error: (e && e.message) || String(e),
          stack: e && e.stack,
        })
      }
      return Array.isArray(fallback) ? fallback.slice() : []
    }
    function evalEventIndicatorsSafe(tLocal, xLocal, yLocal, uLocal, cLocal) {
      if (haveEventIndicators) {
        try {
          const zi = model.evalEventIndicators(tLocal, xLocal, yLocal, uLocal, pOverride)
          if (Array.isArray(zi)) {
            return zi.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
          }
        } catch (e) {
          log(`evalEventIndicators threw at t=${tLocal}`, {
            error: (e && e.message) || String(e),
            stack: e && e.stack,
          })
        }
      }
      const cSafe = Array.isArray(cLocal) ? cLocal : []
      return cSafe.map((v) => (v ? -1 : 1))
    }

    function applyResetsSafe(tLocal, xLocal, yLocal, uLocal, cPrev, cCurr) {
      let xNext = xLocal.slice()
      let yNext = yLocal.slice()
      let cNext = Array.isArray(cCurr) ? cCurr.slice() : []
      if (!haveEvents || !model.applyResets) return { xNext, yNext, cNext }
      try {
        const applied = model.applyResets(tLocal, xLocal, yLocal, uLocal, pOverride, cPrev, cCurr)
        if (applied?.x) xNext = applied.x.slice()
        if (applied?.y) yNext = applied.y.slice()
        if (applied?.c) cNext = applied.c.slice()
      } catch (e) {
        log(`applyResets threw at t=${tLocal}`, {
          error: (e && e.message) || String(e),
          stack: e && e.stack,
        })
      }
      return { xNext, yNext, cNext }
    }

    function performFlowStepOnce(tLocal, xLocal, yLocal, dtLocal, xDotSeed) {
      solverStats.flowStepCalls += 1
      const uLocal = f_u(tLocal) || new Array(nu).fill(0)
      const step = useIrk4
        ? irk4Step(tLocal, xLocal, yLocal, uLocal, dtLocal, pOverride, newtonOpts)
        : useRk4
          ? rk4Step(tLocal, xLocal, yLocal, uLocal, dtLocal, pOverride, newtonOpts, xDotSeed)
          : useRk45
            ? rk45Step(tLocal, xLocal, yLocal, uLocal, dtLocal, pOverride, newtonOpts, xDotSeed)
            : sdirk2Step(tLocal, xLocal, yLocal, uLocal, dtLocal, pOverride, newtonOpts)
      if (!step || !step.x || !step.y) throw new Error(`Invalid step payload at t=${tLocal}`)
      const xDotNext =
        Array.isArray(step.xDot) && step.xDot.length === nx
          ? step.xDot.slice()
          : step.x.map((xv, i) => (xv - xLocal[i]) / dtLocal)
      return {
        xNext: step.x.slice(),
        yNext: step.y.slice(),
        xDotNext,
        xEmbedded: Array.isArray(step.xEmbedded) ? step.xEmbedded.slice() : null,
      }
    }

    function advanceAdaptiveOnFailure(tLocal, xLocal, yLocal, dtLocal, xDotSeed, depth) {
      try {
        return performFlowStepOnce(tLocal, xLocal, yLocal, dtLocal, xDotSeed)
      } catch (e) {
        if (!adaptiveSubsteps || depth >= maxSubstepDepth || dtLocal * 0.5 < minSubstepDt) throw e
        solverStats.adaptiveRetryCount += 1
        solverStats.adaptiveSplitCount += 1
        const half = dtLocal * 0.5
        const a = advanceAdaptiveOnFailure(tLocal, xLocal, yLocal, half, xDotSeed, depth + 1)
        return advanceAdaptiveOnFailure(
          tLocal + half,
          a.xNext,
          a.yNext,
          half,
          a.xDotNext,
          depth + 1,
        )
      }
    }

    function rk45ErrorNorm(xOld, x5, x4) {
      let maxNorm = 0
      for (let i = 0; i < nx; i++) {
        const err = Math.abs(x5[i] - x4[i])
        const scale = rk45AbsTol + rk45RelTol * Math.max(Math.abs(xOld[i]), Math.abs(x5[i]))
        const n = scale > 0 ? err / scale : err
        if (n > maxNorm) maxNorm = n
      }
      return maxNorm
    }

    function advanceFlowInterval(tLocal, xLocal, yLocal, dtLocal, xDotSeed) {
      if (!useRk45) return advanceAdaptiveOnFailure(tLocal, xLocal, yLocal, dtLocal, xDotSeed, 0)
      const tEnd = tLocal + dtLocal
      let tCur = tLocal
      let xCur = xLocal.slice()
      let yCur = yLocal.slice()
      let xDotCur =
        Array.isArray(xDotSeed) && xDotSeed.length === nx ? xDotSeed.slice() : new Array(nx).fill(0)
      let h = Math.min(Math.max(rk45MinDt, dtLocal * 0.25), dtLocal)

      while (tCur < tEnd - 1e-15) {
        const remaining = tEnd - tCur
        if (h > remaining) h = remaining
        if (h < rk45MinDt) {
          throw new Error(
            `RK45 minimum step reached before interval end (t=${Number(tCur).toPrecision(8)}, remaining=${remaining})`,
          )
        }

        let attempt
        try {
          solverStats.rk45Attempts += 1
          attempt = performFlowStepOnce(tCur, xCur, yCur, h, xDotCur)
        } catch (e) {
          solverStats.rk45Rejected += 1
          h *= 0.5
          if (h < rk45MinDt) throw e
          continue
        }

        const err = attempt.xEmbedded ? rk45ErrorNorm(xCur, attempt.xNext, attempt.xEmbedded) : 0
        if (err <= 1 || h <= rk45MinDt) {
          solverStats.rk45Accepted += 1
          tCur += h
          xCur = attempt.xNext
          yCur = attempt.yNext
          xDotCur = attempt.xDotNext
          const factor = err > 0 ? rk45Safety * Math.pow(err, -0.2) : rk45MaxFactor
          const clipped = Math.min(rk45MaxFactor, Math.max(rk45MinFactor, factor))
          h = Math.min(remaining, Math.max(rk45MinDt, h * clipped))
        } else {
          solverStats.rk45Rejected += 1
          const factor = rk45Safety * Math.pow(err, -0.25)
          const clipped = Math.min(1, Math.max(rk45MinFactor, factor))
          h = Math.max(rk45MinDt, h * clipped)
        }
      }

      return { xNext: xCur, yNext: yCur, xDotNext: xDotCur }
    }

    function localizeEvent(tLeft, xLeft, yLeft, cLeft, xDotLeft, tRight, xRight, yRight, cRight) {
      solverStats.eventLocalizationCalls += 1
      let tl = tLeft
      let xl = xLeft.slice()
      let yl = yLeft.slice()
      let cl = cLeft.slice()
      let xDotL = Array.isArray(xDotLeft) ? xDotLeft.slice() : new Array(nx).fill(0)
      let tr = tRight
      let xr = xRight.slice()
      let yr = yRight.slice()
      let cr = cRight.slice()
      let xDotR = xDotL.slice()

      let bisectionIters = 0
      for (let iter = 0; iter < maxEventBisectionIter; iter++) {
        bisectionIters = iter + 1
        if (tr - tl <= eventTolTime) break
        const tm = 0.5 * (tl + tr)
        const mid = advanceFlowInterval(tl, xl, yl, tm - tl, xDotL)
        const uMid = f_u(tm) || new Array(nu).fill(0)
        const cm = evalConditionsSafe(tm, mid.xNext, mid.yNext, uMid, cl)

        if (conditionsChanged(cl, cm)) {
          tr = tm
          xr = mid.xNext
          yr = mid.yNext
          cr = cm
          xDotR = mid.xDotNext
        } else {
          tl = tm
          xl = mid.xNext
          yl = mid.yNext
          cl = cm
          xDotL = mid.xDotNext
        }
      }

      return {
        tEvent: tr,
        xEventPre: xr,
        yEventPre: yr,
        cLeft: cl,
        cRight: cr,
        xDotEventPre: xDotR,
        bisectionIters,
      }
    }

    function settleEventAtTime(tEvent, xEventPre, yEventPre, cPrevStep) {
      let xCurr = xEventPre.slice()
      let yCurr = yEventPre.slice()
      let cPrev = Array.isArray(cPrevStep) ? cPrevStep.slice() : []
      let cCurr = cPrev.slice()
      const uEvent = f_u(tEvent) || new Array(nu).fill(0)

      for (let iter = 0; iter < eventIterationMaxIter; iter++) {
        cCurr = evalConditionsSafe(tEvent, xCurr, yCurr, uEvent, cPrev)
        const applied = applyResetsSafe(tEvent, xCurr, yCurr, uEvent, cPrev, cCurr)
        const cAfter = evalConditionsSafe(
          tEvent,
          applied.xNext,
          applied.yNext,
          uEvent,
          applied.cNext,
        )

        xCurr = applied.xNext
        yCurr = applied.yNext

        if (!conditionsChanged(cPrev, cAfter)) {
          const iterations = iter + 1
          solverStats.eventIterationPasses += iterations
          return { x: xCurr, y: yCurr, c: cAfter, iterations }
        }
        cPrev = cAfter
      }
      solverStats.eventIterationPasses += eventIterationMaxIter
      return { x: xCurr, y: yCurr, c: cCurr, iterations: eventIterationMaxIter, clipped: true }
    }

    function advanceMacroStep(tLocal, xLocal, yLocal, cLocal, dtLocal, xDotSeed, stepIndex) {
      solverStats.macroStepCount += 1
      const tTarget = tLocal + dtLocal
      if (!haveEvents || !enableEventLocalization) {
        const flow = advanceFlowInterval(tLocal, xLocal, yLocal, dtLocal, xDotSeed)
        const uNext = f_u(tTarget) || new Array(nu).fill(0)
        const cEval = evalConditionsSafe(tTarget, flow.xNext, flow.yNext, uNext, cLocal)
        const applied = applyResetsSafe(tTarget, flow.xNext, flow.yNext, uNext, cLocal, cEval)
        return {
          xNext: applied.xNext,
          yNext: applied.yNext,
          cNext: applied.cNext,
          xDotNext: flow.xDotNext,
          eventSamples: [],
        }
      }

      let tCur = tLocal
      let xCur = xLocal.slice()
      let yCur = yLocal.slice()
      let cCur = cLocal.slice()
      let xDotCur =
        Array.isArray(xDotSeed) && xDotSeed.length === nx ? xDotSeed.slice() : new Array(nx).fill(0)
      let eventCount = 0
      const eventSamples = []
      let lastEventSampleTime = Number.NaN

      while (tCur < tTarget - 1e-15) {
        const remaining = tTarget - tCur
        const flow = advanceFlowInterval(tCur, xCur, yCur, remaining, xDotCur)
        const uEnd = f_u(tTarget) || new Array(nu).fill(0)
        const cEnd = evalConditionsSafe(tTarget, flow.xNext, flow.yNext, uEnd, cCur)
        if (!conditionsChanged(cCur, cEnd)) {
          xCur = flow.xNext
          yCur = flow.yNext
          cCur = cEnd
          xDotCur = flow.xDotNext
          tCur = tTarget
          break
        }

        if (eventCount >= maxEventsPerMacroStep) {
          throw new Error(
            `Exceeded maxEventsPerMacroStep=${maxEventsPerMacroStep} while localizing events at t=${Number(tCur).toPrecision(8)}`,
          )
        }

        const localized = localizeEvent(
          tCur,
          xCur,
          yCur,
          cCur,
          xDotCur,
          tTarget,
          flow.xNext,
          flow.yNext,
          cEnd,
        )
        if (localized.tEvent <= tCur + 1e-15) {
          throw new Error(
            `Event localization failed to progress (t=${Number(tCur).toPrecision(8)}, tEvent=${Number(localized.tEvent).toPrecision(8)})`,
          )
        }

        const settled = settleEventAtTime(
          localized.tEvent,
          localized.xEventPre,
          localized.yEventPre,
          localized.cLeft,
        )

        eventLog.push({
          stepIndex,
          time: localized.tEvent,
          iterations: settled.iterations,
          bisectionIters: localized.bisectionIters,
          clippedIterations: Boolean(settled.clipped),
          before: localized.cLeft.slice(),
          atDetection: localized.cRight.slice(),
          after: settled.c.slice(),
          indicatorsAtEvent: evalEventIndicatorsSafe(
            localized.tEvent,
            localized.xEventPre,
            localized.yEventPre,
            f_u(localized.tEvent) || new Array(nu).fill(0),
            settled.c,
          ),
        })

        tCur = localized.tEvent
        xCur = settled.x
        yCur = settled.y
        cCur = settled.c
        xDotCur = localized.xDotEventPre.slice()
        eventCount += 1
        solverStats.eventCount += 1
        solverStats.eventBisectionIterations += Number(localized.bisectionIters || 0)
        if (includeEventSamples) {
          const minDelta = Math.max(eventTolTime * 2, eventSampleDedupTol)
          const shouldInsert =
            !Number.isFinite(lastEventSampleTime) ||
            Math.abs(localized.tEvent - lastEventSampleTime) > minDelta
          if (shouldInsert) {
            eventSamples.push({
              time: localized.tEvent,
              x: settled.x.slice(),
              y: settled.y.slice(),
              c: settled.c.slice(),
            })
            lastEventSampleTime = localized.tEvent
          } else {
            solverStats.eventSampleSkippedDuplicates += 1
          }
        }
      }

      return { xNext: xCur, yNext: yCur, cNext: cCur, xDotNext: xDotCur, eventSamples }
    }

    function evaluateAlgebraicsAtSample(tLocal, xLocal, yLocal, uLocal) {
      if (haveAlgebraicEval) {
        try {
          const yEval = model.evalAlgebraics(tLocal, xLocal, yLocal, uLocal, pOverride)
          if (Array.isArray(yEval) && yEval.length === algebraicNames.length) {
            return yEval.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN))
          }
        } catch (e) {
          log(`evalAlgebraics threw at t=${tLocal}`, {
            error: (e && e.message) || String(e),
            stack: e && e.stack,
          })
        }
      }
      const out = new Array(algebraicNames.length).fill(Number.NaN)
      const n = Math.min(out.length, Array.isArray(yLocal) ? yLocal.length : 0)
      for (let i = 0; i < n; i++) {
        const v = yLocal[i]
        out[i] = typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN
      }
      return out
    }

    log('Simulation started', { t0, tf, dt, nx, ny, nu, haveEvents })
    const appendOutputSample = (tSample, xSample, ySample, uSample, cSample) => {
      tArr.push(tSample)
      xArr.push(xSample.slice())
      yArr.push(ySample.slice())
      yOutArr.push(evaluateAlgebraicsAtSample(tSample, xSample, ySample, uSample))
      uArr.push(uSample.slice())
      cArr.push(cSample.slice())
      zArr.push(evalEventIndicatorsSafe(tSample, xSample, ySample, uSample, cSample))
    }

    for (let k = 0; k <= nSteps; k++) {
      const u = f_u(t) || new Array(nu).fill(0)

      appendOutputSample(t, x, y, u, c)

      if (k === nSteps) break

      try {
        const advanced = advanceMacroStep(t, x, y, c, dt, xDotPrev, k)
        if (Array.isArray(advanced.eventSamples) && advanced.eventSamples.length > 0) {
          for (const sample of advanced.eventSamples) {
            const tSample = Number(sample?.time)
            if (!Number.isFinite(tSample) || tSample <= t + 1e-15 || tSample >= t + dt - 1e-15) {
              continue
            }
            const xSample = Array.isArray(sample?.x) ? sample.x : x
            const ySample = Array.isArray(sample?.y) ? sample.y : y
            const cSample = Array.isArray(sample?.c) ? sample.c : c
            const uSample = f_u(tSample) || new Array(nu).fill(0)
            appendOutputSample(tSample, xSample, ySample, uSample, cSample)
            solverStats.eventSampleCount += 1
          }
        }
        t += dt
        x = advanced.xNext
        y = advanced.yNext
        c = advanced.cNext
        xDotPrev = advanced.xDotNext
      } catch (e) {
        stopReason = `${stepperName}Step_failed`
        stopError = (e && e.message) || String(e)
        stopStack = e && e.stack ? String(e.stack) : null
        const missingSymbol = /([A-Za-z_$][A-Za-z0-9_$]*) is not defined/.exec(String(stopError))
        stopDetails = {
          stepIndex: k,
          time: t,
          dt,
          nx,
          ny,
          nu,
          xHead: x.slice(0, Math.min(3, x.length)),
          yHead: y.slice(0, Math.min(3, y.length)),
          uHead: u.slice(0, Math.min(3, u.length)),
          missingSymbol: missingSymbol ? missingSymbol[1] : null,
          solverStatsSnapshot: {
            ...solverStats,
            eventCount: eventLog.length,
          },
        }
        if (captureFailureState) {
          stopDetails.failureState = {
            stage: 'time_step',
            time: t,
            stepIndex: k,
            x: x.slice(),
            y: y.slice(),
            u: u.slice(),
            c: c.slice(),
            stateNames: stateNames.slice(),
            algebraicNames: solverAlgebraicNames.slice(),
            inputNames: inputNames.slice(),
            conditionNames: conditionNames.slice(),
          }
        }
        log(`${stepperName.toUpperCase()} step failed at t=${t}`, {
          error: (e && e.message) || String(e),
          stack: e && e.stack,
        })
        break
      }
    }

    log('Simulation finished', { nSamples: tArr.length })
    return {
      t: tArr,
      x: xArr,
      y: yArr,
      yObserved: yOutArr,
      u: uArr,
      c: cArr,
      z: zArr,
      eventLog,
      solverStats: {
        ...solverStats,
        eventCount: eventLog.length,
      },
      stopReason,
      stopError,
      stopStack,
      stopDetails,
    }
  }

  // ---------- Run ----------
  const sim = params?.sim || {}
  const raw = simulate(sim.t0 ?? 0, sim.tf ?? 5, sim.dt ?? 0.1, {
    x0: sim.x0,
    f_u: sim.f_u,
    solverOptions: sim.solverOptions,
  })

  const expectRows = (rows, width, label) => {
    if (!Array.isArray(rows)) {
      throw new Error(`Simulation result shape invalid: ${label} is not an array`)
    }
    if (rows.length !== raw.t.length) {
      throw new Error(
        `Simulation result shape invalid: ${label}.length=${rows.length} does not match t.length=${raw.t.length}`,
      )
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (!Array.isArray(row)) {
        throw new Error(`Simulation result shape invalid: ${label}[${i}] is not an array`)
      }
      if (row.length !== width) {
        throw new Error(
          `Simulation result shape invalid: ${label}[${i}].length=${row.length}, expected ${width}`,
        )
      }
    }
  }

  expectRows(raw.x, nx, 'x')
  expectRows(raw.y, ny, 'y')
  expectRows(raw.yObserved, algebraicNames.length, 'yObserved')
  expectRows(raw.u, nu, 'u')
  expectRows(raw.c, conditionNames.length, 'c')
  expectRows(raw.z, conditionNames.length, 'z')

  const projectSeries = (rows, names) =>
    Object.fromEntries(
      names.map((n, i) => [
        n,
        rows.map((r) => {
          const v = r[i]
          return typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN
        }),
      ]),
    )
  const projectConditionSeries = (rows, names) =>
    Object.fromEntries(
      names.map((n, i) => [
        n,
        rows.map((r) => {
          const v = r[i]
          if (typeof v === 'boolean') return v
          if (typeof v === 'number' && Number.isFinite(v)) return v !== 0
          return null
        }),
      ]),
    )

  // Return ONLY structured-cloneable data.
  // Never return the full `context` object because it may contain functions
  // (e.g. context.log), which would break postMessage structured cloning.
  const contextInfo = {
    source: context?.source,
    compiledAt: context?.compiledAt,
    runId: context?.__rumocaRunId ?? context?.runId,
  }

  return {
    meta: {
      t0: sim.t0 ?? 0,
      tf: sim.tf ?? 5,
      dt: sim.dt ?? 0.1,
      nSteps: raw.t.length,
      events: raw.eventLog || [],
      solverStats: raw.solverStats || null,
      stopReason: raw.stopReason,
      stopError: raw.stopError,
      stopStack: raw.stopStack,
      stopDetails: raw.stopDetails,
      model: {
        name: model.name || meta.name || 'UnnamedModel',
        stateNames,
        inputNames,
        algebraicNames,
        solverAlgebraicNames,
        conditionNames,
        stateVariables,
        algebraicVariables,
        inputVariables,
        conditionVariables,
      },
      context: contextInfo,
    },
    data: {
      t: raw.t,
      x: projectSeries(raw.x, stateNames),
      y: projectSeries(raw.yObserved, algebraicNames),
      u: projectSeries(raw.u, inputNames),
      c: projectSeries(raw.z, conditionNames),
      cBoolean: projectConditionSeries(raw.c, conditionNames),
      z: projectSeries(raw.z, conditionNames),
      eventTimes: Array.isArray(raw.eventLog) ? raw.eventLog.map((e) => e.time) : [],
    },
  }
}

// -------------------------------------------------------------------------------------------------
// Solver self-description (minimal FMI-like)
// -------------------------------------------------------------------------------------------------
// Default simulation parameter values (used by generic UI)
simulateModel.simDefaults = {
  t0: 0,
  tf: 5,
  dt: 0.01,
}

// JSON schema describing solver options (beyond t0/tf/dt)
simulateModel.optionsSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    timeIntegrator: {
      type: 'string',
      enum: ['sdirk2', 'irk4', 'rk4', 'rk45'],
      default: 'sdirk2',
      description:
        'Time integration method: SDIRK2 (robust default), IRK4 (implicit Gauss-Legendre), RK4 (explicit), RK45 (Dormand-Prince explicit adaptive)',
    },
    captureFailureState: {
      type: 'boolean',
      default: false,
      description: 'Include full model state in meta.stopDetails when a timestep fails',
    },
    newtonTol: { type: 'number', default: 1e-8, description: 'Newton solver tolerance' },
    newtonMaxIter: {
      type: 'integer',
      default: 12,
      description: 'Maximum Newton iterations per stage',
    },
    jacEpsBase: {
      type: 'number',
      default: 1e-6,
      description: 'Finite difference epsilon base used for numerical Jacobian',
    },
    initialGuessMinAbs: {
      type: 'number',
      default: 1e-9,
      description:
        'Minimum absolute value for Newton initial guess entries (avoids singular zero-denominator starts)',
    },
    newtonLambda: {
      type: 'number',
      default: 1e-6,
      description: 'Damping lambda used in normal-equation least-squares Newton step',
    },
    maxUpdateFactor: {
      type: 'number',
      default: 5,
      description: 'Per-variable Newton update limit: |delta_i| <= factor * (1 + |z_i|)',
    },
    lineSearchBackoff: {
      type: 'number',
      default: 0.5,
      description: 'Backtracking factor for Newton line search',
    },
    lineSearchMinAlpha: {
      type: 'number',
      default: 0.015625,
      description: 'Minimum line-search step size alpha',
    },
    lineSearchAcceptRatio: {
      type: 'number',
      default: 0.999,
      description: 'Accept update when residual_inf(new) <= ratio * residual_inf(old)',
    },
    initializeConsistently: {
      type: 'boolean',
      default: true,
      description: 'Run a Newton consistent-initialization solve for xDot and algebraics at t0',
    },
    enableEventLocalization: {
      type: 'boolean',
      default: true,
      description: 'Localize event times by bisection and apply resets at localized event time',
    },
    eventTolTime: {
      type: 'number',
      default: 0.00001,
      description: 'Event localization time tolerance',
    },
    maxEventBisectionIter: {
      type: 'integer',
      default: 40,
      description: 'Maximum bisection iterations used to localize each event',
    },
      eventIterationMaxIter: {
      type: 'integer',
      default: 8,
      description: 'Maximum event-iteration passes at a single localized event instant',
    },
    includeEventSamples: {
      type: 'boolean',
      default: true,
      description:
        'Insert localized event times into output series (t/x/y/u/c) so event turnarounds are visible even for coarse dt',
    },
    eventSampleDedupTol: {
      type: 'number',
      default: 0,
      description:
        'Additional time tolerance for coalescing near-duplicate event samples (helps avoid clustered touch/release duplicates)',
    },
    maxEventsPerMacroStep: {
      type: 'integer',
      default: 16,
      description: 'Maximum number of localized events handled within a single output step',
    },
    rk45AbsTol: {
      type: 'number',
      default: 1e-6,
      description: 'Absolute error tolerance for RK45 adaptive step control',
    },
    rk45RelTol: {
      type: 'number',
      default: 1e-4,
      description: 'Relative error tolerance for RK45 adaptive step control',
    },
    rk45Safety: {
      type: 'number',
      default: 0.9,
      description: 'Safety factor for RK45 step-size updates',
    },
    rk45MinFactor: {
      type: 'number',
      default: 0.2,
      description: 'Minimum multiplicative factor when RK45 shrinks/grows internal step size',
    },
    rk45MaxFactor: {
      type: 'number',
      default: 5,
      description: 'Maximum multiplicative factor when RK45 grows internal step size',
    },
    rk45MinDt: {
      type: 'number',
      default: 1e-9,
      description: 'Minimum RK45 internal step size',
    },
    adaptiveSubsteps: {
      type: 'boolean',
      default: true,
      description: 'On step failure, retry with recursive dt/2 substeps',
    },
    maxSubstepDepth: {
      type: 'integer',
      default: 6,
      description: 'Maximum recursive bisection depth for adaptive substeps',
    },
    minSubstepDt: {
      type: 'number',
      default: 0.001,
      description: 'Minimum allowed dt when adaptive substepping is enabled',
    },
  },
}

simulateModel.contract = {
  id: 'rumoca.modelica_solver.v1',
  version: 1,
  simDefaults: simulateModel.simDefaults,
  optionsSchema: simulateModel.optionsSchema,
}
