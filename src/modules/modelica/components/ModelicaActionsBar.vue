<template>
  <q-bar flat class="rounded-borders bg-transparent q-ma-xs">
    <q-btn-dropdown dense flat color="grey-7" label="Project" dropdown-icon="">
      <div class="q-pa-sm" style="min-width: 420px; max-width: 92vw">
        <q-select
          :model-value="currentProjectId"
          :options="availableProjectIds"
          dense
          standout
          label="Project"
          :disable="availableProjectIds.length === 0"
          @update:model-value="emit('project-selected', String($event || ''))"
        />
        <div class="row items-center q-gutter-xs q-mt-sm">
          <q-btn dense flat color="secondary" label="New" title="Create a new project" @click="emit('create-project')" />
          <q-btn dense flat color="grey-7" :icon="matRefresh" title="Refresh project list" @click="emit('refresh-projects')" />
          <q-btn
            dense
            flat
            color="negative"
            :icon="matDelete"
            title="Delete current project"
            :disable="!currentProjectId"
            @click="emit('delete-project')"
          />
          <q-space />
          <q-btn dense flat color="grey-7" label="Export" :disable="!projectFile" @click="emit('export-project')" />
          <q-btn dense flat color="grey-7" label="Import" @click="projectImportEl?.click()" />
        </div>
        <q-separator class="q-my-sm" />
        <ObjectView
          v-model="projectMenuModel"
          :schema="projectMenuSchema"
          class="fit"
          dense
          missing-mode="hide"
        />
      </div>
    </q-btn-dropdown>

    <q-btn-dropdown dense flat color="grey-7" label="Libraries" dropdown-icon="">
      <div class="q-pa-sm" style="min-width: 460px; max-width: 95vw">
        <div class="text-caption text-grey-7 q-mb-sm">
          {{ mslLoaded ? `MSL loaded: ${mslArchiveName || 'archive'} (${mslFileCount} files)` : 'MSL not loaded' }}
        </div>
        <div v-if="mslLoading || mslDownloading" class="row items-center q-gutter-xs q-mb-sm text-caption text-grey-7">
          <q-spinner color="primary" size="16px" />
          <span>{{ mslDownloading ? 'Downloading Modelica library ZIP...' : 'Loading library ZIP...' }}</span>
        </div>
        <ObjectView
          v-model="libraryMenuModel"
          :schema="libraryMenuSchema"
          class="fit"
          dense
          missing-mode="hide"
        />
        <div class="row items-center q-gutter-xs q-mt-sm">
          <q-btn
            dense
            flat
            color="grey-7"
            label="Load ZIP"
            :disable="!wasmLoaded || mslLoading || mslDownloading"
            @click="mslImportEl?.click()"
          />
          <q-btn
            dense
            flat
            color="grey-7"
            label="Download to OPFS"
            :disable="mslDownloading || mslLoading"
            :loading="mslDownloading"
            @click="emit('download-msl')"
          />
          <q-btn
            dense
            flat
            color="grey-7"
            label="Load Cached"
            :disable="!mslCachedZipPath || mslLoading || mslDownloading"
            @click="emit('load-cached-msl')"
          />
          <q-btn
            dense
            flat
            color="negative"
            label="Clear MSL"
            :disable="!wasmLoaded || mslLoading || !mslLoaded"
            @click="emit('clear-msl')"
          />
        </div>
      </div>
    </q-btn-dropdown>

    <q-btn-dropdown dense flat color="grey-7" label="Options" dropdown-icon="">
      <div class="q-pa-sm" style="min-width: 420px; max-width: 95vw">
        <ObjectView
          v-model="runtimeMenuModel"
          :schema="runtimeMenuSchema"
          class="fit"
          dense
          missing-mode="hide"
        />
        <div class="row items-center q-gutter-xs q-mt-sm">
          <q-btn dense flat color="grey-7" label="Reset View" @click="emit('reset-view')" />
          <q-btn dense flat color="grey-7" :icon="matDelete" label="Clear All" @click="emit('clear-all')" />
          <q-btn dense flat color="grey-7" :icon="matDescription" label="Load Example" @click="emit('load-example')" />
        </div>
      </div>
    </q-btn-dropdown>

    <q-btn-dropdown dense flat color="grey-7" label="Versions" dropdown-icon="">
      <div class="q-pa-sm" style="min-width: 280px">
        <div class="text-caption text-grey-7 q-mb-sm">
          Version {{ currentVersionIndex + 1 }} / {{ documentVersionsLength }}
        </div>
        <div class="row items-center q-gutter-xs">
          <q-btn
            flat
            dense
            round
            :icon="matNavigateBefore"
            title="Previous Version"
            :disable="currentVersionIndex === 0"
            @click="emit('previous-version')"
          />
          <q-btn
            flat
            dense
            round
            :icon="matNavigateNext"
            title="Next Version"
            :disable="currentVersionIndex === documentVersionsLength - 1"
            @click="emit('next-version')"
          />
          <q-btn
            flat
            dense
            round
            :icon="mdiTextBoxPlus"
            color="secondary"
            title="Create New Version Snapshot"
            @click="emit('create-version')"
          />
        </div>
      </div>
    </q-btn-dropdown>

    <q-btn-dropdown dense flat color="secondary" :icon="matSave" label="Save" dropdown-icon="">
      <q-list dense style="min-width: 220px">
        <q-item v-close-popup clickable @click="emit('export-target', 'modelica')">
          <q-item-section>Export Modelica</q-item-section>
        </q-item>
        <q-item v-close-popup clickable @click="emit('export-target', 'template')">
          <q-item-section>Export Template</q-item-section>
        </q-item>
        <q-separator />
        <q-item v-close-popup clickable @click="emit('export-target', 'js')">
          <q-item-section>Export Generated JS</q-item-section>
        </q-item>
        <q-item v-close-popup clickable @click="emit('export-target', 'daePretty')">
          <q-item-section>Export Pretty DAE</q-item-section>
        </q-item>
        <q-item v-close-popup clickable @click="emit('export-target', 'daeJson')">
          <q-item-section>Export DAE JSON</q-item-section>
        </q-item>
        <q-separator />
        <q-item v-close-popup clickable @click="emit('export-ui-html')">
          <q-item-section>Export UI HTML</q-item-section>
        </q-item>
        <q-item v-close-popup clickable @click="emit('export-ui-jinja')">
          <q-item-section>Export UI Jinja Template</q-item-section>
        </q-item>
      </q-list>
    </q-btn-dropdown>

    <input
      ref="projectImportEl"
      type="file"
      accept="application/json,.json"
      style="display: none"
      @change="emit('import-project-file', $event)"
    />
    <input
      ref="mslImportEl"
      type="file"
      accept=".zip,application/zip"
      style="display: none"
      @change="emit('import-msl-file', $event)"
    />

    <q-space />
    <q-chip
      v-if="mslLoading || mslDownloading"
      dense
      square
      color="grey-3"
      text-color="grey-8"
      style="font-size: 11px; padding: 0 4px; min-height: 20px"
    >
      <q-spinner class="q-mr-xs" color="primary" size="10px" />
      {{ mslDownloading ? 'MSL' : 'MSL' }}
    </q-chip>
    <q-chip
      v-else-if="mslLoaded"
      dense
      square
      color="positive"
      text-color="white"
      style="font-size: 11px; padding: 0 4px; min-height: 20px"
      :label="`MSL ${mslFileCount}`"
    />

    <SimulationRunControls
      v-model:open="simulationControlsOpenModel"
      v-model:t0="simT0Model"
      v-model:tf="simTfModel"
      v-model:dt="simDtModel"
      mode="simple"
      :solver-label="selectedSolverKey"
      :predicted-steps="predictedSteps"
      :actual-steps="actualSteps ?? null"
      :event-count="eventCount ?? null"
      :has-result="hasResult"
      :running="running"
      :can-run="Boolean(jsSource) && !isHtmlOutput"
      :show-popup-button="hasUiTemplate"
      :can-open-popup="Boolean(jsSource)"
      @run="emit('run-sandbox')"
      @open-popup="emit('open-popup')"
      @stop="emit('stop-execution')"
      @reset-from-model="emit('reset-sim-from-model')"
    >
      <template #solver-options>
        <ObjectView
          v-model="solverOptionsModel"
          missing-mode="placeholders"
          copy-btn
          :schema="solverOptionsSchema"
        />
      </template>
    </SimulationRunControls>
  </q-bar>
