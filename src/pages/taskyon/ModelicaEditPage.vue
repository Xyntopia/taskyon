<!--ModelicaEditPage.vue-->
<template>
  <q-layout>
    <TaskyonHeader btn-size="md" min-mode no-chat-button-border>
      <template #left>
        <!-- Header -->
        <div class="text-h6 text-primary q-ma-sm">
          <q-icon :name="matRocketLaunch" /> Taskyon/Rumoca Modelica Editor
        </div>
      </template>
    </TaskyonHeader>
    <q-page-container>
      <FixedHeightPage class="column">
        <DockView
          v-model:node="layout"
          class="col"
          hide-tab-add
          hide-tab-close
          :tab-icons="{
            simulate: matPlayArrow,
            template: matCode,
            modelica: matDescription,
            model: mdiFunctionVariant,
          }"
        >
          <template #actions>
            <!-- Actions -->
            <q-bar flat class="rounded-borders">
              <q-btn
                dense
                color="grey-7"
                :icon="matDelete"
                label="Clear All"
                outline
                @click="clearAll"
              />
              <q-btn
                dense
                color="grey-7"
                :icon="matDescription"
                label="Load Example"
                outline
                @click="loadExample"
              />

              <q-toggle v-model="verbose" dense label="Verbose logging" />

              <q-space />

              <!-- Run / Stop execution -->
              <q-btn
                dense
                flat
                color="secondary"
                :icon="matPlayArrow"
                label="Run in Sandbox"
                :disable="!jsSource"
                :loading="running"
                @click="runInSandbox"
              />
              <q-btn
                v-if="running"
                flat
                dense
                color="negative"
                label="Stop"
                outline
                @click="stopExecution"
              />
            </q-bar>
          </template>

          <template #logs>
            <!-- logs -->
            <q-card bordered flat square style="min-height: 1.5rem">
              <div v-for="(entry, idx) in modelicaLog" :key="idx">> {{ entry.message }}</div>
            </q-card>
          </template>

          <template #modelica>
            <!-- Modelica source -->
            <q-card flat>
              <q-btn
                color="grey-7"
                flat
                dense
                label="Copy"
                :disable="!modelicaSource"
                @click="copyModelicaToClipboard"
              />
              <CodeEditor
                v-model="modelicaSource"
                placeholder="Enter your Modelica code here..."
                language="modelica"
              />
            </q-card>
          </template>

          <template #template>
            <q-card flat>
              <q-btn
                color="grey-7"
                flat
                dense
                label="Copy"
                :disable="!templateSource"
                @click="copyTemplateToClipboard"
              />
              <CodeEditor
                v-model="templateSource"
                placeholder="Enter your Jinja template here..."
                language="jinja2"
              />
            </q-card>
          </template>

          <template #model>
            <div class="q-gutter-xs">
              <q-btn flat dense label="Copy JS" :disable="!jsSource" @click="copyJsToClipboard" />
              <q-btn
                flat
                dense
                label="Copy DAE JSON"
                :disable="!daeJsonOutput"
                @click="copyDaeJsonToClipboard"
              />
              <q-btn
                flat
                dense
                label="Copy Pretty"
                :disable="!daePrettyOutput"
                @click="copyDaePrettyToClipboard"
              />
              <q-separator />

              <div>
                <q-tabs v-model="outputTab" dense narrow-indicator>
                  <q-tab name="js" label="Code" />
                  <q-tab name="daeJson" label="JSON" />
                  <q-tab name="daePretty" label="Pretty" />
                </q-tabs>

                <q-tab-panels v-model="outputTab" animated>
                  <div name="js">
                    <CodeEditor
                      v-model="jsSource"
                      placeholder="Generated Code will appear here..."
                      language="javascript"
                    />
                  </div>

                  <div name="daeJson">
                    <ObjectTreeView v-model="daeJsonOutput" copy-btn read-only />
                  </div>

                  <div name="daePretty">
                    <pre>
                {{ daePrettyOutput }}
                </pre
                    >
                  </div>
                </q-tab-panels>
              </div>
            </div>
          </template>
          <template #simulate>
            <q-card flat>
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

              <q-card-section v-if="executionResult && Object.keys(executionResult).length">
                <ObjectTreeView v-model="executionResult" dense hide-missing read-only copy-btn />
              </q-card-section>
            </q-card>
          </template>

          <template #after>
            <TaskyonIframe
              :tools="tools"
              :configuration="configuration"
              name="modelica-chat"
              :persist="true"
            />
          </template>
        </DockView>
      </FixedHeightPage>
    </q-page-container>
  </q-layout>
