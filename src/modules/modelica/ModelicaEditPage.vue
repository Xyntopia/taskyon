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
            uiTemplate: matCode,
            solver: matCode,
            modelica: matDescription,
            model: mdiFunctionVariant,
          }"
        >
          <template #actions>
            <!-- Actions -->
            <q-bar flat class="rounded-borders bg-transparent q-ma-xs">
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

              <q-separator vertical class="q-mx-sm" />

              <!-- Project -->
              <q-select
                v-model="currentProjectId"
                :options="availableProjectIds"
                dense
                standout
                label="Project"
                style="max-width: 260px"
                :disable="availableProjectIds.length === 0"
                @update:model-value="onProjectSelected"
              />
              <q-btn
                dense
                flat
                color="secondary"
                label="New"
                title="Create a new project"
                @click="createNewProjectDialog"
              />
              <q-btn
                dense
                flat
                color="grey-7"
                :icon="matRefresh"
                title="Refresh project list"
                @click="refreshAvailableProjects"
              />
              <q-btn
                dense
                flat
                color="negative"
                :icon="matDelete"
                title="Delete current project"
                :disable="!currentProjectId"
                @click="deleteCurrentProject"
              />

              <q-btn
                dense
                color="grey-7"
                label="Export"
                outline
                :disable="!projectFile"
                @click="exportProjectJson"
              />
              <q-btn dense color="grey-7" label="Import" outline @click="triggerImportProject" />

              <input
                ref="projectImportEl"
                type="file"
                accept="application/json,.json"
                style="display: none"
                @change="onImportProjectFile"
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
                  <q-item v-close-popup clickable @click="exportFile('modelica', modelicaSource)">
                    <q-item-section>Export Modelica</q-item-section>
                  </q-item>
                  <q-item v-close-popup clickable @click="exportFile('template', templateSource)">
                    <q-item-section>Export Template</q-item-section>
                  </q-item>
                  <q-separator />
                  <q-item v-close-popup clickable @click="exportFile('js', jsSource)">
                    <q-item-section>Export Generated JS</q-item-section>
                  </q-item>
                  <q-item v-close-popup clickable @click="exportFile('daePretty', daePrettyOutput)">
                    <q-item-section>Export Pretty DAE</q-item-section>
                  </q-item>
                  <q-item
                    v-close-popup
                    clickable
                    @click="exportFile('daeJson', JSON.stringify(daeJsonOutput ?? {}, null, 2))"
                  >
                    <q-item-section>Export DAE JSON</q-item-section>
                  </q-item>
                  <q-separator />
                  <q-item
                    v-close-popup
                    clickable
                    @click="
                      exportGeneratedUiHtml(
                        hasUiTemplate,
                        activeUiTemplateSource,
                        jsSource,
                        activeSolverSource,
                        currentProjectId,
                      )
                    "
                  >
                    <q-item-section>Export UI HTML</q-item-section>
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
                v-if="hasUiTemplate"
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

                <q-input
                  v-model="newTemplateId"
                  dense
                  outlined
                  label="New template id"
                  style="max-width: 180px"
                />
                <q-btn
                  color="grey-7"
                  flat
                  dense
                  label="Add"
                  :disable="!newTemplateId"
                  @click="addCustomTemplate()"
                />

                <q-space />

                <q-btn
                  color="grey-7"
                  flat
                  dense
                  label="Delete"
                  :disable="!canDeleteSelectedTemplate"
                  @click="deleteSelectedTemplate()"
                />

                <q-btn
                  color="grey-7"
                  flat
                  dense
                  label="Copy"
                  :disable="!templateSource"
                  @click="copyTemplateToClipboard"
                />
              </div>

              <div style="position: relative">
                <CodeEditor
                  v-model="templateSource"
                  placeholder="Enter your Jinja template here..."
                  language="jinja2"
                />
                <div
                  v-if="isTemplateBuiltin"
                  style="
                    position: absolute;
                    inset: 0;
                    background: rgba(255, 255, 255, 0.01);
                    pointer-events: all;
                  "
                  title="Built-in templates are read-only"
                />
              </div>
            </q-card>
          </template>

          <template #uiTemplate>
            <q-card flat>
              <div class="row items-center q-gutter-xs q-pa-xs">
                <q-select
                  v-model="selectedUiTemplateId"
                  :options="uiTemplateOptions"
                  dense
                  outlined
                  options-dense
                  label="UI Template"
                  style="min-width: 220px"
                  :disable="uiTemplateOptions.length === 0"
                  option-label="label"
                  option-value="value"
                  emit-value
                  map-options
                />

                <q-input
                  v-model="newUiTemplateId"
                  dense
                  outlined
                  label="New UI id"
                  style="max-width: 180px"
                />
                <q-btn
                  color="grey-7"
                  flat
                  dense
                  label="Add"
                  :disable="!newUiTemplateId"
                  @click="addUiTemplate()"
                />

                <q-space />

                <q-btn
                  color="grey-7"
                  flat
                  dense
                  label="Delete"
                  :disable="uiTemplateOptions.length <= 1"
                  @click="deleteActiveUiTemplate()"
                />
              </div>

              <CodeEditor
                v-model="activeUiTemplateSource"
                placeholder="Enter your UI template source here..."
                language="jinja2"
              />
            </q-card>
          </template>

          <template #solver>
            <q-card flat>
              <div class="row items-center q-gutter-xs q-pa-xs">
                <q-select
                  v-model="selectedSolverKey"
                  :options="solverKeyOptions"
                  dense
                  outlined
                  options-dense
                  label="Solver"
                  style="min-width: 260px"
                  :disable="solverKeyOptions.length === 0"
                  option-label="label"
                  option-value="value"
                  emit-value
                  map-options
                />

                <q-input
                  v-model="newSolverId"
                  dense
                  outlined
                  label="New solver id"
                  style="max-width: 180px"
                />
                <q-btn
                  color="grey-7"
                  flat
                  dense
                  label="Add"
                  :disable="!newSolverId"
                  @click="addProjectSolver()"
                />

                <q-btn
                  color="grey-7"
                  flat
                  dense
                  label="Options"
                  :disable="!solverOptionsSchema"
                  @click="showSolverOptionsDialog = true"
                />
                <q-space />

                <q-btn
                  color="grey-7"
                  flat
                  dense
                  label="Delete"
                  :disable="isSolverBuiltin || projectSolverIds.length <= 1"
                  @click="deleteActiveProjectSolver()"
                />
              </div>

              <div class="q-pa-xs text-caption text-grey-7">
                Source: <span class="mono">{{ isSolverBuiltin ? 'built-in' : 'project' }}</span>
              </div>

              <div style="position: relative">
                <CodeEditor
                  v-model="activeSolverSource"
                  placeholder="Enter solver JS here..."
                  language="javascript"
                />
                <div
                  v-if="isSolverBuiltin"
                  style="
                    position: absolute;
                    inset: 0;
                    background: rgba(255, 255, 255, 0.01);
                    pointer-events: all;
                  "
                  title="Built-in solvers are read-only"
                />
              </div>

              <div class="q-pa-sm text-caption text-grey-7">
                Note: solver selection is persisted and used for Popup UI and sandbox execution.
              </div>
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

    <!-- Solver options dialog -->
    <q-dialog v-model="showSolverOptionsDialog">
      <q-card style="min-width: 800px; max-width: 95vw">
        <q-card-section class="row items-center">
          <div class="text-subtitle1">Solver Options</div>
          <q-space />
          <q-btn v-close-popup flat dense icon="close" />
        </q-card-section>
        <q-separator />
        <q-card-section>
          <div class="text-caption text-grey-7 q-mb-sm">
            Options are solver-defined. Defaults are taken from the solver JSON schema.
          </div>
          <ObjectView v-model="solverOptions" enable-expert-mode copy-btn />
          <q-separator class="q-my-md" />
          <div class="text-caption text-grey-7 q-mb-sm">Solver options schema</div>
          <ObjectView v-model="solverOptionsSchema" read-only enable-expert-mode copy-btn />
        </q-card-section>
        <q-card-actions align="right">
          <q-btn v-close-popup flat label="Close" />
        </q-card-actions>
      </q-card>
    </q-dialog>
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
  matRefresh,
  matRocketLaunch,
  matSave,
} from '@quasar/extras/material-icons'
import { mdiFunctionVariant, mdiTextBoxPlus } from '@quasar/extras/mdi-v6'
import { toolCall } from '@taskyon/taskyon'
import { watchDebounced } from '@vueuse/core'
import { Dialog, Notify } from 'quasar'
import CodeEditor from 'src/components/CodeEditor.vue'
import type { DockNode } from 'src/components/DockView.vue'
import DockView from 'src/components/DockView.vue'
import TaskyonHeader from 'src/components/taskyon/TaskyonHeader.vue'
import TaskyonIframe from 'src/components/TaskyonIframe.vue'
import ObjectView from 'src/components/varViews/ObjectView.vue'
import type { RumocaModule } from 'src/modules/modelica/modelica'
import {
  buildIframeCode,
  loadWasm,
  validateModelicaProjectFileV1,
  type TyModelicaProjectFileV1,
  modelicaLog,
  appendModelicaLog,
  buildModelAbiValidationIframeCode,
  validateModelAbiValidationResultV1,
  exportFile,
  exportGeneratedUiHtml,
  renderUiHtml,
} from 'src/modules/modelica/modelica'
import defaultSolverSource from 'src/modules/modelica/simulateModel?raw'
import defaultUiTemplateSource from 'src/modules/modelica/ui_template_placeholders.html?raw'
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import { copyToClipboard } from 'src/modules/utils'
import FixedHeightPage from 'src/pages/FixedHeightPage.vue'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { validateJavaScriptInSandbox } from '../../../packages/taskyon/src/utils/checkJsSyntax'
import { executeCodeInIframeSimple } from '../../../packages/taskyon/src/utils/iframeWorker'
import { safeYamlDump } from '../../../packages/taskyon/src/utils/yamlUtils'
import { syncStateWithOPFSFolder } from '../saveState'
import { createModelicatools } from './modelicaTools'

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
const simDt = ref(0.01)

