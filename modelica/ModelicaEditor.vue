<!--ModelicaEditor.vue-->
<template>
  <DockView
    v-model:node="initialLayout"
    class="col"
    hide-tab-add
    hide-tab-close
    :tab-icons="{
      workspace: matDescription,
      templates: matCode,
      results: matShowChart,
      libraryTree: mdiFileTreeOutline,
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
        :can-run-model="canRunModel"
        :running="running"
        :active-workbench-view="activeWorkbenchView"
        :active-workspace-tab="workspaceTab"
        :active-templates-tab="templatesTab"
        :active-results-tab="resultsTab"
        :simulation-controls-open="showSolverOptionsDialog"
        :sim-t0="simT0"
        :sim-tf="simTf"
        :sim-dt="simDt"
        :selected-solver-key="selectedSolverKey"
        :predicted-steps="predictedStepCount"
        :actual-steps="actualStepCount"
        :event-count="actualEventCount"
        :has-result="hasSimulationResult"
        :solver-options="solverOptions"
        :solver-options-schema="solverOptionsSchema"
        @project-selected="onProjectSelected"
        @create-project="createNewProjectDialog"
        @refresh-projects="refreshAvailableProjects"
        @delete-project="deleteCurrentProject"
        @export-project="exportProjectJson"
        @import-project-file="onImportProjectFile"
        @import-msl-file="handleImportMslZip"
        @download-msl="downloadMslZipToOpfs"
        @load-cached-msl="handleLoadCachedMslZipFromOpfs"
        @clear-msl="handleClearModelicaLibraries"
        @clear-all="clearAll"
        @reset-view="resetDockLayout"
        @load-example="loadExample"
        @export-target="handleExportTarget"
        @export-ui-html="handleExportUiHtml"
        @export-ui-jinja="handleExportUiJinjaTemplate"
        @run-sandbox="handleRunInSandbox"
        @open-popup="openGeneratedHtmlPopup"
        @stop-execution="stopExecution"
        @update:simulation-controls-open="showSolverOptionsDialog = $event"
        @update:sim-t0="simT0 = Number($event)"
        @update:sim-tf="simTf = Number($event)"
        @update:sim-dt="simDt = Number($event)"
        @update:solver-options="solverOptions = $event"
        @reset-sim-from-model="resetSimulationSettingsFromModelAnnotations"
        @update:project-menu-options="onProjectMenuOptionsUpdate"
        @update:library-menu-options="onLibraryMenuOptionsUpdate"
        @update:runtime-menu-options="onRuntimeMenuOptionsUpdate"
      />
    </template>

    <template #logs>
      <!-- logs -->
      <q-card bordered flat square class="modelica-log-card">
        <div class="row no-wrap fit">
          <div class="col modelica-log-scroll">
            <q-expansion-item
              v-for="(entry, idx) in modelicaLog"
              :key="idx"
              dense
              dense-toggle
              :label="entry.message"
            >
              <pre class="q-ma-none q-pa-xs text-caption">{{ safeYamlDump(entry) }}</pre>
            </q-expansion-item>
          </div>
          <div class="column items-center q-gutter-xs q-pa-xs modelica-log-actions">
            <q-chip dense square color="grey-3" text-color="grey-8" style="font-size: 11px">
              Log
            </q-chip>
            <q-btn
              flat
              dense
              round
              color="grey-7"
              :icon="matContentCopy"
              :disable="modelicaLog.length === 0"
              @click="copyLogsToClipboard()"
            >
              <q-tooltip>Copy Logs</q-tooltip>
            </q-btn>
            <q-btn
              flat
              dense
              round
              color="grey-7"
              :icon="matDelete"
              :disable="modelicaLog.length === 0"
              @click="clearModelicaLog()"
            >
              <q-tooltip>Clear Logs</q-tooltip>
            </q-btn>
          </div>
        </div>
      </q-card>
    </template>

    <template #workspace>
      <q-card flat class="fit column">
        <q-tabs v-model="workspaceTab" dense align="left" narrow-indicator class="dense-tab-strip">
          <q-tab name="modelica" label="Code" no-caps class="dense-tab" />
          <q-tab name="diagram" label="Diagram" no-caps class="dense-tab" />
        </q-tabs>
        <q-separator />
        <q-tab-panels v-model="workspaceTab" animated class="col">
          <q-tab-panel name="modelica" class="q-pa-none fit">
            <q-card flat class="fit column">
              <div class="q-pa-xs row items-center q-gutter-xs">
                <q-btn
                  color="grey-7"
                  flat
                  dense
                  label="Copy"
                  :disable="!modelicaSource"
                  @click="copyModelicaToClipboard"
                />
                <q-separator vertical spaced />
                <q-btn
                  flat
                  dense
                  round
                  color="grey-7"
                  :icon="matNavigateBefore"
                  title="Previous Version"
                  :disable="currentVersionIndex === 0"
                  @click="goToPreviousVersion"
                />
                <q-btn
                  flat
                  dense
                  round
                  color="grey-7"
                  :icon="matNavigateNext"
                  title="Next Version"
                  :disable="currentVersionIndex === documentVersions.length - 1"
                  @click="goToNextVersion"
                />
                <q-btn
                  flat
                  dense
                  round
                  color="secondary"
                  :icon="mdiTextBoxPlus"
                  title="Create New Version Snapshot"
                  @click="handleCreateNewVersionClick"
                />
                <q-chip dense square color="grey-3" text-color="grey-8">
                  {{ `Version ${currentVersionIndex + 1} / ${documentVersions.length}` }}
                </q-chip>
              </div>
              <CodeEditor
                v-model="modelicaSource"
                placeholder="Enter your Modelica code here..."
                language="modelica"
                :extra-extensions="modelicaEditorExtensions"
              />
            </q-card>
          </q-tab-panel>

          <q-tab-panel name="diagram" class="q-pa-none fit">
            <q-card flat class="fit">
              <ModelicaDiagramPane
                :extractor="diagramExtractor"
                :source="modelicaSource"
                :qualified-name="diagramTargetQualifiedName"
                :wasm-loaded="wasmLoaded"
                :refresh-key="diagramRefreshKey"
              />
            </q-card>
          </q-tab-panel>
        </q-tab-panels>
      </q-card>
    </template>

    <template #libraryTree>
      <ModelicaLibraryTreeView
        :loading="mslLoading"
        :msl-loading="mslLoading"
        :msl-downloading="mslDownloading"
        :msl-cached-zip-path="mslCachedZipPath"
        :nodes="libraryTreeNodes"
        @refresh="refreshLibraryTree"
        @open-model="openModelFromLibraryTree"
        @import-library-file="handleImportMslZip"
        @load-cached-msl="handleLoadCachedMslZipFromOpfs"
        @download-msl="downloadMslZipToOpfs"
        @clear-msl="handleClearModelicaLibraries"
      />
    </template>

    <template #templates>
      <q-card flat class="fit column">
        <q-tabs v-model="templatesTab" dense align="left" narrow-indicator class="dense-tab-strip">
          <q-tab name="template" label="Code Template" no-caps class="dense-tab" />
          <q-tab name="uiTemplate" label="UI Template" no-caps class="dense-tab" />
          <q-tab name="solver" label="Solver" no-caps class="dense-tab" />
        </q-tabs>
        <q-separator />
        <q-tab-panels v-model="templatesTab" animated class="col">
          <q-tab-panel name="template" class="q-pa-none fit">
            <q-card flat class="fit column">
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

              <div class="col" style="position: relative">
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
          </q-tab-panel>

          <q-tab-panel name="uiTemplate" class="q-pa-none fit">
            <q-card flat class="fit column">
              <div class="row items-center q-gutter-xs q-pa-xs">
                <q-select
                  v-model="selectedUiTemplateKey"
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

                <q-select
                  v-model="selectedSolverKey"
                  :options="solverKeyOptions"
                  dense
                  outlined
                  options-dense
                  label="Solver for UI"
                  style="min-width: 220px"
                  :disable="solverKeyOptions.length === 0"
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
                  label="Delete"
                  :disable="!canDeleteSelectedUiTemplate"
                  @click="deleteActiveUiTemplate()"
                />
              </div>

              <div class="col" style="position: relative">
                <CodeEditor
                  v-model="activeUiTemplateSource"
                  placeholder="Enter your UI template source here..."
                  language="jinja2"
                />
                <div
                  v-if="isUiTemplateBuiltin"
                  style="
                    position: absolute;
                    inset: 0;
                    background: rgba(255, 255, 255, 0.01);
                    pointer-events: all;
                  "
                  title="Built-in UI templates are read-only"
                />
              </div>
            </q-card>
          </q-tab-panel>

          <q-tab-panel name="solver" class="q-pa-none fit">
            <q-card flat class="fit column">
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

              <div class="col" style="position: relative">
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
          </q-tab-panel>
        </q-tab-panels>
      </q-card>
    </template>

    <template #results>
      <q-card flat class="fit column">
        <q-tabs v-model="resultsTab" dense align="left" narrow-indicator class="dense-tab-strip">
          <q-tab name="model" label="Generated" no-caps class="dense-tab" />
          <q-tab name="simulate" label="Simulate" no-caps class="dense-tab" />
          <q-tab name="plot" label="Plot" no-caps class="dense-tab" />
        </q-tabs>
        <q-separator />
        <q-tab-panels v-model="resultsTab" animated class="col">
          <q-tab-panel name="model" class="q-pa-none fit">
            <div class="q-gutter-xs q-pa-xs">
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
              <q-btn
                flat
                dense
                label="Copy AST"
                :disable="!canCopyAst"
                @click="copyAstToClipboard"
              />
              <q-separator />

              <q-tabs v-model="outputTab" dense narrow-indicator class="dense-tab-strip">
                <q-tab name="js" label="Code" no-caps class="dense-tab" />
                <q-tab name="daeJson" label="JSON" no-caps class="dense-tab" />
                <q-tab name="daePretty" label="Pretty" no-caps class="dense-tab" />
              </q-tabs>

              <q-tab-panels v-model="outputTab" animated>
                <q-tab-panel name="js" class="q-pa-none">
                  <CodeEditor
                    v-model="jsSource"
                    placeholder="Generated Code will appear here..."
                    language="javascript"
                  />
                </q-tab-panel>

                <q-tab-panel name="daeJson" class="q-pa-none">
                  <ObjectView v-model="daeJsonOutput" copy-btn read-only enable-expert-mode />
                </q-tab-panel>

                <q-tab-panel name="daePretty" class="q-pa-none">
                  <pre class="q-ma-sm">{{ daePrettyOutput }}</pre>
                </q-tab-panel>
              </q-tab-panels>
            </div>
          </q-tab-panel>

          <q-tab-panel name="simulate" class="q-pa-none fit">
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
          </q-tab-panel>

          <q-tab-panel name="plot" class="q-pa-none fit">
            <q-card flat>
              <q-card-section>
                <ObjectPathCharts
                  v-model="plotCharts"
                  v-model:options="plotViewOptions"
                  :source="plotSourceData"
                  :path-units="plotPathUnits"
                  :show-add-map-button="false"
                />
              </q-card-section>
            </q-card>
          </q-tab-panel>
        </q-tab-panels>
      </q-card>
    </template>

    <template #assistant>
      <TaskyonIframe
        :url="props.taskyonUrl"
        :tools="tools"
        :configuration="configuration"
        profile-name="modelica_edit_page"
        :binding-key="props.bindingKey"
        missing-binding-key-policy="noBindingKey"
        name="modelica-chat"
        :persist="true"
      />
    </template>
  </DockView>
