import rumocaWasmUrl from 'rumoca/rumoca_bg.wasm?url'
import defaultSolverSource from 'src/modules/modelica/simulateModel?raw'
import type * as WasmTypes from 'rumoca'
import { z } from 'zod'
import { ref } from 'vue'
import { Notify } from 'quasar'

// Zod v3 vs v4 compatibility: some builds do not expose z.function().args().returns().
// We use z.custom to type-check "is a function" while keeping strong TS inference.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const zFunction = <T extends (...args: any[]) => any>() =>
  z.custom<T>((v) => typeof v === 'function')

export type RumocaModule = typeof WasmTypes

// -------------------------------------------------------------------------------------------------
// ABI definitions (Zod)
//
// Goal:
// - Minimal, FMI-inspired ABIs
// - Versioned and extensible by discriminant `abi.id`
// - One ABI for solver <-> model runtime
// - One ABI for UI <-> simulation service
// -------------------------------------------------------------------------------------------------

// ---------- Model runtime ABI (solver <-> model) ----------

export const TyModelRuntimeAbiRefResidualV1 = z.object({
  id: z.literal('taskyon.model_runtime.residual.v1'),
  version: z.literal(1),
})

export const TyModelVarKindV1 = z.enum([
  'parameter',
  'constant',
  'state',
  'algebraic',
  'input',
  'eventIndicator',
])

export const TyModelVariableV1 = z.object({
  name: z.string().min(1),
  kind: TyModelVarKindV1,
  start: z.number().optional(),
})

export const TyModelDescriptionV1 = z.object({
  modelName: z.string().min(1),
  variables: z.array(TyModelVariableV1),

  nx: z.number().int().nonnegative(),
  ny: z.number().int().nonnegative(),
  nu: z.number().int().nonnegative(),
  nz: z.number().int().nonnegative(),
})

export const TyModelCapabilitiesV1 = z.object({
  events: z.boolean().default(false),
})

export const TyModelRuntimeResidualV1 = z.object({
  abi: TyModelRuntimeAbiRefResidualV1,
  description: TyModelDescriptionV1,
  capabilities: TyModelCapabilitiesV1,

  x0: z.array(z.number()),
  y0: z.array(z.number()),
  z0: z.array(z.number()).optional(),

  // Core residual callback (implicit DAE)
  residual:
    zFunction<
      (
        t: number,
        x: number[],
        xDot: number[],
        y: number[],
        u: number[],
        pOverride?: unknown,
      ) => number[]
    >(),

  // FMI-like event indicators: z_i(t,...) crossing zero triggers events
  evalEventIndicators:
    zFunction<
      (t: number, x: number[], y: number[], u: number[], pOverride?: unknown) => number[]
    >().optional(),

  // Apply discrete resets when event indicators cross zero
  applyResets:
    zFunction<
      (
        t: number,
        x: number[],
        y: number[],
        u: number[],
        pOverride: unknown,
        zPrev: number[],
        zCurr: number[],
      ) => { x?: number[]; y?: number[]; z?: number[] }
    >().optional(),

  // Allow legacy fields (non-breaking for existing templates)
  name: z.string().optional(),
  meta: z.unknown().optional(),
  c0: z.array(z.boolean()).optional(),
  evalConditions: z.unknown().optional(),
})

export type TyModelRuntimeResidualV1 = z.infer<typeof TyModelRuntimeResidualV1>

