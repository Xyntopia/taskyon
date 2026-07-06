<!--ModelicaEditor.vue-->
<template>
  <DockView
    v-bind="attrs"
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
    :tab-titles="dockTabTitles"
    :tab-title-tooltips="dockTabTitleTooltips"
  >
    <template #actions>
      <ModelicaActionsBar
        :current-project-id="currentProjectId"
        :available-project-ids="availableProjectIds"
        :project-file="projectFile"
        :project-menu-options="projectMenuOptions"
        :project-menu-schema="projectMenuSchema"
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
        :selected-simulation-backend="selectedSimulationBackend"
        :selected-rumoca-solver="selectedRumocaSolver"
        :selected-solver-key="selectedSolverKey"
        :predicted-steps="predictedStepCount"
        :actual-steps="actualStepCount"
        :event-count="actualEventCount"
        :has-result="hasSimulationResult"
        :process-busy="globalProcessBusy"
        :process-label="globalProcessLabel"
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
        @update:simulation-backend="onSimulationBackendUpdate"
        @update:rumoca-solver="onRumocaSolverUpdate"
        @update:solver-options="solverOptions = $event"
        @reset-sim-from-model="resetSimulationSettingsFromModelAnnotations"
        @update:project-menu-options="onProjectMenuOptionsUpdate"
        @update:runtime-menu-options="onRuntimeMenuOptionsUpdate"
      />
    </template>

    <template #logs>
      <!-- logs -->
      <q-card bordered flat square class="modelica-log-card">
        <div class="row no-wrap fit">
          <div class="col modelica-log-scroll">
            <q-expansion-item
              v-for="(entry, idx) in displayedModelicaLog"
              :key="idx"
              dense
              dense-toggle
            >
              <template #header>
                <div class="row items-center no-wrap full-width q-gutter-xs">
                  <q-spinner v-if="entry.pending" size="14px" color="primary" />
                  <div class="ellipsis">{{ entry.message }}</div>
                </div>
              </template>
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
          <q-tab name="icon" label="Icon" no-caps class="dense-tab" />
          <q-tab name="help" label="Help" no-caps class="dense-tab" />
        </q-tabs>
        <q-separator />
        <q-tab-panels v-model="workspaceTab" animated keep-alive class="col">
          <q-tab-panel name="modelica" class="q-pa-none">
            <div flat class="column">
              <div class="col-auto q-pa-xs row items-center q-gutter-xs">
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
            </div>
          </q-tab-panel>

          <q-tab-panel name="diagram" class="q-pa-none fit">
            <q-card flat class="fit">
              <ModelicaDiagramPane
                :extractor="diagramExtractor"
                :source="activeDiagramSource"
                :qualified-name="activeDiagramQualifiedName"
                :wasm-loaded="wasmLoaded"
                :refresh-key="diagramRefreshKey"
                :can-navigate-back="canNavigateDiagramBack"
                :navigation-depth="diagramNavigationDepth"
                :can-open-code="diagramNavigationDepth > 0 && Boolean(activeDiagramQualifiedName)"
                view-mode="diagram"
                @open-model="openModelFromDiagram"
                @navigate-back="navigateDiagramBack"
                @open-code="openActiveDiagramModelInCode"
              />
            </q-card>
          </q-tab-panel>

          <q-tab-panel name="icon" class="q-pa-none fit">
            <q-card flat class="fit">
              <ModelicaDiagramPane
                :extractor="diagramExtractor"
                :source="activeDiagramSource"
                :qualified-name="activeDiagramQualifiedName"
                :wasm-loaded="wasmLoaded"
                :refresh-key="diagramRefreshKey"
                view-mode="icon"
              />
            </q-card>
          </q-tab-panel>

          <q-tab-panel name="help" class="q-pa-none fit">
            <q-card flat class="fit column">
              <div class="q-pa-sm model-help-scroll">
                <div class="text-caption text-grey-7">
                  Qualified Name:
                  <span class="mono">{{ modelHelpQualifiedName || 'unknown' }}</span>
                </div>
                <div class="text-caption text-grey-7 q-mb-sm">
                  Restriction:
                  <span class="mono">{{ modelHelpRestriction || 'unknown' }}</span>
                  <span class="q-ml-sm">Class Type:</span>
                  <span class="mono">{{ modelHelpClassType || 'unknown' }}</span>
                </div>

                <q-banner
                  v-if="modelHelpError"
                  dense
                  rounded
                  inline-actions
                  class="bg-red-1 text-red-9 q-mb-sm"
                >
                  {{ modelHelpError }}
                </q-banner>

                <SanitizedMarkup
                  v-if="modelHelpHtml.trim().length > 0"
                  class="model-help-doc"
                  :markup="modelHelpHtml"
                  :sanitize="sanitizeModelHelpHtml"
                />
                <pre v-else class="model-help-raw q-ma-none">{{
                  modelHelpRaw || 'No model documentation available.'
                }}</pre>
              </div>
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
        :active-library-loads="activeLibraryLoads"
        :msl-cached-zip-path="mslCachedZipPath"
        :library-menu-options="libraryMenuOptions"
        :library-menu-schema="libraryMenuSchema"
        :nodes="libraryTreeNodes"
        :current-qualified-name="diagramTargetQualifiedName || ''"
        :root-library-metadata="libraryRootMetadata"
        :show-root-metadata="libraryTreeShowRootMetadata"
        @refresh="refreshLibraryTree"
        @open-model="openModelFromLibraryTree"
        @import-library-file="handleImportMslZip"
        @load-cached-msl="handleLoadCachedMslZipFromOpfs"
        @download-msl="downloadMslZipToOpfs"
        @clear-msl="handleClearModelicaLibraries"
        @load-library-preset="handleLoadLibraryPreset"
        @update:show-root-metadata="libraryTreeShowRootMetadata = $event"
        @update:library-menu-options="onLibraryMenuOptionsUpdate"
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
          <q-tab name="analysis" label="DAE Analysis" no-caps class="dense-tab" />
          <q-tab name="simulate" label="Simulate" no-caps class="dense-tab" />
          <q-tab name="plot" label="Plot" no-caps class="dense-tab" />
        </q-tabs>
        <q-separator />
        <q-tab-panels v-model="resultsTab" animated class="col">
          <q-tab-panel name="model" class="q-pa-none fit">
            <div class="q-gutter-xs q-pa-xs">
              <q-btn
                flat
                dense
                label="Update"
                :disable="!canCompileModel || globalProcessBusy"
                @click="runCompilation"
              />
              <q-btn flat dense label="Copy" :disable="!jsSource" @click="copyJsToClipboard" />
              <q-separator />
              <CodeEditor
                v-model="jsSource"
                placeholder="Generated Code will appear here..."
                language="javascript"
              />
            </div>
          </q-tab-panel>

          <q-tab-panel name="analysis" class="q-pa-none fit">
            <ModelicaDaeAnalysisPane
              :analysis="daeAnalysis"
              :loading-by-artifact="analysisArtifactLoading"
              :error-by-artifact="analysisArtifactErrors"
              @open-artifact="refreshAndShowAnalysisArtifact"
              @download-artifact="downloadAnalysisArtifact"
            />
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

  <q-dialog v-model="analysisArtifactDialogOpen" :maximized="false">
    <q-card class="analysis-artifact-dialog">
      <q-bar>
        <div class="text-weight-medium">
          {{ activeAnalysisArtifactMeta?.label || 'Analysis Artifact' }}
        </div>
        <q-space />
        <q-btn
          flat
          dense
          label="Refresh"
          :disable="!activeAnalysisArtifactKey || Boolean(activeAnalysisArtifactBusy)"
          @click="
            activeAnalysisArtifactKey
              ? void refreshAnalysisArtifact(activeAnalysisArtifactKey)
              : undefined
          "
        />
        <q-btn
          flat
          dense
          label="Copy"
          :disable="!activeAnalysisArtifactContent"
          @click="copyActiveAnalysisArtifact"
        />
        <q-btn
          flat
          dense
          label="Download"
          :disable="!activeAnalysisArtifactContent"
          @click="downloadActiveAnalysisArtifact"
        />
        <q-btn v-close-popup flat dense label="Close" />
      </q-bar>
      <q-separator />
      <q-card-section class="analysis-artifact-dialog-body q-pa-none">
        <div
          v-if="activeAnalysisArtifactBusy"
          class="column items-center justify-center q-gutter-sm fit"
        >
          <q-spinner color="primary" size="32px" />
          <div class="text-caption text-grey-7">
            Refreshing {{ activeAnalysisArtifactMeta?.label || 'artifact' }}...
          </div>
        </div>
        <div v-else-if="activeAnalysisArtifactError" class="q-pa-md text-negative">
          {{ activeAnalysisArtifactError }}
        </div>
        <CodeEditor
          v-else
          v-model="activeAnalysisArtifactContent"
          class="fit"
          :language="activeAnalysisArtifactMeta?.language || ''"
          :extra-extensions="readOnlyEditorExtensions"
        />
      </q-card-section>
    </q-card>
  </q-dialog>
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
import CodeEditor from '@taskyon/ui/components/CodeEditor.vue'
import type { DockNode } from '@taskyon/ui/components/DockView.vue'
import DockView from '@taskyon/ui/components/DockView.vue'
import TaskyonIframe from '@taskyon/ui/components/TaskyonIframe.vue'
import ObjectView from '@taskyon/ui/components/varViews/ObjectView.vue'
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
import { copyToClipboard } from '@taskyon/common/modules/utils'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useAttrs, watch } from 'vue'
import { EditorState, type Extension } from '@codemirror/state'
import { safeYamlDump } from '@taskyon/common/modules/yamlUtils'
import { syncStateWithOPFSFolder } from '@taskyon/common/modules/saveState'
import ModelicaActionsBar from './components/ModelicaActionsBar.vue'
import ModelicaDaeAnalysisPane, {
  type ModelicaDaeAnalysis,
} from './components/ModelicaDaeAnalysisPane.vue'
import ModelicaLibraryTreeView from './components/libraryTree/ModelicaLibraryTreeView.vue'
import SanitizedMarkup from '@taskyon/ui/components/SanitizedMarkup.vue'
import { sanitizeHtmlMarkup } from '@taskyon/common/modules/sanitizeMarkup'
import ModelicaDiagramPane from './components/ModelicaDiagramPane.vue'
import { mapRumocaClassTree } from './components/libraryTree/mapRumocaClasses'
import type { ModelicaLibraryTreeNode } from './components/libraryTree/types'
import type { ModelicaAnalysisArtifactKey } from './modelicaAnalysisArtifacts'
import { createModelicatools } from './modelicaTools'
import { useProjectFileStore } from './useProjectFileStore'
import { useModelicaLibraries } from './useModelicaLibraries'
import { useSolverRegistry } from './useSolverRegistry'
import { createModelicaLspCompletionExtension } from './modelicaLspCompletion'
import { ModelicaWorkerClient, type ModelicaWorkerActivityEvent } from './modelicaWorkerClient'
import {
  DEFAULT_MODELICA_LIBRARY_ID,
  detectedModelicaLibraryPresets,
} from './modelicaLibraryCatalog'
import { buildTypeLookupCandidates, extractImportAliases } from './qualifiedNameResolution'
import ObjectPathCharts from '@taskyon/ui/components/ObjectPathCharts.vue'
import type { ObjectPathChartsViewOptions } from '@taskyon/ui/components/ObjectPathCharts.vue'
import { createRumocaModelicaDiagramExtractor } from './diagram/rumocaModelicaDiagramExtractor'