</template>

<script setup lang="ts">
import {
  matCode,
  matDelete,
  matDescription,
  matPlayArrow,
  matRocketLaunch,
} from '@quasar/extras/material-icons'
import { mdiFunctionVariant } from '@quasar/extras/mdi-v6'
import { watchDebounced } from '@vueuse/core'
import type { JSONSchema7 } from 'json-schema'
import CodeEditor from 'src/components/CodeEditor.vue'
import type { DockNode } from 'src/components/DockView.vue'
import DockView from 'src/components/DockView.vue'
import TaskyonHeader from 'src/components/taskyon/TaskyonHeader.vue'
import TaskyonIframe from 'src/components/TaskyonIframe.vue'
import ObjectTreeView from 'src/components/varViews/ObjectTreeView.vue'
import type { RumocaModule } from 'src/modules/modelica'
import { buildIframeCode, loadWasm } from 'src/modules/modelica'
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import { useAppStateStore } from 'src/stores/appState'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onMounted, ref } from 'vue'
import { executeCodeInIframeSimple } from '../../../packages/taskyon/src/utils/iframeWorker'
import {
  createChatCompletionTask,
  createTool,
  makeTaskResult,
  toolCall,
} from '../../../packages/tyclient/src'
import FixedHeightPage from '../FixedHeightPage.vue'

const tystate = useTaskyonStore()
const state = useAppStateStore()

// Optional: adjust if you put this elsewhere
type ModelicaLogPhase = 'compile' | 'run' | 'loadWasm' | 'general'
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
const modelicaLog = ref<ModelicaLogEntry[]>([])

function appendModelicaLog(entry: Omit<ModelicaLogEntry, 'timestamp'> & { timestamp?: string }) {
  console.log(entry)
  modelicaLog.value.push({
    timestamp: entry.timestamp ?? new Date().toISOString(),
    phase: entry.phase,
    level: entry.level,
    message: entry.message,
    details: entry.details,
  })
}

/**
 * Tool 1: setModelicaAndTemplate
 * --------------------------------
 * Simple mutator tool that can update Modelica and/or Jinja template source.
 * This is used both for one-off edits and inside the auto-fix loops.
 */