</template>

<script setup lang="ts">
import {
  matCode,
  matContentCopy,
  matDescription,
  matDelete,
  matNavigateBefore,
  matNavigateNext,
  matShowChart,
} from '@quasar/extras/material-icons'
import { mdiFileTreeOutline, mdiTextBoxPlus } from '@quasar/extras/mdi-v6'
import { toolCall } from '@taskyon/tyclient'
import { watchDebounced } from '@vueuse/core'
import type { JSONSchema7 } from 'json-schema'
import { Dialog, Notify } from 'quasar'
import CodeEditor from '../components/CodeEditor.vue'
import type { DockNode } from '../components/DockView.vue'
import DockView from '../components/DockView.vue'
import TaskyonIframe from '../components/TaskyonIframe.vue'
import ObjectView from '../components/varViews/ObjectView.vue'
import {
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
  isSourceKeyScope,
  makeSourceKey,
  parseSourceKey,
  packProjectFile as packModelicaProjectFile,
  unpackProjectFile,
  runModelicaSandbox,
} from './modelica'
import defaultUiTemplateSource from './ui_template_placeholders.html?raw'
import type { partialTyConfiguration } from '@taskyon/tyclient'
import { copyToClipboard } from '../modules/utils'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Extension } from '@codemirror/state'
import { safeYamlDump } from '../modules/yamlUtils'
import { syncStateWithOPFSFolder } from '../modules/saveState'
import ModelicaActionsBar from './components/ModelicaActionsBar.vue'
import ModelicaLibraryTreeView from './components/libraryTree/ModelicaLibraryTreeView.vue'
import ModelicaDiagramPane from './components/ModelicaDiagramPane.vue'
import { mapRumocaClassTree } from './components/libraryTree/mapRumocaClasses'
import type { ModelicaLibraryTreeNode } from './components/libraryTree/types'
import { createModelicatools } from './modelicaTools'
import { useProjectFileStore } from './useProjectFileStore'
import { useModelicaLibraries } from './useModelicaLibraries'
import { useSolverRegistry } from './useSolverRegistry'
import { createModelicaLspCompletionExtension } from './modelicaLspCompletion'
import { ModelicaWorkerClient } from './modelicaWorkerClient'
import ObjectPathCharts from '../components/ObjectPathCharts.vue'
import type { ObjectPathChartsViewOptions } from '../components/ObjectPathCharts.vue'
import { createRumocaModelicaDiagramExtractor } from './diagram/rumocaModelicaDiagramExtractor'

type StatusType = 'loading' | 'success' | 'error' | ''
type PlotChartSelection = {
  x?: string | undefined
  y?: string | undefined
  z?: string | undefined
  title?: string | undefined
}
type PlotViewOptions = ObjectPathChartsViewOptions

const props = withDefaults(
  defineProps<{
    taskyonSignatureOrKey?: string | null
    taskyonUrl?: string
    bindingKey?: CryptoKey | string | null
    taskyonConfiguration?: partialTyConfiguration | null
  }>(),
  {
    taskyonSignatureOrKey: null,
    taskyonUrl: 'https://taskyon.space',
    bindingKey: null,
    taskyonConfiguration: null,
  },
)

