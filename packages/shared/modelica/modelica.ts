import defaultSolverSource from './simulateModel?raw'
import type * as WasmTypes from 'rumoca-full-web'
import rumocaWasmUrl from 'rumoca-full-web/rumoca_bind_wasm_bg.wasm?url'
import { z } from 'zod'
import { ref } from 'vue'
import { Notify } from 'quasar'
import { executeInWorkerSandbox } from '../modules/sandbox/workerSandbox'
import { validateJavaScriptInSandbox } from '../modules/sandbox/checkJsSyntax'
import { serializeObject } from '../modules/serializeObject'
import { DEFAULT_MODELICA_LIBRARY_URL } from './modelicaLibraryCatalog'
import {
  hasRumocaTemplateRenderer,
  renderRumocaTemplate,
  type RumocaTemplateRenderApi,
} from './rumocaTemplateRender'

// Zod v3 vs v4 compatibility: some builds do not expose z.function().args().returns().
// We use z.custom to type-check "is a function" while keeping strong TS inference.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const zFunction = <T extends (...args: any[]) => any>() =>
  z.custom<T>((v) => typeof v === 'function')

type RumocaLegacyLibraryApi = {
  compile_with_libraries: (source: string, modelName: string, librariesJson: string) => string
  load_libraries: (librariesJson: string) => string
  clear_library_cache: () => void
  get_library_count: () => number
}

type RumocaSourceRootApi = {
  compile_with_source_roots: (source: string, modelName: string, sourceRootsJson: string) => string
  load_source_roots: (sourceRootsJson: string) => string
  clear_source_root_cache: () => void
  get_source_root_document_count: () => number
}

export type RumocaModule = typeof WasmTypes &
  Partial<RumocaLegacyLibraryApi & RumocaSourceRootApi> &
  RumocaTemplateRenderApi
export const DEFAULT_MSL_ZIP_URL = DEFAULT_MODELICA_LIBRARY_URL
export const builtinSolvers: Record<string, string> = {
  default: defaultSolverSource,
}