type StatusType = 'loading' | 'success' | 'error' | ''
type PlotChartSelection = {
  x?: string | undefined
  y?: string | undefined
  z?: string | undefined
  title?: string | undefined
}
type PlotViewOptions = ObjectPathChartsViewOptions
type SimulationBackend = 'js' | 'rumoca'
type RenderModelicaViewId = 'base-modelica' | 'flat-modelica' | 'dae-modelica'

defineOptions({
  inheritAttrs: false,
})

const attrs = useAttrs()

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
type WorkerLiveLogEntry = {
  requestId: number
  timestamp: string
  phase: 'compile' | 'run' | 'loadWasm' | 'abi' | 'general'
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  pending: true
  details?: unknown
}

const workerLiveEntries = ref<WorkerLiveLogEntry[]>([])
const workerActivityById = ref<Map<number, { label: string; type: string; startedAt: string }>>(
  new Map(),
)
const workerBusy = computed(() => workerActivityById.value.size > 0)
const workerBusyLabel = computed(() => {
  const entries = Array.from(workerActivityById.value.values())
  if (entries.length === 0) return ''
  if (entries.length === 1) return entries[0]?.label || 'Worker busy'
  return `${entries[0]?.label || 'Worker busy'} (+${entries.length - 1})`
})
const displayedModelicaLog = computed(() => [
  ...modelicaLog.value.map((entry) => ({ ...entry, pending: false as const })),
  ...workerLiveEntries.value,
])
const openedLibraryClassContext = ref<{ qualifiedName: string; sourceSnapshot: string } | null>(
  null,
)
type DiagramNavigationEntry = {
  qualifiedName: string | null
  source: string
}
const diagramNavigationEntry = ref<DiagramNavigationEntry | null>(null)
const diagramNavigationStack = ref<DiagramNavigationEntry[]>([])
const templateSource = ref('')
const output = ref('') // legacy raw output if needed
const jsSource = ref('') // generated JS shown + executed
const daeJsonOutput = ref<Record<string, unknown>>({}) // DAE JSON (pretty-printed)
const daePrettyOutput = ref('') // Base DAE textual representation
const astOutput = ref<unknown>(null) // Parsed AST candidate extracted from compile payload
const workspaceTab = ref<'modelica' | 'diagram' | 'icon' | 'help'>('modelica')
const templatesTab = ref<'template' | 'uiTemplate' | 'solver'>('template')
const resultsTab = ref<'model' | 'analysis' | 'simulate' | 'plot'>('model')
const verbose = ref(false)
const usePreparedDae = ref(true)
const loading = ref(false)
const compileRunToken = ref(0)
const wasmLoaded = ref(false)
const statusType = ref<StatusType>('')
const lastSuccessfulCompilationSignature = ref('')
const analysisArtifactContent = ref<Partial<Record<ModelicaAnalysisArtifactKey, string>>>({})
const analysisArtifactErrors = ref<Partial<Record<ModelicaAnalysisArtifactKey, string>>>({})
const analysisArtifactLoading = ref<Partial<Record<ModelicaAnalysisArtifactKey, boolean>>>({})
const analysisArtifactLoadedSignatures = ref<Partial<Record<ModelicaAnalysisArtifactKey, string>>>(
  {},
)
const analysisArtifactDialogOpen = ref(false)
const activeAnalysisArtifactKey = ref<ModelicaAnalysisArtifactKey | null>(null)
const modelicaWorker = shallowRef<ModelicaWorkerClient | null>(null)
const diagramExtractor = createRumocaModelicaDiagramExtractor(() => modelicaWorker.value)
const modelicaEditorExtensions = shallowRef<Extension[]>([])
const rumocaWasmVersion = ref('unknown')
const rumocaWasmGitCommit = ref('unknown')
const rumocaWasmBuildTimeUtc = ref('unknown')
const rumocaWasmRustBuildTimeUtc = ref('unknown')
const rumocaWasmPackageBuiltTimeUtc = ref('unknown')
const rumocaSimulationAvailable = ref(false)
const rumocaSimulationModelDiscoveryAvailable = ref(false)
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
const rumocaWasmRustBuildTimeLocal = computed(() =>
  formatLocalBuildTime(rumocaWasmRustBuildTimeUtc.value),
)
const rumocaWasmPackageBuiltTimeLocal = computed(() =>
  formatLocalBuildTime(rumocaWasmPackageBuiltTimeUtc.value),
)
const rumocaLibraryCacheVersionMarker = computed(() =>
  [rumocaWasmVersion.value, rumocaWasmGitCommit.value, rumocaWasmPackageBuiltTimeUtc.value].join(
    '|',
  ),
)
const libraryTreeNodes = ref<ModelicaLibraryTreeNode[]>([])
const libraryTreeShowRootMetadata = ref(false)
const asObjectRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const countNodeClasses = (node: ModelicaLibraryTreeNode): number =>
  1 + (node.children ?? []).reduce((sum, child) => sum + countNodeClasses(child), 0)

const countNodeClassType = (node: ModelicaLibraryTreeNode, type: string): number => {
  const own = String(node.classType || '').toLowerCase() === type.toLowerCase() ? 1 : 0
  return (
    own + (node.children ?? []).reduce((sum, child) => sum + countNodeClassType(child, type), 0)
  )
}

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

const astFileNameFromQualifiedName = (qualifiedName: string | null): string => {
  if (!qualifiedName) return 'Model.mo'
  const normalized = qualifiedName
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('/')
  return normalized ? `${normalized}.mo` : 'Model.mo'
}

const readOnlyEditorExtensions = [EditorState.readOnly.of(true)]

type AnalysisArtifactMeta = {
  label: string
  language: string
  fileStem: string
}

const analysisArtifactMetaByKey: Record<ModelicaAnalysisArtifactKey, AnalysisArtifactMeta> = {
  baseDae: { label: 'Base DAE', language: 'modelica', fileStem: 'baseDae' },
  baseModelica: { label: 'Base Modelica', language: 'modelica', fileStem: 'baseModelica' },
  flatModelica: { label: 'Flat Modelica', language: 'modelica', fileStem: 'flatModelica' },
  daeModelica: { label: 'DAE Modelica', language: 'modelica', fileStem: 'daeModelica' },
  daeJson: { label: 'DAE JSON', language: 'json', fileStem: 'daeJson' },
  ast: { label: 'AST', language: 'json', fileStem: 'ast' },
}

const activeAnalysisArtifactMeta = computed(() =>
  activeAnalysisArtifactKey.value
    ? analysisArtifactMetaByKey[activeAnalysisArtifactKey.value]
    : null,
)
const activeAnalysisArtifactContent = computed({
  get: () =>
    activeAnalysisArtifactKey.value
      ? analysisArtifactContent.value[activeAnalysisArtifactKey.value] || ''
      : '',
  set: (value: string) => {
    if (!activeAnalysisArtifactKey.value) return
    analysisArtifactContent.value = {
      ...analysisArtifactContent.value,
      [activeAnalysisArtifactKey.value]: value,
    }
  },
})
const activeAnalysisArtifactError = computed(() =>
  activeAnalysisArtifactKey.value
    ? analysisArtifactErrors.value[activeAnalysisArtifactKey.value] || ''
    : '',
)
const activeAnalysisArtifactBusy = computed(() =>
  activeAnalysisArtifactKey.value
    ? Boolean(analysisArtifactLoading.value[activeAnalysisArtifactKey.value])
    : false,
)