// Solver options (declared by solver via JSON schema)
const solverOptionsSchema = ref<Record<string, unknown> | undefined>(undefined)
const solverOptions = ref<Record<string, unknown>>({})
const showSolverOptionsDialog = ref(false)

const executionResult = ref<Record<string, unknown>>({})
const running = ref(false)
const abortController = ref<AbortController | null>(null)

// ---------- Live sandbox log forwarding (iframe -> editor) ----------
// The iframe code posts messages of the form:
//   { taskyon: { kind: 'modelicaSandboxLog', runId, entry } }
// where entry includes timestamp, level, message, details, phase.

const activeSandboxRunIds = ref<Set<string>>(new Set())
const seenSandboxLogKeys = ref<string[]>([])

function rememberLogKey(key: string) {
  const arr = seenSandboxLogKeys.value
  arr.push(key)
  // keep last N keys only
  if (arr.length > 300) arr.splice(0, arr.length - 300)
}

function hasSeenLogKey(key: string): boolean {
  return seenSandboxLogKeys.value.includes(key)
}

function handleSandboxLogMessage(ev: MessageEvent) {
  const data = ev.data
  const payload = data?.taskyon
  if (!payload || payload.kind !== 'modelicaSandboxLog') return

  const runId = String(payload.runId || '')
  if (!runId) return
  if (!activeSandboxRunIds.value.has(runId)) return

  const entry = payload.entry || {}
  const timestamp = typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString()
  const phase =
    entry.phase === 'abi' ||
    entry.phase === 'compile' ||
    entry.phase === 'run' ||
    entry.phase === 'general'
      ? entry.phase
      : 'general'
  const level =
    entry.level === 'success' ||
    entry.level === 'info' ||
    entry.level === 'warning' ||
    entry.level === 'error'
      ? entry.level
      : 'info'
  const message = typeof entry.message === 'string' ? entry.message : JSON.stringify(entry)

  const key = `${timestamp}|${phase}|${level}|${message}`
  if (hasSeenLogKey(key)) return
  rememberLogKey(key)

  appendModelicaLog({
    timestamp,
    phase,
    level,
    message,
    details: entry.details,
  })
}

