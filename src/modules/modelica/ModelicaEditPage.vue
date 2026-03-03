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
            <ModelicaActionsBar
              :current-project-id="currentProjectId"
              :available-project-ids="availableProjectIds"
              :project-file="projectFile"
              :project-menu-options="projectMenuOptions"
              :project-menu-schema="projectMenuSchema"
              :library-menu-options="libraryMenuOptions"
              :library-menu-schema="libraryMenuSchema"
              :runtime-menu-options="runtimeMenuOptions"
              :runtime-menu-schema="runtimeMenuSchema"
              :msl-loaded="mslLoaded"
              :msl-loading="mslLoading"
              :msl-downloading="mslDownloading"
              :msl-archive-name="mslArchiveName"
              :msl-file-count="mslFileCount"
              :msl-cached-zip-path="mslCachedZipPath"
              :wasm-loaded="wasmLoaded"
              :current-version-index="currentVersionIndex"
              :document-versions-length="documentVersions.length"
              :js-source="jsSource"
              :has-ui-template="hasUiTemplate"
              :is-html-output="isHtmlOutput"
              :running="running"
              @project-selected="onProjectSelected"
              @create-project="createNewProjectDialog"
              @refresh-projects="refreshAvailableProjects"
              @delete-project="deleteCurrentProject"
              @export-project="exportProjectJson"
              @import-project-file="onImportProjectFile"
              @import-msl-file="onImportMslZip"
              @download-msl="downloadMslZipToOpfs"
              @load-cached-msl="loadCachedMslZipFromOpfs"
              @clear-msl="clearModelicaLibraries"
              @clear-all="clearAll"
              @load-example="loadExample"
              @previous-version="goToPreviousVersion"
              @next-version="goToNextVersion"
              @create-version="handleCreateNewVersionClick"
              @export-target="handleExportTarget"
              @export-ui-html="handleExportUiHtml"
              @export-ui-jinja="handleExportUiJinjaTemplate"
              @run-sandbox="handleRunInSandbox"
              @open-popup="openGeneratedHtmlPopup"
              @stop-execution="stopExecution"
              @update:project-menu-options="onProjectMenuOptionsUpdate"
              @update:library-menu-options="onLibraryMenuOptionsUpdate"
              @update:runtime-menu-options="onRuntimeMenuOptionsUpdate"
            />
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
                <ObjectView v-model="executionResult" dense read-only copy-btn enable-expert-mode />
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
  matDescription,
  matPlayArrow,
  matRocketLaunch,
} from '@quasar/extras/material-icons'
import { mdiFunctionVariant } from '@quasar/extras/mdi-v6'
import { toolCall } from '@taskyon/taskyon'
import { watchDebounced } from '@vueuse/core'
import type { JSONSchema7 } from 'json-schema'
import { Dialog, Notify } from 'quasar'
import CodeEditor from 'src/components/CodeEditor.vue'
import type { DockNode } from 'src/components/DockView.vue'
import DockView from 'src/components/DockView.vue'
import TaskyonHeader from 'src/components/taskyon/TaskyonHeader.vue'
import TaskyonIframe from 'src/components/TaskyonIframe.vue'
import ObjectView from 'src/components/varViews/ObjectView.vue'
import type { RumocaModule } from 'src/modules/modelica/modelica'
import {
  loadWasm,
  DEFAULT_MSL_ZIP_URL,
  validateModelicaProjectFileV1,
  type TyModelicaProjectFileV1,
  type ModelicaVersion,
  modelicaLog,
  appendModelicaLog,
  exportFile,
  exportGeneratedUiHtml,
  exportGeneratedUiJinjaTemplate,
  renderUiHtml,
  builtinSolvers,
  packProjectFile as packModelicaProjectFile,
  unpackProjectFile,
  compileModelicaToJs,
  runModelicaSandbox,
} from 'src/modules/modelica/modelica'
import defaultUiTemplateSource from 'src/modules/modelica/ui_template_placeholders.html?raw'
import defaultJsTemplateSource from 'src/modules/modelica/javascript.jinja?raw'
import type { partialTyConfiguration } from 'src/modules/taskyon/apiTypes'
import { copyToClipboard } from 'src/modules/utils'
import FixedHeightPage from 'src/pages/FixedHeightPage.vue'
import { useTaskyonStore } from 'src/stores/taskyonState'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { safeYamlDump } from '../../../packages/taskyon/src/utils/yamlUtils'
import { syncStateWithOPFSFolder } from '../saveState'
import ModelicaActionsBar from './components/ModelicaActionsBar.vue'
import { createModelicatools } from './modelicaTools'
import { useProjectFileStore } from './useProjectFileStore'
import { useModelicaLibraries } from './useModelicaLibraries'
import { useSolverRegistry } from './useSolverRegistry'

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

