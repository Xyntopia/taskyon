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
  const inputNames = (meta.inputs || []).map((u) => u.name)
  const conditionNames = (meta.conditions || []).map((c) => c.name)

  const nx = Array.isArray(model.x0) ? model.x0.length : 0
  const ny = Array.isArray(model.y0) ? model.y0.length : 0
  const nu = inputNames.length

  const haveEvents =
    typeof model.evalConditions === 'function' && typeof model.applyResets === 'function'

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
    const M = A.map((r) => r.slice())
    const x = b.slice()

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
      if (maxVal === 0) throw new Error('Singular matrix')

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
      x[i] = s / M[i][i]
    }

    return x
  }

  // ---------- Newton solver ----------
  function newtonSolve(residualFn, z0, newtonOpts) {
    const maxIter = Number.isFinite(newtonOpts?.maxIter) ? newtonOpts.maxIter : 12
    const tol = Number.isFinite(newtonOpts?.tol) ? newtonOpts.tol : 1e-8
    const epsBase = Number.isFinite(newtonOpts?.epsBase) ? newtonOpts.epsBase : 1e-6

    const n = z0.length
    let z = z0.slice()

    for (let iter = 0; iter < maxIter; iter++) {
      const r = residualFn(z)

      let maxAbs = 0
      for (let i = 0; i < n; i++) maxAbs = Math.max(maxAbs, Math.abs(r[i]))
      if (maxAbs < tol) return z

      const J = Array.from({ length: n }, () => new Array(n).fill(0))

      for (let j = 0; j < n; j++) {
        const zj = z[j]
        const eps = epsBase * (1 + Math.abs(zj))
        z[j] = zj + eps
        const rp = residualFn(z)
        z[j] = zj
        for (let i = 0; i < n; i++) {
          J[i][j] = (rp[i] - r[i]) / eps
        }
      }

      const delta = solveLinearSystem(
        J,
        r.map((v) => -v),
      )
      for (let i = 0; i < n; i++) z[i] += delta[i]
    }

    return z
  }

  // ---------- Backward-Euler-like stage ----------
  function implicitStage(tStage, xBase, yGuess, u, dtStage, pOverride, newtonOpts) {
    const z0 = xBase.concat(yGuess)

    function residual(z) {
      const xS = z.slice(0, nx)
      const yS = z.slice(nx)

      const xDot = new Array(nx)
      for (let i = 0; i < nx; i++) {
        xDot[i] = (xS[i] - xBase[i]) / dtStage
      }

      return model.residual(tStage, xS, xDot, yS, u, pOverride)
    }

    const sol = newtonSolve(residual, z0, newtonOpts)
    return {
      x: sol.slice(0, nx),
      y: sol.slice(nx),
    }
  }

  // ---------- SDIRK-2 (Alexander) ----------
  function sdirk2Step(t, x, y, u, dt, pOverride, newtonOpts) {
    const gamma = 1 - 1 / Math.sqrt(2)

    // ---- Stage 1 ----
    const stage1 = implicitStage(t + gamma * dt, x, y, u, gamma * dt, pOverride, newtonOpts)

    // ---- Stage 2 ----
    const z0 = stage1.x.concat(stage1.y)

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

    const sol2 = newtonSolve(residualStage2, z0, newtonOpts)

    return {
      x: sol2.slice(0, nx),
      y: sol2.slice(nx),
    }
  }
  // ---------- Simulation ----------
  function simulate(t0, tf, dt, opts) {
    opts = opts || {}
    const pOverride = opts.pOverride || null

    // solver options (merged with schema defaults)
    const solverOptions = Object.assign(
      {
        newtonTol: 1e-8,
        newtonMaxIter: 12,
        jacEpsBase: 1e-6,
      },
      opts.solverOptions || {},
    )

    const newtonOpts = {
      tol: solverOptions.newtonTol,
      maxIter: solverOptions.newtonMaxIter,
      epsBase: solverOptions.jacEpsBase,
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const f_u = typeof opts.f_u === 'function' ? opts.f_u : (_t) => new Array(nu).fill(0)

    const nSteps = Math.max(1, Math.floor((tf - t0) / dt))
    const tArr = []
    const xArr = []
    const yArr = []
    const uArr = []
    const cArr = []

    let t = t0
    let x = (opts.x0 || x0_model).slice()
    let y = y0_model.slice()
    let c = c0.slice()

    log('Simulation started', { t0, tf, dt, nx, ny, nu, haveEvents })

    for (let k = 0; k <= nSteps; k++) {
      const u = f_u(t) || new Array(nu).fill(0)

      tArr.push(t)
      xArr.push(x.slice())
      yArr.push(y.slice())
      uArr.push(u.slice())
      cArr.push(c.slice())

      if (k === nSteps) break

      let step
      try {
        step = sdirk2Step(t, x, y, u, dt, pOverride, newtonOpts)
      } catch (e) {
        log(`SDIRK step failed at t=${t}`, {
          error: (e && e.message) || String(e),
          stack: e && e.stack,
        })
        break
      }

      if (!step || !step.x || !step.y) {
        log(`SDIRK step returned invalid data at t=${t}`, { step })
        break
      }

      let xNext = step.x
      let yNext = step.y
      let cNext = c.slice()

      if (haveEvents) {
        const uNext = f_u(t + dt) || new Array(nu).fill(0)
        const cPrev = c.slice()
        let cCurr = cPrev.slice()

        try {
          const ce = model.evalConditions(t + dt, xNext, yNext, uNext, pOverride)
          if (Array.isArray(ce)) cCurr = ce.slice()
        } catch (e) {
          log(`evalConditions threw at t=${t + dt}`, {
            error: (e && e.message) || String(e),
            stack: e && e.stack,
          })
        }

        try {
          const applied = model.applyResets
            ? model.applyResets(t + dt, xNext, yNext, uNext, pOverride, cPrev, cCurr)
            : null

          if (applied?.x) xNext = applied.x.slice()
          if (applied?.y) yNext = applied.y.slice()
          if (applied?.c) cNext = applied.c.slice()
        } catch (e) {
          log(`applyResets threw at t=${t + dt}`, {
            error: (e && e.message) || String(e),
            stack: e && e.stack,
          })
        }
      }

      t += dt
      x = xNext
      y = yNext
      c = cNext
    }

    log('Simulation finished', { nSamples: tArr.length })
    return { t: tArr, x: xArr, y: yArr, u: uArr, c: cArr }
  }

  // ---------- Run ----------
  const sim = params?.sim || {}
  const raw = simulate(sim.t0 ?? 0, sim.tf ?? 5, sim.dt ?? 0.1, {
    x0: sim.x0,
    f_u: sim.f_u,
    solverOptions: sim.solverOptions,
  })

  // Return ONLY structured-cloneable data.
  // Never return the full `context` object because it may contain functions
  // (e.g. context.log), which would break postMessage structured cloning.
  const contextInfo = {
    source: context?.source,
    compiledAt: context?.compiledAt,
    runId: context?.__taskyonRunId ?? context?.runId,
  }

  return {
    meta: {
      t0: sim.t0 ?? 0,
      tf: sim.tf ?? 5,
      dt: sim.dt ?? 0.1,
      nSteps: raw.t.length,
      model: {
        name: model.name || meta.name || 'UnnamedModel',
        stateNames,
        inputNames,
        algebraicNames,
        conditionNames,
      },
      context: contextInfo,
    },
    data: {
      t: raw.t,
      x: Object.fromEntries(stateNames.map((n, i) => [n, raw.x.map((r) => r[i])])),
      y: Object.fromEntries(algebraicNames.map((n, i) => [n, raw.y.map((r) => r[i])])),
      u: Object.fromEntries(inputNames.map((n, i) => [n, raw.u.map((r) => r[i])])),
      c: Object.fromEntries(conditionNames.map((n, i) => [n, raw.c.map((r) => r[i])])),
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
  },
}
