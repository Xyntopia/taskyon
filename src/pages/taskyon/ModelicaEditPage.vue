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
          v-model:node="initialLayout"
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

              <q-separator vertical class="q-mx-sm" />

              <!-- Version Info -->
              <div style="font-size: x-small" class="text-center">
                Ver:<br />{{ currentVersionIndex + 1 }} / {{ documentVersions.length }}
              </div>

              <!-- Version Navigation -->
              <q-btn
                flat
                dense
                round
                :icon="matNavigateBefore"
                title="Previous Version"
                :disable="currentVersionIndex === 0"
                @click="goToPreviousVersion"
              />
              <q-btn
                flat
                dense
                round
                :icon="matNavigateNext"
                title="Next Version"
                :disable="currentVersionIndex === documentVersions.length - 1"
                @click="goToNextVersion"
              />
              <q-btn
                flat
                dense
                round
                :icon="mdiTextBoxPlus"
                color="secondary"
                title="Create New Version Snapshot"
                @click="handleCreateNewVersionClick"
              />

              <!-- Export / Save -->
              <q-btn-dropdown
                dense
                flat
                color="secondary"
                :icon="matSave"
                label="Save"
                dropdown-icon=""
              >
                <q-list dense style="min-width: 220px">
                  <q-item v-close-popup clickable @click="exportFile('modelica')">
                    <q-item-section>Export Modelica</q-item-section>
                  </q-item>
                  <q-item v-close-popup clickable @click="exportFile('template')">
                    <q-item-section>Export Template</q-item-section>
                  </q-item>
                  <q-separator />
                  <q-item v-close-popup clickable @click="exportFile('js')">
                    <q-item-section>Export Generated JS</q-item-section>
                  </q-item>
                  <q-item v-close-popup clickable @click="exportFile('daePretty')">
                    <q-item-section>Export Pretty DAE</q-item-section>
                  </q-item>
                  <q-item v-close-popup clickable @click="exportFile('daeJson')">
                    <q-item-section>Export DAE JSON</q-item-section>
                  </q-item>
                </q-list>
              </q-btn-dropdown>

              <q-space />

              <q-toggle
                v-model="showAllInPrompt"
                dense
                size="sm"
                color="secondary"
                label="AI sees all"
              />

              <!-- Run / Stop execution -->
              <q-btn
                dense
                flat
                color="secondary"
                :icon="matPlayArrow"
                label="Run in Sandbox"
                :disable="!jsSource || isHtmlOutput"
                :loading="running"
                @click="runInSandbox(jsSource)"
              />
              <q-btn
                v-if="isHtmlOutput"
                dense
                flat
                color="secondary"
                :icon="matOpenInNew"
                label="Popup window"
                :disable="!jsSource"
                @click="openGeneratedHtmlPopup"
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
              <q-expansion-item
                v-for="(entry, idx) in modelicaLog"
                :key="idx"
                dense
                :label="entry.message"
              >
                <pre>{{ safeYamlDump(entry) }}</pre>
              </q-expansion-item>
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
              <div class="row items-center q-gutter-xs q-pa-xs">
                <q-select
                  v-model="selectedTemplateKey"
                  :options="templateOptions"
                  dense
                  outlined
                  options-dense
                  label="Template"
                  style="min-width: 220px"
                  :disable="templateOptions.length === 0"
                  option-label="label"
                  option-value="value"
                  emit-value
                  map-options
                />
                <q-space />
                <q-btn
                  color="grey-7"
                  flat
                  dense
                  label="Copy"
                  :disable="!templateSource"
                  @click="copyTemplateToClipboard"
                />
              </div>

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
                    <ObjectView v-model="daeJsonOutput" copy-btn read-only enable-expert-mode />
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
                <ObjectView
                  v-model="executionResult"
                  dense
                  hide-missing
                  read-only
                  copy-btn
                  enable-expert-mode
                />
              </q-card-section>
            </q-card>
          </template>

          <template #assistant>
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
  matNavigateBefore,
  matNavigateNext,
  matOpenInNew,
  matPlayArrow,
  matRocketLaunch,
  matSave,
} from '@quasar/extras/material-icons'
import { mdiFunctionVariant, mdiTextBoxPlus } from '@quasar/extras/mdi-v6'
import { createChatCompletionTask, createTool, makeTaskResult, toolCall } from '@taskyon/taskyon'
import { watchDebounced } from '@vueuse/core'
import type { JSONSchema7 } from 'json-schema'
import { Notify } from 'quasar'
import CodeEditor from 'src/components/CodeEditor.vue'
import type { DockNode } from 'src/components/DockView.vue'
import DockView from 'src/components/DockView.vue'
import TaskyonHeader from 'src/components/taskyon/TaskyonHeader.vue'
import TaskyonIframe from 'src/components/TaskyonIframe.vue'
import ObjectView from 'src/components/varViews/ObjectView.vue'
import type { RumocaModule } from 'src/modules/modelica/modelica'
import { buildIframeCode, loadWasm } from 'src/modules/modelica/modelica'
import { syncStateWithOPFSFolder } from 'src/modules/saveState'
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import { copyToClipboard } from 'src/modules/utils'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onMounted, ref } from 'vue'
import { validateJavaScriptInSandbox } from '../../../packages/taskyon/src/utils/checkJsSyntax'
import { executeCodeInIframeSimple } from '../../../packages/taskyon/src/utils/iframeWorker'
import { safeYamlDump } from '../../../packages/taskyon/src/utils/yamlUtils'
import FixedHeightPage from '../FixedHeightPage.vue'