const {
  useModelicaStandardLibrary,
  mslLoaded,
  mslLoading,
  mslDownloading,
  mslArchiveName,
  mslFileCount,
  mslCachedZipPath,
  mslDownloadUrl,
  downloadMslZipToOpfs,
  loadCachedMslZipFromOpfs,
  onImportMslZip,
  clearModelicaLibraries,
} = useModelicaLibraries({ wasm })

const {
  solverOptionsSchema,
  solverOptions,
  showSolverOptionsDialog,
  projectSolvers,
  projectSolverIds,
  selectedSolverKey,
  newSolverId,
  solverKeyOptions,
  isSolverBuiltin,
  activeSolverSource,
  addProjectSolver,
  deleteActiveProjectSolver,
} = useSolverRegistry({
  simT0,
  simTf,
  simDt,
})

const executionResult = ref<Record<string, unknown>>({})
const running = ref(false)
const abortController = ref<AbortController | null>(null)

function normalizeSimulationResultForDisplay(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const resultObject = result && typeof result === 'object' ? result : {}
  const meta =
    resultObject.meta && typeof resultObject.meta === 'object'
      ? (resultObject.meta as Record<string, unknown>)
      : {}
  const model =
    meta.model && typeof meta.model === 'object' ? (meta.model as Record<string, unknown>) : {}
  const data =
    resultObject.data && typeof resultObject.data === 'object'
      ? ({ ...(resultObject.data as Record<string, unknown>) } as Record<string, unknown>)
      : {}

  const tSeries = Array.isArray(data.t) ? data.t : []
  const tLen = tSeries.length
  const toNames = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

  const stateNames = toNames(model.stateNames)
  const algebraicNames = toNames(model.algebraicNames)
  const inputNames = toNames(model.inputNames)
  const conditionNames = toNames(model.conditionNames)

  const finiteSeries = (value: unknown, len: number): number[] => {
    if (!Array.isArray(value)) return new Array(Math.max(0, len)).fill(Number.NaN)
    const out = value.map((entry) =>
      typeof entry === 'number' && Number.isFinite(entry) ? entry : Number.NaN,
    )
    if (out.length < len) out.push(...new Array(len - out.length).fill(Number.NaN))
    if (out.length > len && len > 0) out.length = len
    return out
  }

  const normalizeSeriesMap = (value: unknown, names: string[]): Record<string, number[]> => {
    const src = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    const normalized: Record<string, number[]> = {}
    for (const [k, v] of Object.entries(src)) {
      normalized[k] = finiteSeries(v, tLen)
    }
    for (const name of names) {
      if (!(name in normalized)) normalized[name] = new Array(tLen).fill(Number.NaN)
    }
    return normalized
  }

  data.x = normalizeSeriesMap(data.x, stateNames)
  data.y = normalizeSeriesMap(data.y, algebraicNames)
  data.u = normalizeSeriesMap(data.u, inputNames)
  data.c = normalizeSeriesMap(data.c, conditionNames)

  return {
    ...resultObject,
    data,
  }
}

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
              views: ['modelica', 'template', 'uiTemplate', 'solver'],
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
      keepAliveViews: ['assistant'],
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