function triggerDownload(fileStem: string, content: string, extension: string, mime: string): void {
  const now = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  const blob = new Blob([content ?? ''], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${fileStem}_${now}.${extension}`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 500)
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
const selectedSimulationBackend = ref<SimulationBackend>('js')
const selectedRumocaSolver = ref('auto')
const allowApplySolverSimDefaults = ref(true)

const {
  useModelicaStandardLibrary,
  mslLoaded,
  mslLoading,
  mslDownloading,
  activeLibraryLoads,
  mslArchiveName,
  mslFileCount,
  mslCachedZipPath,
  standardMslCachedZipPath,
  mslDownloadUrl,
  standardMslLoaded,
  loadedLibraryCachePaths,
  latestLazyLibraryClassTree,
  downloadMslZipToOpfs,
  loadCachedMslZipFromOpfs,
  loadStandardMslZipFromOpfs,
  loadLibraryArchivesFromOpfs,
  onImportMslZip,
  clearModelicaLibraries,
} = useModelicaLibraries({
  worker: modelicaWorker,
  cacheVersionMarker: rumocaLibraryCacheVersionMarker,
})

const libraryBusyLabel = computed(() => {
  if (mslDownloading.value) return 'Downloading library archive'
  if (activeLibraryLoads.value.length > 0) {
    const first = activeLibraryLoads.value[0] || 'Loading libraries'
    return activeLibraryLoads.value.length > 1
      ? `${first} (+${activeLibraryLoads.value.length - 1})`
      : first
  }
  if (mslLoading.value) return 'Loading libraries'
  return ''
})

const globalProcessBusy = computed(() => workerBusy.value || Boolean(libraryBusyLabel.value))
const globalProcessLabel = computed(
  () => libraryBusyLabel.value || workerBusyLabel.value || 'Processing',
)
const lastAppliedLazyLibraryTreeSignature = ref('')

function applyLazyLibraryTreeToEditor(): boolean {
  if (latestLazyLibraryClassTree.value.length === 0) return false
  const treeSignature = latestLazyLibraryClassTree.value
    .map((node) => String(node.qualified_name || node.name || ''))
    .join('|')
  if (
    treeSignature &&
    treeSignature === lastAppliedLazyLibraryTreeSignature.value &&
    libraryTreeNodes.value.length > 0
  ) {
    return true
  }
  const mappedNodes = mapRumocaClassTree(latestLazyLibraryClassTree.value)
  lastAppliedLazyLibraryTreeSignature.value = treeSignature
  libraryTreeNodes.value = mappedNodes
  standardMslLoaded.value = mappedNodes.some((node) => node.qualifiedName === 'Modelica')
  appendModelicaLog({
    level: 'success',
    phase: 'general',
    message: `Loaded Modelica library tree from lazy index: ${mappedNodes.length} root nodes`,
    details: {
      lazyRootNodeCount: latestLazyLibraryClassTree.value.length,
      rootNodeCount: mappedNodes.length,
      standardMslLoaded: standardMslLoaded.value,
    },
  })
  return true
}

watch(
  latestLazyLibraryClassTree,
  () => {
    applyLazyLibraryTreeToEditor()
  },
  { flush: 'sync' },
)

const fileNameFromPath = (path: string): string => {
  const normalized = String(path || '')
    .trim()
    .replaceAll('\\', '/')
  if (!normalized) return ''
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || normalized
}

const libraryRootMetadata = computed<Record<string, string>>(() => {
  const byRoot: Record<string, string> = {}
  const roots = libraryTreeNodes.value.filter((node) => !node.qualifiedName.includes('.'))
  const archiveNames = loadedLibraryCachePaths.value.map((path) => fileNameFromPath(path))
  roots.forEach((rootNode) => {
    const root = rootNode.qualifiedName
    const rootLower = root.toLowerCase()
    const modelCount = countNodeClassType(rootNode, 'model')
    const blockCount = countNodeClassType(rootNode, 'block')
    const totalCount = countNodeClasses(rootNode)
    const countPart = `${totalCount} classes${modelCount > 0 ? `, ${modelCount} models` : ''}${blockCount > 0 ? `, ${blockCount} blocks` : ''}`
    if (root === 'Modelica' && mslLoaded.value) {
      const archive = String(mslArchiveName.value || 'MSL')
      byRoot[root] = `${archive} · ${mslFileCount.value} files · ${countPart}`
      return
    }
    const matchedArchive =
      archiveNames.find((name) => name.toLowerCase().includes(rootLower)) || 'loaded archive'
    byRoot[root] = `${matchedArchive} · ${countPart}`
  })
  return byRoot
})

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
const requiredLibraries = ref<string[]>([])
const hasHydratedSimulationSettings = ref(false)
const applyingSimHints = ref(false)
const running = ref(false)
const abortController = ref<AbortController | null>(null)
const simulationRunToken = ref(0)

const hasSimulationResult = computed(
  () => !!executionResult.value && Object.keys(executionResult.value).length > 0,
)
const diagramTargetQualifiedName = computed<string | null>(() => {
  if (openedLibraryClassContext.value?.qualifiedName) {
    return openedLibraryClassContext.value.qualifiedName
  }
  return inferQualifiedModelNameFromSource(modelicaSource.value)
})
const activeDiagramQualifiedName = computed<string | null>(
  () => diagramNavigationEntry.value?.qualifiedName ?? diagramTargetQualifiedName.value,
)
const activeDiagramSource = computed(
  () => diagramNavigationEntry.value?.source ?? modelicaSource.value,
)
const diagramNavigationDepth = computed(() => diagramNavigationStack.value.length)
const canNavigateDiagramBack = computed(() => diagramNavigationStack.value.length > 0)

function currentDiagramNavigationEntry(): DiagramNavigationEntry {
  return {
    qualifiedName: activeDiagramQualifiedName.value,
    source: activeDiagramSource.value,
  }
}

function resetDiagramNavigation(): void {
  diagramNavigationEntry.value = null
  diagramNavigationStack.value = []
}

const compactModelTabTitle = (qualifiedName: string | null, maxTailChars = 14): string => {
  const full = String(qualifiedName || '').trim()
  if (!full) return '(none)'
  if (full.length <= maxTailChars) return full
  return `...${full.slice(-maxTailChars)}`
}

const workspaceModelTitle = computed(() => {
  return compactModelTabTitle(diagramTargetQualifiedName.value, 14)
})
const dockTabTitles = computed<Record<string, string>>(() => ({
  workspace: workspaceModelTitle.value,
}))
const dockTabTitleTooltips = computed<Record<string, string>>(() => ({
  workspace: String(diagramTargetQualifiedName.value || '(none)'),
}))
const modelHelpQualifiedName = ref('')
const modelHelpRestriction = ref('')
const modelHelpClassType = ref('')
const modelHelpHtml = ref('')
const modelHelpRaw = ref('')
const modelHelpError = ref('')
let modelHelpRequestId = 0

const asDocString = (value: unknown): string => (typeof value === 'string' ? value : '')
const sanitizeModelHelpHtml = sanitizeHtmlMarkup

const pickFirstNonEmptyDocString = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = asDocString(record[key]).trim()
    if (value.length > 0) return value
  }
  return ''
}

async function refreshModelHelp(qualifiedName: string | null) {
  const worker = modelicaWorker.value
  const normalized = String(qualifiedName || '').trim()
  modelHelpQualifiedName.value = normalized
  modelHelpError.value = ''
  if (!worker || !normalized) {
    modelHelpRestriction.value = ''
    modelHelpClassType.value = ''
    modelHelpHtml.value = ''
    modelHelpRaw.value = ''
    return
  }

  const requestId = ++modelHelpRequestId
  try {
    const info = await worker.getClassInfo(normalized)
    if (requestId !== modelHelpRequestId) return
    modelHelpQualifiedName.value = asDocString(info.qualified_name).trim() || normalized
    modelHelpRestriction.value = asDocString(info.restriction).trim()
    modelHelpClassType.value = asDocString(info.class_type).trim()
    modelHelpHtml.value = pickFirstNonEmptyDocString(info, [
      'documentation_html',
      'documentationHtml',
      'info_html',
      'infoHtml',
    ])
    modelHelpRaw.value = pickFirstNonEmptyDocString(info, [
      'documentation',
      'info',
      'description',
      'comment',
    ])
  } catch (error) {
    if (requestId !== modelHelpRequestId) return
    modelHelpError.value = `Failed to load model info: ${(error as Error).message}`
    modelHelpHtml.value = ''
    modelHelpRaw.value = ''
    modelHelpRestriction.value = ''
    modelHelpClassType.value = ''
  }
}
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

const countObjectKeys = (value: unknown): number =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).length
    : 0

const countArray = (value: unknown): number => (Array.isArray(value) ? value.length : 0)

const daeAnalysis = computed<ModelicaDaeAnalysis>(() => {
  const dae =
    daeJsonOutput.value && typeof daeJsonOutput.value === 'object' ? daeJsonOutput.value : {}
  const resultMeta =
    executionResult.value.meta && typeof executionResult.value.meta === 'object'
      ? (executionResult.value.meta as Record<string, unknown>)
      : {}
  const modelShape =
    resultMeta.modelShape && typeof resultMeta.modelShape === 'object'
      ? (resultMeta.modelShape as Record<string, unknown>)
      : {}
  const nx = countObjectKeys(dae.x) || Number(modelShape.nx ?? 0)
  const yCount = countObjectKeys(dae.y)
  const ny = yCount || Number(modelShape.ny ?? 0)
  const nu = Number(modelShape.nu ?? countObjectKeys(dae.u))
  const nc = Number(modelShape.nc ?? countArray(dae.f_c) + countArray(dae.relation))
  const neqs = Number(modelShape.residualEquationCount ?? countArray(dae.f_x ?? dae.fx))
  const zCount = countObjectKeys(dae.z)
  const mCount = countObjectKeys(dae.m)
  const wCount = countObjectKeys(dae.w)
  const constraintBalanceMeta =
    modelShape.constraintBalance && typeof modelShape.constraintBalance === 'object'
      ? (modelShape.constraintBalance as Record<string, unknown>)
      : null
  const solverNy = yCount + wCount
  const unknownCountDynamic = Number(constraintBalanceMeta?.unknownCountDynamic ?? nx + solverNy)
  const equationCountDynamicRaw = constraintBalanceMeta?.equationCountDynamic
  const equationCountDynamic =
    typeof equationCountDynamicRaw === 'number' && Number.isFinite(equationCountDynamicRaw)
      ? equationCountDynamicRaw
      : Number.isFinite(neqs)
        ? neqs
        : null
  const equationMinusUnknown =
    equationCountDynamic === null ? null : equationCountDynamic - unknownCountDynamic
  const constraintNote =
    equationMinusUnknown === null
      ? 'Residual equation count unavailable.'
      : equationMinusUnknown === 0
        ? 'Square solve slice.'
        : equationMinusUnknown > 0
          ? 'Overdetermined solve slice.'
          : 'Underdetermined solve slice (likely partitioning issue).'
  const hasDummyState = Boolean(
    modelShape.hasOnlyDummyState ||
      (nx === 1 &&
        Object.prototype.hasOwnProperty.call((dae.x ?? {}) as object, '_rumoca_dummy_state')),
  )
  const executionMode =
    typeof resultMeta.executionMode === 'string'
      ? resultMeta.executionMode
      : nx > 0 && !hasDummyState
        ? 'dynamic_dae'
        : ny > 0 || nc > 0 || neqs > 0
          ? 'algebraic_discrete'
          : 'static_model'
  const strategy =
    executionMode === 'dynamic_dae'
      ? 'Integrate continuous states and close residual equations with the selected time integrator.'
      : executionMode === 'algebraic_discrete'
        ? 'Step time directly, evaluate algebraic/event equations, and iterate resets until stable.'
        : 'Emit a constant trajectory for parameters/constants because no equations need solving.'
  const hints = []
  if (executionMode === 'dynamic_dae')
    hints.push('Continuous states are present; initialization and step solves may be required.')
  if (executionMode === 'algebraic_discrete')
    hints.push(
      'No meaningful continuous dynamics detected; Newton flow solves should stay at zero.',
    )
  if (executionMode === 'static_model')
    hints.push('The model is static; this is runnable as a constant time series.')
  if (neqs > 0 && ny === 0 && executionMode !== 'dynamic_dae')
    hints.push(
      'Residual equations exist without algebraic unknowns; check generated prepared DAE shape.',
    )
  if (equationMinusUnknown !== null && equationMinusUnknown < 0)
    hints.push(
      'Equation/unknown imbalance detected in runtime solve slice; inspect DAE partitioning of discrete/event-memory variables.',
    )
  return {
    executionMode,
    strategy,
    counts: [
      { label: 'States', value: nx },
      { label: 'Algebraics', value: ny },
      { label: 'Inputs', value: nu },
      { label: 'Conditions', value: nc },
      { label: 'Residual equations', value: neqs },
      { label: 'When clauses', value: countArray(dae.when_clauses) },
      { label: 'Reset equations', value: countArray(dae.f_z) + countArray(dae.f_m) },
      { label: 'Observables', value: countArray(dae.__rumoca_observables) },
    ],
    constraintBalance: {
      unknownCountDynamic,
      equationCountDynamic,
      equationMinusUnknown,
      note: constraintNote,
      partitionCounts: {
        x: nx,
        y: yCount,
        z: zCount,
        m: mCount,
        w: wCount,
      },
    },
    hints,
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
  simulationBackend?: SimulationBackend
  rumocaSolver?: string
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
    'simulationBackend' in sim ||
    'rumocaSolver' in sim ||
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

function normalizeSimulationBackend(value: unknown): SimulationBackend {
  return value === 'rumoca' ? 'rumoca' : 'js'
}

function normalizeRumocaSolver(value: unknown): string {
  const solver =
    typeof value === 'string'
      ? value.trim().toLowerCase()
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value).trim().toLowerCase()
        : ''
  return solver || 'auto'
}

function onSimulationBackendUpdate(value: unknown) {
  selectedSimulationBackend.value = normalizeSimulationBackend(value)
}

function onRumocaSolverUpdate(value: unknown) {
  selectedRumocaSolver.value = normalizeRumocaSolver(value)
}

function resolveActiveSimulationTarget(): { source: string; modelName: string } {
  const localModelName =
    modelicaSource.value.match(/(?:model|class|block|connector|record)\s+(\w+)/)?.[1] ?? 'Model'
  const qualifiedFromSource = inferQualifiedModelNameFromSource(modelicaSource.value)
  const useSourceRoots = useModelicaStandardLibrary.value && mslLoaded.value
  const unchangedLibraryClass =
    openedLibraryClassContext.value != null &&
    openedLibraryClassContext.value.sourceSnapshot === modelicaSource.value
  const isModelicaStdlibClass =
    typeof qualifiedFromSource === 'string' && qualifiedFromSource.startsWith('Modelica.')
  const useSourceRootsOnly = useSourceRoots && (unchangedLibraryClass || isModelicaStdlibClass)

  return {
    source: useSourceRootsOnly ? '' : modelicaSource.value,
    modelName:
      (useSourceRootsOnly
        ? openedLibraryClassContext.value?.qualifiedName || qualifiedFromSource || localModelName
        : qualifiedFromSource || localModelName) || 'Model',
  }
}

function normalizeRumocaSimulationResult(raw: Record<string, unknown>): Record<string, unknown> {
  const payloadSource =
    raw.payload && typeof raw.payload === 'object' ? (raw.payload as Record<string, unknown>) : raw
  const names = Array.isArray(payloadSource.names)
    ? payloadSource.names.filter((entry): entry is string => typeof entry === 'string')
    : []
  const allData = Array.isArray(payloadSource.allData)
    ? payloadSource.allData.map((column) =>
        Array.isArray(column)
          ? column.map((value) =>
              typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN,
            )
          : [],
      )
    : []
  if (names.length === 0 || allData.length === 0) {
    throw new Error('Rumoca simulation returned no time-series payload')
  }

  const nStatesRaw = Number(payloadSource.nStates)
  const nStates = Number.isFinite(nStatesRaw) ? Math.max(0, Math.min(names.length, nStatesRaw)) : 0
  const times = allData[0] ?? []
  const stateNames = names.slice(0, nStates)
  const algebraicNames = names.slice(nStates)
  const stateSeries = stateNames.reduce<Record<string, number[]>>((acc, name, index) => {
    acc[name] = allData[index + 1] ?? []
    return acc
  }, {})
  const algebraicSeries = algebraicNames.reduce<Record<string, number[]>>((acc, name, index) => {
    acc[name] = allData[nStates + index + 1] ?? []
    return acc
  }, {})

  return {
    meta: {
      nSteps: times.length,
      executionMode: nStates > 0 ? 'dynamic_dae' : 'algebraic_discrete',
      model: {
        modelName:
          typeof raw.model === 'string'
            ? raw.model
            : typeof raw.modelName === 'string'
              ? raw.modelName
              : 'Model',
        stateNames,
        algebraicNames,
        inputNames: [],
        conditionNames: [],
        stateVariables: stateNames.map((name) => ({ name })),
        algebraicVariables: algebraicNames.map((name) => ({ name })),
        inputVariables: [],
        conditionVariables: [],
      },
      rumoca: raw,
      requestedSolver: normalizeRumocaSolver(raw.solver),
    },
    data: {
      t: times,
      x: stateSeries,
      y: algebraicSeries,
      u: {},
      z: {},
      c: {},
    },
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
  data.p = normalizeSeriesMap(data.p, [])
  data.constants = normalizeSeriesMap(data.constants, [])

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
let unsubscribeWorkerActivity: (() => void) | null = null

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

const phaseForWorkerRequestType = (type: string): WorkerLiveLogEntry['phase'] => {
  if (type === 'compile_render') return 'compile'
  if (type === 'init') return 'loadWasm'
  return 'general'
}

const shouldLogWorkerCompletion = (event: ModelicaWorkerActivityEvent): boolean => {
  if (event.status === 'failed') return true
  if ((event.elapsedMs ?? 0) >= 1000) return true
  return [
    'extract_diagram',
    'materialize_diagram_classes',
    'load_msl_zip',
    'merge_msl_zip',
    'restore_source_root_binary_cache',
    'list_classes',
  ].includes(event.requestType)
}

function onWorkerActivity(event: ModelicaWorkerActivityEvent) {
  if (event.requestType === 'lsp_completion_with_timing') return
  if (event.status === 'started') {
    const startedAt = new Date().toISOString()
    workerActivityById.value.set(event.requestId, {
      label: event.label,
      type: event.requestType,
      startedAt,
    })
    workerLiveEntries.value = workerLiveEntries.value
      .filter((entry) => entry.requestId !== event.requestId)
      .concat({
        requestId: event.requestId,
        timestamp: startedAt,
        phase: phaseForWorkerRequestType(event.requestType),
        level: 'info',
        message: `${event.label}...`,
        pending: true,
      })
    return
  }

  workerActivityById.value.delete(event.requestId)
  workerLiveEntries.value = workerLiveEntries.value.filter(
    (entry) => entry.requestId !== event.requestId,
  )
  if (shouldLogWorkerCompletion(event)) {
    appendModelicaLog({
      level: event.status === 'failed' ? 'error' : 'info',
      phase: phaseForWorkerRequestType(event.requestType),
      message:
        event.status === 'failed'
          ? `${event.label} failed after ${event.elapsedMs ?? 0} ms: ${event.error ?? 'unknown error'}`
          : `${event.label} finished in ${event.elapsedMs ?? 0} ms`,
      details: {
        requestId: event.requestId,
        requestType: event.requestType,
        elapsedMs: event.elapsedMs,
      },
    })
  }
}

onMounted(() => {
  window.addEventListener('message', handleSandboxLogMessage)
})

onBeforeUnmount(() => {
  window.removeEventListener('message', handleSandboxLogMessage)
  unsubscribeWorkerActivity?.()
  unsubscribeWorkerActivity = null
  modelicaWorker.value?.terminate()
  modelicaWorker.value = null
})

const configuration = computed<partialTyConfiguration | null>(() => {
  const taskyonKey = props.taskyonSignatureOrKey
  if (taskyonKey == null) return null
  const customAppConfiguration = props.taskyonConfiguration?.appConfiguration ?? {}
  const customToolchainConfig = props.taskyonConfiguration?.toolchainConfig ?? {}
  return {
    toolchainConfig: {
      ...customToolchainConfig,
      taskyonFlow: {
        ...(customToolchainConfig.taskyonFlow ?? {}),
        enableToolChooser: true,
        entryNode: toolCall({ name: 'modelicaDocumentAssistant', arguments: {} }),
      },
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
    requiredLibraries: requiredLibraries.value,
    uiTemplates: uiTemplates.value,
    activeUiTemplateId: parseSourceKey(selectedUiTemplateKey.value).id,
    projectSolvers: projectSolvers.value,
    sim: {
      t0: simT0.value,
      tf: simTf.value,
      dt: simDt.value,
      simulationBackend: selectedSimulationBackend.value,
      rumocaSolver: selectedRumocaSolver.value,
      solverKey: selectedSolverKey.value,
      solverOptions: solverOptions.value,
      solverOptionsByKey: solverOptionsByKey.value,
      charts: plotCharts.value,
      plotViewOptions: plotViewOptions.value,
      result: executionResult.value,
    },
    ui: {
      libraryTree: {
        showRootMetadata: libraryTreeShowRootMetadata.value,
      },
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
  openedLibraryClassContext.value = null
  resetDiagramNavigation()
  requiredLibraries.value = Array.isArray(state.requiredLibraries) ? state.requiredLibraries : []
  const requiredPreset = requiredLibraries.value.find((entry) => entry.startsWith('preset:'))
  const requiredZip = requiredLibraries.value.find((entry) => entry.startsWith('zip:'))
  const requiredOpfsPaths = normalizeRequiredLibraries(
    requiredLibraries.value
      .filter((entry) => entry.startsWith('opfs:'))
      .map((entry) => entry.slice('opfs:'.length)),
  )
  loadedLibraryCachePaths.value = requiredOpfsPaths
  const hasRequiredLibrarySettings = Boolean(
    requiredPreset || requiredZip || requiredOpfsPaths.length > 0,
  )
  if (requiredPreset) {
    const presetId = requiredPreset.slice('preset:'.length).trim()
    if (presetId) selectedLibraryPreset.value = presetId
  }
  if (requiredZip) {
    const zipUrl = requiredZip.slice('zip:'.length).trim()
    if (zipUrl) mslDownloadUrl.value = zipUrl
  }
  useModelicaStandardLibrary.value = hasRequiredLibrarySettings
  uiTemplates.value = state.uiTemplates
  selectedUiTemplateKey.value = resolveUiTemplateKey(state.selectedUiTemplateId)
  if (state.projectSolvers) projectSolvers.value = state.projectSolvers
  if (typeof state.sim.t0 === 'number') simT0.value = state.sim.t0
  if (typeof state.sim.tf === 'number') simTf.value = state.sim.tf
  if (typeof state.sim.dt === 'number') simDt.value = state.sim.dt
  selectedSimulationBackend.value = normalizeSimulationBackend(state.sim.simulationBackend)
  selectedRumocaSolver.value = normalizeRumocaSolver(state.sim.rumocaSolver)
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
  if (typeof state.ui?.libraryTree?.showRootMetadata === 'boolean') {
    libraryTreeShowRootMetadata.value = state.ui.libraryTree.showRootMetadata
  }
  if (!hasHydratedSimulationSettings.value) {
    applySimulationHintsFromModelica(state.modelicaSource, { force: true })
  }
  if (state.documentVersions) documentVersions.value = state.documentVersions
  if (typeof state.currentVersionIndex === 'number') {
    currentVersionIndex.value = state.currentVersionIndex
  }
}

const normalizeRequiredLibraries = (entries: string[]): string[] => {
  const normalized = entries.map((entry) => String(entry || '').trim()).filter(Boolean)
  return Array.from(new Set(normalized))
}

const deriveManagedRequiredLibraries = (): string[] => {
  const managed: string[] = []
  if (useModelicaStandardLibrary.value) {
    const preset = String(selectedLibraryPreset.value || '').trim()
    if (preset) managed.push(`preset:${preset}`)
    const zipUrl = String(mslDownloadUrl.value || '').trim()
    if (zipUrl) managed.push(`zip:${zipUrl}`)
  }
  const archiveName = String(mslArchiveName.value || '').trim()
  if (archiveName) managed.push(`archive:${archiveName}`)
  for (const path of loadedLibraryCachePaths.value) {
    const normalizedPath = String(path || '').trim()
    if (normalizedPath) managed.push(`opfs:${normalizedPath}`)
  }
  return normalizeRequiredLibraries(managed)
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
const canCompileModel = computed(
  () => wasmLoaded.value && String(modelicaSource.value || '').trim().length > 0,
)
const canRunModel = computed(() => {
  if (selectedSimulationBackend.value === 'rumoca') {
    return (
      wasmLoaded.value &&
      rumocaSimulationAvailable.value &&
      String(modelicaSource.value || '').trim().length > 0
    )
  }
  return wasmLoaded.value && String(modelicaSource.value || '').trim().length > 0
})

const hasUiTemplate = computed(() => {
  const src = activeUiTemplateSource.value
  return typeof src === 'string' && src.trim().length > 0
})

const projectMenuOptions = ref<Record<string, unknown>>({
  verboseLogging: false,
  aiSeesAll: true,
  usePreparedDae: true,
})
const libraryPresetUrlById = computed(() =>
  detectedModelicaLibraryPresets.value.reduce<Record<string, string>>((acc, preset) => {
    acc[preset.id] = preset.url
    return acc
  }, {}),
)
const selectedLibraryPreset = ref<string>(DEFAULT_MODELICA_LIBRARY_ID)
const libraryMenuOptions = ref<Record<string, unknown>>({
  useMSL: false,
  mslLibraryPreset: selectedLibraryPreset.value,
  mslZipUrl: DEFAULT_MSL_ZIP_URL,
})
const runtimeMenuOptions = ref<Record<string, unknown>>({
  t0: simT0.value,
  tf: simTf.value,
  dt: simDt.value,
  simulationBackend: selectedSimulationBackend.value,
  rumocaSolver: selectedRumocaSolver.value,
  rumocaSimulationAvailable: rumocaSimulationAvailable.value,
  rumocaSimulationModelDiscoveryAvailable: rumocaSimulationModelDiscoveryAvailable.value,
  rumocaWasmVersion: rumocaWasmVersion.value,
  rumocaWasmGitCommit: rumocaWasmGitCommit.value,
  rumocaWasmBuildTimeLocal: rumocaWasmBuildTimeLocal.value,
  rumocaWasmRustBuildTimeLocal: rumocaWasmRustBuildTimeLocal.value,
  rumocaWasmPackageBuiltTimeLocal: rumocaWasmPackageBuiltTimeLocal.value,
})

const projectMenuSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    verboseLogging: { type: 'boolean', title: 'Verbose logging' },
    aiSeesAll: { type: 'boolean', title: 'AI sees all editors' },
    usePreparedDae: { type: 'boolean', title: 'Use prepared DAE for template rendering' },
  },
}

const libraryMenuSchema = computed<JSONSchema7>(() => ({
  type: 'object',
  properties: {
    useMSL: { type: 'boolean', title: 'Use Modelica Standard Library for compile' },
    mslLibraryPreset: {
      type: 'string',
      title: 'Library preset',
      oneOf: detectedModelicaLibraryPresets.value.map((preset) => ({
        const: preset.id,
        title: preset.label,
      })),
    },
    mslZipUrl: { type: 'string', title: 'MSL ZIP URL' },
  },
}))

const runtimeMenuSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    t0: { type: 'number', title: 'Simulation t0' },
    tf: { type: 'number', title: 'Simulation tf' },
    dt: { type: 'number', title: 'Simulation dt (must be > 0)' },
    simulationBackend: {
      type: 'string',
      title: 'Simulation runtime',
      oneOf: [
        { const: 'js', title: 'JS template runtime' },
        { const: 'rumoca', title: 'Rumoca runtime' },
      ],
    },
    rumocaSolver: { type: 'string', title: 'Rumoca solver' },
    rumocaSimulationAvailable: {
      type: 'boolean',
      title: 'Rumoca simulation export available',
      readOnly: true,
    },
    rumocaSimulationModelDiscoveryAvailable: {
      type: 'boolean',
      title: 'Rumoca simulation model discovery available',
      readOnly: true,
    },
    rumocaWasmVersion: { type: 'string', title: 'Rumoca WASM version', readOnly: true },
    rumocaWasmGitCommit: { type: 'string', title: 'Rumoca WASM git commit', readOnly: true },
    rumocaWasmBuildTimeLocal: {
      type: 'string',
      title: 'Rumoca WASM build time (local)',
      readOnly: true,
    },
    rumocaWasmRustBuildTimeLocal: {
      type: 'string',
      title: 'Rumoca WASM Rust compile time (local)',
      readOnly: true,
    },
    rumocaWasmPackageBuiltTimeLocal: {
      type: 'string',
      title: 'Rumoca WASM package build time (local)',
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
  [useModelicaStandardLibrary, mslDownloadUrl, selectedLibraryPreset],
  () => {
    libraryMenuOptions.value = {
      useMSL: Boolean(useModelicaStandardLibrary.value),
      mslLibraryPreset: selectedLibraryPreset.value,
      mslZipUrl: String(mslDownloadUrl.value || DEFAULT_MSL_ZIP_URL),
    }
  },
  { immediate: true },
)

watch(
  libraryMenuOptions,
  (v) => {
    if (typeof v.useMSL === 'boolean') useModelicaStandardLibrary.value = v.useMSL
    if (typeof v.mslLibraryPreset === 'string' && v.mslLibraryPreset.trim()) {
      const preset = v.mslLibraryPreset.trim()
      selectedLibraryPreset.value = preset
      const presetUrl = libraryPresetUrlById.value[preset]
      if (typeof presetUrl === 'string' && presetUrl.trim()) {
        mslDownloadUrl.value = presetUrl
      }
    }
    if (typeof v.mslZipUrl === 'string' && v.mslZipUrl.trim()) {
      mslDownloadUrl.value = v.mslZipUrl.trim()
    }
  },
  { deep: true },
)

watch(
  [
    useModelicaStandardLibrary,
    selectedLibraryPreset,
    mslDownloadUrl,
    mslArchiveName,
    loadedLibraryCachePaths,
  ],
  () => {
    const unmanaged = requiredLibraries.value.filter(
      (entry) =>
        !entry.startsWith('preset:') &&
        !entry.startsWith('zip:') &&
        !entry.startsWith('archive:') &&
        !entry.startsWith('opfs:'),
    )
    requiredLibraries.value = normalizeRequiredLibraries([
      ...unmanaged,
      ...deriveManagedRequiredLibraries(),
    ])
  },
  { immediate: true },
)

watch(
  [
    simT0,
    simTf,
    simDt,
    selectedSimulationBackend,
    selectedRumocaSolver,
    rumocaSimulationAvailable,
    rumocaSimulationModelDiscoveryAvailable,
    rumocaWasmVersion,
    rumocaWasmGitCommit,
    rumocaWasmBuildTimeLocal,
    rumocaWasmRustBuildTimeLocal,
    rumocaWasmPackageBuiltTimeLocal,
  ],
  () => {
    runtimeMenuOptions.value = {
      t0: Number(simT0.value),
      tf: Number(simTf.value),
      dt: Number(simDt.value),
      simulationBackend: selectedSimulationBackend.value,
      rumocaSolver: selectedRumocaSolver.value,
      rumocaSimulationAvailable: rumocaSimulationAvailable.value,
      rumocaSimulationModelDiscoveryAvailable: rumocaSimulationModelDiscoveryAvailable.value,
      rumocaWasmVersion: rumocaWasmVersion.value,
      rumocaWasmGitCommit: rumocaWasmGitCommit.value,
      rumocaWasmBuildTimeLocal: rumocaWasmBuildTimeLocal.value,
      rumocaWasmRustBuildTimeLocal: rumocaWasmRustBuildTimeLocal.value,
      rumocaWasmPackageBuiltTimeLocal: rumocaWasmPackageBuiltTimeLocal.value,
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
    selectedSimulationBackend.value = normalizeSimulationBackend(v.simulationBackend)
    selectedRumocaSolver.value = normalizeRumocaSolver(v.rumocaSolver)
  },
  { deep: true },
)

watch([simT0, simTf, simDt], () => {
  if (isHydratingState.value || applyingSimHints.value) return
  hasHydratedSimulationSettings.value = true
  allowApplySolverSimDefaults.value = false
})

type ModelicaCompileRequest = {
  modelicaSource: string
  modelName: string
  useSourceRoots: boolean
}

type AnalysisArtifactSource = 'compile' | 'render' | 'parse'

function buildModelicaCompileRequest(sourceText: string): ModelicaCompileRequest {
  const localModelName =
    String(sourceText || '').match(/(?:model|class|block|connector|record)\s+(\w+)/)?.[1] ?? 'Model'
  const qualifiedFromSource = inferQualifiedModelNameFromSource(sourceText)
  const useSourceRoots = useModelicaStandardLibrary.value && mslLoaded.value
  const unchangedLibraryClass =
    openedLibraryClassContext.value != null &&
    openedLibraryClassContext.value.sourceSnapshot === sourceText
  const isModelicaStdlibClass =
    typeof qualifiedFromSource === 'string' && qualifiedFromSource.startsWith('Modelica.')
  const compileFromSourceRootsOnly =
    useSourceRoots && (unchangedLibraryClass || isModelicaStdlibClass)

  return {
    modelicaSource: compileFromSourceRootsOnly ? '' : sourceText,
    modelName: compileFromSourceRootsOnly
      ? openedLibraryClassContext.value?.qualifiedName || qualifiedFromSource || localModelName
      : qualifiedFromSource || localModelName,
    useSourceRoots,
  }
}

function currentCompilationSignature(): string {
  return JSON.stringify({
    ...buildModelicaCompileRequest(String(modelicaSource.value || '')),
    templateSource: String(templateSource.value || ''),
    usePreparedDae: Boolean(usePreparedDae.value),
  })
}

function currentAnalysisSignature(): string {
  return JSON.stringify({
    ...buildModelicaCompileRequest(String(modelicaSource.value || '')),
    templateSource: String(templateSource.value || ''),
    usePreparedDae: Boolean(usePreparedDae.value),
  })
}

async function ensureStandardMslLoadedForSource(sourceText: string): Promise<void> {
  const shouldAutoLoadStandardMsl =
    /\bModelica\./.test(sourceText) && Boolean(modelicaWorker.value) && !standardMslLoaded.value
  if (!shouldAutoLoadStandardMsl) return
  useModelicaStandardLibrary.value = true
  await loadStandardMslZipFromOpfs('auto-detect: source references Modelica.*')
  await refreshLibraryTree()
}

async function ensureCompilationUpToDate(reason: string): Promise<void> {
  const signature = currentCompilationSignature()
  if (
    signature === lastSuccessfulCompilationSignature.value &&
    statusType.value === 'success' &&
    String(modelicaSource.value || '').trim()
  ) {
    return
  }

  appendModelicaLog({
    level: 'info',
    phase: 'compile',
    message: `Updating generated outputs (${reason}).`,
  })
  const result = await runCompilation()
  if (!result.ok) {
    throw new Error(result.message || `Failed to update generated outputs (${reason}).`)
  }
}

const analysisRenderViewIdByKey: Record<
  Extract<ModelicaAnalysisArtifactKey, 'baseModelica' | 'flatModelica' | 'daeModelica'>,
  RenderModelicaViewId
> = {
  baseModelica: 'base-modelica',
  flatModelica: 'flat-modelica',
  daeModelica: 'dae-modelica',
}

function setAnalysisArtifactLoading(key: ModelicaAnalysisArtifactKey, value: boolean): void {
  analysisArtifactLoading.value = {
    ...analysisArtifactLoading.value,
    [key]: value,
  }
}

function setAnalysisArtifactError(key: ModelicaAnalysisArtifactKey, value?: string): void {
  analysisArtifactErrors.value = {
    ...analysisArtifactErrors.value,
    [key]: value,
  }
}

function setAnalysisArtifactContent(key: ModelicaAnalysisArtifactKey, value: string): void {
  analysisArtifactContent.value = {
    ...analysisArtifactContent.value,
    [key]: value,
  }
}

function setAnalysisArtifactSignature(key: ModelicaAnalysisArtifactKey, value: string): void {
  analysisArtifactLoadedSignatures.value = {
    ...analysisArtifactLoadedSignatures.value,
    [key]: value,
  }
}

function getAnalysisArtifactSource(key: ModelicaAnalysisArtifactKey): AnalysisArtifactSource {
  if (key === 'ast') return 'parse'
  if (key === 'baseModelica' || key === 'flatModelica' || key === 'daeModelica') return 'render'
  return 'compile'
}

async function refreshAnalysisArtifact(key: ModelicaAnalysisArtifactKey): Promise<string> {
  const signature = currentAnalysisSignature()
  const sourceText = String(modelicaSource.value || '')
  if (!sourceText.trim()) {
    setAnalysisArtifactContent(key, '')
    setAnalysisArtifactError(key, 'No Modelica source loaded.')
    return ''
  }

  setAnalysisArtifactLoading(key, true)
  setAnalysisArtifactError(key, undefined)

  try {
    let nextContent = ''
    if (getAnalysisArtifactSource(key) === 'render') {
      await ensureStandardMslLoadedForSource(sourceText)
      const worker = modelicaWorker.value
      if (!worker) throw new Error('Modelica worker not loaded')
      const request = buildModelicaCompileRequest(sourceText)
      if (key !== 'baseModelica' && key !== 'flatModelica' && key !== 'daeModelica') {
        throw new Error(`Unsupported rendered analysis artifact: ${key}`)
      }
      const response = await worker.renderModelicaView({
        ...request,
        view: analysisRenderViewIdByKey[key],
      })
      nextContent = String(response.rendered || '')
    } else if (key === 'ast') {
      const worker = modelicaWorker.value
      if (!worker) throw new Error('Modelica worker not loaded')
      const qualifiedFromSource = inferQualifiedModelNameFromSource(sourceText)
      const astFileName = astFileNameFromQualifiedName(qualifiedFromSource)
      astOutput.value = await worker.parseSourceAst({
        source: sourceText,
        fileName: astFileName,
      })
      nextContent = JSON.stringify(astOutput.value ?? {}, null, 2)
    } else {
      await ensureCompilationUpToDate(`analysis ${analysisArtifactMetaByKey[key].label}`)
      if (key === 'baseDae') nextContent = String(daePrettyOutput.value || '')
      else nextContent = JSON.stringify(daeJsonOutput.value ?? {}, null, 2)
    }
    setAnalysisArtifactContent(key, nextContent)
    setAnalysisArtifactSignature(key, signature)
    return nextContent
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setAnalysisArtifactError(key, message)
    throw error
  } finally {
    setAnalysisArtifactLoading(key, false)
  }
}

async function refreshAndShowAnalysisArtifact(key: ModelicaAnalysisArtifactKey): Promise<void> {
  activeAnalysisArtifactKey.value = key
  try {
    await refreshAnalysisArtifact(key)
  } catch (error) {
    appendModelicaLog({
      level: 'error',
      phase: 'general',
      message: `Failed to load analysis artifact ${key}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      details: {
        artifact: key,
      },
    })
  } finally {
    analysisArtifactDialogOpen.value = true
  }
}