const tools = [
  createTool({
    name: 'setModelicaAndTemplate',
    description:
      'Replace the current Modelica source and/or Jinja template in the editors. ' +
      'If one of the fields is omitted, it is left unchanged.',
    parameters: {
      type: 'object',
      properties: {
        modelica: {
          type: 'string',
          description: 'New Modelica source code to place in the editor (optional).',
        },
        template: {
          type: 'string',
          description: 'New Jinja template source to place in the editor (optional).',
        },
      },
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function({ modelica, template }) {
      if (!modelica && !template) {
        const toolPrompt = `
You are are the taskyon Modelica assistant helping users write and simulate Modelica models using
the Rumoca compiler. You modify the state of an editor and the user you chat with will see the
result in the UI.

You can use the tools provided to set the modelica code.
Always ensure that the modelica code you generate is syntactically correct and safe to run.

Currently, the modelica editor has loaded the following source code:

    ${modelicaSource.value}

Currently, the jinja template editor has loaded the following source code:

    ${templateSource.value}

Currently, the generated code from the modelica source and the jinja template editor
looks like this:

    ${jsSource.value}

The last logs from our compiler are these:

    ${JSON.stringify(modelicaLog.value)}

You are required to use the tool 'setModelicaAndTemplate' whenever you think the user
wants to change the modelica source code or jinja template. The user is currently using that
Interface so instead of proposing changes in the chat, just use the tool
and add them to the editor!
`

        return makeTaskResult([
          createChatCompletionTask({
            prompts: [toolPrompt],
            goal: 'ChooseTool',
            allowedTools: ['setModelicaAndTemplate'],
          }),
        ])
      }

      if (modelica) modelicaSource.value = modelica
      if (template) templateSource.value = template
      return makeTaskResult([
        {
          role: 'assistant',
          content: {
            type: 'message',
            data: `The editor has been updated.`,
          },
        },
        {
          role: 'system',
          content: {
            type: 'return',
            data: 'OK',
          },
        },
      ])
    },
  }),
]

const configuration = computed<partialTyConfiguration | null>(() => {
  if (state.authToken == null) return null
  return {
    llmSettings: {
      //selectedApi: 'taskyon',
      //enableOpenAiTools: false,
      enableToolChooser: true,
      entryNode: toolCall({ name: 'setModelicaAndTemplate', arguments: {} }),
    },
    appConfiguration: {
      guiMode: 'minChat',
      showLogo: false,
      chatSuggestions: [],
      welcomeMsg: 'Ask taskyon for help with using rumoca/modelica!',
    },
    signatureOrKey: tystate.currentKeyString ?? undefined,
  }
})

const layout = ref<DockNode>({
  id: 'editor',
  type: 'container',
  direction: 'row',
  children: [
    {
      id: 'before',
      size: 70,
      type: 'container',
      direction: 'column',
      children: [
        {
          id: 'actions',
          type: 'leaf',
          showTabs: 'never',
          views: ['actions'],
          sizeMode: 'content',
          size: 20,
          activeViewIndex: 0,
        },
        {
          id: 'before',
          size: 80,
          type: 'container',
          direction: 'row',
          children: [
            {
              id: 'editors',
              type: 'leaf',
              size: 85,
              views: ['modelica', 'template'],
              activeViewIndex: 0,
            },
            {
              id: 'simulation',
              type: 'leaf',
              size: 85,
              views: ['model', 'simulate'],
              activeViewIndex: 0,
            },
          ],
        },
        {
          id: 'logs',
          type: 'leaf',
          showTabs: 'never',
          views: ['logs'],
          sizeMode: 'weight',
          size: 10,
          activeViewIndex: 0,
        },
      ],
    },
    {
      id: 'chat',
      type: 'leaf',
      showTabs: 'never',
      views: ['after'],
      size: 30,
      activeViewIndex: 0,
    },
  ],
})

const jinjaTemplateUrls = import.meta.glob('app/public/modelica/*.jinja', {
  query: '?raw', // get the file content
  import: 'default',
  eager: false, // lazy-load each file when used
})

type StatusType = 'loading' | 'success' | 'error' | ''

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
const statusType = ref<StatusType>('loading')
const wasm = ref<RumocaModule | null>(null)

// Simulation / execution state
const simT0 = ref(0)
const simTf = ref(5)
const simDt = ref(0.1)

const executionResult = ref<Record<string, unknown>>({})
const running = ref(false)
const abortController = ref<AbortController | null>(null)

// ---------- Compile Modelica → JS & DAE via new API ----------
// 1. compile_to_json(source, modelName) → JSON string
// 2. render_template(daeJson, template) → rendered string (JS in your case)
watchDebounced(
  [modelicaSource, templateSource],
  () => {
    // If one of the inputs is missing, don't try to compile.
    // But crucially: DO NOT clear jsSource / dae* here.
    if (!modelicaSource.value || !templateSource.value) {
      appendModelicaLog({
        level: 'error',
        phase: 'general',
        message: 'Please provide both Modelica source and template',
      })
      // leave jsSource / daeJsonOutput / daePrettyOutput untouched
      executionResult.value = {}
      return
    }

    loading.value = true
    // We can clear only "raw" debug output and execution results.
    output.value = ''
    appendModelicaLog({
      level: 'info',
      phase: 'compile',
      message: 'Compiling...',
    })
    statusType.value = 'loading'
    executionResult.value = {}

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

      const match = source.match(/(?:model|class|block|connector|record)\s+(\w+)/)
      const modelName = match?.[1] ?? 'Model'

      const jsonStr = m.compile_to_json(source, modelName)
      const compiled = JSON.parse(jsonStr) as {
        dae?: unknown
        dae_native?: unknown
        pretty?: string
        balance?: unknown
      }

      const daeForTemplate = compiled.dae_native ?? compiled.dae
      if (!daeForTemplate) {
        throw new Error('Compilation did not return a DAE object')
      }

      const daeJson = JSON.stringify(daeForTemplate)
      const rendered = m.render_template(daeJson, template)

      // ---- Only here, on success, update the visible "last good" outputs ----
      daeJsonOutput.value = daeForTemplate as Record<string, unknown>
      daePrettyOutput.value = compiled.pretty ?? ''
      output.value = rendered
      jsSource.value = rendered

      appendModelicaLog({
        level: 'success',
        phase: 'compile',
        message: 'Compilation successful!',
      })
    } catch (error) {
      const msg = (error as Error).message
      // Note: we only update messages, NOT the last good JS / DAE
      output.value = `Error: ${msg}`
      appendModelicaLog({
        level: 'success',
        phase: 'compile',
        message: `Compilation failed: ${msg}`,
      })
      console.error('Compilation error:', error)
    } finally {
      loading.value = false
    }
  },
  { debounce: 500, maxWait: 1000 },
)