onMounted(() => {
  window.addEventListener('message', handleSandboxLogMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleSandboxLogMessage)
})

const tystate = useTaskyonStore()

const configuration = computed<partialTyConfiguration | null>(() => {
  const taskyonKey = tystate.getTaskyonKeyString()
  if (taskyonKey == null) return null
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
    signatureOrKey: taskyonKey,
  }
})

const LS_PROJECT_ID_KEY = 'taskyon.modelica.projectId'
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
              views: ['modelica', 'template', 'uiTemplate'],
              activeViewIndex: 0,
            },
            {
              id: 'simulation',
              type: 'leaf',
              size: 85,
              views: ['model', 'simulate', 'solver'],
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
  query: '?raw',
  import: 'default',
  eager: false,
})

// User-defined templates (persisted globally, not tied to a model)
const customTemplates = ref<Record<string, string>>({})
const newTemplateId = ref<string>('template2')

const selectedTemplateKey = ref<string>('')

const templateOptions = computed(() => {
  const builtins = Object.keys(jinjaTemplateUrls)
    .sort()
    .map((key) => ({ label: `builtin:${key.split('/').pop() ?? key}`, value: `builtin:${key}` }))

  const customs = Object.keys(customTemplates.value)
    .sort()
    .map((id) => ({ label: `custom:${id}`, value: `custom:${id}` }))

  return [...builtins, ...customs]
})

const isTemplateBuiltin = computed(() =>
  String(selectedTemplateKey.value || '').startsWith('builtin:'),
)

const canDeleteSelectedTemplate = computed(() =>
  String(selectedTemplateKey.value).startsWith('custom:'),
)

// Prevent template auto-reload while restoring persisted state.
const isHydratingState = ref(true)
// After hydration, the selectedTemplateKey watcher may still fire due to debounce.
// This flag skips exactly one template file load for the hydrated key, ensuring
// we restore the persisted templateSource exactly.
const skipNextTemplateLoadForKey = ref<string>('')

