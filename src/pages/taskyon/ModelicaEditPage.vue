<template>
  <q-page padding>
    <!-- Header -->
    <q-card flat bordered class="q-mb-md">
      <q-card-section>
        <div class="text-h4 text-primary">
          <q-icon :name="matRocketLaunch" /> Rumoca WASM Compiler
        </div>
        <div class="text-subtitle2 text-grey-7">
          Test your Modelica to template compilation in the browser
        </div>
      </q-card-section>
    </q-card>

    <!-- Editors -->
    <div class="row q-col-gutter-md q-mb-md">
      <!-- Modelica source -->
      <div class="col-12 col-md-6">
        <q-card>
          <q-card-section class="row items-center justify-between">
            <div class="text-h6"><q-icon :name="matDescription" /> Modelica Source</div>
            <q-btn
              color="grey-7"
              flat
              dense
              label="Copy"
              :disable="!modelicaSource"
              @click="copyModelicaToClipboard"
            />
          </q-card-section>
          <q-card-section>
            <q-input
              v-model="modelicaSource"
              type="textarea"
              outlined
              placeholder="Enter your Modelica code here..."
              :rows="15"
              input-class="text-code"
            />
          </q-card-section>
        </q-card>
      </div>

      <!-- Template source -->
      <div class="col-12 col-md-6">
        <q-card>
          <q-card-section class="row items-center justify-between">
            <div class="text-h6"><q-icon :name="matCode" /> Template Source</div>
            <q-btn
              color="grey-7"
              flat
              dense
              label="Copy"
              :disable="!templateSource"
              @click="copyTemplateToClipboard"
            />
          </q-card-section>
          <q-card-section>
            <q-input
              v-model="templateSource"
              type="textarea"
              outlined
              placeholder="Enter your Jinja template here..."
              :rows="15"
              input-class="text-code"
            />
          </q-card-section>
        </q-card>
      </div>
    </div>

    <!-- Actions -->
    <q-card class="q-mb-md">
      <q-card-section>
        <div class="row q-gutter-sm items-center">
          <q-btn color="grey-7" :icon="matDelete" label="Clear All" outline @click="clearAll" />

          <q-btn
            color="grey-7"
            :icon="matDescription"
            label="Load Example"
            outline
            @click="loadExample"
          />

          <q-toggle v-model="verbose" label="Verbose logging" />

          <q-space />

          <!-- Run / Stop execution -->
          <q-btn
            color="secondary"
            :icon="matPlayArrow"
            label="Run in Sandbox"
            :disable="!jsSource"
            :loading="running"
            @click="runInSandbox"
          />
          <q-btn v-if="running" color="negative" label="Stop" outline @click="stopExecution" />
        </div>
      </q-card-section>
    </q-card>

    <!-- Status banner -->
    <q-banner
      v-if="statusMessage"
      :class="
        statusType === 'error'
          ? 'bg-negative'
          : statusType === 'success'
            ? 'bg-positive'
            : 'bg-warning'
      "
      class="text-white q-mb-md"
    >
      <template #avatar>
        <q-icon
          :name="
            statusType === 'error' ? matError : statusType === 'success' ? matCheckCircle : matInfo
          "
        />
      </template>
      {{ statusMessage }}
    </q-banner>

    <!-- Output row: Code + Execution -->
    <div class="row q-col-gutter-md">
      <!-- Compilation outputs (Code + DAE JSON + Pretty) -->
      <div class="col-12 col-md-6">
        <q-card>
          <q-card-section class="row items-center justify-between">
            <div class="text-h6"><q-icon :name="matCode" /> Compilation Outputs</div>
            <div class="row items-center no-wrap q-gutter-xs">
              <q-btn
                color="grey-7"
                flat
                dense
                label="Copy JS"
                :disable="!jsSource"
                @click="copyJsToClipboard"
              />
              <q-btn
                color="grey-7"
                flat
                dense
                label="Copy DAE JSON"
                :disable="!daeJsonOutput"
                @click="copyDaeJsonToClipboard"
              />
              <q-btn
                color="grey-7"
                flat
                dense
                label="Copy Pretty"
                :disable="!daePrettyOutput"
                @click="copyDaePrettyToClipboard"
              />
            </div>
          </q-card-section>

          <q-separator />

          <q-card-section>
            <q-tabs v-model="outputTab" dense align="justify" narrow-indicator>
              <q-tab name="js" label="Code" />
              <q-tab name="daeJson" label="JSON" />
              <q-tab name="daePretty" label="Pretty" />
            </q-tabs>

            <q-tab-panels v-model="outputTab" animated>
              <q-tab-panel name="js">
                <q-input
                  v-model="jsSource"
                  type="textarea"
                  outlined
                  readonly
                  placeholder="Generated Code will appear here..."
                  :rows="20"
                  input-class="text-code"
                  bg-color="grey-10"
                  dark
                />
              </q-tab-panel>

              <q-tab-panel name="daeJson">
                <ObjectTreeView v-model="daeJsonOutput" />
              </q-tab-panel>

              <q-tab-panel name="daePretty">
                <q-input
                  v-model="daePrettyOutput"
                  type="textarea"
                  outlined
                  readonly
                  placeholder="Pretty-printed DAE will appear here..."
                  :rows="20"
                  input-class="text-code"
                  bg-color="grey-10"
                  dark
                />
              </q-tab-panel>
            </q-tab-panels>
          </q-card-section>
        </q-card>
      </div>

      <!-- Execution / Result -->
      <div class="col-12 col-md-6">
        <q-card>
          <q-card-section>
            <div class="text-h6"><q-icon :name="matOutput" /> Execution (Sandboxed Iframe)</div>
          </q-card-section>

          <q-card-section>
            <div class="row q-col-gutter-sm">
              <div class="col-4">
                <q-input v-model.number="simT0" type="number" outlined label="t0" />
              </div>
              <div class="col-4">
                <q-input v-model.number="simTf" type="number" outlined label="tf" />
              </div>
              <div class="col-4">
                <q-input v-model.number="simDt" type="number" outlined label="dt" />
              </div>
            </div>
          </q-card-section>

          <q-card-section v-if="executionError">
            <q-banner class="bg-negative text-white">
              <template #avatar>
                <q-icon :name="matError" />
              </template>
              {{ executionError }}
            </q-banner>
          </q-card-section>

          <q-card-section v-if="executionResult && Object.keys(executionResult).length">
            <ObjectTreeView v-model="executionResult" dense hide-missing read-only />
          </q-card-section>

          <q-card-section v-else-if="!executionError">
            <div class="text-grey-7">
              No execution result yet. Compile and click “Run in Sandbox”.
            </div>
          </q-card-section>
        </q-card>
      </div>
    </div>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import type * as WasmTypes from 'rumoca'