// ---------- Simple helpers ----------
const clearAll = () => {
  modelicaSource.value = ''
  templateSource.value = ''
  output.value = ''
  jsSource.value = ''
  daeJsonOutput.value = {}
  daePrettyOutput.value = ''
  executionResult.value = {}
  modelicaLog.value = []
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
  E = g*h + 0.5*v*v;
  when h <= radius then
    reinit(v, -c*pre(v));
  end when;
end BouncingBall;`

  // select first example template
  const exampleTemplate = (await jinjaTemplateUrls[
    '/public/modelica/javascript.jinja'
  ]?.()) as string

  templateSource.value = exampleTemplate || ''
}

const copyToClipboard = async (text: string) => {
  if (!text) return
  await navigator.clipboard.writeText(text)
}

const copyJsToClipboard = async () => {
  await copyToClipboard(jsSource.value)
}

const copyModelicaToClipboard = async () => {
  await copyToClipboard(modelicaSource.value)
}

const copyTemplateToClipboard = async () => {
  await copyToClipboard(templateSource.value)
}

const copyDaeJsonToClipboard = async () => {
  await copyToClipboard(JSON.stringify(daeJsonOutput.value, null, 2))
}

const copyDaePrettyToClipboard = async () => {
  await copyToClipboard(daePrettyOutput.value)
}

// ---------- Run in sandboxed iframe ----------
const runInSandbox = async () => {
  executionResult.value = {}

  if (!jsSource.value) {
    appendModelicaLog({
      level: 'error',
      phase: 'run',
      message: 'No generated JavaScript. Compile first.',
    })
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
      appendModelicaLog({
        level: 'error',
        phase: 'run',
        message: `Simulation returned invalid result: expected an object. ${JSON.stringify(result)}`,
      })
      return
    }
    executionResult.value = result
    appendModelicaLog({
      level: 'error',
      phase: 'run',
      message: `Simulation was succesful!`,
    })
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      appendModelicaLog({
        level: 'warning',
        phase: 'run',
        message: 'Execution aborted.',
      })
    } else {
      appendModelicaLog({
        level: 'warning',
        phase: 'run',
        message: `Iframe execution error: ${(error as Error).message}`,
      })
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
  try {
    const wasmModule = await loadWasm()

    wasm.value = wasmModule
    wasmLoaded.value = true
    appendModelicaLog({
      level: 'success',
      phase: 'general',
      message: 'WASM module loaded successfully! Ready to compile.',
    })
  } catch (error) {
    appendModelicaLog({
      level: 'error',
      phase: 'general',
      message: `Failed to load WASM: ${(error as Error).message}`,
    })
  }
})
</script>