function addCustomTemplate() {
  const id = String(newTemplateId.value || '').trim()
  if (!id) return
  if (customTemplates.value[id] != null) {
    Notify.create({ type: 'warning', message: `Template '${id}' already exists` })
    return
  }

  // Use current templateSource as starting point if available, otherwise try to use javascript.jinja
  const initial = templateSource.value || ''
  customTemplates.value = { ...customTemplates.value, [id]: initial }

  selectedTemplateKey.value = `custom:${id}`
  Notify.create({ type: 'positive', message: `Template added: ${id}` })
}

function deleteSelectedTemplate() {
  const key = String(selectedTemplateKey.value || '')
  if (!key.startsWith('custom:')) return
  const id = key.slice('custom:'.length)

  const keys = Object.keys(customTemplates.value)
  if (customTemplates.value[id] == null) return
  if (keys.length <= 1) {
    Notify.create({ type: 'warning', message: 'Cannot delete the last custom template' })
    return
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [id]: _removed, ...rest } = customTemplates.value
  customTemplates.value = rest

  const nextId = Object.keys(customTemplates.value).sort()[0]
  selectedTemplateKey.value = nextId ? `custom:${nextId}` : ''
}

// Keep templateSource in sync when editing a custom template
watchDebounced(
  templateSource,
  (src) => {
    const key = String(selectedTemplateKey.value || '')
    if (!key.startsWith('custom:')) return
    const id = key.slice('custom:'.length)
    if (!id) return
    customTemplates.value = { ...customTemplates.value, [id]: String(src ?? '') }
  },
  { debounce: 200, maxWait: 800 },
)

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

async function confirmDialog(opts: {
  title: string
  message: string
  okLabel?: string
  cancelLabel?: string
}): Promise<boolean> {
  return await new Promise((resolve) => {
    Dialog.create({
      title: opts.title,
      message: opts.message,
      ok: { label: opts.okLabel ?? 'OK' },
      cancel: { label: opts.cancelLabel ?? 'Cancel' },
      persistent: true,
    })
      .onOk(() => resolve(true))
      .onCancel(() => resolve(false))
      .onDismiss(() => resolve(false))
  })
}

// ---------- Project + UI templates ----------

const projectImportEl = ref<HTMLInputElement | null>(null)

const initialProjectId =
  String(localStorage.getItem(LS_PROJECT_ID_KEY) || 'default').trim() || 'default'
const currentProjectId = ref<string>(initialProjectId)
const projectIdInput = ref<string>('default')

// ---------- Discover existing projects (OPFS) ----------

const availableProjectIds = ref<string[]>([])

async function refreshAvailableProjects() {
  const prefix = 'modelicaProject_'
  try {
    const navAny = navigator as unknown as {
      storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
    }
    if (!navAny.storage?.getDirectory) {
      Notify.create({ type: 'warning', message: 'OPFS directory listing not supported.' })
      return
    }
    const root = await navAny.storage.getDirectory()
    const ids: string[] = []

    for await (const [name, handle] of root.entries()) {
      if (handle?.kind === 'directory' && typeof name === 'string' && name.startsWith(prefix)) {
        ids.push(name.slice(prefix.length))
      }
    }
    ids.sort()
    availableProjectIds.value = ids
  } catch (e) {
    console.warn('Failed to list OPFS projects:', e)
    Notify.create({
      type: 'warning',
      message: `Failed to detect saved projects: ${(e as Error).message}`,
    })
  }
}

async function deleteCurrentProject() {
  const id = String(currentProjectId.value || '').trim()
  if (!id) return

  const confirmed = await confirmDialog({
    title: 'Delete project',
    message: `Delete project '${id}'? This cannot be undone.`,
    okLabel: 'Delete',
    cancelLabel: 'Cancel',
  })

  if (!confirmed) return

  const prefix = 'modelicaProject_'
  const dirName = `${prefix}${id}`

  try {
    const navAny = navigator as unknown as {
      storage?: { getDirectory?: () => Promise<FileSystemDirectoryHandle> }
    }
    if (!navAny.storage?.getDirectory) {
      Notify.create({ type: 'warning', message: 'OPFS not supported in this browser.' })
      return
    }

    const root = await navAny.storage.getDirectory()

    const rootWithRemoveEntry = root as unknown as {
      removeEntry?: (name: string, opts?: { recursive?: boolean }) => Promise<void>
    }
    if (typeof rootWithRemoveEntry.removeEntry !== 'function') {
      Notify.create({ type: 'warning', message: 'OPFS delete is not supported in this browser.' })
      return
    }

    await rootWithRemoveEntry.removeEntry(dirName, { recursive: true })

    Notify.create({ type: 'positive', message: `Deleted project '${id}'` })
    await refreshAvailableProjects()

    // Switch to another project if possible
    const next = availableProjectIds.value.find((x) => x !== id) ?? 'default'
    loadProjectById(next)
  } catch (e) {
    console.warn('Failed to delete OPFS project:', e)
    Notify.create({
      type: 'negative',
      message: `Failed to delete project: ${(e as Error).message}`,
    })
  }
}