const modelicaSource = ref('')
const openedLibraryClassContext = ref<{ qualifiedName: string; sourceSnapshot: string } | null>(
  null,
)
const templateSource = ref('')
const output = ref('') // legacy raw output if needed
const jsSource = ref('') // generated JS shown + executed
const daeJsonOutput = ref<Record<string, unknown>>({}) // DAE JSON (pretty-printed)
const daePrettyOutput = ref('') // Pretty DAE textual representation (from WASM)
const astOutput = ref<unknown>(null) // Parsed AST candidate extracted from compile payload
const workspaceTab = ref<'modelica' | 'diagram'>('modelica')
const templatesTab = ref<'template' | 'uiTemplate' | 'solver'>('template')
const resultsTab = ref<'model' | 'simulate' | 'plot'>('model')
const outputTab = ref<'js' | 'daeJson' | 'daePretty'>('js')
const verbose = ref(false)
const usePreparedDae = ref(true)
const loading = ref(false)
const wasmLoaded = ref(false)
const statusType = ref<StatusType>('loading')
const modelicaWorker = shallowRef<ModelicaWorkerClient | null>(null)
const diagramExtractor = createRumocaModelicaDiagramExtractor(() => modelicaWorker.value)
const modelicaEditorExtensions = shallowRef<Extension[]>([])
const rumocaWasmVersion = ref('unknown')
const rumocaWasmGitCommit = ref('unknown')
const rumocaWasmBuildTimeUtc = ref('unknown')
const formatLocalBuildTime = (buildTimeUtc: string): string => {
  if (!buildTimeUtc || buildTimeUtc === 'unknown') return 'unknown'
  const date = new Date(buildTimeUtc)
  if (Number.isNaN(date.getTime())) return buildTimeUtc
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}
const rumocaWasmBuildTimeLocal = computed(() => formatLocalBuildTime(rumocaWasmBuildTimeUtc.value))
const libraryTreeNodes = ref<ModelicaLibraryTreeNode[]>([])
const asObjectRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const astCandidateFromCompiled = (compiled: unknown): unknown => {
  const record = asObjectRecord(compiled)
  if (!record) return null
  const keys = [
    'ast',
    'source_root_ast',
    'parsed_source_root',
    'parsed_ast',
    'source_ast',
    'parser_output',
  ]
  for (const key of keys) {
    if (key in record) return record[key]
  }
  return null
}

const canCopyAst = computed(() => wasmLoaded.value && modelicaSource.value.trim().length > 0)

const astFileNameFromQualifiedName = (qualifiedName: string | null): string => {
  if (!qualifiedName) return 'Model.mo'
  const normalized = qualifiedName
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
  return normalized ? `${normalized}.mo` : 'Model.mo'
}

function configureModelicaLspExtensions(worker: ModelicaWorkerClient | null) {
  if (!worker) {
    modelicaEditorExtensions.value = []
    return
  }

  const extension = createModelicaLspCompletionExtension(async ({ source, line, character }) =>
    JSON.stringify(await worker.lspCompletionWithTiming(source, line, character)),
  )
  modelicaEditorExtensions.value = [extension]
}

// Simulation / execution state
const simT0 = ref(0)
const simTf = ref(5)
const simDt = ref(0.01)
const allowApplySolverSimDefaults = ref(true)

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
} = useModelicaLibraries({ worker: modelicaWorker })

const {
  solverOptionsSchema,
  solverOptions,
  solverOptionsByKey,
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
  allowApplySolverSimDefaults,
})

const executionResult = ref<Record<string, unknown>>({})
const plotCharts = ref<PlotChartSelection[]>([])
const plotViewOptions = ref<PlotViewOptions>({})
const hasHydratedSimulationSettings = ref(false)
const applyingSimHints = ref(false)
const running = ref(false)
const abortController = ref<AbortController | null>(null)

const hasSimulationResult = computed(
  () => !!executionResult.value && Object.keys(executionResult.value).length > 0,
)
const diagramTargetQualifiedName = computed<string | null>(() => {
  if (openedLibraryClassContext.value?.qualifiedName) {
    return openedLibraryClassContext.value.qualifiedName
  }
  return inferQualifiedModelNameFromSource(modelicaSource.value)
})
const diagramRefreshKey = computed<string>(
  () => `${mslLoaded.value ? '1' : '0'}|${mslArchiveName.value}|${mslFileCount.value}`,
)
const plotSourceData = computed<Record<string, unknown> | null>(() => {
  const data = executionResult.value?.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  return data as Record<string, unknown>
})

const plotPathUnits = computed<Record<string, string>>(() => {
  const meta =
    executionResult.value.meta && typeof executionResult.value.meta === 'object'
      ? (executionResult.value.meta as Record<string, unknown>)
      : {}
  const model =
    meta.model && typeof meta.model === 'object' ? (meta.model as Record<string, unknown>) : {}

  const mapFromVariables = (pathPrefix: string, variables: unknown): Record<string, string> => {
    const vars = Array.isArray(variables) ? variables : []
    const out: Record<string, string> = {}
    for (const entry of vars) {
      if (!entry || typeof entry !== 'object') continue
      const item = entry as Record<string, unknown>
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      const unit = typeof item.unit === 'string' ? item.unit.trim() : ''
      const u = unit.toLowerCase()
      if (!name || !unit || u === 'none' || u === 'null') continue
      out[`${pathPrefix}.${name}`] = unit
    }
    return out
  }

  return {
    t: 's',
    ...mapFromVariables('x', model.stateVariables),
    ...mapFromVariables('y', model.algebraicVariables),
    ...mapFromVariables('u', model.inputVariables),
    ...mapFromVariables('z', model.conditionVariables),
    ...mapFromVariables('c', model.conditionVariables),
  }
})

const predictedStepCount = computed(() => {
  const t0 = Number(simT0.value)
  const tf = Number(simTf.value)
  const dt = Number(simDt.value)
  if (!Number.isFinite(t0) || !Number.isFinite(tf) || !Number.isFinite(dt) || dt <= 0 || tf < t0)
    return 0
  return Math.max(1, Math.floor((tf - t0) / dt) + 1)
})

const actualStepCount = computed<number | null>(() => {
  const meta =
    executionResult.value.meta && typeof executionResult.value.meta === 'object'
      ? (executionResult.value.meta as Record<string, unknown>)
      : {}
  if (typeof meta.nSteps === 'number' && Number.isFinite(meta.nSteps)) return meta.nSteps
  const data =
    executionResult.value.data && typeof executionResult.value.data === 'object'
      ? (executionResult.value.data as Record<string, unknown>)
      : {}
  return Array.isArray(data.t) ? data.t.length : null
})

const actualEventCount = computed<number | null>(() => {
  const meta =
    executionResult.value.meta && typeof executionResult.value.meta === 'object'
      ? (executionResult.value.meta as Record<string, unknown>)
      : {}
  if (typeof meta.eventCount === 'number' && Number.isFinite(meta.eventCount))
    return meta.eventCount
  if (Array.isArray(meta.events)) return meta.events.length
  if (Array.isArray(meta.eventTimes)) return meta.eventTimes.length
  return null
})

function hasExplicitSimulationSettings(sim: {
  t0?: number
  tf?: number
  dt?: number
  solverKey?: string
  solverOptions?: Record<string, unknown>
  solverOptionsByKey?: Record<string, Record<string, unknown>>
  charts?: PlotChartSelection[]
  result?: Record<string, unknown>
}): boolean {
  return (
    't0' in sim ||
    'tf' in sim ||
    'dt' in sim ||
    'solverKey' in sim ||
    'solverOptions' in sim ||
    'solverOptionsByKey' in sim
  )
}