const tystate = useTaskyonStore()

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
 * Tools
 *
 * We mirror the CodingPage approach:
 *  - modelicaDocumentAssistant: assembles prompt context with line numbers
 *  - updateModelicaDocument: applies line-based patches and creates version snapshots
 */

type ModelicaFilePath = 'modelica' | 'template'

type LinePatchOperation = {
  type: 'replace' | 'insert' | 'delete'
  lineStart: number
  lineEnd?: number
  text?: string
}

const tools = [
  createTool({
    name: 'modelicaDocumentAssistant',
    description:
      'Main assistant that inspects the current Modelica and template sources and decides on edits.',
    parameters: {
      type: 'object',
      properties: {
        showAll: {
          type: 'boolean',
          description:
            'If true, include the full contents of both Modelica and template (with line numbers). If false, include only Modelica in full.',
        },
      },
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: (opts) => {
      const showAll = opts.showAll ?? showAllInPrompt.value ?? true

      const modelicaWithLines = formatContentWithLineNumbers(modelicaSource.value)
      const templateWithLines = formatContentWithLineNumbers(templateSource.value)

      const sourcesSection = showAll
        ? `## Modelica Source\n\n\
\
\
\`\`\`\n${modelicaWithLines}\n\`\`\`\n\n## Template Source\n\n\`\`\`\n${templateWithLines}\n\`\`\``
        : `## Modelica Source\n\n\`\`\`\n${modelicaWithLines}\n\`\`\`\n\n## Template Source\n\nTemplate source is hidden because showAll is false.`

      const contextPrompt = `
You are the Taskyon Modelica assistant.

You can edit two documents:
- Modelica source
- Jinja template source

The UI shows the results live.

${sourcesSection}

## Generated JavaScript
\`\`\`\n${jsSource.value}\n\`\`\`

## Pretty DAE
\`\`\`\n${daePrettyOutput.value}\n\`\`\`

## Recent logs
\`\`\`\n${JSON.stringify(modelicaLog.value.slice(-30), null, 2)}\n\`\`\`

## Simulation settings
\`\`\`\n${JSON.stringify({ t0: simT0.value, tf: simTf.value, dt: simDt.value }, null, 2)}\n\`\`\`

## Available Tool: updateModelicaDocument
- Apply line-based patches to modelica or template.
- You can update both in a single call.

## CRITICAL BEHAVIOR RULES
1. For any edit request, you MUST call updateModelicaDocument. Prefer patches.
2. Do not include line numbers in patch text.
3. Do NOT set newContent to an empty string. Omit newContent unless you intend a full replacement.
4. If uncertain, ask 1–2 clarification questions.
5. If compilation is failing, you may attempt one follow-up edit at most, preferring Modelica changes first.
`

      return makeTaskResult([
        createChatCompletionTask({
          prompts: [contextPrompt],
          goal: 'ChooseTool',
          allowedTools: ['updateModelicaDocument'],
        }),
      ])
    },
  }),

  createTool({
    name: 'updateModelicaDocument',
    description:
      'Apply line-based updates to Modelica and or template and create a version snapshot.',
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          description: 'Updates to apply. You can patch both modelica and template in one call.',
          items: {
            type: 'object',
            properties: {
              filePath: {
                type: 'string',
                enum: ['modelica', 'template'],
                description: 'Which document to update.',
              },
              patches: {
                type: 'array',
                description:
                  'Line-based patch operations. Lines are 1-based indexed. Do not overlap patches.',
                items: {
                  type: 'object',
                  properties: {
                    type: { enum: ['replace', 'insert', 'delete'], type: 'string' },
                    lineStart: { type: 'number' },
                    lineEnd: { type: 'number' },
                    text: { type: 'string' },
                  },
                  required: ['type', 'lineStart'],
                },
              },
              newContent: {
                type: 'string',
                description: 'Replace full content. Only do this if patching is not feasible.',
              },
            },
            required: ['filePath'],
            additionalProperties: false,
          },
        },
        description: { type: 'string', description: 'Summary of changes' },
      },
      required: ['updates'],
      additionalProperties: false,
    } as const satisfies JSONSchema7,
    function: ({ updates, description }) => {
      const totalEdits = updates.reduce((acc, update) => {
        const patchCount = Array.isArray(update.patches) ? update.patches.length : 0
        const newContentStr = typeof update.newContent === 'string' ? update.newContent : ''
        const hasMeaningfulNewContent = newContentStr.trim().length > 0
        return acc + patchCount + (hasMeaningfulNewContent ? 1 : 0)
      }, 0)

      if (totalEdits === 0) {
        Notify.create({
          type: 'warning',
          message: 'No edits provided in updateModelicaDocument call',
        })
        return makeTaskResult([
          createChatCompletionTask({
            prompts: [
              'You called updateModelicaDocument but did not provide any patches or newContent. Provide edits or do not call the tool.',
            ],
            goal: 'ChooseTool',
            allowedTools: ['updateModelicaDocument'],
          }),
        ])
      }

      // Merge updates by filePath to enforce stable application.
      // Safety: ignore empty-string newContent to prevent accidental wiping.
      const mergedUpdates = updates.reduce(
        (acc, update) => {
          const key = update.filePath as ModelicaFilePath
          const existing = acc[key]

          const incomingNewContent =
            typeof update.newContent === 'string' ? update.newContent : undefined
          const hasIncomingNewContent =
            typeof incomingNewContent === 'string' && incomingNewContent.trim().length > 0
          const incomingPatches = Array.isArray(update.patches) ? update.patches : []

          if (existing) {
            if (hasIncomingNewContent) existing.newContent = incomingNewContent
            existing.patches = [...(existing.patches || []), ...incomingPatches]
          } else {
            acc[key] = {
              filePath: key,
              newContent: hasIncomingNewContent ? incomingNewContent : undefined,
              patches: incomingPatches,
            } as (typeof updates)[0]
          }
          return acc
        },
        {} as Record<ModelicaFilePath, (typeof updates)[0]>,
      )

      const beforeModelica = modelicaSource.value
      const beforeTemplate = templateSource.value

      const changesLog: string[] = []

      for (const [filePath, update] of Object.entries(mergedUpdates) as [
        ModelicaFilePath,
        (typeof updates)[0],
      ][]) {
        const originalContent = filePath === 'modelica' ? beforeModelica : beforeTemplate
        let updatedContent = originalContent

        const hasNewContent =
          typeof update.newContent === 'string' && update.newContent.trim().length > 0

        if (hasNewContent) {
          updatedContent = update.newContent as string
          changesLog.push(`Replaced content of ${filePath}`)
        }

        if (update.patches && update.patches.length > 0) {
          updatedContent = applyLinePatches(updatedContent, update.patches as LinePatchOperation[])
          changesLog.push(`Patched ${filePath} (${update.patches.length} ops)`)
        }

        if (filePath === 'modelica') modelicaSource.value = updatedContent
        if (filePath === 'template') templateSource.value = updatedContent
      }

      createNewVersion(`AI update: ${description || changesLog.join(', ')}`)

      return makeTaskResult([
        {
          role: 'system',
          content: {
            type: 'message',
            data: `Updates applied:\n${changesLog.join('\n')}`,
          },
        },
        ...(description
          ? [
              {
                role: 'system' as const,
                content: { type: 'message' as const, data: description },
              },
            ]
          : []),
      ])
    },
  }),
]