// ---------- Compile Modelica → JS & DAE via new API ----------
const runCompilation = async (): Promise<{ ok: boolean; message?: string }> => {
  const runToken = ++compileRunToken.value
  loading.value = true
  output.value = ''
  statusType.value = 'loading'
  try {
    const sourceText = String(modelicaSource.value || '')
    if (!sourceText.trim()) {
      loading.value = false
      statusType.value = ''
      output.value = ''
      jsSource.value = ''
      daeJsonOutput.value = {}
      daePrettyOutput.value = ''
      astOutput.value = {}
      return { ok: false, message: 'Skipped compilation: empty Modelica source' }
    }

    await ensureStandardMslLoadedForSource(sourceText)

    const worker = modelicaWorker.value
    if (!worker) throw new Error('Modelica worker not loaded')
    const request = buildModelicaCompileRequest(sourceText)

    let compile: Awaited<ReturnType<ModelicaWorkerClient['compileRender']>>
    try {
      compile = await worker.compileRender({
        modelicaSource: request.modelicaSource,
        templateSource: templateSource.value,
        modelName: request.modelName,
        usePreparedDae: usePreparedDae.value,
        useSourceRoots: request.useSourceRoots,
      })
    } catch (error) {
      const msg = (error as Error).message || ''
      const shouldRetryWithoutLocalSource =
        request.useSourceRoots &&
        /Duplicate class\s+'[^']+'\s+found in\s+'input\.mo'/i.test(msg) &&
        Boolean(inferQualifiedModelNameFromSource(sourceText))
      if (!shouldRetryWithoutLocalSource) throw error
      compile = await worker.compileRender({
        modelicaSource: '',
        templateSource: templateSource.value,
        modelName: inferQualifiedModelNameFromSource(sourceText) as string,
        usePreparedDae: usePreparedDae.value,
        useSourceRoots: request.useSourceRoots,
      })
    }
    if (runToken !== compileRunToken.value) {
      return { ok: false, message: 'Compilation cancelled (model switched)' }
    }
    daeJsonOutput.value = compile.daeForTemplate ?? {}
    daePrettyOutput.value = String(compile.daePretty || '')
    astOutput.value = astCandidateFromCompiled(compile.compiled)
    output.value = String(compile.rendered || '')
    jsSource.value = String(compile.rendered || '')
    statusType.value = 'success'
    lastSuccessfulCompilationSignature.value = currentCompilationSignature()
    return { ok: true, message: 'Compilation successful' }
  } catch (error) {
    if (runToken !== compileRunToken.value) {
      return { ok: false, message: 'Compilation cancelled (model switched)' }
    }
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
    if (runToken === compileRunToken.value) loading.value = false
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

watch(
  [modelicaSource, templateSource, usePreparedDae, useModelicaStandardLibrary, mslLoaded],
  () => {
    const sourceText = String(modelicaSource.value || '')
    if (!sourceText.trim()) {
      statusType.value = ''
      lastSuccessfulCompilationSignature.value = ''
      return
    }
    if (
      lastSuccessfulCompilationSignature.value &&
      currentCompilationSignature() !== lastSuccessfulCompilationSignature.value &&
      statusType.value === 'success'
    ) {
      statusType.value = ''
    }
  },
)

watch(
  [modelicaSource, templateSource, usePreparedDae, useModelicaStandardLibrary, mslLoaded],
  () => {
    analysisArtifactLoadedSignatures.value = {}
    analysisArtifactErrors.value = {}
    analysisArtifactContent.value = {}
    analysisArtifactLoading.value = {}
  },
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
  resetDiagramNavigation()
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
  statusType.value = ''
  lastSuccessfulCompilationSignature.value = ''
  analysisArtifactDialogOpen.value = false
  activeAnalysisArtifactKey.value = null
  analysisArtifactContent.value = {}
  analysisArtifactErrors.value = {}
  analysisArtifactLoading.value = {}
  analysisArtifactLoadedSignatures.value = {}
}

async function refreshLibraryTree() {
  if (applyLazyLibraryTreeToEditor()) return
  const worker = modelicaWorker.value
  if (!worker) {
    libraryTreeNodes.value = []
    standardMslLoaded.value = false
    return
  }
  const startedAt = performance.now()
  try {
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: 'Refreshing Modelica library tree',
      details: {
        existingRootNodeCount: libraryTreeNodes.value.length,
      },
    })
    const raw = await worker.listClasses()
    const listClassesMs = Math.round(performance.now() - startedAt)
    const mapStartedAt = performance.now()
    const mappedNodes = mapRumocaClassTree(raw.classes)
    const mapTreeMs = Math.round(performance.now() - mapStartedAt)
    const rawClassCount = Array.isArray(raw.classes) ? raw.classes.length : 0
    libraryTreeNodes.value = mappedNodes
    standardMslLoaded.value = mappedNodes.some((node) => node.qualifiedName === 'Modelica')
    appendModelicaLog({
      level: 'success',
      phase: 'general',
      message: `Refreshed Modelica library tree in ${Math.round(performance.now() - startedAt)} ms: ${mappedNodes.length} root nodes`,
      details: {
        listClassesMs,
        mapTreeMs,
        rawClassCount,
        rootNodeCount: mappedNodes.length,
        standardMslLoaded: standardMslLoaded.value,
      },
    })
  } catch (error) {
    standardMslLoaded.value = false
    appendModelicaLog({
      level: 'warning',
      phase: 'general',
      message: `Failed to refresh library tree after ${Math.round(performance.now() - startedAt)} ms: ${(error as Error).message}`,
    })
  }
}