function extractSimulationHintsFromModelica(source: string): {
  t0?: number | undefined
  tf?: number | undefined
  dt?: number | undefined
} {
  const text = String(source || '')
  const annotationMatch = text.match(/annotation\s*\(\s*experiment\s*\(([\s\S]*?)\)\s*\)\s*;/im)
  if (!annotationMatch) return {}
  const body = annotationMatch[1] ?? ''
  const num = '[-+]?\\d*\\.?\\d+(?:[eE][-+]?\\d+)?'
  const read = (name: string): number | undefined => {
    const match = body.match(new RegExp(`\\b${name}\\s*=\\s*(${num})\\b`, 'i'))
    if (!match?.[1]) return undefined
    const parsed = Number(match[1])
    return Number.isFinite(parsed) ? parsed : undefined
  }

  const t0 = read('StartTime')
  const tf = read('StopTime')
  const interval = read('Interval')
  const nIntervals = read('NumberOfIntervals')
  let dt = interval

  if (
    dt === undefined &&
    Number.isFinite(t0) &&
    Number.isFinite(tf) &&
    Number.isFinite(nIntervals) &&
    (nIntervals ?? 0) > 0
  ) {
    dt = (tf! - t0!) / nIntervals!
  }

  return {
    ...(Number.isFinite(t0) ? { t0 } : {}),
    ...(Number.isFinite(tf) ? { tf } : {}),
    ...(Number.isFinite(dt) && (dt ?? 0) > 0 ? { dt } : {}),
  }
}

function applySimulationHintsFromModelica(source: string, options?: { force?: boolean }): boolean {
  if (!options?.force && hasHydratedSimulationSettings.value) return false
  const hints = extractSimulationHintsFromModelica(source)
  const hasAnyHint =
    Number.isFinite(hints.t0) || Number.isFinite(hints.tf) || Number.isFinite(hints.dt)
  if (!hasAnyHint) return false

  applyingSimHints.value = true
  try {
    if (Number.isFinite(hints.t0)) simT0.value = hints.t0!
    if (Number.isFinite(hints.tf)) simTf.value = hints.tf!
    if (Number.isFinite(hints.dt) && hints.dt! > 0) simDt.value = hints.dt!
    hasHydratedSimulationSettings.value = true
    allowApplySolverSimDefaults.value = false
  } finally {
    applyingSimHints.value = false
  }
  return true
}

function resetSimulationSettingsFromModelAnnotations() {
  const applied = applySimulationHintsFromModelica(modelicaSource.value, { force: true })
  if (!applied) {
    Notify.create({
      type: 'warning',
      message: 'No annotation(experiment(...)) defaults found in current Modelica model.',
    })
  }
}

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
//   { rumoca: { kind: 'modelicaSandboxLog', runId, entry } }
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
  const payload = data?.rumoca
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
  modelicaWorker.value?.terminate()
  modelicaWorker.value = null
})

const configuration = computed<partialTyConfiguration | null>(() => {
  const taskyonKey = props.taskyonSignatureOrKey
  if (taskyonKey == null) return null
  const customAppConfiguration = props.taskyonConfiguration?.appConfiguration ?? {}
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
      ...customAppConfiguration,
    },
    signatureOrKey: String(taskyonKey),
  }
})

function createDefaultLayout(): DockNode {
  return {
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
                id: 'library-tree',
                type: 'leaf',
                size: 25,
                views: ['libraryTree'],
                activeViewIndex: 0,
                collapsed: true,
              },
              {
                id: 'workbench',
                type: 'leaf',
                size: 85,
                views: ['workspace', 'templates', 'results'],
                activeViewIndex: 0,
              },
            ],
          },
          {
            id: 'logs',
            type: 'leaf',
            showTabs: 'always',
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
  }
}

const initialLayout = ref<DockNode>(createDefaultLayout())

function layoutContainsLegacyWorkbenchViews(node: DockNode): boolean {
  const legacyViews = [
    'modelica',
    'diagram',
    'template',
    'uiTemplate',
    'solver',
    'model',
    'simulate',
    'plot',
  ]
  if (node.type === 'leaf') {
    return legacyViews.some((view) => Array.isArray(node.views) && node.views.includes(view))
  }
  if (node.type !== 'container' || !Array.isArray(node.children)) return false
  return node.children.some((child) => layoutContainsLegacyWorkbenchViews(child))
}

type WorkbenchView = 'workspace' | 'templates' | 'results'
const workbenchViews: WorkbenchView[] = ['workspace', 'templates', 'results']

const asWorkbenchView = (value: unknown): WorkbenchView | null => {
  if (typeof value !== 'string') return null
  const raw = value
  return workbenchViews.includes(raw as WorkbenchView) ? (raw as WorkbenchView) : null
}

function findActiveWorkbenchView(node: DockNode): WorkbenchView | null {
  if (node.type === 'leaf') {
    const views = Array.isArray(node.views) ? node.views : []
    const activeIndex = Number.isInteger(node.activeViewIndex) ? Number(node.activeViewIndex) : 0
    const activeView = asWorkbenchView(views[activeIndex])
    if (activeView) return activeView
    for (const view of views) {
      const normalized = asWorkbenchView(view)
      if (normalized) return normalized
    }
    return null
  }
  if (node.type !== 'container' || !Array.isArray(node.children)) return null
  for (const child of node.children) {
    const active = findActiveWorkbenchView(child)
    if (active) return active
  }
  return null
}

const activeWorkbenchView = computed<WorkbenchView>(
  () => findActiveWorkbenchView(initialLayout.value) ?? 'workspace',
)

function isLibraryTreeLeaf(node: DockNode): boolean {
  return node.type === 'leaf' && Array.isArray(node.views) && node.views.includes('libraryTree')
}

function ensureLibraryTreeLayoutDefaults(node: DockNode) {
  if (node.type === 'leaf') {
    if (isLibraryTreeLeaf(node) && typeof node.collapsed !== 'boolean') node.collapsed = true
    return
  }
  if (node.type !== 'container' || !Array.isArray(node.children)) return

  for (const child of node.children) ensureLibraryTreeLayoutDefaults(child)

  if (node.direction !== 'row') return
  const index = node.children.findIndex((child) => isLibraryTreeLeaf(child))
  if (index <= 0) return
  const [libraryNode] = node.children.splice(index, 1)
  if (libraryNode) node.children.unshift(libraryNode)
}

const jinjaTemplateUrls = import.meta.glob('./*.jinja', {
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
    .map((key) => ({
      label: makeSourceKey('builtin', key.split('/').pop() ?? key),
      value: makeSourceKey('builtin', key),
    }))

  const customs = Object.keys(customTemplates.value)
    .sort()
    .map((id) => ({ label: makeSourceKey('custom', id), value: makeSourceKey('custom', id) }))

  return [...builtins, ...customs]
})

const isTemplateBuiltin = computed(() =>
  isSourceKeyScope(String(selectedTemplateKey.value || ''), 'builtin'),
)

const canDeleteSelectedTemplate = computed(() =>
  isSourceKeyScope(String(selectedTemplateKey.value || ''), 'custom'),
)

function normalizeTemplateSelectionKey(input: string): string {
  const raw = String(input || '')
  if (!raw) return ''
  const parsed = parseSourceKey(raw)
  if (parsed.scope === 'builtin') {
    const resolvedBuiltin = resolveBuiltinTemplatePath(parsed.id)
    return resolvedBuiltin ? makeSourceKey('builtin', resolvedBuiltin) : raw
  }
  if (parsed.scope) return raw
  const resolvedBuiltin = resolveBuiltinTemplatePath(raw)
  if (resolvedBuiltin) return makeSourceKey('builtin', resolvedBuiltin)
  if (customTemplates.value[raw] != null) return makeSourceKey('custom', raw)
  return raw
}