export function validateModelRuntimeResidualV1(model: unknown): TyModelRuntimeResidualV1 {
  const parsed = TyModelRuntimeResidualV1.parse(model)

  // --- semantic checks (beyond shape) ---
  if (parsed.x0.length !== parsed.description.nx) {
    throw new Error(`ABI mismatch: x0 length ${parsed.x0.length} != nx ${parsed.description.nx}`)
  }
  if (parsed.y0.length !== parsed.description.ny) {
    throw new Error(`ABI mismatch: y0 length ${parsed.y0.length} != ny ${parsed.description.ny}`)
  }
  if (parsed.capabilities.events) {
    if (typeof parsed.evalEventIndicators !== 'function') {
      throw new Error('ABI mismatch: capabilities.events true but evalEventIndicators missing')
    }
    if (typeof parsed.applyResets !== 'function') {
      throw new Error('ABI mismatch: capabilities.events true but applyResets missing')
    }
  }

  // Validate residual output length by a cheap probe call (gives agents actionable feedback)
  try {
    const nu = parsed.description.nu
    const r = parsed.residual(
      0,
      parsed.x0,
      new Array(parsed.description.nx).fill(0),
      parsed.y0,
      new Array(nu).fill(0),
      null,
    )
    const expected = parsed.description.nx + parsed.description.ny
    if (!Array.isArray(r) || r.length !== expected) {
      throw new Error(
        `ABI mismatch: residual output length ${Array.isArray(r) ? r.length : 'non-array'} != nx+ny ${expected}`,
      )
    }
  } catch (e) {
    throw new Error(`ABI mismatch: residual probe call failed: ${(e as Error).message}`)
  }

  if (parsed.z0 && parsed.z0.length !== parsed.description.nz) {
    throw new Error(`ABI mismatch: z0 length ${parsed.z0.length} != nz ${parsed.description.nz}`)
  }

  if (parsed.capabilities.events) {
    try {
      const nu = parsed.description.nu
      const z = parsed.evalEventIndicators!(0, parsed.x0, parsed.y0, new Array(nu).fill(0), null)
      if (!Array.isArray(z) || z.length !== parsed.description.nz) {
        throw new Error(
          `ABI mismatch: evalEventIndicators output length ${Array.isArray(z) ? z.length : 'non-array'} != nz ${parsed.description.nz}`,
        )
      }
    } catch (e) {
      throw new Error(
        `ABI mismatch: evalEventIndicators probe call failed: ${(e as Error).message}`,
      )
    }
  }

  return parsed
}

// ---------- Simulation service ABI (UI <-> service) ----------

export const TySimServiceAbiRefV1 = z.object({
  id: z.literal('taskyon.sim_service.v1'),
  version: z.literal(1),
})

export const TySimServiceCapabilitiesV1 = z.object({
  batchSimulate: z.boolean().default(true),
  sessionSimulate: z.boolean().default(false),
})

export const TySimRequestV1 = z.object({
  t0: z.number(),
  tf: z.number(),
  dt: z.number().positive(),
  x0: z.array(z.number()).optional(),

  f_u: zFunction<(t: number) => number[]>().optional(),
  pOverride: z.unknown().nullable().optional(),
})

export const TySimResultV1 = z.object({
  meta: z.object({
    t0: z.number(),
    tf: z.number(),
    dt: z.number(),
    nSteps: z.number().int().nonnegative(),
    model: TyModelDescriptionV1,
  }),

  data: z.object({
    t: z.array(z.number()),
    x: z.array(z.array(z.number())).optional(),
    y: z.array(z.array(z.number())).optional(),
    u: z.array(z.array(z.number())).optional(),
    z: z.array(z.array(z.number())).optional(),
  }),
})

export const TySimulationServiceV1 = z.object({
  abi: TySimServiceAbiRefV1,
  capabilities: TySimServiceCapabilitiesV1,

  getModelDescription: zFunction<() => z.infer<typeof TyModelDescriptionV1>>(),
  simulate: zFunction<(req: z.infer<typeof TySimRequestV1>) => z.infer<typeof TySimResultV1>>(),
})

export type TySimulationServiceV1 = z.infer<typeof TySimulationServiceV1>

// -------------------------------------------------------------------------------------------------
// Sandbox ABI validation (compile-time)
//
// We validate the generated JS by running it inside the sandboxed iframe,
// constructing the model via Model(), and checking the minimal ABI contract.
//
// Important: we cannot return functions from the iframe, so validation must
// happen inside the iframe and return plain JSON.
// -------------------------------------------------------------------------------------------------

export const TySandboxLogEntryV1 = z.object({
  timestamp: z.string(),
  level: z.enum(['info', 'success', 'warning', 'error']),
  message: z.string(),
  details: z.unknown().optional(),
})

export const TyModelAbiValidationResultV1 = z.object({
  ok: z.boolean(),
  skipped: z.boolean().optional(),
  logs: z.array(TySandboxLogEntryV1).default([]),

  // optional diagnostics
  abi: z.unknown().optional(),
  description: z.unknown().optional(),
  errorMessage: z.string().optional(),
})

export type TyModelAbiValidationResultV1 = z.infer<typeof TyModelAbiValidationResultV1>

export function validateModelAbiValidationResultV1(v: unknown): TyModelAbiValidationResultV1 {
  return TyModelAbiValidationResultV1.parse(v)
}

/**
 * Builds iframe-executed code that validates the generated model JS ABI.
 *
 * Enforcement rules inside the sandbox:
 * - If context.enforceModelAbi is true: ABI must exist and must validate.
 * - Else if model.abiRequired is true: ABI must exist and must validate.
 * - Else if model.abi exists: validate it.
 * - Otherwise: skip.
 */