// Tools (AI assistant)
// Must be declared after activeUiTemplateSource and activeSolverSource
let compileNowFn: (() => Promise<{ ok: boolean; message?: string }>) | null = null
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
  compileNow: async () =>
    compileNowFn
      ? await compileNowFn()
      : { ok: false, message: 'compileNow is not initialized yet' },
})

// ---------- Project import export ----------

function packProjectFile(): TyModelicaProjectFileV1 {
  return packModelicaProjectFile({
    projectId: currentProjectId.value,
    modelicaSource: modelicaSource.value,
    uiTemplates: uiTemplates.value,
    activeUiTemplateId: selectedUiTemplateId.value,
    projectSolvers: projectSolvers.value,
    sim: {
      t0: simT0.value,
      tf: simTf.value,
      dt: simDt.value,
      solverKey: selectedSolverKey.value,
      solverOptions: solverOptions.value,
    },
    documentVersions: documentVersions.value,
    currentVersionIndex: currentVersionIndex.value,
  })
}

function applyProjectFile(pf: TyModelicaProjectFileV1) {
  const state = unpackProjectFile(pf, builtinSolvers)
  modelicaSource.value = state.modelicaSource
  uiTemplates.value = state.uiTemplates
  selectedUiTemplateId.value = state.selectedUiTemplateId
  if (state.projectSolvers) projectSolvers.value = state.projectSolvers
  if (typeof state.sim.t0 === 'number') simT0.value = state.sim.t0
  if (typeof state.sim.tf === 'number') simTf.value = state.sim.tf
  if (typeof state.sim.dt === 'number') simDt.value = state.sim.dt
  if (typeof state.sim.solverKey === 'string') selectedSolverKey.value = state.sim.solverKey
  if (state.sim.solverOptions) solverOptions.value = state.sim.solverOptions
  if (state.documentVersions) documentVersions.value = state.documentVersions
  if (typeof state.currentVersionIndex === 'number') {
    currentVersionIndex.value = state.currentVersionIndex
  }
}
const {
  currentProjectId,
  availableProjectIds,
  projectFile,
  refreshAvailableProjects,
  deleteCurrentProject,
  createNewProjectDialog,
  onProjectSelected,
  exportProjectJson,
  onImportProjectFile,
} = useProjectFileStore<TyModelicaProjectFileV1>({
  packProjectFile,
  applyProjectFile,
  validateProjectFile: validateModelicaProjectFileV1,
})

async function refreshBuiltinTemplateIfSelected() {
  const key = String(selectedTemplateKey.value || '')
  if (!key.startsWith('builtin:')) return
  const path = key.slice('builtin:'.length)
  const loader = jinjaTemplateUrls[path]
  if (!loader) return
  const content = (await loader()) as string
  templateSource.value = content ?? ''
}

const isHtmlOutput = computed(() => {
  const s = (jsSource.value ?? '').trimStart()
  return /^<!doctype\s+html/i.test(s) || /^<html\b/i.test(s)
})

const hasUiTemplate = computed(() => {
  const src = activeUiTemplateSource.value
  return typeof src === 'string' && src.trim().length > 0
})

const projectMenuOptions = ref<Record<string, unknown>>({
  verboseLogging: false,
  aiSeesAll: true,
})
const libraryMenuOptions = ref<Record<string, unknown>>({
  useMSL: false,
  mslZipUrl: DEFAULT_MSL_ZIP_URL,
})
const runtimeMenuOptions = ref<Record<string, unknown>>({
  t0: simT0.value,
  tf: simTf.value,
  dt: simDt.value,
})

const projectMenuSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    verboseLogging: { type: 'boolean', title: 'Verbose logging' },
    aiSeesAll: { type: 'boolean', title: 'AI sees all editors' },
  },
}

const libraryMenuSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    useMSL: { type: 'boolean', title: 'Use Modelica Standard Library for compile' },
    mslZipUrl: { type: 'string', title: 'MSL ZIP URL' },
  },
}

const runtimeMenuSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    t0: { type: 'number', title: 'Simulation t0' },
    tf: { type: 'number', title: 'Simulation tf' },
    dt: { type: 'number', title: 'Simulation dt (must be > 0)' },
  },
}

function onProjectMenuOptionsUpdate(v: Record<string, unknown>) {
  projectMenuOptions.value = v
}

function onLibraryMenuOptionsUpdate(v: Record<string, unknown>) {
  libraryMenuOptions.value = v
}

function onRuntimeMenuOptionsUpdate(v: Record<string, unknown>) {
  runtimeMenuOptions.value = v
}

function handleExportTarget(target: 'modelica' | 'template' | 'js' | 'daePretty' | 'daeJson') {
  if (target === 'modelica') return exportFile('modelica', modelicaSource.value)
  if (target === 'template') return exportFile('template', templateSource.value)
  if (target === 'js') return exportFile('js', jsSource.value)
  if (target === 'daePretty') return exportFile('daePretty', daePrettyOutput.value)
  if (target === 'daeJson')
    return exportFile('daeJson', JSON.stringify(daeJsonOutput.value ?? {}, null, 2))
}

function handleExportUiHtml() {
  exportGeneratedUiHtml(
    hasUiTemplate.value,
    activeUiTemplateSource.value,
    jsSource.value,
    activeSolverSource.value,
    currentProjectId.value,
    {
      t0: simT0.value,
      tf: simTf.value,
      dt: simDt.value,
    },
  )
}

function handleExportUiJinjaTemplate() {
  exportGeneratedUiJinjaTemplate(
    hasUiTemplate.value,
    activeUiTemplateSource.value,
    defaultJsTemplateSource,
    activeSolverSource.value,
    currentProjectId.value,
    {
      t0: simT0.value,
      tf: simTf.value,
      dt: simDt.value,
    },
  )
}

watch(
  [verbose, showAllInPrompt],
  () => {
    projectMenuOptions.value = {
      verboseLogging: Boolean(verbose.value),
      aiSeesAll: Boolean(showAllInPrompt.value),
    }
  },
  { immediate: true },
)

watch(
  projectMenuOptions,
  (v) => {
    if (typeof v.verboseLogging === 'boolean') verbose.value = v.verboseLogging
    if (typeof v.aiSeesAll === 'boolean') showAllInPrompt.value = v.aiSeesAll
  },
  { deep: true },
)

watch(
  [useModelicaStandardLibrary, mslDownloadUrl],
  () => {
    libraryMenuOptions.value = {
      useMSL: Boolean(useModelicaStandardLibrary.value),
      mslZipUrl: String(mslDownloadUrl.value || DEFAULT_MSL_ZIP_URL),
    }
  },
  { immediate: true },
)

watch(
  libraryMenuOptions,
  (v) => {
    if (typeof v.useMSL === 'boolean') useModelicaStandardLibrary.value = v.useMSL
    if (typeof v.mslZipUrl === 'string' && v.mslZipUrl.trim()) {
      mslDownloadUrl.value = v.mslZipUrl.trim()
    }
  },
  { deep: true },
)

watch(
  [simT0, simTf, simDt],
  () => {
    runtimeMenuOptions.value = {
      t0: Number(simT0.value),
      tf: Number(simTf.value),
      dt: Number(simDt.value),
    }
  },
  { immediate: true },
)

watch(
  runtimeMenuOptions,
  (v) => {
    const maybeT0 = Number(v.t0)
    const maybeTf = Number(v.tf)
    const maybeDt = Number(v.dt)
    if (Number.isFinite(maybeT0)) simT0.value = maybeT0
    if (Number.isFinite(maybeTf)) simTf.value = maybeTf
    if (Number.isFinite(maybeDt) && maybeDt > 0) simDt.value = maybeDt
  },
  { deep: true },
)