async function resolveOpenableQualifiedName(typeName: string): Promise<string> {
  const worker = modelicaWorker.value
  if (!worker) throw new Error('Modelica worker is not available')
  const normalizedTypeName = String(typeName || '').trim()
  if (!normalizedTypeName) throw new Error('Model type is empty')
  const importAliases = extractImportAliases(modelicaSource.value)
  const currentQualifiedName = diagramTargetQualifiedName.value ?? undefined
  const candidates = buildTypeLookupCandidates(
    normalizedTypeName,
    currentQualifiedName,
    importAliases,
  )
  let lastError: Error | null = null
  for (const candidate of candidates) {
    try {
      const info = await worker.getClassInfo(candidate)
      const qualified = typeof info.qualified_name === 'string' ? info.qualified_name.trim() : ''
      return qualified || candidate
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }
  throw lastError ?? new Error(`Unable to resolve ${normalizedTypeName}`)
}

async function fetchLibraryClassSource(qualifiedName: string): Promise<{
  qualifiedName: string
  source: string
}> {
  const worker = modelicaWorker.value
  if (!worker) throw new Error('Modelica worker not loaded')
  const info = await worker.getClassInfo(qualifiedName)
  const qualified =
    typeof info.qualified_name === 'string' && info.qualified_name.trim().length > 0
      ? info.qualified_name.trim()
      : qualifiedName
  const sourceModelica = typeof info.source_modelica === 'string' ? info.source_modelica : ''
  if (!sourceModelica.trim()) {
    throw new Error(`No source available for ${qualifiedName}`)
  }
  return {
    qualifiedName: qualified,
    source: withLibraryContext(qualified, sourceModelica),
  }
}

async function openModelFromLibraryTree(
  qualifiedName: string,
  options: { workspaceTab?: 'modelica' | 'diagram' | 'icon' | 'help' } = {},
) {
  try {
    if (loading.value) {
      compileRunToken.value += 1
      appendModelicaLog({
        level: 'warning',
        phase: 'compile',
        message: 'Cancelling in-flight compilation because model selection changed.',
      })
    }

    const loaded = await fetchLibraryClassSource(qualifiedName)
    modelicaSource.value = loaded.source
    openedLibraryClassContext.value = {
      qualifiedName: loaded.qualifiedName,
      sourceSnapshot: loaded.source,
    }
    resetDiagramNavigation()
    await refreshModelHelp(loaded.qualifiedName)
    workspaceTab.value = options.workspaceTab ?? workspaceTab.value
    statusType.value = ''
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Loaded model from library tree: ${qualifiedName}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    appendModelicaLog({
      level: 'error',
      phase: 'general',
      message: `Failed to open model ${qualifiedName}: ${message}`,
      details: {
        qualifiedName,
      },
    })
    Notify.create({
      type: 'negative',
      message: `Failed to open model ${qualifiedName}: ${message}`,
    })
  }
}

async function openModelFromDiagram(typeName: string) {
  try {
    console.info('[modelica-diagram][dblclick] editor open request', { typeName })
    const qualifiedName = await resolveOpenableQualifiedName(typeName)
    console.info('[modelica-diagram][dblclick] editor resolved model', {
      typeName,
      qualifiedName,
    })
    const loaded = await fetchLibraryClassSource(qualifiedName)
    diagramNavigationStack.value = [
      ...diagramNavigationStack.value,
      currentDiagramNavigationEntry(),
    ]
    diagramNavigationEntry.value = {
      qualifiedName: loaded.qualifiedName,
      source: loaded.source,
    }
    await refreshModelHelp(loaded.qualifiedName)
    workspaceTab.value = 'diagram'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    appendModelicaLog({
      level: 'error',
      phase: 'general',
      message: `Failed to open diagram component ${typeName}: ${message}`,
    })
    Notify.create({
      type: 'negative',
      message: `Failed to open diagram component ${typeName}: ${message}`,
    })
  }
}

function navigateDiagramBack(): void {
  const stack = diagramNavigationStack.value
  const previous = stack[stack.length - 1]
  if (!previous) return
  diagramNavigationStack.value = stack.slice(0, -1)
  diagramNavigationEntry.value = previous.qualifiedName || previous.source.trim() ? previous : null
  void refreshModelHelp(activeDiagramQualifiedName.value)
}

async function openActiveDiagramModelInCode(): Promise<void> {
  const qualifiedName = activeDiagramQualifiedName.value
  if (!qualifiedName) return
  await openModelFromLibraryTree(qualifiedName, { workspaceTab: 'modelica' })
}

watchDebounced(
  () => diagramTargetQualifiedName.value,
  async (qualifiedName) => {
    await refreshModelHelp(qualifiedName)
  },
  { debounce: 250, maxWait: 800, immediate: true },
)

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
  await loadStandardMslZipFromOpfs('user action: load standard MSL')
  useModelicaStandardLibrary.value = true
  await refreshLibraryTree()
}