async function promptDialog(opts: {
  title: string
  message: string
  okLabel?: string
  cancelLabel?: string
  initialValue?: string
}): Promise<string | null> {
  return await new Promise((resolve) => {
    Dialog.create({
      title: opts.title,
      message: opts.message,
      prompt: {
        model: opts.initialValue ?? '',
        type: 'text',
      },
      ok: { label: opts.okLabel ?? 'OK' },
      cancel: { label: opts.cancelLabel ?? 'Cancel' },
      persistent: true,
    })
      .onOk((v: unknown) => {
        if (typeof v === 'string') return resolve(v.trim() || null)
        if (typeof v === 'number') return resolve(String(v).trim() || null)
        return resolve(null)
      })
      .onCancel(() => resolve(null))
      .onDismiss(() => resolve(null))
  })
}

async function createNewProjectDialog() {
  const id = await promptDialog({
    title: 'New project',
    message: 'Enter a project name',
    okLabel: 'Create',
    cancelLabel: 'Cancel',
    initialValue: '',
  })

  if (!id) return
  if (availableProjectIds.value.includes(id)) {
    Notify.create({ type: 'warning', message: `Project '${id}' already exists. Switching to it.` })
    loadProjectById(id)
    return
  }

  // Create the project as a "Save As" of the current state (minimal + predictable).
  // The actual OPFS folder + state will be written by the OPFS sync after reload.
  availableProjectIds.value = [...availableProjectIds.value, id].sort()
  loadProjectById(id)
}

function onProjectSelected(val: string) {
  const id = String(val || '').trim()
  if (!id) return
  if (id === currentProjectId.value) return
  loadProjectById(id)
}

const projectFile = ref<TyModelicaProjectFileV1 | null>(null)

const uiTemplates = ref<Record<string, string>>({})
const selectedUiTemplateId = ref<string>('default')
const newUiTemplateId = ref<string>('ui2')

const uiTemplateOptions = computed(() =>
  Object.keys(uiTemplates.value)
    .sort()
    .map((id) => ({ label: id, value: id })),
)
const activeUiTemplateSource = computed({
  get: () => uiTemplates.value[selectedUiTemplateId.value] ?? '',
  set: (v: string) => {
    uiTemplates.value = { ...uiTemplates.value, [selectedUiTemplateId.value]: v }
  },
})

function addUiTemplate() {
  const id = String(newUiTemplateId.value || '').trim()
  if (!id) return
  if (uiTemplates.value[id] != null) {
    Notify.create({ type: 'warning', message: `UI template '${id}' already exists` })
    return
  }
  uiTemplates.value = { ...uiTemplates.value, [id]: defaultUiTemplateSource }
  selectedUiTemplateId.value = id
}

function deleteActiveUiTemplate() {
  const keys = Object.keys(uiTemplates.value)
  if (keys.length <= 1) return
  const id = selectedUiTemplateId.value
  const next = keys.find((k) => k !== id) ?? keys[0]!
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [id]: _removed, ...rest } = uiTemplates.value
  uiTemplates.value = rest
  selectedUiTemplateId.value = next
}

const builtinSolvers: Record<string, string> = {
  default: defaultSolverSource,
}

// Project-local solvers (persisted inside the project JSON file)
const projectSolvers = ref<Record<string, string>>({
  solver1: defaultSolverSource,
})

const projectSolverIds = computed(() => Object.keys(projectSolvers.value).sort())

const selectedSolverKey = ref<string>('builtin:default')
const newSolverId = ref<string>('solver2')

const solverKeyOptions = computed(() => {
  const builtins = Object.keys(builtinSolvers)
    .sort()
    .map((id) => ({ label: `builtin:${id}`, value: `builtin:${id}` }))

  const projects = Object.keys(projectSolvers.value)
    .sort()
    .map((id) => ({ label: `project:${id}`, value: `project:${id}` }))

  return [...builtins, ...projects]
})

const isSolverBuiltin = computed(() => String(selectedSolverKey.value || '').startsWith('builtin:'))

function solverIdFromKey(key: string): string {
  const k = String(key || '')
  if (k.startsWith('builtin:')) return k.slice('builtin:'.length)
  if (k.startsWith('project:')) return k.slice('project:'.length)
  return k
}

const activeSolverSource = computed({
  get: () => {
    const key = String(selectedSolverKey.value || '')
    if (key.startsWith('builtin:')) {
      return builtinSolvers[solverIdFromKey(key)] ?? ''
    }
    if (key.startsWith('project:')) {
      return projectSolvers.value[solverIdFromKey(key)] ?? ''
    }
    // fallback: treat as builtin id
    return builtinSolvers[key] ?? ''
  },
  set: (v: string) => {
    if (isSolverBuiltin.value) return
    const id = solverIdFromKey(selectedSolverKey.value)
    if (!id) return
    projectSolvers.value = { ...projectSolvers.value, [id]: String(v ?? '') }
  },
})