export function buildModelAbiValidationIframeCode(compiledJs: string): string {
  // NOTE: We must avoid closing </script> when embedded into HTML; caller already escapes.
  return `
(params, context) => {
  const logs = [];
  const nowIso = () => new Date().toISOString();
  const runId = (context && (context.__taskyonRunId || context.runId)) || 'unknown';

  const emit = (msg, ...details) => {
    const entry = {
      timestamp: nowIso(),
      level: 'info',
      message: String(msg || ''),
      details: details.length <= 1 ? details[0] : details,
      phase: 'abi',
    };
    logs.push(entry);
    try {
      if (typeof parent !== 'undefined' && parent && typeof parent.postMessage === 'function') {
        parent.postMessage({ taskyon: { kind: 'modelicaSandboxLog', runId, entry } }, '*');
      }
    } catch {
      /* empty */
    }
  };

  try {
    ${compiledJs}
  } catch (e) {
    emit('Generated model JS threw during evaluation', { error: (e && e.message) || String(e) });
    return { ok: false, logs, errorMessage: 'Generated model JS threw during evaluation' };
  }

  if (typeof Model !== 'function') {
    emit('Generated code does not define a global Model() function');
    return { ok: false, logs, errorMessage: 'Generated code does not define a global Model() function' };
  }

  let model;
  try {
    model = Model();
  } catch (e) {
    emit('Model() threw while constructing the model runtime', { error: (e && e.message) || String(e) });
    return { ok: false, logs, errorMessage: 'Model() threw while constructing the model runtime' };
  }

  const enforce = (context && context.enforceModelAbi === true) || (model && model.abiRequired === true);
  const hasAbi = !!(model && model.abi && model.abi.id);

  if (!hasAbi) {
    if (enforce) {
      emit('ABI enforcement requested but model.abi is missing', { abiRequired: model && model.abiRequired });
      return { ok: false, logs, errorMessage: 'ABI enforcement requested but model.abi is missing' };
    }
    emit('No ABI declared by template, skipping ABI validation');
    return { ok: true, skipped: true, logs };
  }

  try {
    const abi = model.abi;
    if (abi.id !== 'taskyon.model_runtime.residual.v1') {
      throw new Error('Unsupported model ABI id: ' + String(abi.id));
    }

    const desc = model.description;
    if (!desc || typeof desc !== 'object') throw new Error('ABI mismatch: model.description missing');
    if (!model.capabilities || typeof model.capabilities !== 'object') throw new Error('ABI mismatch: model.capabilities missing');

    const nx = Number(desc.nx);
    const ny = Number(desc.ny);
    const nu = Number(desc.nu);

    if (!Number.isInteger(nx) || nx < 0) throw new Error('ABI mismatch: description.nx invalid: ' + String(desc.nx));
    if (!Number.isInteger(ny) || ny < 0) throw new Error('ABI mismatch: description.ny invalid: ' + String(desc.ny));
    if (!Number.isInteger(nu) || nu < 0) throw new Error('ABI mismatch: description.nu invalid: ' + String(desc.nu));

    if (!Array.isArray(model.x0) || model.x0.length !== nx) {
      throw new Error('ABI mismatch: x0 length ' + (Array.isArray(model.x0) ? model.x0.length : 'non-array') + ' != nx ' + nx);
    }
    if (!Array.isArray(model.y0) || model.y0.length !== ny) {
      throw new Error('ABI mismatch: y0 length ' + (Array.isArray(model.y0) ? model.y0.length : 'non-array') + ' != ny ' + ny);
    }
    if (typeof model.residual !== 'function') {
      throw new Error('ABI mismatch: model.residual is not a function');
    }

    // Probe residual output length
    let r;
    try {
      r = model.residual(0, model.x0, new Array(nx).fill(0), model.y0, new Array(nu).fill(0), null);
    } catch (e) {
      throw new Error('ABI mismatch: residual probe call threw: ' + ((e && e.message) || String(e)));
    }
    const expected = nx + ny;
    if (!Array.isArray(r) || r.length !== expected) {
      throw new Error('ABI mismatch: residual output length ' + (Array.isArray(r) ? r.length : 'non-array') + ' != nx+ny ' + expected);
    }

    emit('Model ABI validation passed', { abi });
    return { ok: true, logs, abi, description: desc };
  } catch (e) {
    const msg = 'Model ABI validation failed: ' + ((e && e.message) || String(e));
    emit(msg, {
      abi: model && model.abi,
      description: model && model.description,
    });
    return { ok: false, logs, abi: model && model.abi, description: model && model.description, errorMessage: msg };
  }
}
`
}

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
export const buildIframeCode = (compiledJs: string, solverSource?: string): string => `
(params, context)=>{
  const runId = (context && (context.__taskyonRunId || context.runId)) || 'unknown'

  // Provide a pure callback on the context object.
  // The solver can call context.log(msg, ...details) without relying on globals.
  const ctx = {
    ...(context || {}),
    log: (msg, ...details)=>{
      const entry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        message: String(msg || ''),
        details: details.length <= 1 ? details[0] : details,
        phase: 'run',
      }
      try{
        if (typeof parent !== 'undefined' && parent && typeof parent.postMessage === 'function'){
          parent.postMessage({ taskyon: { kind: 'modelicaSandboxLog', runId, entry } }, '*')
        }
      }catch{}
    }
  }

  try {
    ctx.log('Sandbox run started', { runId })
    ${compiledJs}
    ${solverSource ?? defaultSolverSource}

    if (typeof Model !== 'function') {
      throw new Error('Generated code does not define Model()')
    }
    if (typeof simulateModel !== 'function') {
      throw new Error('Solver code does not define simulateModel(params, context, model)')
    }

    const model = Model()
    const result = simulateModel(params, ctx, model)
    ctx.log('Sandbox run finished')
    return result
  } catch (e) {
    ctx.log('Sandbox run failed', { error: (e && e.message) || String(e), stack: e && e.stack })
    throw e
  }
}
`