async function handleClearModelicaLibraries() {
  await clearModelicaLibraries()
  useModelicaStandardLibrary.value = false
  libraryTreeNodes.value = []
}

async function handleLoadLibraryPreset(url: string) {
  const nextUrl = String(url || '').trim()
  if (!nextUrl) return

  mslDownloadUrl.value = nextUrl
  useModelicaStandardLibrary.value = true
  libraryMenuOptions.value = {
    ...libraryMenuOptions.value,
    useMSL: true,
    mslZipUrl: nextUrl,
  }

  await downloadMslZipToOpfs(nextUrl)
  await loadCachedMslZipFromOpfs('user action: load selected library preset')
  await refreshLibraryTree()
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
  openedLibraryClassContext.value = null
  resetDiagramNavigation()
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

const copyJsToClipboard = () => {
  void copyToClipboard(jsSource.value)
}

const copyModelicaToClipboard = () => {
  void copyToClipboard(modelicaSource.value)
}

const copyTemplateToClipboard = () => {
  void copyToClipboard(templateSource.value)
}

const copyActiveAnalysisArtifact = () => {
  if (!activeAnalysisArtifactContent.value) return
  void copyToClipboard(activeAnalysisArtifactContent.value)
}

function downloadAnalysisArtifactContent(key: ModelicaAnalysisArtifactKey, content: string): void {
  const meta = analysisArtifactMetaByKey[key]
  const extension =
    key === 'baseDae'
      ? 'txt'
      : meta.language === 'json'
        ? 'json'
        : meta.language === 'javascript'
          ? 'js'
          : 'mo'
  const mime =
    meta.language === 'json'
      ? 'application/json;charset=utf-8'
      : meta.language === 'javascript'
        ? 'text/javascript;charset=utf-8'
        : 'text/plain;charset=utf-8'
  triggerDownload(meta.fileStem, content, extension, mime)
}

const downloadActiveAnalysisArtifact = () => {
  if (!activeAnalysisArtifactKey.value) return
  downloadAnalysisArtifactContent(
    activeAnalysisArtifactKey.value,
    activeAnalysisArtifactContent.value,
  )
}

async function downloadAnalysisArtifact(key: ModelicaAnalysisArtifactKey): Promise<void> {
  if (key !== 'daeJson' && key !== 'ast') return
  const content = await refreshAnalysisArtifact(key)
  if (!content) return
  downloadAnalysisArtifactContent(key, content)
}

const copyLogsToClipboard = () => {
  void copyToClipboard(safeYamlDump(modelicaLog.value))
}

async function openGeneratedHtmlPopup() {
  if (!hasUiTemplate.value) {
    Notify.create({ type: 'warning', message: 'No UI template available.' })
    return
  }

  try {
    await ensureCompilationUpToDate('popup HTML export')
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: error instanceof Error ? error.message : String(error),
    })
    return
  }

  if (!jsSource.value || isHtmlOutput.value) {
    Notify.create({
      type: 'warning',
      message: 'Selected template does not currently produce runnable model JS.',
    })
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

// ---------- Run in worker sandbox ----------
async function handleRunInSandbox() {
  if (!canRunModel.value) {
    Notify.create({
      type: 'warning',
      message: 'Run is disabled because no Modelica source is loaded.',
    })
    return
  }
  try {
    await ensureCompilationUpToDate(
      selectedSimulationBackend.value === 'rumoca' ? 'Rumoca simulation' : 'JS sandbox run',
    )
  } catch (error) {
    Notify.create({
      type: 'negative',
      message: error instanceof Error ? error.message : String(error),
      timeout: 7000,
    })
    return
  }
  if (selectedSimulationBackend.value === 'rumoca') {
    void runWithRumoca()
    return
  }
  if (isHtmlOutput.value) {
    Notify.create({
      type: 'warning',
      message: 'Selected template produced HTML, not runnable model JS.',
    })
    return
  }
  void runInSandbox(jsSource.value)
}

const runWithRumoca = async () => {
  executionResult.value = {}
  const runToken = ++simulationRunToken.value
  running.value = true

  try {
    const worker = modelicaWorker.value
    if (!worker) throw new Error('Modelica worker not loaded')
    if (!rumocaSimulationAvailable.value) {
      throw new Error('Installed Rumoca WASM package does not export simulate_model')
    }
    const target = resolveActiveSimulationTarget()
    const selectedModel = rumocaSimulationModelDiscoveryAvailable.value
      ? (
          await worker.getSimulationModels({
            source: target.source,
            defaultModel: target.modelName,
          })
        ).selectedModel || target.modelName
      : target.modelName
    const raw = await worker.startSimulation({
      source: target.source,
      modelName: String(selectedModel).trim() || target.modelName,
      tEnd: simTf.value,
      dt: simDt.value,
      solver: selectedRumocaSolver.value,
    })
    if (runToken !== simulationRunToken.value) return
    executionResult.value = normalizeRumocaSimulationResult({
      ...raw,
      modelName: selectedModel,
      solver: selectedRumocaSolver.value,
    })
    appendModelicaLog({
      level: 'success',
      phase: 'run',
      message: `Rumoca simulation finished (${selectedModel}, solver=${selectedRumocaSolver.value}).`,
    })
  } catch (error) {
    if (runToken !== simulationRunToken.value) return
    const message = error instanceof Error ? error.message : String(error)
    appendModelicaLog({
      level: 'error',
      phase: 'run',
      message: `Rumoca simulation failed: ${message}`,
    })
    Notify.create({
      type: 'negative',
      message,
      timeout: 7000,
    })
  } finally {
    if (runToken === simulationRunToken.value) {
      running.value = false
    }
  }
}

const runInSandbox = async (jsSource: string | undefined) => {
  executionResult.value = {}
  const runToken = ++simulationRunToken.value
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
    if (runToken !== simulationRunToken.value) return
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
    if (runToken === simulationRunToken.value) {
      running.value = false
    }
  }
}

