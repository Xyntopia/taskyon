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
      <div class="col-12 col-md-6">
        <q-card>
          <q-card-section>
            <div class="text-h6"><q-icon :name="matDescription" /> Modelica Source</div>
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

      <div class="col-12 col-md-6">
        <q-card>
          <q-card-section>
            <div class="text-h6"><q-icon :name="matCode" /> Template Source</div>
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

    <!-- Output row: JS + Execution -->
    <div class="row q-col-gutter-md">
      <!-- Generated JS -->
      <div class="col-12 col-md-6">
        <q-card>
          <q-card-section class="row items-center justify-between">
            <div class="text-h6"><q-icon :name="matCode" /> Generated JavaScript</div>
            <q-btn
              color="grey-7"
              flat
              dense
              label="Copy"
              :disable="!jsSource"
              @click="copyJsToClipboard"
            />
          </q-card-section>
          <q-card-section>
            <q-input
              v-model="jsSource"
              type="textarea"
              outlined
              readonly
              placeholder="Generated JavaScript will appear here..."
              :rows="20"
              input-class="text-code"
              bg-color="grey-10"
              dark
            />
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

          <q-card-section v-if="executionResult">
            <ObjectTreeView v-model="executionResult" />
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
import ObjectTreeView from 'src/components/ObjectTreeView.vue'

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

    // 2) Try to initialize Rayon thread pool, but do NOT treat failure as fatal
    if ('wasm_init' in wasmModule && typeof wasmModule.wasm_init === 'function') {
      try {
        // Using 1 thread here; but even this may try to create workers,
        // so we just swallow errors and fall back to single-threaded behavior.
        await wasmModule.wasm_init(1)
      } catch (e) {
        console.warn(
          'Rumoca wasm_init (thread pool) failed – continuing in single-threaded mode:',
          e,
        )
        // IMPORTANT: do not rethrow – we want the rest of the module to still be usable.
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

// ---------- Compile Modelica → JS via new API ----------
// 1. compile_to_json(source, modelName) → JSON string
// 2. render_template(daeJson, template) → rendered string (JS in your case)
watch([modelicaSource, templateSource], () => {
  if (!modelicaSource.value || !templateSource.value) {
    statusMessage.value = 'Please provide both Modelica source and template'
    statusType.value = 'error'
    return
  }

  loading.value = true
  output.value = ''
  jsSource.value = ''
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

    // Step 1: compile Modelica → DAE JSON
    const jsonStr = m.compile_to_json(source, modelName)
    const compiled = JSON.parse(jsonStr) as {
      dae?: unknown
      dae_native?: unknown
      pretty?: string
      balance?: unknown
    }

    // Prefer dae_native (matches what render_template expects in the worker example)
    const daeForTemplate = compiled.dae_native ?? compiled.dae
    if (!daeForTemplate) {
      throw new Error('Compilation did not return a DAE object')
    }

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
  statusMessage.value = ''
  executionResult.value = {}
  executionError.value = null
}

const loadExample = async () => {
  modelicaSource.value = `model BouncingBall "The 'classic' bouncing ball model"
  parameter Real e=0.8 "Coefficient of restitution";
  parameter Real h0=1.0 "Initial height";
  Real h = 1.0 "Height";
  Real v "Velocity";
  Real z;
equation
  z = 2*h + v;
  v = der(h);
  der(v) = -9.81;
  when h<0 then
    reinit(v, -e*pre(v));
  end when;
end BouncingBall;`

  // select first example template
  const exampleTemplate = (await jinjaTemplateUrls['/public/modelica/base_dae.jinja']?.()) as string

  templateSource.value = exampleTemplate || ''

  statusMessage.value = 'Example loaded!'
  statusType.value = 'success'
  setTimeout(() => {
    statusMessage.value = ''
  }, 2000)
}

const copyJsToClipboard = async () => {
  if (!jsSource.value) return
  try {
    await navigator.clipboard.writeText(jsSource.value)
    statusMessage.value = 'Generated JavaScript copied to clipboard.'
    statusType.value = 'success'
    setTimeout(() => {
      statusMessage.value = ''
    }, 1500)
  } catch {
    statusMessage.value = 'Failed to copy to clipboard.'
    statusType.value = 'error'
  }
}

// ---------- Build iframe function code ----------
const buildIframeCode = (compiledJs: string): string => {
  const wrapped = `
    (params, context) => {
      "use strict";
      ${compiledJs}

      const model = new Model();

      const sim = (params && params.sim) || {};
      const t0 = Number.isFinite(sim.t0) ? sim.t0 : 0;
      const tf = Number.isFinite(sim.tf) ? sim.tf : 5;
      const dt = Number.isFinite(sim.dt) ? sim.dt : 0.1;

      const x0 = Array.isArray(sim.x0) && sim.x0.length === model.x0.length
        ? sim.x0.slice()
        : model.x0.slice();

      const f_u = (t) => new Array(model.uNames.length).fill(0);

      const data = model.simulate(t0, tf, dt, { x0, f_u });

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