import {
  matCheckCircle,
  matCode,
  matDelete,
  matDescription,
  matError,
  matInfo,
  matOutput,
  matPlayArrow,
  matRocketLaunch,
} from '@quasar/extras/material-icons'
import { executeCodeInIframeSimple } from '../../../packages/taskyon/src/utils/iframeWorker'
import ObjectTreeView from 'src/components/varViews/ObjectTreeView.vue'

const jinjaTemplateUrls = import.meta.glob('app/public/modelica/*.jinja', {
  query: '?raw', // get the file content
  import: 'default',
  eager: false, // lazy-load each file when used
})

type StatusType = 'loading' | 'success' | 'error' | ''
type WasmModule = typeof WasmTypes

const modelicaSource = ref('')
const templateSource = ref('')
const output = ref('') // legacy raw output if needed
const jsSource = ref('') // generated JS shown + executed
const daeJsonOutput = ref<Record<string, unknown>>({}) // DAE JSON (pretty-printed)
const daePrettyOutput = ref('') // Pretty DAE textual representation (from WASM)
const outputTab = ref<'js' | 'daeJson' | 'daePretty'>('js')

const verbose = ref(false)
const loading = ref(false)
const wasmLoaded = ref(false)
const statusMessage = ref('Loading WASM module...')
const statusType = ref<StatusType>('loading')
const wasm = ref<WasmModule | null>(null)