</template>

<script setup lang="ts">
import {
  matDelete,
  matDescription,
  matNavigateBefore,
  matNavigateNext,
  matRefresh,
  matSave,
} from '@quasar/extras/material-icons'
import { mdiTextBoxPlus } from '@quasar/extras/mdi-v6'
import type { JSONSchema7 } from 'json-schema'
import { computed, ref } from 'vue'
import ObjectView from 'src/components/varViews/ObjectView.vue'
import SimulationRunControls from './SimulationRunControls.vue'

type ExportTarget = 'modelica' | 'template' | 'js' | 'daePretty' | 'daeJson'

const props = defineProps<{
  currentProjectId: string
  availableProjectIds: string[]
  projectFile: unknown
  projectMenuOptions: Record<string, unknown>
  projectMenuSchema: JSONSchema7
  libraryMenuOptions: Record<string, unknown>
  libraryMenuSchema: JSONSchema7
  runtimeMenuOptions: Record<string, unknown>
  runtimeMenuSchema: JSONSchema7
  mslLoaded: boolean
  mslLoading: boolean
  mslDownloading: boolean
  mslArchiveName: string
  mslFileCount: number
  mslCachedZipPath: string
  wasmLoaded: boolean
  currentVersionIndex: number
  documentVersionsLength: number
  jsSource: string
  hasUiTemplate: boolean
  isHtmlOutput: boolean
  running: boolean
  simulationControlsOpen: boolean
  simT0: number
  simTf: number
  simDt: number
  selectedSolverKey: string
  predictedSteps: number
  actualSteps?: number | null
  eventCount?: number | null
  hasResult: boolean
  solverOptions: Record<string, unknown>
  solverOptionsSchema?: JSONSchema7 | undefined
}>()