function resolveBuiltinTemplatePath(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  if (jinjaTemplateUrls[raw]) return raw

  const basename = raw.split('/').filter(Boolean).pop() ?? ''
  if (!basename) return ''
  const compactKey = `./${basename}`
  if (jinjaTemplateUrls[compactKey]) return compactKey

  const fallbackKey = Object.keys(jinjaTemplateUrls).find((key) => key.endsWith(`/${basename}`))
  return fallbackKey ?? ''
}

function pickPreferredBuiltinTemplatePath(): string {
  const builtinKeys = Object.keys(jinjaTemplateUrls)
  const js = builtinKeys.find((tplKey) => tplKey.includes('javascript.jinja'))
  if (js) return js
  return builtinKeys[0] ?? ''
}

function ensureValidTemplateSelection() {
  const rawKey = String(selectedTemplateKey.value || '')
  const normalized = normalizeTemplateSelectionKey(rawKey)
  const parsed = parseSourceKey(normalized)
  if (parsed.scope === 'builtin' && !resolveBuiltinTemplatePath(parsed.id)) {
    const fallback = pickPreferredBuiltinTemplatePath()
    selectedTemplateKey.value = fallback ? makeSourceKey('builtin', fallback) : ''
    return
  }
  selectedTemplateKey.value = normalized
}

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

  selectedTemplateKey.value = makeSourceKey('custom', id)
  Notify.create({ type: 'positive', message: `Template added: ${id}` })
}

function deleteSelectedTemplate() {
  const key = String(selectedTemplateKey.value || '')
  if (!isSourceKeyScope(key, 'custom')) return
  const id = parseSourceKey(key).id

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
  selectedTemplateKey.value = nextId ? makeSourceKey('custom', nextId) : ''
}

// Keep templateSource in sync when editing a custom template
watchDebounced(
  templateSource,
  (src) => {
    const key = String(selectedTemplateKey.value || '')
    if (!isSourceKeyScope(key, 'custom')) return
    const id = parseSourceKey(key).id
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

const builtinUiTemplates = { default: defaultUiTemplateSource } as const
const uiTemplates = ref<Record<string, string>>({})
const selectedUiTemplateKey = ref<string>(makeSourceKey('builtin', 'default'))
const newUiTemplateId = ref<string>('ui2')

const uiTemplateOptions = computed(() => {
  const builtins = Object.keys(builtinUiTemplates)
    .sort()
    .map((id) => ({ label: makeSourceKey('builtin', id), value: makeSourceKey('builtin', id) }))
  const projects = Object.keys(uiTemplates.value)
    .sort()
    .map((id) => ({ label: makeSourceKey('project', id), value: makeSourceKey('project', id) }))
  return [...builtins, ...projects]
})

const isUiTemplateBuiltin = computed(() =>
  isSourceKeyScope(String(selectedUiTemplateKey.value || ''), 'builtin'),
)

const canDeleteSelectedUiTemplate = computed(() => {
  const key = String(selectedUiTemplateKey.value || '')
  return isSourceKeyScope(key, 'project') && Object.keys(uiTemplates.value).length > 0
})

const activeUiTemplateSource = computed({
  get: () => {
    const key = String(selectedUiTemplateKey.value || '')
    if (isSourceKeyScope(key, 'builtin')) {
      const id = parseSourceKey(key).id
      return builtinUiTemplates[id as keyof typeof builtinUiTemplates] ?? ''
    }
    if (isSourceKeyScope(key, 'project')) {
      return uiTemplates.value[parseSourceKey(key).id] ?? ''
    }
    return uiTemplates.value[key] ?? ''
  },
  set: (v: string) => {
    const key = String(selectedUiTemplateKey.value || '')
    if (isSourceKeyScope(key, 'builtin')) return
    const id = parseSourceKey(key).id
    if (!id) return
    uiTemplates.value = { ...uiTemplates.value, [id]: String(v ?? '') }
  },
})

function addUiTemplate() {
  const id = String(newUiTemplateId.value || '').trim()
  if (!id) return
  if ((builtinUiTemplates as Record<string, string>)[id] != null) {
    Notify.create({ type: 'warning', message: `UI template '${id}' is reserved by built-ins` })
    selectedUiTemplateKey.value = makeSourceKey('builtin', id)
    return
  }
  if (uiTemplates.value[id] != null) {
    Notify.create({ type: 'warning', message: `UI template '${id}' already exists` })
    selectedUiTemplateKey.value = makeSourceKey('project', id)
    return
  }
  uiTemplates.value = { ...uiTemplates.value, [id]: defaultUiTemplateSource }
  selectedUiTemplateKey.value = makeSourceKey('project', id)
}

function deleteActiveUiTemplate() {
  const key = String(selectedUiTemplateKey.value || '')
  if (!isSourceKeyScope(key, 'project')) return
  const id = parseSourceKey(key).id
  if (!id || uiTemplates.value[id] == null) return

  const keys = Object.keys(uiTemplates.value)
  const nextProject = keys.find((k) => k !== id)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [id]: _removed, ...rest } = uiTemplates.value
  uiTemplates.value = rest
  selectedUiTemplateKey.value = nextProject
    ? makeSourceKey('project', nextProject)
    : makeSourceKey('builtin', 'default')
}

function resolveUiTemplateKey(idOrKey: string): string {
  const raw = String(idOrKey || '')
  if (!raw) return makeSourceKey('builtin', 'default')
  const parsed = parseSourceKey(raw)
  if (parsed.scope === 'builtin' || parsed.scope === 'project') return raw
  const id = parsed.id
  if (uiTemplates.value[id] != null) return makeSourceKey('project', id)
  if ((builtinUiTemplates as Record<string, string>)[id] != null)
    return makeSourceKey('builtin', id)
  return makeSourceKey('builtin', 'default')
}

function clearModelicaLog() {
  modelicaLog.value = []
}

function resetDockLayout() {
  initialLayout.value = createDefaultLayout()
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
    activeUiTemplateId: parseSourceKey(selectedUiTemplateKey.value).id,
    projectSolvers: projectSolvers.value,
    sim: {
      t0: simT0.value,
      tf: simTf.value,
      dt: simDt.value,
      solverKey: selectedSolverKey.value,
      solverOptions: solverOptions.value,
      solverOptionsByKey: solverOptionsByKey.value,
      charts: plotCharts.value,
      plotViewOptions: plotViewOptions.value,
      result: executionResult.value,
    },
    documentVersions: documentVersions.value,
    currentVersionIndex: currentVersionIndex.value,
  })
}

function applyProjectFile(pf: TyModelicaProjectFileV1) {
  const state = unpackProjectFile(pf, builtinSolvers)
  plotCharts.value = []
  plotViewOptions.value = {}
  executionResult.value = {}
  hasHydratedSimulationSettings.value = hasExplicitSimulationSettings(state.sim)
  allowApplySolverSimDefaults.value = !hasHydratedSimulationSettings.value
  modelicaSource.value = state.modelicaSource
  uiTemplates.value = state.uiTemplates
  selectedUiTemplateKey.value = resolveUiTemplateKey(state.selectedUiTemplateId)
  if (state.projectSolvers) projectSolvers.value = state.projectSolvers
  if (typeof state.sim.t0 === 'number') simT0.value = state.sim.t0
  if (typeof state.sim.tf === 'number') simTf.value = state.sim.tf
  if (typeof state.sim.dt === 'number') simDt.value = state.sim.dt
  if (typeof state.sim.solverKey === 'string') selectedSolverKey.value = state.sim.solverKey
  if (state.sim.solverOptionsByKey) solverOptionsByKey.value = state.sim.solverOptionsByKey
  if (state.sim.solverOptions) solverOptions.value = state.sim.solverOptions
  if (Array.isArray(state.sim.charts)) plotCharts.value = state.sim.charts
  if (state.sim.plotViewOptions && typeof state.sim.plotViewOptions === 'object') {
    plotViewOptions.value = state.sim.plotViewOptions
  }
  if (state.sim.result && typeof state.sim.result === 'object') {
    executionResult.value = state.sim.result
  }
  if (!hasHydratedSimulationSettings.value) {
    applySimulationHintsFromModelica(state.modelicaSource, { force: true })
  }
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
  if (!isSourceKeyScope(key, 'builtin')) return
  const path = resolveBuiltinTemplatePath(parseSourceKey(key).id)
  const loader = jinjaTemplateUrls[path]
  if (!loader) return
  const content = (await loader()) as string
  templateSource.value = content ?? ''
}