// Simulation / execution state
const simT0 = ref(0)
const simTf = ref(5)
const simDt = ref(0.1)

const executionResult = ref<Record<string, unknown>>({})
const executionError = ref<string | null>(null)
const running = ref(false)
const abortController = ref<AbortController | null>(null)

// ---------- WASM loading ----------

import rumocaWasmUrl from 'rumoca/rumoca_bg.wasm?url'

const loadWasm = async () => {
  try {
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
        console.warn(
          'Rumoca wasm_init (thread pool) failed – continuing in single-threaded mode:',
          e,
        )
      }
    }

    wasm.value = wasmModule as WasmModule
    wasmLoaded.value = true
    statusMessage.value = 'WASM module loaded successfully! Ready to compile.'
    statusType.value = 'success'
    setTimeout(() => {
      statusMessage.value = ''
    }, 3000)
  } catch (error) {
    statusMessage.value = `Failed to load WASM: ${(error as Error).message}`
    statusType.value = 'error'
    console.error('WASM loading error:', error)
  }
}

// ---------- Compile Modelica → JS & DAE via new API ----------
// 1. compile_to_json(source, modelName) → JSON string
// 2. render_template(daeJson, template) → rendered string (JS in your case)
watch([modelicaSource, templateSource], () => {
  if (!modelicaSource.value || !templateSource.value) {
    statusMessage.value = 'Please provide both Modelica source and template'
    statusType.value = 'error'
    jsSource.value = ''
    daeJsonOutput.value = {}
    daePrettyOutput.value = ''
    output.value = ''
    executionResult.value = {}
    executionError.value = null
    return
  }

  loading.value = true
  output.value = ''
  jsSource.value = ''
  daeJsonOutput.value = {}
  daePrettyOutput.value = ''
  statusMessage.value = 'Compiling...'
  statusType.value = 'loading'
  executionResult.value = {}
  executionError.value = null

  try {
    const m = wasm.value
    if (!m) {
      throw new Error('WASM module not loaded')
    }
    if (typeof m.compile_to_json !== 'function' || typeof m.render_template !== 'function') {
      throw new Error('WASM module is missing compile_to_json / render_template exports')
    }

    const source = modelicaSource.value
    const template = templateSource.value

    // Heuristic: take first model/class/record/etc name as modelName
    const match = source.match(/(?:model|class|block|connector|record)\s+(\w+)/)
    const modelName = match?.[1] ?? 'Model'

    // Step 1: compile Modelica → DAE JSON (wrapper object)
    const jsonStr = m.compile_to_json(source, modelName)
    const compiled = JSON.parse(jsonStr) as {
      dae?: unknown
      dae_native?: unknown
      pretty?: string
      balance?: unknown
    }

    // TODO: add "compile_with_libraries" option here

    // Prefer dae_native (matches what render_template expects)
    const daeForTemplate = compiled.dae_native ?? compiled.dae
    if (!daeForTemplate) {
      throw new Error('Compilation did not return a DAE object')
    }

    // For display
    daeJsonOutput.value = daeForTemplate as Record<string, unknown>
    daePrettyOutput.value = compiled.pretty ?? ''

    const daeJson = JSON.stringify(daeForTemplate)

    // Step 2: render template (your Jinja template should output JS code)
    const rendered = m.render_template(daeJson, template)

    output.value = rendered
    jsSource.value = rendered

    statusMessage.value = 'Compilation successful!'
    statusType.value = 'success'
    setTimeout(() => {
      statusMessage.value = ''
    }, 3000)

    if (verbose.value) {
      console.debug('Rumoca compile result (raw):', compiled)
    }
  } catch (error) {
    const msg = (error as Error).message
    output.value = `Error: ${msg}`
    jsSource.value = ''
    daeJsonOutput.value = {}
    daePrettyOutput.value = ''
    statusMessage.value = `Compilation failed: ${msg}`
    statusType.value = 'error'
    console.error('Compilation error:', error)
  } finally {
    loading.value = false
  }
})