// Tools (AI assistant)
// Must be declared after activeUiTemplateSource and activeSolverSource
const tools = createModelicatools({
  modelicaSource,
  templateSource,
  uiTemplateSource: activeUiTemplateSource,
  solverSource: activeSolverSource,
  jsSource,
  daePrettyOutput,
  modelicaLog,
  simT0,
  simTf,
  simDt,
  showAllInPrompt,
  createNewVersion,
})

function addProjectSolver() {
  const id = String(newSolverId.value || '').trim()
  if (!id) return
  if (projectSolvers.value[id] != null) {
    Notify.create({ type: 'warning', message: `Solver '${id}' already exists in the project` })
    selectedSolverKey.value = `project:${id}`
    return
  }
  projectSolvers.value = { ...projectSolvers.value, [id]: defaultSolverSource }
  selectedSolverKey.value = `project:${id}`
}

function deleteActiveProjectSolver() {
  if (isSolverBuiltin.value) return
  const id = solverIdFromKey(selectedSolverKey.value)
  const keys = Object.keys(projectSolvers.value)
  if (keys.length <= 1) return
  if (!id || projectSolvers.value[id] == null) return

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [id]: _removed, ...rest } = projectSolvers.value
  projectSolvers.value = rest

  const nextId = Object.keys(projectSolvers.value).sort()[0] ?? 'solver1'
  selectedSolverKey.value = `project:${nextId}`
}

watchDebounced(
  [selectedSolverKey, activeSolverSource],
  async () => {
    await refreshActiveSolverMetadata()
  },
  { debounce: 200, maxWait: 800 },
)

// ---------- Solver metadata discovery (schema + defaults) ----------

type JsonSchemaPropertyWithDefault = { default?: unknown }

type JsonSchemaLikeObject = {
  properties?: Record<string, JsonSchemaPropertyWithDefault>
}

