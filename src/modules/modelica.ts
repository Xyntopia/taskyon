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
    "use strict";
    ${compiledJs}

    const model = Model();
    const meta = model.meta || {};

    const stateNames     = (meta.states     || []).map(s => s.name);
    const algebraicNames = (meta.algebraics || []).map(a => a.name);
    const inputNames     = (meta.inputs     || []).map(u => u.name);
    const conditionNames = (meta.conditions || []).map(c => c.name);

    const nx = Array.isArray(model.x0) ? model.x0.length : 0;
    const ny = Array.isArray(model.y0) ? model.y0.length : 0;
    const nc = Array.isArray(model.c0) ? model.c0.length : 0;
    const nu = inputNames.length;

    const haveEvents =
      typeof model.evalConditions === "function" &&
      typeof model.applyResets   === "function";

    /**
     * Evaluate derivatives and algebraic variables at (t, x).
     *
     * Uses structure:
     *   res[i]        = xDot[i] - f_i(t,x,y,u,p)
     *   res[nx + j]   = y[j]    - g_j(t,x,u,p)
     *
     * by calling residual with xDot = 0 and a yGuess.
     */
    function evalDerivativesAndAlgebraics(t, x, u, yGuess, pOverride) {
      const xDotZero = new Array(nx).fill(0);

      const y = (Array.isArray(yGuess) && yGuess.length === ny)
        ? yGuess.slice()
        : (Array.isArray(model.y0) ? model.y0.slice() : new Array(ny).fill(0));

      const res = model.residual(t, x, xDotZero, y, u, pOverride);

      // xDot[i] = -res[i]  (since res[i] = 0 - rhs_i = -rhs_i)
      const xDot = new Array(nx);
      for (let i = 0; i < nx; i++) {
        xDot[i] = -res[i];
      }

      // y[j] = yGuess[j] - res[nx + j]  (since res = y - g(x,...) )
      const yOut = new Array(ny);
      for (let j = 0; j < ny; j++) {
        const idx = nx + j;
        yOut[j] = y[j] - res[idx];
      }

      return { xDot, y: yOut };
    }

    /**
     * Very simple explicit Euler "implicit-DAE aware" simulator
     * with basic when/reinit event handling.
     *
     * - Time stepping: explicit Euler on x:
     *       x_{k+1} = x_k + dt * f(t_k, x_k)
     * - f is obtained from residual via the trick above.
     * - y is recomputed from algebraic equations at each step.
     * - Events:
     *      * Conditions c_i(t, x, y, u, p) evaluated at step end.
     *      * Rising edges (!cPrev[i] && cCurr[i]) trigger resets
     *        via model.applyResets.
     *
     * NOTE:
     * - No root finding: events are located at step boundaries.
     * - No iteration of cascaded events.
     */
    function simulate(t0, tf, dt, opts) {
      opts = opts || {};
      const pOverride = opts.pOverride || null;

      const x0 = (Array.isArray(opts.x0) && opts.x0.length === nx)
        ? opts.x0.slice()
        : (Array.isArray(model.x0) ? model.x0.slice() : new Array(nx).fill(0));

      const c0 = Array.isArray(model.c0)
        ? model.c0.slice()
        : new Array(nc).fill(false);

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
      let y = Array.isArray(model.y0) ? model.y0.slice() : new Array(ny).fill(0);
      let c = c0.slice();

      for (let k = 0; k <= nSteps; k++) {
        const u = f_u(t) || new Array(nu).fill(0);

        // Compute xDot and consistent y at (t, x)
        const result = evalDerivativesAndAlgebraics(
          t,
          x,
          u,
          y,
          pOverride
        );
        const xDot = result.xDot;
        const yNew = result.y;

        // Store current step (state at time t, before events at t+dt)
        tArr[k] = t;
        xArr[k] = x.slice();
        yArr[k] = yNew.slice();
        uArr[k] = Array.isArray(u) ? u.slice() : Array.from(u);
        cArr[k] = c.slice();

        if (k === nSteps) break;

        // Explicit Euler update for x (pre-event prediction at t+dt)
        let xNext = new Array(nx);
        for (let i = 0; i < nx; i++) {
          xNext[i] = x[i] + dt * xDot[i];
        }

        let yNext = yNew.slice();
        let cNext = c.slice();

        // Event handling at step end (tNext, xNext)
        if (haveEvents && nc > 0) {
          const tNext = t + dt;
          const uNext = f_u(tNext) || new Array(nu).fill(0);

          // Recompute algebraics at (tNext, xNext) before events
          const resNext = evalDerivativesAndAlgebraics(
            tNext,
            xNext,
            uNext,
            yNext,
            pOverride
          );
          yNext = resNext.y;

          // Evaluate conditions at step end
          const cPrev = c.slice();
          const cCurr = model.evalConditions(
            tNext,
            xNext,
            yNext,
            uNext,
            pOverride
          );

          // Apply resets based on rising edges
          const applied = model.applyResets(
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

        // Advance state and time; keep latest algebraics and conditions
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
        const row = valuesPerStep[k];
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
      : (Array.isArray(model.x0) ? model.x0.slice() : new Array(nx).fill(0));

    const f_u = function (_t) { return new Array(nu).fill(0); };

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
  return wrapped + `\n//# sourceURL=rumoca-generated.js\n`
}