const configuration = computed<partialTyConfiguration | null>(() => {
  if (tystate.currentKeyString == null) return null
  return {
    llmSettings: {
      enableToolChooser: true,
      entryNode: toolCall({ name: 'modelicaDocumentAssistant', arguments: {} }),
    },
    appConfiguration: {
      guiMode: 'minChat',
      expertMode: true,
      showLogo: false,
      chatSuggestions: [],
      welcomeMsg: 'I can edit your Modelica model and template. Ask me to change them.',
    },
    signatureOrKey: tystate.currentKeyString ?? undefined,
  }
})

const initialLayout = ref<DockNode>({
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
      collapsed: true,
      views: ['assistant'],
      size: 30,
      activeViewIndex: 0,
    },
  ],
})

const jinjaTemplateUrls = import.meta.glob('src/modules/modelica/*.jinja', {
  query: '?raw', // get the file content
  import: 'default',
  eager: false, // lazy-load each file when used
})

const selectedTemplateKey = ref<string>('')
const templateOptions = computed(() =>
  Object.keys(jinjaTemplateUrls)
    .sort()
    .map((key) => ({
      label: key.split('/').pop() ?? key,
      value: key,
    })),
)

// Prevent template auto-reload while restoring persisted state.
const isHydratingState = ref(true)
// After hydration, the selectedTemplateKey watcher may still fire due to debounce.
// This flag skips exactly one template file load for the hydrated key, ensuring
// we restore the persisted templateSource exactly.
const skipNextTemplateLoadForKey = ref<string>('')