function extractDefaultsFromJsonSchema(schema: unknown): Record<string, unknown> {
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

async function refreshActiveSolverMetadata() {
  const solverJs = String(activeSolverSource.value ?? '')
  if (!solverJs.trim()) {
    solverOptionsSchema.value = undefined
    return
  }

  const id = 'rumoca-solver-meta'
  const abort = new AbortController()

  try {
    const code = `
(params, context) => {
  ${solverJs}
  const schema = (typeof simulateModel === 'function' && (simulateModel.optionsSchema || simulateModel.solverOptionsSchema)) || null
  const simDefaults = (typeof simulateModel === 'function' && simulateModel.simDefaults) || null
  return { schema, simDefaults }
}
`

    const rawUnknown = await executeCodeInIframeSimple(
      {
        id,
        code,
        sourceURL: 'rumoca-solver-meta.js',
        stopSignal: abort.signal,
      },
      {},
      { source: 'ModelicaPage', compiledAt: new Date().toISOString(), __taskyonRunId: id },
    )

    let schema: unknown = null
    let simDefaults: unknown = null

    if (rawUnknown && typeof rawUnknown === 'object') {
      const r = rawUnknown as Record<string, unknown>
      schema = r.schema
      simDefaults = r.simDefaults
    }

    solverOptionsSchema.value =
      schema && typeof schema === 'object' ? (schema as Record<string, unknown>) : undefined

    // apply solver-provided default sim values when present
    if (simDefaults && typeof simDefaults === 'object') {
      const d = simDefaults as Record<string, unknown>
      if (typeof d.t0 === 'number') simT0.value = d.t0
      if (typeof d.tf === 'number') simTf.value = d.tf
      if (typeof d.dt === 'number') simDt.value = d.dt
    }

    // If no custom options are set yet, seed them from schema defaults.
    if (!solverOptions.value || Object.keys(solverOptions.value).length === 0) {
      solverOptions.value = extractDefaultsFromJsonSchema(schema)
    }
  } catch (e) {
    console.warn('Failed to extract solver metadata:', e)
    solverOptionsSchema.value = undefined
  }
}

// ---------- Project import export ----------

function packProjectFile(): TyModelicaProjectFileV1 {
  const pf: TyModelicaProjectFileV1 = {
    format: 'taskyon.modelica_project.v1',
    version: 1,
    projectId: currentProjectId.value,
    modelicaSource: modelicaSource.value,

    uiTemplates: uiTemplates.value,
    activeUiTemplateId: selectedUiTemplateId.value,

    // store only project-local solvers
    solvers: projectSolvers.value,

    sim: {
      t0: simT0.value,
      tf: simTf.value,
      dt: simDt.value,
      solverKey: selectedSolverKey.value,
      solverId: solverIdFromKey(selectedSolverKey.value),
      solverOptions: solverOptions.value,
    },

    documentVersions:
      documentVersions.value as unknown as TyModelicaProjectFileV1['documentVersions'],
    currentVersionIndex: currentVersionIndex.value,
  }
  return validateModelicaProjectFileV1(pf)
}

function applyProjectFile(pf: TyModelicaProjectFileV1) {
  modelicaSource.value = pf.modelicaSource ?? ''
  uiTemplates.value = pf.uiTemplates ?? {}
  selectedUiTemplateId.value =
    pf.activeUiTemplateId || Object.keys(uiTemplates.value)[0] || 'default'

  // restore project-local solvers
  if (pf.solvers && typeof pf.solvers === 'object') {
    projectSolvers.value = pf.solvers
  }

  if (pf.sim) {
    if (typeof pf.sim.t0 === 'number') simT0.value = pf.sim.t0
    if (typeof pf.sim.tf === 'number') simTf.value = pf.sim.tf
    if (typeof pf.sim.dt === 'number') simDt.value = pf.sim.dt

    const solverKey = typeof pf.sim.solverKey === 'string' ? pf.sim.solverKey : ''
    const solverId = typeof pf.sim.solverId === 'string' ? pf.sim.solverId : ''

    if (solverKey) {
      selectedSolverKey.value = solverKey
    } else if (solverId) {
      if (builtinSolvers[solverId] != null) selectedSolverKey.value = `builtin:${solverId}`
      else if (projectSolvers.value[solverId] != null)
        selectedSolverKey.value = `project:${solverId}`
    }

    if (pf.sim.solverOptions && typeof pf.sim.solverOptions === 'object') {
      solverOptions.value = pf.sim.solverOptions
    }
  }

  if (Array.isArray(pf.documentVersions)) {
    documentVersions.value = pf.documentVersions as unknown as ModelicaVersion[]
  }
  if (typeof pf.currentVersionIndex === 'number') {
    currentVersionIndex.value = pf.currentVersionIndex
  }
}
function downloadTextFile(opts: { fileName: string; content: string; mime?: string }) {
  const blob = new Blob([opts.content ?? ''], { type: opts.mime ?? 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = opts.fileName
  a.click()

  setTimeout(() => URL.revokeObjectURL(url), 500)
}

function exportProjectJson() {
  const now = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const pf = packProjectFile()
  downloadTextFile({
    fileName: `project_${pf.projectId}_${now}.json`,
    content: JSON.stringify(pf, null, 2),
    mime: 'application/json',
  })
}

function triggerImportProject() {
  projectImportEl.value?.click()
}

async function onImportProjectFile(e: Event) {
  const el = e.target as HTMLInputElement
  const f = el.files?.[0]
  if (!f) return
  const txt = await f.text()
  try {
    const pf = validateModelicaProjectFileV1(JSON.parse(txt))
    currentProjectId.value = pf.projectId
    projectIdInput.value = pf.projectId
    projectFile.value = pf
    applyProjectFile(pf)
    Notify.create({ type: 'positive', message: `Project imported: ${pf.projectId}` })
  } catch (err) {
    Notify.create({ type: 'negative', message: `Project import failed: ${(err as Error).message}` })
  } finally {
    // allow re-import of same file
    el.value = ''
  }
}

function loadProjectById(projectId: string) {
  const id = String(projectId || '').trim()
  if (!id) return
  localStorage.setItem(LS_PROJECT_ID_KEY, id)
  currentProjectId.value = id
  // Reload so we can re-bind OPFS sync to the new project folder key
  setTimeout(() => window.location.reload(), 50)
}

const isHtmlOutput = computed(() => {
  const s = (jsSource.value ?? '').trimStart()
  return /^<!doctype\s+html/i.test(s) || /^<html\b/i.test(s)
})

const hasUiTemplate = computed(() => {
  const src = activeUiTemplateSource.value
  return typeof src === 'string' && src.trim().length > 0
})

// ---------- Compile Modelica → JS & DAE via new API ----------
// 1. compile_to_json(source, modelName) → JSON string
// 2. render_template(daeJson, template) → rendered string (JS in your case)
watchDebounced(
  [modelicaSource, templateSource],
  async () => {
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

      // ---- ABI validation (separate from solver) ----
      // If the template declares an ABI (model.abi) or requires it (model.abiRequired)
      // we validate the generated model JS in the sandbox and fail compilation if invalid.
      try {
        const code = buildModelAbiValidationIframeCode(rendered)
        const id = 'rumoca-model-abi-check'
        const abort = new AbortController()
        activeSandboxRunIds.value.add(id)
        const ctx = {
          source: 'ModelicaPage',
          compiledAt: new Date().toISOString(),
          __taskyonRunId: id,
          // enforceModelAbi: true,
        }

        const rawAbiResult = await executeCodeInIframeSimple(
          {
            id,
            code,
            sourceURL: 'rumoca-model-abi-check.js',
            stopSignal: abort.signal,
          },
          {},
          ctx,
        )
        const abiResult = validateModelAbiValidationResultV1(rawAbiResult)

        if (abiResult.ok !== true) {
          const msg = abiResult.errorMessage || 'Generated model ABI validation failed'
          appendModelicaLog({ level: 'error', phase: 'abi', message: msg })
          throw new Error(msg)
        }
      } finally {
        activeSandboxRunIds.value.delete('rumoca-model-abi-check')
      }

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
        level: 'error',
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

    const k = String(key)
    if (k.startsWith('builtin:')) {
      const path = k.slice('builtin:'.length)
      const loader = jinjaTemplateUrls[path]
      if (!loader) return
      const content = (await loader()) as string
      templateSource.value = content ?? ''
      return
    }

    if (k.startsWith('custom:')) {
      const id = k.slice('custom:'.length)
      templateSource.value = customTemplates.value[id] ?? ''
    }
  },
  { debounce: 50, maxWait: 200 },
)

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
  if (!hasUiTemplate.value) {
    Notify.create({ type: 'warning', message: 'No UI template available.' })
    return
  }
  if (!jsSource.value) {
    Notify.create({ type: 'warning', message: 'No generated model JS. Compile first.' })
    return
  }

  const html = renderUiHtml({
    uiTemplate: activeUiTemplateSource.value,
    compiledJs: jsSource.value,
    solverJs: activeSolverSource.value,
  })

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)

  const w = window.open(url, '_blank', 'noopener,noreferrer,popup,width=1200,height=800')
  if (!w) {
    URL.revokeObjectURL(url)
    Notify.create({
      type: 'warning',
      message: 'Popup blocked by browser. Allow popups for this site to open the UI window.',
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

  const code = buildIframeCode(jsSource, activeSolverSource.value)
  const id = `rumoca-model-worker`
  abortController.value = new AbortController()
  running.value = true

  try {
    const params = {
      sim: {
        t0: simT0.value,
        tf: simTf.value,
        dt: simDt.value,
        solverOptions: solverOptions.value,
      },
    }

    const context = {
      source: 'ModelicaPage',
      compiledAt: new Date().toISOString(),
      __taskyonRunId: id,
    }
    activeSandboxRunIds.value.add(id)

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
        message: `Simulation returned invalid result: expected object, got ${typeof result}`,
        details: result,
      })
      return
    }

    // Note: live sandbox logs are forwarded via postMessage.
    executionResult.value = result
    appendModelicaLog({
      level: 'success',
      phase: 'run',
      message: 'Simulation was successful',
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
    activeSandboxRunIds.value.delete(id)

    running.value = false
  }
}

const stopExecution = () => {
  abortController.value?.abort()
  running.value = false
}

onMounted(async () => {
  // 1) Global state (not bound to a specific model)
  //    - layout
  //    - template editor state
  //    - global solver library
  //    - current project id
  await syncStateWithOPFSFolder('modelicaEditPage_global', {
    initialLayout,
    selectedTemplateKey,
    templateSource,
    customTemplates,
    verbose,
    outputTab,
    showAllInPrompt,
    currentProjectId,
  })
  projectIdInput.value = currentProjectId.value

  // 2) Project file (model-specific). One JSON object, synced via OPFS.
  //    Folder name depends on the selected project.
  await syncStateWithOPFSFolder(`modelicaProject_${currentProjectId.value}`, {
    projectFile,
  })

  // Hydrate project state into the editor
  try {
    const existing = projectFile.value
    if (existing) {
      const pf = validateModelicaProjectFileV1(existing)
      projectFile.value = pf
      applyProjectFile(pf)
    } else {
      // First-time project initialization
      uiTemplates.value = { default: defaultUiTemplateSource }
      selectedUiTemplateId.value = 'default'
      modelicaSource.value = ''

      // Ensure we always have at least one version snapshot
      if (documentVersions.value.length === 0) {
        createNewVersion('Initial')
      }

      projectFile.value = packProjectFile()
    }
  } catch (e) {
    console.warn('Project hydration failed, resetting project file:', e)
    uiTemplates.value = { default: defaultUiTemplateSource }
    selectedUiTemplateId.value = 'default'
    modelicaSource.value = ''
    projectFile.value = packProjectFile()
  }

  // Prevent template auto-reload while restoring persisted state.
  skipNextTemplateLoadForKey.value = selectedTemplateKey.value
  isHydratingState.value = false

  // Initial project discovery
  await refreshAvailableProjects()
  // Keep projectFile updated when the editor changes (OPFS will persist it)
  watchDebounced(
    [
      modelicaSource,
      uiTemplates,
      selectedUiTemplateId,
      simT0,
      simTf,
      simDt,
      documentVersions,
      currentVersionIndex,
    ],
    () => {
      try {
        projectFile.value = packProjectFile()
      } catch (e) {
        console.warn('Failed to pack project file:', e)
      }
    },
    { debounce: 200, maxWait: 800 },
  )

  // 3) WASM
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