// ---------- Compile Modelica → JS & DAE via new API ----------
const runCompilation = async (): Promise<{ ok: boolean; message?: string }> => {
  loading.value = true
  output.value = ''
  statusType.value = 'loading'
  executionResult.value = {}
  try {
    const result = await compileModelicaToJs({
      wasm: wasm.value,
      modelicaSource: modelicaSource.value,
      templateSource: templateSource.value,
      useModelicaStandardLibrary: useModelicaStandardLibrary.value,
      mslLoaded: mslLoaded.value,
      activeSandboxRunIds: activeSandboxRunIds.value,
    })
    if (!result.ok) {
      if (typeof result.rendered === 'string' && result.rendered.length > 0) {
        daeJsonOutput.value = result.daeForTemplate ?? {}
        daePrettyOutput.value = result.daePretty ?? ''
        output.value = result.rendered
        jsSource.value = result.rendered
      } else {
        output.value = `Error: ${result.message}`
      }
      return { ok: false, message: result.message }
    }
    daeJsonOutput.value = result.daeForTemplate
    daePrettyOutput.value = result.daePretty
    output.value = result.rendered
    jsSource.value = result.rendered
    return { ok: true, message: 'Compilation successful' }
  } finally {
    loading.value = false
  }
}

// Wire explicit compile entrypoint into tools (autofix cycle).
compileNowFn = runCompilation

watchDebounced(
  [modelicaSource, templateSource, useModelicaStandardLibrary, mslLoaded],
  async () => {
    await runCompilation()
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

const exampleModels = {
  bouncingBall: `model BouncingBall             "The bouncing ball model"
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
 end BouncingBall;`,
  resistorMsl: `model MslResistorExample
  extends Modelica.Electrical.Analog.Examples.Resistor;
end MslResistorExample;`,
} as const

const applyExample = async (choice: unknown) => {
  const key = String(choice) as keyof typeof exampleModels
  modelicaSource.value = exampleModels[key] ?? exampleModels.bouncingBall

  // select template that contains "javascript"
  const sel = Object.keys(jinjaTemplateUrls).find((tplKey) => tplKey.includes('javascript.jinja'))
  if (!sel) return

  selectedTemplateKey.value = sel
  const exampleTemplate = (await jinjaTemplateUrls[sel]!()) as string
  templateSource.value = exampleTemplate || ''
}

const loadExample = () => {
  Dialog.create({
    title: 'Load Example',
    message: 'Choose a Modelica example to load',
    options: {
      type: 'radio',
      model: 'bouncingBall',
      items: [
        { label: 'BouncingBall (classic)', value: 'bouncingBall' },
        { label: 'MSL Resistor (extends)', value: 'resistorMsl' },
      ],
    },
    cancel: true,
    persistent: true,
  }).onOk((choice) => {
    void applyExample(choice)
  })
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
    simDefaults: {
      t0: simT0.value,
      tf: simTf.value,
      dt: simDt.value,
    },
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
function handleRunInSandbox() {
  void runInSandbox(jsSource.value)
}

const runInSandbox = async (jsSource: string | undefined) => {
  executionResult.value = {}
  abortController.value = new AbortController()
  running.value = true

  try {
    const result = await runModelicaSandbox({
      jsSource,
      solverSource: activeSolverSource.value,
      sim: {
        t0: simT0.value,
        tf: simTf.value,
        dt: simDt.value,
        solverOptions: solverOptions.value,
      },
      activeSandboxRunIds: activeSandboxRunIds.value,
      abortSignal: abortController.value.signal,
    })
    if (result.ok) executionResult.value = normalizeSimulationResultForDisplay(result.result)
  } catch (error) {
    console.error('Sandbox execution failed:', error)
  } finally {
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
    useModelicaStandardLibrary,
    mslDownloadUrl,
    mslCachedZipPath,
    outputTab,
    showAllInPrompt,
    currentProjectId,
  })

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
  await refreshBuiltinTemplateIfSelected()
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
    if (typeof wasmModule.get_library_count === 'function') {
      const n = Number(wasmModule.get_library_count()) || 0
      if (n > 0) {
        mslLoaded.value = true
        mslFileCount.value = n
      }
    }
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
