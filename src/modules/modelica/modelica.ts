import rumocaWasmUrl from 'rumoca/rumoca_bg.wasm?url'
import type * as WasmTypes from 'rumoca'
export type RumocaModule = typeof WasmTypes

// ---------- WASM loading ----------
export const loadWasm = async () => {
  const wasmModule = await import('rumoca')

  if (typeof wasmModule.default === 'function') {
    await wasmModule.default(rumocaWasmUrl)
  }

  if ('wasm_init' in wasmModule && typeof wasmModule.wasm_init === 'function') {
    try {
      await wasmModule.wasm_init(1)
    } catch (e) {
      console.warn('Rumoca wasm_init failed – single-threaded mode:', e)
    }
  }

  return wasmModule as RumocaModule
}

// ---------- Build iframe function code ----------
export const buildIframeCode = (compiledJs: string): string => `
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

const haveEvents =
  typeof model.evalConditions === "function" &&
  typeof model.applyResets   === "function";

const x0_model = Array.isArray(model.x0) ? model.x0.slice() : new Array(nx).fill(0);
const y0_model = Array.isArray(model.y0) ? model.y0.slice() : new Array(ny).fill(0);

let c0 = Array.isArray(model.c0) ? model.c0.slice() : null;
if (!c0 && haveEvents) {
  try {
    const cProbe = model.evalConditions(0, x0_model, y0_model, new Array(nu).fill(0), null);
    if (Array.isArray(cProbe)) c0 = cProbe.slice();
  } catch {}
}
if (!c0) c0 = new Array(conditionNames.length).fill(false);
const nc = c0.length;

// ---------- Linear solver ----------
function solveLinearSystem(A, b) {
  const n = A.length;
  const M = A.map(r => r.slice());
  const x = b.slice();

  for (let k = 0; k < n; k++) {
    let maxRow = k;
    let maxVal = Math.abs(M[k][k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(M[i][k]);
      if (v > maxVal) {
        maxVal = v;
        maxRow = i;
      }
    }
    if (maxVal === 0) throw new Error("Singular matrix");

    if (maxRow !== k) {
      [M[k], M[maxRow]] = [M[maxRow], M[k]];
      [x[k], x[maxRow]] = [x[maxRow], x[k]];
    }

    for (let i = k + 1; i < n; i++) {
      const f = M[i][k] / M[k][k];
      x[i] -= f * x[k];
      for (let j = k; j < n; j++) {
        M[i][j] -= f * M[k][j];
      }
    }
  }

  for (let i = n - 1; i >= 0; i--) {
    let s = x[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }

  return x;
}

// ---------- Newton solver ----------
function newtonSolve(residualFn, z0) {
  const maxIter = 12;
  const tol = 1e-8;
  const n = z0.length;
  let z = z0.slice();

  for (let iter = 0; iter < maxIter; iter++) {
    const r = residualFn(z);

    let maxAbs = 0;
    for (let i = 0; i < n; i++) maxAbs = Math.max(maxAbs, Math.abs(r[i]));
    if (maxAbs < tol) return z;

    const J = Array.from({ length: n }, () => new Array(n).fill(0));
    const epsBase = 1e-6;

    for (let j = 0; j < n; j++) {
      const zj = z[j];
      const eps = epsBase * (1 + Math.abs(zj));
      z[j] = zj + eps;
      const rp = residualFn(z);
      z[j] = zj;
      for (let i = 0; i < n; i++) {
        J[i][j] = (rp[i] - r[i]) / eps;
      }
    }

    const delta = solveLinearSystem(J, r.map(v => -v));
    for (let i = 0; i < n; i++) z[i] += delta[i];
  }

  return z;
}

// ---------- Backward-Euler-like stage ----------
function implicitStage(tStage, xBase, yGuess, u, dtStage, pOverride) {
  const z0 = xBase.concat(yGuess);

  function residual(z) {
    const xS = z.slice(0, nx);
    const yS = z.slice(nx);

    const xDot = new Array(nx);
    for (let i = 0; i < nx; i++) {
      xDot[i] = (xS[i] - xBase[i]) / dtStage;
    }

    return model.residual(
      tStage,
      xS,
      xDot,
      yS,
      u,
      pOverride
    );
  }

  const sol = newtonSolve(residual, z0);
  return {
    x: sol.slice(0, nx),
    y: sol.slice(nx)
  };
}

// ---------- SDIRK-2 (Alexander) ----------
function sdirk2Step(t, x, y, u, dt, pOverride) {
  const gamma = 1 - 1 / Math.sqrt(2);

  // ---- Stage 1 ----
  const stage1 = implicitStage(
    t + gamma * dt,
    x,
    y,
    u,
    gamma * dt,
    pOverride
  );

  // ---- Stage 2 ----
  const z0 = stage1.x.concat(stage1.y);

  function residualStage2(z) {
    const x2 = z.slice(0, nx);
    const y2 = z.slice(nx);

    const xDot = new Array(nx);
    for (let i = 0; i < nx; i++) {
      xDot[i] =
        ((x2[i] - x[i]) / dt -
         (1 - gamma) * (stage1.x[i] - x[i]) / (gamma * dt)) / gamma;
    }

    return model.residual(
      t + dt,
      x2,
      xDot,
      y2,
      u,
      pOverride
    );
  }

  const sol2 = newtonSolve(residualStage2, z0);

  return {
    x: sol2.slice(0, nx),
    y: sol2.slice(nx)
  };
}

// ---------- Simulation ----------
function simulate(t0, tf, dt, opts) {
  opts = opts || {};
  const pOverride = opts.pOverride || null;
  const f_u = typeof opts.f_u === "function"
    ? opts.f_u
    : _t => new Array(nu).fill(0);

  const nSteps = Math.max(1, Math.floor((tf - t0) / dt));
  const tArr = [];
  const xArr = [];
  const yArr = [];
  const uArr = [];
  const cArr = [];

  let t = t0;
  let x = (opts.x0 || x0_model).slice();
  let y = y0_model.slice();
  let c = c0.slice();

  for (let k = 0; k <= nSteps; k++) {
    const u = f_u(t) || new Array(nu).fill(0);

    tArr.push(t);
    xArr.push(x.slice());
    yArr.push(y.slice());
    uArr.push(u.slice());
    cArr.push(c.slice());

    if (k === nSteps) break;

    let step;
    try {
      step = sdirk2Step(t, x, y, u, dt, pOverride);
    } catch (e) {
      console.warn("SDIRK step failed at t =", t, e);
      break;
    }

    let xNext = step.x;
    let yNext = step.y;
    let cNext = c.slice();

    if (haveEvents) {
      const uNext = f_u(t + dt) || new Array(nu).fill(0);
      let cPrev = c.slice();
      let cCurr = cPrev.slice();
      try {
        const ce = model.evalConditions(t + dt, xNext, yNext, uNext, pOverride);
        if (Array.isArray(ce)) cCurr = ce.slice();
      } catch {}

      const applied = model.applyResets
        ? model.applyResets(t + dt, xNext, yNext, uNext, pOverride, cPrev, cCurr)
        : null;

      if (applied?.x) xNext = applied.x.slice();
      if (applied?.y) yNext = applied.y.slice();
      if (applied?.c) cNext = applied.c.slice();
    }

    t += dt;
    x = xNext;
    y = yNext;
    c = cNext;
  }

  return { t: tArr, x: xArr, y: yArr, u: uArr, c: cArr };
}

// ---------- Run ----------
const sim = params?.sim || {};
const raw = simulate(
  sim.t0 ?? 0,
  sim.tf ?? 5,
  sim.dt ?? 0.1,
  {
    x0: sim.x0,
    f_u: sim.f_u
  }
);

return {
  meta: {
    t0: sim.t0 ?? 0,
    tf: sim.tf ?? 5,
    dt: sim.dt ?? 0.1,
    nSteps: raw.t.length,
    model: {
      name: model.name || meta.name || "UnnamedModel",
      stateNames,
      inputNames,
      algebraicNames,
      conditionNames,
    },
    context: context || null,
  },
  data: {
    t: raw.t,
    x: Object.fromEntries(stateNames.map((n,i)=>[n,raw.x.map(r=>r[i])])),
    y: Object.fromEntries(algebraicNames.map((n,i)=>[n,raw.y.map(r=>r[i])])),
    u: Object.fromEntries(inputNames.map((n,i)=>[n,raw.u.map(r=>r[i])])),
    c: Object.fromEntries(conditionNames.map((n,i)=>[n,raw.c.map(r=>r[i])])),
  }
};
}
`