// ---------- Simple helpers ----------
const clearAll = () => {
  modelicaSource.value = ''
  templateSource.value = ''
  output.value = ''
  jsSource.value = ''
  daeJsonOutput.value = {}
  daePrettyOutput.value = ''
  statusMessage.value = ''
  executionResult.value = {}
  executionError.value = null
}

const loadExample = async () => {
  modelicaSource.value = `model BouncingBall             "The bouncing ball model"
  constant Real g = 9.81 "Gravitational acceleration";
  parameter Real c = 0.9 "Elasticity constant of ball";
  parameter Real radius = 0.1 "Radius of the ball";
  Real h(start = 1,fixed=true) "height above ground of ball center";
  Real v(start = 0,fixed=true) "Velocity of the ball";
  Real E "Mechanical energy";
equation
  der(h) = v;
  der(v) = -g;
  E = 9.81*h + 0.5*v*v;
  when h <= radius then
    reinit(v, -c*pre(v));
  end when;
end BouncingBall;`

  // select first example template
  const exampleTemplate = (await jinjaTemplateUrls[
    '/public/modelica/javascript.jinja'
  ]?.()) as string

  templateSource.value = exampleTemplate || ''

  statusMessage.value = 'Example loaded!'
  statusType.value = 'success'
  setTimeout(() => {
    statusMessage.value = ''
  }, 2000)
}

const copyToClipboard = async (text: string, successMessage: string, errorMessage: string) => {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    statusMessage.value = successMessage
    statusType.value = 'success'
    setTimeout(() => {
      statusMessage.value = ''
    }, 1500)
  } catch {
    statusMessage.value = errorMessage
    statusType.value = 'error'
  }
}

const copyJsToClipboard = async () => {
  await copyToClipboard(
    jsSource.value,
    'Generated JavaScript copied to clipboard.',
    'Failed to copy JavaScript to clipboard.',
  )
}

const copyModelicaToClipboard = async () => {
  await copyToClipboard(
    modelicaSource.value,
    'Modelica source copied to clipboard.',
    'Failed to copy Modelica source to clipboard.',
  )
}

const copyTemplateToClipboard = async () => {
  await copyToClipboard(
    templateSource.value,
    'Template source copied to clipboard.',
    'Failed to copy template source to clipboard.',
  )
}

const copyDaeJsonToClipboard = async () => {
  await copyToClipboard(
    JSON.stringify(daeJsonOutput.value, null, 2),
    'DAE JSON copied to clipboard.',
    'Failed to copy DAE JSON to clipboard.',
  )
}

const copyDaePrettyToClipboard = async () => {
  await copyToClipboard(
    daePrettyOutput.value,
    'Pretty DAE output copied to clipboard.',
    'Failed to copy Pretty DAE output to clipboard.',
  )
}