const emit = defineEmits<{
  (e: 'project-selected', value: string): void
  (e: 'create-project'): void
  (e: 'refresh-projects'): void
  (e: 'delete-project'): void
  (e: 'export-project'): void
  (e: 'import-project-file', ev: Event): void
  (e: 'import-msl-file', ev: Event): void
  (e: 'download-msl'): void
  (e: 'load-cached-msl'): void
  (e: 'clear-msl'): void
  (e: 'clear-all'): void
  (e: 'reset-view'): void
  (e: 'load-example'): void
  (e: 'previous-version'): void
  (e: 'next-version'): void
  (e: 'create-version'): void
  (e: 'export-target', target: ExportTarget): void
  (e: 'export-ui-html'): void
  (e: 'export-ui-jinja'): void
  (e: 'run-sandbox'): void
  (e: 'open-popup'): void
  (e: 'stop-execution'): void
  (e: 'reset-sim-from-model'): void
  (e: 'update:simulation-controls-open', value: boolean): void
  (e: 'update:sim-t0', value: number): void
  (e: 'update:sim-tf', value: number): void
  (e: 'update:sim-dt', value: number): void
  (e: 'update:solver-options', value: Record<string, unknown>): void
  (e: 'update:projectMenuOptions', value: Record<string, unknown>): void
  (e: 'update:libraryMenuOptions', value: Record<string, unknown>): void
  (e: 'update:runtimeMenuOptions', value: Record<string, unknown>): void
}>()

const projectImportEl = ref<HTMLInputElement | null>(null)
const mslImportEl = ref<HTMLInputElement | null>(null)

const projectMenuModel = computed({
  get: () => props.projectMenuOptions,
  set: (v: Record<string, unknown>) => emit('update:projectMenuOptions', v),
})

const libraryMenuModel = computed({
  get: () => props.libraryMenuOptions,
  set: (v: Record<string, unknown>) => emit('update:libraryMenuOptions', v),
})

const runtimeMenuModel = computed({
  get: () => props.runtimeMenuOptions,
  set: (v: Record<string, unknown>) => emit('update:runtimeMenuOptions', v),
})

const simT0Model = computed({
  get: () => props.simT0,
  set: (v: number) => emit('update:sim-t0', Number(v)),
})

const simTfModel = computed({
  get: () => props.simTf,
  set: (v: number) => emit('update:sim-tf', Number(v)),
})

const simDtModel = computed({
  get: () => props.simDt,
  set: (v: number) => emit('update:sim-dt', Number(v)),
})

const simulationControlsOpenModel = computed({
  get: () => props.simulationControlsOpen,
  set: (v: boolean) => emit('update:simulation-controls-open', Boolean(v)),
})

const solverOptionsModel = computed({
  get: () => props.solverOptions,
  set: (v: Record<string, unknown>) => emit('update:solver-options', v),
})
</script>