// --- Versioning ---

type ModelicaVersion = {
  modelica: string
  template: string
  timestamp: string
  description?: string
}

const documentVersions = ref<ModelicaVersion[]>([])
const currentVersionIndex = ref(0)
const showAllInPrompt = ref(true)

function createNewVersion(desc?: string) {
  const snapshot: ModelicaVersion = {
    modelica: modelicaSource.value,
    template: templateSource.value,
    timestamp: new Date().toISOString(),
    description: desc || `Version ${documentVersions.value.length + 1}`,
  }
  documentVersions.value = [...documentVersions.value, snapshot]
  currentVersionIndex.value = documentVersions.value.length - 1
  Notify.create({ message: 'Version snapshot saved', color: 'positive', timeout: 800 })
}

function jumpToVersion(idx: number) {
  currentVersionIndex.value = idx
  const target = documentVersions.value[idx]
  if (!target) return
  modelicaSource.value = target.modelica
  templateSource.value = target.template
}

function goToPreviousVersion() {
  if (currentVersionIndex.value > 0) jumpToVersion(currentVersionIndex.value - 1)
}

function goToNextVersion() {
  if (currentVersionIndex.value < documentVersions.value.length - 1) {
    jumpToVersion(currentVersionIndex.value + 1)
  }
}

function handleCreateNewVersionClick() {
  createNewVersion()
}

type StatusType = 'loading' | 'success' | 'error' | ''

const modelicaSource = ref('')
const templateSource = ref('')
const output = ref('') // legacy raw output if needed
const jsSource = ref('') // generated JS shown + executed
const daeJsonOutput = ref<Record<string, unknown>>({}) // DAE JSON (pretty-printed)
const daePrettyOutput = ref('') // Pretty DAE textual representation (from WASM)
const outputTab = ref<'js' | 'daeJson' | 'daePretty'>('js')

const isHtmlOutput = computed(() => {
  const s = (jsSource.value ?? '').trimStart()
  return /^<!doctype\s+html/i.test(s) || /^<html\b/i.test(s)
})

const verbose = ref(false)
const loading = ref(false)
const wasmLoaded = ref(false)
const statusType = ref<StatusType>('loading')
const wasm = ref<RumocaModule | null>(null)

// Simulation / execution state
const simT0 = ref(0)
const simTf = ref(5)
const simDt = ref(0.01)

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

watchDebounced(
  selectedTemplateKey,
  async (key) => {
    if (!key) return
    if (isHydratingState.value) return
    if (skipNextTemplateLoadForKey.value && key === skipNextTemplateLoadForKey.value) {
      skipNextTemplateLoadForKey.value = ''
      return
    }

    const loader = jinjaTemplateUrls[key]
    if (!loader) return

    const content = (await loader()) as string
    templateSource.value = content ?? ''
  },
  { debounce: 50, maxWait: 200 },
)

// --- Helper functions for line-based patching ---

function formatContentWithLineNumbers(content: string): string {
  const lines = (content ?? '').split('\n')
  return lines
    .map((line, index) => {
      const lineNum = (index + 1).toString().padStart(4, ' ')
      return `${lineNum}: ${line}`
    })
    .join('\n')
}