const stopExecution = () => {
  simulationRunToken.value += 1
  abortController.value?.abort()
  running.value = false
}

onMounted(async () => {
  const mountedStartedAt = performance.now()
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: 'Modelica editor startup: begin state hydration',
  })
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
    standardMslCachedZipPath,
    templatesTab,
    resultsTab,
    showAllInPrompt,
    currentProjectId,
  })
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: `Modelica editor startup: global state hydrated in ${Math.round(performance.now() - mountedStartedAt)} ms`,
    details: {
      useModelicaStandardLibrary: useModelicaStandardLibrary.value,
      requiredLibraryCount: requiredLibraries.value.length,
      mslCachedZipPath: mslCachedZipPath.value,
      standardMslCachedZipPath: standardMslCachedZipPath.value,
    },
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
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: `Modelica editor startup: project state hydrated in ${Math.round(performance.now() - mountedStartedAt)} ms`,
    details: {
      currentProjectId: currentProjectId.value,
      hasProjectFile: Boolean(projectFile.value),
    },
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
      useModelicaStandardLibrary.value = false
      requiredLibraries.value = []
      uiTemplates.value = {}
      selectedUiTemplateKey.value = makeSourceKey('builtin', 'default')
      selectedSimulationBackend.value = 'js'
      selectedRumocaSolver.value = 'auto'
      modelicaSource.value = ''
      openedLibraryClassContext.value = null
      resetDiagramNavigation()
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
    useModelicaStandardLibrary.value = false
    requiredLibraries.value = []
    uiTemplates.value = {}
    selectedUiTemplateKey.value = makeSourceKey('builtin', 'default')
    selectedSimulationBackend.value = 'js'
    selectedRumocaSolver.value = 'auto'
    modelicaSource.value = ''
    openedLibraryClassContext.value = null
    resetDiagramNavigation()
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
  appendModelicaLog({
    level: 'info',
    phase: 'general',
    message: `Modelica editor startup: project discovery finished in ${Math.round(performance.now() - mountedStartedAt)} ms`,
    details: {
      availableProjectCount: availableProjectIds.value.length,
      currentProjectId: currentProjectId.value,
      useModelicaStandardLibrary: useModelicaStandardLibrary.value,
      requiredLibraries: requiredLibraries.value,
    },
  })
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
      selectedSimulationBackend,
      selectedRumocaSolver,
      selectedSolverKey,
      solverOptionsByKey,
      requiredLibraries,
      plotCharts,
      plotViewOptions,
      executionResult,
      libraryTreeShowRootMetadata,
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

  const getRequestedWorkerThreads = (): number => {
    const hardwareThreads =
      typeof navigator !== 'undefined' &&
      typeof navigator.hardwareConcurrency === 'number' &&
      Number.isFinite(navigator.hardwareConcurrency)
        ? navigator.hardwareConcurrency
        : 2
    const canUseThreadedWasm = globalThis.crossOriginIsolated === true
    return canUseThreadedWasm ? Math.max(1, Math.min(hardwareThreads, 4)) : 0
  }

  const initModelicaWorker = async (): Promise<ModelicaWorkerClient> => {
    const startedAt = performance.now()
    const requestedThreads = getRequestedWorkerThreads()
    appendModelicaLog({
      level: 'info',
      phase: 'loadWasm',
      message: `Initializing Modelica worker (requested threads=${requestedThreads})`,
      details: {
        crossOriginIsolated: globalThis.crossOriginIsolated === true,
        hardwareConcurrency:
          typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
      },
    })
    const worker = new ModelicaWorkerClient()
    modelicaWorker.value = worker
    unsubscribeWorkerActivity?.()
    unsubscribeWorkerActivity = worker.onActivity(onWorkerActivity)
    const initInfo = await worker.init(requestedThreads)
    configureModelicaLspExtensions(worker)
    wasmLoaded.value = true
    if (initInfo.version) rumocaWasmVersion.value = initInfo.version
    if (initInfo.gitCommit) rumocaWasmGitCommit.value = initInfo.gitCommit
    if (initInfo.buildTimeUtc) rumocaWasmBuildTimeUtc.value = initInfo.buildTimeUtc
    if (initInfo.rustBuildTimeUtc) rumocaWasmRustBuildTimeUtc.value = initInfo.rustBuildTimeUtc
    if (initInfo.packageBuiltTimeUtc) {
      rumocaWasmPackageBuiltTimeUtc.value = initInfo.packageBuiltTimeUtc
    }
    rumocaSimulationAvailable.value = Boolean(initInfo.simulationAvailable)
    rumocaSimulationModelDiscoveryAvailable.value = Boolean(
      initInfo.simulationModelDiscoveryAvailable,
    )
    appendModelicaLog({
      level: 'success',
      phase: 'loadWasm',
      message: `Initialized Modelica worker in ${Math.round(performance.now() - startedAt)} ms`,
      details: {
        requestedThreads,
        rayonEnabled: initInfo.rayonEnabled,
        version: initInfo.version,
        gitCommit: initInfo.gitCommit,
        simulationAvailable: initInfo.simulationAvailable,
        simulationModelDiscoveryAvailable: initInfo.simulationModelDiscoveryAvailable,
      },
    })
    return worker
  }

  // 3) Modelica worker
  try {
    const workerStartupStartedAt = performance.now()
    const worker = await initModelicaWorker()
    const documentCountStartedAt = performance.now()
    const documentCount = await worker.getSourceRootDocumentCount()
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: `Checked Modelica worker source-root document count in ${Math.round(performance.now() - documentCountStartedAt)} ms: ${documentCount}`,
      details: {
        documentCount,
        useModelicaStandardLibrary: useModelicaStandardLibrary.value,
        requiredLibraries: requiredLibraries.value,
      },
    })
    const persistedLibraryLoadRequested =
      Boolean(useModelicaStandardLibrary.value) || requiredLibraries.value.length > 0
    appendModelicaLog({
      level: 'info',
      phase: 'general',
      message: persistedLibraryLoadRequested
        ? 'Modelica editor startup: persisted library load requested'
        : 'Modelica editor startup: no persisted library load requested',
      details: {
        documentCount,
        useModelicaStandardLibrary: useModelicaStandardLibrary.value,
        requiredLibraries: requiredLibraries.value,
        mslCachedZipPath: mslCachedZipPath.value,
      },
    })
    if (documentCount > 0 && persistedLibraryLoadRequested) {
      mslLoaded.value = true
      mslFileCount.value = documentCount
      await refreshLibraryTree()
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Using already-loaded source-root libraries from worker cache (reason: persisted project settings, documents=${documentCount})`,
      })
    } else if (useModelicaStandardLibrary.value) {
      const requiredOpfsPaths = normalizeRequiredLibraries(
        requiredLibraries.value
          .filter((entry) => entry.startsWith('opfs:'))
          .map((entry) => entry.slice('opfs:'.length)),
      )
      if (requiredOpfsPaths.length > 0) {
        await loadLibraryArchivesFromOpfs(
          requiredOpfsPaths,
          'project settings: persisted OPFS archives',
        )
        await refreshLibraryTree()
      } else if (String(mslCachedZipPath.value || '').trim()) {
        await loadCachedMslZipFromOpfs('project settings: useMSL with cached zip path')
        await refreshLibraryTree()
      }
    } else if (documentCount > 0) {
      appendModelicaLog({
        level: 'info',
        phase: 'general',
        message: `Detected preloaded worker source-root libraries but skipped attaching them (reason: no persisted library requirement, documents=${documentCount})`,
      })
    }
    appendModelicaLog({
      level: 'success',
      phase: 'general',
      message: `Modelica worker loaded successfully in ${Math.round(performance.now() - workerStartupStartedAt)} ms! Ready to compile.`,
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

.analysis-artifact-dialog {
  width: min(85vw, 1200px);
  max-width: 85vw;
  height: 80vh;
  max-height: 80vh;
}

.analysis-artifact-dialog-body {
  height: calc(80vh - 33px);
}

.model-help-scroll {
  overflow: auto;
  height: 100%;
}

.model-help-doc {
  font-size: 13px;
  line-height: 1.4;
}

.model-help-raw {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
}
</style>
