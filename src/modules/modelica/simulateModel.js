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

  const nx = Array.isArray(model.x0) ? model.x0.length : 0
  const ny = Array.isArray(model.y0) ? model.y0.length : 0
  const nu = inputNames.length

  const haveEvents =
    typeof model.evalConditions === 'function' && typeof model.applyResets === 'function'
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
    const xDotSeed = Array.isArray(xDotPrev) && xDotPrev.length === nx ? xDotPrev.slice() : new Array(nx).fill(0)

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

    const s4 = solveFlowAtState(
      t + dt,
      x4,
      s3.y,
      s3.xDot,
      u,
      pOverride,
      newtonOpts,
      'rk4_stage4',
    )

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
        adaptiveSubsteps: true,
        maxSubstepDepth: 6,
        minSubstepDt: dt / 128,
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
    const stepperName = useIrk4 ? 'irk4' : useRk4 ? 'rk4' : 'sdirk2'
    const captureFailureState = Boolean(
      solverOptions.captureFailureState ?? opts.captureFailureState ?? false,
    )
    const initializeConsistently = Boolean(solverOptions.initializeConsistently ?? true)
    const adaptiveSubsteps = Boolean(solverOptions.adaptiveSubsteps ?? true)
    const maxSubstepDepth = Number.isFinite(solverOptions.maxSubstepDepth)
      ? Math.max(0, Math.floor(solverOptions.maxSubstepDepth))
      : 6
    const minSubstepDt = Number.isFinite(solverOptions.minSubstepDt)
      ? Math.max(1e-9, solverOptions.minSubstepDt)
      : Math.max(1e-9, dt / 128)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const f_u = typeof opts.f_u === 'function' ? opts.f_u : (_t) => new Array(nu).fill(0)

    const nSteps = Math.max(1, Math.floor((tf - t0) / dt))
    const tArr = []
    const xArr = []
    const yArr = []
    const yOutArr = []
    const uArr = []
    const cArr = []
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
        const minAbs = Math.max(minAbsBase, Math.pow(10, attempt - 9))
        const attemptOpts = Object.assign({}, newtonOpts, {
          initialGuessMinAbs:
            attempt === 0
              ? newtonOpts.initialGuessMinAbs
              : Math.max(minAbs, newtonOpts.initialGuessMinAbs || 0),
          lambda:
            attempt === 0
              ? newtonOpts.lambda
              : Math.max(newtonOpts.lambda || 0, (newtonOpts.lambda || 1e-6) * Math.pow(lambdaScale, attempt)),
          maxIter:
            attempt === 0
              ? newtonOpts.maxIter
              : Math.max(newtonOpts.maxIter || 12, Math.floor((newtonOpts.maxIter || 12) * maxIterScale)),
        })
        const yGuess =
          attempt === 0 ? y.slice() : regularizeGuessVector(y.slice(), attemptOpts)
        const xDotGuess =
          attempt === 0
            ? xDotPrev.slice()
            : regularizeGuessVector(xDotPrev.slice(), attemptOpts)
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

    function performSingleStep(tLocal, xLocal, yLocal, cLocal, dtLocal, xDotSeed) {
      const uLocal = f_u(tLocal) || new Array(nu).fill(0)
      const step = useIrk4
        ? irk4Step(tLocal, xLocal, yLocal, uLocal, dtLocal, pOverride, newtonOpts)
        : useRk4
          ? rk4Step(tLocal, xLocal, yLocal, uLocal, dtLocal, pOverride, newtonOpts, xDotSeed)
          : sdirk2Step(tLocal, xLocal, yLocal, uLocal, dtLocal, pOverride, newtonOpts)
      if (!step || !step.x || !step.y) {
        throw new Error(`Invalid step payload at t=${tLocal}`)
      }

      let xNext = step.x
      let yNext = step.y
      let cNext = Array.isArray(cLocal) ? cLocal.slice() : []

      if (haveEvents) {
        const uNext = f_u(tLocal + dtLocal) || new Array(nu).fill(0)
        const cPrev = Array.isArray(cLocal) ? cLocal.slice() : []
        let cCurr = cPrev.slice()

        try {
          const ce = model.evalConditions(tLocal + dtLocal, xNext, yNext, uNext, pOverride)
          if (Array.isArray(ce)) cCurr = ce.slice()
        } catch (e) {
          log(`evalConditions threw at t=${tLocal + dtLocal}`, {
            error: (e && e.message) || String(e),
            stack: e && e.stack,
          })
        }

        try {
          const applied = model.applyResets
            ? model.applyResets(tLocal + dtLocal, xNext, yNext, uNext, pOverride, cPrev, cCurr)
            : null

          if (applied?.x) xNext = applied.x.slice()
          if (applied?.y) yNext = applied.y.slice()
          if (applied?.c) cNext = applied.c.slice()
        } catch (e) {
          log(`applyResets threw at t=${tLocal + dtLocal}`, {
            error: (e && e.message) || String(e),
            stack: e && e.stack,
          })
        }
      }

      const xDotNext =
        Array.isArray(step.xDot) && step.xDot.length === nx
          ? step.xDot.slice()
          : xNext.map((xv, i) => (xv - xLocal[i]) / dtLocal)

      return { xNext, yNext, cNext, xDotNext }
    }

    function evaluateAlgebraicsAtSample(tLocal, xLocal, yLocal, uLocal) {
      if (haveAlgebraicEval) {
        try {
          const yEval = model.evalAlgebraics(tLocal, xLocal, yLocal, uLocal, pOverride)
          if (Array.isArray(yEval) && yEval.length === algebraicNames.length) {
            return yEval.map((v) =>
              typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN,
            )
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

    function advanceAdaptive(tLocal, xLocal, yLocal, cLocal, dtLocal, xDotSeed, depth) {
      try {
        return performSingleStep(tLocal, xLocal, yLocal, cLocal, dtLocal, xDotSeed)
      } catch (e) {
        if (!adaptiveSubsteps || depth >= maxSubstepDepth || dtLocal * 0.5 < minSubstepDt) {
          throw e
        }
        const half = dtLocal * 0.5
        const a = advanceAdaptive(tLocal, xLocal, yLocal, cLocal, half, xDotSeed, depth + 1)
        return advanceAdaptive(tLocal + half, a.xNext, a.yNext, a.cNext, half, a.xDotNext, depth + 1)
      }
    }

    log('Simulation started', { t0, tf, dt, nx, ny, nu, haveEvents })

    for (let k = 0; k <= nSteps; k++) {
      const u = f_u(t) || new Array(nu).fill(0)

      tArr.push(t)
      xArr.push(x.slice())
      yArr.push(y.slice())
      yOutArr.push(evaluateAlgebraicsAtSample(t, x, y, u))
      uArr.push(u.slice())
      cArr.push(c.slice())

      if (k === nSteps) break

      try {
        const advanced = advanceAdaptive(t, x, y, c, dt, xDotPrev, 0)
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
      },
      context: contextInfo,
    },
    data: {
      t: raw.t,
      x: projectSeries(raw.x, stateNames),
      y: projectSeries(raw.yObserved, algebraicNames),
      u: projectSeries(raw.u, inputNames),
      c: projectSeries(raw.c, conditionNames),
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
      enum: ['sdirk2', 'irk4', 'rk4'],
      default: 'sdirk2',
      description:
        'Time integration method: SDIRK2 (robust default), IRK4 (implicit Gauss-Legendre), RK4 (explicit)',
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