function applyLinePatches(text: string, patches: LinePatchOperation[]): string {
  const lines = (text ?? '').split('\n')
  const sortedPatches = [...patches].sort((a, b) => b.lineStart - a.lineStart)

  for (const patch of sortedPatches) {
    const startIdx = patch.lineStart - 1
    if (startIdx < 0) continue

    if (patch.type === 'insert') {
      const newLines = (patch.text || '').split('\n')
      lines.splice(startIdx, 0, ...newLines)
      continue
    }

    const endLine = patch.lineEnd ?? patch.lineStart
    const deleteCount = endLine - patch.lineStart + 1

    if (patch.type === 'delete') {
      lines.splice(startIdx, deleteCount)
    } else if (patch.type === 'replace') {
      const newLines = (patch.text || '').split('\n')
      lines.splice(startIdx, deleteCount, ...newLines)
    }
  }

  return lines.join('\n')
}

// ---------- Simple helpers ----------

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

function exportFile(target: ExportTarget) {
  const now = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')

  if (target === 'modelica') {
    downloadTextFile({
      fileName: `model_${now}.mo`,
      content: modelicaSource.value,
      mime: 'text/plain',
    })
    return
  }
  if (target === 'template') {
    downloadTextFile({
      fileName: `template_${now}.jinja`,
      content: templateSource.value,
      mime: 'text/plain',
    })
    return
  }
  if (target === 'js') {
    downloadTextFile({
      fileName: `generated_${now}.js`,
      content: jsSource.value,
      mime: 'text/javascript',
    })
    return
  }
  if (target === 'daePretty') {
    downloadTextFile({
      fileName: `dae_${now}.txt`,
      content: daePrettyOutput.value,
      mime: 'text/plain',
    })
    return
  }
  if (target === 'daeJson') {
    downloadTextFile({
      fileName: `dae_${now}.json`,
      content: JSON.stringify(daeJsonOutput.value ?? {}, null, 2),
      mime: 'application/json',
    })
    return
  }

  // exhaustive
  Notify.create({ type: 'warning', message: `Unknown export target: ${String(target)}` })
}

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

  // select template that contains "javascript"
  const sel = Object.keys(jinjaTemplateUrls).find((key) => key.includes('javascript.jinja'))
  if (!sel) return

  selectedTemplateKey.value = sel
  const exampleTemplate = (await jinjaTemplateUrls[sel]!()) as string
  templateSource.value = exampleTemplate || ''
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

function openGeneratedHtmlPopup() {
  if (!jsSource.value) return
  if (!isHtmlOutput.value) return

  const blob = new Blob([jsSource.value], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const w = window.open(url, '_blank', 'noopener,noreferrer,popup,width=1200,height=800')
  if (!w) {
    URL.revokeObjectURL(url)
    Notify.create({
      type: 'warning',
      message: 'Popup blocked by browser. Allow popups for this site to open the standalone HTML.',
    })
    return
  }

  // Cleanup the blob URL after the popup had time to load it.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// ---------- Run in sandboxed iframe ----------
const runInSandbox = async (jsSource: string | undefined) => {
  executionResult.value = {}

  if (!jsSource) {
    appendModelicaLog({
      level: 'error',
      phase: 'run',
      message: 'No generated JavaScript. Compile first.',
    })
    return
  }

  const msg = await validateJavaScriptInSandbox(jsSource)
  if (msg.valid === false) {
    appendModelicaLog({
      level: 'error',
      phase: 'run',
      message: `Generated JavaScript has syntax errors: ${msg.message}`,
      details: msg,
    })
    return
  }

  const code = buildIframeCode(jsSource)
  const id = `rumoca-model-worker`
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
  // Restore and persist the editor state (including dock layout) to OPFS.
  // Important: we restore templateSource exactly as last edited; we do not re-load it from file
  await syncStateWithOPFSFolder('modelicaEditPage', {
    initialLayout,
    selectedTemplateKey,
    modelicaSource,
    templateSource,
    verbose,
    outputTab,
    simT0,
    simTf,
    simDt,
    documentVersions,
    currentVersionIndex,
    showAllInPrompt,
  })
  // Ensure we do not auto-overwrite the restored templateSource from file
  // due to a debounced selectedTemplateKey watcher firing after hydration.
  skipNextTemplateLoadForKey.value = selectedTemplateKey.value
  isHydratingState.value = false
  // Ensure we always have at least one version snapshot
  if (documentVersions.value.length === 0) {
    createNewVersion('Initial')
  }

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