const isHtmlOutput = computed(() => {
  const s = (jsSource.value ?? '').trimStart()
  return /^<!doctype\s+html/i.test(s) || /^<html\b/i.test(s)
})
const canRunModel = computed(
  () => statusType.value === 'success' && Boolean(jsSource.value) && !isHtmlOutput.value,
)

const hasUiTemplate = computed(() => {
  const src = activeUiTemplateSource.value
  return typeof src === 'string' && src.trim().length > 0
})

const projectMenuOptions = ref<Record<string, unknown>>({
  verboseLogging: false,
  aiSeesAll: true,
  usePreparedDae: true,
})
const libraryMenuOptions = ref<Record<string, unknown>>({
  useMSL: false,
  mslZipUrl: DEFAULT_MSL_ZIP_URL,
})
const runtimeMenuOptions = ref<Record<string, unknown>>({
  t0: simT0.value,
  tf: simTf.value,
  dt: simDt.value,
  rumocaWasmVersion: rumocaWasmVersion.value,
  rumocaWasmGitCommit: rumocaWasmGitCommit.value,
  rumocaWasmBuildTimeLocal: rumocaWasmBuildTimeLocal.value,
})

const projectMenuSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    verboseLogging: { type: 'boolean', title: 'Verbose logging' },
    aiSeesAll: { type: 'boolean', title: 'AI sees all editors' },
    usePreparedDae: { type: 'boolean', title: 'Use prepared DAE for template rendering' },
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
    rumocaWasmVersion: { type: 'string', title: 'Rumoca WASM version', readOnly: true },
    rumocaWasmGitCommit: { type: 'string', title: 'Rumoca WASM git commit', readOnly: true },
    rumocaWasmBuildTimeLocal: {
      type: 'string',
      title: 'Rumoca WASM build time (local)',
      readOnly: true,
    },
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
    templateSource.value,
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
  [verbose, showAllInPrompt, usePreparedDae],
  () => {
    projectMenuOptions.value = {
      verboseLogging: Boolean(verbose.value),
      aiSeesAll: Boolean(showAllInPrompt.value),
      usePreparedDae: Boolean(usePreparedDae.value),
    }
  },
  { immediate: true },
)