// ---------- Build iframe function code ----------
const buildIframeCode = (compiledJs: string): string => {
  const wrapped = `
  (params, context) => {
    "use strict";
    ${compiledJs}

    const model = Model();

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
      const nx = model.xNames.length;
      const ny = model.yNames.length;

      const xDotZero = new Array(nx).fill(0);
      const y = (Array.isArray(yGuess) && yGuess.length === ny)
        ? yGuess.slice()
        : model.y0.slice();

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
     * Very simple explicit Euler "implicit-DAE aware" simulator.
     *
     * - Time stepping: explicit Euler on x:
     *       x_{k+1} = x_k + dt * f(t_k, x_k)
     * - f is obtained from residual via the trick above.
     * - y is recomputed from algebraic equations at each step.
     *
     * NOTE:
     * - No event handling yet (no when/reinit).
     * - Assumes residual has the structure produced by your Jinja template.
     */
    function simulate(t0, tf, dt, opts) {
      opts = opts || {};
      const nx = model.xNames.length;
      const ny = model.yNames.length;
      const nu = model.uNames.length;

      const x0 = (Array.isArray(opts.x0) && opts.x0.length === nx)
        ? opts.x0.slice()
        : model.x0.slice();

      const f_u = typeof opts.f_u === "function"
        ? opts.f_u
        : ((t) => new Array(nu).fill(0));

      const pOverride = opts.pOverride || null;

      const nSteps = Math.max(1, Math.floor((tf - t0) / dt));

      const tArr = new Array(nSteps + 1);
      const xArr = new Array(nSteps + 1);
      const yArr = new Array(nSteps + 1);
      const uArr = new Array(nSteps + 1);

      let t = t0;
      let x = x0.slice();
      let y = model.y0.slice(); // initial guess for algebraics

      for (let k = 0; k <= nSteps; k++) {
        const u = f_u(t) || new Array(nu).fill(0);

        // Compute xDot and consistent y at (t, x)
        const { xDot, y: yNew } = evalDerivativesAndAlgebraics(
          t,
          x,
          u,
          y,
          pOverride
        );

        // Store current step
        tArr[k] = t;
        xArr[k] = x.slice();
        yArr[k] = yNew.slice();
        uArr[k] = Array.isArray(u) ? u.slice() : Array.from(u);

        if (k === nSteps) break;

        // Explicit Euler update for x
        const xNext = new Array(nx);
        for (let i = 0; i < nx; i++) {
          xNext[i] = x[i] + dt * xDot[i];
        }

        // Advance state and time; keep latest algebraics as guess
        t += dt;
        x = xNext;
        y = yNew;
      }

      return {
        t: tArr,
        x: xArr,
        y: yArr,
        u: uArr,
      };
    }

    const sim = (params && params.sim) || {};
    const t0 = Number.isFinite(sim.t0) ? sim.t0 : 0;
    const tf = Number.isFinite(sim.tf) ? sim.tf : 5;
    const dt = Number.isFinite(sim.dt) ? sim.dt : 0.1;

    const x0 = Array.isArray(sim.x0) && sim.x0.length === model.x0.length
      ? sim.x0.slice()
      : model.x0.slice();

    const f_u = (t) => new Array(model.uNames.length).fill(0);

    const data = simulate(t0, tf, dt, { x0, f_u });

    return {
      meta: {
        t0,
        tf,
        dt,
        nSteps: data.t.length,
        model: {
          xNames: model.xNames,
          uNames: model.uNames,
          yNames: model.yNames,
          cNames: model.cNames,
        },
        context: context || null,
      },
      data,
    };
  }
`
  return wrapped + `\n//# sourceURL=rumoca-generated.js\n`
}

// ---------- Run in sandboxed iframe ----------
const runInSandbox = async () => {
  executionResult.value = {}
  executionError.value = null

  if (!jsSource.value) {
    executionError.value = 'No generated JavaScript. Compile first.'
    return
  }

  const code = buildIframeCode(jsSource.value)
  const id = `rumoca-model-${Date.now()}`
  abortController.value = new AbortController()
  running.value = true

  try {
    const params = {
      sim: {
        t0: simT0.value,
        tf: simTf.value,
        dt: simDt.value,
      },
    }

    const context = {
      source: 'ModelicaPage',
      compiledAt: new Date().toISOString(),
    }

    const result = await executeCodeInIframeSimple(
      {
        id,
        code,
        sourceURL: 'rumoca-generated.js',
        stopSignal: abortController.value.signal,
      },
      params,
      context,
    )

    const isRecord = (v: unknown): v is Record<string, unknown> =>
      typeof v === 'object' && v !== null && !Array.isArray(v)

    if (!isRecord(result)) {
      executionError.value = 'Execution returned invalid result: expected an object.'
      console.error('Invalid execution result:', result)
      return
    }
    executionResult.value = result
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      executionError.value = 'Execution aborted.'
    } else {
      executionError.value = (error as Error).message
      console.error('Iframe execution error:', error)
    }
  } finally {
    running.value = false
  }
}

const stopExecution = () => {
  abortController.value?.abort()
  running.value = false
}

onMounted(async () => {
  await loadWasm()
})
</script>

<style scoped>
.text-code {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 14px;
}
</style>