export type ModelicaVersion = {
  modelica: string
  template: string
  timestamp: string
  description?: string
}

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
  id: z.literal('rumoca.model_runtime.residual.v1'),
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
    if (!Array.isArray(r)) {
      throw new Error(`ABI mismatch: residual output is non-array, expected length >= ${expected}`)
    }
    // Allow overdetermined residuals (m > n). The solver handles rectangular systems
    // via damped least-squares (J^T J + lambda I).
    if (r.length < expected) {
      throw new Error(`ABI mismatch: residual output length ${r.length} < nx+ny ${expected}`)
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
// We validate the generated JS by running it inside the browser sandbox,
// constructing the model via Model(), and checking the minimal ABI contract.
//
// Important: we cannot return functions from the browser sandbox, so validation must
// happen inside the sandbox and return plain JSON.
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

export type TyModelAbiValidationDecision = {
  shouldValidate: boolean
  reason: string
}

/**
 * Decide whether rendered template output should go through JS ABI validation.
 *
 * We only validate outputs that look like JS model runtime code:
 * - not HTML/XML-like
 * - contains a global Model() function declaration
 */
export function shouldValidateModelAbiForRenderedOutput(
  renderedOutput: string,
): TyModelAbiValidationDecision {
  const rendered = String(renderedOutput ?? '')
  const trimmed = rendered.trimStart()

  if (!trimmed) {
    return { shouldValidate: false, reason: 'Rendered output is empty' }
  }
  if (trimmed.startsWith('<')) {
    return { shouldValidate: false, reason: 'Rendered output appears to be HTML/XML, not JS' }
  }
  if (!/\bfunction\s+Model\s*\(/.test(rendered)) {
    return { shouldValidate: false, reason: 'Rendered output does not define a global Model()' }
  }

  return { shouldValidate: true, reason: 'Rendered output looks like JS Model() runtime code' }
}

/**
 * Builds worker-sandbox code that validates the generated model JS ABI.
 *
 * Enforcement rules inside the sandbox:
 * - If context.enforceModelAbi is true: ABI must exist and must validate.
 * - Else if model.abiRequired is true: ABI must exist and must validate.
 * - Else if model.abi exists: validate it.
 * - Otherwise: skip.
 */
export function buildModelAbiValidationSandboxCode(compiledJs: string): string {
  // NOTE: We must avoid closing </script> when embedded into HTML; caller already escapes.
  return `
(params, context) => {
  const logs = [];
  const nowIso = () => new Date().toISOString();
  const runId = (context && (context.__rumocaRunId || context.runId)) || 'unknown';

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
        parent.postMessage({ rumoca: { kind: 'modelicaSandboxLog', runId, entry } }, '*');
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
    if (abi.id !== 'rumoca.model_runtime.residual.v1') {
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
    if (!Array.isArray(r)) {
      throw new Error('ABI mismatch: residual output is non-array, expected length >= nx+ny ' + expected);
    }
    if (r.length < expected) {
      throw new Error('ABI mismatch: residual output length ' + r.length + ' < nx+ny ' + expected);
    }
    if (r.length > expected) {
      emit('ABI warning: residual output length ' + r.length + ' > nx+ny ' + expected + ' (overdetermined residual accepted)');
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
  const wasmModule = await import('rumoca-full-web')

  if (typeof wasmModule.default === 'function') {
    await wasmModule.default({ module_or_path: rumocaWasmUrl })
  }

  if ('wasm_init' in wasmModule && typeof wasmModule.wasm_init === 'function') {
    const hardwareThreads =
      typeof navigator !== 'undefined' &&
      typeof navigator.hardwareConcurrency === 'number' &&
      Number.isFinite(navigator.hardwareConcurrency)
        ? navigator.hardwareConcurrency
        : 2
    const canUseThreadedWasm = globalThis.crossOriginIsolated === true
    const requestedThreads = canUseThreadedWasm ? Math.max(1, Math.min(hardwareThreads, 4)) : 0

    try {
      // Newer rumoca builds may expose wasm_init as sync; normalize to Promise.
      await Promise.resolve(wasmModule.wasm_init(requestedThreads))
    } catch (e) {
      console.warn('Rumoca wasm_init failed – single-threaded mode:', e)
    }
  }

  return wasmModule as RumocaModule
}

// ---------- Build worker sandbox function code ----------
export const buildWorkerSandboxCode = (compiledJs: string, solverSource?: string): string => `
(params, context)=>{
  const runId = (context && (context.__rumocaRunId || context.runId)) || 'unknown'

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
          parent.postMessage({ rumoca: { kind: 'modelicaSandboxLog', runId, entry } }, '*')
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

  // Explicit project-level library requirements for diagram/compile reproducibility.
  requiredLibraries: z.array(z.string().min(1)).default([]),

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
      simulationBackend: z.enum(['js', 'rumoca']).optional(),
      rumocaSolver: z.string().optional(),

      // Which solver is selected.
      // Prefer solverKey (supports builtin: and project: prefixes). Keep solverId for backwards compat.
      solverKey: z.string().optional(),
      solverId: z.string().optional(),

      solverOptions: z.record(z.string(), z.unknown()).optional(),
      solverOptionsByKey: z.record(z.string().min(1), z.record(z.string(), z.unknown())).optional(),
      charts: z
        .array(
          z.object({
            x: z.string().optional(),
            y: z.string().optional(),
            z: z.string().optional(),
            title: z.string().optional(),
          }),
        )
        .optional(),
      plotViewOptions: z
        .object({
          viewMode: z.enum(['full', 'viewOnly', 'thumbnail']).optional(),
          minimalView: z.boolean().optional(),
        })
        .optional(),
      result: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),

  ui: z
    .object({
      libraryTree: z
        .object({
          showRootMetadata: z.boolean().optional(),
        })
        .optional(),
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
  callSite?: string
}

const resolveModelicaLogCallSite = (stack: string | undefined): string | undefined => {
  if (!stack) return undefined
  const lines = stack
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const appendIndex = lines.findIndex((line) => line.includes('appendModelicaLog'))
  if (appendIndex >= 0 && appendIndex + 1 < lines.length) {
    const callerLine = lines[appendIndex + 1]
    if (callerLine) return callerLine.replace(/^at\s+/, '')
  }

  const firstFrame = lines.find((line) => line !== 'Error')
  return firstFrame?.replace(/^at\s+/, '')
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
  const callSite = resolveModelicaLogCallSite(new Error().stack)
  const nextEntry: ModelicaLogEntry = {
    timestamp: entry.timestamp ?? new Date().toISOString(),
    phase: entry.phase,
    level: entry.level,
    message: entry.message,
    details: entry.details,
    ...(callSite ? { callSite } : {}),
  }

  console.log('[ModelicaLog]', nextEntry, callSite ? `caller: ${callSite}` : '')
  modelicaLog.value.push(nextEntry)
}

export function renderUiHtml({
  uiTemplate,
  compiledJs,
  solverJs,
  simDefaults,
}: UiTemplateRenderInput): string {
  const tpl = String(uiTemplate ?? '')
  const compiledEsc = escapeScriptTagEnd(String(compiledJs ?? ''))
  const solverEsc = escapeScriptTagEnd(String(solverJs ?? ''))
  const solverWithRuntimeDefaultsEsc = solverEsc + buildSimDefaultsOverrideJs(simDefaults)

  // Common placeholder spellings (must match UI templates and older exports)
  let out = tpl
    // Mustache style placeholders
    .replaceAll('{{compiled_js}}', compiledEsc)
    .replaceAll('{{ compiled_js }}', compiledEsc)
    .replaceAll('{{solver_js}}', solverWithRuntimeDefaultsEsc)
    .replaceAll('{{ solver_js }}', solverWithRuntimeDefaultsEsc)

    // Legacy-ish placeholders
    .replaceAll('/*__COMPILED_JS__*/', compiledEsc)
    .replaceAll('/*__SOLVER_JS__*/', solverWithRuntimeDefaultsEsc)

    // Taskyon UI template placeholders (current default UI template)
    .replaceAll(/\/\*__RUMOCA_GENERATED_MODEL_JS__\*\//g, compiledEsc)
    .replaceAll(/\/\*__RUMOCA_SOLVER_JS__\*\//g, solverWithRuntimeDefaultsEsc)

  const hasCompiled = out.includes(compiledEsc)
  const hasSolver = out.includes(solverWithRuntimeDefaultsEsc)

  // If the template had no placeholders at all, inject scripts before </body>
  if (!hasCompiled || !hasSolver) {
    const inject = [
      !hasCompiled ? `\n<script>\n${compiledEsc}\n</script>\n` : '',
      !hasSolver ? `\n<script>\n${solverWithRuntimeDefaultsEsc}\n</script>\n` : '',
    ].join('')

    if (/<\/body\s*>/i.test(out)) {
      out = out.replace(/<\/body\s*>/i, `${inject}</body>`)
    } else {
      out += inject
    }
  }

  return injectSeriesSelectionPersistence(out)
}

export function exportGeneratedUiHtml(
  hasUiTemplate: boolean,
  activeUiTemplateSource: string,
  jsSource: string,
  activeSolverSource: string,
  currentProjectId: string,
  simDefaults?: UiTemplateSimDefaults,
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
    ...(simDefaults ? { simDefaults } : {}),
  })

  const now = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  downloadTextFile({
    fileName: `ui_${currentProjectId}_${now}.html`,
    content: html,
    mime: 'text/html;charset=utf-8',
  })
}

export function exportGeneratedUiJinjaTemplate(
  hasUiTemplate: boolean,
  activeUiTemplateSource: string,
  modelCodeTemplateSource: string,
  activeSolverSource: string,
  currentProjectId: string,
  simDefaults?: UiTemplateSimDefaults,
) {
  if (!hasUiTemplate) {
    Notify.create({ type: 'warning', message: 'No UI template selected' })
    return
  }
  if (!String(modelCodeTemplateSource ?? '').trim()) {
    Notify.create({ type: 'warning', message: 'No model JS template source available' })
    return
  }
  if (!String(activeSolverSource ?? '').trim()) {
    Notify.create({ type: 'warning', message: 'No solver source available' })
    return
  }

  const jinjaTemplate = renderUiHtml({
    uiTemplate: activeUiTemplateSource,
    compiledJs: modelCodeTemplateSource,
    solverJs: activeSolverSource,
    ...(simDefaults ? { simDefaults } : {}),
  })

  const now = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  downloadTextFile({
    fileName: `ui_${currentProjectId}_${now}.jinja`,
    content: jinjaTemplate,
    mime: 'text/plain;charset=utf-8',
  })
}

// ---------- Simple helpers ----------

type UiTemplateRenderInput = {
  uiTemplate: string
  compiledJs: string
  solverJs: string
  simDefaults?: UiTemplateSimDefaults
}

type UiTemplateSimDefaults = {
  t0?: number
  tf?: number
  dt?: number
}

function escapeScriptTagEnd(src: string): string {
  return String(src ?? '').replaceAll('<' + '/script>', '<\\/script>')
}

function buildSimDefaultsOverrideJs(simDefaults?: UiTemplateSimDefaults): string {
  const next: Record<string, number> = {}
  if (Number.isFinite(simDefaults?.t0)) next.t0 = Number(simDefaults?.t0)
  if (Number.isFinite(simDefaults?.tf)) next.tf = Number(simDefaults?.tf)
  if (Number.isFinite(simDefaults?.dt)) next.dt = Number(simDefaults?.dt)
  if (Object.keys(next).length === 0) return ''

  const defaultsJson = JSON.stringify(next)
  return `
;(() => {
  try {
    if (typeof simulateModel !== 'function') return
    const prev = simulateModel.simDefaults
    const base = prev && typeof prev === 'object' ? prev : {}
    simulateModel.simDefaults = { ...base, ...${defaultsJson} }
  } catch {
    /* empty */
  }
})()
`
}

function injectSeriesSelectionPersistence(html: string): string {
  const marker = '__RUMOCA_SERIES_PERSIST__'
  if (String(html).includes(marker)) return html

  const snippet = `
<script>
(() => {
  const marker = '${marker}'
  if (window[marker]) return
  window[marker] = true

  const select = document.getElementById('seriesSelect')
  const runBtn = document.getElementById('runBtn')
  if (!(select instanceof HTMLSelectElement) || !(runBtn instanceof HTMLElement)) return

  let preferred = String(select.value || '')

  const selectOption = (key) => {
    if (!key) return false
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i]?.value === key) {
        if (select.value !== key) {
          select.value = key
          select.dispatchEvent(new Event('change'))
        }
        preferred = key
        return true
      }
    }
    return false
  }

  select.addEventListener('change', () => {
    preferred = String(select.value || '')
  })

  const observer = new MutationObserver(() => {
    if (preferred) selectOption(preferred)
  })
  observer.observe(select, { childList: true })

  runBtn.addEventListener('click', () => {
    const current = String(select.value || preferred || '')
    if (current) preferred = current
  })
})()
</script>
`

  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${snippet}</body>`)
  return `${html}${snippet}`
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

export function createDefaultProjectSolvers(): Record<string, string> {
  return { solver1: defaultSolverSource }
}

export type SourceKeyScope = 'builtin' | 'project' | 'custom'

const SOURCE_KEY_SCOPES: SourceKeyScope[] = ['builtin', 'project', 'custom']

export function makeSourceKey(scope: SourceKeyScope, id: string): string {
  return `${scope}:${String(id || '')}`
}

export function parseSourceKey(key: string): { scope?: SourceKeyScope; id: string } {
  const k = String(key || '')
  const scope = SOURCE_KEY_SCOPES.find((s) => k.startsWith(`${s}:`))
  if (!scope) return { id: k }
  return { scope, id: k.slice(scope.length + 1) }
}

export function isSourceKeyScope(key: string, scope: SourceKeyScope): boolean {
  return parseSourceKey(key).scope === scope
}

export function ensureSourceKeyScope(key: string, scope: SourceKeyScope): string {
  const parsed = parseSourceKey(key)
  if (parsed.scope) return key
  return makeSourceKey(scope, parsed.id)
}

export function solverIdFromKey(key: string): string {
  return parseSourceKey(key).id
}

type JsonSchemaPropertyWithDefault = { default?: unknown }
type JsonSchemaLikeObject = { properties?: Record<string, JsonSchemaPropertyWithDefault> }

export function extractDefaultsFromJsonSchema(schema: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!schema || typeof schema !== 'object') return out
  const s = schema as JsonSchemaLikeObject
  const props = s.properties
  if (!props || typeof props !== 'object') return out
  for (const k of Object.keys(props)) {
    const def = props[k]?.default
    if (def !== undefined) out[k] = def
  }
  return out
}

export async function discoverSolverMetadata(solverJs: string): Promise<{
  schema?: Record<string, unknown>
  simDefaults?: Record<string, unknown>
}> {
  if (!String(solverJs ?? '').trim()) return {}
  const id = 'rumoca-solver-meta'
  const abort = new AbortController()
  const code = `
(params, context) => {
  ${String(solverJs)}
  const contract = (typeof simulateModel === 'function' && simulateModel.contract) || null
  const schema =
    (contract && typeof contract === 'object' && (contract.optionsSchema || contract.solverOptionsSchema)) ||
    (typeof simulateModel === 'function' && (simulateModel.optionsSchema || simulateModel.solverOptionsSchema)) ||
    null
  const simDefaults =
    (contract && typeof contract === 'object' && contract.simDefaults) ||
    (typeof simulateModel === 'function' && simulateModel.simDefaults) ||
    null
  return { schema, simDefaults }
}
`
  const rawUnknown = await executeInWorkerSandbox(
    {
      id,
      code,
      sourceURL: 'rumoca-solver-meta.js',
      stopSignal: abort.signal,
    },
    {},
    { source: 'ModelicaPage', compiledAt: new Date().toISOString(), __rumocaRunId: id },
  )
  if (!rawUnknown || typeof rawUnknown !== 'object') return {}
  const r = rawUnknown as Record<string, unknown>
  const schema =
    r.schema && typeof r.schema === 'object' ? (r.schema as Record<string, unknown>) : undefined
  const simDefaults =
    r.simDefaults && typeof r.simDefaults === 'object'
      ? (r.simDefaults as Record<string, unknown>)
      : undefined
  const out: { schema?: Record<string, unknown>; simDefaults?: Record<string, unknown> } = {}
  if (schema) out.schema = schema
  if (simDefaults) out.simDefaults = simDefaults
  return out
}

export function packProjectFile(input: {
  projectId: string
  modelicaSource: string
  requiredLibraries: string[]
  uiTemplates: Record<string, string>
  activeUiTemplateId: string
  projectSolvers: Record<string, string>
  sim: {
    t0: number
    tf: number
    dt: number
    simulationBackend?: 'js' | 'rumoca'
    rumocaSolver?: string
    solverKey: string
    solverOptions: Record<string, unknown>
    solverOptionsByKey?: Record<string, Record<string, unknown>>
    charts?: Array<{
      x?: string | undefined
      y?: string | undefined
      z?: string | undefined
      title?: string | undefined
    }>
    plotViewOptions?: {
      viewMode?: 'full' | 'viewOnly' | 'thumbnail' | undefined
      minimalView?: boolean | undefined
    }
    result?: Record<string, unknown>
  }
  ui?: {
    libraryTree?: {
      showRootMetadata?: boolean
    }
  }
  documentVersions: ModelicaVersion[]
  currentVersionIndex: number
}): TyModelicaProjectFileV1 {
  const pf: TyModelicaProjectFileV1 = {
    format: 'taskyon.modelica_project.v1',
    version: 1,
    projectId: input.projectId,
    modelicaSource: input.modelicaSource,
    requiredLibraries: input.requiredLibraries,
    uiTemplates: input.uiTemplates,
    activeUiTemplateId: input.activeUiTemplateId,
    solvers: input.projectSolvers,
    sim: {
      t0: input.sim.t0,
      tf: input.sim.tf,
      dt: input.sim.dt,
      simulationBackend: input.sim.simulationBackend,
      rumocaSolver: input.sim.rumocaSolver,
      solverKey: input.sim.solverKey,
      solverId: solverIdFromKey(input.sim.solverKey),
      solverOptions: input.sim.solverOptions,
      solverOptionsByKey: input.sim.solverOptionsByKey,
      charts: input.sim.charts,
      plotViewOptions: input.sim.plotViewOptions,
      result: input.sim.result,
    },
    ui: input.ui,
    documentVersions:
      input.documentVersions as unknown as TyModelicaProjectFileV1['documentVersions'],
    currentVersionIndex: input.currentVersionIndex,
  }
  return validateModelicaProjectFileV1(pf)
}

export function unpackProjectFile(
  pf: TyModelicaProjectFileV1,
  builtins: Record<string, string>,
): {
  modelicaSource: string
  requiredLibraries: string[]
  uiTemplates: Record<string, string>
  selectedUiTemplateId: string
  projectSolvers?: Record<string, string>
  sim: {
    t0?: number
    tf?: number
    dt?: number
    simulationBackend?: 'js' | 'rumoca'
    rumocaSolver?: string
    solverKey?: string
    solverOptions?: Record<string, unknown>
    solverOptionsByKey?: Record<string, Record<string, unknown>>
    charts?: Array<{
      x?: string | undefined
      y?: string | undefined
      z?: string | undefined
      title?: string | undefined
    }>
    plotViewOptions?: {
      viewMode?: 'full' | 'viewOnly' | 'thumbnail' | undefined
      minimalView?: boolean | undefined
    }
    result?: Record<string, unknown>
  }
  ui?: {
    libraryTree?: {
      showRootMetadata?: boolean
    }
  }
  documentVersions?: ModelicaVersion[]
  currentVersionIndex?: number
} {
  const uiState =
    pf.ui && typeof pf.ui === 'object'
      ? ({
          libraryTree:
            pf.ui.libraryTree && typeof pf.ui.libraryTree === 'object'
              ? {
                  ...(typeof pf.ui.libraryTree.showRootMetadata === 'boolean'
                    ? { showRootMetadata: pf.ui.libraryTree.showRootMetadata }
                    : {}),
                }
              : undefined,
        } as {
          libraryTree?: {
            showRootMetadata?: boolean
          }
        })
      : null

  const out: ReturnType<typeof unpackProjectFile> = {
    modelicaSource: pf.modelicaSource ?? '',
    requiredLibraries: Array.isArray(pf.requiredLibraries) ? pf.requiredLibraries : [],
    uiTemplates: pf.uiTemplates ?? {},
    selectedUiTemplateId:
      pf.activeUiTemplateId || Object.keys(pf.uiTemplates ?? {})[0] || 'default',
    sim: {},
    ...(uiState ? { ui: uiState } : {}),
  }
  if (pf.solvers && typeof pf.solvers === 'object') out.projectSolvers = pf.solvers

  if (pf.sim) {
    if (typeof pf.sim.t0 === 'number') out.sim.t0 = pf.sim.t0
    if (typeof pf.sim.tf === 'number') out.sim.tf = pf.sim.tf
    if (typeof pf.sim.dt === 'number') out.sim.dt = pf.sim.dt
    if (pf.sim.simulationBackend === 'js' || pf.sim.simulationBackend === 'rumoca') {
      out.sim.simulationBackend = pf.sim.simulationBackend
    }
    if (typeof pf.sim.rumocaSolver === 'string') {
      out.sim.rumocaSolver = pf.sim.rumocaSolver
    }

    const solverKey = typeof pf.sim.solverKey === 'string' ? pf.sim.solverKey : ''
    const solverId = typeof pf.sim.solverId === 'string' ? pf.sim.solverId : ''

    if (solverKey) out.sim.solverKey = solverKey
    else if (solverId) {
      if (builtins[solverId] != null) out.sim.solverKey = `builtin:${solverId}`
      else if (pf.solvers?.[solverId] != null) out.sim.solverKey = `project:${solverId}`
    }

    if (pf.sim.solverOptions && typeof pf.sim.solverOptions === 'object') {
      out.sim.solverOptions = pf.sim.solverOptions
    }
    if (pf.sim.solverOptionsByKey && typeof pf.sim.solverOptionsByKey === 'object') {
      out.sim.solverOptionsByKey = pf.sim.solverOptionsByKey
    }
    if (Array.isArray(pf.sim.charts)) {
      out.sim.charts = pf.sim.charts
    }
    if (pf.sim.plotViewOptions && typeof pf.sim.plotViewOptions === 'object') {
      const pvo = pf.sim.plotViewOptions
      const normalizedViewMode =
        pvo.viewMode === 'full' || pvo.viewMode === 'thumbnail' || pvo.viewMode === 'viewOnly'
          ? pvo.viewMode
          : pvo.minimalView
            ? 'viewOnly'
            : undefined
      out.sim.plotViewOptions = {
        ...pvo,
        ...(normalizedViewMode ? { viewMode: normalizedViewMode } : {}),
      }
    }
    if (pf.sim.result && typeof pf.sim.result === 'object') {
      out.sim.result = pf.sim.result
    }
  }

  if (Array.isArray(pf.documentVersions)) {
    out.documentVersions = pf.documentVersions as unknown as ModelicaVersion[]
  }
  if (typeof pf.currentVersionIndex === 'number') {
    out.currentVersionIndex = pf.currentVersionIndex
  }

  return out
}

export function normalizeLibraryEntryPath(path: string): string {
  const parts = String(path || '')
    .split('/')
    .filter(Boolean)
  if (parts.length > 1 && /(?:Standard)?Library|^MSL/i.test(parts[0] ?? '')) {
    return parts.slice(1).join('/')
  }
  if (parts.length > 0) {
    parts[0] = parts[0]!.replace(/[\s-][\d.]+$/, '')
  }
  return parts.join('/')
}

type CompiledDaePayload = {
  dae?: unknown
  dae_native?: unknown
  dae_prepared?: unknown
  dae_prepared_status?: unknown
  dae_prepared_diagnostics?: unknown
}

export function getPreparedDaeStatus(daeObj: unknown): string | null {
  if (!daeObj || typeof daeObj !== 'object' || Array.isArray(daeObj)) return null
  const status = (daeObj as Record<string, unknown>).__rumoca_prepared_status
  return typeof status === 'string' && status.trim().length > 0 ? status : null
}

export function getPreparedDaeDiagnostics(daeObj: unknown): string[] {
  if (!daeObj || typeof daeObj !== 'object' || Array.isArray(daeObj)) return []
  const raw = (daeObj as Record<string, unknown>).__rumoca_prepared_diagnostics
  if (!Array.isArray(raw)) return []
  return raw.filter((entry): entry is string => typeof entry === 'string')
}

export function selectDaeForTemplate(
  compiled: CompiledDaePayload,
  options?: {
    usePreparedDae?: boolean
  },
): Record<string, unknown> | null {
  const asRecord = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null

  const usePreparedDae = Boolean(options?.usePreparedDae)
  if (usePreparedDae) {
    const preparedDae = asRecord(compiled.dae_prepared)
    if (preparedDae) return preparedDae
  }
  const dae = asRecord(compiled.dae)
  return dae
}

export function buildModelConstructionProbeSandboxCode(compiledJs: string): string {
  return `
(params, context) => {
  try {
    ${compiledJs}
  } catch (e) {
    return {
      ok: false,
      stage: 'evaluate-generated-js',
      error: {
        message: (e && e.message) || String(e),
        name: (e && e.name) || undefined,
        stack: (e && e.stack) || undefined,
      },
    };
  }

  if (typeof Model !== 'function') {
    return {
      ok: false,
      stage: 'missing-model-factory',
      modelType: typeof Model,
    };
  }

  try {
    const model = Model();
    const keys = model && typeof model === 'object'
      ? Object.keys(model).slice(0, 50)
      : [];
    return {
      ok: true,
      stage: 'model-constructed',
      modelType: typeof model,
      keys,
      abi: model && model.abi ? { id: model.abi.id, version: model.abi.version } : undefined,
      description:
        model && model.description
          ? {
              modelName: model.description.modelName,
              nx: model.description.nx,
              ny: model.description.ny,
              nu: model.description.nu,
              nz: model.description.nz,
            }
          : undefined,
    };
  } catch (e) {
    return {
      ok: false,
      stage: 'construct-model',
      error: {
        message: (e && e.message) || String(e),
        name: (e && e.name) || undefined,
        stack: (e && e.stack) || undefined,
      },
      modelFnPreview: String(Model).slice(0, 500),
    };
  }
}
`
}

export async function compileModelicaToJs(params: {
  wasm: RumocaModule | null
  modelicaSource: string
  templateSource: string
  useModelicaStandardLibrary: boolean
  mslLoaded: boolean
  usePreparedDae: boolean
  activeSandboxRunIds: Set<string>
}): Promise<
  | {
      ok: true
      rendered: string
      daeForTemplate: Record<string, unknown>
      daePretty: string
      usedLibraries: boolean
      modelName: string
    }
  | {
      ok: false
      message: string
      compileDebug?: Record<string, unknown>
      rendered?: string
      daeForTemplate?: Record<string, unknown>
      daePretty?: string
      usedLibraries?: boolean
      modelName?: string
    }
> {
  if (!params.modelicaSource || !params.templateSource) {
    appendModelicaLog({
      level: 'error',
      phase: 'general',
      message: 'Please provide both Modelica source and template',
    })
    return { ok: false, message: 'Missing Modelica source or template' }
  }

  appendModelicaLog({
    level: 'info',
    phase: 'compile',
    message: 'Compiling...',
  })

  const compileDebug: Record<string, unknown> = {
    phase: 'init',
    usingMslRequested: params.useModelicaStandardLibrary,
    mslLoaded: params.mslLoaded,
    usePreparedDae: params.usePreparedDae,
    modelicaLength: params.modelicaSource.length,
    templateLength: params.templateSource.length,
  }
  let partialRendered = ''
  let partialDaeForTemplate: Record<string, unknown> | undefined
  let partialDaePretty = ''
  let partialUsedLibraries = false
  let partialModelName = 'Model'

  try {
    const m = params.wasm
    if (!m) throw new Error('WASM module not loaded')
    if (typeof m.compile_to_json !== 'function' || !hasRumocaTemplateRenderer(m)) {
      throw new Error(
        'WASM module is missing compile_to_json / render_template / render_target exports',
      )
    }

    const match = params.modelicaSource.match(/(?:model|class|block|connector|record)\s+(\w+)/)
    const modelName = match?.[1] ?? 'Model'
    compileDebug.modelName = modelName
    partialModelName = modelName

    let jsonStr = ''
    let usedLibraries = false
    if (params.useModelicaStandardLibrary && params.mslLoaded) {
      if (typeof m.compile_with_source_roots === 'function') {
        jsonStr = m.compile_with_source_roots(params.modelicaSource, modelName, '{}')
        usedLibraries = true
        compileDebug.phase = 'compiled-with-source-roots'
      } else if (typeof m.compile_with_libraries === 'function') {
        jsonStr = m.compile_with_libraries(params.modelicaSource, modelName, '{}')
        usedLibraries = true
        compileDebug.phase = 'compiled-with-libraries'
      } else {
        throw new Error(
          'WASM module is missing compile_with_source_roots / compile_with_libraries exports',
        )
      }
    } else {
      if (params.useModelicaStandardLibrary && !params.mslLoaded) {
        appendModelicaLog({
          level: 'warning',
          phase: 'compile',
          message: 'MSL is enabled but no library archive is loaded. Compiling without libraries.',
        })
      }
      jsonStr = m.compile_to_json(params.modelicaSource, modelName)
      compileDebug.phase = 'compiled-no-libraries'
    }

    const compiled = JSON.parse(jsonStr) as {
      dae?: unknown
      dae_native?: unknown
      dae_prepared?: unknown
      dae_prepared_status?: unknown
      dae_prepared_diagnostics?: unknown
      dae_prepared_error?: unknown
      pretty?: string
    }
    compileDebug.usedLibraries = usedLibraries
    partialUsedLibraries = usedLibraries

    const daeForTemplate = selectDaeForTemplate(compiled, {
      usePreparedDae: params.usePreparedDae,
    })
    if (!daeForTemplate) throw new Error('Compilation did not return a usable DAE object')
    const preparedStatus = getPreparedDaeStatus(daeForTemplate)
    const preparedDiagnostics = getPreparedDaeDiagnostics(daeForTemplate)
    compileDebug.preparedStatus = preparedStatus ?? null
    compileDebug.preparedDiagnostics = preparedDiagnostics

    if (preparedStatus === 'fallback_native') {
      const details = preparedDiagnostics.length > 0 ? ` (${preparedDiagnostics.join(' | ')})` : ''
      throw new Error(`Prepared DAE unavailable; native/raw fallback is not supported${details}`)
    }
    if (preparedStatus === 'prepared') {
      appendModelicaLog({
        level: 'info',
        phase: 'compile',
        message: 'Prepared DAE selected for template rendering.',
      })
    }

    if (compiled.dae_prepared_error) {
      const preparedErrorText =
        typeof compiled.dae_prepared_error === 'string'
          ? compiled.dae_prepared_error
          : serializeObject(compiled.dae_prepared_error, {
              format: 'json',
              maxDepth: 2,
              maxArrayLength: 8,
              maxObjectKeys: 12,
              maxStringLength: 240,
              indent: 0,
            })
      appendModelicaLog({
        level: 'warning',
        phase: 'compile',
        message: `DAE prepare pass reported diagnostics: ${preparedErrorText}`,
      })
    }
    partialDaeForTemplate = daeForTemplate
    partialDaePretty = compiled.pretty ?? ''

    const daeJson = JSON.stringify(daeForTemplate)
    compileDebug.daeJsonLength = daeJson.length
    const rendered = renderRumocaTemplate({
      wasm: m,
      daeJson,
      templateSource: params.templateSource,
      modelName,
      templatePath: 'template.jinja',
      outputPath: `${modelName}.txt`,
      targetName: 'template',
    })
    partialRendered = String(rendered ?? '')
    compileDebug.renderedPreview = String(rendered).slice(0, 220)

    const abiDecision = shouldValidateModelAbiForRenderedOutput(rendered)
    compileDebug.abiDecision = abiDecision

    if (abiDecision.shouldValidate) {
      const modelProbeRunId = 'rumoca-model-probe'
      const modelProbeAbort = new AbortController()
      params.activeSandboxRunIds.add(modelProbeRunId)
      try {
        const modelProbeCode = buildModelConstructionProbeSandboxCode(rendered)
        const modelProbeResult = await executeInWorkerSandbox(
          {
            id: modelProbeRunId,
            code: modelProbeCode,
            sourceURL: 'rumoca-model-probe.js',
            stopSignal: modelProbeAbort.signal,
          },
          {},
          {
            source: 'ModelicaPage',
            compiledAt: new Date().toISOString(),
            __rumocaRunId: modelProbeRunId,
          },
        )
        compileDebug.modelProbe = modelProbeResult
        if (
          !modelProbeResult ||
          typeof modelProbeResult !== 'object' ||
          (modelProbeResult as { ok?: boolean }).ok !== true
        ) {
          appendModelicaLog({
            level: 'error',
            phase: 'compile',
            message: 'Model() construction probe failed',
            details: modelProbeResult,
          })
          throw new Error('Model() construction probe failed')
        }

        const code = buildModelAbiValidationSandboxCode(rendered)
        const id = 'rumoca-model-abi-check'
        const abort = new AbortController()
        params.activeSandboxRunIds.add(id)
        const rawAbiResult = await executeInWorkerSandbox(
          {
            id,
            code,
            sourceURL: 'rumoca-model-abi-check.js',
            stopSignal: abort.signal,
          },
          {},
          {
            source: 'ModelicaPage',
            compiledAt: new Date().toISOString(),
            __rumocaRunId: id,
          },
        )
        const abiResult = validateModelAbiValidationResultV1(rawAbiResult)
        if (abiResult.ok !== true) {
          const msg = abiResult.errorMessage || 'Generated model ABI validation failed'
          appendModelicaLog({
            level: 'error',
            phase: 'abi',
            message: msg,
            details: abiResult,
          })
          throw new Error(msg)
        }
      } finally {
        params.activeSandboxRunIds.delete('rumoca-model-probe')
        modelProbeAbort.abort()
        params.activeSandboxRunIds.delete('rumoca-model-abi-check')
      }
    } else {
      appendModelicaLog({
        level: 'info',
        phase: 'abi',
        message: `Skipping JS model probe/ABI validation: ${abiDecision.reason}`,
      })
    }

    appendModelicaLog({
      level: 'success',
      phase: 'compile',
      message: usedLibraries
        ? 'Compilation successful (with Modelica libraries)!'
        : 'Compilation successful!',
      details: { modelName, usedLibraries },
    })
    return {
      ok: true,
      rendered,
      daeForTemplate,
      daePretty: compiled.pretty ?? '',
      usedLibraries,
      modelName,
    }
  } catch (error) {
    const msg = (error as Error).message
    appendModelicaLog({
      level: 'error',
      phase: 'compile',
      message: `Compilation failed: ${msg}`,
      details: {
        error: {
          name: (error as Error).name,
          message: (error as Error).message,
          stack: (error as Error).stack,
          cause: (error as Error).cause,
        },
        debug: compileDebug,
      },
    })
    const failed: {
      ok: false
      message: string
      compileDebug?: Record<string, unknown>
      rendered?: string
      daeForTemplate?: Record<string, unknown>
      daePretty?: string
      usedLibraries?: boolean
      modelName?: string
    } = {
      ok: false,
      message: msg,
      compileDebug,
    }
    if (partialRendered) failed.rendered = partialRendered
    if (partialDaeForTemplate) failed.daeForTemplate = partialDaeForTemplate
    if (partialDaePretty) failed.daePretty = partialDaePretty
    failed.usedLibraries = partialUsedLibraries
    failed.modelName = partialModelName
    return failed
  }
}

export async function runModelicaSandbox(params: {
  jsSource: string | undefined
  solverSource: string
  sim: { t0: number; tf: number; dt: number; solverOptions: Record<string, unknown> }
  activeSandboxRunIds: Set<string>
  abortSignal: AbortSignal
}): Promise<{ ok: true; result: Record<string, unknown> } | { ok: false; message: string }> {
  if (!params.jsSource) {
    appendModelicaLog({
      level: 'error',
      phase: 'run',
      message: 'No generated JavaScript. Compile first.',
    })
    return { ok: false, message: 'No generated JavaScript. Compile first.' }
  }

  const msg = await validateJavaScriptInSandbox(params.jsSource)
  if (msg.valid === false) {
    appendModelicaLog({
      level: 'error',
      phase: 'run',
      message: `Generated JavaScript has syntax errors: ${msg.message}`,
      details: msg,
    })
    return { ok: false, message: String(msg.message || 'Syntax validation failed') }
  }

  const code = buildWorkerSandboxCode(params.jsSource, params.solverSource)
  const id = `rumoca-model-worker`
  try {
    params.activeSandboxRunIds.add(id)
    const result = await executeInWorkerSandbox(
      {
        id,
        code,
        sourceURL: 'rumoca-generated.js',
        stopSignal: params.abortSignal,
      },
      { sim: params.sim },
      {
        source: 'ModelicaPage',
        compiledAt: new Date().toISOString(),
        __rumocaRunId: id,
      },
    )

    if (typeof result !== 'object' || result == null || Array.isArray(result)) {
      appendModelicaLog({
        level: 'error',
        phase: 'run',
        message: `Simulation returned invalid result: expected object, got ${typeof result}`,
        details: result,
      })
      return { ok: false, message: 'Simulation returned invalid result' }
    }

    appendModelicaLog({
      level: 'success',
      phase: 'run',
      message: 'Simulation was successful',
    })
    return { ok: true, result: result as Record<string, unknown> }
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      appendModelicaLog({
        level: 'warning',
        phase: 'run',
        message: 'Execution aborted.',
      })
      return { ok: false, message: 'Execution aborted.' }
    }
    appendModelicaLog({
      level: 'warning',
      phase: 'run',
      message: `Worker sandbox execution error: ${(error as Error).message}`,
      details: {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
        cause: (error as Error).cause,
      },
    })
    return { ok: false, message: (error as Error).message }
  } finally {
    params.activeSandboxRunIds.delete(id)
  }
}