// -------------------------------------------------------------------------------------------------
// Project file (JSON) – minimal v1
//
// We store the whole project as one JSON object (including UI templates as strings).
// Generated artifacts are intentionally NOT stored here.
// -------------------------------------------------------------------------------------------------

export const TyModelicaProjectFileV1 = z.object({
  format: z.literal('taskyon.modelica_project.v1'),
  version: z.literal(1),

  projectId: z.string().min(1),

  // Main authored Modelica source (typically model.mo)
  modelicaSource: z.string(),

  // Model-specific UI templates (AI editable). Values are template source strings.
  // The UI template language is not enforced here (could be HTML, JS, Jinja, etc.).
  uiTemplates: z.record(z.string().min(1), z.string()),
  activeUiTemplateId: z.string().min(1),

  // Model-local solvers (AI editable). Values are solver source strings.
  // Built-in solvers are not stored here.
  solvers: z.record(z.string().min(1), z.string()).optional(),

  // Optional model-local editor state
  // Optional model-local editor state
  sim: z
    .object({
      t0: z.number().optional(),
      tf: z.number().optional(),
      dt: z.number().optional(),

      // Which solver is selected.
      // Prefer solverKey (supports builtin: and project: prefixes). Keep solverId for backwards compat.
      solverKey: z.string().optional(),
      solverId: z.string().optional(),

      solverOptions: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),

  // Optional: store model-local version history
  documentVersions: z
    .array(
      z.object({
        modelica: z.string(),
        template: z.string().optional(),
        timestamp: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
  currentVersionIndex: z.number().int().nonnegative().optional(),
})

export type TyModelicaProjectFileV1 = z.infer<typeof TyModelicaProjectFileV1>

export function validateModelicaProjectFileV1(v: unknown): TyModelicaProjectFileV1 {
  return TyModelicaProjectFileV1.parse(v)
}

// Optional: adjust if you put this elsewhere
type ModelicaLogPhase = 'compile' | 'run' | 'loadWasm' | 'abi' | 'general'
type ModelicaLogLevel = 'info' | 'success' | 'warning' | 'error'

interface ModelicaLogEntry {
  timestamp: string
  phase: ModelicaLogPhase
  level: ModelicaLogLevel
  message: string
  details?: unknown
}

/**
 * Shared log for all Modelica / template / simulation related actions.
 * Make sure to push entries from:
 *  - WASM loading
 *  - compile success / failure
 *  - simulation run success / failure
 *  - user-triggered compile / run as well as AI-triggered ones
 */
export const modelicaLog = ref<ModelicaLogEntry[]>([])

export function appendModelicaLog(
  entry: Omit<ModelicaLogEntry, 'timestamp'> & { timestamp?: string },
) {
  console.log(entry)
  modelicaLog.value.push({
    timestamp: entry.timestamp ?? new Date().toISOString(),
    phase: entry.phase,
    level: entry.level,
    message: entry.message,
    details: entry.details,
  })
}

export function renderUiHtml({ uiTemplate, compiledJs, solverJs }: UiTemplateRenderInput): string {
  const tpl = String(uiTemplate ?? '')
  const compiledEsc = escapeScriptTagEnd(String(compiledJs ?? ''))
  const solverEsc = escapeScriptTagEnd(String(solverJs ?? ''))

  // Common placeholder spellings (must match UI templates and older exports)
  let out = tpl
    // Mustache style placeholders
    .replaceAll('{{compiled_js}}', compiledEsc)
    .replaceAll('{{ compiled_js }}', compiledEsc)
    .replaceAll('{{solver_js}}', solverEsc)
    .replaceAll('{{ solver_js }}', solverEsc)

    // Legacy-ish placeholders
    .replaceAll('/*__COMPILED_JS__*/', compiledEsc)
    .replaceAll('/*__SOLVER_JS__*/', solverEsc)

    // Taskyon UI template placeholders (current default UI template)
    .replaceAll(/\/\*__TASKYON_GENERATED_MODEL_JS__\*\//g, compiledEsc)
    .replaceAll(/\/\*__TASKYON_SOLVER_JS__\*\//g, solverEsc)

  const hasCompiled = out.includes(compiledEsc)
  const hasSolver = out.includes(solverEsc)

  // If the template had no placeholders at all, inject scripts before </body>
  if (!hasCompiled || !hasSolver) {
    const inject = [
      !hasCompiled ? `\n<script>\n${compiledEsc}\n</script>\n` : '',
      !hasSolver ? `\n<script>\n${solverEsc}\n</script>\n` : '',
    ].join('')

    if (/<\/body\s*>/i.test(out)) {
      out = out.replace(/<\/body\s*>/i, `${inject}</body>`)
    } else {
      out += inject
    }
  }

  return out
}

export function exportGeneratedUiHtml(
  hasUiTemplate: boolean,
  activeUiTemplateSource: string,
  jsSource: string,
  activeSolverSource: string,
  currentProjectId: string,
) {
  if (!hasUiTemplate) {
    Notify.create({ type: 'warning', message: 'No UI template selected' })
    return
  }
  if (!jsSource) {
    Notify.create({ type: 'warning', message: 'No generated model JS available' })
    return
  }

  const html = renderUiHtml({
    uiTemplate: activeUiTemplateSource,
    compiledJs: jsSource,
    solverJs: activeSolverSource,
  })

  const now = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  downloadTextFile({
    fileName: `ui_${currentProjectId}_${now}.html`,
    content: html,
    mime: 'text/html;charset=utf-8',
  })
}

// ---------- Simple helpers ----------

type UiTemplateRenderInput = {
  uiTemplate: string
  compiledJs: string
  solverJs: string
}

function escapeScriptTagEnd(src: string): string {
  return String(src ?? '').replaceAll('<' + '/script>', '<\\/script>')
}

type ExportTarget = 'modelica' | 'template' | 'js' | 'daePretty' | 'daeJson'

function downloadTextFile(opts: { fileName: string; content: string; mime?: string }) {
  const blob = new Blob([opts.content ?? ''], { type: opts.mime ?? 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = opts.fileName
  a.click()

  // cleanup
  setTimeout(() => URL.revokeObjectURL(url), 500)
}

export function exportFile(target: ExportTarget, content: string) {
  const now = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')

  if (target === 'modelica') {
    downloadTextFile({
      fileName: `model_${now}.mo`,
      content: content,
      mime: 'text/plain',
    })
    return
  }
  if (target === 'template') {
    downloadTextFile({
      fileName: `template_${now}.jinja`,
      content: content,
      mime: 'text/plain',
    })
    return
  }
  if (target === 'js') {
    downloadTextFile({
      fileName: `generated_${now}.js`,
      content: content,
      mime: 'text/javascript',
    })
    return
  }
  if (target === 'daePretty') {
    downloadTextFile({
      fileName: `dae_${now}.txt`,
      content: content,
      mime: 'text/plain',
    })
    return
  }
  if (target === 'daeJson') {
    downloadTextFile({
      fileName: `dae_${now}.json`,
      content: content,
      mime: 'application/json',
    })
    return
  }

  // exhaustive
  Notify.create({ type: 'warning', message: `Unknown export target: ${String(target)}` })
}
