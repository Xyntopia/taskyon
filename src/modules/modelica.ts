import rumocaWasmUrl from 'rumoca/rumoca_bg.wasm?url'
import type * as WasmTypes from 'rumoca'
export type RumocaModule = typeof WasmTypes

// ---------- WASM loading ----------
export const loadWasm = async () => {
  const wasmModule = await import('rumoca')

  // wasm-bindgen init (loads .wasm)
  if (typeof wasmModule.default === 'function') {
    // default() may take an optional input, but we let it auto-detect
    await wasmModule.default(rumocaWasmUrl)
  }

  // Try to initialize Rayon thread pool, but do NOT treat failure as fatal
  if ('wasm_init' in wasmModule && typeof wasmModule.wasm_init === 'function') {
    try {
      // Using 1 thread here; errors are swallowed – we fall back to single-threaded behavior.
      await wasmModule.wasm_init(1)
    } catch (e) {
      console.warn('Rumoca wasm_init (thread pool) failed – continuing in single-threaded mode:', e)
    }
  }
  return wasmModule as RumocaModule
}

// ---------- Build iframe function code ----------
export const buildIframeCode = (compiledJs: string): string => {
  const wrapped = `
  (params, context) => {
    ${compiledJs}

    const model = Model();
    const meta = model.meta || {};

    const stateNames     = (meta.states     || []).map(s => s.name);
    const algebraicNames = (meta.algebraics || []).map(a => a.name);
    const inputNames     = (meta.inputs     || []).map(u => u.name);
    const conditionNames = (meta.conditions || []).map(c => c.name);

    const nx = Array.isArray(model.x0) ? model.x0.length : 0;
    const ny = Array.isArray(model.y0) ? model.y0.length : 0;
    const nu = inputNames.length;

    // Detect whether we have event support
    const haveEvents =
      typeof model.evalConditions === "function" &&
      typeof model.applyResets   === "function";

    // ---------- Utility: safe array clone ----------
    function cloneArray(a, nDefault) {
      if (Array.isArray(a)) return a.slice();
      if (typeof nDefault === "number" && nDefault > 0) {
        return new Array(nDefault).fill(0);
      }
      return [];
    }

    // ---------- Infer / initialize conditions ----------
    // Try to get initial x, y and u for probing
    const x0_model = Array.isArray(model.x0) ? model.x0.slice() : new Array(nx).fill(0);
    const y0_model = Array.isArray(model.y0) ? model.y0.slice() : new Array(ny).fill(0);
    const u0_zero  = new Array(nu).fill(0);

    let c0 = Array.isArray(model.c0) ? model.c0.slice() : null;
    if (!c0 && haveEvents) {
      try {
        const cProbe = model.evalConditions(0, x0_model, y0_model, u0_zero, null);
        if (Array.isArray(cProbe)) {
          c0 = cProbe.slice();
        }
      } catch (e) {
        console.warn("evalConditions at t0 failed while probing:", e);
      }
    }
    if (!c0) {
      c0 = new Array(conditionNames.length || 0).fill(false);
    }
    const nc = c0.length;

    // ---------- Core: evaluate residual given z = [xDot; y] ----------
    function evalResidualWithZ(t, x, u, z, pOverride) {
      const xDot = z.slice(0, nx);
      const y    = z.slice(nx);
      return model.residual(t, x, xDot, y, u, pOverride);
    }

    // ---------- Linear solver: square system via Gaussian elimination ----------
    function solveLinearSystem(A, b) {
      // A: n x n, b: length n
      const n = A.length;
      const M = new Array(n);
      for (let i = 0; i < n; i++) {
        M[i] = A[i].slice();
      }
      const x = b.slice();

      for (let k = 0; k < n; k++) {
        // Pivot
        let maxRow = k;
        let maxVal = Math.abs(M[k][k]);
        for (let i = k + 1; i < n; i++) {
          const val = Math.abs(M[i][k]);
          if (val > maxVal) {
            maxVal = val;
            maxRow = i;
          }
        }
        if (maxVal === 0) {
          throw new Error("Singular matrix in solveLinearSystem");
        }
        if (maxRow !== k) {
          const tmpRow = M[k]; M[k] = M[maxRow]; M[maxRow] = tmpRow;
          const tmpB   = x[k]; x[k] = x[maxRow]; x[maxRow] = tmpB;
        }

        // Eliminate
        const pivot = M[k][k];
        for (let i = k + 1; i < n; i++) {
          const factor = M[i][k] / pivot;
          x[i] -= factor * x[k];
          for (let j = k; j < n; j++) {
            M[i][j] -= factor * M[k][j];
          }
        }
      }

      // Back-substitution
      for (let i = n - 1; i >= 0; i--) {
        let s = x[i];
        for (let j = i + 1; j < n; j++) {
          s -= M[i][j] * x[j];
        }
        x[i] = s / M[i][i];
      }

      return x;
    }

    // ---------- Generic implicit solve: F(t, x, xDot, y, u, p) = 0 for (xDot, y) ----------
    function solveDerivativesAndAlgebraics(t, x, u, yInit, pOverride) {
      const nVars = nx + ny;
      if (nVars === 0) {
        return { xDot: [], y: [] };
      }

      // Initial guess: xDot = 0, y = yInit or model.y0 or zeros
      const z = new Array(nVars);
      for (let i = 0; i < nx; i++) {
        z[i] = 0;
      }
      let yGuess;
      if (Array.isArray(yInit) && yInit.length === ny) {
        yGuess = yInit.slice();
      } else if (Array.isArray(model.y0) && model.y0.length === ny) {
        yGuess = model.y0.slice();
      } else {
        yGuess = new Array(ny).fill(0);
      }
      for (let j = 0; j < ny; j++) {
        z[nx + j] = yGuess[j];
      }

      // Newton iteration
      const maxIter = 12;
      const tol = 1e-8;
      let res = evalResidualWithZ(t, x, u, z, pOverride);

      if (!Array.isArray(res)) {
        throw new Error("model.residual did not return an array");
      }

      const nEq = res.length;
      if (nEq !== nVars) {
        console.warn(
          "Residual dimension mismatch: res.length =", nEq,
          "vs nx+ny =", nVars,
          " — attempting to proceed with square subset (min(dim))"
        );
      }

      const dim = Math.min(nEq, nVars);

      for (let iter = 0; iter < maxIter; iter++) {
        // Compute residual
        res = evalResidualWithZ(t, x, u, z, pOverride);

        // Residual norm (in the first dim entries)
        let maxAbs = 0;
        for (let i = 0; i < dim; i++) {
          const v = Math.abs(res[i]);
          if (v > maxAbs) maxAbs = v;
        }
        if (!Number.isFinite(maxAbs)) {
          console.warn("Non-finite residual encountered at iteration", iter);
          break;
        }
        if (maxAbs < tol) {
          break; // Converged
        }

        // Finite-difference Jacobian (dim x dim)
        const J = new Array(dim);
        for (let i = 0; i < dim; i++) {
          J[i] = new Array(dim).fill(0);
        }

        const epsBase = 1e-6;
        const resBase = res.slice(0, dim);

        for (let j = 0; j < dim; j++) {
          const zj = z[j];
          const eps = epsBase * (1 + Math.abs(zj));
          z[j] = zj + eps;
          const resPert = evalResidualWithZ(t, x, u, z, pOverride);
          z[j] = zj;

          for (let i = 0; i < dim; i++) {
            J[i][j] = (resPert[i] - resBase[i]) / eps;
          }
        }

        // Solve J * delta = -resBase
        let delta;
        try {
          const rhs = new Array(dim);
          for (let i = 0; i < dim; i++) {
            rhs[i] = -resBase[i];
          }
          delta = solveLinearSystem(J, rhs);
        } catch (e) {
          console.warn("Linear solve failed in Newton iteration:", e);
          break;
        }

        // Update z
        for (let j = 0; j < dim; j++) {
          z[j] += delta[j];
        }
      }

      const xDot = z.slice(0, nx);
      const y    = z.slice(nx, nx + ny);
      return { xDot, y };
    }

    // ---------- Event helper: call applyResets with flexible signature ----------
    function callApplyResets(t, x, y, u, pOverride, cPrev, cCurr) {
      const fn = model.applyResets;
      if (typeof fn !== "function") {
        return { x: x, y: y, c: cCurr || cPrev || [] };
      }

      const arity = fn.length;
      let result;
      try {
        if (arity >= 7) {
          // (t, x, y, u, p, cPrev, cCurr)
          result = fn(t, x, y, u, pOverride, cPrev, cCurr);
        } else if (arity === 6) {
          // (t, x, y, u, p, c)  [assume cCurr]
          result = fn(t, x, y, u, pOverride, cCurr);
        } else if (arity === 5) {
          // (t, x, y, u, p)
          result = fn(t, x, y, u, pOverride);
        } else if (arity === 4) {
          // (t, x, y, u)
          result = fn(t, x, y, u);
        } else {
          // Fallback: pass minimal arguments
          result = fn(t, x, y);
        }
      } catch (e) {
        console.warn("Error in model.applyResets:", e);
        return { x: x, y: y, c: cCurr || cPrev || [] };
      }

      const out = {
        x: Array.isArray(result?.x) ? result.x.slice() : x,
        y: Array.isArray(result?.y) ? result.y.slice() : y,
        c: Array.isArray(result?.c)
          ? result.c.slice()
          : (cCurr || cPrev || new Array(nc).fill(false)),
      };
      return out;
    }

    // ---------- Simple explicit Euler DAE-aware simulator ----------
    function simulate(t0, tf, dt, opts) {
      console.log('starting simulation!');
      opts = opts || {};
      const pOverride = opts.pOverride || null;

      const x0 = (Array.isArray(opts.x0) && opts.x0.length === nx)
        ? opts.x0.slice()
        : x0_model.slice();

      const f_u = typeof opts.f_u === "function"
        ? opts.f_u
        : function (_t) { return new Array(nu).fill(0); };

      const nSteps = Math.max(1, Math.floor((tf - t0) / dt));

      const tArr = new Array(nSteps + 1);
      const xArr = new Array(nSteps + 1);
      const yArr = new Array(nSteps + 1);
      const uArr = new Array(nSteps + 1);
      const cArr = new Array(nSteps + 1);

      let t = t0;
      let x = x0.slice();
      let y = y0_model.slice();
      let u = f_u(t) || new Array(nu).fill(0);

      // Make (x, y) consistent at t0
      try {
        const sol0 = solveDerivativesAndAlgebraics(t, x, u, y, pOverride);
        y = sol0.y.slice();
      } catch (e) {
        console.warn("Initial algebraic solve failed:", e);
      }

      let c = c0.slice();
      if (haveEvents) {
        try {
          const cInit = model.evalConditions(t, x, y, u, pOverride);
          if (Array.isArray(cInit)) c = cInit.slice();
        } catch (e) {
          console.warn("evalConditions at initial time failed:", e);
        }
      }

      for (let k = 0; k <= nSteps; k++) {
        console.log('step',k, t);
        // Ensure u is defined
        u = f_u(t) || new Array(nu).fill(0);

        // Solve for xDot and y at (t, x, u)
        let xDot, yNew;
        try {
          const sol = solveDerivativesAndAlgebraics(t, x, u, y, pOverride);
          xDot = sol.xDot;
          yNew = sol.y;
        } catch (e) {
          console.warn("DAE solve failed at t =", t, ":", e);
          // Fallback: freeze y, zero xDot
          xDot = new Array(nx).fill(0);
          yNew = y.slice();
        }

        // Store current step
        tArr[k] = t;
        xArr[k] = x.slice();
        yArr[k] = yNew.slice();
        uArr[k] = Array.isArray(u) ? u.slice() : Array.from(u);
        cArr[k] = c.slice();

        if (k === nSteps) break;

        // Explicit Euler update for x
        let xNext = new Array(nx);
        for (let i = 0; i < nx; i++) {
          xNext[i] = x[i] + dt * xDot[i];
        }

        let yNext = yNew.slice();
        let cNext = c.slice();

        // Event handling at step end
        if (haveEvents && nc > 0) {
          const tNext = t + dt;
          const uNext = f_u(tNext) || new Array(nu).fill(0);

          // Recompute consistent algebraics at (tNext, xNext, uNext)
          try {
            const solNext = solveDerivativesAndAlgebraics(
              tNext,
              xNext,
              uNext,
              yNext,
              pOverride
            );
            yNext = solNext.y.slice();
          } catch (e) {
            console.warn("DAE solve (post-step) failed at t =", tNext, ":", e);
          }

          let cPrev = c.slice();
          let cCurr = cPrev.slice();
          try {
            const cEval = model.evalConditions(
              tNext,
              xNext,
              yNext,
              uNext,
              pOverride
            );
            if (Array.isArray(cEval)) cCurr = cEval.slice();
          } catch (e) {
            console.warn("evalConditions failed at t =", tNext, ":", e);
          }

          // Delegate reset logic to model.applyResets
          const applied = callApplyResets(
            tNext,
            xNext,
            yNext,
            uNext,
            pOverride,
            cPrev,
            cCurr
          );

          xNext = Array.isArray(applied.x) ? applied.x.slice() : xNext;
          yNext = Array.isArray(applied.y) ? applied.y.slice() : yNext;
          cNext = Array.isArray(applied.c) ? applied.c.slice() : cCurr.slice();
        }

        // Advance
        t += dt;
        x = xNext;
        y = yNext;
        c = cNext;
      }

      return {
        t: tArr,
        x: xArr,
        y: yArr,
        u: uArr,
        c: cArr
      };
    }

    // Helper: convert array-of-vectors to named series
    function buildNamedSeries(names, valuesPerStep) {
      const out = {};
      for (let i = 0; i < names.length; i++) {
        out[names[i]] = new Array(valuesPerStep.length);
      }
      for (let k = 0; k < valuesPerStep.length; k++) {
        const row = valuesPerStep[k] || [];
        for (let i = 0; i < names.length; i++) {
          out[names[i]][k] = row[i];
        }
      }
      return out;
    }

    const sim = (params && params.sim) || {};
    const t0 = Number.isFinite(sim.t0) ? sim.t0 : 0;
    const tf = Number.isFinite(sim.tf) ? sim.tf : 5;
    const dt = Number.isFinite(sim.dt) ? sim.dt : 0.1;

    const x0 = Array.isArray(sim.x0) && sim.x0.length === nx
      ? sim.x0.slice()
      : x0_model.slice();

    // Allow user input function, else zero input
    const f_u = typeof sim.f_u === "function"
      ? sim.f_u
      : function (_t) { return new Array(nu).fill(0); };

    const raw = simulate(t0, tf, dt, { x0, f_u });

    // Build named outputs:
    //   data.x.h, data.x.v, ...
    //   data.y.E, ...
    //   data.u.<inputName>, ...
    //   data.c.c0, ...
    const data = {
      t: raw.t,
      x: buildNamedSeries(stateNames,     raw.x),
      y: buildNamedSeries(algebraicNames, raw.y),
      u: buildNamedSeries(inputNames,     raw.u),
      c: buildNamedSeries(conditionNames, raw.c),
    };

    return {
      meta: {
        t0: t0,
        tf: tf,
        dt: dt,
        nSteps: raw.t.length,
        model: {
          name: model.name || meta.name || "UnnamedModel",
          stateNames: stateNames,
          inputNames: inputNames,
          algebraicNames: algebraicNames,
          conditionNames: conditionNames,
        },
        context: context || null,
      },
      data: data,
    };
  }
`
  return wrapped
}