watch(
  projectMenuOptions,
  (v) => {
    if (typeof v.verboseLogging === 'boolean') verbose.value = v.verboseLogging
    if (typeof v.aiSeesAll === 'boolean') showAllInPrompt.value = v.aiSeesAll
    if (typeof v.usePreparedDae === 'boolean') usePreparedDae.value = v.usePreparedDae
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
  [simT0, simTf, simDt, rumocaWasmVersion, rumocaWasmGitCommit, rumocaWasmBuildTimeLocal],
  () => {
    runtimeMenuOptions.value = {
      t0: Number(simT0.value),
      tf: Number(simTf.value),
      dt: Number(simDt.value),
      rumocaWasmVersion: rumocaWasmVersion.value,
      rumocaWasmGitCommit: rumocaWasmGitCommit.value,
      rumocaWasmBuildTimeLocal: rumocaWasmBuildTimeLocal.value,
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

watch([simT0, simTf, simDt], () => {
  if (isHydratingState.value || applyingSimHints.value) return
  hasHydratedSimulationSettings.value = true
  allowApplySolverSimDefaults.value = false
})

// ---------- Compile Modelica → JS & DAE via new API ----------
const runCompilation = async (): Promise<{ ok: boolean; message?: string }> => {
  loading.value = true
  output.value = ''
  statusType.value = 'loading'
  try {
    const worker = modelicaWorker.value
    if (!worker) throw new Error('Modelica worker not loaded')
    const match = modelicaSource.value.match(/(?:model|class|block|connector|record)\s+(\w+)/)
    const localModelName = match?.[1] ?? 'Model'
    const qualifiedFromSource = inferQualifiedModelNameFromSource(modelicaSource.value)
    const useSourceRoots = useModelicaStandardLibrary.value && mslLoaded.value
    const unchangedLibraryClass =
      openedLibraryClassContext.value != null &&
      openedLibraryClassContext.value.sourceSnapshot === modelicaSource.value
    const isModelicaStdlibClass =
      typeof qualifiedFromSource === 'string' && qualifiedFromSource.startsWith('Modelica.')
    const compileFromSourceRootsOnly =
      useSourceRoots && (unchangedLibraryClass || isModelicaStdlibClass)

    const compileSource = compileFromSourceRootsOnly ? '' : modelicaSource.value
    const compileModelName = compileFromSourceRootsOnly
      ? openedLibraryClassContext.value?.qualifiedName || qualifiedFromSource || localModelName
      : qualifiedFromSource || localModelName

    let compile: Awaited<ReturnType<ModelicaWorkerClient['compileRender']>>
    try {
      compile = await worker.compileRender({
        modelicaSource: compileSource,
        templateSource: templateSource.value,
        modelName: compileModelName,
        usePreparedDae: usePreparedDae.value,
        useSourceRoots,
      })
    } catch (error) {
      const msg = (error as Error).message || ''
      const shouldRetryWithoutLocalSource =
        useSourceRoots &&
        /Duplicate class\s+'[^']+'\s+found in\s+'input\.mo'/i.test(msg) &&
        Boolean(qualifiedFromSource)
      if (!shouldRetryWithoutLocalSource) throw error
      compile = await worker.compileRender({
        modelicaSource: '',
        templateSource: templateSource.value,
        modelName: qualifiedFromSource as string,
        usePreparedDae: usePreparedDae.value,
        useSourceRoots,
      })
    }
    daeJsonOutput.value = compile.daeForTemplate ?? {}
    daePrettyOutput.value =
      typeof compile.compiled?.pretty === 'string' ? compile.compiled.pretty : ''
    astOutput.value = astCandidateFromCompiled(compile.compiled)
    output.value = String(compile.rendered || '')
    jsSource.value = String(compile.rendered || '')
    statusType.value = 'success'
    return { ok: true, message: 'Compilation successful' }
  } catch (error) {
    const message = (error as Error).message
    const compileErrorText = `Error: ${message}`
    output.value = compileErrorText
    jsSource.value = compileErrorText
    statusType.value = 'error'
    appendModelicaLog({
      level: 'error',
      phase: 'compile',
      message: `Compilation failed: ${message}`,
    })
    return { ok: false, message }
  } finally {
    loading.value = false
  }
}

function inferQualifiedModelNameFromSource(sourceModelica: string): string | null {
  const source = String(sourceModelica || '')
  const within = source.match(/^\s*within\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/m)?.[1]
  const cls = source.match(/(?:model|class|block|connector|record)\s+([A-Za-z_][A-Za-z0-9_]*)/)?.[1]
  if (!cls) return null
  if (!within) return cls
  return `${within}.${cls}`
}

// Wire explicit compile entrypoint into tools (autofix cycle).
compileNowFn = runCompilation

watchDebounced(
  [modelicaSource, templateSource, useModelicaStandardLibrary, mslLoaded, wasmLoaded],
  async () => {
    if (!wasmLoaded.value) return
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
    if (isSourceKeyScope(k, 'builtin')) {
      const path = resolveBuiltinTemplatePath(parseSourceKey(k).id)
      const loader = jinjaTemplateUrls[path]
      if (!loader) return
      const content = (await loader()) as string
      templateSource.value = content ?? ''
      return
    }

    if (isSourceKeyScope(k, 'custom')) {
      const id = parseSourceKey(k).id
      templateSource.value = customTemplates.value[id] ?? ''
    }
  },
  { debounce: 50, maxWait: 200 },
)

const clearAll = () => {
  modelicaSource.value = ''
  openedLibraryClassContext.value = null
  templateSource.value = ''
  output.value = ''
  jsSource.value = ''
  daeJsonOutput.value = {}
  daePrettyOutput.value = ''
  astOutput.value = null
  executionResult.value = {}
  plotCharts.value = []
  plotViewOptions.value = {}
  hasHydratedSimulationSettings.value = false
  modelicaLog.value = []
}

async function refreshLibraryTree() {
  const worker = modelicaWorker.value
  if (!worker) {
    libraryTreeNodes.value = []
    return
  }
  try {
    const raw = await worker.listClasses()
    libraryTreeNodes.value = mapRumocaClassTree(raw.classes)
  } catch (error) {
    appendModelicaLog({
      level: 'warning',
      phase: 'general',
      message: `Failed to refresh library tree: ${(error as Error).message}`,
    })
  }
}

async function openModelFromLibraryTree(qualifiedName: string) {
  const worker = modelicaWorker.value
  if (!worker) return
  try {
    const info = await worker.getClassInfo(qualifiedName)
    const qualified =
      typeof info.qualified_name === 'string' && info.qualified_name.trim().length > 0
        ? info.qualified_name.trim()
        : qualifiedName
    const sourceModelica = typeof info.source_modelica === 'string' ? info.source_modelica : ''
    if (!sourceModelica.trim()) {
      throw new Error(`No source available for ${qualifiedName}`)
    }
    const normalizedSource = withLibraryContext(qualified, sourceModelica)
    modelicaSource.value = normalizedSource
    openedLibraryClassContext.value = {
      qualifiedName: qualified,
      sourceSnapshot: normalizedSource,
    }
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Loaded model from library tree: ${qualifiedName}`,
    })
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: `Failed to open model ${qualifiedName}: ${(error as Error).message}`,
    })
  }
}

function withLibraryContext(qualifiedName: string, sourceModelica: string): string {
  const source = String(sourceModelica || '')
  if (!source.trim()) return source
  if (/^\s*within\s+[A-Za-z0-9_.]+\s*;/m.test(source)) return source

  const parts = String(qualifiedName || '')
    .split('.')
    .filter(Boolean)
  if (parts.length < 2) return source
  const parent = parts.slice(0, -1).join('.')

  const needsBlocksAliases =
    qualifiedName.startsWith('Modelica.Blocks.Examples.') || /(?:^|\s)(Sources|Math)\./.test(source)
  if (!needsBlocksAliases) return `within ${parent};\n\n${source}`

  const imports: string[] = []
  const hasSourcesAlias = /(?:^|\n)\s*import\s+Sources\s*=/.test(source)
  const hasMathAlias = /(?:^|\n)\s*import\s+Math\s*=/.test(source)
  if (/\bSources\./.test(source) && !hasSourcesAlias) {
    imports.push('import Sources = Modelica.Blocks.Sources;')
  }
  if (/\bMath\./.test(source) && !hasMathAlias) {
    imports.push('import Math = Modelica.Blocks.Math;')
  }
  const importsBlock = imports.length > 0 ? `${imports.join('\n')}\n\n` : ''
  return `within ${parent};\n\n${importsBlock}${source}`
}

async function handleImportMslZip(e: Event) {
  await onImportMslZip(e)
  useModelicaStandardLibrary.value = true
  await refreshLibraryTree()
}

async function handleLoadCachedMslZipFromOpfs() {
  await loadCachedMslZipFromOpfs()
  useModelicaStandardLibrary.value = true
  await refreshLibraryTree()
}

async function handleClearModelicaLibraries() {
  await clearModelicaLibraries()
  useModelicaStandardLibrary.value = false
  libraryTreeNodes.value = []
}

const exampleModels = {
  bouncingBall: `model BouncingBall             "The bouncing ball model"
  constant Real g(unit = "m/s2") = 9.81 "Gravitational acceleration";
  parameter Real c = 0.9 "Elasticity constant of ball";
  parameter Real radius(unit = "m") = 0.1 "Radius of the ball";
  Real h(unit = "m", start = 1, fixed = true) "Height above ground of ball center";
  Real v(unit = "m/s", start = 0, fixed = true) "Velocity of the ball";
  Real E(unit = "m2/s2") "Specific mechanical energy";
 equation
  der(h) = v;
  der(v) = -g;
  E = g*h + 0.5*v*v;
  when h <= radius then
    reinit(v, -c*pre(v));
  end when;
 annotation(experiment(StartTime = 0, StopTime = 7, Interval = 0.1));
end BouncingBall;`,
  resistorMsl: `model MslResistorExample
  extends Modelica.Electrical.Analog.Examples.Resistor;
  annotation(experiment(StartTime = 0, StopTime = 5, Interval = 0.1));
end MslResistorExample;`,
  orbit: `model SatelliteOrbit2D
  parameter Real mu(unit = "km3/s2") = 398600.4418;
  parameter Real r0(unit = "km") = 7000;
  parameter Real v0(unit = "km/s") = sqrt(mu / r0);
  Real rx(unit = "km", start = r0, fixed = true);
  Real ry(unit = "km", start = 0, fixed = true);
  Real vx(unit = "km/s", start = 0, fixed = true);
  Real vy(unit = "km/s", start = v0, fixed = true);
  Real inv_r(unit = "km");
  Real inv_v2(unit = "km2/s2");
  Real inv_h(unit = "km2/s");
  Real inv_energy(unit = "km2/s2");
  Real inv_a(unit = "km");
  Real inv_rv(unit = "km2/s");
  Real inv_ex;
  Real inv_ey;
  Real inv_ecc;
equation
  der(rx) = vx;
  der(ry) = vy;
  inv_r = sqrt(rx * rx + ry * ry);
  inv_v2 = vx * vx + vy * vy;
  inv_h = rx * vy - ry * vx;
  inv_energy = 0.5 * inv_v2 - mu / inv_r;
  inv_a = 1 / (2 / inv_r - inv_v2 / mu);
  inv_rv = rx * vx + ry * vy;
  inv_ex = ((inv_v2 - mu / inv_r) * rx - inv_rv * vx) / mu;
  inv_ey = ((inv_v2 - mu / inv_r) * ry - inv_rv * vy) / mu;
  inv_ecc = sqrt(inv_ex * inv_ex + inv_ey * inv_ey);
  der(vx) = -mu * rx / (inv_r ^ 3);
  der(vy) = -mu * ry / (inv_r ^ 3);
  annotation(experiment(StartTime = 0, StopTime = 6000, Interval = 20));
end SatelliteOrbit2D;`,
  drivenPendulumPhaseMap: `model DrivenPendulumPhaseMap
  parameter Real delta = 0.2 "Linear damping";
  parameter Real driveAmp(unit = "rad/s2") = 1.2 "Drive amplitude";
  parameter Real driveOmega(unit = "rad/s") = 2/3 "Drive angular frequency";
  Real theta(unit = "rad", start = 0.2, fixed = true) "Angle";
  Real omega(unit = "rad/s", start = 0.0, fixed = true) "Angular velocity";
  Real phaseEnergy(unit = "rad2/s2") "Kinetic + potential-like scalar for color mapping";
equation
  der(theta) = omega;
  der(omega) = -sin(theta) - delta * omega + driveAmp * sin(driveOmega * time);
  phaseEnergy = 0.5 * omega * omega + (1 - cos(theta));
  annotation(experiment(StartTime = 0, StopTime = 200, Interval = 0.02));
end DrivenPendulumPhaseMap;`,
} as const

const exampleCharts: Partial<Record<keyof typeof exampleModels, PlotChartSelection[]>> = {
  drivenPendulumPhaseMap: [
    {
      x: 'x.theta',
      y: 'x.omega',
      title: 'Driven Pendulum Phase-Space Heatmap (theta, omega, phaseEnergy)',
    },
    {
      x: 't',
      y: 'x.theta',
      title: 'theta(t)',
    },
  ],
}

const applyExample = async (choice: unknown) => {
  const key = String(choice) as keyof typeof exampleModels
  modelicaSource.value = exampleModels[key] ?? exampleModels.bouncingBall
  applySimulationHintsFromModelica(modelicaSource.value)
  const presetCharts = exampleCharts[key]
  plotCharts.value = presetCharts ? [...presetCharts] : []
  plotViewOptions.value = { viewMode: 'full' }

  // select template that contains "javascript"
  const sel = Object.keys(jinjaTemplateUrls).find((tplKey) => tplKey.includes('javascript.jinja'))
  if (!sel) return

  selectedTemplateKey.value = makeSourceKey('builtin', sel)
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
        { label: 'Satellite Orbit (2D)', value: 'orbit' },
        { label: 'Driven Pendulum (phase-space heatmap)', value: 'drivenPendulumPhaseMap' },
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

const copyAstToClipboard = async () => {
  if (astOutput.value == null) {
    const worker = modelicaWorker.value
    if (!worker) return
    const qualifiedFromSource = inferQualifiedModelNameFromSource(modelicaSource.value)
    const astFileName = astFileNameFromQualifiedName(qualifiedFromSource)
    astOutput.value = await worker.parseSourceAst({
      source: modelicaSource.value,
      fileName: astFileName,
    })
  }
  if (astOutput.value == null) return
  await copyToClipboard(JSON.stringify(astOutput.value, null, 2))
}

const copyLogsToClipboard = async () => {
  await copyToClipboard(safeYamlDump(modelicaLog.value))
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
  if (!canRunModel.value) {
    Notify.create({
      type: 'warning',
      message: 'Run is disabled because the latest compilation failed.',
    })
    return
  }
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
    if (result.ok) {
      executionResult.value = normalizeSimulationResultForDisplay(result.result)
      const meta =
        executionResult.value.meta && typeof executionResult.value.meta === 'object'
          ? (executionResult.value.meta as Record<string, unknown>)
          : {}
      const stopReason = typeof meta.stopReason === 'string' ? meta.stopReason : ''
      const stopError = typeof meta.stopError === 'string' ? meta.stopError : ''
      if (stopReason) {
        const message = stopError
          ? `Simulation stopped early: ${stopReason} (${stopError})`
          : `Simulation stopped early: ${stopReason}`
        appendModelicaLog({
          phase: 'run',
          level: 'error',
          message,
          details: {
            stopReason,
            stopError,
            stopDetails: meta.stopDetails,
          },
        })
        Notify.create({
          type: 'negative',
          message,
          timeout: 7000,
        })
      }
    }
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
    workspaceTab,
    selectedTemplateKey,
    templateSource,
    customTemplates,
    verbose,
    usePreparedDae,
    useModelicaStandardLibrary,
    mslDownloadUrl,
    mslCachedZipPath,
    templatesTab,
    resultsTab,
    outputTab,
    showAllInPrompt,
    currentProjectId,
  })
  if (layoutContainsLegacyWorkbenchViews(initialLayout.value)) {
    initialLayout.value = createDefaultLayout()
  }
  ensureValidTemplateSelection()
  ensureLibraryTreeLayoutDefaults(initialLayout.value)

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
      uiTemplates.value = {}
      selectedUiTemplateKey.value = makeSourceKey('builtin', 'default')
      modelicaSource.value = ''
      plotCharts.value = []
      executionResult.value = {}
      hasHydratedSimulationSettings.value = false
      allowApplySolverSimDefaults.value = true

      // Ensure we always have at least one version snapshot
      if (documentVersions.value.length === 0) {
        createNewVersion('Initial')
      }

      projectFile.value = packProjectFile()
    }
  } catch (e) {
    console.warn('Project hydration failed, resetting project file:', e)
    uiTemplates.value = {}
    selectedUiTemplateKey.value = makeSourceKey('builtin', 'default')
    modelicaSource.value = ''
    plotCharts.value = []
    executionResult.value = {}
    hasHydratedSimulationSettings.value = false
    allowApplySolverSimDefaults.value = true
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
      selectedUiTemplateKey,
      projectSolvers,
      simT0,
      simTf,
      simDt,
      selectedSolverKey,
      solverOptionsByKey,
      plotCharts,
      plotViewOptions,
      executionResult,
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
    { debounce: 200, maxWait: 800, deep: true },
  )

  // 3) Modelica worker
  try {
    const worker = new ModelicaWorkerClient()
    modelicaWorker.value = worker
    const hardwareThreads =
      typeof navigator !== 'undefined' &&
      typeof navigator.hardwareConcurrency === 'number' &&
      Number.isFinite(navigator.hardwareConcurrency)
        ? navigator.hardwareConcurrency
        : 2
    const canUseThreadedWasm = globalThis.crossOriginIsolated === true
    const requestedThreads = canUseThreadedWasm ? Math.max(1, Math.min(hardwareThreads, 4)) : 0
    const initInfo = await worker.init(requestedThreads)
    configureModelicaLspExtensions(worker)
    wasmLoaded.value = true
    if (initInfo.version) rumocaWasmVersion.value = initInfo.version
    if (initInfo.gitCommit) rumocaWasmGitCommit.value = initInfo.gitCommit
    if (initInfo.buildTimeUtc) rumocaWasmBuildTimeUtc.value = initInfo.buildTimeUtc
    const documentCount = await worker.getSourceRootDocumentCount()
    if (documentCount > 0) {
      mslLoaded.value = true
      mslFileCount.value = documentCount
      useModelicaStandardLibrary.value = true
      await refreshLibraryTree()
    }
    appendModelicaLog({
      level: 'success',
      phase: 'general',
      message: 'Modelica worker loaded successfully! Ready to compile.',
    })
    await runCompilation()
  } catch (error) {
    appendModelicaLog({
      level: 'error',
      phase: 'general',
      message: `Failed to load WASM: ${(error as Error).message}`,
    })
  }
})
</script>

<style scoped>
.modelica-log-card {
  min-height: 1.5rem;
  height: 100%;
}

.modelica-log-scroll {
  overflow: auto;
  min-height: 0;
}

.modelica-log-actions {
  flex: 0 0 auto;
  position: sticky;
  top: 0;
  align-self: flex-start;
  background: inherit;
}

.dense-tab-strip {
  min-height: 28px;
}

.dense-tab {
  min-height: 28px;
  padding: 0 8px;
  font-size: 12px;
}

.dense-tab-strip :deep(.q-tab__label) {
  line-height: 1.1;
}
</style>
