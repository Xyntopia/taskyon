<template>
  <q-page padding>
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

    <q-card class="q-mb-md">
      <q-card-section>
        <div class="row q-gutter-sm items-center">
          <q-btn
            color="primary"
            :icon="matPlayArrow"
            :label="loading ? 'Compiling...' : 'Compile'"
            :loading="loading"
            :disable="!wasmLoaded"
            @click="compile"
          />
          <q-btn color="grey-7" :icon="matDelete" label="Clear All" outline @click="clearAll" />
          <q-btn
            color="grey-7"
            :icon="matDescription"
            label="Load Example"
            outline
            @click="loadExample"
          />
          <q-toggle v-model="verbose" label="Verbose logging" />
        </div>
      </q-card-section>
    </q-card>

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

    <q-card>
      <q-card-section>
        <div class="text-h6"><q-icon :name="matOutput" /> Output</div>
      </q-card-section>
      <q-card-section>
        <q-input
          v-model="output"
          type="textarea"
          outlined
          readonly
          placeholder="Compilation output will appear here..."
          :rows="15"
          input-class="text-code"
          bg-color="grey-10"
          dark
        />
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type * as WasmTypes from '../../../packages/rumoca/wasm/pkg/rumoca_wasm'
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

type StatusType = 'loading' | 'success' | 'error' | ''
type WasmModule = typeof WasmTypes

const modelicaSource = ref('')
const templateSource = ref('')
const output = ref('')
const verbose = ref(false)
const loading = ref(false)
const wasmLoaded = ref(false)
const statusMessage = ref('Loading WASM module...')
const statusType = ref<StatusType>('loading')
const wasm = ref<WasmModule | null>(null)

const loadWasm = async () => {
  try {
    // Import the WASM module from your pkg directory
    // Adjust the path based on your project structure
    const wasmModule = await import('../../../packages/rumoca/wasm/pkg/rumoca_wasm')

    // Initialize the WASM module - this returns InitOutput
    const initOutput = await wasmModule.default()

    // Call the start function from the InitOutput
    if (initOutput && initOutput.start) {
      initOutput.start()
    }

    wasm.value = wasmModule
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

const compile = () => {
  if (!modelicaSource.value || !templateSource.value) {
    statusMessage.value = 'Please provide both Modelica source and template'
    statusType.value = 'error'
    return
  }

  loading.value = true
  output.value = ''
  statusMessage.value = 'Compiling...'
  statusType.value = 'loading'

  try {
    if (!wasm.value) {
      throw new Error('WASM module not loaded')
    }

    const result = wasm.value.translate_modelica_to_template(
      modelicaSource.value,
      templateSource.value,
      verbose.value,
    )
    output.value = result
    statusMessage.value = 'Compilation successful!'
    statusType.value = 'success'
    setTimeout(() => {
      statusMessage.value = ''
    }, 3000)
  } catch (error) {
    output.value = `Error: ${(error as Error).message}`
    statusMessage.value = `Compilation failed: ${(error as Error).message}`
    statusType.value = 'error'
    console.error('Compilation error:', error)
  } finally {
    loading.value = false
  }
}

const clearAll = () => {
  modelicaSource.value = ''
  templateSource.value = ''
  output.value = ''
  statusMessage.value = ''
}

const loadExample = async () => {
  modelicaSource.value = `model SimpleCircuit
  Real voltage;
  Real current;
  parameter Real resistance = 10;
equation
  voltage = current * resistance;
  voltage = 5.0;
end SimpleCircuit;`

  templateSource.value = await fetch('./modelica/javascript.jinja').then((r) => r.text())

  statusMessage.value = 'Example loaded!'
  statusType.value = 'success'
  setTimeout(() => {
    statusMessage.value = ''
  }, 2000)
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
